# Santos Legacy RP – site web

Site vitrine du serveur FiveM **Santos Legacy RP** : HTML/CSS/JS statique, sans build ni dépendance.

## Contenu

| Fichier | Rôle |
| --- | --- |
| `index.html` | Accueil : bannière, statut en direct, appel à rejoindre le Discord |
| `serveur.html` | Page Le serveur : présentation (mentalité, roleplay, économie, communauté) |
| `entreprises.html`, `assets/entreprises/` | Page Entreprises : services publics et entreprises tenues par des joueurs, avec leur logo. Le badge de chaque carte se change dans le fichier : `biz__status--take` (« À reprendre »), `biz__status--open` (« Recrute ») ou `biz__status--full` (« Complet »), en changeant aussi le texte |
| `rejoindre.html` | Page Rejoindre : prérequis et les 4 étapes pour rejoindre le serveur |
| `reglement.html`, `js/reglement.js`, `js/rules-render.js`, `css/livre.css` | Page Règlement en forme de livre (couverture en cuir, pages qui se tournent, une page sur téléphone) : sommaire, marque-pages par chapitre, recherche, adresses directes (`#r5-12`), barème indicatif, mode « Lire en continu ». La mise en page en pages se fait dans le navigateur, selon la taille de l'écran. Le contenu est géré depuis le panel staff (onglet *Règlement*) |
| `data/reglement.json` | Version d'origine du règlement (import initial dans le panel, et filet de sécurité si le panel est injoignable) |
| `equipe.html`, `js/equipe.js`, `js/org-model.js` | Équipe du serveur : organigramme en direct (celui du panel, synchronisé), avec liste d'origine en secours |
| `candidature.html` | Candidature WL (joueur) et candidature Staff, en deux onglets |
| `js/config.js` | **Seul fichier à modifier** : lien Discord, profil TikTok, code cfx.re et date d'ouverture |
| `css/style.css` | Thème néon (couleurs en variables CSS au début du fichier) |
| `js/main.js` | Menu mobile, animations, statistiques Discord et FiveM |
| `js/candidature.js` | Onglets, validation et envoi des candidatures |
| `worker/` | Relais Cloudflare qui poste les candidatures dans Discord (`relay.mjs`, tests, notice) |
| `staff.html`, `js/staff.js` | Page du panel staff (connexion Discord, sanctions : barème et journal, commandes, organigramme, règlement) |
| `panel/` | Relais Cloudflare du panel staff : connexion, droits, base de données (`worker.mjs`, `schema.sql`, tests, notice) |
| `mentions-legales.html` | Mentions légales (éditeur, hébergeurs) et confidentialité (données des candidatures et de l'espace staff, services extérieurs, droits). **À mettre à jour** si le site collecte de nouvelles données ou ajoute un service extérieur. Lien en bas de chaque page |
| `404.html` | Page « introuvable », affichée par GitHub Pages pour toute adresse qui n'existe pas (liens en `/…` pour marcher depuis n'importe quel dossier) |
| `robots.txt`, `sitemap.xml` | Pour les moteurs de recherche : pages à ne pas indexer (staff, relais) et liste des pages publiques (à compléter si une page est ajoutée) |
| `css/fonts.css`, `assets/fonts/` | Polices du site (Bebas Neue, Outfit, Cinzel, Crimson Pro), hébergées ici plutôt que chez Google Fonts : aucun appel à Google. Licence libre SIL OFL 1.1 (fichiers `OFL-*.txt`, à garder avec les polices) |
| `assets/` | Logo, bannières, logo de la couverture du règlement (`livre-logo.webp`) et image de partage (`partage.jpg`, 1200×630 : l'aperçu affiché quand on colle un lien du site dans Discord ou sur les réseaux) |

## Brancher le serveur FiveM

Une fois le serveur enregistré sur Cfx.re, renseigner son code dans `js/config.js` :

```js
cfxCode: "abc123", // pour https://cfx.re/join/abc123
```

Le site affiche alors le bouton « Rejoindre le serveur », l'état du serveur et le nombre de joueurs.
Tant que le champ est vide, le site affiche « Ouverture prochaine » et pousse vers le Discord.

### Compte à rebours d'ouverture

Renseigner la date et l'heure d'ouverture dans `js/config.js`, avec le décalage horaire de Paris
(`+01:00` en hiver, `+02:00` en été) :

```js
openingDate: "2026-12-05T21:00:00+01:00", // samedi 5 décembre 2026 à 21 h, heure de Paris
```

L'accueil affiche alors un compte à rebours (jours, heures, minutes, secondes) et la case « Serveur »
indique « Ouverture le 5 décembre ». À l'heure dite, le compte à rebours laisse place à « Le serveur est
ouvert ! » avec le bouton de connexion (si `cfxCode` est rempli) ou celui du Discord. Champ vide : pas de
compte à rebours.

> Les statistiques sont lues directement depuis le navigateur des visiteurs
> (API d'invitation Discord et API publique Cfx.re). Si l'une de ces API refuse la requête,
> le site affiche « — » ou « Statut indisponible » sans casser la page.

## Candidatures

La page `candidature.html` propose deux candidatures (WL et Staff). Selon ce qui est renseigné dans
`js/config.js`, elles fonctionnent de quatre façons (par ordre de priorité) :

1. **Formulaire externe** (`applicationLinks`) : l'onglet affiche un bouton qui ouvre un formulaire
   Google Forms, Tally… dans un nouvel onglet. Seules les adresses `http://` et `https://` sont acceptées.
2. **Envoi direct dans un salon Discord (recommandé)** (`applications`) : le formulaire du site envoie la
   candidature à un petit relais Cloudflare, qui la poste dans le salon Discord sans exposer le webhook.
   Le candidat voit « Candidature bien envoyée » ; un délai anti-spam limite les renvois.
   Mise en place pas à pas : [`worker/README.md`](worker/README.md).
3. **Envoi par e-mail** (`applications`, avec par exemple [Formspree](https://formspree.io)) :
   mettre l'adresse d'envoi du service à la place de celle du relais.
4. **Copier-coller (par défaut si rien n'est renseigné)** : le site compose le texte, le copie dans le
   presse-papiers et invite le candidat à le coller dans le salon de candidatures du Discord.

```js
applicationLinks: { whitelist: "", staff: "" },   // 1. formulaire externe
applications: {                                   // 2 et 3. envoi automatique
  whitelist: "https://candidatures-santos-legacy.VOTRE-COMPTE.workers.dev",
  staff: "https://candidatures-santos-legacy.VOTRE-COMPTE.workers.dev",
},
```

Si l'envoi automatique échoue, le site retombe sur le copier-coller pour ne pas perdre la candidature.

Les questions se modifient dans `candidature.html` (champs), `js/candidature.js` (libellés du texte copié,
constante `SCHEMAS`) et `worker/relay.mjs` (champs acceptés par le relais, constante `SCHEMAS`) : ces trois
listes doivent rester cohérentes. **Ne jamais écrire un webhook Discord dans ce dépôt public.**

## Tester en local

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Mise en ligne gratuite (GitHub Pages)

1. Le code à publier doit être sur la branche `main`.
2. Sur GitHub : **Settings → Pages → Build and deployment → Deploy from a branch**, choisir `main` et le dossier `/ (root)`.
3. Le site est publié à l'adresse `https://<utilisateur>.github.io/<dépôt>/`. Un nom de domaine personnalisé peut être ajouté dans la même page. Ce site utilise **santoslegacyrp.com** (fichier `CNAME` à la racine du dépôt : ne pas le supprimer). Les réglages `PANEL_URL` et `ALLOWED_ORIGIN` des relais (Cloudflare) doivent contenir cette adresse.
