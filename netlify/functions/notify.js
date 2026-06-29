// FENYX Event-Dashboard — Finance-Benachrichtigung
// POST /.netlify/functions/notify
// Leitet eine hochgeladene Rechnung an einen Power-Automate-Flow weiter,
// der die E-Mail an finance@fenyx-office.com (Betreff "Rechnung") mit PDF-Anhang versendet.
//
// Erwarteter Body:
//   { filename, base64, anbieter, betrag, kategorie, status, event, po, eventId }
//
// Env: POWER_AUTOMATE_URL = Webhook-URL des Power-Automate-Flows (HTTP-Trigger)

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const FINANCE_TO = 'finance@fenyx-office.com';
const SUBJECT    = 'Rechnung';

function res(status, body) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const hook = (process.env.POWER_AUTOMATE_URL || '').trim();

  // Diagnose: GET zeigt, ob die Webhook-URL beim Function-Deploy ankommt
  // (ohne die URL selbst preiszugeben). Aufruf: /.netlify/functions/notify
  if (event.httpMethod === 'GET') {
    return res(200, {
      configured: !!hook,
      hint: hook
        ? 'POWER_AUTOMATE_URL ist gesetzt.'
        : 'POWER_AUTOMATE_URL ist NICHT gesetzt. In Netlify eintragen UND neu deployen.'
    });
  }

  if (event.httpMethod !== 'POST') return res(405, { error: 'Method Not Allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res(400, { error: 'Ungültiger Body' }); }

  const payload = {
    to:        FINANCE_TO,
    subject:   SUBJECT,
    filename:  body.filename || 'rechnung.pdf',
    // PDF als base64 (ohne data:-Präfix) für den Anhang im Flow
    contentBytes: body.base64 || '',
    // Klartext-Infos für den Mail-Body
    anbieter:  body.anbieter || '',
    betrag:    body.betrag != null ? body.betrag : '',
    kategorie: body.kategorie || '',
    status:    body.status || '',
    po:        body.po || '',
    event:     body.event || '',
    eventId:   body.eventId || '',
    bodyText:  `Neue Rechnung hochgeladen.\n` +
               `Lieferant: ${body.anbieter || '-'}\n` +
               `Netto: ${body.betrag != null ? body.betrag + ' EUR' : '-'}\n` +
               `Kategorie: ${body.kategorie || '-'}\n` +
               `Status: ${body.status || '-'}\n` +
               `PO-Nummer: ${body.po || '-'}\n` +
               `Event: ${body.event || '-'}`
  };

  // Noch kein Webhook konfiguriert -> sauber zurückmelden (Vorbereitungsmodus)
  if (!hook) {
    return res(200, {
      ok: false,
      prepared: true,
      message: 'POWER_AUTOMATE_URL nicht gesetzt – E-Mail wurde NICHT versendet. Webhook-URL in Netlify hinterlegen.'
    });
  }

  try {
    const r = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const txt = await r.text();
    if (!r.ok) return res(502, { ok: false, error: 'Power Automate Fehler: ' + (txt || r.statusText) });
    return res(200, { ok: true });
  } catch (e) {
    return res(502, { ok: false, error: e.message });
  }
};
