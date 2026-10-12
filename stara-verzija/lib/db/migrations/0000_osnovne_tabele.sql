-- Основне табеле: налози и покушаји.
--
-- Све миграције су идемпотентне (IF NOT EXISTS) и не зависе од редоследа:
-- пуштају се при сваком деплоју, а база на серверу и развојна база не морају
-- бити у истом стању.
--
-- Лозинка се чува само као хеш. Апликација за српски је држала и читљиву
-- копију (`password_plain`) да би је наставник видео у админ панелу; ученици
-- су малолетни, па је овде нема — наставник лозинку поставља изнова.

CREATE TABLE IF NOT EXISTS quiz_users (
  id serial PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL DEFAULT 'student',
  active boolean NOT NULL DEFAULT true,
  never_expires boolean NOT NULL DEFAULT true,
  quiz_once boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES quiz_users (id) ON DELETE CASCADE,
  score integer NOT NULL,
  total integer NOT NULL,
  percentage integer NOT NULL,
  passed boolean NOT NULL,
  answers jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
