/*
 * Page Équipe : l'organigramme du staff, tel qu'il est dans le panel (mêmes cases, mêmes pôles, mêmes couleurs).
 * Il se met à jour tout seul : on relit le panel à chaque visite (route publique /api/public/team, en lecture seule).
 * Ne s'affichent que les personnes placées dans l'arbre, avec leur nom, leur titre et leur photo Discord ; jamais
 * d'identifiant. Si le panel ne répond pas, la liste d'origine de la page reste affichée.
 */
(function () {
  "use strict";

  var cfg = window.SITE_CONFIG || {};
  var O = window.SLOrg;
  var live = document.getElementById("team-live"), stat = document.getElementById("team-static");
  var chart = document.getElementById("team-chart"), legend = document.getElementById("team-legend"), summary = document.getElementById("team-summary");
  var API = String(cfg.staffApi || "").trim().replace(/\/+$/, "");
  if (!live || !stat || !O || !API) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   // jamais innerHTML : un nom venu du panel n'est jamais interprété
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  var members = [], pole = "";
  function membersOf(key) { return members.filter(function (m) { return m.key === key; }); }
  // Un titre générique (« Admin », « Référent Légal »…) n'est pas répété ; un titre personnalisé (« Fondateur · Développeur ») l'est.
  function isGenericRole(role) { return !role || O.GENERIC_ROLES.indexOf(role) >= 0 || O.KEYS.some(function (k) { return O.ORG[k].label === role; }); }
  function initialBadge(m) {
    var b = el("span", "tcard__avatar", String(m.name || "?").charAt(0).toUpperCase());
    b.setAttribute("aria-hidden", "true");
    return b;
  }

  function card(m) {
    var li = el("li", "tcard");
    var av;
    if (m.photo === true && /^\d{1,12}$/.test(String(m.id))) {
      av = el("img", "tcard__avatar tcard__avatar--photo");
      av.src = API + "/api/public/avatar/" + m.id; av.alt = ""; av.width = 34; av.height = 34; av.loading = "lazy"; av.referrerPolicy = "no-referrer";
      av.setAttribute("aria-hidden", "true");
      av.addEventListener("error", function () { if (av.parentNode) av.parentNode.replaceChild(initialBadge(m), av); });   // photo introuvable : l'initiale
    } else av = initialBadge(m);
    li.appendChild(av);
    var box = el("div", "tcard__body");
    box.appendChild(el("span", "tcard__name", m.name));
    if (!isGenericRole(m.role)) box.appendChild(el("span", "tcard__role", m.role));
    li.appendChild(box);
    return li;
  }

  function node(def) {
    var list = membersOf(def.key);
    var sec = el("section", "tnode tnode--" + def.color);
    sec.setAttribute("data-node", def.key);
    if (def.pole) sec.setAttribute("data-pole", def.pole);
    var head = el("div", "tnode__head");
    head.appendChild(el("span", "tnode__badge", O.RANKS[def.rank]));
    head.appendChild(el("span", "tnode__count", String(list.length)));
    sec.appendChild(head);
    var h = el("h3", "tnode__title", def.title);
    h.id = "team-node-" + def.key;
    sec.setAttribute("aria-labelledby", h.id);
    sec.appendChild(h);
    sec.appendChild(el("p", "tnode__desc", def.desc));
    if (list.length) {
      var ul = el("ul", "tnode__list");
      list.forEach(function (m) { ul.appendChild(card(m)); });
      sec.appendChild(ul);
    } else sec.appendChild(el("p", "tnode__empty", "Personne pour le moment"));
    return sec;
  }

  function link() { var d = el("div", "tree__link"); d.setAttribute("aria-hidden", "true"); return d; }
  function applyPole() {
    Array.prototype.forEach.call(chart.querySelectorAll(".tnode[data-node]"), function (n) {
      n.classList.toggle("tnode--dim", !!pole && n.getAttribute("data-pole") !== pole);
    });
    Array.prototype.forEach.call(legend.querySelectorAll(".polechip"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-pole") === pole)); });
  }

  function buildLegend() {
    clear(legend);
    var intro = el("div", "org__legend-intro");
    intro.appendChild(el("strong", null, "Pôles d'orientation"));
    intro.appendChild(el("span", null, "Les différentes missions et domaines d'action du staff. Cliquez sur un pôle pour mettre ses cases en avant."));
    legend.appendChild(intro);
    var list = el("div", "org__poles");
    O.POLES.forEach(function (p) {
      var b = el("button", "polechip polechip--" + p[2], p[1]);
      b.type = "button";
      b.setAttribute("data-pole", p[0]);
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () { pole = pole === p[0] ? "" : p[0]; applyPole(); });
      list.appendChild(b);
    });
    legend.appendChild(list);
  }

  function render() {
    clear(chart);
    O.ROWS.forEach(function (row, i) {
      if (i) chart.appendChild(link());
      if (row.length === 1) {
        var lvl = el("div", "tree__level");
        lvl.appendChild(node(O.ORG[row[0][0]]));
        chart.appendChild(lvl);
      } else {
        var fan = el("div", "tree__fan tree__fan--" + row.length + (i === O.ROWS.length - 1 ? " tree__fan--end" : ""));
        fan.style.setProperty("--n", String(row.length));
        row.forEach(function (n) { fan.appendChild(node(O.ORG[n[0]])); });
        chart.appendChild(fan);
      }
    });
    buildLegend();
    applyPole();
    summary.textContent = "Hiérarchie, du haut vers le bas : " + O.ROWS.map(function (row) {
      return row.map(function (n) {
        var l = membersOf(n[0]).map(function (m) { return m.name; });
        return O.ORG[n[0]].label + " : " + (l.length ? l.join(", ") : "personne");
      }).join(" ; ");
    }).join(" ; puis ") + ".";
  }

  var ctrl = typeof AbortController === "function" ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 6000) : null;
  fetch(API + "/api/public/team", { signal: ctrl ? ctrl.signal : undefined, headers: { Accept: "application/json" } })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (d) {
      if (timer) clearTimeout(timer);
      var list = (d && Array.isArray(d.members) ? d.members : []).filter(function (m) { return m && typeof m.name === "string" && O.ORG[m.key]; });
      if (!list.length) return;    // rien de placé dans le panel : on garde la liste d'origine
      members = list;
      render();
      live.hidden = false; stat.hidden = true;
    })
    .catch(function () { if (timer) clearTimeout(timer); /* panel injoignable : la liste d'origine reste affichée */ });
})();
