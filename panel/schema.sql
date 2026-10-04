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

-- Commandes de référence pour le staff (Discord et FiveM). Visibles par le staff connecté,
-- modifiables par l'administration depuis le panel. Rien de tout cela n'est dans le dépôt public.
CREATE TABLE IF NOT EXISTS commands (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  platform    TEXT NOT NULL,                 -- discord | fivem
  cat         TEXT NOT NULL DEFAULT 'Général',
  cmd         TEXT NOT NULL,                 -- la commande, ex. /kick [joueur] [motif]
  descr       TEXT NOT NULL,                 -- à quoi elle sert
  example     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_commands_platform ON commands (platform);

-- Organigramme de l'équipe, visible par le staff connecté, modifiable par l'administration.
CREATE TABLE IF NOT EXISTS org (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,                 -- libellé affiché, ex. Fondateur · Développeur
  grp         TEXT NOT NULL,                 -- groupe affiché autour du niveau : Direction, Administration…
  tier        INTEGER NOT NULL,              -- niveau hiérarchique : 1 = tout en haut
  kind        TEXT NOT NULL DEFAULT 'other', -- founder | manager | admin | mod | other (couleur de la carte)
  position    INTEGER NOT NULL DEFAULT 0     -- ordre dans le niveau (facultatif)
);

-- Barème des sanctions : pour chaque infraction, les paliers à appliquer selon les récidives.
-- Visible par le staff connecté, modifiable par l'administration.
CREATE TABLE IF NOT EXISTS penalties (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cat         TEXT NOT NULL DEFAULT 'Général',   -- regroupement, ex. Comportement, Roleplay, Triche
  name        TEXT NOT NULL,                     -- l'infraction, ex. RDM
  steps       TEXT NOT NULL,                     -- paliers en JSON : [{"type":"avertissement","detail":""}, ...] (1 à 5)
  notes       TEXT NOT NULL DEFAULT ''           -- précisions : conditions, cas aggravants…
);
