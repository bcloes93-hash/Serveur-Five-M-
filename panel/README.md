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
- **Cinq niveaux**, selon les rôles Discord (du plus bas au plus haut) :
  - *Support* (facultatif) : lecture seule du barème, des commandes et de l'organigramme. **Pas d'accès** au journal
    des sanctions, qui contient des données sur des joueurs.
  - *Modération* : en plus, consulte le journal des sanctions et y ajoute des sanctions.
  - *Administration* : en plus, supprime des sanctions et consulte le journal d'activité. Elle **ne modifie aucun
    contenu du site** (ni les commandes, ni l'organigramme, ni le barème, ni le règlement).
  - *Manager* (facultatif) : en plus, **modifie l'organigramme et le barème des sanctions**, avec une **visibilité plus
    large des commandes** (voir ci-dessous). Il ne modifie ni les commandes ni le règlement.
  - *Fondateur* (facultatif) : tout, y compris **le règlement** (règles, chapitres, import) et **les commandes**.

  **Qui modifie quoi** (réglé en tête de `worker.mjs`, constante `PERMS`, et appliqué par le serveur) :

  | Contenu | Peut le modifier |
  |---|---|
  | Règlement (règles, chapitres, import) | Fondateur |
  | Barème des sanctions (site + onglet Sanctions) | Managers et fondateur |
  | Organigramme (page Équipe) | Managers et fondateur |
  | Commandes | Fondateur |

  L'onglet **Modifications du site** (dernier du menu, juste au-dessus de « Se déconnecter ») affiche ce tableau : chaque
  grade y voit ce qu'il peut modifier (bouton *Ouvrir*) et ce qui lui est réservé. Le panel lit ces droits dans
  `/api/me` : si le relais n'est pas à jour, un avertissement s'affiche au fondateur.

  Si une personne cumule plusieurs rôles, le niveau le plus élevé l'emporte. Un rôle absent de toutes les listes n'a aucun accès.
- **Commandes visibles selon le niveau** : chaque commande a un niveau minimal. Chaque personne ne reçoit que les commandes
  de son niveau et des niveaux inférieurs : le serveur ne les envoie même pas aux autres (ce n'est pas un simple masquage
  à l'écran). Seul le fondateur modifie les commandes (il peut les réserver à n'importe quel niveau) ; avant, un administrateur ne pouvait ni créer, ni modifier, ni supprimer une commande réservée à un niveau supérieur
  au sien, et le journal d'activité masque leur nom.
- **Barème des sanctions** (onglet *Sanctions → Barème*) : **le même barème que celui du site** (*Modifications du site → Barème des sanctions*),
  lu en direct : il n'y a plus de liste à part à tenir à jour. Pour chaque infraction (par catégorie), les renvois vers
  les règles (numéros cliquables), la progression des sanctions (1re fois, 2e fois, récidive…, pastille de couleur selon
  la gravité) et les remarques. Il se lit d'un coup d'œil, se recherche (nom, mot-clé, numéro de règle) et un bouton
  « Noter dans le journal » reprend l'infraction dans le journal. Visible par tout le staff. Pour le modifier : *Règlement
  → Barème des sanctions* (managers et fondateur) — un bouton « Modifier le barème » y mène.
- **Règlement** (*Modifications du site → Règlement*, **fondateur** ; le barème : managers et fondateur) : les chapitres et les règles de la page publique
  [Règlement](../reglement.html) se gèrent ici, sans toucher au code. Le site lit la version publiée par une route
  publique en lecture seule (`/api/public/rules`, qui ne renvoie que ce qui est publié, sans identifiant ni nom d'auteur).
  - **Modifier le texte** d'une règle (éditeur avec barre de mise en forme et **aperçu en direct**), **ajouter**,
    **supprimer**, **publier / dépublier** (un brouillon reste dans le panel, invisible sur le site), **mettre en avant**
    (règle « importante » : pastille et mise en valeur sur le site, filtre « ★ Règles importantes »).
  - **Réorganiser** : glisser une règle pour changer son ordre, la **glisser sur un chapitre** pour la déplacer dans ce
    chapitre ; glisser un chapitre pour le replacer. Sans souris : boutons ↑ ↓ et menu « Déplacer vers… ». Chapitres :
    créer, modifier, publier / dépublier, supprimer (seulement s'il est vide).
  - **Les numéros sont automatiques** : « 5.12 » = 12ᵉ règle publiée du 5ᵉ chapitre publié, selon l'ordre choisi. Déplacer
    ou dépublier une règle renumérote celles qui suivent ; un chapitre « non numéroté » (ex. *Charte Whitelist*) n'a ni
    « Chapitre N » ni numéros de règles. Les adresses directes (`reglement.html#r5-12`) suivent la numérotation.
    Un renvoi écrit dans un texte (« Chapitre 4 ») devient un lien vers ce chapitre, mais **n'est pas réécrit
    automatiquement** si l'on change l'ordre des chapitres.
  - **Mise en forme du texte** (une ligne = un paragraphe) : `* texte` puce, `1. texte` liste numérotée, `**gras**`,
    `« phrase »` citation, `Interdit` / `Autorisé` / `Exemple` seuls sur une ligne = intertitres colorés, `### Titre` =
    encadré, `a → b → c` = enchaînement. Rien n'est jamais interprété comme du HTML.
  - **Barème des sanctions (indicatif)** : *Modifications du site → Barème des sanctions*. Une introduction, puis jusqu'à 24
    **sections** dans l'ordre choisi (↑ ↓, ajout, suppression). Une section de type **catégorie d'infractions**
    (Comportement, Roleplay, Scènes…) décrit une infraction par bloc, séparés par une ligne vide :
    ```
    Metagaming
    🔗 Règle 2.1 — Metagaming
    1re fois — Avertissement / Warn
    2e fois — Ban 1 jour
    Récidive lourde — Réévaluation Whitelist
    Une remarque sous les étapes.
    ```
    Le site affiche chaque infraction en carte compacte : nom, renvois vers les règles (les **numéros deviennent des
    liens** vers la règle), progression des sanctions (pastille de couleur selon la gravité : avertissement < ban 1-3 j
    < ban 7-14 j < définitif) et remarque. Sous chaque texte, le panel annonce le nombre d'infractions reconnues, signale
    les **renvois vers une règle introuvable** et propose un **aperçu** identique au site. Les autres types (texte
    standard, principe en encadré, aggravant, atténuant) s'écrivent comme une règle. Attention : les numéros de règles
    sont saisis, ils ne suivent pas une règle déplacée — le panel signale ceux qui ne mènent plus nulle part.
    C'est une section **séparée** des règles, distincte du barème privé du staff (*Sanctions → Barème*). Elle se retrouve
    par la recherche du site (chaque infraction est un résultat) et par des adresses (`reglement.html#bareme-s2` =
    catégorie, `#bareme-s2-4` = infraction). **Nouvelle version du barème** : si votre barème ne contient pas encore
    de catégorie d'infractions alors que `data/reglement.json` en contient, un encadré propose de **l'appliquer**
    (il remplace l'ancien barème, après confirmation ; s'il est vide, il est simplement ajouté). *Rétablir le barème
    d'origine* reste disponible. Les anciens niveaux (Mineure…Critique) ne sont plus éditables : ils disparaissent quand
    le nouveau barème est appliqué.
  - La date « Dernière mise à jour » du site ne change que lorsqu'un changement touche du contenu **publié**.
  - **Chapitres d'origine absents** : si `data/reglement.json` contient un chapitre que votre règlement n'a pas (par
    exemple la *Charte Whitelist* ajoutée après l'import), un encadré propose de **l'ajouter sans toucher au reste** (rien
    n'est effacé ni remplacé, le chapitre prend sa place d'origine). « Ne plus me le proposer » masque la proposition.
  - Chaque action est inscrite dans le journal d'activité.
- **Journal de sanctions** (onglet *Sanctions → Journal*) : avertissement, expulsion, bannissement temporaire ou définitif, note ; recherche par joueur,
  identifiant ou motif ; chaque ligne garde l'auteur et la date.
- **Journal d'activité** : connexions, sanctions ajoutées et supprimées. Une suppression est « douce » : la ligne reste
  en base, seul l'affichage la masque.
- **Commandes** : deux listes, *Commandes Discord* et *Commandes FiveM*. Sous chacune, des **sous-catégories**
  (Joueur, Support, Modérateur, Administrateur, Manager, Fondateur, Métiers, Technique… selon vos catégories) : un clic sur l'une
  affiche ses commandes, avec leur nombre ; « Toutes » affiche l'ensemble. La recherche porte toujours sur toutes les
  catégories, et un bouton « Copier » récupère la commande. Le staff connecté ne voit que les commandes de son niveau et
  des niveaux inférieurs ; le fondateur les ajoute, les modifie et les supprime depuis le panel. Elles sont stockées
  dans la base protégée, **jamais dans le dépôt public**. Les sous-catégories viennent du champ « Catégorie » de chaque
  commande (le numéro devant, comme « 3 · », n'est pas affiché : il sert uniquement à garder l'ordre).
- **Organigramme** : un arbre par rang et par pôle — Fondateur ; 3 Managers (Responsable Staff, RP, Communauté) ;
  6 Admins (Référent Légal, Illégal, RP, Modération, Événementiel, Technique) ; 4 Modérateurs (Légal, Illégal, RP,
  Communauté) ; 4 Support (Assistance Joueurs, Tickets, Nouveaux Joueurs, Bugs & Signalements) — avec une légende
  « Pôles d'orientation » (un clic met en avant les cases d'un pôle). Visible par tout le staff connecté.
  Les managers et le fondateur peuvent :
  - **glisser** une carte dans une autre case pour **déplacer** la personne ;
  - **Ctrl + glisser** (Option sur Mac) pour la **copier** : une même personne peut figurer dans plusieurs pôles ;
  - sans souris (téléphone, clavier) : bouton *Afficher les outils*, puis « Déplacer vers… », ou « Copier » suivi de
    « Coller ici » dans chaque case voulue ;
  - **remettre quelqu'un « à placer »** : glissez sa carte sur la zone « À placer » (ou menu « Déplacer vers… ») ;
  - « Retirer » (sur une carte d'un pôle) enlève la personne de cette case ; si c'était sa seule case, elle retourne
    dans « À placer » : **elle n'est jamais supprimée par ce bouton**. Seul « Supprimer » (sur une carte de « À placer »)
    l'enlève définitivement, après confirmation ;
  - **plus de formulaire d'ajout** : les personnes du staff (rôle support et au-dessus) arrivent **toutes seules dans
    « À placer »** à leur première connexion au panel, avec leur photo Discord ; il suffit de les glisser dans l'arbre ;
  - le bouton **« Titre »** de chaque carte (dans les outils) modifie le titre affiché sur la carte et sur la page Équipe, par
    exemple « Fondateur · Développeur » ; laissé vide, c'est le nom de la case qui s'affiche ;
  - **à la connexion, toute personne du staff (support et au-dessus) est ajoutée automatiquement dans « À placer »**, avec sa
    **photo Discord**. Si une fiche créée à la main porte déjà son nom (pseudo sur le serveur, nom affiché ou nom d'utilisateur
    Discord), elle est simplement reliée à son compte, sans doublon, et affiche sa photo. Seules les personnes qui se sont
    connectées au moins une fois apparaissent ainsi. Sont mémorisés, dans la base protégée (visible du seul staff connecté) :
    l'identifiant Discord, le pseudo et l'identifiant de la photo.

  **Page publique « Équipe »** : l'organigramme est affiché aux visiteurs sur `equipe.html`, **tel qu'il est dans le panel**
  (mêmes cases, mêmes pôles, mêmes couleurs, même légende) et il **suit vos déplacements** : le site relit le panel à chaque
  visite (route publique en lecture seule `/api/public/team`, mise en cache 30 secondes). Sont affichés : le nom, le titre
  personnalisé et la **photo Discord** de chaque personne **placée dans l'arbre**. Les personnes de « À placer » (dont tout
  nouveau connecté) **ne sont jamais publiques** : placer quelqu'un dans l'arbre revient à le publier. Aucun identifiant
  Discord n'est exposé : les photos passent par le panel (`/api/public/avatar/N`). Si le panel ne répond pas ou si personne
  n'est placé, la liste d'origine de la page (écrite dans `equipe.html`) reste affichée.

  Ce schéma est une **représentation** de l'équipe : déplacer quelqu'un n'en change **ni les rôles Discord, ni les accès
  au panel** (qui viennent toujours des rôles Discord). Les noms des cases sont fixés dans le code (`worker.mjs` et
  `staff.js`) ; pour en renommer ou en ajouter, il faut modifier ces deux fichiers.
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
   Sans cette étape, l'organigramme démarre vide et les managers ou le fondateur le remplissent depuis le panel.
4. (Ancien, inutile) [`seed-bareme.sql`](./seed-bareme.sql) pré-remplissait l'ancienne liste privée du barème
   (table `penalties`). Le panel ne la lit plus : le barème des sanctions est celui du Règlement (voir plus bas).

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
| `commands` | Commandes Discord / FiveM (`platform`, catégorie, commande, description, exemple, `min_level` = niveau minimal pour la voir) |
| `org` | Organigramme : une ligne par personne **et par case** (nom, titre affiché, `kind` = la case, ex. `adm_legal`, ou `other` = à placer ; `grp` et `tier` sont déduits de la case par le serveur ; ordre ; `discord_id` et `avatar` = compte et photo Discord, renseignés à la connexion) |
| `penalties` | Barème : catégorie, infraction (`name`), paliers au format JSON (`steps`), précisions (`notes`) |
| `rule_chapters` | Règlement : chapitres (titre, introduction, `numbered` = numéroté ou non, ordre, `published`) |
| `rules` | Règlement : règles (chapitre, ordre, titre, texte, `published`, `important`, dernière modification et auteur) |
| `rule_levels` | Anciens niveaux du barème indicatif (Mineure…Critique) : vides depuis le nouveau barème, conservés pour compatibilité |
| `rules_meta` | Réglages du règlement : `initialized` (import fait), date de dernière mise à jour, introduction du barème, sections du barème (JSON) |

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
| `ROLES_ADMIN` | Texte | l'ID du rôle Admin (plusieurs : séparés par des virgules) |
| `ROLES_MANAGER` | Texte (facultatif) | l'ID du rôle Manager |
| `ROLES_FOUNDER` | Texte (facultatif) | l'ID du rôle Fondateur |
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

## Le barème des sanctions
Il n'y en a **qu'un** : celui de *Modifications du site → Barème des sanctions* (managers et fondateur). Le panel (*Sanctions → Barème*) et la page
publique le lisent à la même source, ils sont donc toujours identiques. Pour le remplir ou le modifier : voir « Barème
des sanctions (indicatif) » plus haut. L'ancienne liste privée (table `penalties` et routes `/api/penalties`) n'est plus
utilisée par le panel ; elle reste en base sans effet et peut être ignorée.

## Remplir les commandes
Une fois connecté avec le compte **Fondateur** : onglet **Commandes** → formulaire « Ajouter une commande »
(type Discord ou FiveM, catégorie, commande, description, exemple). Chaque ligne a ses boutons *Modifier* et *Supprimer*.
Seul le fondateur peut modifier ; tout le staff consulte et copie.

## Mettre à jour une base déjà installée (niveaux des commandes)
Si la base a été créée **avant** l'ajout des niveaux de visibilité, une seule fois, dans la console D1 :

```sql
ALTER TABLE commands ADD COLUMN min_level TEXT NOT NULL DEFAULT 'support';
```

([`migration-niveaux-commandes.sql`](./migration-niveaux-commandes.sql)). Toutes les commandes existantes restent alors
visibles par tout le staff, jusqu'à ce qu'un niveau minimal leur soit attribué (depuis le panel, bouton *Modifier*). Ordre
conseillé : d'abord la base, ensuite le code du relais (`worker.mjs`), puis les réglages `ROLES_MANAGER` et `ROLES_FOUNDER`.

### Mise à jour : organigramme par pôles
Aucune modification de la base n'est nécessaire (la table `org` est inchangée). Collez simplement le nouveau
[`worker.mjs`](./worker.mjs) dans le relais du panel (*Edit code* → coller → **Deploy**), **avant** d'utiliser le nouvel
organigramme : l'ancien code refuserait les nouvelles cases. Les membres déjà enregistrés (sauf le fondateur) apparaissent
dans « À placer » : glissez-les dans leurs pôles.

### Mise à jour : photos Discord et inscription à la connexion
1. Dans **D1 → votre base → Console**, collez [`migration-organigramme-discord.sql`](./migration-organigramme-discord.sql)
   (deux `ALTER TABLE`) et **Execute**. **À faire une seule fois** : le refaire donne une erreur « duplicate column »,
   sans gravité.
2. Collez ensuite le nouveau [`worker.mjs`](./worker.mjs) dans le relais du panel (*Edit code* → **Deploy**).

L'ordre n'est pas critique : tant que l'étape 1 n'est pas faite, le panel fonctionne comme avant (initiales au lieu de
photos, pas d'inscription automatique), sans erreur.

### Mise à jour : règlement géré depuis le panel
1. Dans **D1 → votre base → Console**, collez [`migration-reglement.sql`](./migration-reglement.sql) (quatre tables
   `CREATE TABLE IF NOT EXISTS`, sans risque si vous le refaites) et **Execute**.
2. Collez le nouveau [`worker.mjs`](./worker.mjs) dans le relais du panel (*Edit code* → **Deploy**).
3. Publiez le site (fichiers `reglement.html`, `staff.html`, `js/`, `css/` et **`data/reglement.json`**).
4. Connectez-vous au panel avec le compte **fondateur** → onglet *Modifications du site* → *Règlement* → **Importer le règlement d'origine**.
   Les textes sont repris tels quels, chapitre par chapitre. Tant que l'import n'est pas terminé, le site affiche la
   version d'origine (`data/reglement.json`) : rien ne change pour les joueurs.

Ensuite, le site lit le règlement depuis le panel. Si le panel est injoignable, le site se rabat sur
`data/reglement.json`, qui est la **version d'origine** (elle n'est pas mise à jour par vos modifications) : c'est un
filet de sécurité, pas la version courante. Le niveau minimal pour gérer le règlement (`rules`, fondateur), le barème
(`bareme`, manager), l'organigramme (`org`, manager) et les commandes (`commands`, fondateur) se règle dans la constante
`PERMS` en tête de `worker.mjs` ; seul le fondateur peut lancer l'import ou tout remplacer par la version d'origine.

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
injection SQL, recherche, suppression douce, commandes, organigramme et barème (lecture staff, écriture selon `PERMS`).
