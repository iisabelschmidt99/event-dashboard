-- Rechnungs-PDFs: Datei-Referenz auf costs + privater Storage-Bucket
-- Sicher additiv.

ALTER TABLE costs ADD COLUMN IF NOT EXISTS file_path text;
ALTER TABLE costs ADD COLUMN IF NOT EXISTS file_name text;

-- Privater Storage-Bucket "invoices" für hochgeladene Rechnungen.
-- (Falls bereits vorhanden, passiert nichts.)
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoices', 'invoices', false)
ON CONFLICT (id) DO NOTHING;

-- Hinweis: Zugriff erfolgt ausschließlich über die Netlify-Function mit dem
-- Service-Role-Key (signierte URLs). Es werden bewusst KEINE öffentlichen
-- RLS-Policies für anon/authenticated gesetzt.
