(function () {
  "use strict";

  var cfg = window.SITE_CONFIG || {};
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- Liens Discord / connexion ---------- */
  $$("[data-discord]").forEach(function (a) { if (cfg.discordInvite) a.href = cfg.discordInvite; });
  // TikTok : lien du profil partout, ou rien du tout (liens et bandeau masqués) s'il n'est pas renseigné.
  var tiktok = /^https:\/\/(www\.)?tiktok\.com\//.test(cfg.tiktok || "") ? cfg.tiktok : "";
  $$("[data-tiktok]").forEach(function (a) { if (tiktok) a.href = tiktok; else a.hidden = true; });
  $$("[data-tiktok-band]").forEach(function (el) { el.hidden = !tiktok; });

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

  /* ---------- Compte à rebours d'ouverture (accueil) ---------- */
  // openingDate (js/config.js) porte son décalage horaire : la date est la même pour tous les visiteurs.
  var opening = cfg.openingDate ? new Date(cfg.openingDate) : null;
  if (opening && isNaN(opening.getTime())) opening = null;
  if (opening) {
    var when = (function (d) {
      try {
        var p = {};
        new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
          .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
        var time = Number(p.hour) + " h" + (p.minute !== "00" ? " " + p.minute : "");
        var day = p.day === "1" ? "1er" : p.day;
        return { long: p.weekday.charAt(0).toUpperCase() + p.weekday.slice(1) + " " + day + " " + p.month + " " + p.year + " à " + time, short: day + " " + p.month };
      } catch (e) {
        return { long: d.toLocaleString("fr-FR"), short: d.toLocaleDateString("fr-FR") };
      }
    })(opening);

    if (!cfx && Date.now() < opening.getTime()) setState("soon", "Ouverture le " + when.short);

    // Page Rejoindre : la date d'ouverture dans l'étape 4 et dans la FAQ
    var isOpen = Date.now() >= opening.getTime();
    $$("[data-opening-step]").forEach(function (p) {
      p.textContent = isOpen
        ? "Le serveur est ouvert : retrouvez le lien de connexion sur le Discord."
        : "Le serveur ouvre le " + when.long.charAt(0).toLowerCase() + when.long.slice(1) + " (heure de Paris). En attendant, retrouvez-nous sur le Discord.";
    });
    $$("[data-opening-answer]").forEach(function (p) {
      p.textContent = isOpen
        ? "Il est ouvert depuis le " + when.long.charAt(0).toLowerCase() + when.long.slice(1) + " (heure de Paris)."
        : "Le " + when.long.charAt(0).toLowerCase() + when.long.slice(1) + " (heure de Paris). Le compte à rebours est sur la page d'accueil.";
    });

    var cd = $("[data-countdown]");
    if (cd) {
      var clock = $("[data-countdown-clock]", cd), dateEl = $("[data-countdown-date]", cd), openEl = $("[data-countdown-open]", cd);
      var nums = {}, labels = {};
      ["d", "h", "m", "s"].forEach(function (k) { nums[k] = $('[data-cd="' + k + '"]', cd); labels[k] = $('[data-cd-label="' + k + '"]', cd); });
      var words = { d: ["jour", "jours"], h: ["heure", "heures"], m: ["minute", "minutes"], s: ["seconde", "secondes"] };
      var timer = null;
      var show = function (k, v, pad) {
        var txt = pad && v < 10 ? "0" + v : String(v);
        if (nums[k].textContent !== txt) nums[k].textContent = txt;
        labels[k].textContent = words[k][v < 2 ? 0 : 1];   // en français, 0 et 1 restent au singulier
      };
      var tick = function () {
        var left = Math.floor((opening.getTime() - Date.now()) / 1000);
        if (left <= 0) {
          clock.hidden = true; dateEl.hidden = true; openEl.hidden = false;
          if (!cfx) setState("on", "Ouvert");   // avec un code cfx.re, c'est l'API Cfx.re qui donne l'état réel
          if (timer) clearInterval(timer);
          return;
        }
        var d = Math.floor(left / 86400), h = Math.floor(left % 86400 / 3600), m = Math.floor(left % 3600 / 60), s = left % 60;
        show("d", d, false); show("h", h, true); show("m", m, true); show("s", s, true);
      };
      dateEl.textContent = when.long + " (heure de Paris)";
      cd.hidden = false;
      tick();
      if (opening.getTime() > Date.now()) timer = setInterval(tick, 1000);
    }
  }
})();
