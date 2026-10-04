// Tests du panel staff : `node --test panel/worker.test.mjs` (Node 22 ou plus récent, aucune dépendance).
// La base D1 est simulée avec une vraie base SQLite en mémoire (le schéma réel est exécuté).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import panel from "./worker.mjs";

const SITE = "https://bcloes93-hash.github.io";
const PANEL_URL = `${SITE}/Serveur-Five-M-/staff.html`;
const W = "https://staff.example.workers.dev";
const GUILD = "222222222222222222";
const ROLE_MOD = "333333333333333333";
const ROLE_ADMIN = "444444444444444444";
const ROLE_ADMIN2 = "555555555555555555";

function makeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  const wrap = (stmt, args) => ({
    async run() { const r = stmt.run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    async all() { return { success: true, results: stmt.all(...args).map((r) => ({ ...r })) }; },
    async first() { const r = stmt.get(...args); return r ? { ...r } : null; },
  });
  return { raw: db, prepare(sql) { const stmt = db.prepare(sql); return { ...wrap(stmt, []), bind: (...args) => wrap(stmt, args) }; } };
}

const makeEnv = (over = {}) => ({
  DISCORD_CLIENT_ID: "111111111111111111", DISCORD_CLIENT_SECRET: "client-secret", DISCORD_GUILD_ID: GUILD,
  ROLES_MOD: ROLE_MOD, ROLES_ADMIN: `${ROLE_ADMIN}, ${ROLE_ADMIN2}`,
  SESSION_SECRET: "k".repeat(48), PANEL_URL, ALLOWED_ORIGIN: SITE, DB: makeD1(), ...over,
});

/** Faux Discord. `member`: objet du membre, ou null pour « n'est pas dans le serveur ». */
function fakeDiscord({ member = { roles: [ROLE_MOD], nick: null }, tokenOk = true, userId = "999999999999999999" } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.endsWith("/oauth2/token")) return tokenOk ? Response.json({ access_token: "AT" }) : new Response("{}", { status: 400 });
    if (u.endsWith("/users/@me")) return Response.json({ id: userId, username: "jaguuar", global_name: "Jaguuar_", avatar: "abc123" });
    if (u.endsWith(`/users/@me/guilds/${GUILD}/member`)) return member ? Response.json(member) : new Response("{}", { status: 404 });
    return new Response("?", { status: 500 });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** Parcours complet : /login puis /callback. Retourne l'adresse de redirection finale et le jeton éventuel. */
async function connect(env, discordOpts = {}) {
  const d = fakeDiscord(discordOpts);
  try {
    const r1 = await panel.fetch(new Request(`${W}/login`), env);
    const state = new URL(r1.headers.get("location")).searchParams.get("state");
    const nonce = /sl_oauth=([^;]+)/.exec(r1.headers.get("set-cookie"))[1];
    const r2 = await panel.fetch(new Request(`${W}/callback?code=abc&state=${state}`, { headers: { cookie: `sl_oauth=${nonce}` } }), env);
    const location = r2.headers.get("location");
    const token = /#token=(.+)$/.exec(location)?.[1] ?? null;
    return { location, token, discord: d.calls, r1, r2 };
  } finally { d.restore(); }
}

const call = (env, path, { method = "GET", token, body, origin = SITE } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;
  if (body) headers["content-type"] = "application/json";
  return panel.fetch(new Request(`${W}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
};

async function staffToken(env, roles, opts = {}) {
  const { token } = await connect(env, { member: { roles }, ...opts });
  assert.ok(token, "connexion attendue");
  return token;
}

/* ---------- Connexion Discord ---------- */

test("/login : redirige vers Discord avec les bons réglages et un état signé", async () => {
  const env = makeEnv();
  const r = await panel.fetch(new Request(`${W}/login`), env);
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get("location"));
  assert.equal(loc.origin + loc.pathname, "https://discord.com/oauth2/authorize");
  assert.equal(loc.searchParams.get("client_id"), env.DISCORD_CLIENT_ID);
  assert.equal(loc.searchParams.get("scope"), "identify guilds.members.read");
  assert.equal(loc.searchParams.get("redirect_uri"), `${W}/callback`);
  assert.equal(loc.searchParams.get("response_type"), "code");
  assert.match(loc.searchParams.get("state"), /^[\w-]+\.[\w-]+$/);
  const cookie = r.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/);
  assert.ok(!loc.href.includes(env.DISCORD_CLIENT_SECRET), "le secret ne sort jamais");
});

test("membre modération : accès accordé, niveau « mod », connexion journalisée", async () => {
  const env = makeEnv();
  const { location, token, discord, r2 } = await connect(env, { member: { roles: [ROLE_MOD], nick: "Moncef" } });
  assert.ok(location.startsWith(`${PANEL_URL}#token=`));
  assert.match(r2.headers.get("set-cookie"), /Max-Age=0/, "cookie temporaire effacé");
  const me = await (await call(env, "/api/me", { token })).json();
  assert.equal(me.level, "mod"); assert.equal(me.name, "Moncef"); assert.equal(me.id, "999999999999999999");
  assert.match(me.avatar, /^https:\/\/cdn\.discordapp\.com\/avatars\/999999999999999999\/abc123\.png/);
  const tokenCall = discord.find((c) => c.url.endsWith("/oauth2/token"));
  assert.ok(String(tokenCall.init.body).includes("client_secret=client-secret"), "échange du code côté serveur");
  assert.equal(env.DB.raw.prepare("SELECT action FROM audit").all()[0].action, "connexion");
});

test("rôle administration (n'importe lequel de la liste) : niveau « admin » ; l'admin l'emporte", async () => {
  const env = makeEnv();
  const t1 = await staffToken(env, [ROLE_ADMIN2]);
  assert.equal((await (await call(env, "/api/me", { token: t1 })).json()).level, "admin");
  const t2 = await staffToken(env, [ROLE_MOD, ROLE_ADMIN]);
  assert.equal((await (await call(env, "/api/me", { token: t2 })).json()).level, "admin");
});

test("accès refusé : pas dans le serveur, pas de rôle staff, refus de l'utilisateur, erreur Discord", async () => {
  const env = makeEnv();
  assert.equal((await connect(env, { member: null })).location, `${PANEL_URL}#error=not_member`);
  assert.equal((await connect(env, { member: { roles: ["777777777777777777"] } })).location, `${PANEL_URL}#error=not_staff`);
  assert.equal((await connect(env, { member: { roles: [] } })).location, `${PANEL_URL}#error=not_staff`);
  assert.equal((await connect(env, { tokenOk: false })).location, `${PANEL_URL}#error=oauth`);
  const denied = await panel.fetch(new Request(`${W}/callback?error=access_denied`), env);
  assert.equal(denied.headers.get("location"), `${PANEL_URL}#error=denied`);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM audit").get().n, 0, "aucune connexion refusée n'est journalisée comme réussie");
});

test("anti-falsification de la connexion : état absent, forgé ou ne correspondant pas au cookie", async () => {
  const env = makeEnv();
  const d = fakeDiscord();
  try {
    const r1 = await panel.fetch(new Request(`${W}/login`), env);
    const state = new URL(r1.headers.get("location")).searchParams.get("state");
    const nonce = state.split(".")[0];
    const go = (qs, cookie) => panel.fetch(new Request(`${W}/callback?${qs}`, { headers: cookie ? { cookie } : {} }), env);
    assert.equal((await go(`code=a&state=${state}`)).headers.get("location"), `${PANEL_URL}#error=state`, "sans cookie");
    assert.equal((await go(`code=a&state=${state}`, "sl_oauth=autre")).headers.get("location"), `${PANEL_URL}#error=state`, "cookie différent");
    assert.equal((await go(`code=a&state=${nonce}.forge`, `sl_oauth=${nonce}`)).headers.get("location"), `${PANEL_URL}#error=state`, "signature forgée");
    assert.equal((await go(`code=a`, `sl_oauth=${nonce}`)).headers.get("location"), `${PANEL_URL}#error=state`, "sans état");
    assert.equal(d.calls.length, 0, "Discord n'est jamais appelé avant la validation de l'état");
  } finally { d.restore(); }
});

test("réglages manquants : message d'aide sans dévoiler de secret ; la racine reste accessible", async () => {
  const env = makeEnv({ DISCORD_CLIENT_SECRET: "", SESSION_SECRET: "court", ROLES_MOD: "", ROLES_ADMIN: "", DB: undefined });
  const r = await panel.fetch(new Request(`${W}/login`), env);
  assert.equal(r.status, 500);
  const body = await r.text();
  for (const k of ["DISCORD_CLIENT_SECRET", "SESSION_SECRET", "ROLES_MOD", "DB"]) assert.ok(body.includes(k), k);
  assert.ok(!body.includes("court"));
  assert.equal((await panel.fetch(new Request(`${W}/`), env)).status, 200);
});

test("durée de session configurable", async () => {
  const env = makeEnv({ SESSION_HOURS: "2" });
  const token = await staffToken(env, [ROLE_MOD]);
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  assert.equal(payload.exp - payload.iat, 2 * 3600);
});

/* ---------- Sécurité des jetons ---------- */

test("jetons falsifiés, expirés ou signés avec un autre secret : refusés", async () => {
  const env = makeEnv();
  const token = await staffToken(env, [ROLE_MOD]);
  const [h, p, s] = token.split(".");
  const forged = (obj) => `${h}.${Buffer.from(JSON.stringify(obj)).toString("base64url")}.${s}`;
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());

  assert.equal((await call(env, "/api/me", { token })).status, 200);
  assert.equal((await call(env, "/api/me", { token: forged({ ...payload, lvl: "admin" }) })).status, 401, "montée de niveau");
  assert.equal((await call(env, "/api/me", { token: forged({ ...payload, exp: 4102444800 }) })).status, 401, "prolongation");
  assert.equal((await call(env, "/api/me", { token: `${h}.${p}.` })).status, 401, "signature vide");
  assert.equal((await call(env, "/api/me", { token: `${Buffer.from('{"alg":"none"}').toString("base64url")}.${p}.` })).status, 401, "alg none");
  assert.equal((await call(env, "/api/me", { token: "n'importe quoi" })).status, 401);
  assert.equal((await call(env, "/api/me", { token: undefined })).status, 401);
  assert.equal((await call({ ...env, SESSION_SECRET: "z".repeat(48) }, "/api/me", { token })).status, 401, "autre secret");

  const expiredEnv = makeEnv();
  const realNow = Date.now;
  const t = await staffToken(expiredEnv, [ROLE_MOD]);
  Date.now = () => realNow() + 9 * 3600 * 1000;
  try { assert.equal((await call(expiredEnv, "/api/me", { token: t })).status, 401, "expiré après 8 h"); } finally { Date.now = realNow; }
});

test("CORS : seul le site autorisé peut appeler l'API depuis un navigateur", async () => {
  const env = makeEnv();
  const token = await staffToken(env, [ROLE_MOD]);
  const ok = await call(env, "/api/me", { token });
  assert.equal(ok.headers.get("access-control-allow-origin"), SITE);
  assert.equal((await call(env, "/api/me", { token, origin: "https://pirate.example" })).status, 403);
  const pre = await panel.fetch(new Request(`${W}/api/sanctions`, { method: "OPTIONS", headers: { origin: SITE } }), env);
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("access-control-allow-headers"), /authorization/);
  assert.match(pre.headers.get("access-control-allow-methods"), /DELETE/);
});

/* ---------- Journal de sanctions ---------- */

const sanction = (over = {}) => ({ player: "Tony Santos", ref: "discord:123", type: "avertissement", reason: "RDM en ville", ...over });

test("ajout d'une sanction : enregistrée avec l'auteur issu du jeton (jamais du corps de la requête)", async () => {
  const env = makeEnv();
  const token = await staffToken(env, [ROLE_MOD]);
  const res = await call(env, "/api/sanctions", { method: "POST", token, body: sanction({ staff_name: "Usurpateur", staff_id: "1" }) });
  assert.equal(res.status, 201);
  const { id } = await res.json();
  assert.ok(id > 0);
  const list = (await (await call(env, "/api/sanctions", { token })).json()).sanctions;
  assert.equal(list.length, 1);
  assert.equal(list[0].player, "Tony Santos");
  assert.equal(list[0].staff_name, "Jaguuar_");
  assert.equal(env.DB.raw.prepare("SELECT staff_id FROM sanctions").get().staff_id, "999999999999999999");
});

test("validation : joueur, type, motif et durée du bannissement temporaire", async () => {
  const env = makeEnv();
  const token = await staffToken(env, [ROLE_MOD]);
  const post = (b) => call(env, "/api/sanctions", { method: "POST", token, body: b });
  assert.equal((await post(sanction({ player: "  " }))).status, 400);
  assert.equal((await post(sanction({ type: "pirate" }))).status, 400);
  assert.equal((await post(sanction({ type: undefined }))).status, 400);
  assert.equal((await post(sanction({ reason: "" }))).status, 400);
  assert.equal((await post(sanction({ type: "ban_temp" }))).status, 400, "durée obligatoire");
  assert.equal((await post(sanction({ type: "ban_temp", duration: "7 jours" }))).status, 201);
  assert.equal((await post(sanction({ type: "note", duration: "7 jours" }))).status, 201);
  const rows = env.DB.raw.prepare("SELECT type, duration FROM sanctions ORDER BY id").all();
  assert.deepEqual(rows.map((r) => [r.type, r.duration]), [["ban_temp", "7 jours"], ["note", ""]], "durée ignorée hors bannissement temporaire");
  const bad = await panel.fetch(new Request(`${W}/api/sanctions`, { method: "POST", headers: { authorization: `Bearer ${token}`, origin: SITE }, body: "pas du json" }), env);
  assert.equal(bad.status, 400);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM sanctions").get().n, 2);
});

test("textes tronqués aux longueurs prévues", async () => {
  const env = makeEnv();
  const token = await staffToken(env, [ROLE_MOD]);
  await call(env, "/api/sanctions", { method: "POST", token, body: sanction({ player: "p".repeat(500), reason: "r".repeat(5000) }) });
  const row = env.DB.raw.prepare("SELECT player, reason FROM sanctions").get();
  assert.equal(row.player.length, 80); assert.equal(row.reason.length, 500);
});

test("recherche : joueur, identifiant, motif ; les caractères % et _ sont traités littéralement", async () => {
  const env = makeEnv();
  const token = await staffToken(env, [ROLE_MOD]);
  const add = (b) => call(env, "/api/sanctions", { method: "POST", token, body: b });
  await add(sanction({ player: "Tony Santos", ref: "discord:111", reason: "RDM" }));
  await add(sanction({ player: "Marie Dupont", ref: "licence:abc", reason: "Troll à 100% du temps" }));
  await add(sanction({ player: "Paul_Durand", ref: "", reason: "VDM" }));
  const search = async (q) => (await (await call(env, `/api/sanctions?q=${encodeURIComponent(q)}`, { token })).json()).sanctions.map((s) => s.player);
  assert.deepEqual(await search("tony"), ["Tony Santos"]);
  assert.deepEqual(await search("licence:abc"), ["Marie Dupont"]);
  assert.deepEqual(await search("vdm"), ["Paul_Durand"]);
  assert.deepEqual(await search("100%"), ["Marie Dupont"], "% n'est pas un joker");
  assert.deepEqual(await search("%"), ["Marie Dupont"]);
  assert.deepEqual(await search("Paul_D"), ["Paul_Durand"]);
  assert.deepEqual(await search("P_ul"), [], "_ n'est pas un joker");
  assert.equal((await search("")).length, 3);
  assert.deepEqual(await search("introuvable"), []);
});

test("injection SQL : les textes sont stockés tels quels, les tables restent intactes", async () => {
  const env = makeEnv();
  const token = await staffToken(env, [ROLE_MOD]);
  const evil = "'); DROP TABLE sanctions; --";
  assert.equal((await call(env, "/api/sanctions", { method: "POST", token, body: sanction({ player: evil, reason: evil }) })).status, 201);
  const found = (await (await call(env, `/api/sanctions?q=${encodeURIComponent(evil)}`, { token })).json()).sanctions;
  assert.equal(found.length, 1);
  assert.equal(found[0].player, evil);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM sanctions").get().n, 1);
});

test("suppression : réservée à l'administration, « douce » (la ligne reste en base) et journalisée", async () => {
  const env = makeEnv();
  const mod = await staffToken(env, [ROLE_MOD]);
  const admin = await staffToken(env, [ROLE_ADMIN], { userId: "888888888888888888" });
  const { id } = await (await call(env, "/api/sanctions", { method: "POST", token: mod, body: sanction() })).json();

  assert.equal((await call(env, `/api/sanctions/${id}`, { method: "DELETE", token: mod })).status, 403, "un modérateur ne supprime pas");
  assert.equal((await call(env, `/api/sanctions/${id}`, { method: "DELETE", token: admin })).status, 200);
  assert.equal((await (await call(env, "/api/sanctions", { token: admin })).json()).sanctions.length, 0, "disparaît de la liste");
  const kept = env.DB.raw.prepare("SELECT deleted_at, deleted_by FROM sanctions WHERE id = ?").get(id);
  assert.ok(kept.deleted_at); assert.equal(kept.deleted_by, "888888888888888888");
  assert.equal((await call(env, `/api/sanctions/${id}`, { method: "DELETE", token: admin })).status, 404, "déjà supprimée");
  assert.equal((await call(env, "/api/sanctions/99999", { method: "DELETE", token: admin })).status, 404);
  assert.equal((await call(env, "/api/sanctions/abc", { method: "DELETE", token: admin })).status, 404);
  assert.equal((await call(env, "/api/sanctions/1;DROP", { method: "DELETE", token: admin })).status, 404);
});

test("journal d'activité : réservé à l'administration, du plus récent au plus ancien", async () => {
  const env = makeEnv();
  const mod = await staffToken(env, [ROLE_MOD]);
  const admin = await staffToken(env, [ROLE_ADMIN], { userId: "888888888888888888" });
  const { id } = await (await call(env, "/api/sanctions", { method: "POST", token: mod, body: sanction() })).json();
  await call(env, `/api/sanctions/${id}`, { method: "DELETE", token: admin });

  assert.equal((await call(env, "/api/audit", { token: mod })).status, 403);
  const { audit } = await (await call(env, "/api/audit", { token: admin })).json();
  assert.deepEqual(audit.map((a) => a.action), ["sanction supprimée", "sanction ajoutée", "connexion", "connexion"]);
  assert.match(audit[1].target, /Tony Santos/);
});

test("routes inconnues et méthodes non prévues", async () => {
  const env = makeEnv();
  const token = await staffToken(env, [ROLE_MOD]);
  assert.equal((await call(env, "/api/inconnue", { token })).status, 404);
  assert.equal((await call(env, "/api/me", { token, method: "POST" })).status, 404);
  assert.equal((await panel.fetch(new Request(`${W}/nimporte`), env)).status, 404);
});

test("corps de requête qui n'est pas un objet (null, tableau, nombre) : refus 400, pas d'erreur 500", async () => {
  const env = makeEnv();
  const token = await staffToken(env, [ROLE_MOD]);
  for (const raw of ["null", "[]", "42", '"texte"']) {
    const res = await panel.fetch(new Request(`${W}/api/sanctions`, { method: "POST", headers: { authorization: `Bearer ${token}`, origin: SITE }, body: raw }), env);
    assert.equal(res.status, 400, raw);
  }
});

test("base non initialisée (schema.sql oublié) : retour clair « error=server », aucun jeton délivré", async () => {
  const empty = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error("no such table: audit"); } }) }) };
  const { location, token } = await connect(makeEnv({ DB: empty }));
  assert.equal(location, `${PANEL_URL}#error=server`);
  assert.equal(token, null);
});

/* ---------- Commandes et organigramme ---------- */

const cmdBody = (over = {}) => ({ platform: "fivem", cat: "Modération", cmd: "/kick [joueur] [motif]", descr: "Expulse un joueur du serveur.", example: "/kick 12 spam", ...over });
const send = (env, path, token, method, body) => call(env, path, { method, token, body });

test("commandes et organigramme : refusés sans connexion, même en lecture", async () => {
  const env = makeEnv();
  for (const p of ["/api/commands", "/api/org"]) {
    assert.equal((await call(env, p)).status, 401, p);
    assert.equal((await call(env, p, { method: "POST", body: {} })).status, 401, p);
  }
});

test("commandes : tout le staff lit, seule l'administration ajoute, modifie et supprime", async () => {
  const env = makeEnv();
  const mod = await staffToken(env, [ROLE_MOD]);
  const admin = await staffToken(env, [ROLE_ADMIN], { userId: "888888888888888888" });

  assert.equal((await send(env, "/api/commands", mod, "POST", cmdBody())).status, 403, "un modérateur n'ajoute pas");
  const created = await send(env, "/api/commands", admin, "POST", cmdBody());
  assert.equal(created.status, 201);
  const { id } = await created.json();

  const listed = (await (await call(env, "/api/commands", { token: mod })).json()).commands;
  assert.equal(listed.length, 1, "un modérateur peut lire");
  assert.deepEqual({ ...listed[0], id: undefined }, { id: undefined, platform: "fivem", cat: "Modération", cmd: "/kick [joueur] [motif]", descr: "Expulse un joueur du serveur.", example: "/kick 12 spam" });

  assert.equal((await send(env, `/api/commands/${id}`, mod, "PUT", cmdBody({ cmd: "/x" }))).status, 403);
  assert.equal((await send(env, `/api/commands/${id}`, mod, "DELETE")).status, 403);
  assert.equal((await send(env, `/api/commands/${id}`, admin, "PUT", cmdBody({ cmd: "/ban [joueur]", platform: "discord" }))).status, 200);
  const after = (await (await call(env, "/api/commands", { token: admin })).json()).commands[0];
  assert.equal(after.cmd, "/ban [joueur]"); assert.equal(after.platform, "discord");

  assert.equal((await send(env, `/api/commands/${id}`, admin, "DELETE")).status, 200);
  assert.equal((await (await call(env, "/api/commands", { token: admin })).json()).commands.length, 0);
  assert.equal((await send(env, `/api/commands/${id}`, admin, "DELETE")).status, 404, "déjà supprimée");
  assert.equal((await send(env, "/api/commands/99999", admin, "PUT", cmdBody())).status, 404);
  assert.equal((await send(env, "/api/commands/abc", admin, "DELETE")).status, 404);

  const { audit } = await (await call(env, "/api/audit", { token: admin })).json();
  assert.deepEqual(audit.slice(0, 3).map((a) => a.action), ["commande supprimée", "commande modifiée", "commande ajoutée"], "toutes les modifications sont journalisées");
  assert.equal(audit[0].target, "/ban [joueur]");
});

test("commandes : validation, valeurs par défaut et tri", async () => {
  const env = makeEnv();
  const admin = await staffToken(env, [ROLE_ADMIN]);
  const post = (b) => send(env, "/api/commands", admin, "POST", b);
  assert.equal((await post(cmdBody({ platform: "autre" }))).status, 400);
  assert.equal((await post(cmdBody({ platform: undefined }))).status, 400);
  assert.equal((await post(cmdBody({ cmd: "  " }))).status, 400);
  assert.equal((await post(cmdBody({ descr: "" }))).status, 400);
  assert.equal((await post(null)).status, 400);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM commands").get().n, 0);

  await post(cmdBody({ cat: "", cmd: "/b", descr: "d", example: undefined }));
  await post(cmdBody({ platform: "discord", cat: "Tickets", cmd: "/ticket", descr: "d" }));
  await post(cmdBody({ cat: "admin", cmd: "/a", descr: "d" }));
  const rows = (await (await call(env, "/api/commands", { token: admin })).json()).commands;
  assert.deepEqual(rows.map((r) => `${r.platform}:${r.cat}:${r.cmd}`), ["discord:Tickets:/ticket", "fivem:admin:/a", "fivem:Général:/b"], "tri par type puis catégorie ; catégorie vide = Général");
  assert.equal(rows[2].example, "");

  await post(cmdBody({ cmd: "x".repeat(500), descr: "y".repeat(5000), cat: "c".repeat(500), example: "e".repeat(500) }));
  const long = env.DB.raw.prepare("SELECT cmd, descr, cat, example FROM commands ORDER BY id DESC LIMIT 1").get();
  assert.deepEqual([long.cmd.length, long.descr.length, long.cat.length, long.example.length], [80, 300, 40, 120]);
});

test("commandes : les textes sont stockés tels quels (SQL et HTML inoffensifs côté serveur)", async () => {
  const env = makeEnv();
  const admin = await staffToken(env, [ROLE_ADMIN]);
  const evil = "'); DROP TABLE commands; --";
  const html = '<img src=x onerror=alert(1)>';
  assert.equal((await send(env, "/api/commands", admin, "POST", cmdBody({ cmd: evil, descr: html }))).status, 201);
  const row = (await (await call(env, "/api/commands", { token: admin })).json()).commands[0];
  assert.equal(row.cmd, evil); assert.equal(row.descr, html);
});

const memberBody = (over = {}) => ({ name: "Jaguuar_", role: "Fondateur · Développeur", grp: "Direction", tier: 1, kind: "founder", position: 0, ...over });

test("organigramme : tout le staff lit, seule l'administration modifie ; tout est journalisé", async () => {
  const env = makeEnv();
  const mod = await staffToken(env, [ROLE_MOD]);
  const admin = await staffToken(env, [ROLE_ADMIN], { userId: "888888888888888888" });
  assert.equal((await send(env, "/api/org", mod, "POST", memberBody())).status, 403);
  const { id } = await (await send(env, "/api/org", admin, "POST", memberBody())).json();
  assert.equal((await (await call(env, "/api/org", { token: mod })).json()).org.length, 1, "lecture pour la modération");
  assert.equal((await send(env, `/api/org/${id}`, mod, "PUT", memberBody({ name: "X" }))).status, 403);
  assert.equal((await send(env, `/api/org/${id}`, mod, "DELETE")).status, 403);
  assert.equal((await send(env, `/api/org/${id}`, admin, "PUT", memberBody({ role: "Fondateur" }))).status, 200);
  assert.equal((await (await call(env, "/api/org", { token: admin })).json()).org[0].role, "Fondateur");
  assert.equal((await send(env, `/api/org/${id}`, admin, "DELETE")).status, 200);
  assert.equal((await send(env, `/api/org/${id}`, admin, "DELETE")).status, 404);
  const { audit } = await (await call(env, "/api/audit", { token: admin })).json();
  assert.deepEqual(audit.slice(0, 3).map((a) => a.action), ["organigramme : membre retiré", "organigramme : membre modifié", "organigramme : membre ajouté"]);
});

test("organigramme : validation et tri par niveau puis ordre", async () => {
  const env = makeEnv();
  const admin = await staffToken(env, [ROLE_ADMIN]);
  const post = (b) => send(env, "/api/org", admin, "POST", b);
  for (const bad of [{ name: "" }, { role: " " }, { grp: "" }, { tier: 0 }, { tier: 10 }, { tier: 1.5 }, { tier: "abc" }, { position: -1 }, { position: 100 }, { kind: "roi" }]) {
    assert.equal((await post(memberBody(bad))).status, 400, JSON.stringify(bad));
  }
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM org").get().n, 0);
  await post(memberBody({ name: "C", tier: 2, position: 1 }));
  await post(memberBody({ name: "B", tier: 2, position: 0 }));
  await post(memberBody({ name: "A", tier: 1 }));
  await post(memberBody({ name: "D", tier: "3", position: "", kind: undefined }));
  const rows = (await (await call(env, "/api/org", { token: admin })).json()).org;
  assert.deepEqual(rows.map((r) => r.name), ["A", "B", "C", "D"]);
  assert.equal(rows[3].kind, "other", "couleur par défaut"); assert.equal(rows[3].tier, 3);
});

test("organigramme pré-rempli avec seed.sql : l'équipe actuelle dans le bon ordre", async () => {
  const env = makeEnv();
  env.DB.raw.exec(readFileSync(new URL("./seed.sql", import.meta.url), "utf8"));
  const mod = await staffToken(env, [ROLE_MOD]);
  const rows = (await (await call(env, "/api/org", { token: mod })).json()).org;
  assert.deepEqual(rows.map((r) => `${r.tier}:${r.name}`), ["1:Jaguuar_", "2:Fumeurdefrap", "3:Taalback", "3:Isar", "3:Trafalgar", "4:Moncef"]);
  assert.deepEqual([...new Set(rows.map((r) => r.grp))], ["Direction", "Administration", "Modération"]);
});

/* ---------- Barème des sanctions ---------- */

const penaltyBody = (over = {}) => ({
  cat: "Roleplay", name: "RDM", notes: "Tuer sans raison RP.",
  steps: [{ type: "avertissement", detail: "" }, { type: "expulsion", detail: "" }, { type: "ban_temp", detail: "3 jours" }, { type: "ban_def", detail: "" }],
  ...over,
});

test("barème : refusé sans connexion ; le staff lit, seule l'administration modifie ; tout est journalisé", async () => {
  const env = makeEnv();
  assert.equal((await call(env, "/api/penalties")).status, 401);
  assert.equal((await call(env, "/api/penalties", { method: "POST", body: penaltyBody() })).status, 401);
  const mod = await staffToken(env, [ROLE_MOD]);
  const admin = await staffToken(env, [ROLE_ADMIN], { userId: "888888888888888888" });

  assert.equal((await send(env, "/api/penalties", mod, "POST", penaltyBody())).status, 403);
  const { id } = await (await send(env, "/api/penalties", admin, "POST", penaltyBody())).json();
  assert.ok(id > 0);

  const list = (await (await call(env, "/api/penalties", { token: mod })).json()).penalties;
  assert.equal(list.length, 1, "un modérateur peut lire");
  assert.deepEqual(list[0].steps, penaltyBody().steps, "les paliers reviennent sous forme de tableau, dans l'ordre");
  assert.equal(list[0].name, "RDM");

  assert.equal((await send(env, `/api/penalties/${id}`, mod, "PUT", penaltyBody({ name: "X" }))).status, 403);
  assert.equal((await send(env, `/api/penalties/${id}`, mod, "DELETE")).status, 403);
  assert.equal((await send(env, `/api/penalties/${id}`, admin, "PUT", penaltyBody({ name: "RDM modifié", steps: [{ type: "ban_def" }] }))).status, 200);
  const after = (await (await call(env, "/api/penalties", { token: admin })).json()).penalties[0];
  assert.equal(after.name, "RDM modifié"); assert.deepEqual(after.steps, [{ type: "ban_def", detail: "" }]);
  assert.equal((await send(env, `/api/penalties/${id}`, admin, "DELETE")).status, 200);
  assert.equal((await send(env, `/api/penalties/${id}`, admin, "DELETE")).status, 404);
  assert.equal((await send(env, "/api/penalties/99999", admin, "PUT", penaltyBody())).status, 404);

  const { audit } = await (await call(env, "/api/audit", { token: admin })).json();
  assert.deepEqual(audit.slice(0, 3).map((a) => a.action), ["barème : cas supprimé", "barème : cas modifié", "barème : cas ajouté"]);
});

test("barème : validation des paliers", async () => {
  const env = makeEnv();
  const admin = await staffToken(env, [ROLE_ADMIN]);
  const post = (b) => send(env, "/api/penalties", admin, "POST", b);
  const bad = [
    { name: " " }, { steps: [] }, { steps: undefined }, { steps: "avertissement" }, { steps: null },
    { steps: Array.from({ length: 6 }, () => ({ type: "avertissement" })) },
    { steps: [{ type: "pirate" }] }, { steps: [{}] }, { steps: ["avertissement"] }, { steps: [null] },
    { steps: [{ type: "avertissement" }, { type: "ban_temp", detail: "  " }] },
    { steps: [{ type: "autre" }] },
  ];
  for (const b of bad) assert.equal((await post(penaltyBody(b))).status, 400, JSON.stringify(b));
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM penalties").get().n, 0);

  assert.equal((await post(penaltyBody({ steps: Array.from({ length: 5 }, () => ({ type: "expulsion" })) }))).status, 201, "5 paliers acceptés");
  await post(penaltyBody({ cat: "", name: "N", steps: [{ type: "ban_def", detail: "ignoré" }, { type: "autre", detail: "  Retrait des gains  " }, { type: "avertissement", detail: "x".repeat(200) }] }));
  const row = (await (await call(env, "/api/penalties", { token: admin })).json()).penalties.find((p) => p.name === "N");
  assert.equal(row.cat, "Général");
  assert.deepEqual(row.steps.map((s) => s.type), ["ban_def", "autre", "avertissement"], "ordre conservé");
  assert.equal(row.steps[0].detail, "", "durée ignorée pour un ban définitif");
  assert.equal(row.steps[1].detail, "Retrait des gains", "texte nettoyé");
  assert.equal(row.steps[2].detail.length, 40, "texte tronqué");
});

test("barème : tri par catégorie puis par nom ; ligne corrompue en base sans casser la liste", async () => {
  const env = makeEnv();
  const admin = await staffToken(env, [ROLE_ADMIN]);
  const post = (b) => send(env, "/api/penalties", admin, "POST", b);
  await post(penaltyBody({ cat: "Roleplay", name: "Zèbre" }));
  await post(penaltyBody({ cat: "comportement", name: "Beta" }));
  await post(penaltyBody({ cat: "Roleplay", name: "alpha" }));
  env.DB.raw.prepare("INSERT INTO penalties (cat, name, steps) VALUES ('Z', 'Cassé', 'pas du json')").run();
  env.DB.raw.prepare("INSERT INTO penalties (cat, name, steps) VALUES ('Z', 'Piraté', ?)").run('[{"type":"<script>"},{"type":"ban_def","detail":"ok"}]');
  const res = await call(env, "/api/penalties", { token: admin });
  assert.equal(res.status, 200);
  const list = (await res.json()).penalties;
  assert.deepEqual(list.map((p) => p.name), ["Beta", "alpha", "Zèbre", "Cassé", "Piraté"]);
  assert.deepEqual(list[3].steps, []);
  assert.deepEqual(list[4].steps, [{ type: "ban_def", detail: "ok" }], "les paliers de type inconnu sont écartés, les autres conservés");
});

test("barème : textes stockés tels quels (SQL et HTML inoffensifs côté serveur)", async () => {
  const env = makeEnv();
  const admin = await staffToken(env, [ROLE_ADMIN]);
  const evil = "'); DROP TABLE penalties; --";
  assert.equal((await send(env, "/api/penalties", admin, "POST", penaltyBody({ name: evil, notes: "<img src=x onerror=alert(1)>", steps: [{ type: "autre", detail: "<b>x</b>" }] }))).status, 201);
  const row = (await (await call(env, "/api/penalties", { token: admin })).json()).penalties[0];
  assert.equal(row.name, evil); assert.equal(row.notes, "<img src=x onerror=alert(1)>"); assert.equal(row.steps[0].detail, "<b>x</b>");
});

test("barème proposé (seed-bareme.sql) : tous les cas et paliers sont valides", async () => {
  const env = makeEnv();
  env.DB.raw.exec(readFileSync(new URL("./seed-bareme.sql", import.meta.url), "utf8"));
  const mod = await staffToken(env, [ROLE_MOD]);
  const list = (await (await call(env, "/api/penalties", { token: mod })).json()).penalties;
  assert.equal(list.length, 13);
  assert.deepEqual([...new Set(list.map((p) => p.cat))].sort(), ["Comportement", "Roleplay", "Triche et économie"]);
  assert.equal(new Set(list.map((p) => p.name)).size, 13, "pas de doublon");
  const stored = Object.fromEntries(env.DB.raw.prepare("SELECT name, steps FROM penalties").all().map((r) => [r.name, JSON.parse(r.steps)]));
  for (const p of list) {
    const raw = stored[p.name];
    assert.ok(raw.length >= 1 && raw.length <= 5, p.name);
    assert.deepEqual(p.steps.map((s) => s.type), raw.map((s) => s.type), `${p.name} : aucun palier écarté`);
    for (const s of p.steps) if (s.type === "ban_temp") assert.ok(s.detail, `${p.name} : durée du ban temporaire`);
  }
  // le barème proposé ne passe que par des étapes que l'API sait aussi enregistrer
  const admin = await staffToken(env, [ROLE_ADMIN]);
  for (const p of list) assert.equal((await send(env, "/api/penalties", admin, "POST", { cat: p.cat, name: p.name + " (copie)", notes: p.notes, steps: p.steps })).status, 201, p.name);
});

/* ---------- Fichiers SQL : compatibles avec la console Cloudflare ---------- */

test("fichiers SQL : aucun commentaire, et collés sur une seule ligne (comme le fait la console D1) ils donnent le même résultat", () => {
  const read = (f) => readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
  const oneLine = (s) => s.replace(/\r?\n/g, " ");
  for (const f of ["schema.sql", "seed.sql", "seed-bareme.sql"]) {
    assert.ok(!read(f).includes("--"), `${f} : un commentaire « -- » masquerait tout le reste une fois collé sur une seule ligne`);
  }
  const build = (transform) => {
    const db = new DatabaseSync(":memory:");
    for (const f of ["schema.sql", "seed.sql", "seed-bareme.sql"]) db.exec(transform(read(f)));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name);
    return JSON.stringify({
      objects: db.prepare("SELECT type, name FROM sqlite_master ORDER BY type, name").all(),
      columns: tables.map((t) => [t, db.prepare(`PRAGMA table_info(${t})`).all().map((c) => [c.name, c.type, c.notnull, c.dflt_value, c.pk])]),
      org: db.prepare("SELECT * FROM org ORDER BY id").all(),
      penalties: db.prepare("SELECT * FROM penalties ORDER BY id").all(),
    });
  };
  const normal = build((s) => s);
  assert.equal(build(oneLine), normal);
  assert.deepEqual(JSON.parse(normal).columns.map((c) => c[0]), ["audit", "commands", "org", "penalties", "sanctions"]);
  assert.equal(JSON.parse(normal).org.length, 6);
  assert.equal(JSON.parse(normal).penalties.length, 13);
});
