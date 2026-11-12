/*
 * Galerie de la page « Le serveur » : un clic sur une image l'ouvre en grand dans une fenêtre
 * (élément <dialog>), avec image précédente / suivante (boutons, flèches du clavier, glissement du doigt).
 * Sans JavaScript, ou si <dialog> n'existe pas, chaque image reste un simple lien vers sa version grande.
 */
(function () {
  "use strict";

  var dlg = document.getElementById("lightbox");
  var links = Array.prototype.slice.call(document.querySelectorAll("[data-gallery-item]"));
  if (!dlg || !links.length || typeof dlg.showModal !== "function") return;

  var img = dlg.querySelector(".lightbox__img");
  var cap = dlg.querySelector(".lightbox__caption");
  var current = 0;

  function show(i) {
    current = (i + links.length) % links.length;
    var a = links[current];
    var thumb = a.querySelector("img");
    img.src = a.getAttribute("href");
    img.alt = thumb ? thumb.alt : "";
    cap.textContent = (thumb ? thumb.alt : "") + " · " + (current + 1) + " / " + links.length;
    // Charge d'avance l'image suivante pour un passage sans attente
    var next = new Image();
    next.src = links[(current + 1) % links.length].getAttribute("href");
  }

  links.forEach(function (a, i) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      show(i);
      dlg.showModal();
    });
  });

  dlg.addEventListener("click", function (e) {
    var action = e.target.closest("[data-lb]");
    if (action) {
      var what = action.getAttribute("data-lb");
      if (what === "close") dlg.close();
      else show(current + (what === "next" ? 1 : -1));
      return;
    }
    if (e.target === dlg) dlg.close();   // clic sur le fond sombre
  });

  dlg.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight") { e.preventDefault(); show(current + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); show(current - 1); }
  });

  // Glissement du doigt sur téléphone
  var startX = null;
  dlg.addEventListener("touchstart", function (e) { startX = e.touches[0].clientX; }, { passive: true });
  dlg.addEventListener("touchend", function (e) {
    if (startX === null) return;
    var dx = e.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(dx) > 50) show(current + (dx < 0 ? 1 : -1));
  });

  // Rend le focus à l'image d'origine à la fermeture
  dlg.addEventListener("close", function () {
    img.removeAttribute("src");
    if (links[current]) links[current].focus();
  });
})();
