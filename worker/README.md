# Relais « candidatures → Discord »

Ce petit programme (un **Cloudflare Worker**, gratuit) reçoit les candidatures envoyées depuis le site et les
poste dans un salon Discord. Le candidat voit « Candidature bien envoyée », et le staff reçoit la candidature
sous forme d'un message propre dans le salon.

**Pourquoi un relais ?** Un webhook Discord écrit directement dans le site serait lisible par tout le monde
(le dépôt est public) : n'importe qui pourrait inonder votre salon. Ici, le webhook reste **secret** dans
Cloudflare. Le relais vérifie aussi chaque candidature (18 ans minimum, champs obligatoires, tailles), empêche
toute mention `@everyone`, et peut limiter le nombre de candidatures par personne.

```
Site (formulaire) ──► Relais Cloudflare (vérifie, garde le secret) ──► Salon Discord
```

Chaque candidature reçoit un **numéro unique** (par exemple `WL-7M4VCC` ou `STAFF-K3P9QX`). Le candidat le voit
après l'envoi, et il est écrit dans le titre, le texte et le pied du message Discord : le staff peut le chercher
avec la recherche Discord et le candidat peut le citer s'il contacte l'équipe.

## Ce qu'il vous faut
- Un compte gratuit sur [Cloudflare](https://dash.cloudflare.com/sign-up).
- Les droits d'administrateur sur votre serveur Discord.

## Étape 1 – Créer les webhooks Discord
Créez (ou choisissez) **deux salons** : un pour les candidatures WL, un pour les candidatures Staff
(ce dernier de préférence **privé**, réservé aux admins). Pour chacun :

1. Clic droit sur le salon → **Modifier le salon** → **Intégrations** → **Webhooks** → **Nouveau webhook**.
2. **Copier l'URL du webhook** et gardez-la de côté.

> ⚠️ Cette URL est un secret : ne l'écrivez jamais dans le site, dans GitHub, ni dans un message Discord.

## Étape 2 – Créer le Worker
1. Sur Cloudflare : **Workers & Pages** → **Create** → **Create Worker** (modèle « Hello World »).
2. Donnez-lui un nom, par exemple `candidatures-santos-legacy`, puis **Deploy**.
3. Cliquez sur **Edit code**, supprimez tout le contenu, puis collez **tout** le contenu du fichier
   [`relay.mjs`](./relay.mjs). Cliquez sur **Deploy**.

## Étape 3 – Renseigner les variables
Dans le Worker : **Settings** → **Variables and Secrets** → **Add**, puis **Deploy** :

| Nom | Type | Valeur |
| --- | --- | --- |
| `ALLOWED_ORIGIN` | Texte | `https://bcloes93-hash.github.io` (adresse du site, **sans** `/` final ni nom de dossier). Avec un nom de domaine personnalisé, ajoutez-le après une virgule. |
| `WEBHOOK_WHITELIST` | **Secret** | l'URL du webhook du salon WL |
| `WEBHOOK_STAFF` | **Secret** | l'URL du webhook du salon Staff |
| `PING_ROLE_WHITELIST` | Texte (facultatif) | identifiant du rôle à mentionner pour une candidature WL |
| `PING_ROLE_STAFF` | Texte (facultatif) | identifiant du rôle à mentionner pour une candidature Staff |
| `COOLDOWN_SECONDS` | Texte (facultatif) | délai entre deux candidatures d'une même personne (1800 = 30 min par défaut) |

Pour obtenir l'identifiant d'un rôle : Discord → **Paramètres** → **Avancés** → activez le **Mode développeur**,
puis clic droit sur le rôle (Paramètres du serveur → Rôles) → **Copier l'identifiant du rôle**.

## Étape 4 – Activer la limite anti-spam (recommandé)
Sans cette étape, rien n'empêche une même personne d'envoyer des dizaines de candidatures.

1. Cloudflare → **Storage & databases** → **KV** → **Create** un espace nommé `candidatures-delai`.
2. Dans le Worker : **Settings** → **Bindings** → **Add** → **KV namespace**.
   Nom de la variable : `RATE_LIMIT` (exactement), espace : `candidatures-delai`. **Deploy**.

## Étape 5 – Brancher le site
Copiez l'adresse du Worker (du type `https://candidatures-santos-legacy.VOTRE-COMPTE.workers.dev`) dans
`js/config.js` du site, **la même pour les deux** :

```js
applications: {
  whitelist: "https://candidatures-santos-legacy.VOTRE-COMPTE.workers.dev",
  staff: "https://candidatures-santos-legacy.VOTRE-COMPTE.workers.dev",
},
```

Une fois ce changement publié sur `main`, envoyez une candidature de test : elle doit apparaître dans le salon.

## Limites à connaître
- Le relais bloque les envois depuis d'autres sites et limite chaque personne, mais un programme malveillant
  motivé peut contourner ces protections. Si vous subissez du spam, la suite logique est d'ajouter un
  anti-robot (Cloudflare Turnstile, gratuit).
- Les noms des menus Cloudflare peuvent légèrement changer avec le temps.
- Offre gratuite Cloudflare : 100 000 requêtes par jour, très largement suffisant.

## Tests
```bash
node --test worker/relay.test.mjs
```

## Mettre à jour le relais
Quand le fichier [`relay.mjs`](./relay.mjs) change sur GitHub, le relais **n'est pas mis à jour tout seul** :
sur Cloudflare, ouvrez le Worker → **Edit code**, remplacez tout le contenu par le nouveau `relay.mjs`
(`Ctrl+A`, puis coller), puis **Deploy**. Les variables et le KV restent en place.
