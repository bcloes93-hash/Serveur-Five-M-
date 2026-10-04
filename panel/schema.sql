-- Base de données du panel staff (Cloudflare D1, qui est une base SQLite).
-- À exécuter une seule fois dans la console de la base (voir panel/README.md).

CREATE TABLE IF NOT EXISTS sanctions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player      TEXT NOT NULL,                 -- joueur concerné (pseudo, nom RP…)
  ref         TEXT NOT NULL DEFAULT '',      -- identifiant facultatif (ID Discord, licence…)
  type        TEXT NOT NULL,                 -- avertissement | expulsion | ban_temp | ban_def | note
  reason      TEXT NOT NULL,
  duration    TEXT NOT NULL DEFAULT '',      -- pour un bannissement temporaire
  staff_id    TEXT NOT NULL,                 -- membre du staff qui a enregistré la sanction
  staff_name  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT,                          -- suppression « douce » : la ligne reste en base
  deleted_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sanctions_player ON sanctions (player);

-- Journal d'activité : connexions, ajouts et suppressions de sanctions.
CREATE TABLE IF NOT EXISTS audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  staff_id    TEXT NOT NULL,
  staff_name  TEXT NOT NULL,
  action      TEXT NOT NULL,
  target      TEXT NOT NULL DEFAULT ''
);
