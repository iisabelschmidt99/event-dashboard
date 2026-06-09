// FENYX Event-Dashboard — HubSpot API Proxy
// Netlify Function: /.netlify/functions/hubspot

const BASE = 'https://api.hubapi.com';

exports.handler = async function (event) {
  const token = process.env.HUBSPOT_TOKEN;
  const p = event.queryStringParameters || {};

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors(), body: '' };
  }

  // ── ping: tests that the function runs at all ──────────────────────────────
  if (p.action === 'ping') {
    return json({ ok: true, hasToken: !!token, ts: new Date().toISOString() });
  }

  if (!token) {
    return err(500, 'HUBSPOT_TOKEN is not set. Add it in Netlify → Site settings → Environment variables.');
  }

  const hdrs = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  try {
    switch (p.action) {

      // ── All Marketing Events ──────────────────────────────────────────────
      case 'events': {
        const props = [
          'hs_event_name', 'hs_event_type', 'hs_event_description',
          'hs_start_datetime', 'hs_end_datetime', 'hs_event_status_v2',
          'hs_registrations', 'hs_noshows', 'hs_event_organizer', 'hubspot_owner_id'
        ].join(',');
        const res = await fetch(
          `${BASE}/crm/v3/objects/marketing_events?properties=${props}&limit=100`,
          { headers: hdrs }
        );
        if (!res.ok) {
          const body = await res.text();
          return err(res.status, `HubSpot error ${res.status}: ${body.slice(0, 300)}`);
        }
        return proxy(res);
      }

      // ── Contacts associated with a Marketing Event ────────────────────────
      case 'event_contacts': {
        if (!p.eventId) return err(400, 'Missing parameter: eventId');

        // Step 1: get contact IDs from CRM associations
        const assocRes = await fetch(
          `${BASE}/crm/v3/objects/marketing_events/${encodeURIComponent(p.eventId)}/associations/contacts`,
          { headers: hdrs }
        );
        if (!assocRes.ok) {
          return json({ results: [], total: 0, _note: `Assoc API ${assocRes.status}` });
        }
        const assocData = await assocRes.json();
        const ids = (assocData.results || []).map(a => a.id).filter(Boolean);
        if (ids.length === 0) return json({ results: [], total: 0 });

        // Step 2: batch read contact details
        const batchRes = await fetch(`${BASE}/crm/v3/objects/contacts/batch/read`, {
          method: 'POST',
          headers: hdrs,
          body: JSON.stringify({
            inputs: ids.map(id => ({ id: String(id) })),
            properties: ['firstname', 'lastname', 'email', 'company', 'phone', 'createdate']
          })
        });
        return proxy(batchRes);
      }

      default:
        return err(400, `Unknown action: "${p.action}". Valid: ping, events, event_contacts`);
    }
  } catch (e) {
    return err(502, `Function error: ${e.message}`);
  }
};

async function proxy(res) {
  const body = await res.text();
  return { statusCode: res.status, headers: cors(), body };
}
function json(data) {
  return { statusCode: 200, headers: cors(), body: JSON.stringify(data) };
}
function cors() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-cache'
  };
}
function err(status, message) {
  return { statusCode: status, headers: cors(), body: JSON.stringify({ error: message }) };
}
