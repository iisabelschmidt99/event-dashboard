-- Übergeordnete Ebene über dem Event-Dashboard:
--   agenda_items = Termine, die NICHT aus HubSpot kommen (Pitches, Netzwerktreffen, Messen)
--   tasks        = To-dos, optional an einen Termin oder ein HubSpot-Event gehängt
--
-- Rein additiv. Bestehende Tabellen (events, budgets, budget_items, costs, leads)
-- werden nicht angefasst.
--
-- RLS: bewusst aktiviert OHNE Policies — exakt wie bei den bestehenden Tabellen.
-- Der gesamte Zugriff läuft über netlify/functions/api.js mit dem Service-Role-Key.
-- Keine anon-Policies: der anon-Key liegt sonst im ausgelieferten HTML und würde
-- die Tabellen für jeden öffnen, der die Seite aufruft.

-- ── agenda_items ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agenda_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text NOT NULL,
  kind                text NOT NULL DEFAULT 'sonstiges'
                        CHECK (kind IN ('pitch','netzwerk','messe','webinar','intern','sonstiges')),
  status              text NOT NULL DEFAULT 'geplant'
                        CHECK (status IN ('geplant','angemeldet','bestaetigt','abgesagt','erledigt')),
  item_date           date,
  -- true = Datum ist ein Platzhalter und muss noch bestätigt werden
  date_is_provisional boolean NOT NULL DEFAULT false,
  start_time          time,
  location            text NOT NULL DEFAULT '',
  organizer           text NOT NULL DEFAULT '',
  note                text NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agenda_items_date_idx ON agenda_items (item_date);

ALTER TABLE agenda_items ENABLE ROW LEVEL SECURITY;

-- ── tasks ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label          text NOT NULL,
  due_date       date,
  done           boolean NOT NULL DEFAULT false,
  priority       text NOT NULL DEFAULT 'normal'
                   CHECK (priority IN ('hoch','normal','niedrig')),
  note           text NOT NULL DEFAULT '',
  -- höchstens eine der beiden Verknüpfungen; beide NULL = freistehendes To-do
  agenda_item_id uuid REFERENCES agenda_items(id) ON DELETE CASCADE,
  event_id       text REFERENCES events(id)       ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_single_link CHECK (agenda_item_id IS NULL OR event_id IS NULL)
);

CREATE INDEX IF NOT EXISTS tasks_due_idx         ON tasks (due_date);
CREATE INDEX IF NOT EXISTS tasks_agenda_item_idx ON tasks (agenda_item_id);
CREATE INDEX IF NOT EXISTS tasks_event_idx       ON tasks (event_id);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- ── Seed: reale Termine und To-dos ──────────────────────────────────────────
-- Idempotent über den Titel, damit ein zweiter Lauf nichts dupliziert.

INSERT INTO agenda_items (title, kind, status, item_date, date_is_provisional, start_time, location, organizer, note)
SELECT 'ReOffice Netzwerktreffen', 'netzwerk', 'geplant', DATE '2026-10-01', true, NULL,
       'RB Leipzig', 'CADEMI / Christof Flötotto',
       'Offiziell kommuniziert ist nur "Anfang Oktober" — Datum ist ein Platzhalter und muss bestätigt werden.'
WHERE NOT EXISTS (SELECT 1 FROM agenda_items WHERE title = 'ReOffice Netzwerktreffen');

INSERT INTO agenda_items (title, kind, status, item_date, date_is_provisional, start_time, location, organizer, note)
SELECT 'Marktaustausch zirkuläre Möbel – Pitchveranstaltung', 'pitch', 'geplant', DATE '2026-10-14', false, TIME '10:00',
       'online (WebEx)', 'Landeshauptstädte München und Stuttgart',
       '5-Minuten-Pitch plus 5 Minuten Rückfragen.'
WHERE NOT EXISTS (SELECT 1 FROM agenda_items WHERE title = 'Marktaustausch zirkuläre Möbel – Pitchveranstaltung');

INSERT INTO tasks (label, due_date, priority, note, agenda_item_id)
SELECT s.label, s.due_date, s.priority, s.note,
       (SELECT id FROM agenda_items WHERE title = s.link_title)
FROM (VALUES
  ('Telefonat mit Christof Flötotto',                    DATE '2026-09-08', 'hoch',   '',
     'ReOffice Netzwerktreffen'),
  ('Marketing-Events-Übersicht mit Lennart durchgehen',  DATE '2026-09-10', 'hoch',   '',
     NULL),
  ('Termin Leipzig bestätigen lassen',                   DATE '2026-09-11', 'hoch',   'Datum steht nur als "Anfang Oktober" fest.',
     'ReOffice Netzwerktreffen'),
  ('Feedback zu Kapitel 7 der ReOffice-Antragsskizze',   DATE '2026-09-22', 'normal', '',
     NULL),
  ('Anmeldung Pitchveranstaltung absenden',              DATE '2026-10-07', 'hoch',   'Frist geschätzt, nicht offiziell kommuniziert.',
     'Marktaustausch zirkuläre Möbel – Pitchveranstaltung'),
  ('Pitch-Slot anfragen und Pitch bauen',                DATE '2026-10-09', 'hoch',   '',
     'Marktaustausch zirkuläre Möbel – Pitchveranstaltung'),
  ('KMU-innovativ als Förderalternative prüfen',         DATE '2026-10-15', 'normal', 'Offizieller Stichtag. Hintergrund: ZIM-Antragsstopp seit 07.07.2026, ReOffice Phase 1 endet 31.12.2026, Förderlücke ab 2027 wahrscheinlich.',
     NULL)
) AS s(label, due_date, priority, note, link_title)
WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.label = s.label);
