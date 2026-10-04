(function () {
  "use strict";

  var cfg = window.SITE_CONFIG || {};
  var apps = cfg.applications || {};
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* Champs repris dans le texte final (nom du champ, libellé). */
  var SCHEMAS = {
    whitelist: {
      title: "Candidature Whitelist",
      fields: [
        ["discord", "Pseudo Discord"],
        ["age", "Âge"],
        ["personnage", "Personnage (nom et prénom)"],
        ["experience", "Expérience en roleplay"],
        ["histoire", "Histoire du personnage"],
        ["motivation", "Pourquoi Santos Legacy RP ?"]
      ],
      checks: [["micro", "Micro de bonne qualité"], ["reglement", "Règlement lu et accepté"]]
    },
    staff: {
      title: "Candidature Staff",
      fields: [
        ["discord", "Pseudo Discord"],
        ["age", "Âge"],
        ["poste", "Poste souhaité"],
        ["experience", "Expérience"],
        ["disponibilites", "Disponibilités"],
        ["motivation", "Motivation"]
      ],
      checks: [["reglement", "Règlement lu et accepté"]]
    }
  };

  /* ---------- Onglets ---------- */
  var tabs = $$('[role="tab"]');
  var panels = tabs.map(function (t) { return document.getElementById(t.getAttribute("aria-controls")); });
  var keyOf = function (tab) { return tab.id.replace("tab-", ""); };

  function select(key, focus, updateHash) {
    tabs.forEach(function (t, i) {
      var on = keyOf(t) === key;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
      if (on && focus) t.focus();
    });
    if (updateHash && window.history && history.replaceState) history.replaceState(null, "", "#" + key);
  }
  function fromHash() {
    var k = location.hash.slice(1);
    return tabs.some(function (t) { return keyOf(t) === k; }) ? k : keyOf(tabs[0]);
  }

  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { select(keyOf(t), false, true); });
    t.addEventListener("keydown", function (e) {
      var n = tabs.length, j = null;
      if (e.key === "ArrowRight") j = (i + 1) % n;
      else if (e.key === "ArrowLeft") j = (i - 1 + n) % n;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = n - 1;
      if (j !== null) { e.preventDefault(); select(keyOf(tabs[j]), true, true); }
    });
  });
  window.addEventListener("hashchange", function () { select(fromHash(), false, false); });
  if (tabs.length) select(fromHash(), false, false);

  /* ---------- Compteurs de caractères ---------- */
  $$("textarea[maxlength]").forEach(function (t) {
    var c = document.createElement("span");
    c.className = "counter";
    c.setAttribute("aria-hidden", "true");
    t.parentNode.appendChild(c);
    var update = function () { c.textContent = t.value.length + " / " + t.maxLength; };
    t.addEventListener("input", update);
    update();
  });

  /* ---------- Âge minimum ---------- */
  $$('input[name="age"]').forEach(function (a) {
    a.addEventListener("input", function () {
      a.setCustomValidity(a.value !== "" && Number(a.value) < 18 ? "Vous devez avoir 18 ans minimum pour candidater." : "");
    });
  });

  /* ---------- Numéro de candidature ---------- */
  // Avec le relais, c'est lui qui attribue le numéro. Sans relais (copier-coller), le site en génère un
  // dans le même format pour que le staff puisse quand même retrouver la candidature.
  var ID_FORMAT = /^(?:WL|STAFF)-[A-HJ-NP-Z2-9]{6}$/;
  var ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var PREFIX = { whitelist: "WL", staff: "STAFF" };

  function genId(type) {
    var bytes = new Uint8Array(6);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (var i = 0; i < 6; i++) bytes[i] = Math.floor(Math.random() * 256);
    var out = PREFIX[type] + "-";
    for (var j = 0; j < 6; j++) out += ID_ALPHABET.charAt(bytes[j] % 32);
    return out;
  }

  /* ---------- Texte de la candidature ---------- */
  function compose(type, form, id) {
    var s = SCHEMAS[type];
    var lines = ["**" + s.title.toUpperCase() + " – " + (cfg.serverName || "Santos Legacy RP") + (id ? " – N° " + id : "") + "**"];
    s.fields.forEach(function (f) {
      var v = (form.elements[f[0]].value || "").trim();
      if (v) lines.push("**" + f[1] + " :** " + v);
    });
    s.checks.forEach(function (c) {
      lines.push("**" + c[1] + " :** " + (form.elements[c[0]].checked ? "oui" : "non"));
    });
    return lines.join("\n");
  }

  function copyText(text, box) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    }
    try { box.focus(); box.select(); return Promise.resolve(document.execCommand("copy")); }
    catch (e) { return Promise.resolve(false); }
  }

  /* ---------- Délai entre deux candidatures (confort ; le vrai contrôle est côté relais) ---------- */
  var COOLDOWN_MS = (Number(cfg.applicationCooldownMinutes) || 30) * 60000;

  function cooldownMsg(id) {
    return "Vous avez déjà envoyé votre candidature" + (id ? " (n° " + id + ")" : "") + " il y a peu. Merci de patienter : nous vous répondrons rapidement, inutile de la renvoyer.";
  }

  /* Retourne { id } si une candidature de ce type a été envoyée récemment, sinon null. */
  function recentlySent(type) {
    try {
      var raw = localStorage.getItem("sl_applied_" + type);
      if (!raw) return null;
      var rec = JSON.parse(raw);
      if (typeof rec === "number") rec = { t: rec, id: "" };   // ancien format
      if (!rec || Date.now() - (Number(rec.t) || 0) >= COOLDOWN_MS) return null;
      return { id: ID_FORMAT.test(rec.id || "") ? rec.id : "" };
    } catch (e) { return null; }
  }
  function markSent(type, id) {
    try { localStorage.setItem("sl_applied_" + type, JSON.stringify({ t: Date.now(), id: id || "" })); }
    catch (e) { /* stockage indisponible */ }
  }

  /* ---------- Envoi automatique (optionnel) ---------- */
  function send(endpoint, form, type) {
    var fd = new FormData(form);
    fd.append("_subject", SCHEMAS[type].title + " – " + (cfg.serverName || "Santos Legacy RP"));
    fd.append("_type", type);
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
    return fetch(endpoint, { method: "POST", body: fd, headers: { Accept: "application/json" }, signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        if (timer) clearTimeout(timer);
        return r.json().catch(function () { return {}; }).then(function (data) {
          var id = ID_FORMAT.test(String(data && data.id || "")) ? data.id : "";
          if (!r.ok) { var e = new Error("HTTP " + r.status); e.status = r.status; e.id = id; throw e; }
          return id;
        });
      }, function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  /* ---------- Résultat affiché sous le formulaire ---------- */
  var tpl = document.getElementById("result-tpl");

  function showResult(form, kind, text, id) {
    var old = $(".result", form);
    if (old) old.remove();

    var node = tpl.content.firstElementChild.cloneNode(true);
    var title = $(".result__title", node);
    var msg = $(".result__msg", node);
    var box = $(".result__box", node);
    var copyBtn = $("[data-copy]", node);
    var editBtn = $("[data-edit]", node);
    var discord = $("[data-discord-link]", node);
    var idLine = $(".result__id", node);
    if (cfg.discordInvite) discord.href = cfg.discordInvite;
    if (id) { $(".result__code", node).textContent = id; idLine.hidden = false; }

    if (kind === "sent") {
      title.textContent = "Candidature bien envoyée";
      msg.textContent = "Merci ! Votre candidature a bien été transmise au staff. Vous aurez une réponse rapidement : merci de ne pas spammer les demandes, une seule candidature suffit. Pensez à rejoindre le Discord pour suivre la suite.";
      box.hidden = true; copyBtn.hidden = true; editBtn.hidden = true;
    } else {
      box.value = text;
      box.rows = Math.min(16, text.split("\n").length + 3);
      title.textContent = "Votre candidature est prête";
      msg.textContent = kind === "failed"
        ? "L'envoi automatique n'a pas fonctionné. Pas de souci : copiez le texte ci-dessous, puis collez-le dans le salon prévu pour les candidatures sur le Discord."
        : "Dernière étape : copiez le texte ci-dessous, puis rejoignez le Discord et collez-le dans le salon prévu pour les candidatures.";
      copyBtn.addEventListener("click", function () {
        copyText(text, box).then(function (ok) { copyBtn.textContent = ok ? "Copié ✓" : "Sélectionnez puis copiez (Ctrl+C)"; if (!ok) box.select(); });
      });
      editBtn.addEventListener("click", function () {
        node.remove();
        form.classList.remove("is-done");
        $("input, textarea, select", form).focus();
      });
      copyText(text, box).then(function (ok) { if (ok) copyBtn.textContent = "Copié ✓"; });
    }

    form.classList.add("is-done");
    form.appendChild(node);
    node.focus();
  }

  /* ---------- Formulaire externe (optionnel) ---------- */
  var links = cfg.applicationLinks || {};

  function safeUrl(u) {
    try {
      var x = new URL(String(u || "").trim());
      return /^https?:$/.test(x.protocol) ? x.href : "";
    } catch (e) { return ""; }
  }

  function useExternal(form, type, url) {
    var box = document.createElement("div");
    box.className = "external";
    var p = document.createElement("p");
    p.textContent = "Cette candidature se remplit sur un formulaire en ligne, qui s'ouvre dans un nouvel onglet.";
    var a = document.createElement("a");
    a.className = "btn btn--primary";
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "Remplir la candidature " + (type === "staff" ? "Staff" : "WL");
    box.appendChild(p);
    box.appendChild(a);
    form.parentNode.insertBefore(box, form);
    form.hidden = true;
  }

  /* ---------- Soumission ---------- */
  $$("form[data-apply]").forEach(function (form) {
    var type = form.getAttribute("data-apply");
    var external = safeUrl(links[type]);
    if (external) { useExternal(form, type, external); return; }
    var status = $(".form__status", form);
    var submit = $('[type="submit"]', form);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (form.elements._gotcha && form.elements._gotcha.value) return; // robot
      status.textContent = "";

      // Numéro local : utilisé dans le texte à copier si le relais n'est pas utilisé ou n'a pas répondu.
      var localId = genId(type);
      var text = compose(type, form, localId);
      var endpoint = (apps[type] || "").trim();

      if (!endpoint) { showResult(form, "copy", text, localId); return; }

      var recent = recentlySent(type);
      if (recent) { status.textContent = cooldownMsg(recent.id); return; }

      submit.disabled = true;
      var label = submit.textContent;
      submit.textContent = "Envoi en cours…";
      send(endpoint, form, type).then(function (id) {
        markSent(type, id);
        form.reset();
        $$(".counter", form).forEach(function (c) { c.textContent = c.textContent.replace(/^\d+/, "0"); });
        showResult(form, "sent", null, id);
      }, function (err) {
        if (err && err.status === 429) { markSent(type, err.id); status.textContent = cooldownMsg(err.id); }
        else showResult(form, "failed", text, localId);
      }).then(function () {
        submit.disabled = false;
        submit.textContent = label;
      });
    });
  });
})();
