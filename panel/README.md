# Panel staff – installation

Le panel est composé de deux parties :

- **la page `staff.html`** du site (déjà en place) : l'interface que voit le staff ;
- **un relais Cloudflare** (`panel/worker.mjs`, gratuit) : il vérifie la connexion Discord, contrôle que la personne
  a un rôle staff, et protège les données. **C'est lui qui garantit la sécurité** : un site statique ne peut pas
  cacher des données, donc rien de confidentiel n'est dans la page.

```
Staff ──► « Se connecter avec Discord » ──► relais : est-il dans le serveur ? a-t-il un rôle staff ?
                                              └─► oui : session de 8 h ──► journal de sanctions (base D1)
                                              └─► non : accès refusé
```

## Ce que fait le panel
- **Connexion Discord** réservée aux membres du serveur ayant un rôle staff.
- **Trois niveaux**, selon les rôles Discord :
  - *Support* (facultatif) : lecture seule du barème, des commandes et de l'organigramme. **Pas d'accès** au journal
    des sanctions, qui contient des données sur des joueurs.
  - *Modération* : en plus, consulte le journal des sanctions et y ajoute des sanctions.
  - *Administration* : en plus, supprime des sanctions, modifie le barème, les commandes et l'organigramme, et consulte
    le journal d'activité.

  Si une personne cumule plusieurs rôles, le niveau le plus élevé l'emporte. Un rôle absent de toutes les listes n'a aucun accès.
- **Barème des sanctions** (onglet *Sanctions → Barème*) : pour chaque infraction (RDM, troll, insultes…), les paliers à
  appliquer selon les récidives, par exemple avertissement, expulsion, ban 3 jours, ban définitif. Il se lit d'un coup
  d'œil, se recherche, et un bouton « Noter dans le journal » reprend l'infraction dans le journal. Visible par tout le
  staff ; l'administration l'édite depuis le panel.
- **Journal de sanctions** (onglet *Sanctions → Journal*) : avertissement, expulsion, bannissement temporaire ou définitif, note ; recherche par joueur,
  identifiant ou motif ; chaque ligne garde l'auteur et la date.
- **Journal d'activité** : connexions, sanctions ajoutées et supprimées. Une suppression est « douce » : la ligne reste
  en base, seul l'affichage la masque.
- **Commandes** : deux listes, *Commandes Discord* et *Commandes FiveM*, avec recherche, regroupement par catégorie et
  bouton « Copier ». Visibles par tout le staff connecté ; l'administration les ajoute, les modifie et les supprime
  depuis le panel. Elles sont stockées dans la base protégée, **jamais dans le dépôt public**.
- **Organigramme** : la hiérarchie de l'équipe (groupes, niveaux, couleurs), visible par le staff connecté et modifiable
  par l'administration.
- Réservés pour plus tard : suivi des candidatures, actions en direct sur le serveur FiveM.

## Ce qu'il vous faut
- Le compte Cloudflare déjà créé pour le relais des candidatures.
- Les droits d'administrateur sur le serveur Discord.

## Étape 1 – Créer l'application Discord
1. Ouvrez https://discord.com/developers/applications → **New Application** → nom : `Santos Legacy RP Staff`.
2. Menu **OAuth2** : copiez le **Client ID**. Cliquez sur **Reset Secret** et copiez le **Client Secret**
   (⚠️ secret : à ne jamais publier ni envoyer à quelqu'un).
3. Toujours dans **OAuth2**, section **Redirects** → **Add Redirect** → collez
   `https://santos-legacy-staff.b-cloes93.workers.dev/callback` → **Save Changes**.

Aucun robot (bot) n'est nécessaire.

## Étape 2 – Récupérer les identifiants Discord
Dans Discord : **Paramètres utilisateur** → **Avancés** → activez le **Mode développeur**. Puis :
- **ID du serveur** : clic droit sur l'icône de votre serveur → **Copier l'identifiant du serveur**.
- **ID des rôles** : Paramètres du serveur → **Rôles** → clic droit sur un rôle → **Copier l'identifiant du rôle**.
  Notez ceux des rôles *Modérateur* d'un côté, et *Admin*, *Manager* et *Fondateur* de l'autre.

## Étape 3 – Créer la base de données (D1)
1. Cloudflare → **Storage & databases** → **D1 SQL database** → **Create database** → nom : `staff-panel-db`.
2. Ouvrez la base → onglet **Console**, collez **tout** le contenu de [`schema.sql`](./schema.sql), puis **Execute**.
3. (Facultatif) Pour pré-remplir l'organigramme avec l'équipe actuelle, collez ensuite le contenu de
   [`seed.sql`](./seed.sql) et **Execute**. **À faire une seule fois** : le refaire créerait des doublons.
   Sans cette étape, l'organigramme démarre vide et l'administration le remplit depuis le panel.
4. (Facultatif) Pour partir d'un barème de sanctions déjà rédigé, collez le contenu de
   [`seed-bareme.sql`](./seed-bareme.sql) et **Execute**, une seule fois. ⚠️ C'est une **proposition** (13 infractions
   tirées du règlement public, avec des paliers et durées courants) : l'équipe doit la relire et l'adapter avant de
   l'appliquer. Sans cette étape, le barème démarre vide.

## Étape 3 bis – Créer le relais
1. **Compute** → **Workers & Pages** → **Create** → **Create Worker** → nom : `santos-legacy-staff` → **Deploy**.
2. **Edit code** → `Ctrl+A`, supprimez, puis collez le contenu de [`worker.mjs`](./worker.mjs) (bouton
   **Copy raw file** sur GitHub) → **Deploy**.

> **Pourquoi les fichiers SQL n'ont pas de commentaires ?** La console Cloudflare met tout sur une seule ligne quand on
> colle : un commentaire `--` masquerait alors tout le reste de la requête. Les fichiers sont donc volontairement sans
> commentaire (un test le vérifie). Les tables sont décrites ci-dessous.

| Table | Contenu |
| --- | --- |
| `sanctions` | Journal : joueur, identifiant facultatif, type (`avertissement`, `expulsion`, `ban_temp`, `ban_def`, `note`), motif, durée, auteur, date ; suppression « douce » (`deleted_at`) |
| `audit` | Journal d'activité : connexions, ajouts, modifications et suppressions |
| `commands` | Commandes Discord / FiveM (`platform`, catégorie, commande, description, exemple) |
| `org` | Organigramme : nom, rôle affiché, groupe (`grp`), niveau (`tier`, 1 = haut), couleur (`kind`), ordre |
| `penalties` | Barème : catégorie, infraction (`name`), paliers au format JSON (`steps`), précisions (`notes`) |

## Étape 4 – Relier la base et renseigner les réglages
Dans le Worker → **Settings** :

**Bindings** → **Add** → **D1 database** → nom de variable `DB` (exactement) → base `staff-panel-db`.

**Variables and Secrets** → **Add**, puis **Deploy** :

| Nom | Type | Valeur |
| --- | --- | --- |
| `DISCORD_CLIENT_ID` | Texte | le Client ID de l'étape 1 |
| `DISCORD_CLIENT_SECRET` | **Secret** | le Client Secret de l'étape 1 |
| `DISCORD_GUILD_ID` | Texte | l'ID du serveur |
| `ROLES_MOD` | Texte | l'ID du rôle Modérateur (plusieurs : séparés par des virgules) |
| `ROLES_ADMIN` | Texte | les ID des rôles Admin, Manager, Fondateur, séparés par des virgules |
| `ROLES_SUPPORT` | Texte (facultatif) | l'ID du rôle Support (lecture seule des références, sans le journal des sanctions) |
| `SESSION_SECRET` | **Secret** | une longue chaîne aléatoire, 48 caractères ou plus (générateur de mot de passe de votre navigateur) |
| `PANEL_URL` | Texte | `https://bcloes93-hash.github.io/Serveur-Five-M-/staff.html` |
| `ALLOWED_ORIGIN` | Texte | `https://bcloes93-hash.github.io` (sans `/` final) |
| `SESSION_HOURS` | Texte (facultatif) | durée d'une session, 8 par défaut |

Vérification : ouvrez `https://santos-legacy-staff.b-cloes93.workers.dev/login`. S'il manque un réglage, la page
vous le dit en clair (sans jamais afficher de secret). Sinon, vous êtes envoyé vers Discord.

## Étape 5 – Brancher le site
Dans `js/config.js`, renseignez l'adresse du relais, puis publiez sur `main` :

```js
staffApi: "https://santos-legacy-staff.b-cloes93.workers.dev",
```

Le lien « Espace staff » apparaît alors dans le pied de page du site, et `staff.html` affiche la connexion.

## Remplir le barème
Compte **Administration** → *Sanctions → Barème* → « Ajouter une infraction au barème » : nom, catégorie, puis jusqu'à
5 **paliers** dans l'ordre (le 1ᵉʳ pour la première infraction, le 2ᵉ pour la récidive…). Chaque palier est un
avertissement, une expulsion, un ban temporaire (durée obligatoire), un ban définitif ou « Autre » (texte libre).
Une infraction avec un seul palier s'affiche « Immédiat » (ex. triche → ban définitif).

## Remplir les commandes
Une fois connecté avec un compte **Administration** : onglet **Commandes** → formulaire « Ajouter une commande »
(type Discord ou FiveM, catégorie, commande, description, exemple). Chaque ligne a ses boutons *Modifier* et *Supprimer*.
Seule l'administration peut modifier ; la modération consulte et copie.

## À savoir
- **Données privées** : les commandes et l'organigramme du panel ne sont lisibles qu'après connexion avec un rôle staff.
  Ne les recopiez pas dans les fichiers du site (`index.html`, `staff.html`…), qui sont publics. L'organigramme du panel
  est distinct de la page publique « Équipe », qui reste visible par tous.
- **Rôles** : ils sont vérifiés à la connexion. Si quelqu'un perd son rôle, il garde sa session jusqu'à son expiration
  (8 h par défaut). Pour **déconnecter tout le monde immédiatement**, changez la valeur de `SESSION_SECRET`.
- **Données personnelles** : le journal contient des informations sur des joueurs. Limitez-le au staff, ne notez que
  ce qui est utile, et supprimez ce qui n'a plus lieu d'être (RGPD).
- **Sécurité de la page** : `staff.html` impose une politique de sécurité (CSP) qui n'autorise la connexion qu'aux
  adresses `*.workers.dev` et à Discord. Si vous utilisez plus tard un nom de domaine personnalisé pour le relais,
  ajoutez-le dans la balise `Content-Security-Policy` de `staff.html`.
- **Mise à jour du relais** : quand `worker.mjs` change sur GitHub, il faut le recoller dans Cloudflare (Edit code →
  remplacer → Deploy). Les réglages et la base restent en place.

## Tests
```bash
node --test panel/worker.test.mjs
```
Les tests utilisent une vraie base SQLite en mémoire et un faux Discord : connexion, droits par rôle, jetons falsifiés,
injection SQL, recherche, suppression douce, commandes, organigramme et barème (lecture staff, écriture administration).
