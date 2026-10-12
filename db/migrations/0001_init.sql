-- STORYLOVE: начальная схема. Видео и изображения лежат в R2, здесь только метаданные.
-- Все даты — ISO 8601 UTC (strftime('%Y-%m-%dT%H:%M:%fZ','now')).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- id — SHA-256 от токена сессии: сам токен есть только в cookie администратора.
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT    PRIMARY KEY,
  admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  csrf_token TEXT    NOT NULL,
  user_agent TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_admin   ON sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Неудачные попытки входа: защита от перебора. bucket — 'ip:<адрес>' или 'email:<почта>'.
CREATE TABLE IF NOT EXISTS login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_bucket ON login_attempts(bucket, created_at);

CREATE TABLE IF NOT EXISTS films (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  slug              TEXT    NOT NULL UNIQUE CHECK (slug IN ('econom','basic','premium','ultima')),
  tier_order        INTEGER NOT NULL UNIQUE CHECK (tier_order BETWEEN 1 AND 4),
  title             TEXT    NOT NULL,
  short_description TEXT    NOT NULL DEFAULT '',
  long_description  TEXT    NOT NULL DEFAULT '',
  compare_text      TEXT    NOT NULL DEFAULT '',
  button_label      TEXT    NOT NULL DEFAULT '',
  poster_key        TEXT,
  car_image_key     TEXT,
  active_video_id   TEXT    REFERENCES videos(id) ON DELETE SET NULL,
  is_published      INTEGER NOT NULL DEFAULT 1 CHECK (is_published IN (0,1)),
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Версии видео. object_key неизменяемый и уникальный: замена видео — это новая строка и новый объект.
CREATE TABLE IF NOT EXISTS videos (
  id                TEXT    PRIMARY KEY,
  film_id           INTEGER NOT NULL REFERENCES films(id) ON DELETE RESTRICT,
  object_key        TEXT    NOT NULL UNIQUE,
  original_filename TEXT    NOT NULL,
  size_bytes        INTEGER NOT NULL CHECK (size_bytes > 0),
  mime_type         TEXT    NOT NULL,
  duration_seconds  REAL,
  width             INTEGER,
  height            INTEGER,
  status            TEXT    NOT NULL CHECK (status IN ('ready','active','archived')),
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  published_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_videos_film ON videos(film_id, created_at);
-- У фильма не может быть двух активных версий одновременно: защита от двойной публикации.
CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_one_active ON videos(film_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id                  TEXT    PRIMARY KEY,
  admin_id            INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  film_id             INTEGER NOT NULL REFERENCES films(id) ON DELETE RESTRICT,
  object_key          TEXT    NOT NULL UNIQUE,
  multipart_upload_id TEXT    NOT NULL,
  mode                TEXT    NOT NULL CHECK (mode IN ('presign','binding')),
  file_name           TEXT    NOT NULL,
  file_last_modified  INTEGER NOT NULL,
  mime_type           TEXT    NOT NULL,
  expected_size       INTEGER NOT NULL CHECK (expected_size > 0),
  part_size           INTEGER NOT NULL CHECK (part_size > 0),
  total_parts         INTEGER NOT NULL CHECK (total_parts > 0),
  state               TEXT    NOT NULL DEFAULT 'active'
                      CHECK (state IN ('active','completing','completed','aborted','expired')),
  video_id            TEXT    REFERENCES videos(id) ON DELETE SET NULL,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_admin ON upload_sessions(admin_id, state);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_state ON upload_sessions(state, expires_at);

CREATE TABLE IF NOT EXISTS upload_parts (
  session_id  TEXT    NOT NULL REFERENCES upload_sessions(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL CHECK (part_number BETWEEN 1 AND 10000),
  etag        TEXT    NOT NULL,
  size_bytes  INTEGER NOT NULL CHECK (size_bytes > 0),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (session_id, part_number)
);

-- Четыре уровня существуют всегда; тексты по умолчанию совпадают с shared/defaults.ts.
INSERT OR IGNORE INTO films (slug, tier_order, title, short_description, long_description, compare_text, button_label) VALUES
  ('econom',  1, 'ЭКОНОМ',  'Простое начало вашей истории',
   'Пример мультфильма уровня ЭКОНОМ. Посмотрите его целиком и сравните с остальными уровнями.',
   'Начальный уровень исполнения.', 'Смотреть пример'),
  ('basic',   2, 'БАЗОВЫЙ', 'Когда воспоминания обретают форму',
   'Пример мультфильма уровня БАЗОВЫЙ. Посмотрите его целиком и сравните с остальными уровнями.',
   'Следующий шаг в проработке истории.', 'Смотреть пример'),
  ('premium', 3, 'ПРЕМИУМ', 'Каждая деталь превращается в искусство',
   'Пример мультфильма уровня ПРЕМИУМ. Посмотрите его целиком и сравните с остальными уровнями.',
   'Высокий уровень художественной проработки.', 'Смотреть ПРЕМИУМ'),
  ('ultima',  4, 'УЛЬТИМА', 'Не просто мультфильм. Ваше личное кино',
   'Пример мультфильма флагманского уровня УЛЬТИМА. Посмотрите его целиком и сравните с остальными уровнями.',
   'Флагманский уровень студии.', 'Смотреть УЛЬТИМА');
