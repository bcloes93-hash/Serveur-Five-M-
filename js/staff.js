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
    ["home", "sanctions", "commands", "org", "rules", "audit"].forEach(function (v) { $("#view-" + v).hidden = v !== name; });
    if (name === "sanctions") setSub(subView);
    if (name === "commands") { loadCommands(); if (!cmdState.editing) cForm.elements.platform.value = cmdState.platform; }
    if (name === "org") loadOrg();
    if (name === "rules") loadRules();
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
  // Photo Discord de la personne (mémorisée à sa première connexion) ; sinon, l'initiale du nom.
  function discordPhoto(m) {
    if (!/^\d{5,25}$/.test(String(m.discord_id || "")) || !/^\w{1,64}$/.test(String(m.avatar || ""))) return null;
    return "https://cdn.discordapp.com/avatars/" + m.discord_id + "/" + m.avatar + ".png?size=64";
  }
  function initialBadge(m) {
    var b = el("span", "tcard__avatar", String(m.name || "?").charAt(0).toUpperCase());
    b.setAttribute("aria-hidden", "true");
    return b;
  }

  function treeCard(m, movable) {
    var li = el("li", "tcard");
    li.setAttribute("data-id", String(m.id));
    var photo = discordPhoto(m), av;
    if (photo) {
      av = el("img", "tcard__avatar tcard__avatar--photo");
      av.src = photo; av.alt = ""; av.width = 34; av.height = 34; av.loading = "lazy"; av.referrerPolicy = "no-referrer";
      av.setAttribute("aria-hidden", "true");
      av.addEventListener("error", function () { if (av.parentNode) av.parentNode.replaceChild(initialBadge(m), av); });   // photo introuvable : l'initiale
    } else av = initialBadge(m);
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

  /* ---------- Règlement : chapitres, règles, barème indicatif ---------- */
  // Les numéros (5.12) ne sont pas saisis : ils suivent l'ordre choisi ici et ne comptent que ce qui est publié (comme sur le site).
  var RENDER = window.SLRules;
  var rl = { loaded: false, initialized: false, missing: false, chapters: [], bareme: null, updated: "", sel: null, filter: "", drag: null, editRule: null, editChapter: null };
  var rlStatus = $("#rl-status"), rlHint = $("#rl-hint");
  var rDlg = $("#rl-rule-dialog"), rForm = $("#rl-rule-form"), rBody = $("#rl-r-body"), rStatus = $("#rl-r-status");
  var chDlg = $("#rl-chapter-dialog"), chForm = $("#rl-chapter-form"), chStatus = $("#rl-c-status");
  function canRules() { return atLeast("manager"); }
  function rlSay(text, ok) { rlStatus.className = "form__status rl__status" + (ok ? " form__status--ok" : ""); rlStatus.textContent = text || ""; }
  function chapterById(id) { return rl.chapters.filter(function (c) { return c.id === id; })[0] || null; }
  function findRule(id) {
    for (var i = 0; i < rl.chapters.length; i++) {
      var r = rl.chapters[i].rules.filter(function (x) { return x.id === id; })[0];
      if (r) return { rule: r, chapter: rl.chapters[i] };
    }
    return null;
  }
  function openDialog(d) { if (d.showModal) d.showModal(); else d.setAttribute("open", ""); }
  function closeDialog(d) { if (d.close) d.close(); else d.removeAttribute("open"); }

  // Numérotation publique : chapitres numérotés et publiés, règles publiées dans un chapitre publié
  function numbering() {
    var n = 0, out = { chap: {}, rule: {} };
    rl.chapters.forEach(function (c) {
      var k = 0;
      if (c.published && c.numbered) { n++; out.chap[c.id] = "Chapitre " + n; }
      else out.chap[c.id] = c.published ? "Sans numéro" : "Brouillon";
      c.rules.forEach(function (r) {
        if (!c.published || !r.published) return;
        k++;
        out.rule[r.id] = c.numbered ? n + "." + k : "•";
      });
    });
    return out;
  }
  function plain1(text, max) { var t = RENDER.plain(text); return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, "") + "…" : t; }

  function loadRules() {
    return api("GET", "/api/rules").then(function (d) {
      rl.loaded = true; rl.missing = !!d.missing; rl.initialized = !!d.initialized;
      rl.chapters = d.chapters || []; rl.bareme = d.bareme || null; rl.updated = d.updated || "";
      if (!chapterById(rl.sel)) rl.sel = rl.chapters.length ? rl.chapters[0].id : null;
      renderRules(); fillBareme();
    }, function (e) { if (e.status !== 401) rlSay(e.message || "Chargement impossible.", false); });
  }

  /* --- glisser-déposer --- */
  function clearMarks() { $$(".rl__item--before, .rl__item--after, .rl__chap--over, .is-dragging").forEach(function (n) { n.classList.remove("rl__item--before", "rl__item--after", "rl__chap--over", "is-dragging"); }); }
  function side(e, li) { var r = li.getBoundingClientRect(); return e.clientY < r.top + r.height / 2 ? "before" : "after"; }
  function makeDraggable(li, kind, id) {
    li.draggable = true;
    li.addEventListener("dragstart", function (e) {
      rl.drag = { kind: kind, id: id };
      li.classList.add("is-dragging");
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", kind + ":" + id); } catch (x) { /* navigateur ancien */ } }
    });
    li.addEventListener("dragend", function () { rl.drag = null; clearMarks(); });
  }
  function reorder(ids, movedId, targetId, after) {
    var out = ids.filter(function (x) { return x !== movedId; });
    var at = out.indexOf(targetId);
    out.splice(at < 0 ? out.length : at + (after ? 1 : 0), 0, movedId);
    return out;
  }

  // Enregistre un nouvel ordre pour les règles d'un chapitre (ou le déplacement d'une règle dans ce chapitre)
  function saveRuleOrder(chapterId, ids, doneText) {
    rlSay("");
    var all = {};
    rl.chapters.forEach(function (c) { c.rules.forEach(function (r) { all[r.id] = r; }); });
    rl.chapters.forEach(function (c) { c.rules = c.rules.filter(function (r) { return ids.indexOf(r.id) === -1; }); });
    chapterById(chapterId).rules = ids.map(function (id) { all[id].chapter_id = chapterId; return all[id]; });
    renderRules();
    return api("PUT", "/api/rules/order", { chapter_id: chapterId, ids: ids }).then(function () {
      return loadRules().then(function () { rlSay(doneText || "Ordre enregistré.", true); });
    }, function (err) {
      if (err.status !== 401) rlSay(err.message || "Enregistrement impossible : l'ordre n'a pas été modifié.", false);
      return loadRules();
    });
  }
  function saveChapterOrder(ids) {
    rlSay("");
    var by = {};
    rl.chapters.forEach(function (c) { by[c.id] = c; });
    rl.chapters = ids.map(function (id) { return by[id]; });
    renderRules();
    return api("PUT", "/api/rule-chapters/order", { ids: ids }).then(function () {
      return loadRules().then(function () { rlSay("Ordre des chapitres enregistré. Les numéros se sont mis à jour.", true); });
    }, function (err) {
      if (err.status !== 401) rlSay(err.message || "Enregistrement impossible : l'ordre n'a pas été modifié.", false);
      return loadRules();
    });
  }
  function moveRuleTo(ruleId, chapterId) {
    var hit = findRule(ruleId), target = chapterById(chapterId);
    if (!hit || !target || hit.chapter.id === chapterId) return;
    var ids = target.rules.map(function (r) { return r.id; }).concat([ruleId]);
    var label = numbering().chap[target.id];
    saveRuleOrder(chapterId, ids, "« " + hit.rule.title + " » est maintenant en fin du chapitre « " + target.title + " »" + (label && label.indexOf("Chapitre") === 0 ? " (" + label + ")" : "") + ".");
  }

  /* --- actions sur une règle --- */
  function patchRule(rule, fields, doneText) {
    rlSay("");
    return api("PUT", "/api/rules/" + encodeURIComponent(rule.id), fields).then(function () {
      return loadRules().then(function () { rlSay(doneText, true); });
    }, function (err) { if (err.status !== 401) rlSay(err.message || "Enregistrement impossible.", false); });
  }
  function deleteRule(rule) {
    if (!window.confirm("Supprimer définitivement la règle « " + rule.title + " » ?\n\nPour la retirer du site sans la perdre, utilisez plutôt « Dépublier ».")) return;
    rlSay("");
    api("DELETE", "/api/rules/" + encodeURIComponent(rule.id)).then(function () { return loadRules().then(function () { rlSay("Règle supprimée.", true); }); }, function (err) { if (err.status !== 401) rlSay(err.message || "Suppression impossible.", false); });
  }
  function nudge(rule, chapter, delta) {
    var ids = chapter.rules.map(function (r) { return r.id; }), i = ids.indexOf(rule.id), j = i + delta;
    if (j < 0 || j >= ids.length) return;
    ids.splice(i, 1); ids.splice(j, 0, rule.id);
    saveRuleOrder(chapter.id, ids, "Ordre enregistré.");
  }

  function actBtn(label, onClick, cls, aria) {
    var b = el("button", "btn btn--small btn--link" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (aria) b.setAttribute("aria-label", aria);
    b.addEventListener("click", onClick);
    return b;
  }

  function ruleItem(rule, chapter, nums, canDrag) {
    var li = el("li", "rl__item rl__rule" + (rule.published ? "" : " is-draft") + (rule.important ? " is-important" : ""));
    li.setAttribute("data-id", String(rule.id));
    var top = el("div", "rl__top");
    var grip = el("span", "rl__grip", canDrag ? "⠿" : ""); grip.setAttribute("aria-hidden", "true");
    top.appendChild(grip);
    top.appendChild(el("span", "rl__num", rule.published && chapter.published ? nums.rule[rule.id] : "—"));
    var name = el("div", "rl__namebox");
    name.appendChild(el("strong", "rl__name", rule.title));
    var snip = plain1(rule.body, 110);
    if (snip) name.appendChild(el("span", "rl__snip", snip));
    top.appendChild(name);
    var flags = el("div", "rl__flags");
    if (!rule.published) flags.appendChild(el("span", "rl__flag rl__flag--draft", "Brouillon"));
    if (rule.important) flags.appendChild(el("span", "rl__flag rl__flag--imp", "Importante"));
    top.appendChild(flags);
    li.appendChild(top);

    var acts = el("div", "rl__acts");
    acts.appendChild(actBtn("Modifier", function () { openRule(rule); }, "", "Modifier la règle " + rule.title));
    acts.appendChild(actBtn(rule.published ? "Dépublier" : "Publier", function () {
      patchRule(rule, { published: !rule.published }, rule.published ? "« " + rule.title + " » n'est plus visible sur le site (brouillon)." : "« " + rule.title + " » est publiée sur le site.");
    }, "", (rule.published ? "Dépublier " : "Publier ") + rule.title));
    var star = actBtn(rule.important ? "★ Importante" : "☆ Mettre en avant", function () {
      patchRule(rule, { important: !rule.important }, rule.important ? "« " + rule.title + " » n'est plus mise en avant." : "« " + rule.title + " » est mise en avant sur le site.");
    }, "rl__star", (rule.important ? "Retirer des règles importantes : " : "Marquer comme importante : ") + rule.title);
    star.setAttribute("aria-pressed", String(rule.important));
    acts.appendChild(star);
    var idx = chapter.rules.indexOf(rule);
    var up = actBtn("↑", function () { nudge(rule, chapter, -1); }, "rl__arrow", "Monter " + rule.title), down = actBtn("↓", function () { nudge(rule, chapter, 1); }, "rl__arrow", "Descendre " + rule.title);
    up.disabled = !canDrag || idx === 0; down.disabled = !canDrag || idx === chapter.rules.length - 1;
    acts.appendChild(up); acts.appendChild(down);
    if (rl.chapters.length > 1) {
      var sel = el("select", "rl__move");
      sel.setAttribute("aria-label", "Déplacer « " + rule.title + " » vers un autre chapitre");
      sel.appendChild(new Option("Déplacer vers…", ""));
      rl.chapters.forEach(function (c) { if (c.id !== chapter.id) sel.appendChild(new Option((nums.chap[c.id] && nums.chap[c.id].indexOf("Chapitre") === 0 ? nums.chap[c.id] + " · " : "") + c.title, String(c.id))); });
      sel.addEventListener("change", function () { if (sel.value) moveRuleTo(rule.id, Number(sel.value)); });
      acts.appendChild(sel);
    }
    acts.appendChild(actBtn("Supprimer", function () { deleteRule(rule); }, "btn--danger", "Supprimer la règle " + rule.title));
    li.appendChild(acts);

    if (canDrag) {
      makeDraggable(li, "rule", rule.id);
      li.addEventListener("dragover", function (e) {
        if (!rl.drag || rl.drag.kind !== "rule" || rl.drag.id === rule.id || !chapter.rules.some(function (r) { return r.id === rl.drag.id; })) return;
        e.preventDefault();
        var s = side(e, li);
        li.classList.toggle("rl__item--before", s === "before"); li.classList.toggle("rl__item--after", s === "after");
      });
      li.addEventListener("dragleave", function (e) { if (!e.relatedTarget || !li.contains(e.relatedTarget)) li.classList.remove("rl__item--before", "rl__item--after"); });
      li.addEventListener("drop", function (e) {
        if (!rl.drag || rl.drag.kind !== "rule") return;
        e.preventDefault();
        var moved = rl.drag.id, after = side(e, li) === "after";
        rl.drag = null; clearMarks();
        if (moved === rule.id) return;
        saveRuleOrder(chapter.id, reorder(chapter.rules.map(function (r) { return r.id; }), moved, rule.id, after), "Ordre enregistré.");
      });
    }
    return li;
  }

  function chapterItem(c, i, nums) {
    var li = el("li", "rl__item rl__chap" + (c.id === rl.sel ? " is-active" : "") + (c.published ? "" : " is-draft"));
    li.setAttribute("data-id", String(c.id));
    var grip = el("span", "rl__grip", "⠿"); grip.setAttribute("aria-hidden", "true");
    li.appendChild(grip);
    var pick = el("button", "rl__pick");
    pick.type = "button";
    if (c.id === rl.sel) pick.setAttribute("aria-current", "true");
    pick.appendChild(el("span", "rl__label", nums.chap[c.id]));
    pick.appendChild(el("span", "rl__name", c.title));
    pick.addEventListener("click", function () { rl.sel = c.id; rl.filter = ""; $("#rl-filter").value = ""; renderRules(); });
    li.appendChild(pick);
    li.appendChild(el("span", "rl__count", String(c.rules.length)));
    var mv = el("span", "rl__mv");
    var up = actBtn("↑", function () { var ids = rl.chapters.map(function (x) { return x.id; }); ids.splice(i, 1); ids.splice(i - 1, 0, c.id); saveChapterOrder(ids); }, "rl__arrow", "Monter le chapitre " + c.title);
    var down = actBtn("↓", function () { var ids = rl.chapters.map(function (x) { return x.id; }); ids.splice(i, 1); ids.splice(i + 1, 0, c.id); saveChapterOrder(ids); }, "rl__arrow", "Descendre le chapitre " + c.title);
    up.disabled = i === 0; down.disabled = i === rl.chapters.length - 1;
    mv.appendChild(up); mv.appendChild(down);
    li.appendChild(mv);

    makeDraggable(li, "chapter", c.id);
    li.addEventListener("dragover", function (e) {
      if (!rl.drag) return;
      if (rl.drag.kind === "rule") { e.preventDefault(); li.classList.add("rl__chap--over"); }
      else if (rl.drag.kind === "chapter" && rl.drag.id !== c.id) {
        e.preventDefault();
        var s = side(e, li);
        li.classList.toggle("rl__item--before", s === "before"); li.classList.toggle("rl__item--after", s === "after");
      }
    });
    li.addEventListener("dragleave", function (e) { if (!e.relatedTarget || !li.contains(e.relatedTarget)) li.classList.remove("rl__item--before", "rl__item--after", "rl__chap--over"); });
    li.addEventListener("drop", function (e) {
      if (!rl.drag) return;
      e.preventDefault();
      var d = rl.drag, after = side(e, li) === "after";
      rl.drag = null; clearMarks();
      if (d.kind === "rule") moveRuleTo(d.id, c.id);
      else if (d.id !== c.id) saveChapterOrder(reorder(rl.chapters.map(function (x) { return x.id; }), d.id, c.id, after));
    });
    return li;
  }

  function renderRules() {
    var ready = rl.loaded && !rl.missing && rl.initialized;
    $("#rl-missing").hidden = !rl.missing;
    $("#rl-import").hidden = !(rl.loaded && !rl.missing && !rl.initialized);
    $("#rl-import-btn").hidden = !atLeast("founder");
    $("#rl-import-note").hidden = atLeast("founder");
    $("#rl-main").hidden = !ready; $("#rl-bar").hidden = !ready;
    $("#rl-reset-box").hidden = !(ready && atLeast("founder"));
    if (!ready) return;
    var nums = numbering();
    $("#rl-updated").textContent = rl.updated ? "Dernière mise à jour publique : " + fmtDate(rl.updated) : "";

    var chapters = $("#rl-chapters"); clear(chapters);
    rl.chapters.forEach(function (c, i) { chapters.appendChild(chapterItem(c, i, nums)); });
    if (!rl.chapters.length) chapters.appendChild(el("li", "cmd__empty", "Aucun chapitre. Ajoutez-en un."));

    var ch = chapterById(rl.sel), list = $("#rl-rules"), acts = $("#rl-chapter-acts");
    clear(list); clear(acts);
    $("#rl-add-rule").disabled = !ch;
    if (!ch) { $("#rl-chapter-title").textContent = "Règles"; rlHint.textContent = ""; return; }
    $("#rl-chapter-title").textContent = (nums.chap[ch.id] && nums.chap[ch.id].indexOf("Chapitre") === 0 ? nums.chap[ch.id] + " · " : "") + ch.title;
    acts.appendChild(actBtn("Modifier le chapitre", function () { openChapter(ch); }));
    acts.appendChild(actBtn(ch.published ? "Dépublier le chapitre" : "Publier le chapitre", function () {
      rlSay("");
      api("PUT", "/api/rule-chapters/" + encodeURIComponent(ch.id), { published: !ch.published }).then(function () { var was = ch.published, t = ch.title; return loadRules().then(function () { rlSay(was ? "Le chapitre « " + t + " » n'est plus visible sur le site." : "Le chapitre « " + t + " » est publié.", true); }); }, function (err) { if (err.status !== 401) rlSay(err.message || "Enregistrement impossible.", false); });
    }));
    acts.appendChild(actBtn("Supprimer le chapitre", function () {
      if (!window.confirm("Supprimer le chapitre « " + ch.title + " » ? (Il doit être vide.)")) return;
      rlSay("");
      api("DELETE", "/api/rule-chapters/" + encodeURIComponent(ch.id)).then(function () { rl.sel = null; return loadRules().then(function () { rlSay("Chapitre supprimé.", true); }); }, function (err) { if (err.status !== 401) rlSay(err.message || "Suppression impossible.", false); });
    }, "btn--danger"));

    var q = RENDER.fold(rl.filter).trim();
    var shown = ch.rules.filter(function (r) { return !q || RENDER.fold(r.title + " " + RENDER.plain(r.body)).indexOf(q) !== -1; });
    var canDrag = !q;
    shown.forEach(function (r) { list.appendChild(ruleItem(r, ch, nums, canDrag)); });
    rlHint.textContent = !ch.rules.length ? "Ce chapitre est vide. Ajoutez une règle, ou glissez-en une depuis un autre chapitre." : !shown.length ? "Aucune règle ne correspond au filtre."
      : q ? "Filtre actif : la réorganisation par glisser-déposer est désactivée." : ch.rules.length + (ch.rules.length > 1 ? " règles" : " règle") + " dans ce chapitre.";
  }
  $("#rl-filter").addEventListener("input", function () { rl.filter = this.value; renderRules(); });

  /* --- éditeur de règle --- */
  function chapterOptions(select, current) {
    clear(select);
    var nums = numbering();
    rl.chapters.forEach(function (c) { select.appendChild(new Option((nums.chap[c.id] && nums.chap[c.id].indexOf("Chapitre") === 0 ? nums.chap[c.id] + " · " : "") + c.title, String(c.id))); });
    select.value = String(current);
  }
  var previewTimer = null;
  function updatePreview() {
    var box = $("#rl-r-preview"); clear(box);
    var text = rBody.value;
    if (!text.trim()) { box.appendChild(el("p", "rl__prevempty", "L'aperçu apparaît ici dès que vous écrivez.")); return; }
    RENDER.render(text, box, { chapterHref: function () { return "#"; } });
  }
  $("#rl-r-preview").addEventListener("click", function (e) { if (e.target.closest("a")) e.preventDefault(); });
  rBody.addEventListener("input", function () { clearTimeout(previewTimer); previewTimer = setTimeout(updatePreview, 120); });

  function openRule(rule) {
    rl.editRule = rule ? rule.id : null;
    var f = rForm.elements, nums = numbering();
    chapterOptions(f.chapter_id, rule ? rule.chapter_id : rl.sel);
    f.title.value = rule ? rule.title : ""; rBody.value = rule ? rule.body : "";
    f.published.checked = rule ? rule.published : true; f.important.checked = rule ? rule.important : false;
    $("#rl-rule-title").textContent = rule ? "Modifier la règle" + (nums.rule[rule.id] && /\d/.test(nums.rule[rule.id]) ? " " + nums.rule[rule.id] : "") : "Ajouter une règle";
    $("#rl-r-submit").textContent = rule ? "Enregistrer" : "Ajouter la règle";
    rStatus.className = "form__status"; rStatus.textContent = "";
    updatePreview();
    openDialog(rDlg);
    f.title.focus();
  }
  $("#rl-add-rule").addEventListener("click", function () { if (rl.sel) openRule(null); });
  $("#rl-r-cancel").addEventListener("click", function () { closeDialog(rDlg); });
  rForm.addEventListener("submit", function (e) {
    e.preventDefault();
    rStatus.className = "form__status"; rStatus.textContent = "";
    if (!rForm.reportValidity()) return;
    var f = rForm.elements;
    var body = { title: f.title.value, chapter_id: Number(f.chapter_id.value), body: rBody.value, published: f.published.checked, important: f.important.checked };
    var btn = $("#rl-r-submit"); btn.disabled = true;
    var editing = rl.editRule;
    (editing ? api("PUT", "/api/rules/" + encodeURIComponent(editing), body) : api("POST", "/api/rules", body)).then(function (out) {
      var id = editing || (out && out.id);
      rl.sel = body.chapter_id; rl.filter = ""; $("#rl-filter").value = "";
      closeDialog(rDlg);
      return loadRules().then(function () {
        rlSay(editing ? "Règle enregistrée." : "Règle ajoutée en fin de chapitre.", true);
        var row = $('#rl-rules [data-id="' + String(id) + '"]');
        if (row) { row.classList.add("rl__item--saved"); row.scrollIntoView({ block: "center" }); setTimeout(function () { row.classList.remove("rl__item--saved"); }, 2400); }
      });
    }, function (err) { if (err.status !== 401) { rStatus.textContent = err.message || "Enregistrement impossible."; } }).then(function () { btn.disabled = false; });
  });

  // Barre de mise en forme (insère la syntaxe dans le texte)
  var FORMATS = [["Puce", "bullet", "* "], ["1. 2. 3.", "num", "1. "], ["Gras", "bold"], ["« Citation »", "quote"], ["Interdit", "label", "Interdit"], ["Autorisé", "label", "Autorisé"], ["Exemple", "label", "Exemple"], ["Encadré", "callout", "### "]];
  function formatText(kind, arg) {
    var ta = rBody, v = ta.value, s = ta.selectionStart, e = ta.selectionEnd, sel = v.slice(s, e);
    if (kind === "bold") {
      var inner = sel || "texte";
      ta.value = v.slice(0, s) + "**" + inner + "**" + v.slice(e);
      ta.setSelectionRange(s + 2, s + 2 + inner.length);
    } else if (kind === "quote") {
      var q = sel || "phrase citée";
      ta.value = v.slice(0, s) + "« " + q + " »" + v.slice(e);
      ta.setSelectionRange(s + 2, s + 2 + q.length);
    } else {
      var a = v.lastIndexOf("\n", s - 1) + 1, b = v.indexOf("\n", e); if (b === -1) b = v.length;
      if (kind === "label") { ta.value = v.slice(0, a) + arg + "\n" + v.slice(a); ta.setSelectionRange(a + arg.length + 1, a + arg.length + 1); }
      else {
        if (kind === "callout") b = (v.indexOf("\n", a) === -1 ? v.length : v.indexOf("\n", a));   // un encadré commence à une seule ligne : son titre
        var lines = v.slice(a, b).split("\n");
        var has = lines.every(function (l) { return l.indexOf(arg) === 0 || (kind === "num" && /^\d+\. /.test(l)) || (kind === "bullet" && /^[*-] /.test(l)); });
        lines = lines.map(function (l) { return has ? l.replace(/^(?:[*-] |\d+\. |### )/, "") : (l.trim() ? arg + l : l); });
        var text = lines.join("\n");
        ta.value = v.slice(0, a) + text + v.slice(b);
        ta.setSelectionRange(a, a + text.length);
      }
    }
    ta.focus();
    updatePreview();
  }
  (function buildToolbar() {
    var bar = $("#rl-r-tb");
    FORMATS.forEach(function (f) {
      var b = el("button", "rl__fmt", f[0]);
      b.type = "button";
      b.addEventListener("click", function () { formatText(f[1], f[2]); });
      bar.appendChild(b);
    });
  })();

  /* --- éditeur de chapitre --- */
  function openChapter(ch) {
    rl.editChapter = ch ? ch.id : null;
    var f = chForm.elements;
    f.title.value = ch ? ch.title : ""; f.intro.value = ch ? ch.intro : "";
    f.numbered.checked = ch ? ch.numbered : true; f.published.checked = ch ? ch.published : true;
    $("#rl-chapter-dtitle").textContent = ch ? "Modifier le chapitre" : "Ajouter un chapitre";
    $("#rl-c-submit").textContent = ch ? "Enregistrer" : "Ajouter le chapitre";
    chStatus.className = "form__status"; chStatus.textContent = "";
    openDialog(chDlg);
    f.title.focus();
  }
  $("#rl-add-chapter").addEventListener("click", function () { openChapter(null); });
  $("#rl-c-cancel").addEventListener("click", function () { closeDialog(chDlg); });
  chForm.addEventListener("submit", function (e) {
    e.preventDefault();
    chStatus.className = "form__status"; chStatus.textContent = "";
    if (!chForm.reportValidity()) return;
    var f = chForm.elements, body = { title: f.title.value, intro: f.intro.value, numbered: f.numbered.checked, published: f.published.checked };
    var btn = $("#rl-c-submit"); btn.disabled = true;
    var editing = rl.editChapter;
    (editing ? api("PUT", "/api/rule-chapters/" + encodeURIComponent(editing), body) : api("POST", "/api/rule-chapters", body)).then(function (out) {
      if (!editing && out && out.id) rl.sel = out.id;
      closeDialog(chDlg);
      return loadRules().then(function () { rlSay(editing ? "Chapitre enregistré." : "Chapitre ajouté en dernière position : glissez-le pour le placer.", true); });
    }, function (err) { if (err.status !== 401) chStatus.textContent = err.message || "Enregistrement impossible."; }).then(function () { btn.disabled = false; });
  });

  /* --- import du règlement d'origine (fondateur) --- */
  function importOriginal(replace) {
    var ask = replace
      ? "Remplacer TOUT le règlement par la version d'origine ?\n\nToutes les modifications faites depuis le panel (textes, ordre, ajouts, publications) seront perdues. Cette action est irréversible."
      : "Importer le règlement d'origine dans le panel ?\n\nLes textes sont repris tels quels. Le site continue d'afficher la même chose.";
    if (!window.confirm(ask)) return;
    var btns = [$("#rl-import-btn"), $("#rl-reset")];
    btns.forEach(function (b) { b.disabled = true; });
    rlSay("Lecture du règlement d'origine…", false);
    fetch("data/reglement.json", { cache: "no-store" }).then(function (r) { if (!r.ok) throw { message: "Le fichier du règlement d'origine est introuvable sur le site." }; return r.json(); }).then(function (data) {
      var chapters = data.chapters || [], i = 0;
      return api("POST", "/api/rules/import", { mode: "reset", confirm: true }).then(function next() {
        if (i >= chapters.length) return api("POST", "/api/rules/import", { mode: "done" });
        var c = chapters[i];
        rlSay("Import en cours : chapitre " + (i + 1) + " sur " + chapters.length + "…", false);
        return api("POST", "/api/rules/import", { mode: "chapter", chapter: { title: c.title, intro: c.intro, numbered: c.numbered !== false }, rules: c.rules }).then(function () { i++; return next(); });
      });
    }).then(function () {
      rl.sel = null;
      return loadRules().then(function () { rlSay("Règlement importé : il est maintenant géré depuis ce panel.", true); });
    }, function (err) { if (err.status !== 401) rlSay((err && err.message) || "Import impossible. Rien n'a été publié ; vous pouvez réessayer.", false); }).then(function () { btns.forEach(function (b) { b.disabled = false; }); });
  }
  $("#rl-import-btn").addEventListener("click", function () { importOriginal(false); });
  $("#rl-reset").addEventListener("click", function () { importOriginal(true); });

  /* --- barème indicatif (quatre niveaux) --- */
  var bForm = $("#rl-bareme-form"), bStatus = $("#rb-status");
  function fillBareme() {
    if (!rl.bareme) return;
    bForm.elements.intro.value = rl.bareme.intro || "";
    (rl.bareme.levels || []).forEach(function (l) { if (bForm.elements[l.key]) bForm.elements[l.key].value = l.body || ""; });
  }
  bForm.addEventListener("submit", function (e) {
    e.preventDefault();
    bStatus.className = "form__status"; bStatus.textContent = "";
    var f = bForm.elements, btn = $("#rb-submit"); btn.disabled = true;
    api("PUT", "/api/rules-bareme", { intro: f.intro.value, levels: { mineure: f.mineure.value, moderee: f.moderee.value, grave: f.grave.value, critique: f.critique.value } }).then(function () {
      return loadRules().then(function () { bStatus.className = "form__status form__status--ok"; bStatus.textContent = "Barème enregistré."; });
    }, function (err) { if (err.status !== 401) bStatus.textContent = err.message || "Enregistrement impossible."; }).then(function () { btn.disabled = false; });
  });
  $$(".seg__btn[data-rsub]").forEach(function (b) {
    b.addEventListener("click", function () {
      var name = b.getAttribute("data-rsub");
      $$(".seg__btn[data-rsub]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      $("#rsub-rules").hidden = name !== "rules"; $("#rsub-bareme").hidden = name !== "bareme";
    });
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
    $$("[data-manager]").forEach(function (t) { t.hidden = !atLeast("manager"); });   // règlement : manager et fondateur
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
