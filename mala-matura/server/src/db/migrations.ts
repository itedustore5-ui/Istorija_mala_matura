/**
 * Миграције базе, редом. Свака је идемпотентна (IF NOT EXISTS): пушта се при
 * сваком покретању сервера и seed-а, а база на хостингу и развојна база не
 * морају бити у истом стању.
 *
 * SQL стоји у TypeScript-у, а не у .sql фајловима, јер `tsc` при изградњи не
 * копира .sql фајлове у `dist` — сервер би у продукцији остао без табела.
 *
 * У самом SQL-у нема ћирилице (ни у коментарима): локални Postgres на Windows-у
 * често је направљен са кодирањем WIN1252 и тада одбија ћирилички текст у
 * наредби („report_untranslatable_char“), пре него што ишта направи.
 *
 * Нова миграција иде на крај низа; постојеће се не мењају.
 */
export const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "0001_osnovne_tabele",
    sql: `
CREATE TABLE IF NOT EXISTS subjects (
  id text PRIMARY KEY,
  name text NOT NULL,
  source text,
  position integer NOT NULL DEFAULT 0,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS questions (
  id serial PRIMARY KEY,
  subject_id text NOT NULL REFERENCES subjects (id),
  number integer NOT NULL,
  section text NOT NULL,
  type text NOT NULL,
  prompt text NOT NULL,
  content jsonb NOT NULL,
  correct jsonb NOT NULL,
  explanation text NOT NULL DEFAULT '',
  points integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT questions_subject_number UNIQUE (subject_id, number)
);

CREATE TABLE IF NOT EXISTS images (
  name text PRIMARY KEY,
  mime text NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL DEFAULT 'student',
  active boolean NOT NULL DEFAULT true,
  research_id text UNIQUE,
  consent_research boolean NOT NULL DEFAULT false,
  consent_at timestamptz,
  class_group text,
  study_arm text,
  rotation_group integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS study_settings (
  id integer PRIMARY KEY,
  current_phase text,
  test_open boolean NOT NULL DEFAULT false,
  practice_open boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO study_settings (id, current_phase, test_open, practice_open)
VALUES (1, NULL, false, true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS forms (
  subject_id text NOT NULL REFERENCES subjects (id),
  code text NOT NULL,
  question_numbers jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, code)
);

CREATE TABLE IF NOT EXISTS attempts (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES subjects (id),
  kind text NOT NULL,
  section text,
  phase text,
  form text,
  question_ids jsonb NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  duration_ms integer,
  score integer,
  max_score integer,
  client_info jsonb,
  invalidated_at timestamptz,
  invalidated_reason text,
  invalidated_by integer
);

CREATE INDEX IF NOT EXISTS attempts_user_idx ON attempts (user_id, subject_id, kind);

CREATE TABLE IF NOT EXISTS attempt_items (
  id serial PRIMARY KEY,
  attempt_id integer NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
  question_id integer NOT NULL REFERENCES questions (id),
  question_version integer NOT NULL,
  position integer NOT NULL,
  answer jsonb,
  is_correct boolean,
  points integer,
  time_ms integer,
  changes integer NOT NULL DEFAULT 0,
  answered_at timestamptz,
  submitted boolean NOT NULL DEFAULT false,
  CONSTRAINT attempt_items_attempt_question UNIQUE (attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  attempt_id integer REFERENCES attempts (id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  question_id integer,
  type text NOT NULL,
  at timestamptz NOT NULL,
  value jsonb
);

CREATE INDEX IF NOT EXISTS events_attempt_idx ON events (attempt_id);
`,
  },
  {
    // Tests from past final exams (2023-2026): separate question sets used as
    // study forms. Their questions live in the same table, marked by test_key,
    // and are numbered 1-20 inside each test - hence the new unique index.
    // Official scoring gives 0.5 points in some tables, so earned points are
    // no longer integers.
    name: "0002_zavrsni_testovi",
    sql: `
CREATE TABLE IF NOT EXISTS tests (
  key text PRIMARY KEY,
  subject_id text NOT NULL REFERENCES subjects (id),
  year integer NOT NULL,
  label text NOT NULL,
  term text,
  duration_minutes integer,
  source text,
  position integer NOT NULL DEFAULT 0
);

ALTER TABLE questions ADD COLUMN IF NOT EXISTS test_key text REFERENCES tests (key);
ALTER TABLE questions ADD COLUMN IF NOT EXISTS partial_credit jsonb;
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_subject_number;
CREATE UNIQUE INDEX IF NOT EXISTS questions_subject_test_number
  ON questions (subject_id, (coalesce(test_key, '')), number);

ALTER TABLE forms ADD COLUMN IF NOT EXISTS test_key text REFERENCES tests (key);

ALTER TABLE attempt_items ALTER COLUMN points TYPE double precision;
ALTER TABLE attempts ALTER COLUMN score TYPE double precision;
`,
  },
];
