// Tests du relais : `node --test worker/relay.test.mjs` (Node 20 ou plus récent, aucune dépendance).
import test from "node:test";
import assert from "node:assert/strict";
import relay from "./relay.mjs";

const ORIGIN = "https://bcloes93-hash.github.io";
const HOOK = "https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-123";

const baseEnv = () => ({ ALLOWED_ORIGIN: ORIGIN, WEBHOOK_WHITELIST: HOOK, WEBHOOK_STAFF: HOOK });

const wlFields = () => ({
  _type: "whitelist", discord: "testeur", age: "25", personnage: "Tony Santos",
  experience: "2 ans sur un autre serveur.", histoire: "Tony est arrivé à Los Santos pour monter son affaire et refaire sa vie.",
  motivation: "Ambiance sérieuse.", micro: "on", reglement: "on",
});

function post(fields, { origin = ORIGIN, env = baseEnv(), ip } = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const headers = {};
  if (origin) headers.Origin = origin;
  if (ip) headers["CF-Connecting-IP"] = ip;
  return relay.fetch(new Request("https://relais.example.workers.dev/", { method: "POST", body: fd, headers }), env);
}

/** Remplace fetch par un faux Discord et enregistre les appels. */
function fakeDiscord(status = 204) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status }); };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const fakeKV = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, size: () => m.size }; };

test("candidature WL valide : envoyée dans Discord sous forme d'embed", async () => {
  const d = fakeDiscord();
  try {
    const res = await post(wlFields());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal(d.calls.length, 1);
    assert.equal(d.calls[0].url, HOOK);
    const embed = d.calls[0].body.embeds[0];
    assert.equal(embed.title, "Candidature Whitelist");
    assert.ok(embed.fields.some((f) => f.name === "Personnage" && f.value === "Tony Santos"));
    assert.deepEqual(d.calls[0].body.allowed_mentions, { parse: [] });
  } finally { d.restore(); }
});

test("candidature Staff valide", async () => {
  const d = fakeDiscord();
  try {
    const res = await post({
      _type: "staff", discord: "staffeur", age: "22", poste: "Modérateur", experience: "Modérateur sur un serveur Discord.",
      disponibilites: "Soirs et week-ends", motivation: "Je veux aider la communauté à rester agréable, sérieuse et accueillante.", reglement: "on",
    });
    assert.equal(res.status, 200);
    assert.equal(d.calls[0].body.embeds[0].title, "Candidature Staff");
  } finally { d.restore(); }
});

test("origine non autorisée ou absente : refusée sans appeler Discord", async () => {
  const d = fakeDiscord();
  try {
    assert.equal((await post(wlFields(), { origin: "https://pirate.example" })).status, 403);
    assert.equal((await post(wlFields(), { origin: "" })).status, 403);
    assert.equal((await post(wlFields(), { env: { ...baseEnv(), ALLOWED_ORIGIN: "" } })).status, 403);
    assert.equal(d.calls.length, 0);
  } finally { d.restore(); }
});

test("préparation CORS (OPTIONS) et méthode GET", async () => {
  const pre = await relay.fetch(new Request("https://r.example/", { method: "OPTIONS", headers: { Origin: ORIGIN } }), baseEnv());
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), ORIGIN);
  const get = await relay.fetch(new Request("https://r.example/", { method: "GET", headers: { Origin: ORIGIN } }), baseEnv());
  assert.equal(get.status, 405);
});

test("âge inférieur à 18 ans, champ manquant, texte trop court, case non cochée : refusés", async () => {
  const d = fakeDiscord();
  try {
    assert.equal((await post({ ...wlFields(), age: "17" })).status, 400);
    assert.equal((await post({ ...wlFields(), age: "abc" })).status, 400);
    assert.equal((await post({ ...wlFields(), personnage: "" })).status, 400);
    assert.equal((await post({ ...wlFields(), histoire: "trop court" })).status, 400);
    assert.equal((await post({ ...wlFields(), micro: "" })).status, 400);
    assert.equal((await post({ ...wlFields(), _type: "inconnu" })).status, 400);
    assert.equal((await post({ ...wlFields(), _type: "__proto__" })).status, 400);
    assert.equal(d.calls.length, 0);
  } finally { d.restore(); }
});

test("poste staff hors liste : refusé", async () => {
  const res = await post({ _type: "staff", discord: "x", age: "30", poste: "Dieu", experience: "x", disponibilites: "x", motivation: "y".repeat(80), reglement: "on" });
  assert.equal(res.status, 400);
});

test("champ piège rempli (robot) : réponse ok mais rien envoyé", async () => {
  const d = fakeDiscord();
  try {
    const res = await post({ ...wlFields(), _gotcha: "spam" });
    assert.equal(res.status, 200);
    assert.equal(d.calls.length, 0);
  } finally { d.restore(); }
});

test("les mentions @everyone du candidat ne notifient personne", async () => {
  const d = fakeDiscord();
  try {
    await post({ ...wlFields(), motivation: "@everyone @here <@&1234567890>" });
    assert.deepEqual(d.calls[0].body.allowed_mentions, { parse: [] });
    assert.equal(d.calls[0].body.content, undefined);
  } finally { d.restore(); }
});

test("rôle à mentionner : seul ce rôle est notifié", async () => {
  const d = fakeDiscord();
  try {
    await post(wlFields(), { env: { ...baseEnv(), PING_ROLE_WHITELIST: "987654321012345678" } });
    assert.match(d.calls[0].body.content, /<@&987654321012345678>/);
    assert.deepEqual(d.calls[0].body.allowed_mentions, { parse: [], roles: ["987654321012345678"] });
  } finally { d.restore(); }
});

test("textes tronqués aux longueurs prévues", async () => {
  const d = fakeDiscord();
  try {
    await post({ ...wlFields(), histoire: "a".repeat(5000) });
    const f = d.calls[0].body.embeds[0].fields.find((x) => x.name === "Histoire du personnage");
    assert.equal(f.value.length, 700);
  } finally { d.restore(); }
});

test("délai anti-spam : la 2e candidature de la même personne reçoit 429", async () => {
  const d = fakeDiscord();
  const env = { ...baseEnv(), RATE_LIMIT: fakeKV() };
  try {
    assert.equal((await post(wlFields(), { env, ip: "1.2.3.4" })).status, 200);
    assert.equal((await post(wlFields(), { env, ip: "1.2.3.4" })).status, 429);
    assert.equal((await post(wlFields(), { env, ip: "5.6.7.8" })).status, 200, "une autre personne n'est pas bloquée");
    assert.equal(d.calls.length, 2);
    assert.equal(env.RATE_LIMIT.size(), 2);
  } finally { d.restore(); }
});

test("une candidature refusée ne déclenche pas le délai anti-spam", async () => {
  const d = fakeDiscord();
  const env = { ...baseEnv(), RATE_LIMIT: fakeKV() };
  try {
    assert.equal((await post({ ...wlFields(), age: "10" }, { env, ip: "1.2.3.4" })).status, 400);
    assert.equal((await post(wlFields(), { env, ip: "1.2.3.4" })).status, 200);
  } finally { d.restore(); }
});

test("Discord en erreur : 502 et pas de délai enregistré", async () => {
  const d = fakeDiscord(500);
  const env = { ...baseEnv(), RATE_LIMIT: fakeKV() };
  try {
    assert.equal((await post(wlFields(), { env, ip: "1.2.3.4" })).status, 502);
    assert.equal(env.RATE_LIMIT.size(), 0);
  } finally { d.restore(); }
});

test("webhook absent ou invalide : 500 sans appel réseau", async () => {
  const d = fakeDiscord();
  try {
    assert.equal((await post(wlFields(), { env: { ALLOWED_ORIGIN: ORIGIN } })).status, 500);
    assert.equal((await post(wlFields(), { env: { ...baseEnv(), WEBHOOK_WHITELIST: "https://pirate.example/hook" } })).status, 500);
    assert.equal(d.calls.length, 0);
  } finally { d.restore(); }
});
