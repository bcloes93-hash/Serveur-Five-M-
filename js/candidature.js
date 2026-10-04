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

  /* ---------- Texte de la candidature ---------- */
  function compose(type, form) {
    var s = SCHEMAS[type];
    var lines = ["**" + s.title.toUpperCase() + " – " + (cfg.serverName || "Santos Legacy RP") + "**"];
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

  /* ---------- Envoi automatique (optionnel) ---------- */
  function send(endpoint, form, type) {
    var fd = new FormData(form);
    fd.append("_subject", SCHEMAS[type].title + " – " + (cfg.serverName || "Santos Legacy RP"));
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
    return fetch(endpoint, { method: "POST", body: fd, headers: { Accept: "application/json" }, signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        if (timer) clearTimeout(timer);
        if (!r.ok) throw new Error("HTTP " + r.status);
      }, function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  /* ---------- Résultat affiché sous le formulaire ---------- */
  var tpl = document.getElementById("result-tpl");

  function showResult(form, kind, text) {
    var old = $(".result", form);
    if (old) old.remove();

    var node = tpl.content.firstElementChild.cloneNode(true);
    var title = $(".result__title", node);
    var msg = $(".result__msg", node);
    var box = $(".result__box", node);
    var copyBtn = $("[data-copy]", node);
    var editBtn = $("[data-edit]", node);
    var discord = $("[data-discord-link]", node);
    if (cfg.discordInvite) discord.href = cfg.discordInvite;

    if (kind === "sent") {
      title.textContent = "Candidature envoyée";
      msg.textContent = "Merci ! Votre candidature a été transmise au staff. Pensez à rejoindre le Discord pour suivre la suite.";
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

  /* ---------- Soumission ---------- */
  $$("form[data-apply]").forEach(function (form) {
    var type = form.getAttribute("data-apply");
    var status = $(".form__status", form);
    var submit = $('[type="submit"]', form);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (form.elements._gotcha && form.elements._gotcha.value) return; // robot
      status.textContent = "";

      var text = compose(type, form);
      var endpoint = (apps[type] || "").trim();

      if (!endpoint) { showResult(form, "copy", text); return; }

      submit.disabled = true;
      var label = submit.textContent;
      submit.textContent = "Envoi en cours…";
      send(endpoint, form, type).then(function () {
        form.reset();
        $$(".counter", form).forEach(function (c) { c.textContent = c.textContent.replace(/^\d+/, "0"); });
        showResult(form, "sent");
      }, function () {
        showResult(form, "failed", text);
      }).then(function () {
        submit.disabled = false;
        submit.textContent = label;
      });
    });
  });
})();
