# Santos Legacy RP – site web

Site vitrine du serveur FiveM **Santos Legacy RP** : HTML/CSS/JS statique, sans build ni dépendance.

## Contenu

| Fichier | Rôle |
| --- | --- |
| `index.html` | Accueil : bannière, statut en direct, présentation, étapes pour rejoindre |
| `reglement.html` | Règlement (conditions d'accès, mort RP, commerce réel et streams fournis par le fondateur ; le reste est un texte type à adapter) |
| `equipe.html` | Équipe du serveur (fondateur, manager, admins, modérateur) |
| `candidature.html` | Candidature WL (joueur) et candidature Staff, en deux onglets |
| `js/config.js` | **Seul fichier à modifier** : lien Discord et code cfx.re |
| `css/style.css` | Thème néon (couleurs en variables CSS au début du fichier) |
| `js/main.js` | Menu mobile, animations, statistiques Discord et FiveM |
| `js/candidature.js` | Onglets, validation et envoi des candidatures |
| `worker/` | Relais Cloudflare qui poste les candidatures dans Discord (`relay.mjs`, tests, notice) |
| `staff.html`, `js/staff.js` | Page du panel staff (connexion Discord, sanctions, commandes, organigramme) |
| `panel/` | Relais Cloudflare du panel staff : connexion, droits, base de données (`worker.mjs`, `schema.sql`, tests, notice) |
| `assets/` | Logo et bannières |

## Brancher le serveur FiveM

Une fois le serveur enregistré sur Cfx.re, renseigner son code dans `js/config.js` :

```js
cfxCode: "abc123", // pour https://cfx.re/join/abc123
```

Le site affiche alors le bouton « Rejoindre le serveur », l'état du serveur et le nombre de joueurs.
Tant que le champ est vide, le site affiche « Ouverture prochaine » et pousse vers le Discord.

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
3. Le site est publié à l'adresse `https://<utilisateur>.github.io/<dépôt>/`. Un nom de domaine personnalisé peut être ajouté dans la même page.
