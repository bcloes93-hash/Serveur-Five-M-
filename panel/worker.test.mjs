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
  return {
    raw: db,
    prepare(sql) { const stmt = db.prepare(sql); return { ...wrap(stmt, []), bind: (...args) => wrap(stmt, args) }; },
    // D1 : les requêtes d'un paquet s'exécutent ensemble, ou pas du tout.
    async batch(statements) {
      db.exec("BEGIN");
      try { const out = []; for (const st of statements) out.push(await st.run()); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
}

const makeEnv = (over = {}) => ({
  DISCORD_CLIENT_ID: "111111111111111111", DISCORD_CLIENT_SECRET: "client-secret", DISCORD_GUILD_ID: GUILD,
  ROLES_MOD: ROLE_MOD, ROLES_ADMIN: `${ROLE_ADMIN}, ${ROLE_ADMIN2}`,
  SESSION_SECRET: "k".repeat(48), PANEL_URL, ALLOWED_ORIGIN: SITE, DB: makeD1(), ...over,
});

/** Faux Discord. `member`: objet du membre, ou null pour « n'est pas dans le serveur ». */
function fakeDiscord({ member = { roles: [ROLE_MOD], nick: null }, tokenOk = true, userId = "999999999999999999", globalName = "Jaguuar_" } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.endsWith("/oauth2/token")) return tokenOk ? Response.json({ access_token: "AT" }) : new Response("{}", { status: 400 });
    if (u.endsWith("/users/@me")) return Response.json({ id: userId, username: "jaguuar", global_name: globalName, avatar: "abc123" });
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

// Une connexion inscrit désormais la personne dans « À placer » (testé à part, plus bas). Pour que les autres tests
// comptent seulement ce qu'ils ont eux-mêmes créé, on retire la fiche et la ligne de journal ajoutées par cette connexion.
async function staffToken(env, roles, opts = {}) {
  const before = env.DB.raw.prepare("SELECT COALESCE(MAX(id), 0) AS n FROM org").get().n;
  const { token } = await connect(env, { member: { roles }, ...opts });
  assert.ok(token, "connexion attendue");
  env.DB.raw.prepare("DELETE FROM org WHERE id > ? AND discord_id IS NOT NULL").run(before);
  env.DB.raw.prepare("DELETE FROM audit WHERE action = 'organigramme : ajouté à la connexion'").run();
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
  assert.match(pre.headers.get("access-control-allow-methods"), /\bPUT\b/, "PUT autorisé : modifier ou déplacer une ligne en dépend");
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

test("CORS : toutes les méthodes HTTP utilisées par la page du panel sont autorisées par le relais", async () => {
  const env = makeEnv();
  const front = readFileSync(new URL("../js/staff.js", import.meta.url), "utf8");
  const used = new Set([...front.matchAll(/\bapi\(\s*"(GET|POST|PUT|PATCH|DELETE)"/g)].map((m) => m[1]));
  assert.ok(used.has("PUT") && used.has("DELETE") && used.has("POST") && used.has("GET"), "le panel utilise bien ces 4 méthodes : " + [...used]);
  const pre = await panel.fetch(new Request(`${W}/api/org/1`, { method: "OPTIONS", headers: { origin: SITE, "access-control-request-method": "PUT" } }), env);
  assert.equal(pre.status, 204);
  const allowed = pre.headers.get("access-control-allow-methods").split(",").map((m) => m.trim());
  for (const m of used) assert.ok(allowed.includes(m), `méthode ${m} refusée par le relais (CORS)`);
  assert.match(pre.headers.get("access-control-allow-headers"), /content-type/);
  // une origine inconnue n'obtient aucune autorisation
  const evil = await panel.fetch(new Request(`${W}/api/org/1`, { method: "OPTIONS", headers: { origin: "https://pirate.example" } }), env);
  assert.equal(evil.headers.get("access-control-allow-origin"), null);
});

/* ---------- Organigramme : inscription à la connexion ---------- */

const orgRows = (env, where = "1 = 1", ...args) => env.DB.raw.prepare(`SELECT * FROM org WHERE ${where} ORDER BY id`).all(...args);

test("connexion : une personne du staff apparaît dans « À placer », avec sa photo Discord, sans doublon", async () => {
  const env = supportEnv();
  const first = await connect(env, { member: { roles: [ROLE_SUPPORT], nick: "Sup" }, userId: "777777777777777777" });
  assert.ok(first.token);
  let rows = orgRows(env);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].name, rows[0].role, rows[0].kind, rows[0].tier, rows[0].grp, rows[0].discord_id, rows[0].avatar],
    ["Sup", "Support", "other", 9, "À placer", "777777777777777777", "abc123"]);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'organigramme : ajouté à la connexion'").get().n, 1);
  // 2e connexion : aucune nouvelle fiche
  await connect(env, { member: { roles: [ROLE_SUPPORT], nick: "Sup" }, userId: "777777777777777777" });
  assert.equal(orgRows(env).length, 1, "pas de doublon");
  // le titre reflète le niveau Discord
  const e2 = makeEnv();
  for (const [i, [roles, label]] of [[[ROLE_MOD], "Modérateur"], [[ROLE_ADMIN], "Admin"]].entries()) {
    await connect(e2, { member: { roles, nick: "N" + label }, userId: "10000000000000000" + (i + 1) });
  }
  assert.deepEqual(orgRows(e2).map((r) => [r.name, r.role]), [["NModérateur", "Modérateur"], ["NAdmin", "Admin"]]);
  // le panel lit les fiches avec leur photo
  const admin = await staffToken(env, [ROLE_ADMIN], { userId: "888888888888888888" });
  const list = (await (await call(env, "/api/org", { token: admin })).json()).org;
  assert.deepEqual([list[0].discord_id, list[0].avatar], ["777777777777777777", "abc123"]);
});

test("connexion : ni les non-staff, ni les connexions refusées ne s'inscrivent", async () => {
  const env = makeEnv();
  const r = await connect(env, { member: { roles: ["000000000000000000"], nick: "Intrus" } });
  assert.ok(!r.token);
  assert.equal(orgRows(env).length, 0);
  const r2 = await connect(env, { member: null });
  assert.ok(!r2.token);
  assert.equal(orgRows(env).length, 0);
});

test("connexion : une fiche créée à la main au même nom est reliée au compte (toutes ses cases), sans doublon", async () => {
  const env = makeEnv();
  env.DB.raw.exec(readFileSync(new URL("./seed.sql", import.meta.url), "utf8"));
  const adm = await staffToken(env, [ROLE_ADMIN], { userId: "888888888888888888", globalName: "Boss" });
  // Taalback figure déjà dans deux cases, créées à la main
  assert.equal((await send(env, "/api/org", adm, "POST", memberBody({ name: "Taalback", kind: "adm_legal" }))).status, 201);
  const before = orgRows(env).length;
  const r = await connect(env, { member: { roles: [ROLE_MOD], nick: "taalback" }, userId: "333333333333333330" });
  assert.ok(r.token);
  assert.equal(orgRows(env).length, before, "aucune fiche en plus");
  const t = orgRows(env, "name = 'Taalback' COLLATE NOCASE");
  assert.equal(t.length, 2);
  assert.ok(t.every((x) => x.discord_id === "333333333333333330" && x.avatar === "abc123"), "les deux lignes de Taalback sont reliées");
  // reconnexion : la photo est rafraîchie sur toutes les lignes, toujours aucun doublon
  await connect(env, { member: { roles: [ROLE_MOD], nick: "Autre pseudo" }, userId: "333333333333333330" });
  assert.equal(orgRows(env).length, before);
  // le nom du compte (nom affiché ou d'utilisateur) sert aussi à relier une fiche
  const r3 = await connect(env, { member: { roles: [ROLE_MOD] }, userId: "444444444444444441" });   // pas de pseudo : nom affiché « Jaguuar_ »
  assert.ok(r3.token);
  assert.equal(orgRows(env, "name = 'Jaguuar_'")[0].discord_id, "444444444444444441", "relié par le nom affiché");
  assert.equal(orgRows(env).length, before);
});

test("connexion : deux personnes de même nom affiché obtiennent chacune leur fiche ; une copie reprend la photo", async () => {
  const env = makeEnv();
  await connect(env, { member: { roles: [ROLE_MOD], nick: "Alex" }, userId: "111111111111111110" });
  await connect(env, { member: { roles: [ROLE_MOD], nick: "Alex" }, userId: "222222222222222220" });
  const rows = orgRows(env);
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].name.toLowerCase(), rows[1].name.toLowerCase(), "noms distincts");
  assert.match(rows[1].name, /^Alex \(2220\)$/);
  // copie d'une fiche reliée : la nouvelle ligne hérite du compte Discord
  const adm = await staffToken(env, [ROLE_ADMIN], { userId: "888888888888888888" });
  assert.equal((await send(env, "/api/org", adm, "POST", memberBody({ name: "Alex", kind: "adm_rp" }))).status, 201);
  const copy = orgRows(env, "kind = 'adm_rp'")[0];
  assert.deepEqual([copy.discord_id, copy.avatar], ["111111111111111110", "abc123"]);
  // une fiche sans compte relié n'en reçoit pas
  assert.equal((await send(env, "/api/org", adm, "POST", memberBody({ name: "Inconnu", kind: "adm_rp" }))).status, 201);
  assert.equal(orgRows(env, "name = 'Inconnu'")[0].discord_id, null);
});

test("connexion et organigramme : une base pas encore migrée (sans colonnes Discord) continue de fonctionner", async () => {
  const env = makeEnv();
  env.DB.raw.exec("DROP TABLE org; CREATE TABLE org (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, role TEXT NOT NULL, grp TEXT NOT NULL, tier INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'other', position INTEGER NOT NULL DEFAULT 0);");
  const adm = await connect(env, { member: { roles: [ROLE_ADMIN], nick: "Boss" } });
  assert.ok(adm.token, "la connexion n'échoue pas");
  assert.equal(orgRows(env).length, 0, "rien n'est inscrit tant que la base n'est pas migrée");
  assert.equal((await send(env, "/api/org", adm.token, "POST", memberBody({ name: "Isar", kind: "adm_rp" }))).status, 201, "l'organigramme reste modifiable");
  const body = await (await call(env, "/api/org", { token: adm.token })).json();
  assert.equal(body.org.length, 1);
  assert.ok(!("discord_id" in body.org[0]), "liste sans photo (repli)");
  // la migration fournie s'applique et active la fonction
  env.DB.raw.exec(readFileSync(new URL("./migration-organigramme-discord.sql", import.meta.url), "utf8").replace(/\r?\n/g, " "));
  assert.ok(!/--/.test(readFileSync(new URL("./migration-organigramme-discord.sql", import.meta.url), "utf8")), "migration sans commentaire (console D1)");
  await connect(env, { member: { roles: [ROLE_ADMIN], nick: "Boss" } });
  assert.equal(orgRows(env, "name = 'Boss'").length, 1);
  assert.equal((await (await call(env, "/api/org", { token: adm.token })).json()).org.find((r) => r.name === "Boss").discord_id, "999999999999999999");
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
  assert.deepEqual({ ...listed[0], id: undefined }, { id: undefined, platform: "fivem", cat: "Modération", cmd: "/kick [joueur] [motif]", descr: "Expulse un joueur du serveur.", example: "/kick 12 spam", min_level: "support" });

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

test("organigramme : validation, « à placer » par défaut, tri par niveau puis ordre", async () => {
  const env = makeEnv();
  const admin = await staffToken(env, [ROLE_ADMIN]);
  const post = (b) => send(env, "/api/org", admin, "POST", b);
  for (const bad of [{ name: "" }, { name: "   " }, { position: -1 }, { position: 100 }, { position: 1.5 }, { kind: "roi" }, { kind: "manager" }, { kind: "constructor" }, { kind: "__proto__" }]) {
    assert.equal((await post(memberBody(bad))).status, 400, JSON.stringify(bad));
  }
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM org").get().n, 0);
  await post(memberBody({ name: "C", kind: "mgr_rp", position: 1 }));
  await post(memberBody({ name: "B", kind: "mgr_rp", position: 0 }));
  await post(memberBody({ name: "A", kind: "founder" }));
  await post(memberBody({ name: "D", kind: undefined, position: "", role: "" }));
  const rows = (await (await call(env, "/api/org", { token: admin })).json()).org;
  assert.deepEqual(rows.map((r) => r.name), ["A", "B", "C", "D"]);
  assert.deepEqual([rows[3].kind, rows[3].tier, rows[3].grp, rows[3].role], ["other", 9, "À placer", "À placer"], "sans case : à placer");
});

test("organigramme : chaque case de l'arbre fixe le niveau, le groupe et le titre par défaut (rien n'est repris du navigateur)", async () => {
  const env = makeEnv();
  const admin = await staffToken(env, [ROLE_ADMIN]);
  const expected = {
    founder: [1, "Direction", "Fondateur"],
    mgr_staff: [2, "Management", "Responsable Staff"], mgr_rp: [2, "Management", "Responsable RP"], mgr_com: [2, "Management", "Responsable Communauté"],
    adm_legal: [3, "Administration", "Référent Légal"], adm_illegal: [3, "Administration", "Référent Illégal"], adm_rp: [3, "Administration", "Référent RP"],
    adm_mod: [3, "Administration", "Référent Modération"], adm_event: [3, "Administration", "Référent Événementiel"], adm_tech: [3, "Administration", "Référent Technique"],
    mod_legal: [4, "Modération", "Modérateur Légal"], mod_illegal: [4, "Modération", "Modérateur Illégal"], mod_rp: [4, "Modération", "Modérateur RP"], mod_com: [4, "Modération", "Modérateur Communauté"],
    sup_assist: [5, "Support", "Support Assistance Joueurs"], sup_tickets: [5, "Support", "Support Tickets"], sup_new: [5, "Support", "Support Nouveaux Joueurs"], sup_bugs: [5, "Support", "Support Bugs & Signalements"],
    other: [9, "À placer", "À placer"],
  };
  for (const [kind, [tier, grp, label]] of Object.entries(expected)) {
    // le navigateur envoie n'importe quoi : le serveur impose le niveau et le groupe, et le titre par défaut si on n'en donne pas
    const res = await send(env, "/api/org", admin, "POST", { name: "P-" + kind, role: "", grp: "Pirate", tier: 1, kind, position: 0 });
    assert.equal(res.status, 201, kind);
    const row = env.DB.raw.prepare("SELECT * FROM org WHERE name = ?").get("P-" + kind);
    assert.deepEqual([row.tier, row.grp, row.role, row.kind], [tier, grp, label, kind], kind);
  }
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM org").get().n, Object.keys(expected).length);
  // un titre personnalisé est conservé, et déplacer quelqu'un (PUT) recalcule le niveau et le groupe
  const { id } = await (await send(env, "/api/org", admin, "POST", memberBody({ name: "Taalback", role: "Admin · Dev", kind: "other" }))).json();
  assert.equal((await send(env, `/api/org/${id}`, admin, "PUT", { name: "Taalback", role: "Admin · Dev", kind: "adm_legal", position: 2 })).status, 200);
  const moved = env.DB.raw.prepare("SELECT * FROM org WHERE id = ?").get(id);
  assert.deepEqual([moved.tier, moved.grp, moved.role, moved.kind, moved.position], [3, "Administration", "Admin · Dev", "adm_legal", 2]);
});

test("organigramme : une personne peut être dans plusieurs cases, mais une seule fois dans la même", async () => {
  const env = makeEnv();
  const admin = await staffToken(env, [ROLE_ADMIN]);
  const mod = await staffToken(env, [ROLE_MOD]);
  const post = (b) => send(env, "/api/org", admin, "POST", b);
  const put = (id, b) => send(env, `/api/org/${id}`, admin, "PUT", b);
  const a = await (await post(memberBody({ name: "Isar", kind: "adm_legal" }))).json();
  assert.equal((await post(memberBody({ name: "Isar", kind: "adm_rp" }))).status, 201, "copie dans une autre case");
  assert.equal((await post(memberBody({ name: "Isar", kind: "mod_com" }))).status, 201, "et une 3e");
  assert.equal((await post(memberBody({ name: "Isar", kind: "adm_legal" }))).status, 409, "même case : refusé");
  assert.equal((await post(memberBody({ name: "ISAR", kind: "adm_legal" }))).status, 409, "même case, casse différente : refusé");
  assert.equal((await post(memberBody({ name: "Isar", kind: "other" }))).status, 201, "la réserve compte comme une case");
  assert.equal((await post(memberBody({ name: "Isar", kind: "other" }))).status, 409);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM org WHERE name = 'Isar'").get().n, 4);
  const b = await (await post(memberBody({ name: "Taalback", kind: "adm_legal" }))).json();
  assert.equal((await put(b.id, memberBody({ name: "Taalback", kind: "adm_legal", role: "Chef" }))).status, 200, "modifier sans changer de case : autorisé");
  assert.equal((await put(a.id, memberBody({ name: "Isar", kind: "adm_rp" }))).status, 409, "déplacer vers une case où la personne est déjà : refusé");
  assert.equal((await put(a.id, memberBody({ name: "Isar", kind: "mod_rp" }))).status, 200, "déplacer vers une case libre : accepté");
  assert.equal((await post(memberBody({ name: "Isar", kind: "adm_legal" }))).status, 201, "l'ancienne case est de nouveau libre");
  assert.equal((await send(env, "/api/org", mod, "POST", memberBody({ name: "Autre", kind: "adm_tech" }))).status, 403, "toujours réservé à l'administration");
  const { audit } = await (await call(env, "/api/audit", { token: admin })).json();
  assert.equal(audit.filter((x) => x.action === "organigramme : membre ajouté").length >= 6, true, "chaque copie est journalisée");
});

test("organigramme : la liste annonce les cases connues (le panel y repère un relais pas à jour)", async () => {
  const env = makeEnv();
  const mod = await staffToken(env, [ROLE_MOD]);
  const body = await (await call(env, "/api/org", { token: mod })).json();
  assert.ok(Array.isArray(body.org) && Array.isArray(body.nodes));
  for (const k of ["founder", "mgr_staff", "adm_legal", "adm_tech", "mod_com", "sup_bugs", "other"]) assert.ok(body.nodes.includes(k), k);
  assert.equal(body.nodes.length, 19);
  // les autres listes ne sont pas touchées
  assert.deepEqual(Object.keys(await (await call(env, "/api/commands", { token: mod })).json()), ["commands"]);
});

test("organigramme pré-rempli avec seed.sql : le fondateur est en place, l'équipe attend d'être placée", async () => {
  const env = makeEnv();
  env.DB.raw.exec(readFileSync(new URL("./seed.sql", import.meta.url), "utf8"));
  const mod = await staffToken(env, [ROLE_MOD]);
  const rows = (await (await call(env, "/api/org", { token: mod })).json()).org;
  assert.deepEqual(rows.map((r) => `${r.tier}:${r.name}`), ["1:Jaguuar_", "9:Fumeurdefrap", "9:Taalback", "9:Isar", "9:Trafalgar", "9:Moncef"]);
  assert.deepEqual(rows.map((r) => r.kind), ["founder", "other", "other", "other", "other", "other"]);
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
  assert.deepEqual(JSON.parse(normal).columns.map((c) => c[0]), ["audit", "commands", "org", "penalties", "rule_chapters", "rule_levels", "rules", "rules_meta", "sanctions"]);
  assert.equal(JSON.parse(normal).org.length, 6);
  assert.equal(JSON.parse(normal).penalties.length, 13);
});

/* ---------- Niveau « support » : lecture seule des références ---------- */

const ROLE_SUPPORT = "666666666666666666";
const supportEnv = () => makeEnv({ ROLES_SUPPORT: ROLE_SUPPORT });

test("support : connexion acceptée avec le rôle, niveau « support » ; le niveau le plus élevé l'emporte", async () => {
  const env = supportEnv();
  const sup = await staffToken(env, [ROLE_SUPPORT]);
  const me = await (await call(env, "/api/me", { token: sup })).json();
  assert.equal(me.level, "support");
  assert.equal((await (await call(env, "/api/me", { token: await staffToken(env, [ROLE_SUPPORT, ROLE_MOD]) })).json()).level, "mod");
  assert.equal((await (await call(env, "/api/me", { token: await staffToken(env, [ROLE_SUPPORT, ROLE_ADMIN]) })).json()).level, "admin");
  assert.equal(env.DB.raw.prepare("SELECT target FROM audit ORDER BY id LIMIT 1").get().target, "support");
});

test("support : sans ROLES_SUPPORT le rôle n'ouvre aucun accès (le plus prudent par défaut)", async () => {
  const env = makeEnv();   // ROLES_SUPPORT non défini
  assert.equal((await connect(env, { member: { roles: [ROLE_SUPPORT] } })).location, `${PANEL_URL}#error=not_staff`);
});

test("support : suffit à lui seul à configurer le panel", async () => {
  const env = makeEnv({ ROLES_MOD: "", ROLES_ADMIN: "", ROLES_SUPPORT: ROLE_SUPPORT });
  const r = await panel.fetch(new Request(`${W}/login`), env);
  assert.equal(r.status, 302);
  assert.ok(r.headers.get("location").startsWith("https://discord.com/oauth2/authorize"));
});

test("support : lit le barème, les commandes et l'organigramme, mais ne peut rien écrire", async () => {
  const env = supportEnv();
  const admin = await staffToken(env, [ROLE_ADMIN], { userId: "888888888888888888" });
  const sup = await staffToken(env, [ROLE_SUPPORT]);
  await send(env, "/api/commands", admin, "POST", cmdBody());
  await send(env, "/api/org", admin, "POST", memberBody());
  await send(env, "/api/penalties", admin, "POST", penaltyBody());

  assert.equal((await (await call(env, "/api/commands", { token: sup })).json()).commands.length, 1);
  assert.equal((await (await call(env, "/api/org", { token: sup })).json()).org.length, 1);
  assert.equal((await (await call(env, "/api/penalties", { token: sup })).json()).penalties.length, 1);

  for (const [path, body] of [["/api/commands", cmdBody()], ["/api/org", memberBody()], ["/api/penalties", penaltyBody()]]) {
    assert.equal((await send(env, path, sup, "POST", body)).status, 403, `POST ${path}`);
    assert.equal((await send(env, `${path}/1`, sup, "PUT", body)).status, 403, `PUT ${path}`);
    assert.equal((await send(env, `${path}/1`, sup, "DELETE")).status, 403, `DELETE ${path}`);
  }
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM commands").get().n, 1);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM org").get().n, 1);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM penalties").get().n, 1);
});

test("support : aucun accès au journal des sanctions ni au journal d'activité, et rien n'en fuit", async () => {
  const env = supportEnv();
  const mod = await staffToken(env, [ROLE_MOD]);
  const sup = await staffToken(env, [ROLE_SUPPORT], { userId: "777777777777777777" });
  await send(env, "/api/sanctions", mod, "POST", sanction({ player: "Joueur secret", reason: "motif confidentiel" }));

  const list = await call(env, "/api/sanctions", { token: sup });
  assert.equal(list.status, 403);
  const text = await list.text();
  assert.ok(!text.includes("Joueur secret") && !text.includes("confidentiel") && !text.includes("sanctions\":["), "aucune donnée du journal dans la réponse");
  assert.equal((await call(env, "/api/sanctions?q=secret", { token: sup })).status, 403, "ni par la recherche");
  assert.equal((await send(env, "/api/sanctions", sup, "POST", sanction())).status, 403);
  assert.equal((await send(env, "/api/sanctions/1", sup, "DELETE")).status, 403);
  assert.equal((await call(env, "/api/audit", { token: sup })).status, 403);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM sanctions").get().n, 1, "le journal n'a pas été modifié");

  // la modération, elle, garde son accès
  assert.equal((await call(env, "/api/sanctions", { token: mod })).status, 200);
});


/* ---------- Cinq niveaux et visibilité des commandes par niveau ---------- */

const ROLE_MANAGER = "555555555555555500";
const ROLE_FOUNDER = "555555555555555501";
const levelsEnv = () => makeEnv({ ROLES_SUPPORT: ROLE_SUPPORT, ROLES_MANAGER: ROLE_MANAGER, ROLES_FOUNDER: ROLE_FOUNDER });
const ALL_LEVELS = ["support", "mod", "admin", "manager", "founder"];
const ROLE_OF = { support: ROLE_SUPPORT, mod: ROLE_MOD, admin: ROLE_ADMIN, manager: ROLE_MANAGER, founder: ROLE_FOUNDER };

async function tokens(env) {
  const out = {};
  let n = 0;
  for (const lvl of ALL_LEVELS) out[lvl] = await staffToken(env, [ROLE_OF[lvl]], { userId: `99999999999999${String(++n).padStart(4, "0")}` });
  return out;
}

test("niveaux : fondateur > responsable > administration > modération > support ; le plus élevé l'emporte", async () => {
  const env = levelsEnv();
  const t = await tokens(env);
  for (const lvl of ALL_LEVELS) assert.equal((await (await call(env, "/api/me", { token: t[lvl] })).json()).level, lvl, lvl);
  const both = await staffToken(env, [ROLE_MOD, ROLE_FOUNDER, ROLE_SUPPORT]);
  assert.equal((await (await call(env, "/api/me", { token: both })).json()).level, "founder");
  const targets = env.DB.raw.prepare("SELECT target FROM audit ORDER BY id").all().map((r) => r.target);
  assert.deepEqual(targets.slice(0, 5), ["support", "modération", "administration", "responsable", "fondateur"]);
});

test("niveaux : un seul rôle fondateur suffit à configurer le panel ; sans les nouveaux réglages, rien ne change", async () => {
  const onlyFounder = makeEnv({ ROLES_MOD: "", ROLES_ADMIN: "", ROLES_FOUNDER: ROLE_FOUNDER });
  assert.equal((await panel.fetch(new Request(`${W}/login`), onlyFounder)).status, 302);
  const plain = makeEnv();   // ni ROLES_MANAGER ni ROLES_FOUNDER
  assert.equal((await connect(plain, { member: { roles: [ROLE_FOUNDER] } })).location, `${PANEL_URL}#error=not_staff`);
  assert.equal((await (await call(plain, "/api/me", { token: await staffToken(plain, [ROLE_ADMIN]) })).json()).level, "admin");
});

const addRow = (env, platform, cmd, level) => env.DB.raw.prepare("INSERT INTO commands (platform, cat, cmd, descr, example, min_level) VALUES (?, 'Test', ?, ?, '', ?)").run(platform, cmd, `description de ${cmd}`, level);

test("commandes : chaque niveau ne reçoit que les commandes de son niveau et des niveaux inférieurs", async () => {
  const env = levelsEnv();
  for (const lvl of ALL_LEVELS) { addRow(env, "fivem", `/cmd-${lvl}`, lvl); addRow(env, "discord", `/disc-${lvl}`, lvl); }
  env.DB.raw.prepare("INSERT INTO commands (platform, cat, cmd, descr) VALUES ('fivem', 'Ancien', '/ancienne', 'sans niveau')").run();   // niveau par défaut
  const t = await tokens(env);

  for (const [i, lvl] of ALL_LEVELS.entries()) {
    const res = await call(env, "/api/commands", { token: t[lvl] });
    const text = await res.text();
    const cmds = JSON.parse(text).commands.map((c) => c.cmd).sort();
    const expected = [...ALL_LEVELS.slice(0, i + 1).flatMap((l) => [`/cmd-${l}`, `/disc-${l}`]), "/ancienne"].sort();
    assert.deepEqual(cmds, expected, `niveau ${lvl}`);
    for (const hidden of ALL_LEVELS.slice(i + 1)) {
      assert.ok(!text.includes(`/cmd-${hidden}`) && !text.includes(`/disc-${hidden}`) && !text.includes(`description de /cmd-${hidden}`), `niveau ${lvl} : rien de « ${hidden} » ne fuit dans la réponse`);
    }
  }
  assert.equal(JSON.parse(await (await call(env, "/api/commands", { token: t.founder })).text()).commands.every((c) => ALL_LEVELS.includes(c.min_level)), true);
});

test("commandes : on ne crée ni ne réserve rien au-dessus de son niveau, et on ne touche pas à ce qu'on ne voit pas", async () => {
  const env = levelsEnv();
  addRow(env, "fivem", "/pour-responsable", "manager");
  addRow(env, "fivem", "/pour-fondateur", "founder");
  addRow(env, "fivem", "/pour-admin", "admin");
  const ids = Object.fromEntries(env.DB.raw.prepare("SELECT id, cmd FROM commands").all().map((r) => [r.cmd, r.id]));
  const t = await tokens(env);
  const body = (over = {}) => cmdBody({ min_level: "admin", ...over });

  // un administrateur
  assert.equal((await send(env, "/api/commands", t.admin, "POST", body({ min_level: "manager" }))).status, 403, "pas de commande réservée au-dessus de soi");
  assert.equal((await send(env, "/api/commands", t.admin, "POST", body({ min_level: "admin", cmd: "/ok-admin" }))).status, 201);
  assert.equal((await send(env, "/api/commands", t.admin, "POST", body({ min_level: "mod", cmd: "/ok-mod" }))).status, 201);
  assert.equal((await send(env, `/api/commands/${ids["/pour-responsable"]}`, t.admin, "PUT", body({ cmd: "/piraté" }))).status, 404, "modifier une commande qu'il ne voit pas");
  assert.equal((await send(env, `/api/commands/${ids["/pour-fondateur"]}`, t.admin, "DELETE")).status, 404, "supprimer une commande qu'il ne voit pas");
  assert.equal((await send(env, `/api/commands/${ids["/pour-admin"]}`, t.admin, "PUT", body({ cmd: "/pour-admin", min_level: "founder" }))).status, 403, "pas d'élévation vers un niveau supérieur");
  assert.equal((await send(env, `/api/commands/${ids["/pour-admin"]}`, t.admin, "PUT", body({ cmd: "/pour-admin-2", min_level: "mod" }))).status, 200, "abaisser la visibilité est permis");
  assert.equal(env.DB.raw.prepare("SELECT cmd FROM commands WHERE id = ?").get(ids["/pour-responsable"]).cmd, "/pour-responsable", "rien n'a changé");
  assert.ok(env.DB.raw.prepare("SELECT id FROM commands WHERE id = ?").get(ids["/pour-fondateur"]), "rien n'a été supprimé");

  // un responsable gère les niveaux jusqu'au sien, pas au-dessus
  assert.equal((await send(env, `/api/commands/${ids["/pour-responsable"]}`, t.manager, "PUT", body({ cmd: "/pour-responsable", min_level: "manager" }))).status, 200);
  assert.equal((await send(env, `/api/commands/${ids["/pour-fondateur"]}`, t.manager, "DELETE")).status, 404);
  // le fondateur gère tout
  assert.equal((await send(env, "/api/commands", t.founder, "POST", body({ min_level: "founder", cmd: "/ok-fondateur" }))).status, 201);
  assert.equal((await send(env, `/api/commands/${ids["/pour-fondateur"]}`, t.founder, "DELETE")).status, 200);

  // validation du niveau
  assert.equal((await send(env, "/api/commands", t.founder, "POST", body({ min_level: "roi" }))).status, 400);
  assert.equal((await send(env, "/api/commands", t.founder, "POST", { ...body(), min_level: undefined, cmd: "/defaut" })).status, 201);
  assert.equal(env.DB.raw.prepare("SELECT min_level FROM commands WHERE cmd = '/defaut'").get().min_level, "support", "niveau par défaut : tout le staff");

  // modération et support ne peuvent rien écrire
  assert.equal((await send(env, "/api/commands", t.mod, "POST", body({ min_level: "mod" }))).status, 403);
  assert.equal((await send(env, "/api/commands", t.support, "POST", body({ min_level: "support" }))).status, 403);
});

test("commandes : le journal d'activité ne révèle pas le nom d'une commande réservée aux niveaux supérieurs à l'administration", async () => {
  const env = levelsEnv();
  const t = await tokens(env);
  const post = (token, cmd, level) => send(env, "/api/commands", token, "POST", cmdBody({ cmd, min_level: level }));
  const { id: secretId } = await (await post(t.founder, "/commande-secrete-fondateur", "founder")).json();
  await post(t.manager, "/commande-secrete-responsable", "manager");
  await post(t.admin, "/commande-visible-admin", "admin");
  await send(env, `/api/commands/${secretId}`, t.founder, "PUT", cmdBody({ cmd: "/commande-secrete-renommee", min_level: "founder" }));
  await send(env, `/api/commands/${secretId}`, t.founder, "DELETE");

  const { audit } = await (await call(env, "/api/audit", { token: t.admin })).json();
  const text = JSON.stringify(audit);
  assert.ok(!text.includes("secrete"), "aucune commande réservée n'apparaît, ni à l'ajout, ni à la modification, ni à la suppression");
  assert.ok(text.includes("commande réservée aux niveaux supérieurs"));
  assert.ok(text.includes("/commande-visible-admin"), "une commande de niveau administration reste nommée");
});

test("niveaux : responsable et fondateur gardent les droits d'administration partout ailleurs", async () => {
  const env = levelsEnv();
  const t = await tokens(env);
  for (const lvl of ["manager", "founder"]) {
    assert.equal((await send(env, "/api/penalties", t[lvl], "POST", penaltyBody({ name: `Barème ${lvl}` }))).status, 201, `${lvl} : barème`);
    assert.equal((await send(env, "/api/org", t[lvl], "POST", memberBody({ name: `Membre ${lvl}` }))).status, 201, `${lvl} : organigramme`);
    assert.equal((await call(env, "/api/audit", { token: t[lvl] })).status, 200, `${lvl} : journal d'activité`);
    assert.equal((await call(env, "/api/sanctions", { token: t[lvl] })).status, 200, `${lvl} : journal des sanctions`);
    assert.equal((await send(env, "/api/sanctions", t[lvl], "POST", sanction())).status, 201, `${lvl} : ajout au journal`);
  }
  // et les niveaux inférieurs restent bornés
  assert.equal((await call(env, "/api/audit", { token: t.mod })).status, 403);
  assert.equal((await call(env, "/api/sanctions", { token: t.support })).status, 403);
});

test("migration des niveaux : sans commentaire, conserve les commandes d'une ancienne base et leur donne le niveau par défaut", () => {
  const migration = readFileSync(new URL("./migration-niveaux-commandes.sql", import.meta.url), "utf8");
  assert.ok(!migration.includes("--"), "un commentaire « -- » masquerait la requête dans la console D1");
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE commands (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, cat TEXT NOT NULL DEFAULT 'Général', cmd TEXT NOT NULL, descr TEXT NOT NULL, example TEXT NOT NULL DEFAULT '')");
  db.exec("INSERT INTO commands (platform, cat, cmd, descr) VALUES ('fivem', 'A', '/un', 'd1'), ('discord', 'B', '/deux', 'd2')");
  db.exec(migration.replace(/\r?\n/g, " "));
  const rows = db.prepare("SELECT cmd, descr, min_level FROM commands ORDER BY id").all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ cmd: "/un", descr: "d1", min_level: "support" }, { cmd: "/deux", descr: "d2", min_level: "support" }]);
  // la structure obtenue est celle d'une installation neuve
  const fresh = new DatabaseSync(":memory:");
  fresh.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  const cols = (d) => d.prepare("PRAGMA table_info(commands)").all().map((c) => [c.name, c.type, c.notnull, c.dflt_value]);
  assert.deepEqual(cols(db), cols(fresh));
});

/* ---------- Règlement : chapitres, règles, barème, publication, import ---------- */

const rulesEnv = levelsEnv;
const getRules = async (env, token) => (await call(env, "/api/rules", { token })).json();
const getPublic = async (env, origin = SITE) => { const r = await call(env, "/api/public/rules", { origin }); return { r, data: await r.json() }; };
const SAMPLE = [
  { title: "Règlement général", intro: "Intro 1.\n* un\n* deux", numbered: true, rules: [{ title: "Respect", body: "Soyez respectueux.\n* point A\n* point B" }, { title: "Pseudo", body: "Un pseudo correct.", important: true }] },
  { title: "Scènes", intro: "", numbered: true, rules: [{ title: "Consentement", body: "« Je te frappe. »" }] },
];
/** Importe un règlement d'exemple comme le fait le panel : reset, un chapitre à la fois, puis « done ». */
async function importRules(env, token, chapters = SAMPLE) {
  assert.equal((await send(env, "/api/rules/import", token, "POST", { mode: "reset" })).status, 200);
  for (const c of chapters) assert.equal((await send(env, "/api/rules/import", token, "POST", { mode: "chapter", chapter: { title: c.title, intro: c.intro, numbered: c.numbered }, rules: c.rules })).status, 201);
  assert.equal((await send(env, "/api/rules/import", token, "POST", { mode: "done" })).status, 200);
}
const ruleNames = (data, i) => data.chapters[i].rules.map((r) => r.title);

test("règlement : la migration est sans commentaire et donne la même structure qu'une installation neuve", () => {
  const migration = readFileSync(new URL("./migration-reglement.sql", import.meta.url), "utf8");
  assert.ok(!migration.includes("--"), "un commentaire « -- » masquerait la requête dans la console D1");
  const old = new DatabaseSync(":memory:");
  old.exec("CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL)");
  old.exec(migration.replace(/\r?\n/g, " "));
  const fresh = new DatabaseSync(":memory:");
  fresh.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  for (const t of ["rule_chapters", "rules", "rule_levels", "rules_meta"]) {
    const cols = (d) => d.prepare(`PRAGMA table_info(${t})`).all().map((c) => [c.name, c.type, c.notnull, c.dflt_value]);
    assert.deepEqual(cols(old), cols(fresh), t);
  }
});

test("règlement : il faut être connecté, et être manager ou fondateur pour le gérer", async () => {
  const env = rulesEnv();
  const t = await tokens(env);
  assert.equal((await call(env, "/api/rules")).status, 401);
  for (const lvl of ["support", "mod", "admin"]) {
    for (const [path, method, body] of [["/api/rules", "GET"], ["/api/rules", "POST", { chapter_id: 1, title: "x" }], ["/api/rule-chapters", "POST", { title: "x" }], ["/api/rules/order", "PUT", { chapter_id: 1, ids: [] }], ["/api/rule-chapters/order", "PUT", { ids: [] }], ["/api/rules-bareme", "PUT", { levels: {} }], ["/api/rules/1", "PUT", { title: "x" }], ["/api/rules/1", "DELETE"], ["/api/rule-chapters/1", "DELETE"]]) {
      assert.equal((await send(env, path, t[lvl], method, body)).status, 403, `${lvl} ${method} ${path}`);
    }
  }
  assert.equal((await call(env, "/api/rules", { token: t.manager })).status, 200);
  assert.equal((await call(env, "/api/rules", { token: t.founder })).status, 200);
  // l'import (remplace tout) est réservé au fondateur
  assert.equal((await send(env, "/api/rules/import", t.manager, "POST", { mode: "reset" })).status, 403);
  assert.equal((await send(env, "/api/rules/import", t.admin, "POST", { mode: "reset" })).status, 403);
  assert.equal((await send(env, "/api/rules/import", t.founder, "POST", { mode: "reset" })).status, 200);
});

test("règlement : tant que rien n'est importé, le site reçoit « non initialisé » ; une base sans les tables ne casse rien", async () => {
  const env = rulesEnv();
  const t = await tokens(env);
  assert.deepEqual((await getPublic(env)).data, { initialized: false });
  // import commencé mais pas terminé : rien de public (le site garde la version d'origine)
  await send(env, "/api/rules/import", t.founder, "POST", { mode: "reset" });
  await send(env, "/api/rules/import", t.founder, "POST", { mode: "chapter", chapter: { title: "A" }, rules: [{ title: "r", body: "b" }] });
  assert.deepEqual((await getPublic(env)).data, { initialized: false });
  assert.equal((await getRules(env, t.manager)).initialized, false);
  // anciennes bases : tables absentes
  const old = rulesEnv();
  old.DB.raw.exec("DROP TABLE rules; DROP TABLE rule_chapters; DROP TABLE rule_levels; DROP TABLE rules_meta;");
  const tk = await tokens(old);
  assert.deepEqual((await getPublic(old)).data, { initialized: false });
  const staff = await getRules(old, tk.manager);
  assert.equal(staff.missing, true); assert.equal(staff.initialized, false);
});

test("règlement : l'import par morceaux fonctionne, refuse les doublons et se confirme pour tout remplacer", async () => {
  const env = rulesEnv();
  const t = await tokens(env);
  await importRules(env, t.founder);
  const data = await getRules(env, t.manager);
  assert.equal(data.initialized, true);
  assert.deepEqual(data.chapters.map((c) => c.title), ["Règlement général", "Scènes"]);
  assert.deepEqual(ruleNames(data, 0), ["Respect", "Pseudo"]);
  assert.equal(data.chapters[0].rules[1].important, true);
  assert.equal(data.chapters[0].rules[0].body, "Soyez respectueux.\n* point A\n* point B");
  assert.equal(data.chapters[0].intro, "Intro 1.\n* un\n* deux");
  // un chapitre en plus après « done » : refusé
  assert.equal((await send(env, "/api/rules/import", t.founder, "POST", { mode: "chapter", chapter: { title: "Z" }, rules: [] })).status, 409);
  // tout remplacer exige une confirmation
  assert.equal((await send(env, "/api/rules/import", t.founder, "POST", { mode: "reset" })).status, 409);
  assert.equal((await send(env, "/api/rules/import", t.founder, "POST", { mode: "reset", confirm: true })).status, 200);
  assert.equal((await getRules(env, t.manager)).chapters.length, 0);
  assert.equal((await getRules(env, t.manager)).initialized, false);
  // entrées invalides
  assert.equal((await send(env, "/api/rules/import", t.founder, "POST", { mode: "chapter", chapter: { title: "" }, rules: [] })).status, 400);
  assert.equal((await send(env, "/api/rules/import", t.founder, "POST", { mode: "chapter", chapter: { title: "A" }, rules: [{ title: "" }] })).status, 400);
  assert.equal((await send(env, "/api/rules/import", t.founder, "POST", { mode: "chapter", chapter: { title: "A" }, rules: "non" })).status, 400);
  assert.equal((await send(env, "/api/rules/import", t.founder, "POST", { mode: "autre" })).status, 400);
  assert.equal((await getRules(env, t.manager)).chapters.length, 0);   // rien n'a été à moitié écrit
});

test("règlement : la lecture publique ne montre que le publié, sans identifiant ni auteur, et se met en cache brièvement", async () => {
  const env = rulesEnv();
  const t = await tokens(env);
  await importRules(env, t.founder);
  const staff = await getRules(env, t.manager);
  const [respect, pseudo] = staff.chapters[0].rules;
  await send(env, `/api/rules/${pseudo.id}`, t.manager, "PUT", { published: false });
  const out = await getPublic(env);
  assert.equal(out.r.status, 200);
  assert.equal(out.r.headers.get("access-control-allow-origin"), "*");
  assert.match(out.r.headers.get("cache-control"), /public, max-age=\d+/);
  assert.deepEqual(out.data.chapters.map((c) => ({ title: c.title, rules: c.rules.map((r) => r.title) })), [{ title: "Règlement général", rules: ["Respect"] }, { title: "Scènes", rules: ["Consentement"] }]);
  const raw = JSON.stringify(out.data);
  assert.ok(!/"id"|updated_by|published|chapter_id|position/.test(raw), "aucun champ interne dans la réponse publique : " + raw);
  assert.equal(out.data.chapters[0].rules[0].important, false);
  assert.ok(out.data.updated && !isNaN(Date.parse(out.data.updated)));
  // chapitre dépublié : il disparaît avec ses règles
  await send(env, `/api/rule-chapters/${staff.chapters[1].id}`, t.manager, "PUT", { published: false });
  assert.deepEqual((await getPublic(env)).data.chapters.map((c) => c.title), ["Règlement général"]);
  // et la lecture publique est possible sans connexion, depuis n'importe quel site
  const anon = await call(env, "/api/public/rules", { origin: "https://autre-site.example" });
  assert.equal(anon.status, 200);
  const pre = await call(env, "/api/public/rules", { method: "OPTIONS", origin: "https://autre-site.example" });
  assert.equal(pre.status, 204); assert.equal(pre.headers.get("access-control-allow-origin"), "*");
  // mais on ne peut rien y écrire
  assert.equal((await call(env, "/api/public/rules", { method: "POST", body: { a: 1 } })).status, 405);
  void respect;
});

test("règlement : ajouter, modifier, supprimer une règle, avec contrôle des champs", async () => {
  const env = rulesEnv();
  const t = await tokens(env);
  await importRules(env, t.founder);
  let data = await getRules(env, t.manager);
  const ch = data.chapters[0].id;
  const add = await send(env, "/api/rules", t.manager, "POST", { chapter_id: ch, title: "  Nouvelle   règle ", body: "Ligne 1\n\n\n\nLigne 2", important: true });
  assert.equal(add.status, 201);
  const id = (await add.json()).id;
  data = await getRules(env, t.manager);
  const created = data.chapters[0].rules.at(-1);
  assert.deepEqual([created.id, created.title, created.body, created.published, created.important, created.updated_by], [id, "Nouvelle règle", "Ligne 1\n\nLigne 2", true, true, "Jaguuar_"]);
  assert.deepEqual(ruleNames(data, 0), ["Respect", "Pseudo", "Nouvelle règle"], "ajoutée en fin de chapitre");
  // modification du texte seulement : le reste ne bouge pas
  assert.equal((await send(env, `/api/rules/${id}`, t.manager, "PUT", { body: "Texte modifié." })).status, 200);
  const edited = (await getRules(env, t.manager)).chapters[0].rules.at(-1);
  assert.deepEqual([edited.title, edited.body, edited.important, edited.published], ["Nouvelle règle", "Texte modifié.", true, true]);
  // validations
  for (const [body, label] of [[{ chapter_id: ch, title: "" }, "titre vide"], [{ chapter_id: ch, title: "   " }, "titre blanc"], [{ title: "x" }, "sans chapitre"], [{ chapter_id: "abc", title: "x" }, "chapitre invalide"], [{ chapter_id: ch, title: "x", published: "oui" }, "booléen invalide"], [{ chapter_id: ch, title: "x", important: 2 }, "booléen invalide 2"]]) {
    assert.equal((await send(env, "/api/rules", t.manager, "POST", body)).status, 400, label);
  }
  assert.equal((await send(env, "/api/rules", t.manager, "POST", { chapter_id: 99999, title: "x" })).status, 404);
  assert.equal((await send(env, `/api/rules/${id}`, t.manager, "PUT", { title: "" })).status, 400);
  assert.equal((await send(env, "/api/rules/99999", t.manager, "PUT", { title: "x" })).status, 404);
  assert.equal((await send(env, "/api/rules/99999", t.manager, "DELETE")).status, 404);
  const long = await send(env, "/api/rules", t.manager, "POST", { chapter_id: ch, title: "T".repeat(500), body: "x".repeat(9000) });
  assert.equal(long.status, 201);
  const l = (await getRules(env, t.manager)).chapters[0].rules.at(-1);
  assert.equal(l.title.length, 160); assert.equal(l.body.length, 6000);
  const huge = JSON.stringify({ chapter_id: ch, title: "x", body: "y".repeat(40000) });
  const tooBig = await panel.fetch(new Request(`${W}/api/rules`, { method: "POST", headers: { authorization: `Bearer ${t.manager}`, origin: SITE, "content-type": "application/json", "content-length": String(huge.length) }, body: huge }), env);
  assert.equal(tooBig.status, 413);
  // suppression
  assert.equal((await send(env, `/api/rules/${id}`, t.manager, "DELETE")).status, 200);
  assert.ok(!ruleNames(await getRules(env, t.manager), 0).includes("Nouvelle règle"));
});

test("règlement : publier, dépublier et mettre en avant sans renvoyer le texte (modification partielle)", async () => {
  const env = rulesEnv();
  const t = await tokens(env);
  await importRules(env, t.founder);
  const r = (await getRules(env, t.manager)).chapters[0].rules[0];
  assert.equal((await send(env, `/api/rules/${r.id}`, t.manager, "PUT", { published: false })).status, 200);
  assert.equal((await getPublic(env)).data.chapters[0].rules.length, 1);
  assert.equal((await send(env, `/api/rules/${r.id}`, t.manager, "PUT", { published: true, important: true })).status, 200);
  const after = (await getPublic(env)).data.chapters[0].rules[0];
  assert.deepEqual([after.title, after.important, after.body], ["Respect", true, "Soyez respectueux.\n* point A\n* point B"]);
  const actions = env.DB.raw.prepare("SELECT action FROM audit WHERE action LIKE 'règlement : règle %' ORDER BY id").all().map((a) => a.action);
  assert.deepEqual(actions, ["règlement : règle dépubliée", "règlement : règle publiée"]);
  await send(env, `/api/rules/${r.id}`, t.manager, "PUT", { important: false });
  assert.equal(env.DB.raw.prepare("SELECT action FROM audit WHERE action LIKE 'règlement : règle %' ORDER BY id DESC LIMIT 1").get().action, "règlement : règle retirée des règles importantes");
});

test("règlement : déplacer vers un autre chapitre et réordonner règles et chapitres", async () => {
  const env = rulesEnv();
  const t = await tokens(env);
  await importRules(env, t.founder);
  let data = await getRules(env, t.manager);
  const [c1, c2] = data.chapters, [respect, pseudo] = c1.rules, [conso] = c2.rules;
  // réordonner dans le chapitre 1
  assert.equal((await send(env, "/api/rules/order", t.manager, "PUT", { chapter_id: c1.id, ids: [pseudo.id, respect.id] })).status, 200);
  assert.deepEqual(ruleNames(await getRules(env, t.manager), 0), ["Pseudo", "Respect"]);
  // déplacer « Pseudo » dans le chapitre 2, entre les deux (liste complète du chapitre d'arrivée)
  assert.equal((await send(env, "/api/rules/order", t.manager, "PUT", { chapter_id: c2.id, ids: [conso.id, pseudo.id] })).status, 200);
  data = await getRules(env, t.manager);
  assert.deepEqual(ruleNames(data, 0), ["Respect"]); assert.deepEqual(ruleNames(data, 1), ["Consentement", "Pseudo"]);
  assert.equal(data.chapters[1].rules[1].chapter_id, c2.id);
  // une liste incomplète (page pas à jour) est refusée, rien ne change
  assert.equal((await send(env, "/api/rules/order", t.manager, "PUT", { chapter_id: c2.id, ids: [pseudo.id] })).status, 409);
  assert.equal((await send(env, "/api/rules/order", t.manager, "PUT", { chapter_id: c2.id, ids: [conso.id, pseudo.id, 99999] })).status, 409);
  assert.equal((await send(env, "/api/rules/order", t.manager, "PUT", { chapter_id: c2.id, ids: [conso.id, conso.id] })).status, 400);
  assert.equal((await send(env, "/api/rules/order", t.manager, "PUT", { chapter_id: 99999, ids: [] })).status, 404);
  assert.deepEqual(ruleNames(await getRules(env, t.manager), 1), ["Consentement", "Pseudo"]);
  // déplacement par modification (menu « Chapitre » de l'éditeur) : en fin de chapitre
  assert.equal((await send(env, `/api/rules/${respect.id}`, t.manager, "PUT", { chapter_id: c2.id })).status, 200);
  data = await getRules(env, t.manager);
  assert.deepEqual(ruleNames(data, 0), []); assert.deepEqual(ruleNames(data, 1), ["Consentement", "Pseudo", "Respect"]);
  assert.equal((await send(env, `/api/rules/${respect.id}`, t.manager, "PUT", { chapter_id: 99999 })).status, 404);
  // chapitres
  assert.equal((await send(env, "/api/rule-chapters/order", t.manager, "PUT", { ids: [c2.id, c1.id] })).status, 200);
  assert.deepEqual((await getRules(env, t.manager)).chapters.map((c) => c.title), ["Scènes", "Règlement général"]);
  assert.equal((await send(env, "/api/rule-chapters/order", t.manager, "PUT", { ids: [c2.id] })).status, 409);
  assert.equal((await send(env, "/api/rule-chapters/order", t.manager, "PUT", { ids: [c2.id, c2.id] })).status, 409);
  assert.deepEqual((await getPublic(env)).data.chapters.map((c) => c.title), ["Scènes", "Règlement général"]);
});

test("règlement : créer, modifier et supprimer un chapitre (un chapitre non vide ne se supprime pas)", async () => {
  const env = rulesEnv();
  const t = await tokens(env);
  await importRules(env, t.founder);
  const add = await send(env, "/api/rule-chapters", t.manager, "POST", { title: "  Charte Whitelist ", intro: "Bienvenue", numbered: false });
  assert.equal(add.status, 201);
  const id = (await add.json()).id;
  let data = await getRules(env, t.manager);
  const c = data.chapters.at(-1);
  assert.deepEqual([c.id, c.title, c.intro, c.numbered, c.published, c.rules.length], [id, "Charte Whitelist", "Bienvenue", false, true, 0]);
  assert.equal((await send(env, "/api/rule-chapters", t.manager, "POST", { title: "" })).status, 400);
  assert.equal((await send(env, "/api/rule-chapters", t.manager, "POST", { title: "x", numbered: "non" })).status, 400);
  assert.equal((await send(env, `/api/rule-chapters/${id}`, t.manager, "PUT", { title: "Charte" })).status, 200);
  data = await getRules(env, t.manager);
  assert.deepEqual([data.chapters.at(-1).title, data.chapters.at(-1).intro], ["Charte", "Bienvenue"], "le reste est conservé");
  assert.equal((await send(env, `/api/rule-chapters/${data.chapters[0].id}`, t.manager, "DELETE")).status, 409, "chapitre non vide");
  assert.equal((await send(env, `/api/rule-chapters/${id}`, t.manager, "DELETE")).status, 200);
  assert.equal((await send(env, `/api/rule-chapters/${id}`, t.manager, "DELETE")).status, 404);
  assert.equal((await send(env, "/api/rule-chapters/99999", t.manager, "PUT", { title: "x" })).status, 404);
});

test("règlement : la date de mise à jour ne bouge que pour un changement visible sur le site", async () => {
  const env = rulesEnv();
  const t = await tokens(env);
  await importRules(env, t.founder);
  const first = (await getPublic(env)).data.updated;
  env.DB.raw.prepare("UPDATE rules_meta SET v = '2020-01-01T00:00:00.000Z' WHERE k = 'updated_at'").run();
  const draft = (await send(env, "/api/rules", t.manager, "POST", { chapter_id: (await getRules(env, t.manager)).chapters[0].id, title: "Brouillon", published: false }));
  const draftId = (await draft.json()).id;
  await send(env, `/api/rules/${draftId}`, t.manager, "PUT", { body: "encore brouillon" });
  await send(env, `/api/rules/${draftId}`, t.manager, "DELETE");
  assert.equal((await getPublic(env)).data.updated, "2020-01-01T00:00:00.000Z", "brouillons : date inchangée");
  const r = (await getRules(env, t.manager)).chapters[0].rules[0];
  await send(env, `/api/rules/${r.id}`, t.manager, "PUT", { body: "Visible." });
  assert.ok((await getPublic(env)).data.updated > first.slice(0, 4), "texte publié modifié : date mise à jour");
  assert.notEqual((await getPublic(env)).data.updated, "2020-01-01T00:00:00.000Z");
});

test("règlement : barème indicatif à quatre niveaux, séparé des règles", async () => {
  const env = rulesEnv();
  const t = await tokens(env);
  await importRules(env, t.founder);
  let b = (await getRules(env, t.manager)).bareme;
  assert.deepEqual(b.levels.map((l) => [l.key, l.label, l.body]), [["mineure", "Mineure", ""], ["moderee", "Modérée", ""], ["grave", "Grave", ""], ["critique", "Critique", ""]]);
  assert.equal(b.intro, "Le barème reste indicatif et la décision finale dépend toujours du contexte.");
  assert.equal((await send(env, "/api/rules-bareme", t.manager, "PUT", { intro: "Indicatif.", levels: { grave: "Cas **sérieux**.\n* exemple" } })).status, 200);
  b = (await getPublic(env)).data.bareme;
  assert.equal(b.intro, "Indicatif.");
  assert.equal(b.levels.find((l) => l.key === "grave").body, "Cas **sérieux**.\n* exemple");
  assert.equal(b.levels.find((l) => l.key === "mineure").body, "", "un niveau non envoyé reste tel quel");
  assert.equal((await send(env, "/api/rules-bareme", t.manager, "PUT", { intro: "   " })).status, 200);
  assert.equal((await getPublic(env)).data.bareme.intro, "Le barème reste indicatif et la décision finale dépend toujours du contexte.", "intro vide : texte par défaut");
  assert.equal((await send(env, "/api/rules-bareme", t.manager, "PUT", { levels: { extreme: "x" } })).status, 400, "niveaux fixes");
  assert.equal((await send(env, "/api/rules-bareme", t.manager, "PUT", { levels: [] })).status, 200, "liste ignorée");
  // aucune règle n'est reliée à un niveau de sanction
  assert.ok(!JSON.stringify((await getPublic(env)).data.chapters).match(/mineure|grave|critique/i));
});

test("règlement : le texte saisi reste du texte (rien n'est interprété) et chaque changement est journalisé", async () => {
  const env = rulesEnv();
  const t = await tokens(env);
  await importRules(env, t.founder);
  const ch = (await getRules(env, t.manager)).chapters[0].id;
  const evil = `<img src=x onerror=alert(1)><script>alert(2)</script> ' OR 1=1 --`;
  const id = (await (await send(env, "/api/rules", t.manager, "POST", { chapter_id: ch, title: evil, body: evil })).json()).id;
  const back = (await getPublic(env)).data.chapters[0].rules.at(-1);
  assert.equal(back.title, evil); assert.equal(back.body, evil);
  assert.match((await call(env, "/api/public/rules")).headers.get("content-type"), /^application\/json/);
  await send(env, `/api/rules/${id}`, t.manager, "DELETE");
  const log = env.DB.raw.prepare("SELECT action, staff_name FROM audit WHERE action LIKE 'règlement%' ORDER BY id").all().map((a) => a.action);
  assert.ok(log.includes("règlement : règle ajoutée") && log.includes("règlement : règle supprimée") && log.includes("règlement : import terminé"), log.join(" | "));
});

test("règlement : le barème a aussi des sections libres (facteurs, récidive…), validées et servies au site", async () => {
  const env = rulesEnv();
  const t = await tokens(env);
  await importRules(env, t.founder);
  assert.deepEqual((await getRules(env, t.manager)).bareme.sections, [], "aucune section au départ");
  const sections = [
    { title: "  Facteurs   aggravants ", body: "Une sanction peut être augmentée :\n* récidive\n* mensonge", kind: "up" },
    { title: "Facteurs atténuants", body: "* erreur involontaire", kind: "down" },
    { title: "Récidive", body: "Texte." },
    { title: "Principe fondamental", body: "Un principe.", kind: "key" },
  ];
  assert.equal((await send(env, "/api/rules-bareme", t.manager, "PUT", { sections })).status, 200);
  const staff = (await getRules(env, t.manager)).bareme.sections;
  assert.deepEqual(staff.map((s) => [s.title, s.kind]), [["Facteurs aggravants", "up"], ["Facteurs atténuants", "down"], ["Récidive", "info"], ["Principe fondamental", "key"]]);
  assert.equal(staff[0].body, "Une sanction peut être augmentée :\n* récidive\n* mensonge");
  assert.deepEqual((await getPublic(env)).data.bareme.sections, staff, "servies telles quelles au site, dans l'ordre");
  // un envoi sans « sections » ne les efface pas ; un envoi vide les retire
  assert.equal((await send(env, "/api/rules-bareme", t.manager, "PUT", { intro: "Autre intro." })).status, 200);
  assert.equal((await getRules(env, t.manager)).bareme.sections.length, 4);
  assert.equal((await send(env, "/api/rules-bareme", t.manager, "PUT", { sections: [] })).status, 200);
  assert.deepEqual((await getRules(env, t.manager)).bareme.sections, []);
  // validations
  for (const [body, label] of [[{ sections: "non" }, "pas une liste"], [{ sections: [{ title: "  ", body: "x" }] }, "titre vide"], [{ sections: [{ title: "A", kind: "rouge" }] }, "type inconnu"], [{ sections: Array.from({ length: 13 }, (_, i) => ({ title: "S" + i })) }, "trop de sections"], [{ sections: [null] }, "élément invalide"]]) {
    assert.equal((await send(env, "/api/rules-bareme", t.manager, "PUT", body)).status, 400, label);
  }
  assert.deepEqual((await getRules(env, t.manager)).bareme.sections, [], "un refus ne change rien");
  const long = await send(env, "/api/rules-bareme", t.manager, "PUT", { sections: [{ title: "T".repeat(300), body: "b".repeat(5000) }], intro: "i".repeat(3000) });
  assert.equal(long.status, 200);
  const b = (await getRules(env, t.manager)).bareme;
  assert.equal(b.sections[0].title.length, 100); assert.equal(b.sections[0].body.length, 3000); assert.equal(b.intro.length, 1500);
  // droits : comme le reste du règlement
  assert.equal((await send(env, "/api/rules-bareme", t.admin, "PUT", { sections: [] })).status, 403);
  // texte hostile : jamais interprété
  await send(env, "/api/rules-bareme", t.manager, "PUT", { sections: [{ title: "<img src=x onerror=alert(1)>", body: "<script>1</script>" }] });
  assert.equal((await getPublic(env)).data.bareme.sections[0].title, "<img src=x onerror=alert(1)>");
});
