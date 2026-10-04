CREATE TABLE IF NOT EXISTS rule_chapters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  intro       TEXT NOT NULL DEFAULT '',
  numbered    INTEGER NOT NULL DEFAULT 1,
  position    INTEGER NOT NULL DEFAULT 0,
  published   INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id  INTEGER NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  published   INTEGER NOT NULL DEFAULT 1,
  important   INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_rules_chapter ON rules (chapter_id, position);
CREATE TABLE IF NOT EXISTS rule_levels (
  level       TEXT PRIMARY KEY,
  body        TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rules_meta (
  k           TEXT PRIMARY KEY,
  v           TEXT NOT NULL
);
