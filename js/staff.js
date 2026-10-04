(function () {
  "use strict";

  var cfg = window.SITE_CONFIG || {};
  var API = String(cfg.staffApi || "").trim().replace(/\/+$/, "");
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var TYPES = { avertissement: "Avertissement", expulsion: "Expulsion", ban_temp: "Ban temporaire", ban_def: "Ban définitif", note: "Note" };
  var LEVELS = { support: "Support", mod: "Modération", admin: "Administration" };
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
    // Si on était en bas d'une longue section, on remonte au début de la nouvelle.
    var main = $(".staff__main");
    if (main && main.getBoundingClientRect().top < 0) main.scrollIntoView({ block: "start" });
    tabs.forEach(function (t) {
      var on = t.getAttribute("data-view") === name;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    ["home", "sanctions", "commands", "org", "audit"].forEach(function (v) { $("#view-" + v).hidden = v !== name; });
    if (name === "sanctions") setSub(subView);
    if (name === "commands") { loadCommands(); if (!cmdState.editing) cForm.elements.platform.value = cmdState.platform; }
    if (name === "org") loadOrg();
    if (name === "audit") loadAudit();
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { go(t.getAttribute("data-view")); });
    t.addEventListener("keydown", function (e) {
      var visible = tabs.filter(function (x) { return !x.hidden; });
      var k = visible.indexOf(t), j = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (k + 1) % visible.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (k - 1 + visible.length) % visible.length;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = visible.length - 1;
      if (j !== null) { e.preventDefault(); visible[j].focus(); go(visible[j].getAttribute("data-view")); }
    });
  });
  $$("[data-go]").forEach(function (b) { b.addEventListener("click", function () { go(b.getAttribute("data-go")); }); });

  // Menu vertical sur grand écran, horizontal sur mobile : on l'indique aux lecteurs d'écran.
  var tablist = $(".staff__tabs");
  var wide = window.matchMedia ? window.matchMedia("(min-width: 901px)") : null;
  function syncOrientation() { tablist.setAttribute("aria-orientation", wide && wide.matches ? "vertical" : "horizontal"); }
  syncOrientation();
  if (wide && wide.addEventListener) wide.addEventListener("change", syncOrientation);

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
    return api("GET", "/api/sanctions" + (q ? "?q=" + encodeURIComponent(q) : "")).then(function (data) {
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
    statusEl.textContent = "";            // efface le message de l'envoi précédent
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
      return loadSanctions().then(function () {
        statusEl.className = "form__status form__status--ok";
        statusEl.textContent = "Sanction enregistrée.";
      });
    }, function (err) {
      if (err.status !== 401) statusEl.textContent = err.message || "Enregistrement impossible.";
    }).then(function () { btn.disabled = false; });
  });

  /* ---------- Outils communs aux formulaires d'administration ---------- */
  function isAdmin() { return !!state.me && state.me.level === "admin"; }
  // Le journal des sanctions est réservé à la modération et à l'administration (pas au support).
  function canJournal() { return !!state.me && (state.me.level === "admin" || state.me.level === "mod"); }

  function copyText(text, done) {
    var fallback = function () {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      done(ok);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    else fallback();
  }

  function linkButton(label, onClick, danger) {
    var b = el("button", "btn btn--small btn--link" + (danger ? " btn--danger" : ""), label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  /* ---------- Barème des sanctions ---------- */
  var STEP_LABEL = { avertissement: "Avertissement", expulsion: "Expulsion", ban_temp: "Ban", ban_def: "Ban définitif", autre: "" };
  var STEP_OPTIONS = [["avertissement", "Avertissement"], ["expulsion", "Expulsion"], ["ban_temp", "Ban temporaire"], ["ban_def", "Ban définitif"], ["autre", "Autre"]];
  var ORD = ["1ʳᵉ fois", "2ᵉ fois", "3ᵉ fois", "4ᵉ fois", "5ᵉ fois"];
  var penState = { items: [], editing: null };
  var pList = $("#p-list"), pCount = $("#p-count"), pSearch = $("#p-search");
  var pForm = $("#penalty-form"), pStatus = $("#p-status");

  function stepText(s) {
    if (s.type === "ban_temp") return "Ban " + s.detail;
    if (s.type === "autre") return s.detail;
    return STEP_LABEL[s.type] + (s.detail ? " + " + s.detail : "");
  }

  function renderPenalty(p) {
    var li = el("li", "penalty");
    li.appendChild(el("h4", "penalty__name", p.name));
    var ol = el("ol", "ladder");
    p.steps.forEach(function (s, i) {
      var type = STEP_LABEL.hasOwnProperty(s.type) ? s.type : "autre";
      var step = el("li", "ladder__step ladder__step--" + type);
      step.appendChild(el("span", "ladder__n", p.steps.length === 1 ? "Immédiat" : ORD[i]));
      step.appendChild(el("span", "ladder__what", stepText(s)));
      ol.appendChild(step);
    });
    li.appendChild(ol);
    if (p.notes) li.appendChild(el("p", "penalty__notes", p.notes));

    var actions = el("div", "penalty__actions");
    if (canJournal()) {
      var note = el("button", "btn btn--small btn--ghost", "Noter dans le journal");
      note.type = "button";
      note.addEventListener("click", function () {
        go("sanctions"); setSub("journal");
        $("#s-reason").value = p.name;
        $("#s-player").focus();
      });
      actions.appendChild(note);
    }
    if (isAdmin()) {
      actions.appendChild(linkButton("Modifier", function () { startEditPenalty(p); }));
      actions.appendChild(linkButton("Supprimer", function () {
        if (!window.confirm("Supprimer « " + p.name + " » du barème ?")) return;
        api("DELETE", "/api/penalties/" + encodeURIComponent(p.id)).then(loadPenalties, function (e) { pCount.textContent = e.message || ""; });
      }, true));
    }
    li.appendChild(actions);
    return li;
  }

  function renderPenalties() {
    var q = pSearch.value.trim().toLowerCase();
    var shown = penState.items.filter(function (p) {
      var hay = p.name + " " + p.cat + " " + p.notes + " " + p.steps.map(stepText).join(" ");
      return !q || hay.toLowerCase().indexOf(q) !== -1;
    });
    clear(pList);
    if (!penState.items.length) {
      pCount.textContent = "";
      pList.appendChild(el("p", "cmd__empty", isAdmin() ? "Le barème est vide. Ajoutez une infraction avec le formulaire ci-dessous." : "Le barème est vide pour le moment."));
      return;
    }
    pCount.textContent = shown.length + (shown.length > 1 ? " infractions" : " infraction");
    if (!shown.length) { pList.appendChild(el("p", "cmd__empty", "Aucune infraction ne correspond à votre recherche.")); return; }
    var cats = [], byCat = {};
    shown.forEach(function (p) { if (!byCat[p.cat]) { byCat[p.cat] = []; cats.push(p.cat); } byCat[p.cat].push(p); });
    cats.forEach(function (cat) {
      var group = el("section", "cmd__group");
      group.appendChild(el("h3", "cmd__cat", cat));
      var ul = el("ul", "cmd__items");
      byCat[cat].forEach(function (p) { ul.appendChild(renderPenalty(p)); });
      group.appendChild(ul);
      pList.appendChild(group);
    });
  }

  function loadPenalties() {
    return api("GET", "/api/penalties").then(function (data) {
      penState.items = data.penalties;
      renderPenalties();
      var dl = $("#p-cats"); clear(dl);
      var seen = {};
      penState.items.forEach(function (p) { if (!seen[p.cat]) { seen[p.cat] = 1; var o = document.createElement("option"); o.value = p.cat; dl.appendChild(o); } });
    }, function (e) { if (e.status !== 401) pCount.textContent = e.message || ""; });
  }
  pSearch.addEventListener("input", renderPenalties);

  // Éditeur de paliers : 5 lignes (type + précision), la 1re est obligatoire.
  function syncStepRow(i) {
    var sel = pForm.elements["stype" + i], inp = pForm.elements["sdetail" + i], t = sel.value;
    inp.disabled = t === "" || t === "ban_def";
    inp.required = t === "ban_temp" || t === "autre";
    if (inp.disabled) inp.value = "";
    inp.placeholder = t === "ban_temp" ? "Durée (obligatoire), ex. 3 jours" : t === "autre" ? "Sanction (obligatoire)" : t === "avertissement" || t === "expulsion" ? "Précision (facultatif)" : "";
  }
  (function buildStepsEditor() {
    var box = $("#p-steps");
    for (var i = 0; i < 5; i++) (function (i) {
      var row = el("div", "steprow");
      var lab = el("label", "steprow__n", ORD[i]);
      lab.setAttribute("for", "p-type-" + i);
      var sel = document.createElement("select");
      sel.id = "p-type-" + i; sel.name = "stype" + i;
      if (i > 0) { var none = document.createElement("option"); none.value = ""; none.textContent = "— aucun palier"; sel.appendChild(none); }
      STEP_OPTIONS.forEach(function (o) { var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op); });
      var inp = document.createElement("input");
      inp.type = "text"; inp.id = "p-detail-" + i; inp.name = "sdetail" + i; inp.maxLength = 40; inp.autocomplete = "off";
      inp.setAttribute("aria-label", "Précision du palier " + (i + 1));
      sel.addEventListener("change", function () { syncStepRow(i); });
      row.appendChild(lab); row.appendChild(sel); row.appendChild(inp);
      box.appendChild(row);
    })(i);
    for (var j = 0; j < 5; j++) syncStepRow(j);
  })();

  function collectSteps() {
    var steps = [];
    for (var i = 0; i < 5; i++) {
      var t = pForm.elements["stype" + i].value;
      if (t) steps.push({ type: t, detail: pForm.elements["sdetail" + i].value });
    }
    return steps;
  }

  function resetPenaltyForm() {
    pForm.reset();
    for (var i = 0; i < 5; i++) syncStepRow(i);
    penState.editing = null;
    $("#p-form-title").textContent = "Ajouter une infraction au barème";
    $("#p-submit").textContent = "Ajouter";
    $("#p-cancel").hidden = true;
  }
  function startEditPenalty(p) {
    penState.editing = p.id;
    pForm.elements.infraction.value = p.name; pForm.elements.cat.value = p.cat; pForm.elements.notes.value = p.notes;
    for (var i = 0; i < 5; i++) {
      var s = p.steps[i];
      pForm.elements["stype" + i].value = s ? s.type : (i === 0 ? "avertissement" : "");
      pForm.elements["sdetail" + i].value = s ? s.detail : "";
      syncStepRow(i);
      if (s) pForm.elements["sdetail" + i].value = s.detail;   // syncStepRow vide la précision d'un palier désactivé : on la remet
    }
    $("#p-form-title").textContent = "Modifier l'infraction";
    $("#p-submit").textContent = "Enregistrer";
    $("#p-cancel").hidden = false;
    pStatus.textContent = "";
    pForm.elements.infraction.focus();
    pForm.scrollIntoView({ block: "center" });
  }
  $("#p-cancel").addEventListener("click", resetPenaltyForm);

  pForm.addEventListener("submit", function (e) {
    e.preventDefault();
    pStatus.className = "form__status";
    pStatus.textContent = "";
    if (!pForm.reportValidity()) return;
    var body = { name: pForm.elements.infraction.value, cat: pForm.elements.cat.value, notes: pForm.elements.notes.value, steps: collectSteps() };
    var btn = $("#p-submit");
    btn.disabled = true;
    var req = penState.editing ? api("PUT", "/api/penalties/" + encodeURIComponent(penState.editing), body) : api("POST", "/api/penalties", body);
    req.then(function () {
      resetPenaltyForm();
      return loadPenalties().then(function () {
        pStatus.className = "form__status form__status--ok";
        pStatus.textContent = "Barème mis à jour.";
      });
    }, function (err) {
      if (err.status !== 401) pStatus.textContent = err.message || "Enregistrement impossible.";
    }).then(function () { btn.disabled = false; });
  });

  /* ---------- Sous-onglets de « Sanctions » : Barème / Journal ---------- */
  var subView = "penalties";
  function setSub(name) {
    if (name === "journal" && !canJournal()) name = "penalties";
    subView = name;
    $$(".seg__btn[data-sub]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-sub") === name)); });
    $("#sub-penalties").hidden = name !== "penalties";
    $("#sub-journal").hidden = name !== "journal";
    if (name === "penalties") loadPenalties(); else loadSanctions();
  }
  $$(".seg__btn[data-sub]").forEach(function (b) { b.addEventListener("click", function () { setSub(b.getAttribute("data-sub")); }); });

  /* ---------- Commandes (Discord / FiveM) ---------- */
  var cmdState = { platform: "discord", items: [], editing: null };
  var cList = $("#c-list"), cCount = $("#c-count"), cSearch = $("#c-search");
  var cForm = $("#command-form"), cStatus = $("#c-status");

  function renderCommand(c) {
    var li = el("li", "cmd");
    var top = el("div", "cmd__top");
    top.appendChild(el("code", "cmd__code", c.cmd));
    var copy = el("button", "btn btn--small btn--ghost cmd__copy", "Copier");
    copy.type = "button";
    copy.setAttribute("aria-label", "Copier la commande " + c.cmd);
    copy.addEventListener("click", function () {
      copyText(c.cmd, function (ok) {
        copy.textContent = ok ? "Copié ✓" : "Copie impossible";
        setTimeout(function () { copy.textContent = "Copier"; }, 1800);
      });
    });
    top.appendChild(copy);
    li.appendChild(top);
    li.appendChild(el("p", "cmd__desc", c.descr));
    if (c.example) {
      var ex = el("p", "cmd__ex", "Exemple : ");
      ex.appendChild(el("code", null, c.example));
      li.appendChild(ex);
    }
    if (isAdmin()) {
      var admin = el("div", "cmd__admin");
      admin.appendChild(linkButton("Modifier", function () { startEditCommand(c); }));
      admin.appendChild(linkButton("Supprimer", function () {
        if (!window.confirm("Supprimer la commande « " + c.cmd + " » ?")) return;
        api("DELETE", "/api/commands/" + encodeURIComponent(c.id)).then(loadCommands, function (e) { cCount.textContent = e.message || ""; });
      }, true));
      li.appendChild(admin);
    }
    return li;
  }

  function renderCommands() {
    var q = cSearch.value.trim().toLowerCase();
    var all = cmdState.items.filter(function (c) { return c.platform === cmdState.platform; });
    var shown = all.filter(function (c) { return !q || (c.cmd + " " + c.descr + " " + c.cat + " " + c.example).toLowerCase().indexOf(q) !== -1; });
    clear(cList);
    if (!all.length) {
      cCount.textContent = "";
      cList.appendChild(el("p", "cmd__empty", isAdmin() ? "Aucune commande pour le moment. Ajoutez-en avec le formulaire ci-dessous." : "Aucune commande pour le moment."));
      return;
    }
    cCount.textContent = shown.length + (shown.length > 1 ? " commandes" : " commande");
    if (!shown.length) { cList.appendChild(el("p", "cmd__empty", "Aucune commande ne correspond à votre recherche.")); return; }
    var cats = [], byCat = {};
    shown.forEach(function (c) { if (!byCat[c.cat]) { byCat[c.cat] = []; cats.push(c.cat); } byCat[c.cat].push(c); });
    cats.forEach(function (cat) {
      var group = el("section", "cmd__group");
      group.appendChild(el("h3", "cmd__cat", cat));
      var ul = el("ul", "cmd__items");
      byCat[cat].forEach(function (c) { ul.appendChild(renderCommand(c)); });
      group.appendChild(ul);
      cList.appendChild(group);
    });
  }

  function refreshCategories() {
    var dl = $("#c-cats"); clear(dl);
    var seen = {};
    cmdState.items.forEach(function (c) { if (!seen[c.cat]) { seen[c.cat] = 1; var o = document.createElement("option"); o.value = c.cat; dl.appendChild(o); } });
  }

  function loadCommands() {
    return api("GET", "/api/commands").then(function (data) {
      cmdState.items = data.commands;
      renderCommands(); refreshCategories();
    }, function (e) { if (e.status !== 401) cCount.textContent = e.message || ""; });
  }

  function setPlatform(p) {
    cmdState.platform = p;
    $$(".seg__btn[data-platform]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-platform") === p)); });
    renderCommands();
  }
  $$(".seg__btn[data-platform]").forEach(function (b) {
    b.addEventListener("click", function () { setPlatform(b.getAttribute("data-platform")); if (!cmdState.editing) cForm.elements.platform.value = cmdState.platform; });
  });
  cSearch.addEventListener("input", renderCommands);

  function resetCommandForm() {
    cForm.reset();
    cForm.elements.platform.value = cmdState.platform;
    cmdState.editing = null;
    $("#c-form-title").textContent = "Ajouter une commande";
    $("#c-submit").textContent = "Ajouter";
    $("#c-cancel").hidden = true;
  }
  function startEditCommand(c) {
    cmdState.editing = c.id;
    cForm.elements.platform.value = c.platform; cForm.elements.cat.value = c.cat; cForm.elements.cmd.value = c.cmd;
    cForm.elements.descr.value = c.descr; cForm.elements.example.value = c.example;
    $("#c-form-title").textContent = "Modifier la commande";
    $("#c-submit").textContent = "Enregistrer";
    $("#c-cancel").hidden = false;
    cStatus.textContent = "";
    cForm.elements.cmd.focus();
    cForm.scrollIntoView({ block: "center" });
  }
  $("#c-cancel").addEventListener("click", resetCommandForm);

  cForm.addEventListener("submit", function (e) {
    e.preventDefault();
    cStatus.className = "form__status";
    cStatus.textContent = "";
    if (!cForm.reportValidity()) return;
    var body = { platform: cForm.elements.platform.value, cat: cForm.elements.cat.value, cmd: cForm.elements.cmd.value, descr: cForm.elements.descr.value, example: cForm.elements.example.value };
    var btn = $("#c-submit");
    btn.disabled = true;
    var req = cmdState.editing ? api("PUT", "/api/commands/" + encodeURIComponent(cmdState.editing), body) : api("POST", "/api/commands", body);
    req.then(function () {
      var p = body.platform;
      resetCommandForm();
      setPlatform(p);
      return loadCommands().then(function () {
        cStatus.className = "form__status form__status--ok";
        cStatus.textContent = "Commande enregistrée.";
      });
    }, function (err) {
      if (err.status !== 401) cStatus.textContent = err.message || "Enregistrement impossible.";
    }).then(function () { btn.disabled = false; });
  });

  /* ---------- Organigramme ---------- */
  var KIND_CLASS = { founder: "member--founder", manager: "member--manager", admin: "member--admin", mod: "member--mod", other: "member--other" };
  var KIND_LABEL = { founder: "rose", manager: "violet", admin: "cyan", mod: "vert", other: "gris" };
  var orgState = { items: [], editing: null };
  var mForm = $("#member-form"), mStatus = $("#m-status");

  function orgLink() { var d = el("div", "org__link"); d.setAttribute("aria-hidden", "true"); return d; }

  function orgNode(m) {
    var li = el("li", "member " + (KIND_CLASS[m.kind] || "member--other") + " org__node");
    var av = el("span", "member__avatar", String(m.name || "?").charAt(0).toUpperCase());
    av.setAttribute("aria-hidden", "true");
    li.appendChild(av);
    var box = document.createElement("div");
    box.appendChild(el("span", "member__name", m.name));
    box.appendChild(el("span", "member__role", m.role));
    li.appendChild(box);
    return li;
  }

  function renderOrg() {
    var chart = $("#org-chart"), hint = $("#org-hint");
    clear(chart);
    hint.textContent = "";
    if (!orgState.items.length) {
      hint.textContent = isAdmin() ? "L'organigramme est vide. Ajoutez des membres avec le formulaire ci-dessous." : "L'organigramme est vide pour le moment.";
      $("#org-summary").textContent = "";
      return;
    }
    var tiers = [], byTier = {};
    orgState.items.forEach(function (m) { if (!byTier[m.tier]) { byTier[m.tier] = []; tiers.push(m.tier); } byTier[m.tier].push(m); });
    tiers.sort(function (a, b) { return a - b; });

    // Niveaux consécutifs du même groupe = un seul encadré.
    var groups = [];
    tiers.forEach(function (t) {
      var label = byTier[t][0].grp, last = groups[groups.length - 1];
      if (last && last.label === label) last.tiers.push(t); else groups.push({ label: label, tiers: [t] });
    });

    groups.forEach(function (g, gi) {
      if (gi) chart.appendChild(orgLink());
      var box = el("div", "org__group");
      box.setAttribute("data-label", g.label);
      g.tiers.forEach(function (t, ti) {
        if (ti) box.appendChild(orgLink());
        var list = byTier[t], n = list.length;
        var row = el("ul", "org__row");
        if (n > 1 && n <= 5) {
          row.className += " org__row--multi";
          row.style.setProperty("--n", String(n));
          row.style.setProperty("--w", Math.min(260, Math.floor((800 - (n - 1) * 16) / n)) + "px");
        } else if (n > 5) row.className += " org__row--wrap";
        list.forEach(function (m) { row.appendChild(orgNode(m)); });
        box.appendChild(row);
      });
      chart.appendChild(box);
    });

    $("#org-summary").textContent = "Hiérarchie, du haut vers le bas : " + tiers.map(function (t) {
      return byTier[t].map(function (m) { return m.name + " (" + m.role + ")"; }).join(", ");
    }).join(" ; puis ") + ".";
  }

  function renderMembers() {
    var ul = $("#m-list"); clear(ul);
    var dl = $("#m-grps"); clear(dl);
    var seen = {};
    orgState.items.forEach(function (m) {
      if (!seen[m.grp]) { seen[m.grp] = 1; var o = document.createElement("option"); o.value = m.grp; dl.appendChild(o); }
      var li = el("li", "manage__item");
      var info = el("div", "manage__info");
      info.appendChild(el("strong", null, m.name));
      info.appendChild(el("span", "manage__meta", m.role + " · " + m.grp + " · niveau " + m.tier + " · carte " + (KIND_LABEL[m.kind] || "grise")));
      li.appendChild(info);
      var actions = el("div", "manage__actions");
      actions.appendChild(linkButton("Modifier", function () { startEditMember(m); }));
      actions.appendChild(linkButton("Retirer", function () {
        if (!window.confirm("Retirer « " + m.name + " » de l'organigramme ?")) return;
        api("DELETE", "/api/org/" + encodeURIComponent(m.id)).then(loadOrg, function (e) { mStatus.textContent = e.message || ""; });
      }, true));
      li.appendChild(actions);
      ul.appendChild(li);
    });
  }

  function loadOrg() {
    return api("GET", "/api/org").then(function (data) {
      orgState.items = data.org;
      renderOrg(); renderMembers();
    }, function (e) { if (e.status !== 401) $("#org-hint").textContent = e.message || ""; });
  }

  function resetMemberForm() {
    mForm.reset();
    orgState.editing = null;
    $("#m-form-title").textContent = "Gérer l'organigramme";
    $("#m-submit").textContent = "Ajouter";
    $("#m-cancel").hidden = true;
  }
  function startEditMember(m) {
    orgState.editing = m.id;
    var f = mForm.elements;
    f.name.value = m.name; f.role.value = m.role; f.grp.value = m.grp; f.tier.value = m.tier; f.kind.value = m.kind; f.position.value = m.position;
    $("#m-form-title").textContent = "Modifier un membre";
    $("#m-submit").textContent = "Enregistrer";
    $("#m-cancel").hidden = false;
    mStatus.textContent = "";
    f.name.focus();
    mForm.scrollIntoView({ block: "center" });
  }
  $("#m-cancel").addEventListener("click", resetMemberForm);

  mForm.addEventListener("submit", function (e) {
    e.preventDefault();
    mStatus.className = "form__status";
    mStatus.textContent = "";
    if (!mForm.reportValidity()) return;
    var f = mForm.elements;
    var body = { name: f.name.value, role: f.role.value, grp: f.grp.value, tier: f.tier.value, kind: f.kind.value, position: f.position.value };
    var btn = $("#m-submit");
    btn.disabled = true;
    var req = orgState.editing ? api("PUT", "/api/org/" + encodeURIComponent(orgState.editing), body) : api("POST", "/api/org", body);
    req.then(function () {
      resetMemberForm();
      return loadOrg().then(function () {
        mStatus.className = "form__status form__status--ok";
        mStatus.textContent = "Organigramme mis à jour.";
      });
    }, function (err) {
      if (err.status !== 401) mStatus.textContent = err.message || "Enregistrement impossible.";
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
    // Niveau « support » : uniquement le barème (pas de journal des sanctions)
    $(".staff__sub").hidden = !canJournal();
    $("#home-sanctions-text").textContent = canJournal()
      ? "Le barème des sanctions à appliquer et le journal des sanctions enregistrées."
      : "Le barème des sanctions à appliquer, selon chaque cas.";
    subView = "penalties";
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
