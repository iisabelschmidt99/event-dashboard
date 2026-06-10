// FENYX Event-Dashboard — HubSpot API Proxy
// Korrekte Endpoints laut HubSpot Marketing Events API Doku (2026-03):
//   Events:      GET  /marketing/marketing-events/2026-03
//   Teilnehmer:  GET  /marketing/marketing-events/2026-03/associations/{eventId}/lists
//                dann GET /contacts/v1/lists/{listId}/contacts/all

const BASE     = 'https://api.hubapi.com';
const ME_BASE  = `${BASE}/marketing/marketing-events/2026-03`; // Korrekte API-Version
const LIST_202 = '202'; // Segment-Liste aller Teilnehmer (Fallback)

exports.handler = async function(event) {
  const p   = event.queryStringParameters || {};
  const tok = (process.env.HUBSPOT_TOKEN || '').trim();

  if (event.httpMethod === 'OPTIONS') return res(204, '');

  // ── ping ──────────────────────────────────────────────────────────────────
  if (p.action === 'ping') {
    return res(200, { ok: true, hasToken: !!tok, ts: new Date().toISOString() });
  }

  if (!tok) {
    return res(500, { error: 'HUBSPOT_TOKEN nicht gesetzt. Netlify → Environment variables → Redeploy.' });
  }

  const h = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };

  try {

    // ── events ───────────────────────────────────────────────────────────────
    // GET /marketing/marketing-events/2026-03  (nicht die CRM Objects API!)
    if (p.action === 'events') {
      const r = await fetch(`${ME_BASE}?limit=100`, { headers: h });
      const body = await r.text();
      if (!r.ok) return res(r.status, { _error: tryParse(body) });

      // Response-Format normalisieren → Dashboard-Format
      const data = tryParse(body);
      const normalized = (data.results || []).map(e => ({
        id:            String(e.objectId || e.id || ''),
        name:          e.eventName || '',
        type:          e.eventType || '',
        desc:          e.eventDescription || '',
        date:          (e.startDateTime || '').split('T')[0],
        status:        e.eventCancelled ? 'cancelled' : e.eventCompleted ? 'completed' : 'upcoming',
        regs:          parseInt(e.registrants    || 0),
        attendees:     parseInt(e.attendees      || 0),
        cancellations: parseInt(e.cancellations  || 0),
        noShows:       parseInt(e.noShows        || 0),
        org:           e.eventOrganizer || ''
      }));

      return res(200, { results: normalized, total: normalized.length });
    }

    // ── event_contacts ────────────────────────────────────────────────────────
    if (p.action === 'event_contacts') {
      if (!p.eventId) return res(400, { error: 'eventId fehlt' });
      const eid = p.eventId;

      // ── Methode 1: Event-assoziierte Listen ──────────────────────────────
      // GET /marketing/marketing-events/2026-03/associations/{marketingEventId}/lists
      const listsR = await fetch(
        `${ME_BASE}/associations/${encodeURIComponent(eid)}/lists`,
        { headers: h }
      );
      if (listsR.ok) {
        const listsData = await listsR.json();
        const lists     = listsData.results || [];

        for (const list of lists) {
          const cR = await fetch(
            `${BASE}/contacts/v1/lists/${list.listId}/contacts/all?count=100&property=firstname&property=lastname&property=email&property=company&property=createdate`,
            { headers: h }
          );
          if (!cR.ok) continue;
          const cData    = await cR.json();
          const contacts = (cData.contacts || []).map(mapListContact);
          if (contacts.length > 0) {
            return res(200, { results: contacts, total: contacts.length, _method: 'event_list_' + list.listId });
          }
        }
      }

      // ── Methode 2: Attendance Participations ─────────────────────────────
      // GET /marketing/marketing-events/2026-03/participations/contacts/{id}/breakdown
      // Ansatz: Alle Kontakte aus Segment-Liste 202 holen + nach Event filtern
      const listR = await fetch(
        `${BASE}/contacts/v1/lists/${LIST_202}/contacts/all?count=100&property=firstname&property=lastname&property=email&property=company&property=createdate`,
        { headers: h }
      );
      if (listR.ok) {
        const listData  = await listR.json();
        const allContacts = listData.contacts || [];

        // Für jeden Kontakt prüfen ob er an diesem Event teilgenommen hat
        // (batch-weise, max 10 gleichzeitig um Rate Limits zu vermeiden)
        const matched = [];
        for (let i = 0; i < allContacts.length; i += 10) {
          const batch  = allContacts.slice(i, i + 10);
          const checks = await Promise.all(
            batch.map(async c => {
              const r = await fetch(
                `${ME_BASE}/participations/contacts/${c.vid}/breakdown`,
                { headers: h }
              );
              if (!r.ok) return null;
              const d = await r.json();
              const events = (d.results || []).map(x =>
                String(x.associations?.marketingEvent?.marketingEventId || '')
              );
              return events.includes(String(eid)) ? c : null;
            })
          );
          matched.push(...checks.filter(Boolean));
        }

        if (matched.length > 0) {
          return res(200, {
            results: matched.map(mapListContact),
            total:   matched.length,
            _method: 'participations_breakdown'
          });
        }

        // Letzter Fallback: alle Listenkontakte ohne Event-Filter
        if (allContacts.length > 0) {
          return res(200, {
            results: allContacts.map(mapListContact),
            total:   allContacts.length,
            _method: 'list_all_no_filter'
          });
        }
      }

      return res(200, { results: [], total: 0, _method: 'none' });
    }

    return res(400, { error: `Unbekannte action: "${p.action}"` });

  } catch (e) {
    return res(502, { error: e.message });
  }
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function mapListContact(c) {
  const v   = key => c.properties?.[key]?.value || '';
  const raw = v('createdate');
  const dt  = raw ? (isNaN(raw) ? raw : new Date(parseInt(raw)).toISOString()) : '';
  return {
    id: String(c.vid),
    properties: {
      firstname:  v('firstname'),
      lastname:   v('lastname'),
      email:      v('email'),
      company:    v('company'),
      createdate: dt
    }
  };
}

function tryParse(s) {
  try { return JSON.parse(s); } catch { return { raw: s }; }
}

function res(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type':                 'application/json',
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control':                'no-cache'
    },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  };
}
