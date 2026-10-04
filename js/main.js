(function () {
  "use strict";

  var cfg = window.SITE_CONFIG || {};
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- Liens Discord / connexion ---------- */
  $$("[data-discord]").forEach(function (a) { if (cfg.discordInvite) a.href = cfg.discordInvite; });

  var cfx = (cfg.cfxCode || "").trim();
  if (cfx) {
    document.documentElement.classList.add("has-cfx");
    $$("[data-connect]").forEach(function (a) {
      a.href = "https://cfx.re/join/" + encodeURIComponent(cfx);
      a.target = "_blank";
      a.rel = "noopener";
    });
  }

  // Lien « Espace staff » : visible seulement quand le panel est configuré.
  if (cfg.staffApi) $$("[data-staff-link]").forEach(function (a) { a.hidden = false; });

  /* ---------- Règlement : tout déplier / replier, ouverture directe d'un article par son adresse (#r1-5) ---------- */
  $$("[data-rules-tools]").forEach(function (tools) {
    tools.hidden = false;   // sans JavaScript, les articles s'ouvrent un à un et ces boutons restent cachés
    var chapter = tools.closest(".chapter");
    var set = function (open) { $$("details.rule", chapter).forEach(function (d) { d.open = open; }); };
    $("[data-rules-open]", tools).addEventListener("click", function () { set(true); });
    $("[data-rules-close]", tools).addEventListener("click", function () { set(false); });
  });
  function openFromHash() {
    var id = "";
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { return; }
    var target = id ? document.getElementById(id) : null;
    if (target && target.matches("details.rule")) { target.open = true; target.scrollIntoView({ behavior: "instant", block: "start" }); }
  }
  window.addEventListener("hashchange", openFromHash);
  openFromHash();

  /* ---------- Menu mobile ---------- */
  var toggle = $(".nav__toggle");
  var menu = $("#menu");
  if (toggle && menu) {
    var setOpen = function (open) {
      toggle.setAttribute("aria-expanded", String(open));
      menu.classList.toggle("is-open", open);
    };
    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });
    menu.addEventListener("click", function (e) { if (e.target.closest("a")) setOpen(false); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { setOpen(false); toggle.focus(); }
    });
  }

  /* ---------- Année du pied de page ---------- */
  $$("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });

  /* ---------- Apparition au scroll ---------- */
  var reveals = $$(".reveal");
  if ("IntersectionObserver" in window && reveals.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("is-visible"); io.unobserve(en.target); }
      });
    }, { threshold: 0.15 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* ---------- Statistiques en direct ---------- */
  var nf = new Intl.NumberFormat("fr-FR");

  function fetchJSON(url) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 6000) : null;
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined, headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) { if (timer) clearTimeout(timer); return data; },
            function (err) { if (timer) clearTimeout(timer); throw err; });
  }

  // Discord : l'API d'invitation publique renvoie les compteurs approximatifs.
  var m = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/([\w-]+)/i.exec(cfg.discordInvite || "");
  if (m) {
    fetchJSON("https://discord.com/api/v10/invites/" + m[1] + "?with_counts=true")
      .then(function (d) {
        var members = $("[data-discord-members]");
        var online = $("[data-discord-online]");
        if (members && typeof d.approximate_member_count === "number") members.textContent = nf.format(d.approximate_member_count);
        if (online && typeof d.approximate_presence_count === "number") online.textContent = nf.format(d.approximate_presence_count);
      })
      .catch(function () { /* on garde « — » */ });
  }

  // FiveM : état et nombre de joueurs via l'API publique Cfx.re.
  var stateEl = $("[data-server-state]");
  var playersEl = $("[data-players]");
  function setState(kind, label) {
    if (!stateEl) return;
    stateEl.className = "badge badge--" + kind;
    stateEl.textContent = label;
  }
  if (cfx) {
    setState("unknown", "Vérification…");
    fetchJSON("https://servers-frontend.fivem.net/api/servers/single/" + encodeURIComponent(cfx))
      .then(function (res) {
        var d = res && res.Data;
        if (!d) throw new Error("réponse inattendue");
        setState("on", "En ligne");
        if (playersEl) playersEl.textContent = nf.format(d.clients || 0) + " / " + nf.format(d.sv_maxclients || 0);
      })
      .catch(function () {
        // Impossible de savoir (serveur hors ligne, ou API inaccessible depuis le navigateur).
        setState("unknown", "Statut indisponible");
      });
  }
})();
