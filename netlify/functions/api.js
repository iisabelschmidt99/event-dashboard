// FENYX Event-Dashboard — Supabase API
// GET/POST/PUT/DELETE /.netlify/functions/api?resource=...

const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  if (!SB_URL || !SB_KEY) {
    return json(500, {
      error: 'SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY nicht gesetzt. Netlify → Environment variables → Redeploy.'
    });
  }

  const p = event.queryStringParameters || {};
  const resource = p.resource || '';

  try {
    if (event.httpMethod === 'GET' && resource === 'ping') {
      return json(200, { ok: true, hasSupabase: true, ts: new Date().toISOString() });
    }

    if (resource === 'budgets') {
      if (event.httpMethod === 'GET') return await getBudgets(p.event_id);
      if (event.httpMethod === 'PUT') return await putBudget(JSON.parse(event.body || '{}'));
    }

    if (resource === 'budget_items') {
      if (event.httpMethod === 'GET') return await getBudgetItems(p.event_id);
      if (event.httpMethod === 'POST') return await postBudgetItem(JSON.parse(event.body || '{}'));
      if (event.httpMethod === 'DELETE') return await deleteBudgetItem(p.id);
    }

    if (resource === 'events' && event.httpMethod === 'POST') {
      return await upsertEvents(JSON.parse(event.body || '{}'));
    }

    if (resource === 'costs') {
      if (event.httpMethod === 'GET') return await getCosts(p.event_id);
      if (event.httpMethod === 'POST') return await postCost(JSON.parse(event.body || '{}'));
      if (event.httpMethod === 'PUT') return await putCost(JSON.parse(event.body || '{}'));
      if (event.httpMethod === 'DELETE') return await deleteCost(p.id);
    }

    if (resource === 'leads') {
      if (event.httpMethod === 'GET') return await getLeads(p.event_id);
      if (event.httpMethod === 'POST') return await postLead(JSON.parse(event.body || '{}'));
      if (event.httpMethod === 'PUT') return await putLead(JSON.parse(event.body || '{}'));
      if (event.httpMethod === 'DELETE') return await deleteLead(p.id);
    }

    return json(400, { error: `Unbekannte resource/method: ${resource} ${event.httpMethod}` });
  } catch (e) {
    return json(502, { error: e.message });
  }
};

async function sb(path, opts = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: opts.method || 'GET',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: opts.prefer || 'return=representation',
      ...opts.headers
    },
    body: opts.body
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.message || data?.error || data?.hint || text || res.statusText;
    throw new Error(msg);
  }
  return data;
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    body: JSON.stringify(body)
  };
}

async function ensureEvent(eventId, meta = {}) {
  if (!eventId) throw new Error('event_id fehlt');
  await sb('events?on_conflict=id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: JSON.stringify({
      id: String(eventId),
      name: meta.name || '',
      event_type: meta.event_type || meta.type || '',
      description: meta.description || meta.desc || '',
      event_date: meta.event_date || meta.date || null,
      status: meta.status || 'upcoming',
      registrants: meta.registrants ?? meta.regs ?? 0,
      attendees: meta.attendees ?? 0,
      cancellations: meta.cancellations ?? 0,
      no_shows: meta.no_shows ?? 0,
      organizer: meta.organizer || meta.org || '',
      synced_at: new Date().toISOString()
    })
  });
}

async function upsertEvents(body) {
  const events = body.events || [];
  if (!events.length) return json(400, { error: 'events Array fehlt' });
  const rows = events.map(e => ({
    id: String(e.id),
    name: e.name || '',
    event_type: e.type || '',
    description: e.desc || '',
    event_date: e.date || null,
    status: e.status || 'upcoming',
    registrants: parseInt(e.regs || 0),
    attendees: parseInt(e.attendees || 0),
    cancellations: parseInt(e.cancellations || 0),
    no_shows: parseInt(e.noShows || 0),
    organizer: e.org || '',
    synced_at: new Date().toISOString()
  }));
  await sb('events?on_conflict=id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: JSON.stringify(rows)
  });
  return json(200, { ok: true, count: rows.length });
}

function mapBudgetItem(row) {
  return {
    id: row.id,
    bezeichnung: row.label,
    kategorie: row.category,
    betrag: parseFloat(row.amount) || 0,
    notiz: row.note || ''
  };
}

async function getBudgets(eventId) {
  const budgets = await sb('budgets?select=event_id,total_amount');
  const itemsQ = eventId
    ? `budget_items?select=*&event_id=eq.${encodeURIComponent(eventId)}&order=created_at.asc`
    : 'budget_items?select=*&order=created_at.asc';
  const items = await sb(itemsQ);
  const totals = {};
  (budgets || []).forEach(b => { totals[b.event_id] = parseFloat(b.total_amount) || 0; });
  const byEvent = {};
  (items || []).forEach(row => {
    if (!byEvent[row.event_id]) byEvent[row.event_id] = [];
    byEvent[row.event_id].push(mapBudgetItem(row));
  });
  return json(200, { totals, items: byEvent });
}

async function putBudget(body) {
  const eventId = body.event_id || body.eventId;
  const amount = parseFloat(body.total_amount ?? body.amount ?? 0) || 0;
  await ensureEvent(eventId, body.event || {});
  const rows = await sb('budgets?on_conflict=event_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: JSON.stringify({ event_id: String(eventId), total_amount: amount, updated_at: new Date().toISOString() })
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  return json(200, { event_id: row.event_id, total_amount: parseFloat(row.total_amount) || 0 });
}

async function getBudgetItems(eventId) {
  if (!eventId) return json(400, { error: 'event_id fehlt' });
  const rows = await sb(`budget_items?select=*&event_id=eq.${encodeURIComponent(eventId)}&order=created_at.asc`);
  return json(200, { results: (rows || []).map(mapBudgetItem) });
}

async function postBudgetItem(body) {
  const eventId = body.event_id || body.eventId;
  await ensureEvent(eventId, body.event || {});
  const rows = await sb('budget_items', {
    method: 'POST',
    body: JSON.stringify({
      event_id: String(eventId),
      label: body.bezeichnung || body.label || '',
      category: body.kategorie || body.category || 'location',
      amount: parseFloat(body.betrag ?? body.amount ?? 0) || 0,
      note: body.notiz || body.note || ''
    })
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  return json(201, mapBudgetItem(row));
}

async function deleteBudgetItem(id) {
  if (!id) return json(400, { error: 'id fehlt' });
  await sb(`budget_items?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', prefer: 'return=minimal' });
  return json(200, { ok: true });
}

function mapCost(row) {
  return {
    id: row.id,
    n: row.label,
    a: parseFloat(row.amount) || 0,
    cat: row.category,
    s: row.status,
    d: row.cost_date || ''
  };
}

async function getCosts(eventId) {
  const q = eventId
    ? `costs?select=*&event_id=eq.${encodeURIComponent(eventId)}&order=created_at.desc`
    : 'costs?select=*&order=created_at.desc';
  const rows = await sb(q);
  const byEvent = {};
  (rows || []).forEach(row => {
    if (!byEvent[row.event_id]) byEvent[row.event_id] = [];
    byEvent[row.event_id].push(mapCost(row));
  });
  return json(200, { byEvent });
}

async function postCost(body) {
  const eventId = body.event_id || body.eventId;
  await ensureEvent(eventId, body.event || {});
  const rows = await sb('costs', {
    method: 'POST',
    body: JSON.stringify({
      event_id: String(eventId),
      label: body.n || body.label || '',
      amount: parseFloat(body.a ?? body.amount ?? 0) || 0,
      category: body.cat || body.category || 'location',
      status: body.s || body.status || 'Angebot',
      cost_date: body.d || body.cost_date || null,
      source_note: body.source_note || body.notiz || ''
    })
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  return json(201, mapCost(row));
}

async function putCost(body) {
  if (!body.id) return json(400, { error: 'id fehlt' });
  const rows = await sb(`costs?id=eq.${encodeURIComponent(body.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      label: body.n || body.label,
      amount: body.a != null ? parseFloat(body.a) : body.amount,
      category: body.cat || body.category,
      status: body.s || body.status,
      cost_date: body.d || body.cost_date
    })
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  return json(200, mapCost(row));
}

async function deleteCost(id) {
  if (!id) return json(400, { error: 'id fehlt' });
  await sb(`costs?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', prefer: 'return=minimal' });
  return json(200, { ok: true });
}

function mapLead(row) {
  return {
    id: row.id,
    ct: row.contact_name,
    co: row.company,
    em: row.email,
    ph: row.phone,
    v: parseFloat(row.deal_value) || 0,
    st: row.stage,
    ow: row.owner,
    note: row.note,
    date: row.lead_date || ''
  };
}

async function getLeads(eventId) {
  const q = eventId
    ? `leads?select=*&event_id=eq.${encodeURIComponent(eventId)}&order=created_at.desc`
    : 'leads?select=*&order=created_at.desc';
  const rows = await sb(q);
  const byEvent = {};
  (rows || []).forEach(row => {
    if (!byEvent[row.event_id]) byEvent[row.event_id] = [];
    byEvent[row.event_id].push(mapLead(row));
  });
  return json(200, { byEvent });
}

async function postLead(body) {
  const eventId = body.event_id || body.eventId;
  await ensureEvent(eventId, body.event || {});
  const rows = await sb('leads', {
    method: 'POST',
    body: JSON.stringify({
      event_id: String(eventId),
      contact_name: body.ct || body.contact_name || '',
      company: body.co || body.company || '',
      email: body.em || body.email || '',
      phone: body.ph || body.phone || '',
      deal_value: parseFloat(body.v ?? body.deal_value ?? 0) || 0,
      stage: body.st || body.stage || 'qualified',
      owner: body.ow || body.owner || '',
      note: body.note || '',
      lead_date: body.date || body.lead_date || new Date().toISOString().slice(0, 10)
    })
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  return json(201, mapLead(row));
}

async function putLead(body) {
  if (!body.id) return json(400, { error: 'id fehlt' });
  const eventId = body.event_id || body.eventId;
  if (eventId) await ensureEvent(eventId, body.event || {});
  const patch = {
    contact_name: body.ct || body.contact_name,
    company: body.co || body.company,
    email: body.em || body.email,
    phone: body.ph || body.phone,
    deal_value: body.v != null ? parseFloat(body.v) : body.deal_value,
    stage: body.st || body.stage,
    owner: body.ow || body.owner,
    note: body.note,
    lead_date: body.date || body.lead_date
  };
  if (eventId) patch.event_id = String(eventId);
  const rows = await sb(`leads?id=eq.${encodeURIComponent(body.id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  return json(200, mapLead(row));
}

async function deleteLead(id) {
  if (!id) return json(400, { error: 'id fehlt' });
  await sb(`leads?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', prefer: 'return=minimal' });
  return json(200, { ok: true });
}
