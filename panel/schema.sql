CREATE TABLE IF NOT EXISTS sanctions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player      TEXT NOT NULL,
  ref         TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL,
  reason      TEXT NOT NULL,
  duration    TEXT NOT NULL DEFAULT '',
  staff_id    TEXT NOT NULL,
  staff_name  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT,
  deleted_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sanctions_player ON sanctions (player);
CREATE TABLE IF NOT EXISTS audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  staff_id    TEXT NOT NULL,
  staff_name  TEXT NOT NULL,
  action      TEXT NOT NULL,
  target      TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS commands (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  platform    TEXT NOT NULL,
  cat         TEXT NOT NULL DEFAULT 'Général',
  cmd         TEXT NOT NULL,
  descr       TEXT NOT NULL,
  example     TEXT NOT NULL DEFAULT '',
  min_level   TEXT NOT NULL DEFAULT 'support'
);
CREATE INDEX IF NOT EXISTS idx_commands_platform ON commands (platform);
CREATE TABLE IF NOT EXISTS org (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,
  grp         TEXT NOT NULL,
  tier        INTEGER NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'other',
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS penalties (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cat         TEXT NOT NULL DEFAULT 'Général',
  name        TEXT NOT NULL,
  steps       TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT ''
);
