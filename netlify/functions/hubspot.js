// FENYX Event-Dashboard — HubSpot API Proxy
// Netlify Function: /.netlify/functions/hubspot

const BASE    = 'https://api.hubapi.com';
const LIST_ID = '202';

exports.handler = async function(event) {
  const p   = event.queryStringParameters || {};
  const tok = (process.env.HUBSPOT_TOKEN || '').trim();

  if (event.httpMethod === 'OPTIONS') {
    return res(204, '');
  }

  // ── ping ─────────────────────────────────────────────────────────────────
  if (p.action === 'ping') {
    return res(200, {
      ok:       true,
      hasToken: !!tok,
      tokenLen: tok.length,
      ts:       new Date().toISOString()
    });
  }

  if (!tok) {
    return res(500, { error: 'HUBSPOT_TOKEN ist nicht gesetzt. Netlify → Site settings → Environment variables → HUBSPOT_TOKEN hinzufügen → Redeploy.' });
  }

  const h = {
    Authorization:  `Bearer ${tok}`,
    'Content-Type': 'application/json'
  };

  try {

    // ── events ──────────────────────────────────────────────────────────────
    if (p.action === 'events') {
      // Request only properties we know exist (confirmed via MCP)
      const props = [
        'hs_event_name',
        'hs_event_type',
        'hs_event_description',
        'hs_start_datetime',
        'hs_end_datetime',
        'hs_event_status_v2',
        'hs_registrations',
        'hs_noshows',
        'hs_event_organizer'
      ].join(',');

      const url = `${BASE}/crm/v3/objects/marketing_events?properties=${props}&limit=100`;
      const r   = await fetch(url, { headers: h });
      const body = await r.text();

      if (!r.ok) {
        // Return HubSpot's error message for debugging
        return res(r.status, {
          _debug_url:    url,
          _hs_status:    r.status,
          _hs_response:  tryParse(body)
        });
      }
      return res(200, tryParse(body));
    }

    // ── event_contacts ───────────────────────────────────────────────────────
    if (p.action === 'event_contacts') {
      if (!p.eventId) return res(400, { error: 'eventId fehlt' });

      const eid   = p.eventId;
      const cProps = ['firstname', 'lastname', 'email', 'company', 'createdate'];

      // Methode 1: Attendees API
      const STATES = ['REGISTERED', 'ATTENDED', 'ATTENDED_ONLINE', 'CANCELLED', 'NO_SHOW'];
      for (const state of STATES) {
        const r = await fetch(
          `${BASE}/marketing/v3/marketing-events/${encodeURIComponent(eid)}/attendees?state=${state}&limit=100`,
          { headers: h }
        );
        if (!r.ok) continue;
        const d = await r.json();
        if ((d.results || []).length > 0) {
          const contacts = d.results.map(a => ({
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

      // Methode 3: CRM Associations v3
      const r3 = await fetch(
        `${BASE}/crm/v3/objects/marketing_events/${encodeURIComponent(eid)}/associations/contacts?limit=100`,
        { headers: h }
      );
      if (r3.ok) {
        const d3  = await r3.json();
        const ids = (d3.results || []).map(x => String(x.id)).filter(Boolean);
        if (ids.length > 0) {
          const batch = await batchContacts(ids, cProps, h);
          if (batch.length > 0)
            return res(200, { results: batch, total: batch.length, _method: 'assoc_v3' });
        }
      }

      // Methode 4: Segment-Liste 202 + Batch-Associations
      const listR = await fetch(
        `${BASE}/contacts/v1/lists/${LIST_ID}/contacts/all?count=100&property=firstname&property=lastname&property=email&property=company&property=createdate`,
        { headers: h }
      );
      if (listR.ok) {
        const listData     = await listR.json();
        const listContacts = listData.contacts || [];

        if (listContacts.length > 0) {
          const contactIds = listContacts.map(c => String(c.vid));
          const assocBatch = await fetch(
            `${BASE}/crm/v4/associations/contacts/marketing_events/batch/read`,
            {
              method: 'POST', headers: h,
              body:   JSON.stringify({ inputs: contactIds.map(id => ({ id })) })
            }
          );

          if (assocBatch.ok) {
            const assocData = await assocBatch.json();
            const eventSet  = new Set();

            for (const result of (assocData.results || [])) {
              const eventIds = (result.to || []).map(t => String(t.toObjectId || t.id));
              if (eventIds.includes(String(eid))) {
                eventSet.add(String(result.from?.id));
              }
            }

            const filtered = listContacts
              .filter(c => eventSet.has(String(c.vid)))
              .map(mapListContact);

            if (filtered.length > 0)
              return res(200, { results: filtered, total: filtered.length, _method: 'list_filtered' });

            // Fallback: alle Listenkontakte (kein Event-Filter möglich)
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
    return res(502, { error: `Fehler: ${e.message}`, stack: e.stack?.split('\n')[0] });
  }
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function mapListContact(c) {
  const prop = (key) => c.properties?.[key]?.value || '';
  const raw  = prop('createdate');
  const date = raw ? (isNaN(raw) ? raw : new Date(parseInt(raw)).toISOString()) : '';
  return {
    id: String(c.vid),
    properties: {
      firstname:  prop('firstname'),
      lastname:   prop('lastname'),
      email:      prop('email'),
      company:    prop('company'),
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
  const d = await r.json();
  return d.results || [];
}

function tryParse(str) {
  try { return JSON.parse(str); } catch { return str; }
}

function res(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':'Content-Type',
      'Cache-Control':               'no-cache'
    },
    body: JSON.stringify(body)
  };
}
