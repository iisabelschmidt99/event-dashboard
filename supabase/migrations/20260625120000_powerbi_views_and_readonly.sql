-- Power BI: zusätzliche flache Views + read-only Rolle

CREATE OR REPLACE VIEW v_budget_items_flat AS
SELECT
  bi.id,
  bi.event_id,
  e.name AS event_name,
  e.event_type,
  e.event_date,
  bi.label,
  bi.category,
  bi.amount,
  bi.note,
  bi.created_at
FROM budget_items bi
JOIN events e ON e.id = bi.event_id;

CREATE OR REPLACE VIEW v_leads_flat AS
SELECT
  l.id,
  l.event_id,
  e.name AS event_name,
  e.event_type,
  e.event_date,
  l.contact_name,
  l.company,
  l.email,
  l.phone,
  l.deal_value,
  l.stage,
  l.owner,
  l.note,
  l.lead_date,
  l.created_at
FROM leads l
JOIN events e ON e.id = l.event_id;

CREATE OR REPLACE VIEW v_events_flat AS
SELECT
  e.id AS event_id,
  e.name AS event_name,
  e.event_type,
  e.description,
  e.event_date,
  e.status,
  e.registrants,
  e.attendees,
  e.cancellations,
  e.no_shows,
  e.organizer,
  e.synced_at,
  e.created_at
FROM events e;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'powerbi_readonly') THEN
    CREATE ROLE powerbi_readonly LOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO powerbi_readonly;
GRANT SELECT ON v_costs_flat TO powerbi_readonly;
GRANT SELECT ON v_event_financials TO powerbi_readonly;
GRANT SELECT ON v_budget_items_flat TO powerbi_readonly;
GRANT SELECT ON v_leads_flat TO powerbi_readonly;
GRANT SELECT ON v_events_flat TO powerbi_readonly;
