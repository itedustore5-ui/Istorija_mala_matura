-- Прилагођавање покушаја структури збирке из историје.
--
-- Збирка задатке историје (241–360) не дели на нивое ни области; вежба се по
-- целинама од по двадесет узастопних бројева („241-260“…). Целину уписује
-- сервер из броја задатка.

ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS exam_key text;
ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS block text;
ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS points_earned numeric(6, 2);
ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS points_total numeric(6, 2);

-- Преглед напретка увек филтрира вежбање по целини, а листа испита по кључу
-- теста. Без индекса ти упити пролазе кроз целу табелу.
CREATE INDEX IF NOT EXISTS quiz_attempts_practice_idx
  ON quiz_attempts (user_id, block)
  WHERE exam_key IS NULL;

CREATE INDEX IF NOT EXISTS quiz_attempts_exam_idx
  ON quiz_attempts (user_id, exam_key)
  WHERE exam_key IS NOT NULL;
