/*
 * Page Règlement : chapitres à gauche, chapitre choisi à droite, recherche, ancres, barème indicatif.
 * Les règles viennent du panel staff (route publique /api/public/rules : seulement ce qui est publié).
 * Si le panel est injoignable ou pas encore installé, on affiche l'instantané data/reglement.json (version d'origine).
 */
(function () {
  "use strict";

  var cfg = window.SITE_CONFIG || {};
  var R = window.SLRules;
  var section = document.getElementById("reglement");
  if (!section || !R) return;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var content = $("#regl-content"), list = $("#regl-list"), nav = $("#regl-nav"), toggle = $("#regl-toggle");
  var input = $("#regl-q"), clearBtn = $("#regl-clear");
  var MOBILE = "(max-width: 900px)";
  var MAX_RESULTS = 50;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   // jamais innerHTML : un texte du règlement n'est jamais interprété
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function isMobile() { return !!(window.matchMedia && window.matchMedia(MOBILE).matches); }

  /* ---------- Chargement : panel d'abord, instantané en secours ---------- */
  function fetchJSON(url, ms) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms) : null;
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined, headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) { if (timer) clearTimeout(timer); return d; }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }
  function valid(d) { return d && Array.isArray(d.chapters) && d.chapters.length > 0; }
  function load() {
    var api = String(cfg.staffApi || "").trim().replace(/\/+$/, "");
    var live = api ? fetchJSON(api + "/api/public/rules", 6000).then(function (d) { if (!d || d.initialized !== true || !valid(d)) throw new Error("pas encore en ligne"); return d; }) : Promise.reject(new Error("panel non configuré"));
    return live.catch(function () { return fetchJSON("data/reglement.json", 10000); });
  }

  /* ---------- Modèle : numéros, adresses, index de recherche ---------- */
  var model = null, byId = {}, ruleById = {};
  var view = { kind: "chapter", key: null };
  var query = "", onlyImportant = false;

  function slug(t) { return R.fold(t).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section"; }

  // Les numéros ne sont pas saisis : « 5.12 » = 12ᵉ règle du 5ᵉ chapitre numéroté, dans l'ordre choisi dans le panel.
  function build(data) {
    var n = 0, used = {}, hasImportant = false, order = 0;
    var chapters = data.chapters.map(function (c) {
      var numbered = c.numbered !== false, key, label = "";
      if (numbered) { n++; key = String(n); label = "Chapitre " + n; }
      else { key = slug(c.title); while (used[key] || /^\d+$/.test(key)) key += "-bis"; }
      used[key] = true;
      var ch = { key: key, id: "chapitre-" + key, n: numbered ? n : null, numbered: numbered, label: label, title: c.title, intro: c.intro || "", rules: [] };
      ch.rules = (c.rules || []).map(function (r, i) {
        var num = numbered ? n + "." + (i + 1) : "";
        var rule = { id: numbered ? "r" + n + "-" + (i + 1) : "r-" + key + "-" + (i + 1), num: num, title: r.title, body: r.body || "", important: r.important === true, chapter: ch, order: order++ };
        if (rule.important) hasImportant = true;
        rule.plain = R.plain(rule.body);
        rule.fTitle = R.fold(rule.title); rule.fBody = R.fold(rule.plain); rule.fNum = num;
        return rule;
      });
      ch.fHead = R.fold((label ? label + " " : "") + c.title);
      return ch;
    });
    // Le barème a aussi ses entrées (niveaux et sections) : elles se retrouvent par la recherche et par leur adresse (#bareme-grave)
    var bar = [], bo = 1000000, barCh = { id: "bareme", label: "", title: "Barème des sanctions", fHead: R.fold("Barème des sanctions") };
    var addBar = function (id, title, body) {
      var plain = R.plain(body || "");
      bar.push({ id: id, num: "", title: title, body: body || "", important: false, chapter: barCh, order: bo++, plain: plain, fTitle: R.fold(title), fBody: R.fold(plain), fNum: "", bar: true });
    };
    if (data.bareme) {
      (data.bareme.levels || []).forEach(function (lv, i) { addBar("bareme-" + lv.key, "Niveau " + (i + 1) + " — " + lv.label, lv.body); });
      (data.bareme.sections || []).forEach(function (sc, i) { addBar("bareme-s" + (i + 1), sc.title, sc.body); });
    }
    return { chapters: chapters, bareme: data.bareme || null, bar: bar, updated: data.updated || "", hasImportant: hasImportant };
  }
  var barById = {};
  function index() {
    byId = {}; ruleById = {}; barById = {};
    model.chapters.forEach(function (c) { byId[c.id] = c; c.rules.forEach(function (r) { ruleById[r.id] = r; }); });
    model.bar.forEach(function (b) { barById[b.id] = b; });
  }
  function chapterHref(num) { var c = byId["chapitre-" + num]; return c ? "#" + c.id : null; }
  var RENDER_OPTS = { chapterHref: chapterHref };

  /* ---------- Colonne de gauche ---------- */
  function navLink(href, key, num, name, meta) {
    var li = el("li");
    var a = el("a", "regl__link");
    a.setAttribute("href", href);
    a.setAttribute("data-key", key);
    if (num) a.appendChild(el("span", "regl__num", num));
    a.appendChild(el("span", "regl__name", R.typo(name)));
    if (meta) a.appendChild(el("span", "regl__meta", meta));
    a.addEventListener("click", function (e) { e.preventDefault(); go(href.slice(1), { push: true, scroll: true }); closeNav(); });
    li.appendChild(a);
    return li;
  }
  function buildNav() {
    clear(list);
    model.chapters.forEach(function (c) {
      var n = c.rules.length;
      list.appendChild(navLink("#" + c.id, c.key, c.label, c.title, n + (n > 1 ? " règles" : " règle")));
    });
    if (model.bareme) {
      var li = navLink("#bareme", "bareme", "Barème", "Barème des sanctions", "Indicatif · 4 niveaux");
      li.className = "regl__sep";
      list.appendChild(li);
    }
    toggle.hidden = false;
  }
  function markNav() {
    var key = view.kind === "chapter" ? view.key : view.kind === "bareme" ? "bareme" : null, label = "Chapitres";
    $$(".regl__link", list).forEach(function (a) {
      var on = a.getAttribute("data-key") === key;
      if (on) { a.setAttribute("aria-current", "true"); label = $(".regl__num", a) ? $(".regl__num", a).textContent + " · " + $(".regl__name", a).textContent : $(".regl__name", a).textContent; }
      else a.removeAttribute("aria-current");
    });
    if (view.kind === "search") label = "Résultats de recherche";
    $("#regl-toggle-label").textContent = label;
  }
  function closeNav() { nav.classList.remove("is-open"); toggle.setAttribute("aria-expanded", "false"); }
  toggle.addEventListener("click", function () {
    var open = !nav.classList.contains("is-open");
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  });

  /* ---------- Un chapitre ---------- */
  function copyLink(rule, btn) {
    var url = location.origin + location.pathname + "#" + rule.id;
    var done = function (ok) {
      btn.textContent = ok ? "Lien copié ✓" : "Copie impossible";
      setTimeout(function () { btn.textContent = "Copier le lien"; }, 1800);
    };
    var fallback = function () {
      var ta = document.createElement("textarea");
      ta.value = url; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      done(ok);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(function () { done(true); }, fallback);
    else fallback();
  }

  var silent = false;   // vrai quand c'est la page (et non la personne) qui ouvre une règle
  function renderRule(rule) {
    var d = el("details", "rule" + (rule.important ? " rule--important" : ""));
    d.id = rule.id;
    var sum = el("summary");
    if (rule.num) sum.appendChild(el("span", "rule__num", rule.num));
    sum.appendChild(el("span", "rule__title", R.typo(rule.title)));
    if (rule.important) sum.appendChild(el("span", "rule__flag", "Important"));
    d.appendChild(sum);
    var body = el("div", "rule__body");
    R.render(rule.body, body, RENDER_OPTS);
    var foot = el("div", "rule__foot");
    var copy = el("button", "btn btn--small btn--link", "Copier le lien");
    copy.type = "button";
    copy.setAttribute("aria-label", "Copier le lien vers la règle " + (rule.num || rule.title));
    copy.addEventListener("click", function () { copyLink(rule, copy); });
    foot.appendChild(copy);
    body.appendChild(foot);
    d.appendChild(body);
    // Ouvrir une règle met son adresse dans la barre du navigateur (pour la partager telle quelle).
    d.addEventListener("toggle", function () {
      if (silent || !window.history || !history.replaceState) return;
      if (d.open) history.replaceState(null, "", "#" + rule.id);
      else if (location.hash === "#" + rule.id) history.replaceState(null, "", "#" + rule.chapter.id);
    });
    return d;
  }

  function backChip() {
    if (!query) return null;
    var b = el("button", "regl__back", "← Résultats pour « " + query + " »");
    b.type = "button";
    b.addEventListener("click", function () { go(null, { search: true }); });
    return b;
  }

  function renderChapter(ch) {
    clear(content);
    var chip = backChip(); if (chip) content.appendChild(chip);
    var sec = el("section", "chapter");
    sec.id = ch.id;
    sec.setAttribute("aria-labelledby", ch.id + "-titre");
    var head = el("header", "chapter__head");
    if (ch.label) head.appendChild(el("p", "eyebrow", ch.label));
    var h = el("h2", "chapter__title", R.typo(ch.title));
    h.id = ch.id + "-titre";
    head.appendChild(h);
    if (ch.intro) { var intro = el("div", "chapter__intro"); R.render(ch.intro, intro, RENDER_OPTS); head.appendChild(intro); }
    var tools = el("div", "chapter__tools");
    var open = el("button", "btn btn--ghost btn--small", "Tout déplier"), close = el("button", "btn btn--ghost btn--small", "Tout replier");
    open.type = close.type = "button";
    tools.appendChild(open); tools.appendChild(close);
    var imp = null;
    if (model.hasImportant) {
      imp = el("button", "btn btn--ghost btn--small regl__imp", "★ Règles importantes");
      imp.type = "button"; imp.setAttribute("aria-pressed", String(onlyImportant));
      tools.appendChild(imp);
    }
    if (ch.rules.length) head.appendChild(tools);
    sec.appendChild(head);

    var rules = el("div", "rules__list");
    var items = ch.rules.map(function (r) { return renderRule(r); });
    var empty = el("p", "regl__empty", "Aucune règle importante dans ce chapitre.");
    var applyFilter = function () {
      var shown = 0;
      ch.rules.forEach(function (r, i) { var on = !onlyImportant || r.important; items[i].hidden = !on; if (on) shown++; });
      empty.hidden = shown > 0 || !ch.rules.length;
      if (imp) imp.setAttribute("aria-pressed", String(onlyImportant));
    };
    items.forEach(function (d) { rules.appendChild(d); });
    rules.appendChild(empty);
    if (!ch.rules.length && !ch.intro) rules.appendChild(el("p", "regl__empty", "Ce chapitre ne contient pas encore de règle."));
    sec.appendChild(rules);
    sec.appendChild(el("p", "rules__note", "Le staff se réserve le droit de modifier ce règlement à tout moment. Les mises à jour sont annoncées sur le Discord."));
    content.appendChild(sec);

    open.addEventListener("click", function () { silent = true; items.forEach(function (d) { if (!d.hidden) d.open = true; }); setTimeout(function () { silent = false; }, 50); });
    close.addEventListener("click", function () { silent = true; items.forEach(function (d) { d.open = false; }); setTimeout(function () { silent = false; }, 50); });
    if (imp) imp.addEventListener("click", function () { onlyImportant = !onlyImportant; applyFilter(); });
    applyFilter();
  }

  /* ---------- Barème des sanctions (indicatif) ---------- */
  function renderBareme() {
    clear(content);
    var chip = backChip(); if (chip) content.appendChild(chip);
    var b = model.bareme;
    var sec = el("section", "chapter chapter--bareme");
    sec.id = "bareme";
    sec.setAttribute("aria-labelledby", "bareme-titre");
    var head = el("header", "chapter__head");
    head.appendChild(el("p", "eyebrow", "Barème"));
    var h = el("h2", "chapter__title", "Barème des sanctions"); h.id = "bareme-titre";
    head.appendChild(h);
    var intro = el("div", "chapter__intro"); R.render(b.intro || "", intro, RENDER_OPTS);
    head.appendChild(intro);
    sec.appendChild(head);
    var grid = el("div", "levels");
    (b.levels || []).forEach(function (lv, i) {
      var card = el("article", "level level--" + lv.key);
      card.id = "bareme-" + lv.key;
      var top = el("div", "level__top");
      var name = el("div", "level__id");
      name.appendChild(el("p", "level__n", "Niveau " + (i + 1)));
      name.appendChild(el("h3", "level__name", lv.label));
      top.appendChild(name);
      var meter = el("span", "level__meter"); meter.setAttribute("aria-hidden", "true");
      for (var k = 0; k < 4; k++) meter.appendChild(el("i", k <= i ? "on" : ""));
      top.appendChild(meter);
      card.appendChild(top);
      if (lv.body) { var body = el("div", "level__body"); R.render(lv.body, body, RENDER_OPTS); card.appendChild(body); }
      grid.appendChild(card);
    });
    sec.appendChild(grid);
    if ((b.sections || []).length) {
      var wrap = el("div", "bsections");
      b.sections.forEach(function (sc, i) {
        var box = el("article", "bsec bsec--" + (sc.kind || "info"));
        box.id = "bareme-s" + (i + 1);
        box.appendChild(el("h3", "bsec__title", R.typo(sc.title)));
        var body = el("div", "bsec__body"); R.render(sc.body || "", body, RENDER_OPTS);
        box.appendChild(body);
        wrap.appendChild(box);
      });
      sec.appendChild(wrap);
    }
    content.appendChild(sec);
  }

  /* ---------- Recherche ---------- */
  function foldAligned(text) {
    var out = "";
    for (var i = 0; i < text.length; i++) { var f = R.fold(text.charAt(i)); out += f.length === 1 ? f : text.charAt(i).toLowerCase(); }
    return out;
  }
  function terms(q) {
    var seen = {}, out = [];
    R.fold(q).split(/\s+/).forEach(function (t) { if (t && !seen[t]) { seen[t] = 1; out.push(t); } });
    return out;
  }
  function count(hay, term) { var n = 0, i = -1; while ((i = hay.indexOf(term, i + 1)) !== -1 && n < 3) n++; return n; }

  function search(q) {
    var ts = terms(q), phrase = R.fold(q).replace(/\s+/g, " ").trim();
    var hits = [], all = [];
    model.chapters.forEach(function (c) { c.rules.forEach(function (r) { all.push(r); }); });
    all = all.concat(model.bar);
    all.forEach(function (r) {
      var c = r.chapter, score = 0, ok = true;
      for (var i = 0; i < ts.length; i++) {
        var t = ts[i], s = 0;
        if (r.fNum && (r.fNum === t || r.fNum.indexOf(t) === 0)) s += 20;
        if (r.fTitle.indexOf(t) !== -1) s += 10;
        var inBody = count(r.fBody, t);
        if (inBody) s += 2 + inBody;
        if (c.fHead.indexOf(t) !== -1) s += 1;
        if (!s) { ok = false; break; }
        score += s;
      }
      if (!ok) return;
      if (ts.length > 1) { if (r.fTitle.indexOf(phrase) !== -1) score += 8; else if (r.fBody.indexOf(phrase) !== -1) score += 4; }
      if (r.important) score += 1;
      hits.push({ rule: r, score: score });
    });
    hits.sort(function (a, b) { return b.score - a.score || a.rule.order - b.rule.order; });
    var chapters = model.chapters.filter(function (c) { return ts.every(function (t) { return c.fHead.indexOf(t) !== -1; }); });
    return { terms: ts, hits: hits, chapters: chapters };
  }

  // Écrit `text` dans `parent` en entourant les mots cherchés de <mark> (sans tenir compte des accents ni des majuscules)
  function highlight(parent, text, ts) {
    var f = foldAligned(text), marks = [];
    ts.forEach(function (t) { var i = -1; while ((i = f.indexOf(t, i + 1)) !== -1) marks.push([i, i + t.length]); });
    marks.sort(function (a, b) { return a[0] - b[0] || b[1] - a[1]; });
    var pos = 0;
    marks.forEach(function (m) {
      if (m[1] <= pos) return;
      var from = Math.max(m[0], pos);
      if (from > pos) parent.appendChild(document.createTextNode(text.slice(pos, from)));
      parent.appendChild(el("mark", null, text.slice(from, m[1])));
      pos = m[1];
    });
    if (pos < text.length) parent.appendChild(document.createTextNode(text.slice(pos)));
    return parent;
  }
  function snippet(rule, ts) {
    var text = rule.plain, f = foldAligned(text), at = -1;
    ts.forEach(function (t) { var i = f.indexOf(t); if (i !== -1 && (at === -1 || i < at)) at = i; });
    if (at === -1) return { text: text.slice(0, 150) + (text.length > 150 ? "…" : ""), cut: false };
    var from = Math.max(0, at - 50), to = Math.min(text.length, at + 120);
    if (from > 0) { var sp = text.indexOf(" ", from); if (sp !== -1 && sp < at) from = sp + 1; }
    if (to < text.length) { var sq = text.lastIndexOf(" ", to); if (sq > at) to = sq; }
    return { text: (from > 0 ? "… " : "") + text.slice(from, to) + (to < text.length ? " …" : "") };
  }

  function renderResults() {
    clear(content);
    var out = search(query), box = el("section", "results");
    box.setAttribute("aria-label", "Résultats de la recherche");
    var total = out.hits.length;
    var head = el("p", "results__count", total ? total + (total > 1 ? " règles trouvées" : " règle trouvée") + " pour « " + query + " »" + (total > MAX_RESULTS ? " (" + MAX_RESULTS + " premières affichées)" : "") : "Aucune règle ne correspond à « " + query + " ».");
    head.setAttribute("role", "status");
    box.appendChild(head);
    if (out.chapters.length) {
      var chips = el("p", "results__chapters");
      out.chapters.forEach(function (c) {
        var a = el("a", "regl__chip", (c.label ? c.label + " · " : "") + c.title);
        a.setAttribute("href", "#" + c.id);
        a.addEventListener("click", function (e) { e.preventDefault(); go(c.id, { push: true, scroll: true }); });
        chips.appendChild(a);
      });
      box.appendChild(chips);
    }
    if (!total) box.appendChild(el("p", "regl__empty", "Essayez un autre mot-clé, un numéro de règle (ex. 5.12) ou le nom d’un chapitre."));
    var ol = el("ol", "results__list");
    out.hits.slice(0, MAX_RESULTS).forEach(function (h) {
      var r = h.rule, li = el("li");
      var a = el("a", "hit" + (r.important ? " hit--important" : ""));
      a.setAttribute("href", "#" + r.id);
      var top = el("span", "hit__top");
      if (r.num) top.appendChild(el("span", "hit__num", r.num));
      top.appendChild(highlight(el("span", "hit__title"), r.title, out.terms));
      if (r.important) top.appendChild(el("span", "rule__flag", "Important"));
      a.appendChild(top);
      a.appendChild(el("span", "hit__chap", (r.chapter.label ? r.chapter.label + " · " : "") + r.chapter.title));
      var sn = snippet(r, out.terms);
      a.appendChild(highlight(el("span", "hit__snippet"), sn.text, out.terms));
      a.addEventListener("click", function (e) { e.preventDefault(); go(r.id, { push: true, scroll: true }); });
      li.appendChild(a);
      ol.appendChild(li);
    });
    box.appendChild(ol);
    content.appendChild(box);
  }

  /* ---------- Navigation ---------- */
  function flash(node) {
    node.classList.add("rule--flash");
    setTimeout(function () { node.classList.remove("rule--flash"); }, 2200);
  }

  // Affiche ce que désigne l'adresse (#chapitre-2, #r2-7, #bareme) ; opts.search : revient aux résultats de la recherche
  function go(id, opts) {
    opts = opts || {};
    if (opts.search) { view = { kind: "search" }; }
    else {
      var rule = id ? ruleById[id] : null;
      var ch = rule ? rule.chapter : id ? byId[id] : null;
      var bar = id && model.bareme ? barById[id] : null;
      if ((id === "bareme" || bar) && model.bareme) view = { kind: "bareme" };
      else { if (!ch) { ch = model.chapters[0]; rule = null; id = ch.id; } view = { kind: "chapter", key: ch.key }; }
      if (opts.push && window.history && history.pushState && location.hash !== "#" + id) history.pushState(null, "", "#" + id);
    }
    if (view.kind === "search") renderResults();
    else if (view.kind === "bareme") renderBareme();
    else renderChapter(byId["chapitre-" + view.key]);
    markNav();
    if (view.kind === "bareme" && bar) {
      var bn = document.getElementById(bar.id);
      if (bn) { bn.scrollIntoView({ behavior: "instant", block: "start" }); flash(bn); }
    } else if (view.kind === "chapter" && rule) {
      var d = document.getElementById(rule.id);
      if (d) { silent = true; d.open = true; setTimeout(function () { silent = false; }, 50); d.scrollIntoView({ behavior: "instant", block: "start" }); flash(d); }
    } else if (opts.scroll || opts.search) {
      var target = $(".regl__toolbar", section);
      if (isMobile()) content.scrollIntoView({ behavior: "smooth", block: "start" });
      else if (content.getBoundingClientRect().top < 0 && target) target.scrollIntoView({ behavior: "instant", block: "start" });
    }
  }

  function fromHash(scroll) {
    var id = "";
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { id = ""; }
    go(id, { scroll: scroll });
  }

  /* ---------- Barre de recherche ---------- */
  var timer = null;
  function onInput() {
    query = input.value.replace(/\s+/g, " ").trim();
    clearBtn.hidden = !input.value;
    if (query) go(null, { search: true });
    else fromHash(false);
  }
  input.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(onInput, 120); });
  $("#regl-search-form").addEventListener("submit", function (e) { e.preventDefault(); clearTimeout(timer); onInput(); });
  clearBtn.addEventListener("click", function () { input.value = ""; onInput(); input.focus(); });
  input.addEventListener("keydown", function (e) { if (e.key === "Escape" && input.value) { e.preventDefault(); input.value = ""; onInput(); } });
  document.addEventListener("keydown", function (e) {   // « / » place le curseur dans la recherche
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
    e.preventDefault(); input.focus(); input.select();
  });

  /* ---------- Démarrage ---------- */
  function showDate(iso) {
    var d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + "T12:00:00" : iso);
    if (isNaN(d)) return;
    var t = $("#regl-updated-time");
    t.textContent = d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    t.setAttribute("datetime", d.toISOString().slice(0, 10));
    $("#regl-updated").hidden = false;
  }

  load().then(function (data) {
    model = build(data);
    index();
    buildNav();
    input.disabled = false;
    showDate(model.updated);
    var q = "";
    try { q = new URLSearchParams(location.search).get("q") || ""; } catch (e) { q = ""; }
    if (q) { input.value = q.slice(0, 80); query = q.replace(/\s+/g, " ").trim(); clearBtn.hidden = false; go(null, { search: true }); }
    else fromHash(false);
    window.addEventListener("popstate", function () { fromHash(false); });
    window.addEventListener("hashchange", function () { fromHash(false); });
  }, function () {
    clear(content);
    var p = el("p", "regl__status", "Le règlement est momentanément indisponible. Réessayez dans un instant, ou retrouvez les règles sur notre Discord.");
    p.setAttribute("role", "alert");
    content.appendChild(p);
  });
})();
