-- Angebots-PDFs: Datei-Referenz auf budget_items (gleicher Storage-Bucket 'invoices')
-- Sicher additiv.

ALTER TABLE budget_items ADD COLUMN IF NOT EXISTS file_path text;
ALTER TABLE budget_items ADD COLUMN IF NOT EXISTS file_name text;
