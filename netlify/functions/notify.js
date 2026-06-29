// FENYX Event-Dashboard — Finance-Benachrichtigung
// POST /.netlify/functions/notify
// Leitet eine hochgeladene Rechnung an einen Power-Automate-Flow weiter,
// der die E-Mail an finance@fenyx-office.com (Betreff "Rechnung") mit PDF-Anhang versendet.
//
// Erwarteter Body:
//   { path?, base64?, filename, anbieter, betrag, kategorie, status, event, po, eventId }
//   - path:   Storage-Pfad der Rechnung (bevorzugt; notify holt das PDF selbst -> kein CORS)
//   - base64: alternativ das PDF direkt als base64 (Fallback)
//
// Env: POWER_AUTOMATE_URL = Webhook-URL des Power-Automate-Flows (HTTP-Trigger)
//      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (für Storage-Download)

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const FINANCE_TO = 'finance@fenyx-office.com';
const SUBJECT    = 'Rechnung';
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const BUCKET = 'invoices';

const CAT_LABEL = { location: 'Location & Technik', catering: 'Catering & Bewirtung', marketing: 'Marketing & Speaker' };

function res(status, body) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function eur(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return '–';
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// Signierte Download-URL für einen Storage-Pfad erzeugen (gültig N Sekunden)
async function signUrl(path, expiresIn) {
  if (!path || !SB_URL || !SB_KEY) return '';
  const s = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${encodeURI(path)}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: expiresIn || 3600 })
  });
  if (!s.ok) return '';
  let sd; try { sd = JSON.parse(await s.text()); } catch { return ''; }
  return sd.signedURL ? `${SB_URL}/storage/v1${sd.signedURL}` : '';
}

// PDF serverseitig aus Storage holen und als base64 zurückgeben (Fallback-Weg)
async function fetchFromStorage(path) {
  const url = await signUrl(path, 120);
  if (!url) return '';
  const f = await fetch(url);
  if (!f.ok) return '';
  const buf = Buffer.from(await f.arrayBuffer());
  return buf.toString('base64');
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const hook = (process.env.POWER_AUTOMATE_URL || '').trim();

  // Diagnose: GET zeigt, ob Webhook-URL + Storage-Keys beim Deploy ankommen
  if (event.httpMethod === 'GET') {
    const hasSig = /[?&]sig=/.test(hook);
    return res(200, {
      configured: !!hook,
      length: hook.length,
      hasSignature: hasSig,
      startsWithHttps: hook.startsWith('https://'),
      storageReady: !!(SB_URL && SB_KEY),
      hint: !hook
        ? 'POWER_AUTOMATE_URL ist NICHT gesetzt. In Netlify eintragen UND neu deployen.'
        : (hasSig ? 'URL gesetzt und enthält Signatur (sig=).'
                  : 'URL gesetzt, aber OHNE sig= – nach Umstellung auf „Jeder" die NEUE URL kopieren.')
    });
  }

  if (event.httpMethod !== 'POST') return res(405, { error: 'Method Not Allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res(400, { error: 'Ungültiger Body' }); }

  // PDF besorgen: bevorzugt serverseitig aus dem Storage (zuverlässig), sonst base64 aus dem Body
  let contentBytes = '';
  let fetchNote = '';
  try {
    if (body.path) {
      contentBytes = await fetchFromStorage(body.path);
      if (!contentBytes) fetchNote = 'Storage-Download leer/fehlgeschlagen';
    }
    if (!contentBytes && body.base64) contentBytes = body.base64;
  } catch (e) { fetchNote = e.message; }

  // Signierte Download-URL (1h) für den HTTP-GET-Weg in Power Automate (Plan B)
  let fileUrl = '';
  try { if (body.path) fileUrl = await signUrl(body.path, 3600); } catch (e) { /* egal */ }

  const katLabel = CAT_LABEL[body.kategorie] || body.kategorie || '–';
  const bodyHtml =
    '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.5">' +
      '<p>Hallo Buchhaltung,</p>' +
      '<p>im FENYX Event-Dashboard wurde eine neue Rechnung hochgeladen. Die wichtigsten Angaben:</p>' +
      '<table cellpadding="7" style="border-collapse:collapse;font-size:14px;margin:6px 0 14px">' +
        '<tr><td style="color:#6b7280">Lieferant</td><td><b>' + (esc(body.anbieter) || '–') + '</b></td></tr>' +
        '<tr><td style="color:#6b7280">Netto-Betrag</td><td><b>' + eur(body.betrag) + '</b></td></tr>' +
        '<tr><td style="color:#6b7280">Kategorie</td><td>' + esc(katLabel) + '</td></tr>' +
        '<tr><td style="color:#6b7280">Status</td><td>' + (esc(body.status) || '–') + '</td></tr>' +
        '<tr><td style="color:#6b7280">PO-Nummer</td><td>' + (esc(body.po) || '–') + '</td></tr>' +
        '<tr><td style="color:#6b7280">Event</td><td>' + (esc(body.event) || '–') + '</td></tr>' +
        '<tr><td style="color:#6b7280">Dateiname</td><td>' + (esc(body.filename) || 'rechnung.pdf') + '</td></tr>' +
      '</table>' +
      '<p>Die Original-Rechnung ist als PDF an diese E-Mail angehängt. Bitte zur Prüfung und Verbuchung.</p>' +
      '<p style="color:#9ca3af;font-size:12px;margin-top:18px">Automatisch gesendet vom FENYX Event-Dashboard.</p>' +
    '</div>';

  const bodyText =
    'Hallo Buchhaltung,\n\n' +
    'im FENYX Event-Dashboard wurde eine neue Rechnung hochgeladen:\n\n' +
    'Lieferant:    ' + (body.anbieter || '-') + '\n' +
    'Netto-Betrag: ' + eur(body.betrag) + '\n' +
    'Kategorie:    ' + katLabel + '\n' +
    'Status:       ' + (body.status || '-') + '\n' +
    'PO-Nummer:    ' + (body.po || '-') + '\n' +
    'Event:        ' + (body.event || '-') + '\n\n' +
    'Die Rechnung ist als PDF angehängt.\n\nFENYX Event-Dashboard';

  const payload = {
    to:        FINANCE_TO,
    subject:   body.subject || SUBJECT,
    filename:  body.filename || 'rechnung.pdf',
    contentBytes,          // base64 des PDFs (serverseitig geholt)
    fileUrl,               // signierter Download-Link (für HTTP-GET-Anhang, Plan B)
    anbieter:  body.anbieter || '',
    betrag:    body.betrag != null ? body.betrag : '',
    kategorie: body.kategorie || '',
    status:    body.status || '',
    po:        body.po || '',
    event:     body.event || '',
    eventId:   body.eventId || '',
    bodyHtml,              // schön formatiert (HTML)
    bodyText              // Klartext-Variante
  };

  if (!hook) {
    return res(200, { ok: false, prepared: true,
      message: 'POWER_AUTOMATE_URL nicht gesetzt – E-Mail wurde NICHT versendet.' });
  }
  if (!contentBytes && !fileUrl) {
    return res(200, { ok: false,
      error: 'PDF konnte nicht angehängt werden (' + (fetchNote || 'kein PDF gefunden') + '). E-Mail nicht gesendet.' });
  }

  try {
    const r = await fetch(hook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const txt = await r.text();
    if (!r.ok) return res(502, { ok: false, error: 'Power Automate Fehler: ' + (txt || r.statusText) });
    return res(200, { ok: true, attachmentBytes: Math.floor(contentBytes.length * 3 / 4), source: body.path ? 'storage' : 'base64' });
  } catch (e) {
    return res(502, { ok: false, error: e.message });
  }
};
