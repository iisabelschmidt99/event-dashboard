# FENYX Event-Dashboard — Power BI Anbindung

Diese Anleitung bereitet die spätere Power-BI-Integration vor.  
**Wichtig:** Power BI nutzt **keine REST-API** vom Dashboard oder Netlify. Es verbindet sich **direkt mit der PostgreSQL-Datenbank** in Supabase.

---

## Architektur (Datenfluss)

```
Dashboard (Netlify)          Power BI Desktop / Service
       │                              │
       ▼                              ▼
  api.js (schreibt)            PostgreSQL-Connector (liest)
       │                              │
       └──────────► Supabase DB ◄────┘
                    (marketing-events)
```

| System | Rolle | Verbindungstyp |
|--------|-------|----------------|
| **Dashboard** | Schreibt Budget, Kosten, Leads | Netlify `api.js` → Supabase REST API |
| **HubSpot** | Events & Teilnehmer (live) | Netlify `hubspot.js` → HubSpot API |
| **Power BI** | Liest nur Reporting-Daten | **PostgreSQL** → Supabase DB |

Power BI braucht **keinen** `SUPABASE_SERVICE_ROLE_KEY` und **keine** Netlify-URLs.

---

## Was du brauchst (Checkliste)

### Aus Supabase (Project: `marketing-events`)

| Information | Wo finden | Wert (Beispiel) |
|-------------|-----------|-----------------|
| **Host** | Project Settings → Database → Host | `db.wngaghisnllcpwcxqths.supabase.co` |
| **Port** | Database → Connection string | `5432` (Direct) oder `6543` (Pooler) |
| **Database** | Connection string | `postgres` |
| **User** | Connection string | `postgres` oder `powerbi_readonly` (empfohlen) |
| **Password** | Database → Database password | *(nur in Supabase sichtbar)* |
| **SSL** | Immer aktivieren | `Require` / `sslmode=require` |

**Project URL** (`https://wngaghisnllcpwcxqths.supabase.co`) ist nur für das Dashboard — **nicht** für Power BI.

### Software

- **Power BI Desktop** (lokal bauen & testen)
- Optional: **Power BI Pro** / Premium für geplanten Refresh in der Cloud

### Kein Gateway nötig

Supabase liegt in der Cloud (EU). Power BI Service kann direkt verbinden — kein On-Premises Data Gateway für Postgres in der Cloud.

---

## Read-only User einrichten (empfohlen)

In Supabase → **SQL Editor** ausführen:

```sql
ALTER ROLE powerbi_readonly WITH PASSWORD 'DEIN_SICHERES_PASSWORT';
```

Die Rolle `powerbi_readonly` existiert bereits (Migration angewendet). Sie darf **nur lesen** auf den Reporting-Views.

> Nicht den `service_role`-Key oder das `postgres`-Superuser-Passwort in Power BI teilen, wenn es vermeidbar ist.

---

## Verbindung in Power BI Desktop

1. **Daten abrufen** → **PostgreSQL-Datenbank**
2. Eingaben:

| Feld | Wert |
|------|------|
| Server | `db.wngaghisnllcpwcxqths.supabase.co` |
| Database | `postgres` |
| Data Connectivity mode | **Import** (einfacher Start) oder **DirectQuery** (live) |

3. Erweiterte Optionen → **SSL**: aktivieren  
4. Anmeldedaten: `powerbi_readonly` + Passwort  
5. Navigator: **nur diese Views** auswählen (nicht die Roh-Tabellen nötig):

---

## Reporting-Views (deine „Endpunkte“)

Power BI liest **SQL Views** — das sind die vorbereiteten Datenquellen:

### `v_event_financials` — **Haupt-Übersicht pro Event**

Für Portfolio-Dashboards, KPI-Karten, Event-Vergleich.

| Spalte | Bedeutung |
|--------|-----------|
| `event_id` | HubSpot Event-ID |
| `event_name` | z.B. `Düsseldorf \| HR \| #2026-01-D-HR` |
| `event_type` | Zielgruppe |
| `event_date` | Event-Datum |
| `status` | upcoming / completed / … |
| `budget_total` | Gesamtbudget (€) |
| `budget_planned` | Summe Budgetpositionen (€) |
| `costs_actual` | Summe aller Kosten (€) |
| `costs_paid` | Davon bezahlt (€) |
| `lead_count` | Anzahl Leads |
| `won_deal_value` | Deal-Wert gewonnener Leads (€) |

**Abgeleitete KPIs in Power BI:**  
`ROI = (won_deal_value - costs_actual) / costs_actual`  
`Budget-Auslastung = costs_actual / budget_total`

---

### `v_costs_flat` — **Einzelne Rechnungen / Kostenpositionen**

Für Detail-Tabellen, Kosten nach Kategorie, PDF-Import-Nachweis.

| Spalte | Bedeutung |
|--------|-----------|
| `id` | UUID |
| `event_id` / `event_name` / `event_date` | Event-Zuordnung |
| `label` | Positionsbezeichnung |
| `amount` | Betrag (€) |
| `category` | location / catering / marketing |
| `status` | Angebot / beauftragt / bezahlt |
| `cost_date` | Rechnungsdatum |
| `source_note` | z.B. `PDF: Rechnung_RE0010.pdf` |
| `created_at` | Zeitstempel Import |

---

### `v_budget_items_flat` — Geplante Budgetpositionen

| Spalte | Bedeutung |
|--------|-----------|
| `label`, `category`, `amount`, `note` | Budgetzeile |
| `event_name`, `event_date` | Event |

---

### `v_leads_flat` — Leads & Deals

| Spalte | Bedeutung |
|--------|-----------|
| `contact_name`, `company`, `email` | Kontakt |
| `deal_value` | Deal-Wert (€) |
| `stage` | qualified / proposal / won / … |
| `owner` | Verantwortlicher |
| `lead_date` | Datum |

---

### `v_events_flat` — Event-Stammdaten (inkl. HubSpot-Metriken)

| Spalte | Bedeutung |
|--------|-----------|
| `registrants`, `attendees`, `cancellations`, `no_shows` | HubSpot-Zahlen |
| `organizer`, `description`, `status` | Meta |

---

## Empfohlenes Power-BI-Modell

```
v_events_flat (1) ──< v_costs_flat (n)
                 ──< v_budget_items_flat (n)
                 ──< v_leads_flat (n)

v_event_financials  ← fertig aggregiert, für Executive Summary
```

**Relation:** `event_id` in allen Detail-Views → `event_id` in `v_events_flat` / `v_event_financials`

---

## Refresh-Strategie

| Modus | Wann nutzen |
|-------|-------------|
| **Import** | Täglicher/stündlicher Scheduled Refresh in Power BI Service |
| **DirectQuery** | Immer aktuelle DB-Daten (langsamer, DB unter Last) |

Nach jedem Rechnungs-Upload im Dashboard → in Power BI **Daten aktualisieren** (oder warten auf Schedule).

---

## Was Power BI **nicht** bekommt (bewusst)

| Daten | Quelle | Warum nicht in DB |
|-------|--------|-------------------|
| Live HubSpot-Teilnehmerliste | HubSpot API | Nur on-demand im Dashboard |
| Eventplanung / Tasks | Noch lokal im Browser | Phase 3 offen |

Teilnehmer-Zahlen (`registrants`, `attendees`) sind in `events` / `v_events_flat` gecacht, wenn das Dashboard Events synced.

---

## REST-API (nur fürs Dashboard — nicht Power BI)

Zur Einordnung — diese URLs sind **nur** für das Web-Dashboard:

| URL | Zweck |
|-----|-------|
| `/.netlify/functions/api?resource=costs` | Kosten schreiben/lesen |
| `/.netlify/functions/api?resource=budgets` | Budget |
| `/.netlify/functions/api?resource=leads` | Leads |
| `/.netlify/functions/hubspot?action=events` | HubSpot Events |

Power BI ignoriert diese komplett.

---

## Verbindung testen (ohne Power BI)

```bash
# Mit gesetztem .env — prüft ob Daten in Views ankommen
node scripts/test-invoice-flow.mjs
```

Oder in Supabase SQL Editor:

```sql
SELECT * FROM v_costs_flat ORDER BY created_at DESC LIMIT 10;
SELECT * FROM v_event_financials ORDER BY event_date;
```

---

## Nächste Schritte (wenn du Power BI fertigstellst)

1. [ ] Passwort für `powerbi_readonly` in Supabase setzen  
2. [ ] Power BI Desktop → PostgreSQL verbinden (SSL an)  
3. [ ] Views laden, `event_id`-Relationen setzen  
4. [ ] Report bauen (Kosten nach Event, Kategorie, Status)  
5. [ ] In Power BI Service publishen + Refresh-Schedule (z.B. täglich 6:00)  
6. [ ] Optional: Workspace mit FENYX-Team teilen  

---

## Referenz: Supabase-Projekt

| | |
|---|---|
| Projektname | marketing-events |
| Project Ref | `wngaghisnllcpwcxqths` |
| Region | EU |
| DB Host | `db.wngaghisnllcpwcxqths.supabase.co` |
