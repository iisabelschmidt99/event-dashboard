// FENYX Event-Dashboard — HubSpot API Proxy
// Netlify Function: /.netlify/functions/hubspot
//
// Wichtig: Marketing Events sind KEIN Standard-CRM-Objekt.
// Korrekte Endpoints:
//   Events lesen:   POST /crm/v3/objects/marketing_events/search
//   Teilnehmer:     GET  /marketing/v3/marketing-events/{id}/attendees

const BASE    = 'https://api.hubapi.com';
const LIST_ID = '202'; // Segment-Liste aller Event-Teilnehmer

exports.handler = async function(event) {
  const p   = event.queryStringParameters || {};
  const tok = (process.env.HUBSPOT_TOKEN || '').trim();

  if (event.httpMethod === 'OPTIONS') {
    return res(204, '');
  }

  // ── ping ─────────────────────────────────────────────────────────────────
  if (p.action === 'ping') {
    return res(200, { ok: true, hasToken: !!tok, tokenLen: tok.length, ts: new Date().toISOString() });
  }

  if (!tok) {
    return res(500, { error: 'HUBSPOT_TOKEN nicht gesetzt. Netlify → Environment variables → HUBSPOT_TOKEN → Redeploy.' });
  }

  const h = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };

  try {

    // ── events ──────────────────────────────────────────────────────────────
    // WICHTIG: GET /crm/v3/objects/marketing_events ist NICHT unterstützt.
    // Stattdessen: POST /crm/v3/objects/marketing_events/search
    if (p.action === 'events') {
      const body = {
        filterGroups: [],
        properties: [
          'hs_event_name',
          'hs_event_type',
          'hs_event_description',
          'hs_start_datetime',
          'hs_end_datetime',
          'hs_event_status_v2',
          'hs_registrations',
          'hs_noshows',
          'hs_event_organizer'
        ],
        limit: 100,
        sorts: [{ propertyName: 'hs_start_datetime', direction: 'ASCENDING' }]
      };

      const r = await fetch(
        `${BASE}/crm/v3/objects/marketing_events/search`,
        { method: 'POST', headers: h, body: JSON.stringify(body) }
      );
      const text = await r.text();
      if (!r.ok) return res(r.status, { _error: tryParse(text), _endpoint: 'marketing_events/search' });
      return res(200, tryParse(text));
    }

    // ── event_contacts ───────────────────────────────────────────────────────
    if (p.action === 'event_contacts') {
      if (!p.eventId) return res(400, { error: 'eventId fehlt' });

      const eid    = p.eventId;
      const cProps = ['firstname', 'lastname', 'email', 'company', 'createdate'];

      // Methode 1: Marketing Events Attendees API
      // Für CRM-UI erstellte Events = hs_object_id als externalEventId
      const STATES = ['REGISTERED', 'ATTENDED', 'ATTENDED_ONLINE', 'CANCELLED', 'NO_SHOW'];
      for (const state of STATES) {
        const r = await fetch(
          `${BASE}/marketing/v3/marketing-events/${encodeURIComponent(eid)}/attendees?state=${state}&limit=100`,
          { headers: h }
        );
        if (!r.ok) continue;
        const d = await r.json();
        const results = d.results || [];
        if (results.length > 0) {
          const contacts = results.map(a => ({
            id: String(a.vid || a.contactId || a.id || ''),
            properties: {
              firstname:  a.firstName  || a.properties?.firstname  || '',
              lastname:   a.lastName   || a.properties?.lastname   || '',
              email:      a.email      || a.properties?.email      || '',
              company:    a.company    || a.properties?.company    || '',
              createdate: a.registeredAt || a.joinedAt || ''
            }
          })).filter(c => c.id);
          if (contacts.length > 0)
            return res(200, { results: contacts, total: contacts.length, _method: 'attendees_' + state });
        }
      }

      // Methode 2: CRM Associations v4
      const r2 = await fetch(
        `${BASE}/crm/v4/objects/marketing_events/${encodeURIComponent(eid)}/associations/contacts?limit=100`,
        { headers: h }
      );
      if (r2.ok) {
        const d2  = await r2.json();
        const ids = (d2.results || []).map(x => String(x.toObjectId || x.id)).filter(Boolean);
        if (ids.length > 0) {
          const batch = await batchContacts(ids, cProps, h);
          if (batch.length > 0)
            return res(200, { results: batch, total: batch.length, _method: 'assoc_v4' });
        }
      }

      // Methode 3: Segment-Liste 202 + Batch-Associations
      const listR = await fetch(
        `${BASE}/contacts/v1/lists/${LIST_ID}/contacts/all?count=100&property=firstname&property=lastname&property=email&property=company&property=createdate`,
        { headers: h }
      );
      if (listR.ok) {
        const listData     = await listR.json();
        const listContacts = listData.contacts || [];

        if (listContacts.length > 0) {
          // Batch: welche Events hat jeder Kontakt?
          const contactIds = listContacts.map(c => String(c.vid));
          const assocR     = await fetch(
            `${BASE}/crm/v4/associations/contacts/marketing_events/batch/read`,
            { method: 'POST', headers: h, body: JSON.stringify({ inputs: contactIds.map(id => ({ id })) }) }
          );

          if (assocR.ok) {
            const assocData = await assocR.json();
            const matched   = new Set();
            for (const result of (assocData.results || [])) {
              const evIds = (result.to || []).map(t => String(t.toObjectId || t.id));
              if (evIds.includes(String(eid))) matched.add(String(result.from?.id));
            }

            const filtered = listContacts.filter(c => matched.has(String(c.vid))).map(mapListContact);
            if (filtered.length > 0)
              return res(200, { results: filtered, total: filtered.length, _method: 'list_filtered' });

            // Kein Event-Filter möglich → alle Listenkontakte
            const all = listContacts.map(mapListContact);
            if (all.length > 0)
              return res(200, { results: all, total: all.length, _method: 'list_all_unfiltered' });
          }
        }
      }

      return res(200, { results: [], total: 0, _method: 'none' });
    }

    return res(400, { error: `Unbekannte action: "${p.action}"` });

  } catch (e) {
    return res(502, { error: e.message, stack: e.stack?.split('\n')[0] });
  }
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function mapListContact(c) {
  const v    = key => c.properties?.[key]?.value || '';
  const raw  = v('createdate');
  const date = raw ? (isNaN(raw) ? raw : new Date(parseInt(raw)).toISOString()) : '';
  return {
    id: String(c.vid),
    properties: {
      firstname:  v('firstname'),
      lastname:   v('lastname'),
      email:      v('email'),
      company:    v('company'),
      createdate: date
    }
  };
}

async function batchContacts(ids, props, h) {
  const r = await fetch(`${BASE}/crm/v3/objects/contacts/batch/read`, {
    method: 'POST', headers: h,
    body:   JSON.stringify({ inputs: ids.map(id => ({ id })), properties: props })
  });
  if (!r.ok) return [];
  return (await r.json()).results || [];
}

function tryParse(str) {
  try { return JSON.parse(str); } catch { return { raw: str }; }
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
    body: JSON.stringify(body)
  };
}
