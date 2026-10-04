/*
 * Configuration du site Santos Legacy RP
 * ---------------------------------------
 * C'est le seul fichier à modifier pour brancher le serveur.
 */
window.SITE_CONFIG = {
  serverName: "Santos Legacy RP",

  // Lien d'invitation Discord (permanent de préférence).
  discordInvite: "https://discord.gg/hrWkJnqJs2",

  // Code cfx.re du serveur, ex. "abc123" pour https://cfx.re/join/abc123
  // Laisser vide tant que le serveur n'est pas enregistré : le site affiche
  // alors « Ouverture prochaine » et masque le bouton de connexion.
  cfxCode: "",

  // Formulaire externe (optionnel) : si une adresse est renseignée, l'onglet
  // affiche un bouton qui ouvre ce formulaire (Google Forms, Tally…) à la place
  // du formulaire du site. Une adresse par type de candidature.
  applicationLinks: {
    whitelist: "",
    staff: "",
  },

  // Envoi automatique des candidatures (optionnel).
  // Coller ici l'adresse d'envoi d'un service de formulaires (ex. Formspree :
  // "https://formspree.io/f/xxxxxxxx"), une par type de candidature.
  // Laisser vide = mode « copier-coller » : le candidat copie son texte
  // et le dépose sur le Discord.
  applications: {
    whitelist: "",
    staff: "",
  },
};
