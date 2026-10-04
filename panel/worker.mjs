/**
 * Panel staff de Santos Legacy RP (Cloudflare Worker).
 * Contenu protégé : journal de sanctions, barème des sanctions, commandes (Discord / FiveM), organigramme, journal d'activité.
 *
 * Ce programme est le « serveur » du panel : il vérifie que la personne est bien dans le Discord
 * ET possède un rôle staff, puis protège toutes les données (journal de sanctions…).
 * Un site statique ne peut pas protéger des données : le contrôle d'accès est donc ici, pas dans la page.
 *
 *   Navigateur ──► /login ──► Discord (connexion) ──► /callback ──► vérifie le rôle staff
 *                                                          └──► page staff + jeton de session (8 h)
 *   Page staff ──► /api/...  (jeton obligatoire, droits selon le rôle)  ──► base D1
 *
 * Variables à définir dans Cloudflare (voir panel/README.md) :
 *   DISCORD_CLIENT_ID       identifiant de l'application Discord
 *   DISCORD_CLIENT_SECRET   secret de l'application Discord                         (secret)
 *   DISCORD_GUILD_ID        identifiant du serveur Discord
 *   ROLES_MOD               identifiants des rôles « modération », séparés par des virgules
 *   ROLES_ADMIN             identifiants des rôles « administration »
 *   ROLES_MANAGER           (optionnel) identifiants des rôles « responsable » (au-dessus de l'administration)
 *   ROLES_FOUNDER           (optionnel) identifiants des rôles « fondateur » (le niveau le plus élevé)
 *   ROLES_SUPPORT           (optionnel) identifiants des rôles « support » : lecture seule du barème, des commandes
 *                           et de l'organigramme, sans accès au journal des sanctions
 *   SESSION_SECRET          longue chaîne aléatoire (32 caractères minimum)         (secret)
 *   PANEL_URL               adresse de la page staff, ex. https://…github.io/Serveur-Five-M-/staff.html
 *   ALLOWED_ORIGIN          adresse du site, ex. https://bcloes93-hash.github.io
 *   SESSION_HOURS           (optionnel) durée d'une session, 8 par défaut
 *   DB                      base de données D1 (liaison, voir panel/schema.sql)
 */

const ENC = new TextEncoder();
const DEC = new TextDecoder();

const TYPES = ["avertissement", "expulsion", "ban_temp", "ban_def", "note"];
// Du plus bas au plus haut. Chaque niveau a les droits des niveaux inférieurs ; l'écriture (barème, commandes,
// organigramme) commence à « admin ». Les commandes ne sont visibles que jusqu'au niveau de la personne connectée.
const RANK = { support: 1, mod: 2, admin: 3, manager: 4, founder: 5 };
const LEVEL_NAMES = Object.keys(RANK);
const JWT_HEAD = { alg: "HS256", typ: "JWT" };
const PLATFORMS = ["discord", "fivem"];
// Cases de l'organigramme (un arbre : fondateur, managers, admins, modérateurs, support, chacun avec ses pôles).
// Le niveau et le groupe en découlent : on ne s'en remet donc jamais à ce qu'envoie le navigateur.
// « other » = « à placer » (réserve hors de l'arbre). Une personne peut figurer dans plusieurs cases (une ligne par case).
const NODES = {
  founder: { tier: 1, grp: "Direction", label: "Fondateur" },
  mgr_staff: { tier: 2, grp: "Management", label: "Responsable Staff" },
  mgr_rp: { tier: 2, grp: "Management", label: "Responsable RP" },
  mgr_com: { tier: 2, grp: "Management", label: "Responsable Communauté" },
  adm_legal: { tier: 3, grp: "Administration", label: "Référent Légal" },
  adm_illegal: { tier: 3, grp: "Administration", label: "Référent Illégal" },
  adm_rp: { tier: 3, grp: "Administration", label: "Référent RP" },
  adm_mod: { tier: 3, grp: "Administration", label: "Référent Modération" },
  adm_event: { tier: 3, grp: "Administration", label: "Référent Événementiel" },
  adm_tech: { tier: 3, grp: "Administration", label: "Référent Technique" },
  mod_legal: { tier: 4, grp: "Modération", label: "Modérateur Légal" },
  mod_illegal: { tier: 4, grp: "Modération", label: "Modérateur Illégal" },
  mod_rp: { tier: 4, grp: "Modération", label: "Modérateur RP" },
  mod_com: { tier: 4, grp: "Modération", label: "Modérateur Communauté" },
  sup_assist: { tier: 5, grp: "Support", label: "Support Assistance Joueurs" },
  sup_tickets: { tier: 5, grp: "Support", label: "Support Tickets" },
  sup_new: { tier: 5, grp: "Support", label: "Support Nouveaux Joueurs" },
  sup_bugs: { tier: 5, grp: "Support", label: "Support Bugs & Signalements" },
  other: { tier: 9, grp: "À placer", label: "À placer" },
};
const KINDS = Object.keys(NODES);
const STEP_TYPES = ["avertissement", "expulsion", "ban_temp", "ban_def", "autre"];
const MAX_STEPS = 5;
const MAX_BODY_BYTES = 5000;
const DISCORD = "https://discord.com/api/v10";

/* ---------- Utilitaires ---------- */

function b64urlEncode(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret, usages) {
  return crypto.subtle.importKey("raw", ENC.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);
}

async function hmac(secret, data) {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret, ["sign"]), ENC.encode(data)));
}

async function signToken(payload, secret) {
  const head = b64urlEncode(ENC.encode(JSON.stringify(JWT_HEAD)));
  const body = b64urlEncode(ENC.encode(JSON.stringify(payload)));
  return `${head}.${body}.${b64urlEncode(await hmac(secret, `${head}.${body}`))}`;
}

/** Retourne le contenu du jeton s'il est authentique et non expiré, sinon null. */
async function verifyToken(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== b64urlEncode(ENC.encode(JSON.stringify(JWT_HEAD)))) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, ["verify"]), b64urlDecode(parts[2]), ENC.encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const payload = JSON.parse(DEC.decode(b64urlDecode(parts[1])));
    if (!payload || typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch { return null; }
}

/** Vérifie une signature HMAC (comparaison à temps constant, assurée par WebCrypto). */
async function verifySig(secret, data, sigB64) {
  try { return await crypto.subtle.verify("HMAC", await hmacKey(secret, ["verify"]), b64urlDecode(sigB64), ENC.encode(data)); }
  catch { return false; }
}

function randomToken(bytes = 16) {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

function ids(value) {
  return String(value || "").split(",").map((s) => s.trim()).filter((s) => /^\d{5,25}$/.test(s));
}

function clean(value, max) {
  return String(value ?? "").replace(/[^\S\n]+/g, " ").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim().slice(0, max);
}

const oneLine = (value, max) => clean(value, max).replace(/\n/g, " ");

/** Lit le corps JSON d'une requête : { body } ou { status, error }. */
async function readObject(request) {
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return { status: 413, error: "Requête trop volumineuse." };
  let body;
  try { body = await request.json(); } catch { return { status: 400, error: "Requête invalide." }; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { status: 400, error: "Requête invalide." };
  return { body };
}

function parseCommand(body) {
  const platform = String(body.platform || "");
  const value = { platform, cat: oneLine(body.cat, 40) || "Général", cmd: oneLine(body.cmd, 80), descr: clean(body.descr, 300), example: oneLine(body.example, 120), min_level: String(body.min_level || "support") };
  if (!PLATFORMS.includes(platform)) return { error: "Type de commande invalide (Discord ou FiveM)." };
  if (!LEVEL_NAMES.includes(value.min_level)) return { error: "Niveau de visibilité invalide." };
  if (!value.cmd) return { error: "La commande est obligatoire." };
  if (!value.descr) return { error: "La description est obligatoire." };
  return { value };
}

/** Paliers d'un barème : 1 à 5 étapes { type, detail }. Un ban temporaire exige une durée, « autre » exige un texte. */
function parsePenalty(body) {
  const value = { name: oneLine(body.name, 100), cat: oneLine(body.cat, 40) || "Général", notes: clean(body.notes, 300), steps: [] };
  if (!value.name) return { error: "Le nom de l'infraction est obligatoire." };
  if (!Array.isArray(body.steps) || !body.steps.length) return { error: "Ajoutez au moins un palier de sanction." };
  if (body.steps.length > MAX_STEPS) return { error: `Maximum ${MAX_STEPS} paliers.` };
  for (const [i, raw] of body.steps.entries()) {
    const step = raw && typeof raw === "object" ? raw : {};
    const type = String(step.type || "");
    const detail = oneLine(step.detail, 40);
    if (!STEP_TYPES.includes(type)) return { error: `Palier ${i + 1} : type de sanction invalide.` };
    if (type === "ban_temp" && !detail) return { error: `Palier ${i + 1} : la durée est obligatoire pour un bannissement temporaire.` };
    if (type === "autre" && !detail) return { error: `Palier ${i + 1} : précisez la sanction.` };
    value.steps.push({ type, detail: type === "ban_def" ? "" : detail });
  }
  return { value };
}

/** Relit les paliers stockés (JSON) en écartant tout ce qui ne serait pas valide. */
function readSteps(json) {
  try {
    const list = JSON.parse(json);
    return (Array.isArray(list) ? list : []).slice(0, MAX_STEPS)
      .filter((s) => s && STEP_TYPES.includes(s.type))
      .map((s) => ({ type: s.type, detail: oneLine(s.detail, 40) }));
  } catch { return []; }
}

function parseMember(body) {
  const kind = String(body.kind || "other");
  if (!KINDS.includes(kind)) return { error: "Case de l'organigramme invalide." };
  const node = NODES[kind];
  const position = body.position === "" || body.position == null ? 0 : Number(body.position);
  const value = {
    name: oneLine(body.name, 40),
    role: oneLine(body.role, 60) || node.label,
    grp: node.grp,
    tier: node.tier,
    kind,
    position,
  };
  if (!value.name) return { error: "Le nom est obligatoire." };
  if (!Number.isInteger(position) || position < 0 || position > 99) return { error: "L'ordre doit être un nombre entier de 0 à 99." };
  return { value };
}

const SECURITY = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...SECURITY, ...headers } });
}

function text(message, status = 200) {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", ...SECURITY } });
}

const CLEAR_COOKIE = "sl_oauth=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax";

function redirect(location, cookie) {
  const headers = { location, ...SECURITY };
  if (cookie) headers["set-cookie"] = cookie;
  return new Response(null, { status: 302, headers });
}

/** Liste des réglages manquants (sert à guider l'installation). */
function missingConfig(env) {
  const missing = [];
  for (const k of ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_GUILD_ID", "PANEL_URL", "ALLOWED_ORIGIN"]) if (!env[k]) missing.push(k);
  if (String(env.SESSION_SECRET || "").length < 32) missing.push("SESSION_SECRET (32 caractères minimum)");
  if (!["ROLES_SUPPORT", "ROLES_MOD", "ROLES_ADMIN", "ROLES_MANAGER", "ROLES_FOUNDER"].some((k) => ids(env[k]).length)) missing.push("ROLES_MOD ou ROLES_ADMIN");
  if (!env.DB) missing.push("DB (liaison D1)");
  return missing;
}

async function audit(env, user, action, target = "") {
  await env.DB.prepare("INSERT INTO audit (at, staff_id, staff_name, action, target) VALUES (?, ?, ?, ?, ?)")
    .bind(new Date().toISOString(), user.sub, user.name, action, clean(target, 120)).run();
}

/* ---------- Connexion Discord ---------- */

async function login(request, env) {
  const nonce = randomToken();
  const state = `${nonce}.${b64urlEncode(await hmac(env.SESSION_SECRET, nonce))}`;
  const auth = new URL("https://discord.com/oauth2/authorize");
  auth.search = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    response_type: "code",
    redirect_uri: new URL("/callback", request.url).href,
    scope: "identify guilds.members.read",
    state,
  }).toString();
  return redirect(auth.href, `sl_oauth=${nonce}; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax`);
}

const LEVEL_LABEL = { founder: "Fondateur", manager: "Manager", admin: "Admin", mod: "Modérateur", support: "Support" };

/**
 * À la connexion, la personne apparaît dans « À placer » de l'organigramme (si elle n'y figure pas déjà) et sa photo
 * Discord est mémorisée. Une fiche créée à la main qui porte déjà son nom (pseudo du serveur, nom affiché ou nom
 * d'utilisateur) est simplement reliée à son compte. Ne bloque jamais la connexion (voir l'appel).
 */
async function syncOrg(env, user, member, level) {
  const id = String(user.id);
  const avatar = user.avatar && /^\w{1,64}$/.test(user.avatar) ? user.avatar : null;
  const known = await env.DB.prepare("SELECT id FROM org WHERE discord_id = ? LIMIT 1").bind(id).first();
  if (known) {
    await env.DB.prepare("UPDATE org SET avatar = ? WHERE discord_id = ?").bind(avatar, id).run();
    return;
  }
  const names = [...new Set([member.nick, user.global_name, user.username].map((n) => clean(n, 40)).filter((n) => n && n !== "Staff"))];
  for (const n of names) {
    const out = await env.DB.prepare("UPDATE org SET discord_id = ?, avatar = ? WHERE discord_id IS NULL AND name = ? COLLATE NOCASE").bind(id, avatar, n).run();
    if (out.meta && out.meta.changes) return;
  }
  let name = names[0] || "Staff";
  const clash = await env.DB.prepare("SELECT 1 AS x FROM org WHERE name = ? COLLATE NOCASE AND kind = 'other' LIMIT 1").bind(name).first();
  if (clash) name = clean(`${name.slice(0, 33)} (${id.slice(-4)})`, 40);
  const last = await env.DB.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS n FROM org WHERE kind = 'other'").first();
  const pos = Math.min(99, Number(last && last.n) || 0);
  await env.DB.prepare("INSERT INTO org (name, role, grp, tier, kind, position, discord_id, avatar) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(name, LEVEL_LABEL[level], NODES.other.grp, NODES.other.tier, "other", pos, id, avatar).run();
  await audit(env, { sub: id, name }, "organigramme : ajouté à la connexion", name);
}

async function callback(request, env, url) {
  const fail = (code) => redirect(`${env.PANEL_URL}#error=${code}`, CLEAR_COOKIE);

  if (url.searchParams.get("error")) return fail("denied");

  // Anti-falsification : l'état renvoyé par Discord doit être signé par nous ET correspondre au cookie.
  const state = String(url.searchParams.get("state") || "");
  const [nonce, sig] = state.split(".");
  const cookie = /(?:^|;\s*)sl_oauth=([\w-]+)/.exec(request.headers.get("cookie") || "");
  if (!nonce || !sig || !cookie || cookie[1] !== nonce || !(await verifySig(env.SESSION_SECRET, nonce, sig))) return fail("state");

  const code = url.searchParams.get("code");
  if (!code) return fail("oauth");

  let access;
  try {
    const res = await fetch(`${DISCORD}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: new URL("/callback", request.url).href,
      }),
    });
    if (!res.ok) return fail("oauth");
    access = (await res.json()).access_token;
    if (!access) return fail("oauth");
  } catch { return fail("oauth"); }

  let user, member;
  try {
    const headers = { authorization: `Bearer ${access}` };
    const meRes = await fetch(`${DISCORD}/users/@me`, { headers });
    if (!meRes.ok) return fail("oauth");
    user = await meRes.json();
    const memRes = await fetch(`${DISCORD}/users/@me/guilds/${env.DISCORD_GUILD_ID}/member`, { headers });
    if (memRes.status === 404 || memRes.status === 403) return fail("not_member");
    if (!memRes.ok) return fail("oauth");
    member = await memRes.json();
  } catch { return fail("oauth"); }

  if (!user || !/^\d{5,25}$/.test(String(user.id))) return fail("oauth");
  const roles = Array.isArray(member.roles) ? member.roles.map(String) : [];
  // Le niveau le plus élevé l'emporte : administration, puis modération, puis support.
  const has = (list) => roles.some((r) => ids(list).includes(r));
  const level = has(env.ROLES_FOUNDER) ? "founder" : has(env.ROLES_MANAGER) ? "manager" : has(env.ROLES_ADMIN) ? "admin"
    : has(env.ROLES_MOD) ? "mod" : has(env.ROLES_SUPPORT) ? "support" : null;
  if (!level) return fail("not_staff");

  const name = clean(member.nick || user.global_name || user.username || "Staff", 40) || "Staff";
  const avatar = user.avatar && /^[\w]+$/.test(user.avatar) ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null;
  const now = Math.floor(Date.now() / 1000);
  const hours = Math.min(24, Math.max(1, Number(env.SESSION_HOURS) || 8));
  const token = await signToken({ sub: String(user.id), name, avatar, lvl: level, iat: now, exp: now + hours * 3600 }, env.SESSION_SECRET);

  try {
    await audit(env, { sub: String(user.id), name }, "connexion", { founder: "fondateur", manager: "responsable", admin: "administration", mod: "modération", support: "support" }[level]);
  } catch { return fail("server"); }   // base absente ou schema.sql non exécuté
  try { await syncOrg(env, user, member, level); } catch { /* organigramme pas encore migré : la connexion n'en dépend pas */ }
  return redirect(`${env.PANEL_URL}#token=${token}`, CLEAR_COOKIE);
}

/* ---------- API (jeton obligatoire) ---------- */

async function api(request, env, url) {
  const allowed = String(env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get("Origin") || "";
  const cors = allowed.includes(origin)
    ? { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS", "access-control-allow-headers": "authorization, content-type", vary: "Origin" }
    : {};

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (origin && !allowed.includes(origin)) return json({ error: "Origine non autorisée." }, 403);

  const bearer = /^Bearer (\S+)$/.exec(request.headers.get("authorization") || "");
  const user = bearer ? await verifyToken(bearer[1], env.SESSION_SECRET) : null;
  if (!user || !RANK[user.lvl]) return json({ error: "Session invalide ou expirée." }, 401, cors);

  const reply = (body, status = 200) => json(body, status, cors);
  const path = url.pathname;

  if (path === "/api/me" && request.method === "GET") {
    return reply({ id: user.sub, name: user.name, avatar: user.avatar, level: user.lvl, expires: user.exp });
  }

  // Le journal contient des données sur des joueurs : le niveau « support » n'y a pas accès.
  const needMod = () => (RANK[user.lvl] < RANK.mod ? reply({ error: "Réservé à la modération et à l'administration." }, 403) : null);

  if (path === "/api/sanctions" && request.method === "GET") {
    const denied = needMod();
    if (denied) return denied;
    const q = clean(url.searchParams.get("q"), 80);
    let sql = "SELECT id, player, ref, type, reason, duration, staff_name, created_at FROM sanctions WHERE deleted_at IS NULL";
    const args = [];
    if (q) {
      sql += " AND (player LIKE ? ESCAPE '\\' OR ref LIKE ? ESCAPE '\\' OR reason LIKE ? ESCAPE '\\')";
      const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      args.push(like, like, like);
    }
    sql += " ORDER BY id DESC LIMIT 100";
    const { results } = await env.DB.prepare(sql).bind(...args).all();
    return reply({ sanctions: results });
  }

  if (path === "/api/sanctions" && request.method === "POST") {
    const denied = needMod();
    if (denied) return denied;
    const input = await readObject(request);
    if (!input.body) return reply({ error: input.error }, input.status);
    const body = input.body;
    const player = clean(body.player, 80);
    const ref = clean(body.ref, 80);
    const type = String(body.type || "");
    const reason = clean(body.reason, 500);
    const duration = clean(body.duration, 40);
    if (!player) return reply({ error: "Le joueur est obligatoire." }, 400);
    if (!TYPES.includes(type)) return reply({ error: "Type de sanction invalide." }, 400);
    if (!reason) return reply({ error: "Le motif est obligatoire." }, 400);
    if (type === "ban_temp" && !duration) return reply({ error: "La durée est obligatoire pour un bannissement temporaire." }, 400);
    const res = await env.DB.prepare("INSERT INTO sanctions (player, ref, type, reason, duration, staff_id, staff_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(player, ref, type, reason, type === "ban_temp" ? duration : "", user.sub, user.name, new Date().toISOString()).run();
    const id = res.meta && res.meta.last_row_id;
    await audit(env, user, "sanction ajoutée", `#${id} ${player} (${type})`);
    return reply({ ok: true, id }, 201);
  }

  const del = /^\/api\/sanctions\/(\d{1,12})$/.exec(path);
  if (del && request.method === "DELETE") {
    if (RANK[user.lvl] < RANK.admin) return reply({ error: "Réservé à l'administration." }, 403);
    const id = Number(del[1]);
    const res = await env.DB.prepare("UPDATE sanctions SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL")
      .bind(new Date().toISOString(), user.sub, id).run();
    if (!res.meta || !res.meta.changes) return reply({ error: "Sanction introuvable." }, 404);
    await audit(env, user, "sanction supprimée", `#${id}`);
    return reply({ ok: true });
  }

  if (path === "/api/audit" && request.method === "GET") {
    if (RANK[user.lvl] < RANK.admin) return reply({ error: "Réservé à l'administration." }, 403);
    const { results } = await env.DB.prepare("SELECT at, staff_name, action, target FROM audit ORDER BY id DESC LIMIT 100").all();
    return reply({ audit: results });
  }

  /* --- Commandes et organigramme : lecture pour tout le staff, écriture pour l'administration --- */
  const RESOURCES = {
    penalties: {
      list: "SELECT id, cat, name, steps, notes FROM penalties ORDER BY cat COLLATE NOCASE, name COLLATE NOCASE, id",
      shape: (rows) => rows.map((r) => ({ ...r, steps: readSteps(r.steps) })),
      parse: parsePenalty, label_of: (v) => v.name,
      insert: ["INSERT INTO penalties (cat, name, steps, notes) VALUES (?, ?, ?, ?)", (v) => [v.cat, v.name, JSON.stringify(v.steps), v.notes]],
      update: ["UPDATE penalties SET cat = ?, name = ?, steps = ?, notes = ? WHERE id = ?", (v, id) => [v.cat, v.name, JSON.stringify(v.steps), v.notes, id]],
      name: "SELECT name AS label FROM penalties WHERE id = ?", remove: "DELETE FROM penalties WHERE id = ?",
      actions: { add: "barème : cas ajouté", edit: "barème : cas modifié", del: "barème : cas supprimé" },
    },
    commands: {
      // Chaque commande a un niveau minimal (min_level) : on ne reçoit que celles de son niveau et des niveaux inférieurs.
      scoped: true,
      list: "SELECT id, platform, cat, cmd, descr, example, min_level FROM commands WHERE min_level IN ({levels}) ORDER BY platform, cat COLLATE NOCASE, id",
      parse: parseCommand, label: "commande",
      // Dans le journal d'activité (lisible par l'administration), le nom d'une commande réservée aux niveaux supérieurs est masqué.
      label_of: (v) => (RANK[v.min_level] > RANK.admin ? "commande réservée aux niveaux supérieurs" : v.cmd),
      labelRow: (row) => (RANK[row.lvl] > RANK.admin ? "commande réservée aux niveaux supérieurs" : row.label),
      insert: ["INSERT INTO commands (platform, cat, cmd, descr, example, min_level) VALUES (?, ?, ?, ?, ?, ?)", (v) => [v.platform, v.cat, v.cmd, v.descr, v.example, v.min_level]],
      update: ["UPDATE commands SET platform = ?, cat = ?, cmd = ?, descr = ?, example = ?, min_level = ? WHERE id = ?", (v, id) => [v.platform, v.cat, v.cmd, v.descr, v.example, v.min_level, id]],
      name: "SELECT cmd AS label, min_level AS lvl FROM commands WHERE id = ?", remove: "DELETE FROM commands WHERE id = ?",
      actions: { add: "commande ajoutée", edit: "commande modifiée", del: "commande supprimée" },
    },
    org: {
      list: "SELECT id, name, role, grp, tier, kind, position, discord_id, avatar FROM org ORDER BY tier, position, id",
      listFallback: "SELECT id, name, role, grp, tier, kind, position FROM org ORDER BY tier, position, id",   // avant migration-organigramme-discord.sql
      // On joint la liste des cases connues : le panel s'en sert pour repérer un relais pas à jour.
      extra: () => ({ nodes: KINDS }),
      parse: parseMember, label_of: (v) => v.name,
      insert: ["INSERT INTO org (name, role, grp, tier, kind, position) VALUES (?, ?, ?, ?, ?, ?)", (v) => [v.name, v.role, v.grp, v.tier, v.kind, v.position]],
      update: ["UPDATE org SET name = ?, role = ?, grp = ?, tier = ?, kind = ?, position = ? WHERE id = ?", (v, id) => [v.name, v.role, v.grp, v.tier, v.kind, v.position, id]],
      name: "SELECT name AS label FROM org WHERE id = ?", remove: "DELETE FROM org WHERE id = ?",
      // Une personne peut être dans plusieurs cases, mais une seule fois dans la même.
      // Une copie (même nom, autre case) reprend le compte Discord et la photo de la personne.
      after: async (env, v, id) => {
        const src = await env.DB.prepare("SELECT discord_id, avatar FROM org WHERE name = ? COLLATE NOCASE AND discord_id IS NOT NULL AND id != ? LIMIT 1").bind(v.name, id).first();
        if (src) await env.DB.prepare("UPDATE org SET discord_id = ?, avatar = ? WHERE id = ?").bind(src.discord_id, src.avatar, id).run();
      },
      dup: ["SELECT id FROM org WHERE name = ? COLLATE NOCASE AND kind = ? AND id != ?", (v, id) => [v.name, v.kind, id], "Cette personne est déjà dans cette case."],
      actions: { add: "organigramme : membre ajouté", edit: "organigramme : membre modifié", del: "organigramme : membre retiré" },
    },
  };

  const listMatch = /^\/api\/(commands|org|penalties)$/.exec(path);
  const itemMatch = /^\/api\/(commands|org|penalties)\/(\d{1,12})$/.exec(path);
  const res = RESOURCES[(listMatch || itemMatch || [])[1]];

  if (res && listMatch && request.method === "GET") {
    let sql = res.list, args = [];
    if (res.scoped) {
      args = LEVEL_NAMES.filter((l) => RANK[l] <= RANK[user.lvl]);
      sql = sql.replace("{levels}", args.map(() => "?").join(", "));
    }
    const run = (q) => { const stmt = env.DB.prepare(q); return (args.length ? stmt.bind(...args) : stmt).all(); };
    let out;
    try { out = await run(sql); } catch (e) { if (!res.listFallback) throw e; out = await run(res.listFallback); }
    const { results } = out;
    return reply({ [listMatch[1]]: res.shape ? res.shape(results) : results, ...(res.extra ? res.extra() : {}) });
  }

  if (res && (listMatch ? request.method === "POST" : ["PUT", "DELETE"].includes(request.method))) {
    if (RANK[user.lvl] < RANK.admin) return reply({ error: "Réservé à l'administration." }, 403);

    if (request.method === "DELETE") {
      const id = Number(itemMatch[2]);
      const row = await env.DB.prepare(res.name).bind(id).first();
      if (!row || (res.scoped && RANK[row.lvl] > RANK[user.lvl])) return reply({ error: "Élément introuvable." }, 404);
      await env.DB.prepare(res.remove).bind(id).run();
      await audit(env, user, res.actions.del, res.labelRow ? res.labelRow(row) : row.label);
      return reply({ ok: true });
    }

    const input = await readObject(request);
    if (!input.body) return reply({ error: input.error }, input.status);
    const parsed = res.parse(input.body);
    if (parsed.error) return reply({ error: parsed.error }, 400);
    if (res.scoped && RANK[parsed.value.min_level] > RANK[user.lvl]) {
      return reply({ error: "Vous ne pouvez pas réserver une commande à un niveau supérieur au vôtre." }, 403);
    }

    if (res.dup) {
      const taken = await env.DB.prepare(res.dup[0]).bind(...res.dup[1](parsed.value, request.method === "PUT" ? Number(itemMatch[2]) : 0)).first();
      if (taken) return reply({ error: res.dup[2] }, 409);
    }

    if (request.method === "POST") {
      const out = await env.DB.prepare(res.insert[0]).bind(...res.insert[1](parsed.value)).run();
      if (res.after) { try { await res.after(env, parsed.value, out.meta && out.meta.last_row_id); } catch { /* base pas encore migrée */ } }
      await audit(env, user, res.actions.add, res.label_of(parsed.value));
      return reply({ ok: true, id: out.meta && out.meta.last_row_id }, 201);
    }

    const id = Number(itemMatch[2]);
    if (res.scoped) {
      const current = await env.DB.prepare(res.name).bind(id).first();
      if (!current || RANK[current.lvl] > RANK[user.lvl]) return reply({ error: "Élément introuvable." }, 404);
    }
    const out = await env.DB.prepare(res.update[0]).bind(...res.update[1](parsed.value, id)).run();
    if (!out.meta || !out.meta.changes) return reply({ error: "Élément introuvable." }, 404);
    await audit(env, user, res.actions.edit, res.label_of(parsed.value));
    return reply({ ok: true });
  }

  return reply({ error: "Introuvable." }, 404);
}

/* ---------- Point d'entrée ---------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/") return text("Panel staff – Santos Legacy RP");
      const missing = missingConfig(env);
      if (missing.length) {
        const preflight = request.method === "OPTIONS";
        return preflight ? new Response(null, { status: 204 }) : text(`Panel non configuré. Réglages manquants : ${missing.join(", ")}`, 500);
      }
      if (url.pathname === "/login" && request.method === "GET") return await login(request, env);
      if (url.pathname === "/callback" && request.method === "GET") return await callback(request, env, url);
      if (url.pathname.startsWith("/api/")) return await api(request, env, url);
      return text("Introuvable", 404);
    } catch {
      return json({ error: "Erreur interne." }, 500);
    }
  },
};
