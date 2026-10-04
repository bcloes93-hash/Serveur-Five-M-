/*
 * Affichage du texte d'une règle (partagé par la page Règlement et par l'aperçu du panel staff).
 * Le texte est saisi simplement, une ligne = un paragraphe :
 *   * ou -        puce                          1. 2. 3.    liste numérotée
 *   « …phrase… »  citation                      a → b → c   enchaînement
 *   Interdit · Autorisé · Exemple…  intertitre  ### Titre   encadré (tout ce qui suit y est inclus)
 *   **gras**      mise en valeur                ligne entière en **gras** = phrase mise en avant
 * Rien n'est jamais interprété comme du HTML : le texte est inséré avec createTextNode.
 */
(function (root) {
  "use strict";

  var NBSP = " ";
  // Intertitres reconnus (ligne seule) : style d'affichage. « key » ouvre un encadré.
  var LABELS = { "Interdit": "no", "Exemples interdits": "no", "Autorisé": "yes", "Exemple": "ex", "Exemples": "ex", "Règle essentielle": "key", "Principe fondamental des scènes": "key" };

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

  root.SLRules = { LABELS: LABELS, parse: parse, render: render, inline: inline, plain: plain, fold: fold, typo: typo };
})(window);
