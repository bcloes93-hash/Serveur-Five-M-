(function () {
  "use strict";

  var cfg = window.SITE_CONFIG || {};
  var API = String(cfg.staffApi || "").trim().replace(/\/+$/, "");
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var TYPES = { avertissement: "Avertissement", expulsion: "Expulsion", ban_temp: "Ban temporaire", ban_def: "Ban définitif", note: "Note" };
  var LEVELS = { support: "Support", mod: "Modération", admin: "Administration", manager: "Manager", founder: "Fondateur" };
  var RANK = { support: 1, mod: 2, admin: 3, manager: 4, founder: 5 };
  // Visibilité d'une commande : à partir de quel niveau elle apparaît.
  var VISIBLE_FROM = { support: "Tout le staff", mod: "Modération et plus", admin: "Administration et plus", manager: "Manager et plus", founder: "Fondateur uniquement" };
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
    if (isAdmin()) {
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
  // « Au moins ce niveau » : chaque niveau a les droits des niveaux inférieurs.
  function atLeast(level) { return !!state.me && (RANK[state.me.level] || 0) >= RANK[level]; }
  function isAdmin() { return atLeast("admin"); }
  // Le journal des sanctions est réservé à la modération et au-dessus (pas au support).
  function canJournal() { return atLeast("mod"); }

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
  var cmdState = { platform: "discord", items: [], editing: null, cat: { discord: null, fivem: null } };   // cat : catégorie choisie par plateforme (null = la première, "*" = toutes)
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
      if (c.min_level && c.min_level !== "support") admin.appendChild(el("span", "cmd__level", "Visible : " + (VISIBLE_FROM[c.min_level] || c.min_level)));
      admin.appendChild(linkButton("Modifier", function () { startEditCommand(c); }));
      admin.appendChild(linkButton("Supprimer", function () {
        if (!window.confirm("Supprimer la commande « " + c.cmd + " » ?")) return;
        api("DELETE", "/api/commands/" + encodeURIComponent(c.id)).then(loadCommands, function (e) { cCount.textContent = e.message || ""; });
      }, true));
      li.appendChild(admin);
    }
    return li;
  }

  // « 3 · Modérateur (sl_mod) » -> « Modérateur (sl_mod) » : le numéro ne sert qu'à garder l'ordre.
  function catLabel(cat) { return String(cat).replace(/^\s*\d+\s*[·.:)\-]\s*/, "") || cat; }

  function renderSubcats(all) {
    var bar = $("#c-subcats");
    clear(bar);
    var cats = [], count = {};
    all.forEach(function (c) { if (!count[c.cat]) { count[c.cat] = 0; cats.push(c.cat); } count[c.cat]++; });
    bar.hidden = cats.length === 0;
    var q = cSearch.value.trim();
    // Une recherche porte toujours sur toutes les catégories ; sans recherche, on affiche la catégorie choisie.
    var chosen = cmdState.cat[cmdState.platform];
    var active = q ? "*" : (chosen === "*" || cats.indexOf(chosen) !== -1 ? chosen : cats[0]);
    var make = function (key, label, n) {
      var b = el("button", "subseg__btn", label);
      b.type = "button";
      b.setAttribute("data-cat", key);
      b.setAttribute("aria-pressed", String(active === key));
      b.appendChild(el("span", "subseg__n", String(n)));
      b.addEventListener("click", function () { cmdState.cat[cmdState.platform] = key; if (cSearch.value) cSearch.value = ""; renderCommands(); });
      bar.appendChild(b);
    };
    cats.forEach(function (c) { make(c, catLabel(c), count[c]); });
    if (cats.length > 1) make("*", "Toutes", all.length);
    return { active: active, cats: cats };
  }

  function renderCommands() {
    var q = cSearch.value.trim().toLowerCase();
    var all = cmdState.items.filter(function (c) { return c.platform === cmdState.platform; });
    var sub = renderSubcats(all);
    var inScope = all.filter(function (c) { return sub.active === "*" || c.cat === sub.active; });
    var shown = inScope.filter(function (c) { return !q || (c.cmd + " " + c.descr + " " + c.cat + " " + c.example).toLowerCase().indexOf(q) !== -1; });
    clear(cList);
    if (!all.length) {
      cCount.textContent = "";
      cList.appendChild(el("p", "cmd__empty", isAdmin() ? "Aucune commande pour le moment. Ajoutez-en avec le formulaire ci-dessous." : "Aucune commande pour le moment."));
      return;
    }
    cCount.textContent = shown.length + (shown.length > 1 ? " commandes" : " commande") + (sub.active !== "*" ? " dans « " + catLabel(sub.active) + " »" : "");
    if (!shown.length) { cList.appendChild(el("p", "cmd__empty", "Aucune commande ne correspond à votre recherche.")); return; }
    var cats = [], byCat = {};
    shown.forEach(function (c) { if (!byCat[c.cat]) { byCat[c.cat] = []; cats.push(c.cat); } byCat[c.cat].push(c); });
    cats.forEach(function (cat) {
      var group = el("section", "cmd__group");
      group.appendChild(el("h3", "cmd__cat", catLabel(cat)));
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
    cForm.elements.min_level.value = "support";
    $("#c-form-title").textContent = "Ajouter une commande";
    $("#c-submit").textContent = "Ajouter";
    $("#c-cancel").hidden = true;
  }
  function startEditCommand(c) {
    cmdState.editing = c.id;
    cForm.elements.platform.value = c.platform; cForm.elements.cat.value = c.cat; cForm.elements.cmd.value = c.cmd;
    cForm.elements.descr.value = c.descr; cForm.elements.example.value = c.example;
    cForm.elements.min_level.value = c.min_level || "support";
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
    var body = { platform: cForm.elements.platform.value, cat: cForm.elements.cat.value, cmd: cForm.elements.cmd.value, descr: cForm.elements.descr.value, example: cForm.elements.example.value, min_level: cForm.elements.min_level.value };
    var btn = $("#c-submit");
    btn.disabled = true;
    var req = cmdState.editing ? api("PUT", "/api/commands/" + encodeURIComponent(cmdState.editing), body) : api("POST", "/api/commands", body);
    req.then(function () {
      var p = body.platform;
      resetCommandForm();
      cmdState.cat[p] = (body.cat || "").trim() || "Général";
      setPlatform(p);
      return loadCommands().then(function () {
        cStatus.className = "form__status form__status--ok";
        cStatus.textContent = "Commande enregistrée.";
      });
    }, function (err) {
      if (err.status !== 401) cStatus.textContent = err.message || "Enregistrement impossible.";
    }).then(function () { btn.disabled = false; });
  });

  /* ---------- Organigramme (arbre par pôles) ---------- */
  // Les cases de l'arbre, de haut en bas. Même liste côté serveur : c'est lui qui impose le niveau et le groupe de chaque case.
  // Une personne peut figurer dans plusieurs cases (une ligne de la base par case) ; « other » = « à placer » (réserve).
  var ORG_RANKS = { founder: "Fondateur", manager: "Manager", admin: "Admin", mod: "Modérateur", support: "Support" };
  var ORG_POLES = [["legal", "Légal", "blue"], ["illegal", "Illégal", "red"], ["rp", "RP", "purple"], ["mod", "Modération", "green"], ["com", "Communauté", "teal"], ["event", "Événementiel", "amber"], ["tech", "Technique", "slate"]];
  // [clé, rang, titre affiché, nom complet, couleur, pôle, description]
  var ORG_ROWS = [
    [["founder", "founder", "Fondateur", "Fondateur", "gold", "", "Direction générale du serveur"]],
    [["mgr_staff", "manager", "Responsable Staff", "Responsable Staff", "blue", "", "Gestion et encadrement de l'équipe staff."],
     ["mgr_rp", "manager", "Responsable RP", "Responsable RP", "purple", "rp", "Supervision et développement de l'expérience RP."],
     ["mgr_com", "manager", "Responsable Communauté", "Responsable Communauté", "teal", "com", "Lien avec la communauté et développement du serveur."]],
    [["adm_legal", "admin", "Référent Légal", "Référent Légal", "blue", "legal", "Encadrement des forces de l'ordre et du cadre légal."],
     ["adm_illegal", "admin", "Référent Illégal", "Référent Illégal", "red", "illegal", "Suivi des organisations criminelles et activités illégales."],
     ["adm_rp", "admin", "Référent RP", "Référent RP", "purple", "rp", "Veille à la qualité et au respect du roleplay."],
     ["adm_mod", "admin", "Référent Modération", "Référent Modération", "green", "mod", "Supervision de la modération et du bon climat en jeu."],
     ["adm_event", "admin", "Référent Événementiel", "Référent Événementiel", "amber", "event", "Organisation et suivi des événements serveur."],
     ["adm_tech", "admin", "Référent Technique", "Référent Technique", "slate", "tech", "Gestion technique et stabilité du serveur."]],
    [["mod_legal", "mod", "Légal", "Modérateur Légal", "blue", "legal", "Aide au suivi des actions légales et support aux joueurs."],
     ["mod_illegal", "mod", "Illégal", "Modérateur Illégal", "red", "illegal", "Accompagnement des activités illégales et suivi du bon déroulement."],
     ["mod_rp", "mod", "RP", "Modérateur RP", "purple", "rp", "Accompagnement et aide à l'immersion roleplay."],
     ["mod_com", "mod", "Communauté", "Modérateur Communauté", "teal", "com", "Veille, animation et soutien de la communauté."]],
    [["sup_assist", "support", "Assistance Joueurs", "Support Assistance Joueurs", "blue", "", "Aide et accompagnement des joueurs au quotidien."],
     ["sup_tickets", "support", "Tickets", "Support Tickets", "red", "", "Traitement des tickets et suivi des demandes."],
     ["sup_new", "support", "Nouveaux Joueurs", "Support Nouveaux Joueurs", "purple", "", "Accueil et intégration des nouveaux arrivants."],
     ["sup_bugs", "support", "Bugs & Signalements", "Support Bugs & Signalements", "green", "", "Réception et suivi des bugs et des signalements."]]
  ];
  var ORG = {};
  ORG_ROWS.forEach(function (row) {
    row.forEach(function (n) { ORG[n[0]] = { key: n[0], rank: n[1], title: n[2], label: n[3], color: n[4], pole: n[5], desc: n[6] }; });
  });
  var ORG_KEYS = [].concat.apply([], ORG_ROWS).map(function (n) { return n[0]; });
  var GENERIC_ROLES = ["Fondateur", "Manager", "Admin", "Modérateur", "Support", "À placer"];
  var POOL = { key: "other", label: "À placer", title: "À placer" };   // la réserve, hors de l'arbre
  function caseOf(key) { return key === "other" ? POOL : ORG[key]; }
  var orgState = { items: [], editing: null, dragId: null, clip: null, pole: "", relayOk: true };
  var mForm = $("#member-form"), mStatus = $("#m-status"), oStatus = $("#org-status");

  function inTree(kind) { return Object.prototype.hasOwnProperty.call(ORG, kind); }
  function sameName(a, b) { return String(a).trim().toLowerCase() === String(b).trim().toLowerCase(); }
  // Un titre générique (« Admin », « Référent Légal »…) suit la personne dans sa nouvelle case ;
  // un titre personnalisé (« Fondateur · Développeur ») est conservé.
  function isGenericRole(role) { return !role || GENERIC_ROLES.indexOf(role) >= 0 || ORG_KEYS.some(function (k) { return ORG[k].label === role; }); }
  function orgLink() { var d = el("div", "tree__link"); d.setAttribute("aria-hidden", "true"); return d; }
  function membersOf(key) {
    return orgState.items.filter(function (m) { return key === "other" ? !inTree(m.kind) : m.kind === key; })
      .sort(function (a, b) { return a.position - b.position || a.id - b.id; });
  }
  function nextPos(key) { return Math.min(99, membersOf(key).reduce(function (mx, x) { return Math.max(mx, x.position); }, -1) + 1); }
  function inCase(name, key) { return membersOf(key).some(function (x) { return sameName(x.name, name); }); }
  function orgSay(text, ok) { oStatus.className = "form__status" + (ok ? " form__status--ok" : ""); oStatus.textContent = text || ""; }
  function lastResort(err, fallback) { return (err && err.message) || fallback; }

  /* --- copier / coller --- */
  function setClip(m) {
    orgState.clip = { name: m.name, role: isGenericRole(m.role) ? "" : m.role };
    $("#org-clip-text").textContent = "« " + m.name + " » est copié : cliquez « Coller ici » dans chacun des pôles voulus.";
    $("#org-clip").hidden = false;
    $("#org-chart").classList.add("org__chart--clip");
    orgSay("", false);
  }
  function stopClip() {
    orgState.clip = null;
    $("#org-clip").hidden = true;
    $("#org-chart").classList.remove("org__chart--clip");
  }
  $("#org-clip-stop").addEventListener("click", stopClip);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && orgState.clip) stopClip(); });

  // Ajoute la personne (une copie) dans une case ; l'original reste où il est.
  function addCopy(name, role, key) {
    var target = caseOf(key);
    if (!target) return;
    if (inCase(name, key)) { orgSay("« " + name + " » est déjà dans « " + target.label + " ».", false); return; }
    orgSay("Ajout de « " + name + " »…", false);
    api("POST", "/api/org", { name: name, role: isGenericRole(role) ? "" : role, kind: key, position: nextPos(key) }).then(function () {
      return loadOrg().then(function () { orgSay("« " + name + " » figure aussi dans « " + target.label + " ».", true); });
    }, function (err) { if (err.status !== 401) orgSay(lastResort(err, "Ajout impossible."), false); });
  }

  /* --- cartes et cases --- */
  function treeCard(m, movable) {
    var li = el("li", "tcard");
    li.setAttribute("data-id", String(m.id));
    var av = el("span", "tcard__avatar", String(m.name || "?").charAt(0).toUpperCase());
    av.setAttribute("aria-hidden", "true");
    li.appendChild(av);
    var box = el("div", "tcard__body");
    box.appendChild(el("span", "tcard__name", m.name));
    // Le titre n'est répété que s'il apporte quelque chose de plus que la case (ex. « Fondateur · Développeur »),
    // ou pour une personne encore « à placer » (l'ancien titre aide à choisir sa case).
    if (m.role && (!isGenericRole(m.role) || !inTree(m.kind)) && m.role !== "À placer") box.appendChild(el("span", "tcard__role", m.role));
    li.appendChild(box);
    if (!movable) return li;

    li.className += " tcard--drag";
    li.draggable = true;
    li.addEventListener("dragstart", function (e) {
      orgState.dragId = m.id;
      li.classList.add("tcard--dragging");
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = "copyMove"; try { e.dataTransfer.setData("text/plain", String(m.id)); } catch (x) { /* navigateur ancien */ } }
    });
    li.addEventListener("dragend", function () {
      orgState.dragId = null;
      li.classList.remove("tcard--dragging");
      $$(".tnode--over").forEach(function (n) { n.classList.remove("tnode--over"); });
    });

    // Outils (tactile, clavier) : déplacer, copier, retirer — affichés à la demande.
    var tools = el("div", "tcard__tools");
    var sel = el("select", "tcard__move");
    sel.setAttribute("aria-label", "Déplacer " + m.name + " vers une autre case");
    sel.appendChild(new Option("Déplacer vers…", ""));
    if (inTree(m.kind) && !inCase(m.name, "other")) sel.appendChild(new Option("À placer (hors de l'arbre)", "other"));
    ORG_ROWS.forEach(function (row, i) {
      var g = document.createElement("optgroup");
      g.label = ORG_RANKS[row[0][1]];
      row.forEach(function (n) { if (n[0] !== m.kind && !inCase(m.name, n[0])) g.appendChild(new Option(n[3], n[0])); });
      if (g.children.length) sel.appendChild(g);
    });
    sel.addEventListener("change", function () { if (sel.value) moveMember(m.id, sel.value, true); });
    tools.appendChild(sel);
    var cp = el("button", "tcard__btn", "Copier");
    cp.type = "button";
    cp.setAttribute("aria-label", "Copier " + m.name + " pour le coller dans d'autres pôles");
    cp.addEventListener("click", function () { setClip(m); });
    tools.appendChild(cp);
    var inPool = !inTree(m.kind);
    var rm = el("button", "tcard__btn tcard__btn--danger", inPool ? "Supprimer" : "Retirer");
    rm.type = "button";
    rm.setAttribute("aria-label", inPool ? "Supprimer " + m.name + " de l'organigramme" : "Retirer " + m.name + " de cette case (retour dans À placer s'il n'a pas d'autre case)");
    rm.addEventListener("click", function () { if (inPool) deleteRow(m); else leaveCase(m); });
    tools.appendChild(rm);
    li.appendChild(tools);
    return li;
  }

  // Une case (ou la réserve) où l'on peut déposer une carte : glisser = déplacer, Ctrl/Option + glisser = copier.
  function makeDropTarget(sec, key) {
    sec.addEventListener("dragover", function (e) {
      if (orgState.dragId == null) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = (e.ctrlKey || e.altKey) ? "copy" : "move";
      sec.classList.add("tnode--over");
    });
    sec.addEventListener("dragleave", function (e) { if (!e.relatedTarget || !sec.contains(e.relatedTarget)) sec.classList.remove("tnode--over"); });
    sec.addEventListener("drop", function (e) {
      e.preventDefault();
      sec.classList.remove("tnode--over");
      var id = orgState.dragId, copy = e.ctrlKey || e.altKey;
      orgState.dragId = null;
      if (id == null) return;
      var m = orgState.items.filter(function (x) { return x.id === id; })[0];
      if (!m) return;
      if (copy) addCopy(m.name, m.role, key); else moveMember(id, key, false);
    });
  }

  function treeNode(def, movable) {
    var members = membersOf(def.key);
    var sec = el("section", "tnode tnode--" + def.color);
    sec.setAttribute("data-node", def.key);
    if (def.pole) sec.setAttribute("data-pole", def.pole);
    var head = el("div", "tnode__head");
    head.appendChild(el("span", "tnode__badge", ORG_RANKS[def.rank]));
    head.appendChild(el("span", "tnode__count", String(members.length)));
    sec.appendChild(head);
    var h = el("h3", "tnode__title", def.title);
    h.id = "tnode-" + def.key;
    sec.setAttribute("aria-labelledby", h.id);
    sec.appendChild(h);
    sec.appendChild(el("p", "tnode__desc", def.desc));
    if (members.length) {
      var ul = el("ul", "tnode__list");
      members.forEach(function (m) { ul.appendChild(treeCard(m, movable)); });
      sec.appendChild(ul);
    } else sec.appendChild(el("p", "tnode__empty", movable ? "Personne ici : glissez quelqu'un" : "Personne pour le moment"));
    if (!movable) return sec;

    var paste = el("button", "tnode__paste", "Coller ici");
    paste.type = "button";
    paste.setAttribute("aria-label", "Coller la personne copiée dans " + def.label);
    paste.addEventListener("click", function () { if (orgState.clip) addCopy(orgState.clip.name, orgState.clip.role, def.key); });
    sec.appendChild(paste);

    makeDropTarget(sec, def.key);
    return sec;
  }

  // La réserve : les personnes pas encore placées dans l'arbre.
  function trayNode(movable) {
    var members = membersOf("other");
    var sec = el("section", "tnode tnode--slate tnode--tray");
    sec.setAttribute("data-node", "other");
    var head = el("div", "tnode__head");
    head.appendChild(el("span", "tnode__badge", "À placer"));
    head.appendChild(el("span", "tnode__count", String(members.length)));
    sec.appendChild(head);
    var h = el("h3", "tnode__title", "Membres à placer");
    h.id = "tnode-other";
    sec.setAttribute("aria-labelledby", h.id);
    sec.appendChild(h);
    sec.appendChild(el("p", "tnode__desc", movable ? "Glissez chaque personne dans un pôle de l'arbre (Ctrl + glisser pour la copier). Déposez ici quelqu'un pour le remettre en réserve." : "Pas encore placés dans un pôle."));
    var ul = el("ul", "tnode__list tnode__list--tray");
    members.forEach(function (m) { ul.appendChild(treeCard(m, movable)); });
    sec.appendChild(ul);
    if (movable) makeDropTarget(sec, "other");
    return sec;
  }

  function applyPole() {
    $$("#org-chart .tnode[data-node]:not(.tnode--tray)").forEach(function (n) {
      n.classList.toggle("tnode--dim", !!orgState.pole && n.getAttribute("data-pole") !== orgState.pole);
    });
    $$("#org-legend .polechip").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-pole") === orgState.pole)); });
  }
  (function buildLegend() {
    var box = $("#org-legend");
    var intro = el("div", "org__legend-intro");
    intro.appendChild(el("strong", null, "Pôles d'orientation"));
    intro.appendChild(el("span", null, "Les différentes missions et domaines d'action du staff. Cliquez sur un pôle pour mettre ses cases en avant."));
    box.appendChild(intro);
    var list = el("div", "org__poles");
    ORG_POLES.forEach(function (p) {
      var b = el("button", "polechip polechip--" + p[2], p[1]);
      b.type = "button";
      b.setAttribute("data-pole", p[0]);
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () { orgState.pole = orgState.pole === p[0] ? "" : p[0]; applyPole(); });
      list.appendChild(b);
    });
    box.appendChild(list);
  })();

  function renderOrg() {
    var chart = $("#org-chart"), hint = $("#org-hint");
    clear(chart);
    hint.textContent = "";
    // Un relais pas à jour refuserait les nouvelles cases : on le dit, et on n'offre pas de déplacements qui échoueraient.
    var movable = isAdmin() && orgState.relayOk;
    $("#org-warn").hidden = !(isAdmin() && !orgState.relayOk);
    $(".orgbar").hidden = !movable;
    mForm.closest(".panelbox").hidden = !movable;
    $("#org-legend").hidden = !orgState.items.length;
    if (!orgState.items.length) {
      hint.textContent = movable ? "L'organigramme est vide. Ajoutez des membres avec le formulaire ci-dessous." : "L'organigramme est vide pour le moment.";
      $("#org-summary").textContent = "";
      return;
    }
    if (membersOf("other").length) chart.appendChild(trayNode(movable));
    ORG_ROWS.forEach(function (row, i) {
      if (i) chart.appendChild(orgLink());
      if (row.length === 1) {
        var lvl = el("div", "tree__level");
        lvl.appendChild(treeNode(ORG[row[0][0]], movable));
        chart.appendChild(lvl);
      } else {
        var fan = el("div", "tree__fan tree__fan--" + row.length + (i === ORG_ROWS.length - 1 ? " tree__fan--end" : ""));
        fan.style.setProperty("--n", String(row.length));
        row.forEach(function (n) { fan.appendChild(treeNode(ORG[n[0]], movable)); });
        chart.appendChild(fan);
      }
    });
    applyPole();
    $("#org-summary").textContent = "Hiérarchie, du haut vers le bas : " + ORG_ROWS.map(function (row) {
      return row.map(function (n) {
        var l = membersOf(n[0]).map(function (m) { return m.name; });
        return ORG[n[0]].label + " : " + (l.length ? l.join(", ") : "personne");
      }).join(" ; ");
    }).join(" ; puis ") + "." + (membersOf("other").length ? " À placer : " + membersOf("other").map(function (m) { return m.name; }).join(", ") + "." : "");
  }

  function moveMember(id, key, fromMenu) {
    var m = orgState.items.filter(function (x) { return x.id === id; })[0];
    var target = caseOf(key);
    if (!m || !target || m.kind === key) return;
    if (inCase(m.name, key)) {
      // Déjà en réserve (copie) : « remettre à placer » revient à retirer cette case, la personne y est déjà.
      if (key === "other" && inTree(m.kind)) { deleteRowNow(m, "« " + m.name + " » est de nouveau dans « À placer »."); return; }
      orgSay("« " + m.name + " » est déjà dans « " + target.label + " ».", false);
      return;
    }
    var before = { kind: m.kind, role: m.role, position: m.position };
    var next = { kind: key, role: isGenericRole(m.role) ? target.label : m.role, position: nextPos(key) };
    Object.keys(next).forEach(function (k) { m[k] = next[k]; });
    orgSay("Déplacement de « " + m.name + " »…", false);
    renderOrg();
    api("PUT", "/api/org/" + encodeURIComponent(id), { name: m.name, role: m.role, kind: key, position: m.position }).then(function () {
      return loadOrg().then(function () {
        orgSay("« " + m.name + " » est maintenant dans « " + target.label + " ». Cela ne change pas ses rôles Discord ni ses accès au panel.", true);
      });
    }, function (err) {
      Object.keys(before).forEach(function (k) { m[k] = before[k]; });
      renderOrg();
      if (err.status !== 401) orgSay(lastResort(err, "Déplacement impossible."), false);
    }).then(function () {
      if (fromMenu) { var again = $('#org-chart [data-id="' + String(id) + '"] .tcard__move'); if (again) again.focus(); }
    });
  }

  function deleteRowNow(m, doneText) {
    api("DELETE", "/api/org/" + encodeURIComponent(m.id)).then(function () {
      return loadOrg().then(function () { orgSay(doneText, true); });
    }, function (err) { if (err.status !== 401) orgSay(lastResort(err, "Retrait impossible."), false); });
  }
  // « Retirer » depuis un pôle : on enlève cette case ; si c'était la seule, la personne retourne dans « À placer » (jamais supprimée).
  function leaveCase(m) {
    var elsewhere = orgState.items.some(function (x) { return x.id !== m.id && sameName(x.name, m.name); });
    if (elsewhere) { deleteRowNow(m, "« " + m.name + " » a été retiré(e) de « " + caseOf(m.kind).label + " » (la personne reste dans ses autres cases)."); return; }
    moveMember(m.id, "other", false);
  }
  // Suppression définitive d'une ligne (depuis « À placer » ou la liste de gestion), après confirmation.
  function deleteRow(m) {
    var elsewhere = orgState.items.some(function (x) { return x.id !== m.id && sameName(x.name, m.name); });
    var where = inTree(m.kind) ? "la case « " + ORG[m.kind].label + " »" : "la liste « À placer »";
    var msg = "Supprimer « " + m.name + " » de " + where + " ? " + (elsewhere ? "Cette personne reste dans ses autres cases." : "C'est sa seule ligne : elle disparaîtra de l'organigramme.");
    if (!window.confirm(msg)) return;
    deleteRowNow(m, "« " + m.name + " » a été supprimé(e) de " + where + ".");
  }

  // Les outils (déplacer, copier, retirer) restent masqués tant qu'on n'en a pas besoin ; ils s'affichent d'office sur écran tactile.
  var editBtn = $("#org-edit");
  function setEdit(on) {
    $("#org-chart").classList.toggle("org__chart--edit", on);
    editBtn.setAttribute("aria-pressed", on ? "true" : "false");
    editBtn.textContent = on ? "Masquer les outils" : "Afficher les outils (copier, déplacer, retirer)";
  }
  editBtn.addEventListener("click", function () { setEdit(editBtn.getAttribute("aria-pressed") !== "true"); });
  setEdit(!!(window.matchMedia && window.matchMedia("(hover: none)").matches));

  function renderMembers() {
    var ul = $("#m-list"); clear(ul);
    orgState.items.forEach(function (m) {
      var li = el("li", "manage__item");
      var info = el("div", "manage__info");
      info.appendChild(el("strong", null, m.name));
      info.appendChild(el("span", "manage__meta", "Case : " + (inTree(m.kind) ? ORG[m.kind].label : "à placer") + (isGenericRole(m.role) ? "" : " · titre : " + m.role) + " · ordre " + m.position));
      li.appendChild(info);
      var actions = el("div", "manage__actions");
      actions.appendChild(linkButton("Modifier", function () { startEditMember(m); }));
      actions.appendChild(linkButton("Supprimer", function () { deleteRow(m); }, true));
      li.appendChild(actions);
      ul.appendChild(li);
    });
  }

  function loadOrg() {
    return api("GET", "/api/org").then(function (data) {
      orgState.items = data.org;
      orgState.relayOk = Array.isArray(data.nodes) && ORG_KEYS.concat(["other"]).every(function (k) { return data.nodes.indexOf(k) >= 0; });
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
    f.name.value = m.name; f.role.value = isGenericRole(m.role) ? "" : m.role; f.kind.value = inTree(m.kind) ? m.kind : "other"; f.position.value = m.position;
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
    var body = { name: f.name.value, role: f.role.value, kind: f.kind.value, position: f.position.value };
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
    $$("[data-admin]").forEach(function (t) { t.hidden = !isAdmin(); });
    // On ne peut réserver une commande qu'à son propre niveau ou à un niveau inférieur.
    $$("#c-level option").forEach(function (o) { o.disabled = RANK[o.value] > RANK[me.level]; });
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
