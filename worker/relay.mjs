/**
 * Relais « candidatures → Discord » pour Santos Legacy RP (Cloudflare Worker).
 *
 * Pourquoi un relais ? Un webhook Discord écrit dans le site serait visible par
 * tout le monde (le dépôt est public) : n'importe qui pourrait inonder le salon.
 * Ici, le webhook reste secret dans Cloudflare ; le site n'envoie que les réponses
 * du formulaire, et ce relais les vérifie avant de les poster dans Discord.
 *
 * Variables à définir dans Cloudflare (voir worker/README.md) :
 *   ALLOWED_ORIGIN      adresse du site, ex. https://bcloes93-hash.github.io (plusieurs : séparées par des virgules)
 *   WEBHOOK_WHITELIST   webhook Discord du salon des candidatures WL      (secret)
 *   WEBHOOK_STAFF       webhook Discord du salon des candidatures staff   (secret)
 *   PING_ROLE_WHITELIST (optionnel) identifiant du rôle à mentionner pour une candidature WL
 *   PING_ROLE_STAFF     (optionnel) identifiant du rôle à mentionner pour une candidature staff
 *   COOLDOWN_SECONDS    (optionnel) délai entre deux candidatures d'une même personne, 1800 par défaut
 *   RATE_LIMIT          (optionnel) espace KV qui mémorise ce délai
 */

const SCHEMAS = {
  whitelist: {
    title: "Candidature Whitelist",
    color: 0xff3cac,
    webhook: "WEBHOOK_WHITELIST",
    ping: "PING_ROLE_WHITELIST",
    fields: [
      { key: "discord", label: "Pseudo Discord", max: 40, required: true, inline: true },
      { key: "age", label: "Âge", type: "age", inline: true },
      { key: "personnage", label: "Personnage", max: 60, required: true },
      { key: "experience", label: "Expérience en roleplay", max: 400, required: true },
      { key: "histoire", label: "Histoire du personnage", max: 700, min: 60, required: true },
      { key: "motivation", label: "Pourquoi Santos Legacy RP ?", max: 300 },
    ],
    checks: ["micro", "reglement"],
  },
  staff: {
    title: "Candidature Staff",
    color: 0x22d3ff,
    webhook: "WEBHOOK_STAFF",
    ping: "PING_ROLE_STAFF",
    fields: [
      { key: "discord", label: "Pseudo Discord", max: 40, required: true, inline: true },
      { key: "age", label: "Âge", type: "age", inline: true },
      { key: "poste", label: "Poste souhaité", type: "enum", values: ["Modérateur", "Administrateur", "Développeur", "Autre"], required: true },
      { key: "experience", label: "Expérience", max: 500, required: true },
      { key: "disponibilites", label: "Disponibilités", max: 150, required: true },
      { key: "motivation", label: "Motivation", max: 500, min: 60, required: true },
    ],
    checks: ["reglement"],
  },
};

const MAX_BODY_BYTES = 20000;
const WEBHOOK_PREFIX = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

function clean(value, max) {
  // Retire les caractères de contrôle (sauf retour à la ligne) puis tronque.
  return String(value ?? "").replace(/[^\S\n]+/g, " ").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim().slice(0, max);
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Valide le formulaire. Retourne { fields } ou { error }. */
function validate(schema, form) {
  const fields = [];
  for (const def of schema.fields) {
    const raw = form.get(def.key);
    if (def.type === "age") {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 18 || n > 99) return { error: "Âge invalide (18 ans minimum)." };
      fields.push({ name: def.label, value: String(n), inline: !!def.inline });
      continue;
    }
    if (def.type === "enum") {
      if (!def.values.includes(String(raw))) return { error: `Champ invalide : ${def.label}.` };
      fields.push({ name: def.label, value: String(raw), inline: false });
      continue;
    }
    const value = clean(raw, def.max);
    if (def.required && !value) return { error: `Champ obligatoire : ${def.label}.` };
    if (def.min && value && value.length < def.min) return { error: `${def.label} : ${def.min} caractères minimum.` };
    if (value) fields.push({ name: def.label, value, inline: !!def.inline });
  }
  for (const key of schema.checks) {
    if (form.get(key) !== "on") return { error: "Les cases obligatoires doivent être cochées." };
  }
  return { fields };
}

export default {
  async fetch(request, env) {
    const allowed = String(env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get("Origin") || "";
    const cors = allowed.includes(origin)
      ? { "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", vary: "Origin" }
      : {};

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ ok: false, error: "Méthode non autorisée." }, 405, cors);
    if (!allowed.includes(origin)) return json({ ok: false, error: "Origine non autorisée." }, 403, cors);

    if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
      return json({ ok: false, error: "Requête trop volumineuse." }, 413, cors);
    }

    let form;
    try { form = await request.formData(); } catch { return json({ ok: false, error: "Requête invalide." }, 400, cors); }

    // Champ piège rempli = robot : on répond « ok » sans rien envoyer.
    if (form.get("_gotcha")) return json({ ok: true }, 200, cors);

    const type = String(form.get("_type") || "");
    const schema = Object.prototype.hasOwnProperty.call(SCHEMAS, type) ? SCHEMAS[type] : null;
    if (!schema) return json({ ok: false, error: "Type de candidature inconnu." }, 400, cors);

    const checked = validate(schema, form);
    if (checked.error) return json({ ok: false, error: checked.error }, 400, cors);

    const hook = String(env[schema.webhook] || "");
    if (!WEBHOOK_PREFIX.test(hook)) return json({ ok: false, error: "Relais non configuré." }, 500, cors);

    // Délai entre deux candidatures d'une même personne (si l'espace KV est configuré).
    let rateKey = null;
    if (env.RATE_LIMIT) {
      const ip = request.headers.get("CF-Connecting-IP") || "inconnue";
      rateKey = "rl:" + type + ":" + (await sha256(ip));
      if (await env.RATE_LIMIT.get(rateKey)) {
        return json({ ok: false, error: "Candidature déjà envoyée récemment." }, 429, cors);
      }
    }

    const roleId = String(env[schema.ping] || "");
    const ping = /^\d{5,25}$/.test(roleId) ? roleId : null;

    const payload = {
      username: "Candidatures – Santos Legacy RP",
      content: ping ? `<@&${ping}> Nouvelle candidature reçue.` : undefined,
      // Aucune mention possible depuis le texte du candidat (@everyone, @rôle…).
      allowed_mentions: ping ? { parse: [], roles: [ping] } : { parse: [] },
      embeds: [{
        title: schema.title,
        color: schema.color,
        fields: checked.fields,
        footer: { text: "Envoyée depuis le site" },
        timestamp: new Date().toISOString(),
      }],
    };

    let res;
    try {
      res = await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    } catch {
      return json({ ok: false, error: "Discord injoignable." }, 502, cors);
    }
    if (!res.ok) return json({ ok: false, error: "Discord a refusé le message." }, 502, cors);

    if (rateKey) {
      const ttl = Math.max(60, Number(env.COOLDOWN_SECONDS) || 1800);
      await env.RATE_LIMIT.put(rateKey, "1", { expirationTtl: ttl });
    }
    return json({ ok: true }, 200, cors);
  },
};
