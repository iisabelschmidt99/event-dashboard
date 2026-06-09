// FENYX Event-Dashboard — HubSpot API Proxy
// Netlify Function: /.netlify/functions/hubspot
//
// Actions:
//   ping                → Function-Test
//   events              → Alle Marketing Events
//   event_contacts      → Teilnehmer eines Events (4 Methoden)

const BASE    = 'https://api.hubapi.com';
const LIST_ID = '202'; // V1-Listen-ID der Teilnehmer-Segment-Liste

exports.handler = async function(event) {
  const p   = event.queryStringParameters || {};
  const tok = process.env.HUBSPOT_TOKEN;

  if (event.httpMethod === 'OPTIONS') {
    return res(204, {}, '');
  }

  if (p.action === 'ping') {
    return res(200, {}, { ok: true, hasToken: !!tok, ts: new Date().toISOString() });
  }

  if (!tok) {
    return res(500, {}, { error: 'HUBSPOT_TOKEN fehlt. In Netlify → Environment variables setzen.' });
  }

  const h = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };

  try {

    // ── events ──────────────────────────────────────────────────────────────
    if (p.action === 'events') {
      const props = [
        'hs_event_name', 'hs_event_type', 'hs_event_description',
        'hs_start_datetime', 'hs_end_datetime', 'hs_event_status_v2',
        'hs_registrations', 'hs_noshows', 'hs_event_organizer', 'hubspot_owner_id'
      ].join(',');
      const r = await fetch(
        `${BASE}/crm/v3/objects/marketing_events?properties=${props}&limit=100`,
        { headers: h }
      );
      return proxy(r);
    }

    // ── event_contacts ───────────────────────────────────────────────────────
    if (p.action === 'event_contacts') {
      if (!p.eventId) return res(400, {}, { error: 'eventId fehlt' });

      const eid = p.eventId;
      const contactProps = ['firstname', 'lastname', 'email', 'company', 'createdate'];

      // ── Methode 1: Marketing Events Attendees API ──────────────────────────
      // Korrekte Methode für Workflow-registrierte Teilnehmer
      const STATES = ['REGISTERED', 'ATTENDED', 'ATTENDED_ONLINE', 'CANCELLED', 'NO_SHOW'];
      for (const state of STATES) {
        const r = await fetch(
          `${BASE}/marketing/v3/marketing-events/${encodeURIComponent(eid)}/attendees?state=${state}&limit=100`,
          { headers: h }
        );
        if (!r.ok) continue;
        const d = await r.json();
        if ((d.results || []).length > 0) {
          // Attendee-Format zu Kontakt-Format normalisieren
          const contacts = (d.results || []).map(a => ({
            id: String(a.vid || a.contactId || a.id || ''),
            properties: {
              firstname:  a.firstName  || a.properties?.firstname  || '',
              lastname:   a.lastName   || a.properties?.lastname   || '',
              email:      a.email      || a.properties?.email      || '',
              company:    a.company    || a.properties?.company    || '',
              createdate: a.registeredAt || a.joinedAt || a.properties?.createdate || ''
            }
          })).filter(c => c.id);
          if (contacts.length > 0) {
            return res(200, {}, { results: contacts, total: contacts.length, _method: 'attendees_' + state });
          }
        }
      }

      // ── Methode 2: CRM Associations v4 ────────────────────────────────────
      const r2 = await fetch(
        `${BASE}/crm/v4/objects/marketing_events/${encodeURIComponent(eid)}/associations/contacts?limit=100`,
        { headers: h }
      );
      if (r2.ok) {
        const d2 = await r2.json();
        const ids = (d2.results || []).map(x => String(x.toObjectId || x.id)).filter(Boolean);
        if (ids.length > 0) {
          const batch = await batchContacts(ids, contactProps, h);
          if (batch.length > 0) return res(200, {}, { results: batch, total: batch.length, _method: 'assoc_v4' });
        }
      }

      // ── Methode 3: CRM Associations v3 ────────────────────────────────────
      const r3 = await fetch(
        `${BASE}/crm/v3/objects/marketing_events/${encodeURIComponent(eid)}/associations/contacts?limit=100`,
        { headers: h }
      );
      if (r3.ok) {
        const d3 = await r3.json();
        const ids = (d3.results || []).map(x => String(x.id)).filter(Boolean);
        if (ids.length > 0) {
          const batch = await batchContacts(ids, contactProps, h);
          if (batch.length > 0) return res(200, {}, { results: batch, total: batch.length, _method: 'assoc_v3' });
        }
      }

      // ── Methode 4: Segment-Liste 202 + Batch-Associations ─────────────────
      // Holt alle Kontakte aus der Teilnehmer-Liste und filtert nach Event
      const listR = await fetch(
        `${BASE}/contacts/v1/lists/${LIST_ID}/contacts/all?count=100&property=firstname&property=lastname&property=email&property=company&property=createdate`,
        { headers: h }
      );
      if (listR.ok) {
        const listData = await listR.json();
        const listContacts = listData.contacts || [];

        if (listContacts.length > 0) {
          // Batch-Associations: welche Events hat jeder Kontakt?
          const contactIds = listContacts.map(c => String(c.vid));
          const assocBatch = await fetch(
            `${BASE}/crm/v4/associations/contacts/marketing_events/batch/read`,
            {
              method: 'POST', headers: h,
              body: JSON.stringify({ inputs: contactIds.map(id => ({ id })) })
            }
          );

          if (assocBatch.ok) {
            const assocData = await assocBatch.json();
            // Kontakte filtern die das gesuchte Event haben
            const contactsForEvent = new Set();
            for (const result of (assocData.results || [])) {
              const eventIds = (result.to || []).map(t => String(t.toObjectId || t.id));
              if (eventIds.includes(String(eid))) {
                contactsForEvent.add(String(result.from?.id));
              }
            }

            const filtered = listContacts
              .filter(c => contactsForEvent.has(String(c.vid)))
              .map(c => ({
                id: String(c.vid),
                properties: {
                  firstname:  c.properties?.firstname?.value  || '',
                  lastname:   c.properties?.lastname?.value   || '',
                  email:      c.properties?.email?.value      || '',
                  company:    c.properties?.company?.value    || '',
                  createdate: c.properties?.createdate?.value || ''
                }
              }));

            if (filtered.length > 0) {
              return res(200, {}, { results: filtered, total: filtered.length, _method: 'list_assoc' });
            }

            // Wenn keine Zuordnung möglich: alle Listkontakte zurückgeben
            const all = listContacts.map(c => ({
              id: String(c.vid),
              properties: {
                firstname:  c.properties?.firstname?.value  || '',
                lastname:   c.properties?.lastname?.value   || '',
                email:      c.properties?.email?.value      || '',
                company:    c.properties?.company?.value    || '',
                createdate: c.properties?.createdate?.value || ''
              }
            }));
            if (all.length > 0) {
              return res(200, {}, { results: all, total: all.length, _method: 'list_all' });
            }
          }
        }
      }

      // Keine Methode hat Daten geliefert
      return res(200, {}, { results: [], total: 0, _method: 'none' });
    }

    return res(400, {}, { error: `Unbekannte action: "${p.action}"` });

  } catch (e) {
    return res(502, {}, { error: `Fehler: ${e.message}` });
  }
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function batchContacts(ids, props, h) {
  const r = await fetch(`${BASE}/crm/v3/objects/contacts/batch/read`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ inputs: ids.map(id => ({ id })), properties: props })
  });
  if (!r.ok) return [];
  const d = await r.json();
  return d.results || [];
}

function res(status, extraHeaders, body) {
  return {
    statusCode: status,
    headers: { ...cors(), ...extraHeaders },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  };
}

async function proxy(r) {
  const body = await r.text();
  return { statusCode: r.status, headers: cors(), body };
}

function cors() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-cache'
  };
}
