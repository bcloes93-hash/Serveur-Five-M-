/*
 * Affichage du texte d'une règle (partagé par la page Règlement et par l'aperçu du panel staff).
 * Le texte est saisi simplement, une ligne = un paragraphe :
 *   * ou -        puce                          1. 2. 3.    liste numérotée
 *   « …phrase… »  citation                      a → b → c   enchaînement
 *   Interdit · Autorisé · Exemple · Sanctions possibles…  intertitre  ### Titre   encadré (tout ce qui suit y est inclus)
 *   **gras**      mise en valeur                ligne entière en **gras** = phrase mise en avant
 * Rien n'est jamais interprété comme du HTML : le texte est inséré avec createTextNode.
 *
 * Barème des sanctions : le texte d'une « catégorie d'infractions » décrit une infraction par bloc
 * (blocs séparés par une ligne vide, ou reconnus à leurs renvois) :
 *   Titre de l'infraction
 *   🔗 Règle 1.13 — Titre de la règle      renvoi vers une règle (un par ligne, facultatif)
 *   1re fois — Avertissement               étape de sanction : « libellé — sanction »
 *   Une phrase, ou * une puce              remarque sous les étapes
 */
(function (root) {
  "use strict";

  var NBSP = " ";
  // Intertitres reconnus (ligne seule) : style d'affichage. « key » ouvre un encadré.
  var LABELS = { "Interdit": "no", "Exemples interdits": "no", "Autorisé": "yes", "Exemple": "ex", "Exemples": "ex", "Sanctions possibles": "sanc", "Règle essentielle": "key", "Principe fondamental des scènes": "key" };

  // Typographie française : espace insécable avant ; : ! ? » et après «
  function typo(t) {
    return String(t).replace(/ ([;:!?»])/g, NBSP + "$1").replace(/(«) /g, "$1" + NBSP);
  }

  function lines(text) {
    return String(text || "").split("\n").map(function (l) { return l.trim(); }).filter(function (l) { return l; });
  }

  function isEmph(s) { return s.indexOf("**") === 0 && s.length > 4 && s.slice(-2) === "**" && s.split("**").length === 3; }

  // Texte -> blocs : { t: "p" | "ul" | "ol" | "quote" | "flow" | "label" | "emph" | "key", v: … }
  function parse(text) {
    var out = [], m;
    lines(text).forEach(function (s) {
      var last = out[out.length - 1];
      if ((m = /^[*-] (.+)$/.exec(s))) {
        if (last && last.t === "ul") last.v.push(m[1]); else out.push({ t: "ul", v: [m[1]] });
      } else if ((m = /^\d+\. (.+)$/.exec(s))) {
        if (last && last.t === "ol") last.v.push(m[1]); else out.push({ t: "ol", v: [m[1]] });
      } else if (Object.prototype.hasOwnProperty.call(LABELS, s)) {
        out.push({ t: "label", v: s, kind: LABELS[s] });
      } else if ((m = /^### (.+)$/.exec(s))) {
        out.push({ t: "key", v: m[1] });
      } else if (isEmph(s)) {
        out.push({ t: "emph", v: s.slice(2, -2).trim() });
      } else if (s.charAt(0) === "«" && s.slice(-1) === "»") {
        out.push({ t: "quote", v: s });
      } else if (s.indexOf(" → ") !== -1) {
        out.push({ t: "flow", v: s.split("→").map(function (x) { return x.trim(); }) });
      } else {
        out.push({ t: "p", v: s });
      }
    });
    return out;
  }

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // **gras** et renvois « Chapitre N » (liens si opts.chapterHref(n) donne une adresse).
  function inline(parent, text, opts) {
    var chapterHref = opts && opts.chapterHref;
    String(typo(text)).split(/(\*\*.+?\*\*)/).forEach(function (part) {
      if (!part) return;
      var holder = parent;
      if (/^\*\*.+\*\*$/.test(part)) { holder = node("strong"); parent.appendChild(holder); part = part.slice(2, -2); }
      var pos = 0, re = /Chapitre (\d+)/g, m;
      while ((m = re.exec(part))) {
        var href = chapterHref ? chapterHref(m[1]) : null;
        if (!href) continue;
        if (m.index > pos) holder.appendChild(document.createTextNode(part.slice(pos, m.index)));
        var a = node("a", null, m[0]); a.setAttribute("href", href);
        holder.appendChild(a);
        pos = m.index + m[0].length;
      }
      if (pos < part.length) holder.appendChild(document.createTextNode(part.slice(pos)));
    });
    return parent;
  }

  function blocks(list, into, opts) {
    for (var k = 0; k < list.length; k++) {
      var b = list[k], el;
      if (b.t === "key" || (b.t === "label" && b.kind === "key")) {
        // Encadré : l'intertitre puis tout le reste de l'article
        var box = node("div", "rule__callout");
        box.appendChild(inline(node("p", "rule__label rule__label--key"), b.v, opts));
        blocks(list.slice(k + 1), box, opts);
        into.appendChild(box);
        return;
      }
      if (b.t === "label") el = inline(node("p", "rule__label rule__label--" + b.kind), b.v, opts);
      else if (b.t === "p") el = inline(node("p"), b.v, opts);
      else if (b.t === "emph") el = inline(node("p", "rule__emph"), b.v, opts);
      else if (b.t === "quote") el = inline(node("blockquote"), b.v, opts);
      else if (b.t === "flow") {
        el = node("p", "rule__flow");
        b.v.forEach(function (step, i) {
          if (i) { var arrow = node("span", "flow__arrow", " → "); arrow.setAttribute("aria-hidden", "true"); el.appendChild(arrow); }
          el.appendChild(inline(node("span", "flow__step"), step, opts));
        });
      } else {
        el = node(b.t);
        b.v.forEach(function (item) { el.appendChild(inline(node("li"), item, opts)); });
      }
      into.appendChild(el);
    }
  }

  // Texte -> éléments du DOM (dans `into` s'il est fourni, sinon dans un fragment)
  function render(text, into, opts) {
    var target = into || document.createDocumentFragment();
    blocks(parse(text), target, opts);
    return target;
  }

  // Texte brut (recherche, extraits) : sans symboles de mise en forme, sans accents si `fold`
  function plain(text) {
    return lines(text).map(function (s) { return s.replace(/^(?:[*-] |\d+\. |### )/, "").replace(/\*\*/g, ""); }).join(" ");
  }
  function fold(t) {
    var s = String(t).toLowerCase();
    return (s.normalize ? s.normalize("NFD").replace(/[̀-ͯ]/g, "") : s).replace(/ /g, " ").replace(/[’‘]/g, "'");
  }

  /* ---------- Barème : catégories d'infractions ---------- */
  var LINK = "\uD83D\uDD17";   // 🔗
  var REF_RE = new RegExp("^(?:" + LINK + "\\s*)?Règles?\\s+\\d+\\.\\d+");
  var STEP_RE = /^(.{1,45}?)\s+[—–]\s+(.+)$/;
  function isRef(s) { return s.indexOf(LINK) === 0 || REF_RE.test(s); }
  function isBullet(s) { return /^[*-] /.test(s); }

  // Texte d'une catégorie -> { lead: [lignes], items: [{ title, refs: [texte], steps: [{ label, value }], notes: [lignes] }] }
  function parseInfractions(text) {
    var raw = String(text || "").split("\n").map(function (l) { return l.trim(); });
    var lead = [], items = [], cur = null, blank = true;
    function nextLine(i) { for (var k = i + 1; k < raw.length; k++) if (raw[k]) return raw[k]; return ""; }
    function isStep(s) { return !isRef(s) && !isBullet(s) && STEP_RE.test(s); }
    raw.forEach(function (s, i) {
      if (!s) { blank = true; return; }
      var ref = isRef(s), step = isStep(s), bullet = isBullet(s);
      if (ref) {
        if (!cur) { cur = { title: "", refs: [], steps: [], notes: [] }; items.push(cur); }
        cur.refs.push(s.indexOf(LINK) === 0 ? s.slice(LINK.length).trim() : s);
      } else if (step) {
        if (!cur) { cur = { title: "", refs: [], steps: [], notes: [] }; items.push(cur); }
        var m = STEP_RE.exec(s);
        cur.steps.push({ label: m[1].trim(), value: m[2].trim() });
      } else if (bullet) {
        (cur ? cur.notes : lead).push(s);
      } else {
        var nxt = nextLine(i);
        // Une ligne qui précède un renvoi (ou, après une ligne vide, une étape) ouvre une nouvelle infraction ; sinon c'est une remarque
        var opens = isRef(nxt) || (blank && isStep(nxt));
        if (opens) { cur = { title: s, refs: [], steps: [], notes: [] }; items.push(cur); }
        else (cur ? cur.notes : lead).push(s);
      }
      blank = false;
    });
    return { lead: lead, items: items };
  }

  // Gravité (0 à 4) d'une sanction, pour la couleur de la pastille — simple repère visuel, déduit des mots employés
  function severity(value) {
    var t = fold(value);
    if (/definitif|permanent/.test(t)) return 4;
    if (/retrait (de la )?(whitelist|wl)|exclusion|reevaluation|prolongation|ban (7|14)|ban \d+ a (7|14)|14 jours|suspension de l'organisation/.test(t)) return 3;
    if (/ban|suspension|retrait|restriction|sanctions? (du groupe|individuelle|organisation)/.test(t)) return 2;
    if (/avertissement|warn|expulsion|rappel|restitution|annulation|suppression|sanction|surveillance/.test(t)) return 1;
    return 0;
  }

  // « Règles 8.52 à 8.56 — Titre » : chaque numéro devient un lien si opts.ruleHref(numéro) donne une adresse (sinon, avec opts.ruleHref, il est signalé comme introuvable)
  function refLine(parent, text, opts) {
    var cut = /\s[—–]\s/.exec(text), head = cut ? text.slice(0, cut.index) : text, tail = cut ? text.slice(cut.index) : "";
    var ruleHref = opts && opts.ruleHref;
    head.split(/(\d+\.\d+)/).forEach(function (part) {
      if (!part) return;
      if (/^\d+\.\d+$/.test(part) && ruleHref) {
        var href = ruleHref(part);
        if (href) { var a = node("a", "inf__link", part); a.setAttribute("href", href); parent.appendChild(a); }
        else { var b = node("span", "inf__link inf__link--broken", part); b.setAttribute("title", "Cette règle n'existe pas ou n'est pas publiée"); parent.appendChild(b); }
      } else parent.appendChild(document.createTextNode(part));
    });
    if (tail) parent.appendChild(document.createTextNode(typo(tail)));
    return parent;
  }

  // Cartes d'infractions : titre, renvois vers les règles, progression des sanctions, remarques. opts.idPrefix : identifiants « <préfixe>-1 », « <préfixe>-2 »…
  function renderInfractions(text, into, opts) {
    opts = opts || {};
    var parsed = parseInfractions(text);
    var target = into || document.createDocumentFragment();
    if (parsed.lead.length) { var lead = node("div", "inf__lead"); render(parsed.lead.join("\n"), lead, opts); target.appendChild(lead); }
    var grid = node("div", "infs");
    parsed.items.forEach(function (it, i) {
      var top = 0;
      it.steps.forEach(function (st) { st.sev = severity(st.value); if (st.sev > top) top = st.sev; });
      var card = node("article", "inf inf--s" + top);
      if (opts.idPrefix) card.id = opts.idPrefix + "-" + (i + 1);
      if (it.title) card.appendChild(node("h4", "inf__title", typo(it.title)));
      if (it.refs.length) {
        var refs = node("ul", "inf__refs");
        it.refs.forEach(function (r) { refs.appendChild(refLine(node("li"), r, opts)); });
        card.appendChild(refs);
      }
      if (it.steps.length) {
        var steps = node("ol", "inf__steps");
        it.steps.forEach(function (st) {
          var li = node("li", "inf__step" + (st.label.length > 12 ? " inf__step--long" : ""));   // libellé long : au-dessus de la sanction
          li.appendChild(node("span", "inf__n", typo(st.label)));
          li.appendChild(inline(node("span", "inf__v inf__v--s" + st.sev), st.value, opts));
          steps.appendChild(li);
        });
        card.appendChild(steps);
      }
      if (it.notes.length) { var note = node("div", "inf__note"); render(it.notes.join("\n"), note, opts); card.appendChild(note); }
      grid.appendChild(card);
    });
    target.appendChild(grid);
    return target;
  }

  // Texte brut d'une infraction (recherche)
  function infractionText(it) {
    return [it.title].concat(it.refs, it.steps.map(function (st) { return st.label + " " + st.value; }), it.notes.map(function (l) { return plain(l); })).join(" ");
  }

  root.SLRules = { LABELS: LABELS, parse: parse, render: render, inline: inline, plain: plain, fold: fold, typo: typo, parseInfractions: parseInfractions, renderInfractions: renderInfractions, infractionText: infractionText, severity: severity, refLine: refLine };
})(window);
