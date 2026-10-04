(function () {
  "use strict";

  var cfg = window.SITE_CONFIG || {};
  var API = String(cfg.staffApi || "").trim().replace(/\/+$/, "");
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var TYPES = { avertissement: "Avertissement", expulsion: "Expulsion", ban_temp: "Ban temporaire", ban_def: "Ban définitif", note: "Note" };
  var LEVELS = { mod: "Modération", admin: "Administration" };
  var ERRORS = {
    denied: "Connexion annulée.",
    state: "La connexion a expiré ou a été interrompue. Réessayez.",
    oauth: "Discord n'a pas pu confirmer votre identité. Réessayez dans un instant.",
    not_member: "Vous n'êtes pas membre du serveur Discord de Santos Legacy RP.",
    not_staff: "Votre compte n'a pas de rôle staff : accès refusé.",
    expired: "Votre session a expiré. Reconnectez-vous.",
    server: "Le panel a un problème technique (base de données). Prévenez le fondateur.",
    network: "Le panel est momentanément injoignable. Réessayez dans un instant."
  };

  var views = { unconfigured: $("#staff-unconfigured"), login: $("#staff-login"), app: $("#staff-app") };
  var state = { me: null };

  /* ---------- Outils ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   // jamais innerHTML : les données ne sont jamais interprétées
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function show(name) { Object.keys(views).forEach(function (k) { views[k].hidden = k !== name; }); }
  function fmtDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  }

  /* ---------- Session (jeton conservé uniquement pour l'onglet en cours) ---------- */
  function getToken() { try { return sessionStorage.getItem("sl_staff_token") || ""; } catch (e) { return ""; } }
  function setToken(t) { try { if (t) sessionStorage.setItem("sl_staff_token", t); else sessionStorage.removeItem("sl_staff_token"); } catch (e) { /* indisponible */ } }

  function showLogin(errorCode) {
    state.me = null;
    show("login");
    var box = $("#staff-error");
    if (errorCode) { box.textContent = ERRORS[errorCode] || "Connexion impossible."; box.hidden = false; }
    else box.hidden = true;
  }
  function logout(errorCode) { setToken(""); showLogin(errorCode); }

  /* ---------- Appels au panel ---------- */
  function api(method, path, body) {
    var opts = { method: method, headers: { Authorization: "Bearer " + getToken(), Accept: "application/json" } };
    if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(API + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401) { logout("expired"); throw { status: 401 }; }
        if (!r.ok) throw { status: r.status, message: data.error || "Une erreur est survenue." };
        return data;
      });
    }, function () { throw { status: 0, message: ERRORS.network }; });
  }

  /* ---------- Navigation entre les sections ---------- */
  var tabs = $$('.staff__tabs [data-view]');
  function go(name) {
    tabs.forEach(function (t) {
      var on = t.getAttribute("data-view") === name;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    ["home", "sanctions", "audit"].forEach(function (v) { $("#view-" + v).hidden = v !== name; });
    if (name === "sanctions") loadSanctions();
    if (name === "audit") loadAudit();
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { go(t.getAttribute("data-view")); });
    t.addEventListener("keydown", function (e) {
      var visible = tabs.filter(function (x) { return !x.hidden; });
      var k = visible.indexOf(t), j = null;
      if (e.key === "ArrowRight") j = (k + 1) % visible.length;
      else if (e.key === "ArrowLeft") j = (k - 1 + visible.length) % visible.length;
      if (j !== null) { e.preventDefault(); visible[j].focus(); go(visible[j].getAttribute("data-view")); }
    });
  });
  $$("[data-go]").forEach(function (b) { b.addEventListener("click", function () { go(b.getAttribute("data-go")); }); });

  /* ---------- Journal de sanctions ---------- */
  var list = $("#sanction-list");
  var hint = $("#sanction-hint");

  function renderSanction(s) {
    var type = TYPES[s.type] ? s.type : "note";
    var li = el("li", "sanction sanction--" + type);

    var head = el("div", "sanction__head");
    head.appendChild(el("span", "sanction__type", TYPES[type]));
    head.appendChild(el("strong", "sanction__player", s.player));
    if (s.ref) head.appendChild(el("span", "sanction__meta", s.ref));
    if (s.duration) head.appendChild(el("span", "sanction__meta", "Durée : " + s.duration));
    li.appendChild(head);

    li.appendChild(el("p", "sanction__reason", s.reason));

    var foot = el("div", "sanction__foot");
    foot.appendChild(el("span", null, "Par " + s.staff_name + " · " + fmtDate(s.created_at)));
    if (state.me && state.me.level === "admin") {
      var del = el("button", "btn btn--small btn--link", "Supprimer");
      del.type = "button";
      del.addEventListener("click", function () {
        if (!window.confirm("Supprimer cette sanction du journal ?")) return;
        api("DELETE", "/api/sanctions/" + encodeURIComponent(s.id)).then(loadSanctions, function (e) { hint.textContent = e.message || ""; });
      });
      foot.appendChild(del);
    }
    li.appendChild(foot);
    return li;
  }

  function loadSanctions() {
    var q = $("#s-search").value.trim();
    api("GET", "/api/sanctions" + (q ? "?q=" + encodeURIComponent(q) : "")).then(function (data) {
      clear(list);
      data.sanctions.forEach(function (s) { list.appendChild(renderSanction(s)); });
      hint.textContent = data.sanctions.length ? "" : (q ? "Aucun résultat pour cette recherche." : "Aucune sanction enregistrée pour le moment.");
    }, function (e) { if (e.status !== 401) hint.textContent = e.message || ""; });
  }

  var timer = null;
  $("#s-search").addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(loadSanctions, 300); });

  var form = $("#sanction-form");
  var statusEl = $("#sanction-status");
  var typeSel = $("#s-type");
  function syncDuration() {
    var temp = typeSel.value === "ban_temp";
    $("#s-duration-field").hidden = !temp;
    $("#s-duration").required = temp;
  }
  typeSel.addEventListener("change", syncDuration);
  syncDuration();

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    statusEl.className = "form__status";
    if (!form.reportValidity()) return;
    var btn = $('[type="submit"]', form);
    btn.disabled = true;
    api("POST", "/api/sanctions", {
      player: form.elements.player.value,
      ref: form.elements.ref.value,
      type: form.elements.type.value,
      duration: form.elements.duration.value,
      reason: form.elements.reason.value
    }).then(function () {
      form.reset();
      syncDuration();
      statusEl.className = "form__status form__status--ok";
      statusEl.textContent = "Sanction enregistrée.";
      loadSanctions();
    }, function (err) {
      if (err.status !== 401) statusEl.textContent = err.message || "Enregistrement impossible.";
    }).then(function () { btn.disabled = false; });
  });

  /* ---------- Journal d'activité (administration) ---------- */
  function loadAudit() {
    var ul = $("#audit-list");
    api("GET", "/api/audit").then(function (data) {
      clear(ul);
      data.audit.forEach(function (a) {
        var li = el("li", "audit__item");
        li.appendChild(el("span", "audit__when", fmtDate(a.at)));
        li.appendChild(el("strong", null, a.staff_name));
        li.appendChild(el("span", null, a.action));
        if (a.target) li.appendChild(el("span", "audit__target", a.target));
        ul.appendChild(li);
      });
    }, function () { /* 401 déjà géré */ });
  }

  /* ---------- Affichage du panel ---------- */
  function showApp(me) {
    state.me = me;
    $("#staff-name").textContent = me.name;
    $("#staff-level").textContent = LEVELS[me.level] || "";
    var img = $("#staff-avatar");
    if (me.avatar && /^https:\/\/cdn\.discordapp\.com\//.test(me.avatar)) { img.src = me.avatar; img.hidden = false; }
    else img.hidden = true;
    $$("[data-admin]").forEach(function (t) { t.hidden = me.level !== "admin"; });
    show("app");
    go("home");
  }
  $("#staff-logout").addEventListener("click", function () { logout(); });

  /* ---------- Démarrage ---------- */
  if (!API) { show("unconfigured"); return; }
  $("#staff-login-btn").href = API + "/login";

  // Retour de Discord : le jeton (ou l'erreur) arrive dans le fragment de l'adresse, jamais envoyé à un serveur.
  var frag = new URLSearchParams(location.hash.replace(/^#/, ""));
  var incoming = frag.get("token");
  var incomingError = frag.get("error");
  if (incoming || incomingError) {
    if (window.history && history.replaceState) history.replaceState(null, "", location.pathname + location.search);
    if (incoming && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(incoming)) setToken(incoming);
  }

  if (!getToken()) { showLogin(incomingError || null); return; }
  api("GET", "/api/me").then(showApp, function (e) {
    if (e.status === 401) return;           // déjà redirigé vers la connexion
    showLogin("network");
  });
})();
