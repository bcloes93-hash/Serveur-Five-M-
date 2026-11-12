/*
 * Configuration du site Santos Legacy RP
 * ---------------------------------------
 * C'est le seul fichier à modifier pour brancher le serveur.
 */
window.SITE_CONFIG = {
  serverName: "Santos Legacy RP",

  // Lien d'invitation Discord (permanent de préférence).
  discordInvite: "https://discord.gg/hrWkJnqJs2",

  // Profil TikTok (menu, bas de page et bandeau de l'accueil). Laisser vide pour masquer ces liens.
  tiktok: "https://www.tiktok.com/@santos.legacy.rp",

  // Code cfx.re du serveur, ex. "abc123" pour https://cfx.re/join/abc123
  // Laisser vide tant que le serveur n'est pas enregistré : le site affiche
  // alors « Ouverture prochaine » et masque le bouton de connexion.
  cfxCode: "",

  // Date et heure d'ouverture du serveur, avec le décalage horaire de Paris :
  // "+01:00" en hiver, "+02:00" en été. Exemple : "2026-12-05T21:00:00+01:00".
  // Renseignée : l'accueil affiche un compte à rebours, puis « Le serveur est ouvert ! »
  // le moment venu (avec le bouton de connexion si cfxCode est rempli).
  // Laisser vide : pas de compte à rebours.
  openingDate: "2027-01-01T19:00:00+01:00",

  // Adresse du panel staff (relais Cloudflare « panel », voir panel/README.md).
  // Laisser vide tant que le panel n'est pas installé : la page staff indique alors qu'il n'est pas activé.
  staffApi: "https://santos-legacy-staff.b-cloes93.workers.dev",

  // Formulaire externe (optionnel) : si une adresse est renseignée, l'onglet
  // affiche un bouton qui ouvre ce formulaire (Google Forms, Tally…) à la place
  // du formulaire du site. Une adresse par type de candidature.
  applicationLinks: {
    whitelist: "",
    staff: "",
  },

  // Délai (en minutes) avant qu'un même visiteur puisse renvoyer une candidature.
  applicationCooldownMinutes: 30,

  // Envoi automatique des candidatures (optionnel).
  // Coller ici l'adresse d'envoi d'un service de formulaires (ex. Formspree :
  // "https://formspree.io/f/xxxxxxxx"), une par type de candidature.
  // Laisser vide = mode « copier-coller » : le candidat copie son texte
  // et le dépose sur le Discord.
  applications: {
    whitelist: "https://candidatures-santos-legacy.b-cloes93.workers.dev",
    staff: "https://candidatures-santos-legacy.b-cloes93.workers.dev",
  },
};
