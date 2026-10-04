/*
 * Modèle de l'organigramme du staff, partagé par le panel (js/staff.js) et la page publique Équipe (js/equipe.js).
 * Les cases (clés) sont les mêmes que dans le relais du panel (panel/worker.mjs, constante NODES) : c'est lui qui impose
 * le rang et le groupe de chaque case. Rien de confidentiel ici : seulement les noms des cases et leurs couleurs.
 */
(function (root) {
  "use strict";
  var ORG_RANKS = { founder: "Fondateur", manager: "Manager", admin: "Admin", mod: "Modérateur", support: "Support" };
  var ORG_POLES = [["legal", "Légal", "blue"], ["illegal", "Illégal", "red"], ["rp", "RP", "purple"], ["mod", "Modération", "green"], ["com", "Communauté", "teal"], ["event", "Événementiel", "amber"], ["tech", "Technique", "slate"]];
  // [clé, rang, titre affiché, nom complet, couleur, pôle, description]
  var ORG_ROWS = [
    [["founder", "founder", "Fondateur", "Fondateur", "gold", "", "Direction générale du serveur"]],
    [["mgr_staff", "manager", "Responsable Staff", "Responsable Staff", "blue", "", "Gestion et encadrement de l'équipe staff."],
     ["mgr_rp", "manager", "Responsable RP", "Responsable RP", "purple", "rp", "Supervision et développement de l'expérience RP."],
     ["mgr_com", "manager", "Responsable Communauté", "Responsable Communauté", "teal", "com", "Lien avec la communauté et développement du serveur."]],
    [["adm_legal", "admin", "Référent Légal", "Référent Légal", "blue", "legal", "Encadrement des forces de l'ordre et du cadre légal."],
     ["adm_illegal", "admin", "Référent Illégal", "Référent Illégal", "red", "illegal", "Suivi des organisations criminelles et activités illégales."],
     ["adm_rp", "admin", "Référent RP", "Référent RP", "purple", "rp", "Veille à la qualité et au respect du roleplay."],
     ["adm_mod", "admin", "Référent Modération", "Référent Modération", "green", "mod", "Supervision de la modération et du bon climat en jeu."],
     ["adm_event", "admin", "Référent Événementiel", "Référent Événementiel", "amber", "event", "Organisation et suivi des événements serveur."],
     ["adm_tech", "admin", "Référent Technique", "Référent Technique", "slate", "tech", "Gestion technique et stabilité du serveur."]],
    [["mod_legal", "mod", "Légal", "Modérateur Légal", "blue", "legal", "Aide au suivi des actions légales et support aux joueurs."],
     ["mod_illegal", "mod", "Illégal", "Modérateur Illégal", "red", "illegal", "Accompagnement des activités illégales et suivi du bon déroulement."],
     ["mod_rp", "mod", "RP", "Modérateur RP", "purple", "rp", "Accompagnement et aide à l'immersion roleplay."],
     ["mod_com", "mod", "Communauté", "Modérateur Communauté", "teal", "com", "Veille, animation et soutien de la communauté."]],
    [["sup_assist", "support", "Assistance Joueurs", "Support Assistance Joueurs", "blue", "", "Aide et accompagnement des joueurs au quotidien."],
     ["sup_tickets", "support", "Tickets", "Support Tickets", "red", "", "Traitement des tickets et suivi des demandes."],
     ["sup_new", "support", "Nouveaux Joueurs", "Support Nouveaux Joueurs", "purple", "", "Accueil et intégration des nouveaux arrivants."],
     ["sup_bugs", "support", "Bugs & Signalements", "Support Bugs & Signalements", "green", "", "Réception et suivi des bugs et des signalements."]]
  ];
  var ORG = {};
  ORG_ROWS.forEach(function (row) {
    row.forEach(function (n) { ORG[n[0]] = { key: n[0], rank: n[1], title: n[2], label: n[3], color: n[4], pole: n[5], desc: n[6] }; });
  });
  var ORG_KEYS = [].concat.apply([], ORG_ROWS).map(function (n) { return n[0]; });
  var GENERIC_ROLES = ["Fondateur", "Manager", "Admin", "Modérateur", "Support", "À placer"];

  root.SLOrg = { RANKS: ORG_RANKS, POLES: ORG_POLES, ROWS: ORG_ROWS, ORG: ORG, KEYS: ORG_KEYS, GENERIC_ROLES: GENERIC_ROLES };
})(window);
