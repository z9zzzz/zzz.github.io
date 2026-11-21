/* ════════════════════════════════════════════════════════════════
   gifts-float.js — Floating Glass Gifts (Telegram-style), vanilla JS
   ----------------------------------------------------------------
   Modules (in this file, top → bottom):
     1. CONFIG                 ← change VISIBLE_GIFTS_COUNT here
     2. AudioTap + Music       shared Web Audio analysis (one engine)
     3. Gift loader            manifest + Lottie JSON + dominant colour
     4. Theme manager          9 themes, 1.2 s cross-fade, fox pattern
     5. Bubble                 DOM (glass, symbols, sparkles) + jelly state
     6. Engine                 rAF loop: orbit, springs, separation, drag
   Load this file BEFORE src/app.js and Music/music-player.js so the
   audio tap can see the player's AudioContext.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__gfLoaded) return;
  window.__gfLoaded = true;

  /* ═══════════════ 1. CONFIG ═══════════════ */

  /** How many gift bubbles are visible at once (2, 3, 4, 5, 6, …). */
  const VISIBLE_GIFTS_COUNT = 6;

  const CONFIG = Object.assign({
    VISIBLE_GIFTS_COUNT: VISIBLE_GIFTS_COUNT,
    MANIFEST_URL: 'GiftsJson/gifts-manifest.json',
    AVATAR_SELECTOR: '.main .image',
    HEADER_SELECTOR: '.header',
    PREVIEW_SELECTOR: '.tgme_gift_preview',
    BASE_SCALE: 0.44,         // bubble diameter as a fraction of the avatar diameter (mid depth)
    DEPTH_SCALE: 0.14,        // +/- size change between the far side and the near side of the orbit
    GRAB_SCALE: 1.25,         // grabbed bubble diameter = avatar diameter x this (video: ~1.22)
    ORBIT_RX: 2.1,            // orbit half-width  (x avatar radius)
    ORBIT_RY: 1.0,            // orbit half-height (x avatar radius)  -> tilted, seen from above
    ORBIT_TILT_DEG: -10,      // in-plane tilt of the orbit
    THEMES_ENABLED: false,    // false = keep the original black header (default)
    THEME_START_INDEX: 0,     // 0 = Purple
    THEME_DURATION_MS: 1200,
    GLASS_BACKDROP: false,    // backdrop-filter refraction: pretty but HEAVY (off by default)
    ORBIT_SPEED: 0.26,        // rad/s – clockwise revolution (~24 s per lap)
    LOTTIE_FPS: 24,           // fps of resting bubbles (grabbed one runs 60). Lower = lighter
    MUSIC_REACTIVE: true,
    OPEN_LINK_ON_TAP: false,  // tap (no drag) on a bubble opens gift.link
    SYMBOLS: null,            // optional array of image URLs for the inner symbols
    SYMBOL_RESOLVER: null     // optional fn(gift) -> image URL (map gifts to motifs)
  }, window.GIFTS_FLOAT_CONFIG || {});

  const DESIGN = 150;                       // CSS design size of .gf-bubble
  const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MOTION = REDUCED ? 0.3 : 1;
  const TAU = Math.PI * 2;

  const $ = (s, r) => (r || document).querySelector(s);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const lerp = (a, b, t) => a + (b - a) * t;
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  /* ═══════════════ 2. AUDIO: tap + shared analysis ═══════════════ */

  /* We never create a MediaElementSource ourselves (an element can only have
     one, and doing it first would break the existing player). Instead we wrap
     the AudioContext factory methods so that whatever the player creates is
     also observed by an extra, silent AnalyserNode. */
  const Music = {
    v: { bass: 0, mid: 0, high: 0, level: 0, kick: 0, active: false },
    sources: [],
    _inside: false,
    _peak: { b: 0.2, m: 0.2, h: 0.2 },
    _avgBass: 0, _prevBass: 0, _lastKick: 0,
    _zeroFrames: 0, _warned: false, _warnedNoTap: false,
    _media: new Set(),

    install() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC && AC.prototype) {
        const P = AC.prototype;
        const origSrc = P.createMediaElementSource;
        if (origSrc) {
          P.createMediaElementSource = function (el) {
            const node = origSrc.apply(this, arguments);
            try { Music._tapNode(this, node, el); } catch (e) { console.warn('[gifts] tap failed', e); }
            return node;
          };
        }
        const origAn = P.createAnalyser;
        if (origAn) {
          P.createAnalyser = function () {
            const an = origAn.apply(this, arguments);
            if (!Music._inside) Music._addAnalyser(an, null, false);
            return an;
          };
        }
      }
      if (window.HTMLMediaElement) {
        const origPlay = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
          Music._media.add(this);
          Music._resumeAll();
          return origPlay.apply(this, arguments);
        };
      }
      ['pointerdown', 'keydown', 'touchend'].forEach((ev) =>
        window.addEventListener(ev, () => Music._resumeAll(), { passive: true, capture: true }));
    },

    _tapNode(ctx, node, el) {
      Music._inside = true;
      try {
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        an.smoothingTimeConstant = 0.55;
        node.connect(an);
        // some Safari versions only pull analysers that reach the destination
        const mute = ctx.createGain();
        mute.gain.value = 0;
        an.connect(mute);
        mute.connect(ctx.destination);
        Music._addAnalyser(an, el, true);
      } finally { Music._inside = false; }
    },

    _addAnalyser(an, el, own) {
      if (Music.sources.length > 10) return;
      Music.sources.push({
        an, el, own,
        freq: new Uint8Array(an.frequencyBinCount),
        time: new Uint8Array(an.fftSize)
      });
    },

    /** Public: let the player hand over its own AnalyserNode. */
    attachAnalyser(an, el) { Music._addAnalyser(an, el || null, false); },

    /** Public: tap an <audio> element the player has NOT routed through Web Audio.
        Only call this if the file is same-origin / CORS-enabled, otherwise
        the element goes silent. */
    attachAudioElement(el) {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      const node = ctx.createMediaElementSource(el);
      node.connect(ctx.destination);       // keep audible
      ctx.resume && ctx.resume();
    },

    _resumeAll() {
      Music.sources.forEach((s) => {
        const c = s.an.context;
        if (c && c.state === 'suspended' && c.resume) c.resume().catch(() => {});
      });
    },

    _elPlaying(el) { return el && !el.paused && !el.ended && el.readyState > 1; },

    update(dt, now) {
      const V = Music.v;
      if (!CONFIG.MUSIC_REACTIVE || REDUCED) { V.active = false; return; }
      let b = 0, m = 0, h = 0, lv = 0, any = false, playingEl = false;

      for (const s of Music.sources) {
        const ctx = s.an.context;
        if (s.el) {
          if (!Music._elPlaying(s.el)) continue;
          playingEl = true;
        }
        if (!ctx || ctx.state !== 'running') continue;
        s.an.getByteFrequencyData(s.freq);
        s.an.getByteTimeDomainData(s.time);
        const hz = ctx.sampleRate / s.an.fftSize;
        const n = s.freq.length;
        const band = (lo, hi) => {
          const i0 = Math.max(1, Math.floor(lo / hz));
          const i1 = Math.min(n - 1, Math.ceil(hi / hz));
          let sum = 0;
          for (let i = i0; i <= i1; i++) sum += s.freq[i];
          return sum / ((i1 - i0 + 1) * 255);
        };
        const bb = band(30, 150), mm = band(250, 2000), hh = band(4000, 12000);
        let rms = 0;
        for (let i = 0; i < s.time.length; i++) { const x = (s.time[i] - 128) / 128; rms += x * x; }
        rms = Math.sqrt(rms / s.time.length);
        if (bb + mm + hh + rms > 0.002) any = true;
        b = Math.max(b, bb); m = Math.max(m, mm); h = Math.max(h, hh); lv = Math.max(lv, rms);
      }

      // adaptive normalisation per band
      const P = Music._peak;
      P.b = Math.max(P.b * 0.9995, b, 0.2);
      P.m = Math.max(P.m * 0.9995, m, 0.15);
      P.h = Math.max(P.h * 0.9995, h, 0.1);
      const nb = any ? clamp(b / P.b, 0, 1) : 0;
      const nm = any ? clamp(m / P.m, 0, 1) : 0;
      const nh = any ? clamp(h / P.h, 0, 1) : 0;
      const nl = any ? clamp(lv * 3.2, 0, 1) : 0;

      const k = (cur, tgt) => cur + (tgt - cur) * (1 - Math.exp(-dt * (tgt > cur ? 26 : 5)));
      V.bass = k(V.bass, nb); V.mid = k(V.mid, nm); V.high = k(V.high, nh); V.level = k(V.level, nl);

      // beat (bass flux)
      Music._avgBass = lerp(Music._avgBass, nb, 1 - Math.exp(-dt * 1.4));
      if (nb > Music._avgBass * 1.22 + 0.06 && nb - Music._prevBass > 0.02 && now - Music._lastKick > 140) {
        V.kick = 1; Music._lastKick = now;
      }
      Music._prevBass = nb;
      V.kick *= Math.exp(-dt * 9);
      V.active = V.level > 0.02;

      // honest diagnostics: playing but analyser is silent (CORS-tainted element?)
      if (playingEl && !any) {
        if (++Music._zeroFrames > 240 && !Music._warned) {
          Music._warned = true;
          console.warn('[gifts] Audio is playing but the analyser returns silence. ' +
            'The audio file is probably cross-origin without CORS headers; use a same-origin file ' +
            '(or crossorigin="anonymous" + CORS) for music-reactive bubbles.');
        }
      } else Music._zeroFrames = 0;

      if (!Music.sources.length && !Music._warnedNoTap) {
        for (const el of Music._media) {
          if (Music._elPlaying(el) && el.currentTime > 2) {
            Music._warnedNoTap = true;
            console.warn('[gifts] Music is playing but no Web Audio graph was found. ' +
              'If your player does not use an AudioContext, call GiftsFloat.attachAnalyser(analyserNode) ' +
              'or GiftsFloat.attachAudioElement(audioEl) (same-origin audio only).');
          }
        }
      }
    }
  };
  if (CONFIG.MUSIC_REACTIVE) Music.install();

  /* ═══════════════ 3. GIFT LOADER ═══════════════ */

  function fetchJSON(url) {
    return fetch(url, { cache: 'force-cache' }).then((r) => {
      if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
      return r.json();
    });
  }

  /** Reads fill / stroke / gradient colours straight from the Lottie JSON. */
  function dominantColor(data) {
    let sr = 0, sg = 0, sb = 0, sw = 0, n = 0;
    const push = (r, g, b) => {
      if (!(r >= 0 && g >= 0 && b >= 0)) return;
      if (r > 1 || g > 1 || b > 1) { r /= 255; g /= 255; b /= 255; }
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      const lum = (r + g + b) / 3;
      const w = Math.pow(sat, 1.6) * (lum > 0.08 && lum < 0.97 ? 1 : 0.15) + 0.01;
      sr += r * w; sg += g * w; sb += b * w; sw += w; n++;
    };
    const readC = (c) => {
      const k = c && c.k;
      if (!Array.isArray(k)) return;
      if (typeof k[0] === 'number') push(k[0], k[1], k[2]);
      else k.forEach((kf) => { const s = kf && kf.s; if (s && typeof s[0] === 'number') push(s[0], s[1], s[2]); });
    };
    const SKIP = { ks: 1, v: 1, i: 1, o: 1, t: 1 };
    const walk = (o, d) => {
      if (!o || typeof o !== 'object' || d > 40) return;
      if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) walk(o[i], d + 1); return; }
      if ((o.ty === 'fl' || o.ty === 'st') && o.c) readC(o.c);
      if (o.ty === 'gf' && o.g && o.g.k) {
        let arr = o.g.k.k;
        if (Array.isArray(arr) && arr[0] && arr[0].s) arr = arr[0].s;
        if (Array.isArray(arr) && typeof arr[0] === 'number') {
          const p = o.g.p | 0;
          for (let i = 0; i < p; i++) push(arr[i * 4 + 1], arr[i * 4 + 2], arr[i * 4 + 3]);
        }
      }
      for (const key in o) if (!SKIP[key]) walk(o[key], d + 1);
    };
    try { walk(data.layers, 0); walk(data.assets, 0); } catch (e) { /* ignore */ }
    if (!n || sw <= 0) return [170, 185, 220];
    let r = (sr / sw) * 255, g = (sg / sw) * 255, b = (sb / sw) * 255;
    const m = Math.max(r, g, b, 1);
    if (m < 170) { const f = 170 / m; r *= f; g *= f; b *= f; }
    return [Math.round(clamp(r, 0, 255)), Math.round(clamp(g, 0, 255)), Math.round(clamp(b, 0, 255))];
  }

  /** Loads N distinct, working gifts from the manifest (replaces broken ones). */
  async function pickGifts(manifest, count) {
    const seen = new Set();
    const pool = shuffle(manifest.filter((g) => {
      if (!g || !g.json) return false;
      const key = g.id != null ? 'i' + g.id : g.json;
      if (seen.has(key) || seen.has(g.json)) return false;
      seen.add(key); seen.add(g.json);
      return true;
    }));
    const out = [];
    let idx = 0;
    async function worker() {
      while (out.length < count && idx < pool.length) {
        const g = pool[idx++];
        try {
          const data = await fetchJSON(g.json);
          if (!data || !data.layers) throw new Error('not a Lottie file');
          if (out.length < count) out.push({ gift: g, data });
        } catch (e) { console.warn('[gifts] skipped', g.json, e.message || e); }
      }
    }
    await Promise.all(Array.from({ length: Math.min(count, pool.length) }, worker));
    return out.slice(0, count);
  }

  function waitForLottie(ms) {
    return new Promise((res, rej) => {
      const t0 = performance.now();
      (function poll() {
        if (window.lottie && window.lottie.loadAnimation) return res(window.lottie);
        if (performance.now() - t0 > ms) return rej(new Error('lottie not found'));
        setTimeout(poll, 50);
      })();
    });
  }

  function symbolList() {
    if (Array.isArray(CONFIG.SYMBOLS) && CONFIG.SYMBOLS.length) return CONFIG.SYMBOLS;
    try { if (typeof symbols !== 'undefined' && Array.isArray(symbols) && symbols.length) return symbols; } catch (e) { /* none */ }
    const p = $('#giftPattern');
    const href = p && (p.getAttribute('href') || p.getAttribute('xlink:href'));
    return href ? [href] : [];
  }

  const FALLBACK_SYMBOL = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 1l2.6 8.4L23 12l-8.4 2.6L12 23l-2.6-8.4L1 12l8.4-2.6z"/></svg>');

  /* Symbols are baked ONCE into white silhouettes (canvas) so no CSS filter runs per frame. */
  const _sil = {};
  function silhouette(url) {
    if (_sil[url]) return _sil[url];
    return (_sil[url] = new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas'); c.width = c.height = 64;
          const g = c.getContext('2d');
          const r = Math.min(64 / img.naturalWidth, 64 / img.naturalHeight);
          const w = img.naturalWidth * r, h = img.naturalHeight * r;
          g.drawImage(img, (64 - w) / 2, (64 - h) / 2, w, h);
          g.globalCompositeOperation = 'source-in';
          g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
          res(c.toDataURL());
        } catch (e) { res(url); }
      };
      img.onerror = () => res(FALLBACK_SYMBOL);
      img.src = url;
    }));
  }

  /* ═══════════════ 4. THEMES ═══════════════ */

  const THEMES = [
    { name: 'Purple',     top: '#B550D8', bottom: '#7A34CC', neon: false },
    { name: 'Deep Blue',  top: '#1F5577', bottom: '#0F2C44', neon: true },
    { name: 'Teal',       top: '#1E7A6C', bottom: '#0D4840', neon: true },
    { name: 'Emerald',    top: '#1F7D40', bottom: '#0C4A24', neon: true },
    { name: 'Amber Gold', top: '#A0700F', bottom: '#553A06', neon: true },
    { name: 'Charcoal',   top: '#3B3B3D', bottom: '#161618', neon: true },
    { name: 'Magenta',    top: '#93205A', bottom: '#4D0C2D', neon: true },
    { name: 'Royal Blue', top: '#2C52A8', bottom: '#142A62', neon: true },
    { name: 'Violet',     top: '#6E3CCB', bottom: '#482096', neon: false }
  ];

  /* Fox head, 26px, staggered 56px grid, 30 % black. No image download. */
  const FOX = '<path fill-rule="evenodd" d="M1.5 2L8.5 7Q13 6 17.5 7L24.5 2Q25.5 9 23.5 14Q21 20 13 24.5Q5 20 2.5 14Q.5 9 1.5 2Z' +
    'M8.5 11.7a1.3 1.3 0 1 0 .01 0ZM17.5 11.7a1.3 1.3 0 1 0 .01 0ZM13 19.4a1.6 1.6 0 1 0 .01 0Z"/>';
  const FOX_TILE = 'url("data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="112" viewBox="0 0 56 112"><g fill="#000" fill-opacity=".30">' +
    '<g transform="translate(15 15)">' + FOX + '</g>' +
    '<g transform="translate(-13 71)">' + FOX + '</g>' +
    '<g transform="translate(43 71)">' + FOX + '</g></g></svg>') + '")';

  const Theme = {
    idx: 0, box: null, glow: 0.5, preview: null, avatar: null,

    init(preview, avatar) {
      Theme.preview = preview; Theme.avatar = avatar;
      Theme.box = document.createElement('div');
      Theme.box.className = 'gf-theme';
      Theme.box.style.setProperty('--gf-theme-ms', CONFIG.THEME_DURATION_MS + 'ms');
      preview.appendChild(Theme.box);
      document.body.classList.add('gf-themed');
      Theme.layout();
      Theme.set(CONFIG.THEME_START_INDEX | 0, false);
    },

    /** keeps the radial glow centred on the real avatar */
    layout() {
      if (!Theme.box) return;
      const pr = Theme.preview.getBoundingClientRect();
      const ar = Theme.avatar.getBoundingClientRect();
      if (!pr.width) return;
      Theme.box.style.setProperty('--ax', (ar.left + ar.width / 2 - pr.left).toFixed(1) + 'px');
      Theme.box.style.setProperty('--ay', (ar.top + ar.height / 2 - pr.top).toFixed(1) + 'px');
    },

    next() { Theme.set((Theme.idx + 1) % THEMES.length, true); },

    set(i, animate) {
      if (!Theme.box) return;
      i = ((i % THEMES.length) + THEMES.length) % THEMES.length;
      const th = THEMES[i];
      Theme.idx = i;
      Theme.glow = th.neon ? 1 : 0.35;

      const layer = document.createElement('div');
      layer.className = 'gf-theme-layer';
      layer.style.backgroundImage =
        'radial-gradient(circle 160px at var(--ax,50%) var(--ay,40%), rgba(255,255,255,.30), rgba(255,255,255,0) 100%),' +
        'linear-gradient(180deg,' + th.top + ',' + th.bottom + ')';
      const pat = document.createElement('div');
      pat.className = 'gf-pattern';
      pat.style.backgroundImage = FOX_TILE;
      pat.style.backgroundSize = '56px 112px';
      layer.appendChild(pat);

      const old = Array.from(Theme.box.children);
      Theme.box.appendChild(layer);
      if (!animate) {
        layer.style.transition = 'none';
        layer.classList.add('gf-in');
        old.forEach((o) => o.remove());
      } else {
        void layer.offsetWidth;                       // commit opacity:0
        layer.classList.add('gf-in');
        setTimeout(() => old.forEach((o) => o.remove()), CONFIG.THEME_DURATION_MS + 120);
      }
      document.dispatchEvent(new CustomEvent('gifts:themechange', { detail: { index: i, theme: th } }));
    }
  };

  /* ═══════════════ 5. BUBBLE ═══════════════ */

  const BLOB_FREQ = [0.9, 1.15, 0.75, 1.3];

  class Bubble {
    constructor(item, index, symbolPool) {
      const { gift, data } = item;
      this.gift = gift; this.data = data; this.index = index;

      // identity
      this.color = dominantColor(data);
      this.depth = rand(0.94, 1.06);
      this.sens = rand(0.75, 1.3);
      this.wB = rand(0.6, 1.4); this.wM = rand(0.6, 1.4); this.wH = rand(0.6, 1.4);
      this.p = Array.from({ length: 8 }, () => rand(0, TAU));
      this.wo = rand(0.18, 0.34); this.wr = rand(0.25, 0.5);
      this.wb = rand(0.6, 1.1);  this.ws = rand(0.4, 0.8);

      // physics state
      this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.pvx = 0; this.pvy = 0;
      this.axs = 0; this.ays = 0;                 // smoothed acceleration (drives the symbols' inertia)
      this.size = 0; this.sv = 0; this.r = 0; this.settled = false;
      this.st = 0; this.stv = 0; this.ang = 0;
      this.jig = 0; this.jv = 0;
      this.glowV = 0; this.pa = rand(0, TAU);
      this.born = 0;
      this.far = false;                           // far side of the orbit → hidden behind the avatar via mask
      this.grabbed = false; this.pid = null;
      this.tx = 0; this.ty = 0; this.offX = 0; this.offY = 0;
      this.samples = [];
      this.sy = []; this.symAct = false;

      this._build(symbolPool);
    }

    _build(symbolPool) {
      const el = document.createElement('div');
      el.className = 'gf-bubble';
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', this.gift.label || this.gift.name || 'Gift');
      el.style.setProperty('--gc', this.color.join(','));
      el.innerHTML =
        '<div class="gf-glow"></div>' +
        '<div class="gf-jelly">' +
          '<div class="gf-sym-back"><div class="gf-sym-in"></div></div>' +
          '<div class="gf-gift"></div>' +
          '<div class="gf-front"><div class="gf-sparks"></div></div>' +
          '<div class="gf-env"></div><div class="gf-gloss"></div><div class="gf-spec"></div><div class="gf-rim"></div>' +
        '</div>';
      this.el = el;
      this.glowEl = el.children[0];
      this.jelly = el.children[1];
      this.back = this.jelly.children[0];
      this.symIn = this.back.firstChild;
      this.giftEl = this.jelly.children[1];
      this.front = this.jelly.children[2];
      this.sparks = this.front.firstChild;
      this.gloss = this.jelly.children[4];

      /* Symbols: tiny specks at rest; when grabbed the layer scales up (CSS) and every
         symbol swings on its own spring (JS) so they slosh around inside the glass. */
      let src = null;
      try { if (CONFIG.SYMBOL_RESOLVER) src = CONFIG.SYMBOL_RESOLVER(this.gift); } catch (e) { /* ignore */ }
      if (!src) src = symbolPool.length ? symbolPool[(Math.random() * symbolPool.length) | 0] : FALLBACK_SYMBOL;
      const baked = silhouette(src);
      for (let i = 0; i < 9; i++) {
        const img = document.createElement('img');
        img.className = 'gf-sym'; img.alt = ''; img.draggable = false; img.decoding = 'async';
        baked.then((u) => { img.src = u; });
        const a = rand(0, TAU), r = rand(8, 33), sz = rand(3.6, 5.8), rot = rand(-60, 60);
        img.style.width = sz + '%';
        img.style.left = (50 + Math.cos(a) * r - sz / 2).toFixed(1) + '%';
        img.style.top = (50 + Math.sin(a) * r - sz / 2).toFixed(1) + '%';
        img.style.opacity = rand(0.4, 0.75).toFixed(2);
        img.style.transform = 'rotate(' + rot.toFixed(1) + 'deg)';
        this.symIn.appendChild(img);
        this.sy.push({ el: img, rot, m: rand(0.5, 1.4), ph: rand(0, TAU), ox: 0, oy: 0, vx: 0, vy: 0 });
      }

      // sparkles (only visible while grabbed)
      for (let i = 0; i < 7; i++) {
        const sp = document.createElement('i');
        sp.className = 'gf-spark';
        const a = rand(0, TAU), r = rand(10, 40), sz = rand(3.5, 8);
        sp.style.setProperty('--s', sz + '%');
        sp.style.left = (50 + Math.cos(a) * r - sz / 2).toFixed(1) + '%';
        sp.style.top = (50 + Math.sin(a) * r - sz / 2).toFixed(1) + '%';
        sp.style.setProperty('--dur', rand(1.6, 3.2).toFixed(1) + 's');
        sp.style.setProperty('--dl', (-rand(0, 3)).toFixed(1) + 's');
        this.sparks.appendChild(sp);
      }
    }

    mountLottie(lottie) {
      this.anim = lottie.loadAnimation({
        container: this.giftEl,
        renderer: 'svg',
        loop: true,
        autoplay: false,
        animationData: this.data,
        rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: true }
      });
      this.data = null;
      try { this.anim.setSubframe(false); } catch (e) { /* ignore */ }
      this.lotT = rand(0, 3); this.nextLot = 0;
      this.frames = Math.max(1, this.anim.totalFrames || 60);
      this.fps = this.anim.frameRate || 30;
    }

    destroy() {
      try { this.anim && this.anim.destroy(); } catch (e) { /* ignore */ }
      this.el.remove();
    }
  }

  /* ═══════════════ 6. ENGINE ═══════════════
     The avatar is a planet; every gift rides one tilted ellipse around it.
     • The layer lives INSIDE #container, so if the page slides / scrolls, the
       bubbles travel with the card natively (no JS lag, no hanging behind).
     • On top of that every frame the bubbles are carried by the avatar's own
       movement, so springs only ever see the orbit, never the scroll.
     • Far-side bubbles are masked by the avatar's circle (no DOM moves → no flicker). */

  const Engine = {
    bubbles: [], layer: null, avatar: null, header: null, preview: null, lottie: null,
    cx: 0, cy: 0, pcx: null, pcy: 0, aR: 55, ar: null, ox: 0, oy: 0,
    raf: 0, last: 0, t: 0, orbit: 0, frame: 0, hidden: false, paused: false, menuOpen: false, revealed: false,
    slots: [], slotKey: '', grabSize: 137, tilt: 0, startOff: Math.random() * TAU,

    init(avatar, header, preview, lottie) {
      Engine.avatar = avatar; Engine.header = header; Engine.preview = preview; Engine.lottie = lottie;
      Engine.tilt = (CONFIG.ORBIT_TILT_DEG * Math.PI) / 180;

      Engine.layer = document.createElement('div');
      Engine.layer.id = 'gf-layer';
      if (CONFIG.GLASS_BACKDROP) Engine.layer.classList.add('gf-bd');
      // inside #container → moves with the card; falls back to <body>
      (document.getElementById('container') || document.body).appendChild(Engine.layer);
      Engine.layer.addEventListener('gesturestart', (e) => e.preventDefault());

      window.addEventListener('resize', Engine.onResize, { passive: true });
      window.addEventListener('orientationchange', Engine.onResize, { passive: true });
      document.addEventListener('visibilitychange', Engine.onVisibility);
      const check = $('#check');
      if (check) check.addEventListener('change', () => { Engine.menuOpen = check.checked; });
      Engine.onResize();
    },

    onResize() {
      Engine.readLayout();
      Engine.grabSize = Math.min(CONFIG.GRAB_SCALE * Engine.aR * 2, DESIGN, innerWidth * 0.62, innerHeight * 0.5);
      Engine.slotKey = '';
      Theme.layout();
    },

    onVisibility() {
      Engine.paused = document.hidden;
      if (!document.hidden) { Engine.last = performance.now(); Engine.loop(); }
    },

    setBubbles(items, symbolPool) {
      Engine.bubbles.forEach((b) => b.destroy());
      Engine.bubbles = [];
      Engine.readLayout();
      Engine.startOff = Math.random() * TAU;
      const now = performance.now();
      items.forEach((item, i) => {
        const b = new Bubble(item, i, symbolPool);
        try { b.mountLottie(Engine.lottie); }
        catch (e) { console.warn('[gifts] lottie failed for', item.gift.json, e); b.destroy(); return; }
        b.x = Engine.cx; b.y = Engine.cy;
        b.born = now + 150 + i * 110;
        Engine.attachPointer(b);
        Engine.layer.appendChild(b.el);
        Engine.bubbles.push(b);
      });
      const n = Engine.bubbles.length || 1, gap = 1000 / CONFIG.LOTTIE_FPS;
      Engine.bubbles.forEach((b, i) => { b.index = i; b.nextLot = now + (i * gap) / n; });   // spread Lottie work across frames
      Engine.slotKey = '';
      Engine.revealed = false;
    },

    /* ── pointer / drag ── */
    attachPointer(b) {
      const el = b.el;
      let startX = 0, startY = 0, startT = 0, moved = 0;
      const pushSample = (e) => {
        const s = b.samples; s.push({ x: e.clientX, y: e.clientY, t: performance.now() });
        if (s.length > 6) s.shift();
      };
      el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (b.grabbed) return;
        e.preventDefault(); e.stopPropagation();
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        b.grabbed = true; b.pid = e.pointerId; b.far = false;      // a grabbed bubble is always on top
        b.offX = b.x - e.clientX; b.offY = b.y - e.clientY;
        b.tx = e.clientX; b.ty = e.clientY;
        b.samples = []; pushSample(e);
        startX = e.clientX; startY = e.clientY; startT = performance.now(); moved = 0;
        b.jv += 2.4;                                               // squish on grab
        el.classList.add('gf-grab');
      });
      el.addEventListener('pointermove', (e) => {
        if (!b.grabbed || e.pointerId !== b.pid) return;
        e.preventDefault();
        b.tx = e.clientX; b.ty = e.clientY;
        moved = Math.max(moved, Math.hypot(e.clientX - startX, e.clientY - startY));
        pushSample(e);
      });
      const end = (e) => {
        if (!b.grabbed || (e && e.pointerId !== b.pid)) return;
        b.grabbed = false; b.pid = null;
        el.classList.remove('gf-grab');
        const s = b.samples;
        if (s.length >= 2) {
          const a = s[0], z = s[s.length - 1], dt = (z.t - a.t) / 1000;
          if (dt > 0.01 && performance.now() - z.t < 120) {
            const pvx = clamp((z.x - a.x) / dt, -1800, 1800), pvy = clamp((z.y - a.y) / dt, -1800, 1800);
            b.vx = lerp(b.vx, pvx, 0.5); b.vy = lerp(b.vy, pvy, 0.5);
          }
        }
        b.jv -= 2.4;                                               // wobble on release
        if (CONFIG.OPEN_LINK_ON_TAP && moved < 6 && performance.now() - startT < 350 && b.gift.link)
          window.open(b.gift.link, '_blank', 'noopener');
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('lostpointercapture', end);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      el.addEventListener('dragstart', (e) => e.preventDefault());
    },

    /* ── geometry (one read per frame, before any write) ── */
    readLayout() {
      const r = Engine.avatar.getBoundingClientRect();
      Engine.ar = r;
      Engine.cx = r.left + r.width / 2;
      Engine.cy = r.top + r.height / 2;
      Engine.aR = r.width / 2 || 55;
      if (Engine.layer) { const o = Engine.layer.getBoundingClientRect(); Engine.ox = o.left; Engine.oy = o.top; }
    },

    /** N gifts evenly spaced on the orbit (a 2nd, wider, counter-rotating ring above 8) */
    buildSlots() {
      const n = Engine.bubbles.length;
      const key = n + '|' + Math.round(Engine.aR) + '|' + innerWidth;
      if (key === Engine.slotKey) return;
      Engine.slotKey = key;
      const rings = Math.max(1, Math.ceil(n / 8));
      const slots = new Array(n);
      for (let ring = 0; ring < rings; ring++) {
        const idxs = [];
        for (let i = ring; i < n; i += rings) idxs.push(i);
        const step = TAU / idxs.length;
        idxs.forEach((bi, j) => {
          slots[bi] = { ang: Engine.startOff + j * step + (ring % 2 ? step / 2 : 0), dir: ring % 2 ? -1 : 1, kr: 1 + ring * 0.2 };
        });
      }
      Engine.slots = slots;
    },

    /** where the bubble wants to be right now on the tilted orbit (also sets its depth angle b.pa) */
    pref(b, out) {
      const s = Engine.slots[b.index] || { ang: 0, dir: 1, kr: 1 };
      const t = Engine.t, M = Music.v;
      const a = s.ang + Engine.orbit * s.dir + 0.06 * Math.sin(t * b.wo + b.p[0]) * MOTION;
      b.pa = a;
      const k = s.kr * (1 + 0.04 * Math.sin(t * b.wr + b.p[1]) * MOTION);
      const X = Math.cos(a) * Engine.aR * CONFIG.ORBIT_RX * k;
      const Y = Math.sin(a) * Engine.aR * CONFIG.ORBIT_RY * k;
      const c = Math.cos(Engine.tilt), sn = Math.sin(Engine.tilt);
      out.x = Engine.cx + X * c - Y * sn + M.mid * 3 * b.sens * b.wM * Math.sin(t * 7 + b.p[4]);
      out.y = Engine.cy + X * sn + Y * c + 3 * MOTION * Math.sin(t * b.wb + b.p[2]) + M.mid * 3 * b.sens * b.wM * Math.cos(t * 6 + b.p[5]);
      // no viewport clamping: when the card scrolls away the bubbles must leave with it
    },

    /** size follows depth: far side small (~0.30 D), near side big (~0.58 D) */
    baseSize(b) {
      const M = Music.v, D = Engine.aR * 2;
      const s = D * (CONFIG.BASE_SCALE + CONFIG.DEPTH_SCALE * Math.sin(b.pa)) * b.depth *
        (1 + 0.04 * Math.sin(Engine.t * b.ws + b.p[6]) * MOTION);
      return s * (1 + 0.08 * M.bass * b.sens * b.wB);
    },

    /* ── main loop ── */
    start() { Engine.last = performance.now(); Engine.loop(); },

    loop() {
      if (Engine.raf) cancelAnimationFrame(Engine.raf);
      Engine.raf = requestAnimationFrame(Engine.tick);
    },

    tick(now) {
      Engine.raf = 0;
      if (Engine.paused) return;
      const dt = Math.min(0.05, (now - Engine.last) / 1000 || 0.016);
      Engine.last = now; Engine.t += dt; Engine.frame++;
      Engine.orbit += CONFIG.ORBIT_SPEED * dt * MOTION;      // clockwise

      Engine.readLayout();

      // carry every free bubble with the avatar (scroll / slide / resize) → zero spring lag
      if (Engine.pcx !== null) {
        const dx = Engine.cx - Engine.pcx, dy = Engine.cy - Engine.pcy;
        if (dx || dy) for (const b of Engine.bubbles) if (!b.grabbed) { b.x += dx; b.y += dy; }
      }
      Engine.pcx = Engine.cx; Engine.pcy = Engine.cy;

      if (Engine.frame % 20 === 3) Engine.checkVisible(now);
      if (Engine.frame % 45 === 0) Theme.layout();

      if (Engine.bubbles.length) {
        Engine.buildSlots();
        if (Engine.hidden) Engine.snap();
        else {
          Music.update(dt, now);
          const sub = Math.max(1, Math.ceil(dt / (1 / 90)));
          for (let i = 0; i < sub; i++) Engine.step(dt / sub, now);
          Engine.render(dt, now);
        }
      }
      Engine.loop();
    },

    /** hidden (off-screen / covered): stay glued to the orbit so nothing "flies in" on return */
    snap() {
      const P = Engine._p;
      for (const b of Engine.bubbles) {
        if (b.grabbed) continue;
        Engine.pref(b, P);
        b.x = P.x; b.y = P.y; b.vx = b.vy = b.pvx = b.pvy = 0;
        if (Engine.revealed) { b.size = Engine.baseSize(b); b.sv = 0; }
      }
    },

    /** off-screen, or covered by loader / modal / portfolio / sidebar */
    checkVisible(now) {
      let vis = true;
      const r = Engine.ar, m = Engine.aR * 2.8;
      if (r.bottom < -m || r.top > innerHeight + m || r.right < -m || r.left > innerWidth + m) vis = false;
      else {
        const el = document.elementFromPoint(clamp(Engine.cx, 1, innerWidth - 2), clamp(Engine.cy, 1, innerHeight - 2));
        if (!el || (!el.closest('.card') && !el.closest('#gf-layer'))) vis = false;
      }
      if (Engine.menuOpen) vis = false;
      if (vis && !Engine.revealed) {                      // first time on screen → pop out of the avatar
        Engine.revealed = true;
        Engine.bubbles.forEach((b, i) => { b.born = now + 150 + i * 110; b.size = 0; b.sv = 0; });
      }
      if (vis === !Engine.hidden) return;
      Engine.hidden = !vis;
      Engine.layer.classList.toggle('gf-off', Engine.hidden);
    },

    _p: { x: 0, y: 0 },

    step(h, now) {
      const B = Engine.bubbles, n = B.length, M = Music.v, P = Engine._p;
      for (let i = 0; i < n; i++) {
        const b = B[i];
        const alive = now >= b.born;
        Engine.pref(b, P);

        // size spring (under-damped → jelly overshoot)
        const target = alive ? (b.grabbed ? Engine.grabSize : Engine.baseSize(b)) : 0;
        b.sv += (-190 * (b.size - target) - 13 * b.sv) * h;
        b.size = Math.max(0, b.size + b.sv * h);
        b.r = b.size / 2;
        b.settled = Math.abs(b.size - target) < 5;

        let ax, ay;
        if (b.grabbed) {
          b.offX *= Math.exp(-h * 6); b.offY *= Math.exp(-h * 6);
          const m = Engine.grabSize / 2 + 4;
          const tx = clamp(b.tx + b.offX, m, innerWidth - m);
          const ty = clamp(b.ty + b.offY, m, innerHeight - m);
          ax = 240 * (tx - b.x) - 24 * b.vx;
          ay = 240 * (ty - b.y) - 24 * b.vy;
        } else {
          // ride the orbit; after a flick it glides, then eases back on
          ax = 38 * (P.x - b.x) - 9.5 * b.vx;
          ay = 38 * (P.y - b.y) - 9.5 * b.vy;
          // gentle separation, only between bubbles on the same side of the avatar
          for (let j = 0; j < n; j++) {
            if (j === i) continue;
            const o = B[j];
            if (o.far !== b.far) continue;
            const dx = b.x - o.x, dy = b.y - o.y, d = Math.hypot(dx, dy) || 0.01;
            const min = (b.r + o.r) * 0.9;
            if (d < min) { const f = ((min - d) / min) * (o.grabbed ? 900 : 260); ax += (dx / d) * f; ay += (dy / d) * f; }
          }
        }

        b.vx += ax * h; b.vy += ay * h;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > 2200) { b.vx *= 2200 / sp; b.vy *= 2200 / sp; }
        b.x += b.vx * h; b.y += b.vy * h;

        // jelly springs
        if (sp > 40) {
          let d = Math.atan2(b.vy, b.vx) - b.ang;
          while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
          b.ang += d * (1 - Math.exp(-h * 12));
        }
        const stT = clamp(sp / (b.grabbed ? 1300 : 2400), 0, 0.45) + M.mid * 0.03 * b.sens * b.wM;
        b.stv += (-260 * (b.st - stT) - 11 * b.stv) * h; b.st += b.stv * h;
        b.jv += (-200 * b.jig - 9 * b.jv) * h; b.jig += b.jv * h;
      }
    },

    render(dt, now) {
      const B = Engine.bubbles, M = Music.v, t = Engine.t;
      const glowK = 1 - Math.exp(-dt * 3);
      const ox = Engine.ox, oy = Engine.oy;
      for (let i = 0; i < B.length; i++) {
        const b = B[i], st = b.el.style;

        // near / far side of the orbit (hysteresis, switches at the left/right extremes)
        if (!b.grabbed && b.settled && now >= b.born) {
          const f = Math.sin(b.pa);
          if (!b.far && f < -0.06) b.far = true; else if (b.far && f > 0.06) b.far = false;
        }
        const s = Math.max(0.001, b.size / DESIGN);
        st.transform = 'translate3d(' + (b.x - ox - DESIGN / 2).toFixed(2) + 'px,' + (b.y - oy - DESIGN / 2).toFixed(2) + 'px,0) scale(' + s.toFixed(4) + ')';
        st.zIndex = Math.round(b.size * 10);

        /* far-side bubbles are cut by the avatar's circle → the avatar sits on top of them.
           No DOM moves, so nothing can flicker. Not grab-able while hidden behind the avatar. */
        if (b.far) {
          const lx = (Engine.cx - b.x) / s + DESIGN / 2, ly = (Engine.cy - b.y) / s + DESIGN / 2, lr = Math.max(0, (Engine.aR - 0.5) / s);
          const m = 'radial-gradient(circle at ' + lx.toFixed(1) + 'px ' + ly.toFixed(1) + 'px,transparent ' + lr.toFixed(1) + 'px,#000 ' + (lr + 0.9 / s).toFixed(1) + 'px)';
          if (m !== b._m) { b._m = m; st.webkitMaskImage = m; st.maskImage = m; }
          const pe = Math.hypot(b.x - Engine.cx, b.y - Engine.cy) < Engine.aR + b.r * 0.7 ? 'none' : '';
          if (pe !== b._pe) { b._pe = pe; st.pointerEvents = pe; }
        } else {
          if (b._m) { b._m = ''; st.webkitMaskImage = ''; st.maskImage = ''; }
          if (b._pe) { b._pe = ''; st.pointerEvents = ''; }
        }

        /* jelly: transform-only (no repaint). idle = slow squash on a rotating axis,
           moving = stretch along velocity + under-damped wobble */
        const breath = (b.grabbed ? 0.06 : 0.035) * MOTION;
        const wob = Math.sin(t * 1.4 + b.p[7]) * breath + b.jig * 0.5;
        const axis = t * 0.4 + b.p[2];
        const sx = (1 + b.st) * (1 + wob);
        const sy = (1 / Math.pow(1 + b.st, 0.85)) * (1 - wob);
        const tilt = clamp(b.vx * 0.00018, -0.25, 0.25) + b.jig * 0.12;
        const ang = b.ang;
        b.jelly.style.transform = 'rotate(' + (tilt + axis).toFixed(3) + 'rad) scale(' + sx.toFixed(3) + ',' + sy.toFixed(3) +
          ') rotate(' + (-axis).toFixed(3) + 'rad) rotate(' + ang.toFixed(3) + 'rad) scale(' + (1 + b.st * 0.6).toFixed(3) + ',' +
          (1 / (1 + b.st * 0.6)).toFixed(3) + ') rotate(' + (-ang).toFixed(3) + 'rad)';

        // gift counter-transform: the artwork stays almost undeformed
        const gx = clamp(-b.vx * 0.006, -5, 5), gy = clamp(-b.vy * 0.006, -5, 5);
        b.giftEl.style.transform = 'scale(' + (1 / Math.pow(sx, 0.7)).toFixed(3) + ',' + (1 / Math.pow(sy, 0.7)).toFixed(3) +
          ') translate(' + gx.toFixed(1) + 'px,' + gy.toFixed(1) + 'px)';

        /* organic egg outline: slow morph, bigger when grabbed. 30 fps, 0.1 % precision (no stepping) */
        if ((Engine.frame + i) % 2 === 0) {
          const amp = (b.grabbed ? 0.12 : 0.055) + Math.abs(b.jig) * 0.3 + Math.min(0.06, Math.hypot(b.vx, b.vy) / 5000) + M.mid * 0.04 * b.sens;
          const v = [0, 1, 2, 3].map((k) => clamp(50 + 100 * amp * Math.sin(t * BLOB_FREQ[k] * 1.1 + b.p[k]), 34, 66));
          b.jelly.style.borderRadius =
            v[0].toFixed(1) + '% ' + (100 - v[0]).toFixed(1) + '% ' + v[1].toFixed(1) + '% ' + (100 - v[1]).toFixed(1) + '% / ' +
            v[2].toFixed(1) + '% ' + v[3].toFixed(1) + '% ' + (100 - v[3]).toFixed(1) + '% ' + (100 - v[2]).toFixed(1) + '%';
        }

        /* symbols: each one hangs on its own spring and SWINGS against the bubble's acceleration
           (like objects floating in jelly), so they jiggle whenever the bubble is moved. */
        const inv = 1 / Math.max(dt, 0.001);
        b.axs += ((b.vx - b.pvx) * inv - b.axs) * 0.35;
        b.ays += ((b.vy - b.pvy) * inv - b.ays) * 0.35;
        b.pvx = b.vx; b.pvy = b.vy;
        if (b.grabbed || b.symAct || Math.abs(b.axs) + Math.abs(b.ays) > 260) {
          let e = 0;
          for (let k = 0; k < b.sy.length; k++) {
            const q = b.sy[k];
            const amb = b.grabbed ? 1.3 * Math.sin(t * 2.3 + q.ph) : 0;           // alive while held
            const tx = clamp(-b.axs * 0.0011 * q.m - b.vx * 0.0016 * q.m + amb, -6, 6);
            const ty = clamp(-b.ays * 0.0011 * q.m - b.vy * 0.0016 * q.m + amb * 0.8, -6, 6);
            q.vx += (110 * (tx - q.ox) - 5.5 * q.vx) * dt;                        // under-damped → jiggle
            q.vy += (110 * (ty - q.oy) - 5.5 * q.vy) * dt;
            q.ox += q.vx * dt; q.oy += q.vy * dt;
            e += Math.abs(q.ox) + Math.abs(q.oy) + 0.05 * (Math.abs(q.vx) + Math.abs(q.vy));
            q.el.style.transform = 'translate(' + q.ox.toFixed(2) + 'px,' + q.oy.toFixed(2) + 'px) rotate(' + (q.rot + q.ox * 4).toFixed(1) + 'deg)';
          }
          b.symAct = b.grabbed || e / b.sy.length > 0.04;
          if (!b.symAct) for (const q of b.sy) { q.ox = q.oy = q.vx = q.vy = 0; q.el.style.transform = 'rotate(' + q.rot.toFixed(1) + 'deg)'; }
        }

        // symbol layers drift slowly + parallax with velocity
        const bx = clamp(-b.vx * 0.010, -7, 7) + b.jig * 6, by = clamp(-b.vy * 0.010, -7, 7);
        b.back.style.transform = 'translate(' + bx.toFixed(1) + 'px,' + by.toFixed(1) + 'px) rotate(' + (t * 0.12 * b.wM + b.p[3]).toFixed(3) + 'rad)';
        b.front.style.transform = 'translate(' + (bx * 2.2).toFixed(1) + 'px,' + (by * 2.2).toFixed(1) + 'px)';
        const gl = 'translate(' + clamp(-b.vx * 0.01, -8, 8).toFixed(0) + 'px,' + clamp(-b.vy * 0.01, -8, 8).toFixed(0) + 'px) rotate(-32deg)';
        if (gl !== b._gl) { b._gl = gl; b.gloss.style.transform = gl; }
        const hi = Math.round(clamp(M.high * b.wH * b.sens + (b.grabbed ? 0.25 : 0), 0, 1) * 10) / 10;
        if (hi !== b._hi) { b._hi = hi; b.jelly.style.setProperty('--hi', hi); }

        // soft glow (theme + gift colour + music)
        const gT = Theme.glow * (b.grabbed ? 1.4 : 1) * (0.55 + 0.30 * M.level * b.sens + 0.25 * M.bass * b.sens * b.wB);
        b.glowV += (gT - b.glowV) * glowK;
        b.glowEl.style.opacity = clamp(b.glowV, 0, 1).toFixed(2);
        b.glowEl.style.transform = 'scale(' + (1 + 0.08 * M.bass * b.sens + (b.grabbed ? 0.1 : 0)).toFixed(2) + ')';

        // Lottie driven manually on an even cadence (no bursts): resting = LOTTIE_FPS, grabbed = 60
        b.lotT += dt;
        if (b.anim && now >= b.nextLot && b.size > 2) {
          const gap = 1000 / (b.grabbed ? 60 : CONFIG.LOTTIE_FPS);
          b.nextLot += gap; if (b.nextLot < now) b.nextLot = now + gap;
          try { b.anim.goToAndStop((b.lotT * b.fps) % b.frames, true); } catch (e) { /* ignore */ }
        }
      }
    }
  };

  /* ═══════════════ BOOT ═══════════════ */

  function loadCss() {
    return new Promise((res) => {
      const src = (document.currentScript && document.currentScript.src) || '';
      const href = src ? src.replace(/\.js(\?.*)?$/, '.css$1') : 'src/gifts-float.css';
      if ($('link[href="' + href + '"]')) return res();
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = href;
      l.onload = l.onerror = () => res();
      document.head.appendChild(l);
      setTimeout(res, 3000);
    });
  }
  const CSS_READY = loadCss();     // currentScript is only valid synchronously

  let manifestCache = null;
  async function populate(count) {
    if (!manifestCache) {
      manifestCache = await fetchJSON(CONFIG.MANIFEST_URL);
      if (!Array.isArray(manifestCache)) throw new Error('manifest is not an array');
    }
    const items = await pickGifts(manifestCache, Math.max(0, count | 0));
    if (!items.length) { console.warn('[gifts] no gift could be loaded'); return; }
    Engine.setBubbles(items, symbolList());
  }

  async function boot() {
    await CSS_READY;
    const avatar = $(CONFIG.AVATAR_SELECTOR);
    const header = $(CONFIG.HEADER_SELECTOR);
    const preview = $(CONFIG.PREVIEW_SELECTOR);
    if (!avatar) { console.warn('[gifts] avatar not found:', CONFIG.AVATAR_SELECTOR); return; }

    if (CONFIG.THEMES_ENABLED && preview) {
      Theme.init(preview, avatar);
      if (header) {
        header.addEventListener('click', (e) => {
          if (e.target.closest('.image, a, label, .checkbtn, .hamburger-menu, .name-container, .gift-badge')) return;
          Theme.next();
        });
      }
      if (window.ResizeObserver && header) new ResizeObserver(() => Theme.layout()).observe(header);
      setTimeout(Theme.layout, 600);
      setTimeout(Theme.layout, 1800);
    }

    let lottie;
    try { lottie = await waitForLottie(10000); } catch (e) { console.warn('[gifts]', e.message); return; }
    Engine.init(avatar, header, preview, lottie);
    try { await populate(CONFIG.VISIBLE_GIFTS_COUNT); }
    catch (e) { console.warn('[gifts] manifest failed:', e.message || e); }
    Engine.start();
  }

  /* public API */
  window.GiftsFloat = {
    config: CONFIG,
    themes: THEMES,
    setCount: (n) => populate(n),
    nextTheme: () => Theme.next(),
    setTheme: (i) => Theme.set(i, true),
    attachAnalyser: (an, el) => Music.attachAnalyser(an, el),
    attachAudioElement: (el) => Music.attachAudioElement(el),
    music: Music.v
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();