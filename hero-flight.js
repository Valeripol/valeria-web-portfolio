/* ==========================================================================
   VALERYIA — hero "fly-through" banner
   A camera flies forward through floating brand identities and websites.
   Cards fade in from the distance, grow, blur as they pass, and the website
   cards play your real screen recordings. Everything is drawn on one <canvas>
   (2D), so it works when index.html is opened from a folder as well as online.

   To change what flies by, edit the WORKS list below.
   ========================================================================== */
(() => {
  'use strict';

  const stage  = document.getElementById('flightStage');
  const canvas = document.getElementById('flightCanvas');
  if (!stage || !canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) { stage.classList.add('no-canvas'); return; }

  const kindEl  = document.getElementById('flightKind');
  const titleEl = document.getElementById('flightTitle');
  const hintEl  = document.getElementById('flightHint');
  const pauseBtn = document.getElementById('flightPause');

  /* ---------------------------------------------------------------- config */
  const CFG = {
    speed: 437.5,      // camera speed, world units per second
    focal: 1000,       // perspective focal length (world units)
    near: 520,         // a card disappears when it gets this close to the lens
    nearFade: 260,     // ...fading out over this distance
    farFade: 0.20,     // the farthest 20 % of the depth fades in
    spacing: 155.6,    // distance between two neighbouring cards in depth
    drift: [45, 25],   // slow camera sway (x, y), world units
    wobble: 1.6,       // degrees of gentle card sway
    shadow: 0.42,      // card shadow strength
    seed: 11,          // changes the random arrangement of the small cards
    start: 0.05        // where in the loop the animation starts (0..1)
  };

  /* ----------------------------------------------------------------- works
     kind  : 'brand' (image) or 'site' (video; base name without extension)
     hero  : true  → also flies past large, in the order listed here
     project / href : what a click on the card opens (optional)              */
  const WORKS = [
    { id: 'edwards', kind: 'site',  title: 'Edwards Family Meats', video: 'assets/flight/edwards', aspect: 2534 / 1392, hero: true, bg: '#0b1620', project: 'Edwards Family Meats' },
    { id: 'nexora',  kind: 'site',  title: 'Nexora', video: 'assets/flight/nexora', aspect: 2534 / 1388, hero: true, bg: '#17110e', project: 'Nexora' },
    { id: 'core',    kind: 'site',  title: 'Core',  video: 'assets/flight/core',    aspect: 2534 / 1394, hero: true, bg: '#cfe0ee', project: 'Core' },
    { id: 'pomodoro',kind: 'site',  title: 'Pomodoro', video: 'assets/flight/pomodoro', aspect: 2534 / 1390, hero: true, bg: '#1a0e08', project: 'Pomodoro' },
    { id: 'aurelia', kind: 'site',  title: 'Aurelia Honey', video: 'assets/flight/aurelia', aspect: 960 / 530, hero: true, bg: '#caa56a' },
    { id: 'portfolio', kind: 'site', title: 'Design Portfolio', video: 'assets/flight/portfolio', aspect: 2558 / 1394, hero: true, bg: '#111111', href: 'https://valeripol.github.io/design-portfolio/' }
  ];

  /* --------------------------------------------------------------- helpers */
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  // set to matchMedia('(prefers-reduced-motion: reduce)').matches to start paused for visitors who turned animations off
  const reduced = false;
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function roundedRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  const newCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  /* ----------------------------------------------- scene (what is where) */
  const heroes = WORKS.filter(w => w.hero);
  const SLOT = 5;                              // one large "hero" card every 5th slot
  const COUNT = heroes.length * SLOT;
  const SPAN = COUNT * CFG.spacing;            // depth of one full loop
  const LOOP = SPAN / CFG.speed;               // seconds per loop
  const list = [];
  (function buildScene() {
    const rnd = mulberry32(CFG.seed);
    const R = (a, b) => a + (b - a) * rnd();
    const recent = [];
    for (let i = 0; i < COUNT; i++) {
      let w, W, x, y, r;
      if (i % SLOT === 0) {
        const k = i / SLOT;
        w = heroes[k];
        W = w.heroW || (w.kind === 'site' ? 860 : 620);
        x = (k % 2 === 0 ? 1 : -1) * R(170, 260);
        y = (((k >> 1) % 2 === 0) ? 1 : -1) * R(30, 80);
        r = R(-3, 3);
        recent.push(w);
      } else {
        let tries = 0;
        do { w = WORKS[Math.floor(rnd() * WORKS.length)]; } while (recent.slice(-4).includes(w) && ++tries < 12);
        recent.push(w);
        W = w.kind === 'site' ? R(320, 460) : R(200, 320);
        const th = i * 2.39996, rho = R(380, 1750);
        x = rho * Math.cos(th) * 1.3;
        y = rho * Math.sin(th) * 0.75;
        r = R(-14, 14);
      }
      list.push({ w, W, x, y, r, z: i * SPAN / COUNT, ph: R(0, TAU) });
    }
  })();

  /* ------------------------------------------------------------------------
     Every card is pre-drawn as a small "sprite": rounded corners, soft shadow
     and a thin light edge baked in, plus a chain of half-size copies (like
     mip-maps). Per frame a card is then just ONE drawImage — fast everywhere.
     ------------------------------------------------------------------------ */
  const SH_PAD = 0.07, SH_SIGMA = 0.45, SH_DY = 0.35, RADIUS = 0.035, SH_RES = 0.25;
  const shadowCache = new Map();
  const ctxOf = c => c._g || (c._g = c.getContext('2d'));

  // soft shadow for a card of w × h pixels, kept at low resolution (it is blurry anyway)
  function shadowFor(w, h) {
    const key = w + 'x' + h;
    let s = shadowCache.get(key);
    if (s) return s;
    const pad = Math.round(w * SH_PAD), k = SH_RES;
    const c = newCanvas(Math.ceil((w + 2 * pad) * k), Math.ceil((h + 2 * pad) * k)), g = c.getContext('2d');
    const OFF = 4000;
    g.shadowColor = 'rgba(0,0,0,' + CFG.shadow + ')';
    g.shadowBlur = pad * k * SH_SIGMA * 2;
    g.shadowOffsetX = OFF + pad * k;
    g.shadowOffsetY = pad * k + pad * SH_DY * k;
    g.fillStyle = '#000';
    roundedRect(g, -OFF, 0, w * k, h * k, w * RADIUS * k); g.fill();
    s = { c, pad };
    shadowCache.set(key, s);
    return s;
  }

  // Sizes ("levels") of a card sprite are created the first time they are needed.
  function levelCanvas(w, L) {
    return w.levels[L] || (w.levels[L] = newCanvas(Math.max(1, Math.round(w.S0 / (1 << L))), Math.max(1, Math.round(w.S1 / (1 << L)))));
  }
  // Paints one size of a card sprite straight from the picture (image or video frame):
  // shadow underneath, rounded corners, thin light edge on top.
  function bakeFrom(w, L, source) {
    const c = levelCanvas(w, L), g = ctxOf(c), pad = w.pad, r = w.nw * RADIUS;
    g.setTransform(c.width / w.S0, 0, 0, c.height / w.S1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'low';
    g.clearRect(0, 0, w.S0, w.S1);
    g.drawImage(w.shadow.c, 0, 0, w.S0, w.S1);
    g.save();
    roundedRect(g, pad, pad, w.nw, w.nh, r);
    g.clip();
    g.drawImage(source, pad, pad, w.nw, w.nh);
    g.lineWidth = Math.max(1.5, w.nw * 0.0022) * 2;
    g.strokeStyle = 'rgba(190,225,255,.24)';
    g.stroke();
    g.restore();
    g.setTransform(1, 0, 0, 1, 0, 0);
    w.stamp[L] = w.vstamp;
  }
  // a smaller size made from the next bigger one (always a 2x step, so no shimmering)
  function halve(w, L) {
    const c = levelCanvas(w, L), g = ctxOf(c);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = w.kind === 'brand' ? 'high' : 'low';
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(w.levels[L - 1], 0, 0, c.width, c.height);
    w.stamp[L] = w.vstamp;
  }
  // makes sure size L of a card shows the current picture (video frame)
  function ensureLevel(w, L) {
    if (w.stamp[L] === w.vstamp) return;
    if (L === 0 || (L === 1 && w.stamp[0] !== w.vstamp)) bakeFrom(w, L, w.src);
    else { ensureLevel(w, L - 1); halve(w, L); }
  }
  function initWork(w, nw, nh, src) {
    w.src = src; w.nw = nw; w.nh = nh; w.shadow = shadowFor(nw, nh); w.pad = w.shadow.pad;
    w.S0 = nw + 2 * w.pad; w.S1 = nh + 2 * w.pad;
    w.levels = [];
    let n = 1, pw = w.S0;
    while (pw > 40 && n < 7) { pw = Math.round(pw / 2); n++; }
    w.maxL = n - 1;
    w.stamp = new Int32Array(n).fill(-1);
    w.vstamp = 0;
  }

  /* ------------------------------------------------------ media loading */
  const media = document.createElement('div');
  media.className = 'flight-media';
  media.setAttribute('aria-hidden', 'true');
  stage.appendChild(media);

  const videoWorks = [];
  let needGesture = false;

  function loadImage(w) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      initWork(w, img.naturalWidth, img.naturalHeight, img);
      w.ready = true;
      requestRender();
    };
    img.onerror = () => console.warn('Hero image failed:', w.img);
    img.src = w.img;
  }

  function loadVideo(w) {
    const v = document.createElement('video');
    v.muted = v.defaultMuted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.disablePictureInPicture = true;
    v.tabIndex = -1;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.src = `${w.video}.mp4`;
    media.appendChild(v);
    w.el = v; w.dirty = true;
    const ready = () => {
      if (!v.videoWidth) return;
      if (!w.levels) {
        initWork(w, v.videoWidth, v.videoHeight, v);
        w.aspect = v.videoWidth / v.videoHeight;
        if (reduced) { try { v.currentTime = Math.min(2, (v.duration || 4) * 0.3); } catch (e) {} }
      }
      w.ready = true; w.dirty = true; requestRender();
    };
    v.addEventListener('loadeddata', ready);
    v.addEventListener('canplay', ready);
    v.addEventListener('seeked', () => { w.dirty = true; requestRender(); });
    v.addEventListener('error', () => console.warn('Hero video failed:', w.video, v.error));
    if (v.requestVideoFrameCallback) {
      const tick = () => { w.dirty = true; if (!running) requestRender(); v.requestVideoFrameCallback(tick); };
      v.requestVideoFrameCallback(tick);
    }
    videoWorks.push(w);
    v.load();
  }

  for (const w of WORKS) { w.show = 0; (w.kind === 'site' ? loadVideo : loadImage)(w); }

  function syncPlayback() {
    const on = running && visible && !document.hidden;
    for (const w of videoWorks) {
      const v = w.el;
      if (on) {
        if (v.paused) { const p = v.play(); if (p && p.catch) p.catch(() => { needGesture = true; }); }
      } else if (!v.paused) v.pause();
    }
  }
  const unlock = () => { if (needGesture) { needGesture = false; syncPlayback(); } };
  ['pointerdown', 'touchstart', 'keydown', 'scroll'].forEach(ev => addEventListener(ev, unlock, { passive: true }));

  /* ------------------------------------------------------- layout / size */
  let cssW = 0, cssH = 0, dpr = 1, dprCap = 2, unit = 1, fx = 1, fy = 1;
  function resize() {
    const r = stage.getBoundingClientRect();
    cssW = Math.max(1, r.width); cssH = Math.max(1, r.height);
    dpr = Math.min(window.devicePixelRatio || 1, dprCap) * quality;
    const bw = Math.round(cssW * dpr), bh = Math.round(cssH * dpr);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    // card size follows the stage width; on phones the cards get relatively bigger
    const ref = clamp(1100 + (cssW - 450), 1100, 1550);
    unit = cssW / ref;
    // spread the small cards over the whole stage, whatever its proportions
    fx = (cssW / unit / 2) / 960;
    fy = (cssH / unit / 2) / 540;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    requestRender();
  }
  new ResizeObserver(resize).observe(stage);

  /* ------------------------------------------------------------- drawing */
  const scratch = newCanvas(640, 480);
  const sctx = scratch.getContext('2d');
  const drawn = [];
  let t = CFG.start * LOOP, running = !reduced, visible = true, raf = 0, last = 0, ema = 16, slow = 0, frameNo = 0;
  let quality = 1, lite = false, minCard = 8, warm = 0;
  let activeKey = '';

  function render() {
    const W = canvas.width, H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    if (!cssW) return;

    const px = unit * W / cssW;
    const cam = ((t * CFG.speed) % SPAN + SPAN) % SPAN;
    const ph = TAU * t / LOOP;
    const dx = CFG.drift[0] * Math.sin(ph), dy = CFG.drift[1] * Math.sin(2 * ph);

    // 1. project every card
    const items = [];
    for (const w of WORKS) w.used = 0;
    for (const it of list) {
      const w = it.w;
      if (!w.ready) continue;
      const d = ((it.z - cam) % SPAN + SPAN) % SPAN;
      if (d < CFG.near) continue;
      const s = CFG.focal / d;
      const cw = it.W * s * px, ch = cw / w.aspect;
      if (cw < minCard) continue;
      const cx = W / 2 + (it.x * fx - dx) * s * px;
      const cy = H / 2 + (it.y * fy - dy) * s * px;
      const rad = Math.hypot(cw, ch) / 2 * 1.2;
      if (cx + rad < 0 || cx - rad > W || cy + rad < 0 || cy - rad > H) continue;
      let op = 1;
      if (d > SPAN * (1 - CFG.farFade)) op = (SPAN - d) / (SPAN * CFG.farFade);
      if (d < CFG.near + CFG.nearFade) op = Math.min(op, (d - CFG.near) / CFG.nearFade);
      op *= Math.min(1, w.show);
      if (op <= 0.01) continue;
      // depth-of-field: soft in the far distance and right before the lens
      const sigRef = Math.min(3, Math.max(0, (d - 2300) / 1500) * 3) + Math.max(0, (1000 - d) / 400 * 3.5);
      const sigma = sigRef * px;
      const k = sigma >= 0.7 ? Math.max(1.5, sigma * 1.7) : 1;
      // size of the whole sprite (card + shadow padding) on screen
      const dw = cw * w.S0 / w.nw, dh = dw * w.S1 / w.S0;
      const L = clamp(Math.floor(Math.log2(w.S0 / Math.max(1, dw / k))), 0, w.maxL);
      w.used |= 1 << L;
      const ang = (it.r + CFG.wobble * Math.sin(ph + it.ph)) * Math.PI / 180;
      items.push({ it, w, d, cx, cy, cw, ch, dw, dh, op, k, L, ang });
    }
    items.sort((a, b) => b.d - a.d);

    // 2. prepare the sprite sizes that are in use (videos: refresh with the current frame)
    frameNo++;
    if (frameNo % 90 === 0) syncPlayback();            // restart a video the browser paused on its own
    for (const w of WORKS) {
      if (!w.levels || !w.used) continue;
      if (w.el) {
        if (w.el.readyState < 2) continue;
        // the video clock is checked directly, so the picture keeps moving in every browser
        const ct = w.el.currentTime;
        if (w.dirty || Math.abs(ct - (w.lastT || 0)) > (lite ? 0.08 : 0.035)) { w.vstamp++; w.dirty = false; w.lastT = ct; }
      }
      for (let L = 0; L <= w.maxL; L++) if (w.used & (1 << L)) ensureLevel(w, L);
    }

    // 3. paint, farthest first — one drawImage per card
    drawn.length = 0;
    for (const o of items) {
      const w = o.w;
      if (w.stamp[o.L] < 0) continue;                       // not prepared yet
      ctx.save();
      ctx.translate(o.cx, o.cy);
      ctx.rotate(-o.ang);
      ctx.globalAlpha = o.op;
      if (o.k === 1) {
        ctx.drawImage(w.levels[o.L], -o.dw / 2, -o.dh / 2, o.dw, o.dh);
      } else {
        // blurred: draw small, then enlarge (smooth, and works in every browser)
        const sw = Math.max(1, Math.ceil(o.dw / o.k)), sh = Math.max(1, Math.ceil(o.dh / o.k));
        if (sw > scratch.width || sh > scratch.height) {
          scratch.width = Math.max(scratch.width, sw); scratch.height = Math.max(scratch.height, sh);
        }
        sctx.clearRect(0, 0, sw + 1, sh + 1);
        sctx.drawImage(w.levels[o.L], 0, 0, sw, sh);
        ctx.drawImage(scratch, 0, 0, sw, sh, -sw * o.k / 2, -sh * o.k / 2, sw * o.k, sh * o.k);
      }
      ctx.restore();
      drawn.push(o);
    }
    ctx.globalAlpha = 1;

    // fade the pictures in once they are ready
    for (const w of WORKS) if (w.ready && w.show < 1) w.show = Math.min(1, w.show + 0.04);

    updateCaption(items, W, H);
    if (!canvas.classList.contains('is-ready') && drawn.length) canvas.classList.add('is-ready');
  }

  /* ------------------------------------------------------------- caption */
  function updateCaption(items, W, H) {
    if (!titleEl) return;
    let best = null, bestScore = 0;
    for (const o of items) {
      if (o.op < 0.7) continue;
      const off = Math.hypot(o.cx - W / 2, o.cy - H / 2) / Math.hypot(W / 2, H / 2);
      if (off > 0.7) continue;
      const score = o.cw * (1 - off * 0.6);
      if (score > bestScore) { bestScore = score; best = o; }
    }
    if (!best || best.w.id === activeKey) return;
    activeKey = best.w.id;
    const w = best.w;
    if (kindEl) kindEl.textContent = w.kind === 'site' ? 'WEBSITE DESIGN' : 'BRAND IDENTITY';
    titleEl.textContent = w.title.toUpperCase();
    if (hintEl) hintEl.textContent = (w.project || w.href) ? 'CLICK TO WATCH ↗' : '';
  }

  /* --------------------------------------------------------------- loop */
  function loop(now) {
    raf = 0;
    if (!(running && visible && !document.hidden)) return;
    const dt = last ? now - last : 16;
    if (dt < 14) { raf = requestAnimationFrame(loop); return; }   // cap at ~60 fps on fast screens
    last = now;
    t += Math.min(dt, 100) / 1000;
    render();
    // if a device struggles (well below 30 fps), quietly lower the quality step by step
    ema = ema * 0.9 + Math.min(dt, 100) * 0.1;
    if (++warm > 180 && ema > 36) {
      if (++slow > 24 && quality > 0.6) { quality = quality > 0.9 ? 0.8 : 0.6; lite = true; minCard = 14; slow = 0; ema = 16; resize(); }
    } else slow = 0;
    raf = requestAnimationFrame(loop);
  }
  function kick() {
    syncPlayback();
    if (running && visible && !document.hidden) { if (!raf) { last = 0; raf = requestAnimationFrame(loop); } }
    else requestRender();
  }
  let pending = 0;
  function requestRender() {
    if (raf || pending) return;
    pending = requestAnimationFrame(() => { pending = 0; render(); });
  }

  new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting && entries[0].intersectionRatio > 0.05;
    kick();
  }, { threshold: [0, 0.05, 0.3] }).observe(stage);
  document.addEventListener('visibilitychange', kick);

  if (pauseBtn) {
    if (reduced) { pauseBtn.textContent = '▶ PLAY'; pauseBtn.setAttribute('aria-label', 'Play animation'); }
    pauseBtn.addEventListener('click', () => {
      running = !running;
      pauseBtn.textContent = running ? 'Ⅱ PAUSE' : '▶ PLAY';
      pauseBtn.setAttribute('aria-label', running ? 'Pause animation' : 'Play animation');
      kick();
    });
  }

  /* --------------------------------------------------------------- clicks */
  function hit(ev) {
    const r = canvas.getBoundingClientRect();
    const x = (ev.clientX - r.left) * canvas.width / r.width;
    const y = (ev.clientY - r.top) * canvas.height / r.height;
    for (let i = drawn.length - 1; i >= 0; i--) {          // nearest card first
      const o = drawn[i];
      if (o.op < 0.5) continue;
      const dx = x - o.cx, dy = y - o.cy, c = Math.cos(o.ang), s = Math.sin(o.ang);
      const lx = dx * c - dy * s, ly = dx * s + dy * c;    // into the card's own axes
      if (Math.abs(lx) <= o.cw / 2 && Math.abs(ly) <= o.ch / 2) return o.w;
    }
    return null;
  }
  canvas.addEventListener('pointermove', ev => {
    const w = hit(ev);
    canvas.style.cursor = w && (w.project || w.href) ? 'pointer' : '';
  });
  canvas.addEventListener('click', ev => {
    const w = hit(ev);
    if (!w) return;
    if (w.project && typeof window.openProject === 'function') {
      const el = [...document.querySelectorAll('.project[data-video]')].find(p => p.dataset.title === w.project);
      if (el) { window.openProject(el); return; }
    }
    if (w.href) window.open(w.href, '_blank', 'noopener');
  });

  /* ------------------------------------------------- small public helper
     window.heroFlight.seek(seconds) / pause() / play() — handy for testing. */
  window.heroFlight = {
    loop: LOOP,
    seek(sec) { t = sec; requestRender(); },
    pause() { running = false; kick(); },
    play() { running = true; kick(); }
  };

  resize();
  kick();
})();
