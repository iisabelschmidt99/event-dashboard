#!/usr/bin/env node
/**
 * End-to-end test: PDF-Rechnung → Claude → Supabase → Power-BI-View
 *
 * Usage:
 *   cp .env.example .env   # Keys eintragen
 *   node scripts/test-invoice-flow.mjs
 *   node scripts/test-invoice-flow.mjs --mock   # ohne Claude (festes Ergebnis)
 *
 * Env: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional: EVENT_ID (default: Düsseldorf HR Event vom 18.06.2026)
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PDF = resolve(ROOT, 'Beispiel Rechnugnen/Rechnung_RE0010_18.06.2026.pdf');
const MOCK = process.argv.includes('--mock');
const EVENT_ID = process.env.EVENT_ID || '1229695179966';

// ── .env laden ───────────────────────────────────────────────────────────────
const envPath = resolve(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANTHROPIC = process.env.ANTHROPIC_API_KEY || '';

function fail(msg) {
  console.error('\n❌', msg);
  process.exit(1);
}

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
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.message || data?.hint || text || res.statusText);
  return data;
}

async function extractWithClaude(base64) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: 'Lies diese Rechnung und extrahiere: Lieferant/Firma, Gesamtbetrag in Euro (Zahl), Kategorie (nur "location"/"catering"/"marketing"), kurze Beschreibung (max 5 Wörter), Status (nur "Angebot"/"beauftragt"/"bezahlt"). Antworte NUR mit JSON: {"anbieter":"","betrag":0,"kategorie":"location","beschreibung":"","status":"bezahlt"}' }
        ]
      }]
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || JSON.stringify(data));
  const text = data.content?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Kein JSON in Claude-Antwort: ' + text);
  return JSON.parse(match[0]);
}

const MOCK_DATA = {
  anbieter: 'Balci & Gastronomie Hafen GmbH',
  betrag: 2975,
  kategorie: 'catering',
  beschreibung: 'Raummiete inkl. Catering',
  status: 'bezahlt'
};

async function main() {
  console.log('═'.repeat(60));
  console.log('FENYX — Rechnungs-Flow Test');
  console.log('═'.repeat(60));
  console.log('PDF:   ', PDF);
  console.log('Event: ', EVENT_ID);
  console.log('Modus: ', MOCK ? 'MOCK (ohne Claude)' : 'LIVE (Claude API)');
  console.log('');

  if (!existsSync(PDF)) fail('PDF nicht gefunden: ' + PDF);
  if (!SB_URL || !SB_KEY) fail('SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY in .env setzen');

  // ── Schritt 1: PDF lesen ───────────────────────────────────────────────────
  console.log('1/4 PDF einlesen…');
  const base64 = readFileSync(PDF).toString('base64');
  console.log('    ✓', Math.round(base64.length / 1024), 'KB base64');

  // ── Schritt 2: Claude extrahiert ───────────────────────────────────────────
  console.log('2/4 Daten extrahieren…');
  let extracted;
  if (MOCK) {
    extracted = { ...MOCK_DATA };
    console.log('    ✓ Mock-Daten (erwartetes Ergebnis für RE0010)');
  } else {
    if (!ANTHROPIC) fail('ANTHROPIC_API_KEY fehlt — oder --mock nutzen');
    extracted = await extractWithClaude(base64);
    console.log('    ✓ Claude:', JSON.stringify(extracted, null, 2));
  }

  // ── Schritt 3: Supabase speichern ──────────────────────────────────────────
  console.log('3/4 In Supabase speichern…');
  await sb('events?on_conflict=id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: JSON.stringify({
      id: EVENT_ID,
      name: 'Düsseldorf | HR | #2026-01-D-HR',
      event_type: 'HR / New Work',
      description: 'Bürokonzepte unter Budget-Druck',
      event_date: '2026-06-18',
      status: 'upcoming',
      registrants: 3,
      synced_at: new Date().toISOString()
    })
  });

  const label = `${extracted.beschreibung} (${extracted.anbieter})`;
  const status = ['Angebot', 'beauftragt', 'bezahlt'].includes(extracted.status) ? extracted.status : 'bezahlt';

  const [cost] = await sb('costs', {
    method: 'POST',
    body: JSON.stringify({
      event_id: EVENT_ID,
      label,
      amount: parseFloat(extracted.betrag) || 0,
      category: extracted.kategorie || 'catering',
      status,
      cost_date: '2026-06-18',
      source_note: 'PDF: Rechnung_RE0010_18.06.2026.pdf'
    })
  });
  console.log('    ✓ Cost-ID:', cost.id);
  console.log('    ✓', label, '—', cost.amount, '€');

  // ── Schritt 4: Power-BI-View abfragen ──────────────────────────────────────
  console.log('4/4 Power-BI-Views prüfen…');
  const flat = await sb(
    `v_costs_flat?event_id=eq.${encodeURIComponent(EVENT_ID)}&order=created_at.desc&limit=5&select=*`
  );
  const financials = await sb(
    `v_event_financials?event_id=eq.${encodeURIComponent(EVENT_ID)}&select=*`
  );

  console.log('');
  console.log('─ v_costs_flat (Power BI) ─');
  console.table(flat.map(r => ({
    event: r.event_name,
    position: r.label,
    betrag: r.amount,
    kategorie: r.category,
    status: r.status,
    datum: r.cost_date
  })));

  console.log('─ v_event_financials (Power BI) ─');
  if (financials[0]) {
    const f = financials[0];
    console.log({
      event: f.event_name,
      budget_total: f.budget_total,
      costs_actual: f.costs_actual,
      costs_paid: f.costs_paid,
      lead_count: f.lead_count
    });
  }

  console.log('');
  console.log('✅ Flow erfolgreich: PDF → Supabase → Power-BI-Views');
  console.log('');
  console.log('Power BI: Postgres-Connector → v_costs_flat / v_event_financials');
}

main().catch(e => {
  console.error('\n❌', e.message);
  process.exit(1);
});
