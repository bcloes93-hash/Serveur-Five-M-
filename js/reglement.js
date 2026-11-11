/*
 * Page Règlement : le règlement en livre (couverture en cuir, pages crème qui se tournent).
 * Les règles viennent du panel staff (route publique /api/public/rules : seulement ce qui est publié).
 * Si le panel est injoignable ou pas encore installé, on affiche l'instantané data/reglement.json (version d'origine).
 *
 * Fonctionnement : le texte est découpé en blocs (titre de chapitre, titre de règle, paragraphes…), puis
 * réparti dans des pages de la taille de l'écran (mise en page refaite si la taille change). Deux pages côte à côte
 * sur grand écran, une seule sur téléphone. Les adresses restent les mêmes qu'avant : #chapitre-3, #r5-12, #bareme…
 */
(function () {
  "use strict";

  var cfg = window.SITE_CONFIG || {};
  var R = window.SLRules;
  var section = document.getElementById("reglement");
  if (!section || !R) return;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var book = $("#book"), body = $("#book-body"), slotL = $("#slot-left"), slotR = $("#slot-right"), leaf = $("#leaf");
  var faceF = $(".leaf__face--front", leaf), faceB = $(".leaf__face--back", leaf);
  var tabsEl = $("#book-tabs"), statusEl = $("#livre-status"), controls = $("#livre-controls");
  var btnPrev = $("#livre-prev"), btnNext = $("#livre-next"), cornerPrev = $("#corner-prev"), cornerNext = $("#corner-next");
  var range = $("#livre-range"), where = $("#livre-where"), stage = $("#livre-stage");
  var input = $("#livre-q"), clearBtn = $("#livre-clear"), results = $("#livre-results"), tocSel = $("#livre-toc");
  var modeBtn = $("#livre-mode"), lecture = $("#livre-lecture"), hint = $("#livre-hint");
  var REDUCED = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  // Pages animées : activées d'office, sauf si le système demande moins d'animations ; le bouton sous le livre change ce choix (retenu).
  var animBtn = $("#livre-anim"), ANIM = !REDUCED;
  try { var savedAnim = localStorage.getItem("sl-reglement-anim"); if (savedAnim === "1" || savedAnim === "0") ANIM = savedAnim === "1"; } catch (e) { /* stockage indisponible */ }
  function showAnim() { animBtn.setAttribute("aria-pressed", String(ANIM)); animBtn.textContent = ANIM ? "Pages animées : oui" : "Pages animées : non"; book.classList.toggle("no-anim", !ANIM); }
  showAnim();
  animBtn.addEventListener("click", function () {
    ANIM = !ANIM; showAnim();
    try { localStorage.setItem("sl-reglement-anim", ANIM ? "1" : "0"); } catch (e) { /* stockage indisponible */ }
  });
  var MAX_RESULTS = 40;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   // jamais innerHTML : un texte du règlement n'est jamais interprété
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function say(t) { statusEl.textContent = t; statusEl.hidden = !t; }

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
  var model = null, byId = {}, ruleById = {}, barById = {};
  function slug(t) { return R.fold(t).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section"; }

  // Les numéros ne sont pas saisis : « 5.12 » = 12ᵉ règle du 5ᵉ chapitre numéroté, dans l'ordre choisi dans le panel.
  function build(data) {
    var n = 0, used = {}, order = 0;
    var chapters = data.chapters.map(function (c) {
      var numbered = c.numbered !== false, key, label = "";
      if (numbered) { n++; key = String(n); label = "Chapitre " + n; }
      else { key = slug(c.title); while (used[key] || /^\d+$/.test(key)) key += "-bis"; }
      used[key] = true;
      var ch = { key: key, id: "chapitre-" + key, n: numbered ? n : null, label: label, title: c.title, intro: c.intro || "", rules: [] };
      ch.rules = (c.rules || []).map(function (r, i) {
        var num = numbered ? n + "." + (i + 1) : "";
        var rule = { id: numbered ? "r" + n + "-" + (i + 1) : "r-" + key + "-" + (i + 1), num: num, title: r.title, body: r.body || "", important: r.important === true, chapter: ch, order: order++ };
        rule.plain = R.plain(rule.body);
        rule.fTitle = R.fold(rule.title); rule.fBody = R.fold(rule.plain); rule.fNum = num;
        return rule;
      });
      ch.fHead = R.fold((label ? label + " " : "") + c.title);
      return ch;
    });
    // Le barème a aussi ses entrées (sections et chaque infraction) : on les retrouve par la recherche et par leur adresse (#bareme-s2-3)
    var bar = [], bo = 1000000, cats = [], barCh = { id: "bareme", label: "", title: "Barème des sanctions", fHead: R.fold("Barème des sanctions") };
    var addBar = function (id, title, body, ch, plain) {
      plain = plain != null ? plain : R.plain(body || "");
      bar.push({ id: id, num: "", title: title, body: body || "", important: false, chapter: ch || barCh, order: bo++, plain: plain, fTitle: R.fold(title), fBody: R.fold(plain), fNum: "", bar: true });
    };
    if (data.bareme) {
      (data.bareme.levels || []).forEach(function (lv, i) { if (lv.body) addBar("bareme-" + lv.key, "Niveau " + (i + 1) + " — " + lv.label, lv.body); });
      (data.bareme.sections || []).forEach(function (sc, i) {
        var id = "bareme-s" + (i + 1);
        if (sc.kind === "infractions") {
          var parsed = R.parseInfractions(sc.body), ch = { id: "bareme", label: "", title: "Barème des sanctions · " + sc.title, fHead: R.fold("Barème des sanctions " + sc.title) };
          cats.push({ id: id, title: sc.title, count: parsed.items.length });
          addBar(id, sc.title, sc.body, barCh, parsed.lead.join(" "));
          parsed.items.forEach(function (it, j) { addBar(id + "-" + (j + 1), it.title || sc.title, "", ch, R.infractionText(it)); });
        } else addBar(id, sc.title, sc.body);
      });
    }
    return { chapters: chapters, bareme: data.bareme || null, bar: bar, cats: cats, updated: data.updated || "" };
  }
  function index() {
    byId = {}; ruleById = {}; barById = {};
    model.chapters.forEach(function (c) { byId[c.id] = c; c.rules.forEach(function (r) { ruleById[r.id] = r; }); });
    model.bar.forEach(function (b) { barById[b.id] = b; });
  }
  function chapterHref(num) { var c = byId["chapitre-" + num]; return c ? "#" + c.id : null; }
  function ruleHref(num) { var id = "r" + String(num).replace(".", "-"); return ruleById[id] ? "#" + id : null; }   // « 5.12 » -> #r5-12 (si cette règle est publiée)
  var OPTS = { chapterHref: chapterHref, ruleHref: ruleHref };

  function dateText(iso) {
    var d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? iso + "T12:00:00" : iso || "");
    return isNaN(d) ? null : { text: d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }), iso: d.toISOString().slice(0, 10) };
  }

  /* ---------- Blocs de texte (créés à neuf à chaque mise en page) ---------- */
  // keep : reste avec le bloc suivant (un titre n'est jamais seul en bas de page) ; newPage : commence une nouvelle page.
  function blk(node, o) {
    o = o || {};
    node.__keep = !!o.keep; node.__newPage = !!o.newPage; node.__chapter = o.chapter || null;
    return node;
  }
  function ornament() { var o = el("div", "lb-orn"); o.setAttribute("aria-hidden", "true"); o.appendChild(el("span", null, "◆")); return o; }
  function opener(id, kicker, title, chapter) {
    var h = el("header", "lb-open"); h.dataset.id = id;
    h.appendChild(el("p", "lb-open__kicker", kicker));
    h.appendChild(el("h2", "lb-open__title", R.typo(title)));
    h.appendChild(ornament());
    return blk(h, { keep: true, newPage: true, chapter: chapter });
  }
  function children(frag, out, firstKeep) {
    Array.prototype.slice.call(frag.childNodes).forEach(function (n, i) {
      if (n.nodeType !== 1) return;
      $$("[id]", n).concat(n.id ? [n] : []).forEach(function (x) { x.dataset.id = x.id; x.removeAttribute("id"); });   // pas d'id en double : les adresses passent par data-id
      out.push(blk(n, { keep: firstKeep && i === 0 }));
    });
    return out;
  }
  function tocBlocks() {
    var out = [opener("sommaire", "Santos Legacy RP", "Sommaire", { label: "", title: "Sommaire" })];
    var ol = el("ol", "lb-toc");
    var entries = model.chapters.map(function (c) { return { id: c.id, n: c.n ? String(c.n) : "", t: c.title }; });
    if (model.bareme) entries.push({ id: "bareme", n: "", t: "Barème des sanctions" });
    entries.forEach(function (e) {
      var li = el("li"), a = el("a");
      a.setAttribute("href", "#" + e.id);
      a.appendChild(el("span", "lb-toc__n", e.n || "·"));
      a.appendChild(el("span", "lb-toc__t", R.typo(e.t)));
      a.appendChild(el("span", "lb-toc__dots"));
      var p = el("span", "lb-toc__p", "000"); p.dataset.target = e.id;
      a.appendChild(p);
      li.appendChild(a); ol.appendChild(li);
    });
    out.push(blk(ol));
    return out;
  }
  function chapterBlocks(ch) {
    var out = [opener(ch.id, ch.label || "Charte", ch.title, ch)];
    if (ch.intro) { var intro = el("div", "lb-intro"); R.render(ch.intro, intro, OPTS); out.push(blk(intro)); }
    ch.rules.forEach(function (r) {
      var h = el("h3", "lr-head"); h.dataset.id = r.id;
      if (r.num) {
        var b = el("button", "lr-num", r.num); b.type = "button";
        b.title = "Copier le lien de la règle " + r.num;
        h.appendChild(b);
      }
      h.appendChild(document.createTextNode(R.typo(r.title)));
      if (r.important) { var s = el("span", "lr-star", "★"); s.title = "Règle importante"; h.appendChild(s); }
      out.push(blk(h, { keep: true }));
      children(R.render(r.body, null, OPTS), out);
    });
    if (!ch.rules.length && !ch.intro) out.push(blk(el("p", null, "Ce chapitre ne contient pas encore de règle.")));
    return out;
  }
  function baremeBlocks() {
    var b = model.bareme, ch = { label: "Barème", title: "Barème des sanctions" };
    var out = [opener("bareme", "Barème · à titre indicatif", "Barème des sanctions", ch)];
    if (b.intro) children(R.render(b.intro, null, OPTS), out);
    (b.levels || []).forEach(function (lv, i) {
      if (!lv.body) return;
      var h = el("h3", "lb-cat", "Niveau " + (i + 1) + " — " + lv.label); h.dataset.id = "bareme-" + lv.key;
      out.push(blk(h, { keep: true }));
      children(R.render(lv.body, null, OPTS), out);
    });
    (b.sections || []).forEach(function (sc, i) {
      var id = "bareme-s" + (i + 1);
      var h = el("h3", "lb-cat", R.typo(sc.title)); h.dataset.id = id;
      out.push(blk(h, { keep: true }));
      if (sc.kind === "infractions") {
        var frag = R.renderInfractions(sc.body || "", null, { chapterHref: chapterHref, ruleHref: ruleHref, idPrefix: id });
        Array.prototype.slice.call(frag.childNodes).forEach(function (n) {
          if (n.classList && n.classList.contains("infs")) children(n, out); else children({ childNodes: [n] }, out);
        });
      } else {
        var box = el("div", sc.kind === "key" ? "rule__callout" : "lb-sec");
        R.render(sc.body || "", box, OPTS);
        out.push(blk(box));
      }
    });
    return out;
  }
  function endBlock() {
    var d = el("div", "lb-end"); d.appendChild(ornament());
    d.appendChild(el("p", "lb-intro", "Le staff se réserve le droit de modifier ce règlement à tout moment. Les mises à jour sont annoncées sur le Discord."));
    return blk(d);
  }
  function allBlocks() {
    var out = [];
    model.chapters.forEach(function (c) { out = out.concat(chapterBlocks(c)); });
    if (model.bareme) out = out.concat(baremeBlocks());
    out.push(endBlock());
    return out;
  }

  /* ---------- Pages spéciales ---------- */
  function coverPage() {
    var p = el("article", "page page--cover page--right");
    p.appendChild(el("div", "cover__spine"));
    var f = el("div", "cover__frame");
    f.appendChild(el("p", "cover__kicker", "Santos Legacy RP"));
    var img = el("img", "cover__logo"); img.src = "assets/livre-logo.webp"; img.alt = ""; img.width = 560; img.height = 560;
    f.appendChild(img);
    f.appendChild(el("h2", "cover__title gold-text", "Règlement"));
    var dt = model && dateText(model.updated);
    f.appendChild(el("p", "cover__sub", dt ? "Édition du " + dt.text : "Édition officielle"));
    p.appendChild(f);
    return p;
  }
  function endpaperPage(front) {
    var p = el("article", "page page--endpaper " + (front ? "page--left" : "page--right"));
    if (front) {
      var box = el("div", "endpaper__box");
      box.appendChild(el("h2", "gold-text", "Avant-propos"));
      box.appendChild(el("p", null, "Ces règles existent pour garantir à tous une expérience sérieuse et immersive."));
      box.appendChild(el("p", null, "En jouant sur Santos Legacy RP, vous acceptez de les respecter."));
      p.appendChild(box);
    }
    return p;
  }
  function backPage() {
    var p = el("article", "page page--back page--left");
    p.appendChild(el("div", "cover__spine"));
    var f = el("div", "cover__frame");
    var img = el("img", "back__logo"); img.src = "assets/livre-logo.webp"; img.alt = ""; img.width = 560; img.height = 560;
    f.appendChild(img);
    f.appendChild(el("p", "back__text", "Un roleplay pensé pour durer. Bienvenue à Los Santos."));
    f.appendChild(el("p", "cover__kicker", "Santos Legacy RP"));
    p.appendChild(f);
    return p;
  }
  function paperPage() {
    var p = el("article", "page page--paper");
    p.__run = el("header", "page__run"); p.__run.setAttribute("aria-hidden", "true");
    p.__content = el("div", "page__content");
    p.__folio = el("footer", "page__folio"); p.__folio.setAttribute("aria-hidden", "true");
    p.appendChild(p.__run); p.appendChild(p.__content); p.appendChild(p.__folio);
    return p;
  }

  /* ---------- Mise en page : répartir les blocs dans des pages ---------- */
  var S = { pages: [], pos: 0, mode: "spread", pw: 0, ph: 0, busy: false, queued: null, pageOf: {}, chapterOfPage: [] };

  function tokens(node) {   // mots du texte (les éléments en ligne, gras ou liens, restent entiers)
    var out = [];
    Array.prototype.forEach.call(node.childNodes, function (c) {
      if (c.nodeType === 3) c.nodeValue.split(/(\s+)/).forEach(function (w) { if (w) out.push(w); });
      else out.push(c);
    });
    return out;
  }
  function fillTokens(target, toks, from, to) {
    clear(target);
    for (var k = from; k < to; k++) target.appendChild(typeof toks[k] === "string" ? document.createTextNode(toks[k]) : toks[k].cloneNode(true));
  }

  // Remplit la fin de la page courante avec le début de `b` ; renvoie le reste (ou null si rien ne tient / bloc insécable).
  function splitToFit(content, b, fits) {
    var tag = b.tagName, part, rest;
    if (tag === "UL" || tag === "OL") {
      var items = Array.prototype.slice.call(b.children);
      if (items.length < 2) return null;
      part = b.cloneNode(false); content.appendChild(part);
      var k = 0;
      while (k < items.length) { part.appendChild(items[k]); if (!fits()) { part.removeChild(items[k]); break; } k++; }
      if (k === 0 || k === items.length) { items.slice(0, k).forEach(function (it) { b.insertBefore(it, b.children[0] || null); }); content.removeChild(part); return null; }
      rest = b.cloneNode(false);
      items.slice(k).forEach(function (it) { rest.appendChild(it); });
      if (tag === "OL") rest.setAttribute("start", String((parseInt(b.getAttribute("start"), 10) || 1) + k));
      return blk(rest, { keep: b.__keep });
    }
    if (tag === "P" || tag === "BLOCKQUOTE") {
      var toks = tokens(b);
      if (toks.length < 8) return null;
      part = b.cloneNode(false); content.appendChild(part);
      var lo = 0, hi = toks.length - 1;   // nombre de mots qui tiennent
      while (lo < hi) {
        var mid = Math.ceil((lo + hi) / 2);
        fillTokens(part, toks, 0, mid);
        if (fits()) lo = mid; else hi = mid - 1;
      }
      while (lo > 0 && typeof toks[lo - 1] === "string" && !toks[lo - 1].trim()) lo--;
      if (lo < 4 || toks.length - lo < 3) { content.removeChild(part); return null; }
      fillTokens(part, toks, 0, lo);
      rest = b.cloneNode(false); rest.classList.add("is-cont");
      var start = lo; while (start < toks.length && typeof toks[start] === "string" && !toks[start].trim()) start++;
      fillTokens(rest, toks, start, toks.length);
      return blk(rest);
    }
    if (tag === "DIV" || tag === "ARTICLE") {
      var kids = Array.prototype.slice.call(b.children);
      if (kids.length < 2) return null;
      part = b.cloneNode(false); content.appendChild(part);
      var j = 0;
      while (j < kids.length) { part.appendChild(kids[j]); if (!fits()) { part.removeChild(kids[j]); break; } j++; }
      if (j === 0 || j === kids.length) { kids.slice(0, j).forEach(function (x) { b.insertBefore(x, b.children[0] || null); }); content.removeChild(part); return null; }
      rest = b.cloneNode(false); rest.classList.add("is-cont");
      kids.slice(j).forEach(function (x) { rest.appendChild(x); });
      return blk(rest);
    }
    return null;
  }

  function paginate() {
    var host = el("div", "book-measure"); host.setAttribute("aria-hidden", "true");
    book.appendChild(host);
    var pages = [coverPage(), endpaperPage(true)];
    var cur = null, curChapter = null;
    function newPaper() { cur = paperPage(); cur.__chapter = curChapter; host.appendChild(cur); pages.push(cur); return cur; }
    function fits() { var c = cur.__content; return c.scrollHeight <= c.clientHeight + 1; }
    function empty() { return !cur.__content.firstChild; }
    function place(n) { cur.__content.appendChild(n); if (fits()) return true; cur.__content.removeChild(n); return false; }

    function flow(blocks) {
      var queue = blocks.slice();
      while (queue.length) {
        var b = queue.shift(), rest;
        if (b.__chapter) curChapter = b.__chapter;
        if (!cur || (b.__newPage && !empty())) newPaper();
        if (b.__newPage) { cur.__chapter = curChapter; cur.__opener = true; }
        if (place(b)) continue;
        if (!empty()) {
          rest = splitToFit(cur.__content, b, fits);
          if (rest) { queue.unshift(rest); continue; }
          var carry = [];   // les titres restés en bas de page partent avec le texte qui les suit
          while (cur.__content.childNodes.length > 1 && cur.__content.lastChild.__keep) carry.unshift(cur.__content.removeChild(cur.__content.lastChild));
          newPaper();
          carry.forEach(function (n) { cur.__content.appendChild(n); });
          if (place(b)) continue;
          rest = splitToFit(cur.__content, b, fits);
          if (rest) { queue.unshift(rest); continue; }
          if (!empty()) { newPaper(); if (place(b)) continue; }
        }
        rest = splitToFit(cur.__content, b, fits);
        if (rest) { queue.unshift(rest); continue; }
        cur.__content.appendChild(b);   // bloc insécable plus grand qu'une page : il est coupé en bas
      }
    }

    var tocStart = pages.length;
    flow(tocBlocks());
    var firstChapterPage = pages.length;
    cur = null;
    flow(allBlocks());
    // Dos du livre à gauche : le nombre de pages avant la garde finale doit être pair
    if (pages.length % 2 === 1) pages.push(paperPage());
    pages.push(endpaperPage(false));
    pages.push(backPage());

    // Adresses -> page, numéros de page, en-têtes courants
    var pageOf = {}, chapterOfPage = [];
    pages.forEach(function (p, i) {
      p.classList.toggle("page--left", i % 2 === 1);
      p.classList.toggle("page--right", i % 2 === 0);
      if (p.__content) {
        $$("[data-id]", p.__content).forEach(function (n) { if (pageOf[n.dataset.id] == null) pageOf[n.dataset.id] = i; });
        p.__folio.textContent = String(i + 1);
        var ch = p.__chapter;
        p.__run.textContent = ch && !p.__opener ? (ch.label ? ch.label + " · " : "") + ch.title : "";
      }
      chapterOfPage[i] = p.__chapter && p.__chapter.id ? p.__chapter.id : null;
    });
    for (var i = tocStart; i < firstChapterPage; i++) $$(".lb-toc__p", pages[i]).forEach(function (s) {
      var at = pageOf[s.dataset.target]; s.textContent = at != null ? String(at + 1) : "";
    });
    book.removeChild(host);
    pages.forEach(function (p) { if (p.parentNode) p.parentNode.removeChild(p); });
    S.pages = pages; S.pageOf = pageOf; S.chapterOfPage = chapterOfPage;
  }

  /* ---------- Taille du livre ---------- */
  function measure() {
    var W = stage.clientWidth, vh = window.innerHeight || 800;
    var spread = W >= 820;
    var availH = Math.max(380, Math.min(900, vh - 280)), pw, ph;   // de la place sous le livre pour les flèches
    if (spread) {
      var maxW = (W - 60) / 2;
      ph = Math.min(availH, maxW / 0.7); pw = ph * 0.7;
    } else {
      pw = Math.min(W, 540); ph = Math.min(pw / 0.7, Math.max(400, vh - 190));
    }
    return { mode: spread ? "spread" : "single", pw: Math.floor(pw), ph: Math.floor(ph) };
  }
  function applySize(m) {
    S.mode = m.mode; S.pw = m.pw; S.ph = m.ph;
    book.dataset.mode = m.mode;
    book.style.setProperty("--pw", m.pw + "px");
    book.style.setProperty("--ph", m.ph + "px");
  }

  /* ---------- Affichage d'une double page ---------- */
  var shades = {};
  [slotL, slotR, faceF, faceB].forEach(function (s, i) { var sh = el("div", "shade"); s.appendChild(sh); shades[i] = sh; s.__shade = sh; });
  function put(slot, page) {
    Array.prototype.slice.call(slot.childNodes).forEach(function (c) { if (c !== slot.__shade) slot.removeChild(c); });
    if (page) slot.insertBefore(page, slot.__shade);
    slot.classList.toggle("leaf__face--blank", !page && (slot === faceF || slot === faceB));
  }
  function N() { return S.pages.length; }
  function maxPos() { return S.mode === "spread" ? N() : N() - 1; }
  function norm(p) {
    p = Math.max(0, Math.min(maxPos(), p | 0));
    if (S.mode === "spread" && p % 2) p += 1;
    return Math.min(p, maxPos());
  }
  function posOfPage(i) { return S.mode === "spread" ? (i % 2 ? i + 1 : i) : i; }
  function atOf(p) { return S.mode !== "spread" ? "open" : p === 0 ? "cover" : p >= N() ? "back" : "open"; }

  function renderStatic() {
    leaf.hidden = true;
    put(faceF, null); put(faceB, null);
    if (S.mode === "spread") { put(slotL, S.pages[S.pos - 1] || null); put(slotR, S.pages[S.pos] || null); }
    else { put(slotL, null); put(slotR, S.pages[S.pos] || null); }
    book.dataset.at = atOf(S.pos);
    updateUI();
  }

  function label(p) {
    if (S.mode === "spread") {
      if (p === 0) return "Couverture";
      if (p >= N()) return "Dos du livre";
      return "Pages " + p + "–" + (p + 1) + " sur " + N();
    }
    if (p === 0) return "Couverture";
    if (p === N() - 1) return "Dos du livre";
    return "Page " + (p + 1) + " sur " + N();
  }
  function updateUI() {
    var p = S.pos, m = maxPos();
    btnPrev.disabled = p <= 0; btnNext.disabled = p >= m;
    cornerPrev.hidden = p <= 0 || (S.mode === "spread" && p >= N()); cornerNext.hidden = p >= m;
    range.max = String(m); range.step = S.mode === "spread" ? "2" : "1"; range.value = String(p);
    where.textContent = label(p);
    var t = Math.min(10, Math.max(3, N() / 18)), prog = m ? p / m : 0;
    $(".book__stack--left", book).style.setProperty("--stack", (S.mode === "spread" && p > 0 ? Math.max(2, t * prog) : 0) + "px");
    $(".book__stack--right", book).style.setProperty("--stack", (p < m ? Math.max(2, t * (1 - prog)) : 0) + "px");
    var chId = S.chapterOfPage[S.mode === "spread" ? Math.min(p, N() - 1) : p] || S.chapterOfPage[p - 1] || null;
    $$(".book__tab", tabsEl).forEach(function (b) { if (b.dataset.id === chId) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current"); });
    if (hint) hint.hidden = p !== 0;
  }

  /* ---------- Tourner les pages ---------- */
  var EASE = "cubic-bezier(0.45, 0.05, 0.35, 1)";
  function goPos(to, done) {
    to = norm(to);
    if (to === S.pos) { if (done) done(); return; }
    if (S.busy) { S.queued = { to: to, done: done }; return; }
    var from = S.pos, fwd = to > from;
    if (!ANIM) { S.pos = to; renderStatic(); if (done) done(); return; }
    S.busy = true;
    var a0, a1, base;
    if (S.mode === "spread") {
      if (fwd) { put(faceF, S.pages[from]); put(faceB, S.pages[to - 1]); put(slotL, S.pages[from - 1] || null); put(slotR, S.pages[to] || null); a0 = 0; a1 = -180; base = slotR; }
      else { put(faceF, S.pages[to]); put(faceB, S.pages[from - 1]); put(slotL, S.pages[to - 1] || null); put(slotR, S.pages[from] || null); a0 = -180; a1 = 0; base = slotL; }
      book.dataset.at = atOf(to);
    } else {
      if (fwd) { put(faceF, S.pages[from]); put(faceB, null); put(slotR, S.pages[to]); a0 = 0; a1 = -118; }
      else { put(faceF, S.pages[to]); put(faceB, null); put(slotR, S.pages[from]); a0 = -118; a1 = 0; }
      base = slotR;
    }
    leaf.hidden = false;
    var dur = 760, anims = [];
    var frames = [{ transform: "rotateY(" + a0 + "deg)" }, { transform: "rotateY(" + a1 + "deg)" }];
    if (S.mode === "single") frames = fwd
      ? [{ transform: "rotateY(0deg)", opacity: 1 }, { transform: "rotateY(-80deg)", opacity: 1, offset: 0.65 }, { transform: "rotateY(-118deg)", opacity: 0 }]
      : [{ transform: "rotateY(-118deg)", opacity: 0 }, { transform: "rotateY(-80deg)", opacity: 1, offset: 0.35 }, { transform: "rotateY(0deg)", opacity: 1 }];
    var opts = { duration: dur, easing: EASE, fill: "both" };
    anims.push(leaf.animate(frames, opts));
    anims.push(faceF.__shade.animate([{ opacity: fwd ? 0 : 0.6 }, { opacity: fwd ? 0.6 : 0 }], opts));
    anims.push(faceB.__shade.animate([{ opacity: fwd ? 0.6 : 0 }, { opacity: fwd ? 0 : 0.6 }], opts));
    anims.push(base.__shade.animate([{ opacity: 0.55 }, { opacity: 0 }], opts));
    var ended = false;
    var finish = function () {
      if (ended) return; ended = true;
      anims.forEach(function (a) { a.cancel(); });
      S.pos = to; S.busy = false;
      renderStatic();
      if (done) done();
      if (S.queued) { var q = S.queued; S.queued = null; goPos(q.to, q.done); }
    };
    Promise.all(anims.map(function (a) { return a.finished; })).catch(function () {}).then(finish);
    setTimeout(finish, dur + 600);   // filet de sécurité : onglet en arrière-plan, animation interrompue…
  }
  function step(d) { goPos(S.pos + d * (S.mode === "spread" ? 2 : 1)); }

  /* ---------- Aller à une règle, un chapitre, le barème ---------- */
  var lectureOn = false;
  function flash(id) {
    var root = lectureOn ? lecture : book;
    var n = root.querySelector('[data-id="' + id + '"]');
    if (!n) return;
    if (lectureOn) n.scrollIntoView({ block: "start" });
    n.classList.remove("is-flash"); void n.offsetWidth; n.classList.add("is-flash");
    setTimeout(function () { n.classList.remove("is-flash"); }, 2300);
  }
  function go(id, o) {
    o = o || {};
    if (!id || !model) return;
    var page = S.pageOf[id];
    if (page == null) return;
    if (o.push && window.history && history.pushState && location.hash !== "#" + id) history.pushState(null, "", "#" + id);
    if (lectureOn) { flash(id); return; }
    goPos(posOfPage(page), function () { flash(id); });
    if (o.scroll !== false) {
      var top = stage.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.6) stage.scrollIntoView({ block: "start" });
    }
  }
  function fromHash() {
    var id = "";
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { id = ""; }
    if (id && S.pageOf[id] != null) go(id, { scroll: true });
  }

  /* ---------- Marque-pages et sommaire ---------- */
  var TAB_COLORS = ["#22d3ff", "#8b5cf6", "#ff3cac"];
  function buildNav() {
    clear(tabsEl);
    var opt0 = tocSel.options[0];
    clear(tocSel); tocSel.appendChild(opt0);
    var items = model.chapters.map(function (c) { return { id: c.id, short: c.n ? String(c.n) : "C", name: (c.label ? c.label + " · " : "") + c.title }; });
    if (model.bareme) items.push({ id: "bareme", short: "B", name: "Barème des sanctions" });
    items.forEach(function (it, i) {
      var b = el("button", "book__tab", it.short); b.type = "button";
      b.dataset.id = it.id; b.title = it.name; b.setAttribute("aria-label", it.name);
      b.style.setProperty("--tab", TAB_COLORS[i % TAB_COLORS.length]);
      b.addEventListener("click", function () { go(it.id, { push: true, scroll: false }); });
      tabsEl.appendChild(b);
      var o = el("option", null, it.name); o.value = it.id; tocSel.appendChild(o);
    });
  }
  tocSel.addEventListener("change", function () { var v = tocSel.value; tocSel.value = ""; if (v) go(v, { push: true }); });

  /* ---------- Lecture en continu (sans le livre) ---------- */
  function buildLecture() {
    clear(lecture);
    var groups = [], cur = null;
    allBlocks().forEach(function (b) {
      if (b.__newPage || !cur) { cur = el("section"); groups.push(cur); }
      cur.appendChild(b);
    });
    groups.forEach(function (g) { lecture.appendChild(g); });
  }
  function setLecture(on, remember) {
    lectureOn = on;
    lecture.hidden = !on; stage.hidden = on; controls.hidden = on;
    if (hint) hint.hidden = on || S.pos !== 0;
    modeBtn.textContent = on ? "Feuilleter le livre" : "Lire en continu";
    modeBtn.setAttribute("aria-pressed", String(on));
    if (on && !lecture.firstChild) buildLecture();
    if (!on && model) relayout(false);   // la fenêtre a pu changer de taille pendant la lecture en continu
    if (remember) { try { localStorage.setItem("sl-reglement-mode", on ? "lecture" : "livre"); } catch (e) { /* stockage indisponible */ } }
  }
  modeBtn.addEventListener("click", function () { setLecture(!lectureOn, true); });

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
    var ts = terms(q), phrase = R.fold(q).replace(/\s+/g, " ").trim(), hits = [], all = [];
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
    return { terms: ts, hits: hits };
  }
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
    if (at === -1) return text.slice(0, 120) + (text.length > 120 ? "…" : "");
    var from = Math.max(0, at - 40), to = Math.min(text.length, at + 100);
    if (from > 0) { var sp = text.indexOf(" ", from); if (sp !== -1 && sp < at) from = sp + 1; }
    if (to < text.length) { var sq = text.lastIndexOf(" ", to); if (sq > at) to = sq; }
    return (from > 0 ? "… " : "") + text.slice(from, to) + (to < text.length ? " …" : "");
  }

  var hitButtons = [], active = -1;
  function closeResults() { results.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; }
  function setActive(i) {
    if (!hitButtons.length) return;
    active = (i + hitButtons.length) % hitButtons.length;
    hitButtons.forEach(function (b, k) { b.classList.toggle("is-active", k === active); });
    hitButtons[active].scrollIntoView({ block: "nearest" });
  }
  function showResults() {
    var q = input.value.replace(/\s+/g, " ").trim();
    clearBtn.hidden = !input.value;
    clear(results); hitButtons = []; active = -1;
    if (!q) { closeResults(); return; }
    var out = search(q), total = out.hits.length;
    results.appendChild(el("p", null, total ? total + (total > 1 ? " résultats" : " résultat") + (total > MAX_RESULTS ? " (les " + MAX_RESULTS + " premiers)" : "") : "Aucune règle ne correspond. Essayez un autre mot, ou un numéro comme 5.12."));
    var ol = el("ol");
    out.hits.slice(0, MAX_RESULTS).forEach(function (h) {
      var r = h.rule, li = el("li"), b = el("button", "hitb"); b.type = "button";
      var top = el("span", "hitb__top");
      if (r.num) top.appendChild(el("span", "hitb__num", r.num));
      top.appendChild(highlight(el("span"), R.typo(r.title), out.terms));
      b.appendChild(top);
      b.appendChild(el("span", "hitb__chap", (r.chapter.label ? r.chapter.label + " · " : "") + r.chapter.title));
      b.appendChild(highlight(el("span", "hitb__snip"), snippet(r, out.terms), out.terms));
      b.addEventListener("click", function () { closeResults(); go(r.id, { push: true }); });
      li.appendChild(b); ol.appendChild(li); hitButtons.push(b);
    });
    results.appendChild(ol);
    results.hidden = false; input.setAttribute("aria-expanded", "true");
  }
  var timer = null;
  input.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(showResults, 140); });
  input.addEventListener("focus", function () { if (input.value.trim()) showResults(); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); if (results.hidden) showResults(); setActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
    else if (e.key === "Escape") { if (!results.hidden) { e.preventDefault(); closeResults(); } else if (input.value) { input.value = ""; showResults(); } }
  });
  $("#livre-search").addEventListener("submit", function (e) {
    e.preventDefault(); clearTimeout(timer); showResults();
    var b = hitButtons[active >= 0 ? active : 0]; if (b) b.click();
  });
  clearBtn.addEventListener("click", function () { input.value = ""; showResults(); input.focus(); });
  document.addEventListener("click", function (e) { if (!results.hidden && !e.target.closest("#livre-search")) closeResults(); });
  document.addEventListener("keydown", function (e) {
    var t = e.target, tag = t && t.tagName, typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable);
    if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); input.focus(); input.select(); return; }
    if (typing || lectureOn || !model || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); step(-1); }
    else if (e.key === "Home") { e.preventDefault(); goPos(0); }
    else if (e.key === "End") { e.preventDefault(); goPos(maxPos()); }
  });

  /* ---------- Copier le lien d'une règle ---------- */
  function copyLink(id, btn) {
    var url = location.origin + location.pathname + "#" + id;
    var head = btn.parentNode, note = $(".lr-copied", head) || el("span", "lr-copied");
    var done = function (ok) { note.textContent = ok ? "Lien copié" : "Copie impossible"; head.appendChild(note); setTimeout(function () { if (note.parentNode) note.parentNode.removeChild(note); }, 1600); };
    var fallback = function () {
      var ta = document.createElement("textarea"); ta.value = url; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta); done(ok);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(function () { done(true); }, fallback);
    else fallback();
  }
  section.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".lr-num");
    if (!b) return;
    var head = b.closest("[data-id]");
    if (head) copyLink(head.dataset.id, b);
  });

  /* ---------- Commandes, coins, glisser du doigt ---------- */
  btnPrev.addEventListener("click", function () { step(-1); });
  btnNext.addEventListener("click", function () { step(1); });
  cornerPrev.addEventListener("click", function () { step(-1); });
  cornerNext.addEventListener("click", function () { step(1); });
  range.addEventListener("input", function () { where.textContent = label(+range.value); });
  range.addEventListener("change", function () { goPos(+range.value); });
  slotR.addEventListener("click", function (e) { if (S.pos === 0 && !e.target.closest("a, button")) step(1); });   // un clic sur la couverture ouvre le livre
  var touch = null;
  body.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse" || e.target.closest("a, button, input")) return;
    touch = { x: e.clientX, y: e.clientY, t: Date.now() };
  });
  body.addEventListener("pointerup", function (e) {
    if (!touch) return;
    var dx = e.clientX - touch.x, dy = e.clientY - touch.y; touch = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) step(dx < 0 ? 1 : -1);
  });
  body.addEventListener("pointercancel", function () { touch = null; });

  /* ---------- Mise en page au démarrage et quand la taille change ---------- */
  function anchorId() {   // premier repère visible, pour retrouver sa place après une nouvelle mise en page
    var p = S.mode === "spread" ? (S.pages[S.pos] || S.pages[S.pos - 1]) : S.pages[S.pos];
    var n = p && p.__content ? $("[data-id]", p.__content) : null;
    return n ? n.dataset.id : null;
  }
  function relayout(force) {
    if (stage.clientWidth < 200) return;
    var m = measure();
    if (!force && m.mode === S.mode && Math.abs(m.pw - S.pw) < 3 && Math.abs(m.ph - S.ph) < 3) return;
    var keep = S.pages.length ? anchorId() : null, wasCover = S.pos === 0, wasEnd = S.pages.length && S.pos >= maxPos();
    S.queued = null;
    applySize(m);
    paginate();
    S.pos = wasCover ? 0 : wasEnd ? maxPos() : keep && S.pageOf[keep] != null ? norm(posOfPage(S.pageOf[keep])) : 0;
    renderStatic();
  }
  var rz = null;
  window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(function () { if (!S.busy && model && !lectureOn) relayout(false); }, 220); });

  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var wait = Promise.all([
      document.fonts.load('400 16px "Crimson Pro"'), document.fonts.load('700 16px "Crimson Pro"'),
      document.fonts.load('italic 400 16px "Crimson Pro"'), document.fonts.load('600 16px "Cinzel"'), document.fonts.load('700 16px "Cinzel"')
    ]).catch(function () {});
    return Promise.race([wait, new Promise(function (r) { setTimeout(r, 3000); })]);
  }

  // Couverture affichée tout de suite, avant même que le règlement soit chargé
  applySize(measure());
  put(slotR, coverPage());
  book.dataset.at = S.mode === "spread" ? "cover" : "open";

  Promise.all([load(), fontsReady()]).then(function (res) {
    model = build(res[0]);
    index();
    var dt = dateText(model.updated);
    if (dt) { var t = $("#livre-updated-time"); t.textContent = dt.text; t.setAttribute("datetime", dt.iso); $("#livre-updated").hidden = false; }
    buildNav();
    relayout(true);
    controls.hidden = false; say("");
    input.disabled = false; tocSel.disabled = false; modeBtn.disabled = false;
    var pref = null; try { pref = localStorage.getItem("sl-reglement-mode"); } catch (e) { pref = null; }
    if (pref === "lecture") setLecture(true, false);
    var q = ""; try { q = new URLSearchParams(location.search).get("q") || ""; } catch (e) { q = ""; }
    if (q) { input.value = q.slice(0, 80); showResults(); }
    fromHash();
    window.addEventListener("hashchange", fromHash);
    window.addEventListener("popstate", fromHash);
  }, function () {
    say("Le règlement est momentanément indisponible. Réessayez dans un instant, ou retrouvez les règles sur notre Discord.");
    statusEl.setAttribute("role", "alert");
  });
})();
