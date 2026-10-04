# Santos Legacy RP – site web

Site vitrine du serveur FiveM **Santos Legacy RP** : HTML/CSS/JS statique, sans build ni dépendance.

## Contenu

| Fichier | Rôle |
| --- | --- |
| `index.html` | Accueil : bannière, statut en direct, présentation, étapes pour rejoindre |
| `reglement.html` | Règlement (conditions d'accès, mort RP, commerce réel et streams fournis par le fondateur ; le reste est un texte type à adapter) |
| `equipe.html` | Équipe du serveur (fondateur, manager, admins, modérateur) |
| `js/config.js` | **Seul fichier à modifier** : lien Discord et code cfx.re |
| `css/style.css` | Thème néon (couleurs en variables CSS au début du fichier) |
| `js/main.js` | Menu mobile, animations, statistiques Discord et FiveM |
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

## Tester en local

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Mise en ligne gratuite (GitHub Pages)

1. Le code à publier doit être sur la branche `main`.
2. Sur GitHub : **Settings → Pages → Build and deployment → Deploy from a branch**, choisir `main` et le dossier `/ (root)`.
3. Le site est publié à l'adresse `https://<utilisateur>.github.io/<dépôt>/`. Un nom de domaine personnalisé peut être ajouté dans la même page.
