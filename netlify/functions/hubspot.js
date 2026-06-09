// FENYX Event-Dashboard — HubSpot API Proxy
// Netlify Function: /.netlify/functions/hubspot
//
// Query params:
//   action=events                    → alle Marketing Events
//   action=event_contacts&eventId=X  → Kontakte die mit Event X verknüpft sind
//                                      (über CRM Associations + Batch-Read)
//
// Env var required: HUBSPOT_TOKEN (Private App Token)

const BASE = 'https://api.hubapi.com';

exports.handler = async function (event) {
  const token = process.env.HUBSPOT_TOKEN;

  if (!token) {
    return err(500, 'HUBSPOT_TOKEN not configured in Netlify environment variables.');
  }

  const p = event.queryStringParameters || {};
  const hdrs = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  try {
    switch (p.action) {

      // ── All Marketing Events ──────────────────────────────────────────────
      case 'events': {
        const props = [
          'hs_event_name', 'hs_event_type', 'hs_event_description',
          'hs_start_datetime', 'hs_end_datetime', 'hs_event_status_v2',
          'hs_registrations', 'hs_noshows', 'hs_event_organizer', 'hubspot_owner_id'
        ].join(',');
        const url = `${BASE}/crm/v3/objects/marketing_events?properties=${props}&limit=100`;
        const res = await fetch(url, { headers: hdrs });
        return proxy(res);
      }

      // ── Contacts associated with a specific Marketing Event ───────────────
      // Step 1: CRM Associations → get contact IDs linked to this event
      // Step 2: Batch read → get contact details for those IDs
      case 'event_contacts': {
        if (!p.eventId) return err(400, 'Missing parameter: eventId');

        // Step 1 — associations
        const assocUrl = `${BASE}/crm/v3/objects/marketing_events/${encodeURIComponent(p.eventId)}/associations/contacts`;
        const assocRes = await fetch(assocUrl, { headers: hdrs });

        if (!assocRes.ok) {
          // Return empty if no association exists rather than crashing
          return json({ results: [], total: 0, _note: `Associations API: ${assocRes.status}` });
        }

        const assocData = await assocRes.json();
        const contactIds = (assocData.results || []).map(a => a.id || a.toObjectId).filter(Boolean);

        if (contactIds.length === 0) {
          return json({ results: [], total: 0 });
        }

        // Step 2 — batch read contact details
        const batchUrl = `${BASE}/crm/v3/objects/contacts/batch/read`;
        const batchRes = await fetch(batchUrl, {
          method: 'POST',
          headers: hdrs,
          body: JSON.stringify({
            inputs: contactIds.map(id => ({ id: String(id) })),
            properties: ['firstname', 'lastname', 'email', 'company', 'phone', 'createdate', 'hs_lead_status']
          })
        });

        return proxy(batchRes);
      }

      default:
        return err(400, `Unknown action: "${p.action}". Valid: events, event_contacts`);
    }
  } catch (e) {
    return err(502, `HubSpot request failed: ${e.message}`);
  }
};

// ── Helpers ─────────────────────────────────────────────────────────────────

async function proxy(res) {
  const body = await res.text();
  return { statusCode: res.status, headers: corsHeaders(), body };
}

function json(data) {
  return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(data) };
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-cache, no-store'
  };
}

function err(status, message) {
  return { statusCode: status, headers: corsHeaders(), body: JSON.stringify({ error: message }) };
}
