/**
 * Panel staff de Santos Legacy RP (Cloudflare Worker).
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
 *   ROLES_ADMIN             identifiants des rôles « administration » (admins, manager, fondateur…)
 *   SESSION_SECRET          longue chaîne aléatoire (32 caractères minimum)         (secret)
 *   PANEL_URL               adresse de la page staff, ex. https://…github.io/Serveur-Five-M-/staff.html
 *   ALLOWED_ORIGIN          adresse du site, ex. https://bcloes93-hash.github.io
 *   SESSION_HOURS           (optionnel) durée d'une session, 8 par défaut
 *   DB                      base de données D1 (liaison, voir panel/schema.sql)
 */

const ENC = new TextEncoder();
const DEC = new TextDecoder();

const TYPES = ["avertissement", "expulsion", "ban_temp", "ban_def", "note"];
const RANK = { mod: 1, admin: 2 };
const JWT_HEAD = { alg: "HS256", typ: "JWT" };
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
  if (!ids(env.ROLES_MOD).length && !ids(env.ROLES_ADMIN).length) missing.push("ROLES_MOD ou ROLES_ADMIN");
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
  const level = roles.some((r) => ids(env.ROLES_ADMIN).includes(r)) ? "admin" : roles.some((r) => ids(env.ROLES_MOD).includes(r)) ? "mod" : null;
  if (!level) return fail("not_staff");

  const name = clean(member.nick || user.global_name || user.username || "Staff", 40) || "Staff";
  const avatar = user.avatar && /^[\w]+$/.test(user.avatar) ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null;
  const now = Math.floor(Date.now() / 1000);
  const hours = Math.min(24, Math.max(1, Number(env.SESSION_HOURS) || 8));
  const token = await signToken({ sub: String(user.id), name, avatar, lvl: level, iat: now, exp: now + hours * 3600 }, env.SESSION_SECRET);

  try {
    await audit(env, { sub: String(user.id), name }, "connexion", level === "admin" ? "administration" : "modération");
  } catch { return fail("server"); }   // base absente ou schema.sql non exécuté
  return redirect(`${env.PANEL_URL}#token=${token}`, CLEAR_COOKIE);
}

/* ---------- API (jeton obligatoire) ---------- */

async function api(request, env, url) {
  const allowed = String(env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get("Origin") || "";
  const cors = allowed.includes(origin)
    ? { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", "access-control-allow-headers": "authorization, content-type", vary: "Origin" }
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

  if (path === "/api/sanctions" && request.method === "GET") {
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
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return reply({ error: "Requête trop volumineuse." }, 413);
    let body;
    try { body = await request.json(); } catch { return reply({ error: "Requête invalide." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "Requête invalide." }, 400);
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
