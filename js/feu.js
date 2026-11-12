/*
 * Feu d'artifice néon de l'ouverture (page d'accueil).
 * window.SLFeu(dureeMs, force) : lance des fusées pendant dureeMs, puis laisse retomber les étincelles.
 * Par respect pour les visiteurs qui ont demandé moins d'animations, rien ne se passe pour eux,
 * sauf si force vaut true (lien d'essai : https://santoslegacyrp.com/?feu-d-artifice).
 * Une simple toile transparente par-dessus la page, qui ne bloque aucun clic et disparaît à la fin.
 */
(function () {
  "use strict";

  var COLORS = ["#22d3ff", "#8b5cf6", "#ff3cac", "#fbbf24", "#f6d68e", "#34d399", "#ffffff"];
  var running = false;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  window.SLFeu = function (duration, force) {
    if (running) return;
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced && !force) return;
    var canvas = document.createElement("canvas");
    var ctx = canvas.getContext && canvas.getContext("2d");
    if (!ctx) return;
    running = true;

    canvas.className = "feu";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);

    var dpr = Math.min(window.devicePixelRatio || 1, 2), W = 0, H = 0;
    function resize() {
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    var scale = Math.max(0.6, Math.min(1.2, W / 1200));   // bouquets plus petits sur téléphone
    var G_ROCKET = 0.16, G_SPARK = 0.04, TRAIL = 7;
    var rockets = [], sparks = [], flashes = [];
    var start = performance.now(), nextLaunch = start, last = start;

    function launch() {
      var x = rand(W * 0.12, W * 0.88);
      var targetY = rand(H * 0.12, H * 0.40);
      rockets.push({ x: x, y: H + 10, trail: [], vx: rand(-0.8, 0.8), vy: -Math.sqrt(2 * G_ROCKET * (H + 10 - targetY)), color: pick(COLORS) });
    }

    function burst(r) {
      var n = Math.round(rand(60, 90) * scale);
      var second = Math.random() < 0.45 ? pick(COLORS) : r.color;
      var ring = Math.random() < 0.3;   // certains bouquets en anneau bien net
      for (var i = 0; i < n; i++) {
        var a = (Math.PI * 2 * i) / n + rand(-0.05, 0.05);
        var s = (ring ? 5.2 : rand(1.5, 6.2)) * scale;
        sparks.push({
          x: r.x, y: r.y, trail: [],
          vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          life: 1, decay: rand(0.009, 0.016), color: i % 2 ? r.color : second, twinkle: Math.random() < 0.3
        });
      }
      flashes.push({ x: r.x, y: r.y, life: 1, color: r.color });
    }

    // Une traînée lumineuse : un trait large et pâle (le halo), puis un trait fin et vif
    function streak(points, x, y, color, alpha, width) {
      if (!points.length) return;
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
      for (var k = 1; k < points.length; k++) ctx.lineTo(points[k][0], points[k][1]);
      ctx.lineTo(x, y);
      ctx.globalAlpha = alpha * 0.28; ctx.lineWidth = width * 3.2; ctx.stroke();
      ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.stroke();
    }

    function frame(now) {
      var dt = Math.min(2.5, (now - last) / 16.67); last = now;
      var launching = now - start < duration;
      if (launching && now >= nextLaunch) {
        launch();
        if (Math.random() < 0.35) launch();   // parfois deux fusées d'un coup
        nextLaunch = now + rand(280, 650);
      }

      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";

      for (var f = flashes.length - 1; f >= 0; f--) {
        var fl = flashes[f];
        fl.life -= 0.08 * dt;
        if (fl.life <= 0) { flashes.splice(f, 1); continue; }
        var rad = 70 * scale * (1.4 - fl.life);
        var g = ctx.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, rad);
        g.addColorStop(0, fl.color); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = fl.life * 0.45; ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(fl.x, fl.y, rad, 0, Math.PI * 2); ctx.fill();
      }

      for (var i = rockets.length - 1; i >= 0; i--) {
        var r = rockets[i];
        r.trail.push([r.x, r.y]); if (r.trail.length > TRAIL + 3) r.trail.shift();
        r.vy += G_ROCKET * dt; r.x += r.vx * dt; r.y += r.vy * dt;
        streak(r.trail, r.x, r.y, r.color, 0.95, 2.4);
        if (r.vy >= -0.6) { burst(r); rockets.splice(i, 1); }
      }

      for (var j = sparks.length - 1; j >= 0; j--) {
        var p = sparks[j];
        p.trail.push([p.x, p.y]); if (p.trail.length > TRAIL) p.trail.shift();
        p.vx *= Math.pow(0.972, dt); p.vy = p.vy * Math.pow(0.972, dt) + G_SPARK * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.life -= p.decay * dt;
        if (p.life <= 0) { sparks.splice(j, 1); continue; }
        var alpha = p.twinkle ? p.life * (0.55 + 0.45 * Math.sin(now / 45 + j)) : p.life;
        streak(p.trail, p.x, p.y, p.color, Math.max(0, Math.min(1, alpha * 1.15)), 2.2);
      }

      if (launching || rockets.length || sparks.length || flashes.length) {
        requestAnimationFrame(frame);
      } else {
        window.removeEventListener("resize", resize);
        canvas.remove();
        running = false;
      }
    }
    requestAnimationFrame(frame);
  };
})();
