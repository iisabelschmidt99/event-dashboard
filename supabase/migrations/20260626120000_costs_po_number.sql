-- Kostenpositionen: PO-Nummer (aus HubSpot Deal-Property "ponummer")
-- Sicher additiv: bestehende Views/Grants bleiben unberührt.

ALTER TABLE costs ADD COLUMN IF NOT EXISTS po_number text;

-- Optional für Power BI: v_costs_flat um po_number erweitern.
-- CREATE OR REPLACE hängt neue Spalten am Ende an und bricht bestehende
-- Spalten/Grants nicht, solange Name/Reihenfolge der alten Spalten gleich bleibt.
-- Falls die View-Definition abweicht, diesen Block überspringen und die View
-- separat anpassen.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_costs_flat') THEN
    BEGIN
      EXECUTE $v$
        CREATE OR REPLACE VIEW v_costs_flat AS
        SELECT
          c.id,
          c.event_id,
          e.name        AS event_name,
          e.event_type,
          e.event_date,
          c.label,
          c.category,
          c.amount,
          c.status,
          c.cost_date,
          c.source_note,
          c.created_at,
          c.po_number
        FROM costs c
        JOIN events e ON e.id = c.event_id
      $v$;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'v_costs_flat nicht automatisch aktualisiert: %', SQLERRM;
    END;
  END IF;
END
$$;
