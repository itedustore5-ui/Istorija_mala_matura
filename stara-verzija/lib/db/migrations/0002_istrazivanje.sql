-- Апликација као инструмент истраживања.
--
-- Уз улогу алата за учење, апликација треба да мери ретенцију знања кроз више
-- тачака у времену (T0 → вежбање → T30 → T90). Ове табеле и колоне носе тај
-- други део: ко је испитаник, у којој је грани и ротацији, у којој је фази
-- покушај предат и — што је најважније за анализу — шта је одговорено на
-- сваком појединачном задатку.
--
-- Миграција је идемпотентна и не зависи од редоследа (IF NOT EXISTS), јер се
-- пушта ручно, са размаком од недеља.

-- ── Испитаник ──────────────────────────────────────────────────────────────
-- Псеудоним постоји да име ученика никад не изађе у извоз. Кључ за повезивање
-- псеудонима са именом остаје у бази, одвојено од извезених података.
ALTER TABLE quiz_users ADD COLUMN IF NOT EXISTS research_id text;
ALTER TABLE quiz_users ADD COLUMN IF NOT EXISTS consent_research boolean NOT NULL DEFAULT false;
ALTER TABLE quiz_users ADD COLUMN IF NOT EXISTS class_group text;

-- „eksperimentalna“ | „kontrolna“ | NULL (није у студији).
-- Контролна грана не добија вежбање — иначе обе гране имају исти третман и
-- поређење нестаје.
ALTER TABLE quiz_users ADD COLUMN IF NOT EXISTS study_arm text;

-- 1 | 2 | 3 — одређује којим редом испитаник добија форме кроз фазе, да се
-- тежина теста не помеша са фазом (латински квадрат).
ALTER TABLE quiz_users ADD COLUMN IF NOT EXISTS rotation_group integer;

CREATE UNIQUE INDEX IF NOT EXISTS quiz_users_research_id_idx
  ON quiz_users (research_id)
  WHERE research_id IS NOT NULL;

-- ── Покушај ────────────────────────────────────────────────────────────────
-- Фазу и форму уписује сервер, никад клијент: иначе би испитаник свој рад
-- прогласио којом хоће фазом.
ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS phase text;
ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS form text;
ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS duration_ms integer;

-- Подаци о уређају колико треба за тумачење (нпр. да ли је мобилни).
-- IP адреса се не бележи.
ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS client_info jsonb;

-- Поништавање покушаја: некоме ће пући веза или затворити прозор. Покушај се
-- не брише него означава, да се у извозу види да је поништен и зашто.
ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS invalidated_at timestamptz;
ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS invalidated_by integer;
ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS invalidated_reason text;

CREATE INDEX IF NOT EXISTS quiz_attempts_phase_idx
  ON quiz_attempts (phase)
  WHERE phase IS NOT NULL;

-- ── Резултат по задатку ────────────────────────────────────────────────────
-- Један ред = један задатак у једном покушају.
--
-- Из покушаја се зна КОЛИКО је неко знао; одавде се зна ШТА је знао — а то је
-- оно што се анализира: тежина сваке ставке, дискриминативност, поређење
-- типова задатака и, пре свега, шта је заборављено између два мерења.
-- Ова табела се накнадно не може реконструисати.
CREATE TABLE IF NOT EXISTS attempt_items (
  id serial PRIMARY KEY,
  attempt_id integer NOT NULL REFERENCES quiz_attempts (id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES quiz_users (id) ON DELETE CASCADE,

  question_id integer NOT NULL,
  question_type text NOT NULL,

  -- Целина збирке („241-260“…); за задатке теста са завршног испита стоји
  -- кључ текста уз који иду.
  block text,
  text_key text,

  answer_raw text NOT NULL,
  is_correct boolean NOT NULL,

  -- Поени по правилима правог испита; за вежбање остају NULL.
  points_earned numeric(6, 2),
  points_max numeric(6, 2),

  -- Дуго задржавање уз тачан одговор значи несигурно знање, и такве ставке
  -- прве „падну“ на каснијем мерењу.
  time_spent_ms integer,
  position integer
);

CREATE INDEX IF NOT EXISTS attempt_items_attempt_idx ON attempt_items (attempt_id);
CREATE INDEX IF NOT EXISTS attempt_items_question_idx ON attempt_items (question_id);

-- ── Подешавања студије ─────────────────────────────────────────────────────
-- Један ред (id = 1). Истраживач поставља текућу фазу и отвара термин; сервер
-- тиме означава сваки предати рад. Један прекидач, без ручног уноса по
-- испитанику.
CREATE TABLE IF NOT EXISTS study_settings (
  id integer PRIMARY KEY,
  current_phase text,
  exam_open boolean NOT NULL DEFAULT false,
  practice_open boolean NOT NULL DEFAULT true,

  -- Које су три паралелне форме у употреби. Стоје у бази, а не у коду, да се
  -- нов тест може пустити без измене кода — али се, кад мерење почне, више не
  -- смеју мењати: иначе групе не пролазе кроз исти скуп и стари подаци се не
  -- могу поправити.
  form_a_exam text,
  form_b_exam text,
  form_c_exam text,

  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer
);

INSERT INTO study_settings (id, current_phase, exam_open, practice_open)
VALUES (1, NULL, false, true)
ON CONFLICT (id) DO NOTHING;
