-- Pré-remplit l'organigramme avec l'équipe actuelle (à exécuter UNE SEULE FOIS, après schema.sql).
-- Ensuite, tout se modifie depuis le panel (onglet Organigramme, compte Administration).
INSERT INTO org (name, role, grp, tier, kind, position) VALUES
  ('Jaguuar_',     'Fondateur · Développeur', 'Direction',      1, 'founder', 0),
  ('Fumeurdefrap', 'Manager',                 'Administration', 2, 'manager', 0),
  ('Taalback',     'Admin',                   'Administration', 3, 'admin',   0),
  ('Isar',         'Admin',                   'Administration', 3, 'admin',   1),
  ('Trafalgar',    'Admin',                   'Administration', 3, 'admin',   2),
  ('Moncef',       'Modérateur',              'Modération',     4, 'mod',     0);
