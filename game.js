/* ==========================================================================
   SLIPSTREAM — game
   Systems, in order: helpers · Save · Settings · Audio · Dates/Daily ·
   Stats recording · Renderer (BoardView) · Input · Game session ·
   Screens (Home, Campaign, Daily, Zen, Stats, Settings) · Overlays ·
   Debug tools · Boot.
   Depends on engine.js (window.SlipEngine).
   ========================================================================== */
(function () {
  'use strict';

  const E = window.SlipEngine;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const SVGNS = 'http://www.w3.org/2000/svg';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'style') n.style.cssText = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
    return n;
  }
  function s(tag, attrs) {
    const n = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  const pad2 = (n) => String(n).padStart(2, '0');
  function fmtTime(ms) {
    if (ms == null) return '—';
    const t = Math.floor(ms / 1000);
    const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
    return hh ? `${hh}:${pad2(mm)}:${pad2(ss)}` : `${mm}:${pad2(ss)}`;
  }
  function fmtDuration(ms) {
    const t = Math.floor((ms || 0) / 1000);
    const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
    if (hh) return `${hh}h ${pad2(mm)}m`;
    if (mm) return `${mm}m ${pad2(ss)}s`;
    return `${ss}s`;
  }
  const fmtNum = (n) => (n || 0).toLocaleString();
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const DIFF_COLOR = { easy: 'var(--a3)', medium: 'var(--a1)', hard: 'var(--a0)', expert: 'var(--a6)', nightmare: 'var(--a7)', insane: 'var(--a0)', impossible: 'var(--text)' };
  const diffLabel = (d) => (E.DIFFICULTIES[d] ? E.DIFFICULTIES[d].label : d);

  /* ======================================================================
     SAVE SYSTEM — one JSON document in localStorage.
     Missing keys are filled from defaults so older saves keep working.
     ====================================================================== */
  const SAVE_KEY = 'slipstream.save.v1';
  function defaultSave() {
    return {
      v: 1,
      settings: { sound: true, motion: 'auto', speed: 'normal', highContrast: false, preview: true, dev: false },
      campaign: { unlocked: 1, levels: {} },
      daily: { history: {}, longestStreak: 0 },
      zen: { boards: {}, perfect: 0, arrows: 0, longestSession: 0, session: { diff: null, count: 0 }, recentSeeds: [] },
      stats: {
        played: 0, completed: 0, perfect: 0, playMs: 0,
        arrows: 0, taps: 0, success: 0, blocked: 0, hints: 0,
        perfectStreak: 0, bestPerfectStreak: 0,
        fastest: {}, largest: null, deepest: 0, fewestBlockedHard: null, failed: 0,
      },
      active: null,   // the in-progress board (see newSession)
      route: 'home',
      zoomTips: 0,          // times the pinch-to-zoom tip has been shown
      seenHowTo: false,
      lastBackup: null,
      seenHeartsTip: false,
    };
  }
  function isPlain(o) { return o && typeof o === 'object' && !Array.isArray(o); }
  function fillDefaults(target, defaults) {
    for (const k in defaults) {
      if (target[k] === undefined) target[k] = JSON.parse(JSON.stringify(defaults[k]));
      else if (isPlain(target[k]) && isPlain(defaults[k])) fillDefaults(target[k], defaults[k]);
    }
    return target;
  }
  const Save = {
    data: null,
    ok: true,
    timer: 0,
    load() {
      try {
        const raw = window.localStorage.getItem(SAVE_KEY);
        this.data = raw ? fillDefaults(JSON.parse(raw), defaultSave()) : defaultSave();
      } catch (e) {
        this.ok = false;
        this.data = defaultSave();
      }
    },
    write() {
      clearTimeout(this.timer);
      try { window.localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); this.ok = true; }
      catch (e) { this.ok = false; }
    },
    soon() { clearTimeout(this.timer); this.timer = setTimeout(() => this.write(), 300); },
    reset() {
      const keepSettings = this.data.settings;
      this.data = defaultSave();
      this.data.settings = keepSettings;
      this.write();
    },
  };

  /* ======================================================================
     SETTINGS
     ====================================================================== */
  const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reducedMotion() {
    const m = Save.data.settings.motion;
    if (m === 'on') return true;
    if (m === 'off') return false;
    return !!(motionQuery && motionQuery.matches);
  }
  function applySettings() {
    if (typeof HeroStream !== 'undefined' && HeroStream.svg && currentScreen === 'home') HeroStream.start();
    const st = Save.data.settings;
    document.body.classList.toggle('hc', !!st.highContrast);
    document.body.classList.toggle('reduce-motion', reducedMotion());
    $('#btn-debug').hidden = !st.dev;
    if (!st.dev) $('#debug-panel').hidden = true;
  }

  /* ======================================================================
     AUDIO — small WebAudio synth, no sound files.
     ====================================================================== */
  const Sound = {
    ctx: null,
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { this.ctx = new AC(); } catch (e) { return null; }
        this.loadSamples();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    },
    /* Recorded sounds (sounds.js) are decoded as soon as the app opens, so
       they are ready before the first tap. Browsers allow creating the audio
       context early; it simply stays paused until the player's first touch. */
    samples: {},
    sampleState: {},   // name -> 'loading' | 'ready' | 'failed'
    preload() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch (e) { return; }
      this.loadSamples();
    },
    loadSamples() {
      const src = window.SLIP_SOUNDS || {};
      for (const name in src) {
        if (this.sampleState[name]) continue;
        this.sampleState[name] = 'loading';
        try {
          const bin = atob(src[name]);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const ok = (buf) => { if (buf) { this.samples[name] = buf; this.sampleState[name] = 'ready'; } };
          const fail = () => { if (this.sampleState[name] !== 'ready') this.sampleState[name] = 'failed'; };
          const p = this.ctx.decodeAudioData(bytes.buffer, ok, fail);
          if (p && p.then) p.then(ok, fail);
        } catch (e) { this.sampleState[name] = 'failed'; }
      }
    },
    /** Plays a recorded sound. Returns false only if it can never play
        (so the caller can use the synth instead). While still loading it
        plays nothing rather than mixing in the old sound. */
    sample(name, vol, rate) {
      const buf = this.samples[name];
      if (!buf) return this.sampleState[name] !== 'failed' && !!window.SLIP_SOUNDS && name in window.SLIP_SOUNDS;
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate || 1;
      const g = c.createGain();
      g.gain.value = vol;
      src.connect(g).connect(c.destination);
      src.start();
      return true;
    },
    tone(freq, dur, o) {
      o = o || {};
      const c = this.ctx, t0 = c.currentTime + (o.delay || 0);
      const osc = c.createOscillator(), g = c.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + o.slide), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(o.vol || 0.1, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(c.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    },
    whoosh(vol, dur) {
      const c = this.ctx, t0 = c.currentTime;
      const len = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource(); src.buffer = buf;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(500, t0);
      bp.frequency.exponentialRampToValueAtTime(3200, t0 + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(bp).connect(g).connect(c.destination);
      src.start(t0);
    },
    play(name, arg) {
      if (!Save.data.settings.sound) return;
      if (!this.ensure()) return;
      try {
        switch (name) {
          case 'tap': this.tone(620, 0.05, { vol: 0.035 }); break;
          case 'escape': {
            // Chris's "fwip". It lifts slightly in pitch during a streak of
            // clean releases, with a little random variation so fast
            // clearing doesn't sound like a machine gun.
            const step = Math.min(arg || 0, 12);
            const rate = (1 + step * 0.012) * (0.96 + Math.random() * 0.08);
            if (!this.sample('arrow', 0.55, rate)) {
              const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];
              this.whoosh(0.07, 0.2);
              this.tone(392 * Math.pow(2, scale[step] / 12), 0.12, { type: 'triangle', vol: 0.07 });
            }
            break;
          }
          case 'blocked':
            this.tone(170, 0.16, { type: 'sine', vol: 0.16, slide: -70 });
            this.tone(95, 0.1, { type: 'triangle', vol: 0.08, delay: 0.02 });
            break;
          case 'fail':
            [392, 330, 262].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', vol: 0.08, delay: i * 0.14 }));
            break;
          case 'hint':
            this.tone(660, 0.14, { vol: 0.06 });
            this.tone(990, 0.2, { vol: 0.05, delay: 0.1 });
            break;
          case 'complete':
            [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.28, { type: 'triangle', vol: 0.08, delay: i * 0.08 }));
            break;
          case 'perfect':
            [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(f, 0.35, { type: 'triangle', vol: 0.075, delay: i * 0.07 }));
            [2093, 2637].forEach((f, i) => this.tone(f, 0.5, { vol: 0.03, delay: 0.45 + i * 0.1 }));
            break;
          case 'daily':
            [392, 494, 587, 784].forEach((f) => this.tone(f, 0.7, { type: 'sine', vol: 0.05, delay: 0.3 }));
            break;
        }
      } catch (e) { /* audio is optional */ }
    },
  };

  /* ======================================================================
     DATES & DAILY CHALLENGE
     All dates are local calendar days in YYYY-MM-DD form.
     ====================================================================== */
  function dateKey(d) {
    d = d || new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function parseKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 12); }
  function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); }
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function shortDate(k) {
    const d = parseKey(k);
    return `${WEEKDAYS[d.getDay()].slice(0, 3)}, ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
  }

  /** Streaks are derived from the saved history, so they can never drift. */
  function dailyStreaks() {
    const hist = Save.data.daily.history;
    let current = 0;
    let d = dateKey();
    if (!(hist[d] && hist[d].completed)) d = addDays(d, -1);
    while (hist[d] && hist[d].completed) { current++; d = addDays(d, -1); }
    const days = Object.keys(hist).filter((k) => hist[k].completed).sort();
    let best = 0, run = 0, prev = null;
    for (const k of days) {
      run = prev && addDays(prev, 1) === k ? run + 1 : 1;
      best = Math.max(best, run);
      prev = k;
    }
    return { current, longest: Math.max(best, Save.data.daily.longestStreak || 0) };
  }
  function dailyTotals() {
    const hist = Save.data.daily.history;
    let attempted = 0, completed = 0, perfect = 0;
    for (const k in hist) {
      if (hist[k].attempted) attempted++;
      if (hist[k].completed) completed++;
      if (hist[k].perfect) perfect++;
    }
    return { attempted, completed, perfect };
  }

  /* ======================================================================
     PUZZLE LOOKUP — sessions store only a key; the board is regenerated
     deterministically from it (campaign level, date, or Zen seed).
     ====================================================================== */
  const puzzleCache = new Map();
  function puzzleFor(sess) {
    const key = `${sess.mode}|${sess.key}|${sess.diff}`;
    if (puzzleCache.has(key)) return puzzleCache.get(key);
    let p;
    if (sess.mode === 'campaign') p = E.campaignPuzzle(Number(sess.key));
    else if (sess.mode === 'daily') p = E.dailyPuzzle(sess.key);
    else p = E.zenPuzzle(sess.key, sess.diff);
    if (puzzleCache.size > 6) puzzleCache.delete(puzzleCache.keys().next().value);
    puzzleCache.set(key, p);
    return p;
  }
  function newZenSeed() {
    const recent = Save.data.zen.recentSeeds;
    let seed;
    do {
      let n;
      try { n = crypto.getRandomValues(new Uint32Array(1))[0]; } catch (e) { n = Math.floor(Math.random() * 4294967296); }
      seed = n.toString(36);
    } while (recent.includes(seed));
    recent.push(seed);
    if (recent.length > 80) recent.splice(0, recent.length - 80);
    return seed;
  }

  /* ======================================================================
     RENDERER — SVG board. One <g> per arrow (casing, trail, body, head).
     Board units: one cell = 1 unit, cell (x, y) centre at (x+.5, y+.5).
     ====================================================================== */
  /* Escape flight speeds (Settings → Arrow speed). Every speed launches
     on the tap, in step with the arrow sound, then glides off the board.
       duration = baseMs + perCellMs × distance, kept between minMs and maxMs
       ease: higher = punchier launch that settles as it leaves (1 = steady)
     The arrow stays fully visible until its tail has left the board; it
     only fades once it is past the edge. */
  const ESCAPE_SPEEDS = {
    fast:    { baseMs: 170, perCellMs: 9,  minMs: 220, maxMs: 420, ease: 2.4 },
    normal:  { baseMs: 280, perCellMs: 12, minMs: 380, maxMs: 650, ease: 1.7 },
    relaxed: { baseMs: 420, perCellMs: 16, minMs: 560, maxMs: 950, ease: 1.35 },
  };
  const escapeSpeed = () => ESCAPE_SPEEDS[Save.data.settings.speed] || ESCAPE_SPEEDS.normal;
  const EXIT_GLIDE_CELLS = 2.6;   // how far past the edge an arrow travels before it's gone

  const TIP = 0.36;      // how far the arrowhead tip reaches past the head cell centre
  const HEAD_BACK = 0.1; // where the arrowhead base sits behind the head cell centre
  const HEAD_HALF = 0.29;

  class BoardView {
    constructor(svg) {
      this.svg = svg;
      this.gGrid = $('.layer-grid', svg);
      this.gUnder = $('.layer-fx-under', svg);
      this.gArrows = $('.layer-arrows', svg);
      this.gFx = $('.layer-fx', svg);
      this.gLabels = $('.layer-labels', svg);
      this.nodes = new Map();
      this.anims = new Set();
      this.raf = 0;
      this.zoom = { scale: 1, cx: 0, cy: 0 };
      this.selected = -1;
      this.loop = this.loop.bind(this);
    }

    load(puzzle, board) {
      this.p = puzzle;
      this.board = board;
      this.anims.clear();
      for (const g of [this.gGrid, this.gUnder, this.gArrows, this.gFx, this.gLabels]) g.textContent = '';
      this.nodes.clear();
      this.selected = -1;
      this.drawGrid();
      for (const id of board.alive) this.createArrow(puzzle.arrows[id]);
      this.fit();
      this.updateDensity();
    }
    /** Thicker strokes when cells are small on screen (big boards on phones). */
    updateDensity() {
      const px = this.cellPx();
      this.svg.classList.toggle('is-dense', px > 0 && px < 30);
    }

    drawGrid() {
      const { cols, rows, mask } = this.p;
      this.gGrid.append(s('rect', { class: 'board-bg', x: -0.3, y: -0.3, width: cols + 0.6, height: rows + 0.6, rx: 0.7 }));
      // All dots in a single path keeps the DOM small on big boards.
      const r = 0.06;
      let d = '';
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        if (!mask[y * cols + x]) continue;
        const cx = x + 0.5 - r, cy = y + 0.5;
        d += `M${cx.toFixed(2)} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
      }
      this.gGrid.append(s('path', { class: 'board-dot', d }));
    }

    /** Geometry for one arrow: centre points plus a straight extension
        along its exit direction, used for the snake-style escape. */
    geometry(a) {
      const pts = a.cells.map(([x, y]) => [x + 0.5, y + 0.5]);
      const hd = pts[pts.length - 1];
      const far = this.p.cols + this.p.rows + pts.length + 6;
      const ext = pts.concat([[hd[0] + E.DX[a.dir] * far, hd[1] + E.DY[a.dir] * far]]);
      const cum = [0];
      for (let i = 1; i < ext.length; i++) cum.push(cum[i - 1] + Math.abs(ext[i][0] - ext[i - 1][0]) + Math.abs(ext[i][1] - ext[i - 1][1]));
      return { pts, ext, cum, len: pts.length - 1 };
    }

    createArrow(a) {
      const g = s('g', { class: 'arrow', 'data-id': a.id });
      const color = `var(--a${a.color})`;
      const sel = s('path', { class: 'sel-ring' });
      const casing = s('path', { class: 'casing' });
      const headCasing = s('path', { class: 'head-casing' });
      const trail = s('path', { class: 'trail' });
      const body = s('path', { class: 'body' });
      const head = s('path', { class: 'head' });
      body.style.stroke = color;
      trail.style.stroke = color;
      head.style.fill = color;
      head.style.stroke = color;
      trail.style.display = 'none';
      g.append(sel, casing, headCasing, trail, body, head);
      this.gArrows.append(g);
      const node = { id: a.id, a, g, sel, casing, headCasing, trail, body, head, geo: this.geometry(a) };
      this.nodes.set(a.id, node);
      this.shape(node, 0);
      return node;
    }

    pointAt(geo, t) {
      const { ext, cum } = geo;
      if (t <= 0) return ext[0].slice();
      for (let i = 1; i < ext.length; i++) {
        if (t <= cum[i]) {
          const f = (t - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
          return [ext[i - 1][0] + (ext[i][0] - ext[i - 1][0]) * f, ext[i - 1][1] + (ext[i][1] - ext[i - 1][1]) * f];
        }
      }
      return ext[ext.length - 1].slice();
    }
    windowPts(geo, t0, t1) {
      const out = [this.pointAt(geo, t0)];
      for (let i = 1; i < geo.ext.length - 1; i++) if (geo.cum[i] > t0 && geo.cum[i] < t1) out.push(geo.ext[i]);
      out.push(this.pointAt(geo, t1));
      return out;
    }
    static pathD(pts) {
      let d = '';
      for (let i = 0; i < pts.length; i++) d += (i ? 'L' : 'M') + pts[i][0].toFixed(3) + ' ' + pts[i][1].toFixed(3);
      return d;
    }

    /** Draw the arrow slid `off` units along its own path. */
    shape(node, off) {
      const geo = node.geo, dir = node.a.dir;
      const bodyD = BoardView.pathD(this.windowPts(geo, off, off + geo.len - HEAD_BACK));
      const tip = this.pointAt(geo, off + geo.len + TIP);
      const base = this.pointAt(geo, off + geo.len - HEAD_BACK);
      const px = -E.DY[dir] * HEAD_HALF, py = E.DX[dir] * HEAD_HALF;
      const headD = `M${tip[0].toFixed(3)} ${tip[1].toFixed(3)}L${(base[0] + px).toFixed(3)} ${(base[1] + py).toFixed(3)}L${(base[0] - px).toFixed(3)} ${(base[1] - py).toFixed(3)}Z`;
      node.body.setAttribute('d', bodyD);
      node.casing.setAttribute('d', bodyD);
      node.sel.setAttribute('d', bodyD);
      node.head.setAttribute('d', headD);
      node.headCasing.setAttribute('d', headD);
    }

    /* ---------------- animation loop ---------------- */
    addAnim(fn) {
      this.anims.add(fn);
      if (!this.raf) this.raf = requestAnimationFrame(this.loop);
    }
    loop(now) {
      for (const fn of Array.from(this.anims)) {
        let keep = false;
        try { keep = fn(now); } catch (e) { keep = false; }
        if (!keep) this.anims.delete(fn);
      }
      this.raf = this.anims.size ? requestAnimationFrame(this.loop) : 0;
    }
    get busy() { return this.anims.size > 0; }

    distToEdge(a) {
      const [hx, hy] = a.cells[a.cells.length - 1];
      return [hy + 0.5, this.p.cols - hx - 0.5, this.p.rows - hy - 0.5, hx + 0.5][a.dir];
    }

    /** Successful release: the whole arrow slithers out along its path. */
    escape(id) {
      const node = this.nodes.get(id);
      if (!node) return;
      this.nodes.delete(id);
      if (this.selected === id) this.selected = -1;
      node.g.classList.remove('is-hint', 'is-selected', 'is-pressed');
      if (reducedMotion()) {
        node.g.style.transition = 'opacity 160ms ease';
        node.g.style.opacity = '0';
        setTimeout(() => node.g.remove(), 180);
        return;
      }
      const geo = node.geo;
      const edge = this.distToEdge(node.a);
      const total = geo.len + edge + EXIT_GLIDE_CELLS;
      const sp = escapeSpeed();
      const dur = clamp(sp.baseMs + total * sp.perCellMs, sp.minMs, sp.maxMs);
      const fadeFrom = geo.len + edge;   // tail reaches the board edge here
      const start = performance.now();
      let burst = false;
      node.trail.style.display = '';
      node.g.style.pointerEvents = 'none';
      this.addAnim((now) => {
        const t = Math.min(1, (now - start) / dur);
        const e = 1 - Math.pow(1 - t, sp.ease); // launches on the tap, in step with the sound
        const off = total * e;
        this.shape(node, off);
        const trailFrom = Math.max(0, off - 2);
        node.trail.setAttribute('d', BoardView.pathD(this.windowPts(geo, trailFrom, off)));
        node.trail.style.opacity = String(0.35 * (1 - t));
        // Fully visible while any part is on the board; fade only past the edge.
        node.g.style.opacity = off <= fadeFrom ? '1' : String(Math.max(0, 1 - (off - fadeFrom) / EXIT_GLIDE_CELLS));
        if (!burst && off >= edge) {
          burst = true;
          const hd = geo.pts[geo.pts.length - 1];
          this.burst(hd[0] + E.DX[node.a.dir] * edge, hd[1] + E.DY[node.a.dir] * edge, node.a.dir, node.a.color);
        }
        if (t >= 1) { node.g.remove(); return false; }
        return true;
      });
    }

    burst(x, y, dir, color) {
      const parts = [];
      for (let i = 0; i < 7; i++) {
        const c = s('circle', { r: 0.05 + Math.random() * 0.05, cx: x, cy: y });
        c.style.fill = `var(--a${color})`;
        this.gFx.append(c);
        const spread = (Math.random() - 0.5) * 1.6;
        const speed = 1.2 + Math.random() * 1.6;
        parts.push({ c, vx: E.DX[dir] * speed + -E.DY[dir] * spread, vy: E.DY[dir] * speed + E.DX[dir] * spread });
      }
      const start = performance.now();
      this.addAnim((now) => {
        const t = (now - start) / 420;
        for (const q of parts) {
          q.c.setAttribute('cx', x + q.vx * t * 0.6);
          q.c.setAttribute('cy', y + q.vy * t * 0.6);
          q.c.style.opacity = String(Math.max(0, 1 - t));
        }
        if (t >= 1) { parts.forEach((q) => q.c.remove()); return false; }
        return true;
      });
    }

    /** Blocked release: nudge forward and back, flash the blocker,
        and draw the corridor up to where it hits. */
    blocked(id, blocker) {
      const node = this.nodes.get(id);
      if (!node) return;
      const a = node.a;
      const hd = node.geo.pts[node.geo.pts.length - 1];
      const bx = hd[0] + E.DX[a.dir] * (blocker.steps - 0.28), by = hd[1] + E.DY[a.dir] * (blocker.steps - 0.28);
      const tx = hd[0] + E.DX[a.dir] * (TIP + 0.1), ty = hd[1] + E.DY[a.dir] * (TIP + 0.1);
      const fx = [s('path', { class: 'ray ray-blocked', d: `M${tx} ${ty}L${bx} ${by}` })];
      const r = 0.13;
      fx.push(s('path', { class: 'hit-x', d: `M${bx - r} ${by - r}L${bx + r} ${by + r}M${bx + r} ${by - r}L${bx - r} ${by + r}` }));
      fx.forEach((f) => this.gFx.append(f));
      const bnode = this.nodes.get(blocker.id);
      if (bnode) {
        bnode.g.classList.remove('is-blocker'); // re-adding next frame restarts the CSS animation
        requestAnimationFrame(() => bnode.g.classList.add('is-blocker'));
        setTimeout(() => bnode.g.classList.remove('is-blocker'), 650);
      }
      const start = performance.now();
      const moving = !reducedMotion();
      if (moving) node.busy = (node.busy || 0) + 1;
      this.addAnim((now) => {
        const t = Math.min(1, (now - start) / 700);
        if (moving) {
          const k = Math.min(1, (now - start) / 300);
          const amp = Math.min(0.3, blocker.steps - 0.62);
          if (this.nodes.get(id) === node) this.shape(node, Math.max(0, amp * Math.sin(Math.PI * k) * (1 - 0.3 * k)));
          if (k >= 1 && node.busy) { node.busy--; if (this.nodes.get(id) === node) this.shape(node, 0); }
        }
        fx.forEach((f) => { f.style.opacity = String(1 - t * t); });
        if (t >= 1) { fx.forEach((f) => f.remove()); return false; }
        return true;
      });
    }

    exitRay(id, cls) {
      const node = this.nodes.get(id);
      if (!node) return null;
      const a = node.a, hd = node.geo.pts[node.geo.pts.length - 1];
      const edge = this.distToEdge(a);
      const tx = hd[0] + E.DX[a.dir] * (TIP + 0.12), ty = hd[1] + E.DY[a.dir] * (TIP + 0.12);
      const ex = hd[0] + E.DX[a.dir] * (edge + 0.4), ey = hd[1] + E.DY[a.dir] * (edge + 0.4);
      const blocker = this.board.firstBlocker(id);
      let endX = ex, endY = ey;
      if (blocker) {
        endX = hd[0] + E.DX[a.dir] * (blocker.steps - 0.3);
        endY = hd[1] + E.DY[a.dir] * (blocker.steps - 0.3);
      }
      const p = s('path', { class: 'ray ' + cls, d: `M${tx} ${ty}L${endX} ${endY}` });
      this.gUnder.append(p);
      return p;
    }

    showHint(id) {
      const node = this.nodes.get(id);
      if (!node) return;
      node.g.classList.remove('is-hint');
      requestAnimationFrame(() => node.g.classList.add('is-hint'));
      const ray = this.exitRay(id, 'ray-clear');
      clearTimeout(node.hintTimer);
      node.hintTimer = setTimeout(() => {
        node.g.classList.remove('is-hint');
        if (ray) ray.remove();
      }, 2600);
    }

    /* Hold preview: a gold line to the edge if the way is clear; if not, a
       red line up to the arrow in the way, and that arrow is highlighted. */
    showPress(id, on) {
      const node = this.nodes.get(id);
      if (this.pressRay) { this.pressRay.remove(); this.pressRay = null; }
      if (this.pressNode) { this.pressNode.g.classList.remove('is-pressed'); this.pressNode = null; }
      if (this.pressBlocker) { this.pressBlocker.g.classList.remove('is-in-the-way'); this.pressBlocker = null; }
      if (!node || !on) return;
      node.g.classList.add('is-pressed');
      this.pressNode = node;
      if (!Save.data.settings.preview) return;
      const blocker = this.board.firstBlocker(id);
      this.pressRay = this.exitRay(id, blocker ? 'ray-preview-blocked' : 'ray-preview-clear');
      if (blocker) {
        const b = this.nodes.get(blocker.id);
        if (b) { b.g.classList.add('is-in-the-way'); this.pressBlocker = b; }
      }
    }

    setSelected(id) {
      const prev = this.nodes.get(this.selected);
      if (prev) prev.g.classList.remove('is-selected');
      this.selected = id;
      const node = this.nodes.get(id);
      if (node) node.g.classList.add('is-selected');
    }

    showOrder(on) {
      this.gLabels.textContent = '';
      if (!on) return;
      let n = 1;
      for (const id of this.p.solution) {
        const node = this.nodes.get(id);
        if (!node) continue;
        const [x, y] = node.geo.pts[0];
        const t = s('text', { class: 'order-label', x, y });
        t.textContent = n++;
        this.gLabels.append(t);
      }
    }

    /* ---------------- zoom & pan ---------------- */
    base() { return { x: -1.1, y: -1.1, w: this.p.cols + 2.2, h: this.p.rows + 2.2 }; }
    fit() {
      const b = this.base();
      this.zoom = { scale: 1, cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
      this.applyView();
      this.updateDensity();
    }
    maxScale() {
      const r = this.svg.getBoundingClientRect();
      const b = this.base();
      const fitPx = Math.min(r.width / b.w, r.height / b.h) || 20;
      return clamp(72 / fitPx, 1.5, 6);
    }
    applyView() {
      if (!this.p) return;
      const b = this.base();
      const z = this.zoom;
      const w = b.w / z.scale, hgt = b.h / z.scale;
      z.cx = w >= b.w ? b.x + b.w / 2 : clamp(z.cx, b.x + w / 2, b.x + b.w - w / 2);
      z.cy = hgt >= b.h ? b.y + b.h / 2 : clamp(z.cy, b.y + hgt / 2, b.y + b.h - hgt / 2);
      this.svg.setAttribute('viewBox', `${(z.cx - w / 2).toFixed(3)} ${(z.cy - hgt / 2).toFixed(3)} ${w.toFixed(3)} ${hgt.toFixed(3)}`);
    }
    clientToBoard(x, y) {
      const m = this.svg.getScreenCTM();
      if (!m) return null;
      const inv = m.inverse();
      return { x: inv.a * x + inv.c * y + inv.e, y: inv.b * x + inv.d * y + inv.f, pxPerUnit: m.a };
    }
    zoomBy(f, clientX, clientY) {
      const z = this.zoom;
      const next = clamp(z.scale * f, 1, this.maxScale());
      if (next === z.scale) return;
      let P = null;
      if (clientX != null) P = this.clientToBoard(clientX, clientY);
      if (P) {
        z.cx = P.x - (P.x - z.cx) * (z.scale / next);
        z.cy = P.y - (P.y - z.cy) * (z.scale / next);
      }
      z.scale = next;
      this.applyView();
      this.updateDensity();
    }
    panBy(dxPx, dyPx) {
      const m = this.svg.getScreenCTM();
      if (!m) return;
      this.zoom.cx -= dxPx / m.a;
      this.zoom.cy -= dyPx / m.d;
      this.applyView();
    }
    cellPx() {
      const m = this.svg.getScreenCTM();
      return m ? m.a : 0;
    }

    /** Nearest arrow to a screen point. The touch target is much wider
        than the stroke: up to ~0.8 cell or 24px, whichever is larger. */
    hitTest(clientX, clientY) {
      const P = this.clientToBoard(clientX, clientY);
      if (!P) return null;
      const thr = clamp(24 / (P.pxPerUnit || 30), 0.5, 0.85);
      let best = null, bestD = Infinity;
      for (const node of this.nodes.values()) {
        const pts = node.geo.pts;
        const hd = pts[pts.length - 1];
        const tip = [hd[0] + E.DX[node.a.dir] * TIP, hd[1] + E.DY[node.a.dir] * TIP];
        const all = pts.concat([tip]);
        for (let i = 1; i < all.length; i++) {
          const d = segDist(P.x, P.y, all[i - 1], all[i]);
          if (d < bestD) { bestD = d; best = node.id; }
        }
      }
      return bestD <= thr ? best : null;
    }
  }
  function segDist(px, py, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const L = vx * vx + vy * vy || 1;
    const t = clamp(((px - a[0]) * vx + (py - a[1]) * vy) / L, 0, 1);
    const x = a[0] + vx * t - px, y = a[1] + vy * t - py;
    return Math.sqrt(x * x + y * y);
  }

  /* ======================================================================
     INPUT — tap to release, drag to pan (when zoomed), pinch/wheel zoom,
     keyboard selection. Taps and pans are separated by a movement threshold.
     ====================================================================== */
  /* A press shorter than HOLD_MS is a tap and releases the arrow. Holding
     longer shows the arrow's exit path instead, and letting go after a hold
     does nothing, so checking a path never costs a blocked tap or a heart. */
  const HOLD_MS = 320;

  class Input {
    /** `handler` supplies release(id) and inputLocked(); defaults to the main game. */
    constructor(view, svg, handler) {
      this.view = view;
      this.svg = svg;
      this.h = handler || Game;
      this.pointers = new Map();
      this.tap = false;
      this.pressId = null;
      this.pressTimer = 0;
      this.pinch = null;
      svg.addEventListener('pointerdown', (e) => this.down(e));
      svg.addEventListener('pointermove', (e) => this.move(e));
      svg.addEventListener('pointerup', (e) => this.up(e));
      svg.addEventListener('pointercancel', (e) => this.up(e, true));
      svg.addEventListener('wheel', (e) => {
        if (!view.p) return;
        e.preventDefault();
        view.zoomBy(Math.exp(-e.deltaY * 0.0018), e.clientX, e.clientY);
      }, { passive: false });
      svg.addEventListener('keydown', (e) => this.key(e));
      svg.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    down(e) {
      if (!this.view.p || this.h.inputLocked()) return;
      try { this.svg.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
      if (this.pointers.size === 1) {
        this.tap = true;
        this.held = false;
        this.pressId = this.view.hitTest(e.clientX, e.clientY);
        clearTimeout(this.pressTimer);
        if (this.pressId != null) {
          const id = this.pressId;
          this.pressTimer = setTimeout(() => {
            if (!this.tap) return;
            this.held = true;              // now a hold: show the path, don't release on let-go
            this.view.showPress(id, true);
          }, HOLD_MS);
        }
      } else {
        this.cancelTap();
        const [a, b] = Array.from(this.pointers.values());
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      }
    }
    cancelTap() {
      this.tap = false;
      clearTimeout(this.pressTimer);
      this.view.showPress(null, false);
    }
    move(e) {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.pointers.size >= 2 && this.pinch) {
        const [a, b] = Array.from(this.pointers.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        this.view.zoomBy(d / this.pinch.d, mx, my);
        this.view.panBy(mx - this.pinch.mx, my - this.pinch.my);
        this.pinch = { d, mx, my };
        return;
      }
      if (this.tap && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 10) this.cancelTap();
      if (!this.tap && this.view.zoom.scale > 1.01) this.view.panBy(dx, dy);
    }
    up(e, cancelled) {
      const had = this.pointers.has(e.pointerId);
      const wasTap = this.tap && !this.held && this.pointers.size === 1 && !cancelled;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (!had) return;
      clearTimeout(this.pressTimer);
      this.view.showPress(null, false);
      if (wasTap) {
        const id = this.view.hitTest(e.clientX, e.clientY);
        if (id != null) this.h.release(id);
      }
      this.tap = false;
      this.held = false;
    }
    key(e) {
      if (!this.view.p || this.h.inputLocked()) return;
      const ids = Array.from(this.view.nodes.keys());
      if (!ids.length) return;
      ids.sort((a, b) => {
        const A = this.view.p.arrows[a].cells, B = this.view.p.arrows[b].cells;
        const ha = A[A.length - 1], hb = B[B.length - 1];
        return ha[1] - hb[1] || ha[0] - hb[0];
      });
      let i = ids.indexOf(this.view.selected);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { i = (i + 1) % ids.length; this.view.setSelected(ids[i]); e.preventDefault(); announceArrow(this.view.p, ids[i]); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { i = i <= 0 ? ids.length - 1 : i - 1; this.view.setSelected(ids[i]); e.preventDefault(); announceArrow(this.view.p, ids[i]); }
      else if ((e.key === 'Enter' || e.key === ' ') && this.view.selected >= 0) {
        e.preventDefault();
        const id = this.view.selected;
        const pos = ids.indexOf(id);
        this.h.release(id);
        if (!this.view.nodes.has(id)) {
          const rest = ids.filter((x) => x !== id);
          if (rest.length) this.view.setSelected(rest[Math.min(pos, rest.length - 1)]);
        }
      }
    }
  }
  function announceArrow(puzzle, id) {
    const a = puzzle.arrows[id];
    const [x, y] = a.cells[a.cells.length - 1];
    announce(`Arrow pointing ${E.DIR_NAMES[a.dir]}, head at column ${x + 1}, row ${y + 1}, ${a.cells.length} cells long`);
  }

  /* ======================================================================
     GAME SESSION
     A session is the saved state of one board: which mode and key it came
     from, which arrows are gone, and the counters for this attempt.
     ====================================================================== */
  function newSession(mode, key, diff) {
    if (mode === 'campaign') diff = E.campaignLevelInfo(Number(key)).diff;
    if (mode === 'daily') diff = E.dailyInfo(key).diff;
    return { mode, key: String(key), diff, gen: E.GENERATOR_VERSION, hearts: usesHearts(mode) ? MAX_HEARTS : null, removed: [], taps: 0, success: 0, blocked: 0, hints: 0, elapsed: 0, assisted: false, done: false, total: 0 };
  }
  const counted = (sess) => sess.mode !== 'debug' && !sess.assisted;
  /* Hearts: Campaign and Daily allow three blocked taps. The third ends
     the run and the board resets. Zen and the sandbox have no limit. */
  const MAX_HEARTS = 3;
  function usesHearts(mode) { return mode === 'campaign' || mode === 'daily'; }
  const HEART_PATH = 'M12 20.5s-7.3-4.5-9.3-9C1.3 8.3 3.3 4.5 6.9 4.5c2.1 0 3.6 1.2 5.1 3 1.5-1.8 3-3 5.1-3 3.6 0 5.6 3.8 4.2 7-2 4.5-9.3 9-9.3 9z';
  function renderHearts(sess, lostIndex) {
    const box = $('#game-hearts');
    const on = !!sess && usesHearts(sess.mode);
    $('#hud-hearts-item').hidden = !on;
    $('#hud-blocked-item').hidden = on;
    if (!on) return;
    box.textContent = '';
    const left = Math.max(0, sess.hearts);
    box.setAttribute('aria-label', `${left} of ${MAX_HEARTS} hearts left`);
    for (let i = 0; i < MAX_HEARTS; i++) {
      const full = i < left;
      const svg = s('svg', { viewBox: '0 0 24 24', class: 'heart' + (full ? '' : ' is-empty') + (i === lostIndex ? ' is-breaking' : '') });
      svg.append(s('path', { d: HEART_PATH }));
      box.append(svg);
    }
  }

  const Game = {
    session: null,
    puzzle: null,
    board: null,
    view: null,
    combo: 0,
    lastHint: { id: -1, at: 0 },
    solving: 0,
    loadToken: 0,

    inputLocked() {
      return !this.board || !this.session || this.session.done || !$('#complete-overlay').hidden || !$('#confirm-overlay').hidden;
    },

    /** Open a board. Resumes the saved session if it matches, else starts fresh. */
    open(mode, key, diff, opts) {
      opts = opts || {};
      const act = Save.data.active;
      let sess;
      const matches = act && !act.done && act.gen === E.GENERATOR_VERSION && act.mode === mode && String(act.key) === String(key) && (mode === 'campaign' || mode === 'daily' || act.diff === diff);
      if (matches && !opts.fresh) sess = act;
      else {
        sess = newSession(mode, key, diff);
        recordStart(sess);
      }
      if (usesHearts(sess.mode) && sess.hearts == null) sess.hearts = Math.max(1, MAX_HEARTS - sess.blocked);
      Save.data.active = sess;
      this.session = sess;
      this.stopSolve();
      $('#debug-out').textContent = '';
      showScreen('game');
      this.renderHeader();
      this.updateHud();
      const token = ++this.loadToken;
      const loading = $('#board-loading');
      loading.hidden = false;
      this.board = null;
      // Let the loading state paint before generating on the main thread.
      requestAnimationFrame(() => setTimeout(() => {
        if (token !== this.loadToken) return;
        let puzzle;
        try { puzzle = puzzleFor(sess); }
        catch (e) { loading.hidden = true; toast('Could not build this board. Try another.'); return; }
        const valid = sess.removed.filter((id) => id >= 0 && id < puzzle.arrows.length);
        sess.removed = Array.from(new Set(valid));
        sess.total = puzzle.arrows.length;
        this.puzzle = puzzle;
        this.board = new E.BoardState(puzzle, sess.removed);
        this.view.load(puzzle, this.board);
        this.view.showOrder(this.showingOrder);
        loading.hidden = true;
        this.combo = 0;
        this.renderHeader();
        this.updateHud();
        this.updateDebug();
        Save.write();
        if (this.board.count === 0) this.finish();
        if (usesHearts(sess.mode) && !Save.data.seenHeartsTip) {
          Save.data.seenHeartsTip = true;
          toast('You have 3 hearts. Each blocked tap costs one.');
        }
      }, 16));
    },

    renderHeader() {
      renderHearts(this.session);
      const sess = this.session;
      const chip = $('#game-diff');
      chip.textContent = diffLabel(sess.diff);
      chip.className = 'diff-chip diff-' + sess.diff;
      let mode = '', name = '';
      if (sess.mode === 'campaign') { mode = 'Campaign'; name = 'Level ' + sess.key; }
      else if (sess.mode === 'daily') { mode = 'Daily Puzzle'; name = shortDate(sess.key); }
      else if (sess.mode === 'zen') { mode = 'Zen'; name = 'Board ' + ((Save.data.zen.session.count || 0) + 1); }
      else { mode = 'Sandbox · not counted'; name = 'Seed ' + sess.key; }
      $('#game-mode').textContent = mode;
      $('#game-name').textContent = name;
      document.title = `${name} · Slipstream`;
    },

    updateHud() {
      const sess = this.session;
      if (!sess) return;
      const total = this.puzzle && this.board ? this.puzzle.arrows.length : sess.total;
      const left = this.board ? this.board.count : '…';
      $('#hud-left').textContent = left;
      $('#hud-time').textContent = fmtTime(sess.elapsed);
      $('#hud-blocked').textContent = sess.blocked;
      $('#hud-hints').textContent = sess.hints;
      $('#hud-bar').style.width = total && this.board ? `${pct(total - this.board.count, total)}%` : '0%';
      const flag = $('#hud-perfect');
      const onTrack = sess.blocked === 0 && sess.hints === 0 && !sess.assisted;
      flag.textContent = onTrack ? '★ Perfect run' : 'No perfect';
      flag.classList.toggle('is-lost', !onTrack);
      flag.hidden = sess.mode === 'debug';
      $('#btn-hint').disabled = !this.board || sess.done;
    },

    release(id) {
      const sess = this.session;
      if (!this.board || !sess || sess.done || !this.board.alive.has(id)) return;
      const st = Save.data.stats;
      const count = counted(sess);
      sess.taps++;
      if (count) st.taps++;
      const blocker = this.board.firstBlocker(id);
      if (blocker) {
        sess.blocked++;
        if (count) st.blocked++;
        this.combo = 0;
        this.view.blocked(id, blocker);
        Sound.play('blocked');
        if (navigator.vibrate && !reducedMotion()) { try { navigator.vibrate(18); } catch (e) { /* ignore */ } }
        if (usesHearts(sess.mode) && !sess.assisted) {
          sess.hearts = Math.max(0, sess.hearts - 1);
          renderHearts(sess, sess.hearts);
          if (sess.hearts === 0) {
            announce('Blocked. Out of hearts.');
            this.updateHud();
            this.fail();
            return;
          }
          announce(`Blocked. ${sess.hearts} heart${sess.hearts === 1 ? '' : 's'} left.`);
        } else announce('Blocked. Another arrow is in the way.');
      } else {
        this.board.remove(id);
        sess.removed.push(id);
        sess.success++;
        if (count) {
          st.success++;
          st.arrows++;
          if (sess.mode === 'zen') Save.data.zen.arrows++;
        }
        this.combo++;
        this.view.escape(id);
        Sound.play('escape', this.combo - 1);
        if (this.showingOrder) this.view.showOrder(true);
        announce(this.board.count ? `Released. ${this.board.count} left.` : 'Board cleared.');
        if (this.board.count === 0) this.finish();
      }
      this.updateHud();
      this.updateDebug();
      Save.soon();
    },

    hint() {
      const sess = this.session;
      if (!this.board || !sess || sess.done || this.inputLocked()) return;
      const id = this.board.hint();
      if (id == null) return;
      const now = performance.now();
      // Pressing Hint again while the same arrow is still glowing is free.
      if (!(this.lastHint.id === id && now - this.lastHint.at < 2600)) {
        sess.hints++;
        if (counted(sess)) Save.data.stats.hints++;
        this.lastHint = { id, at: now };
        Sound.play('hint');
      }
      this.view.showHint(id);
      const a = this.puzzle.arrows[id];
      announce(`Hint: the arrow pointing ${E.DIR_NAMES[a.dir]} with its head at column ${a.cells[a.cells.length - 1][0] + 1}, row ${a.cells[a.cells.length - 1][1] + 1} can escape.`);
      this.updateHud();
      Save.soon();
    },

    finish() {
      const sess = this.session;
      if (sess.done) return;
      sess.done = true;
      this.stopSolve();
      const result = recordFinish(sess, this.puzzle);
      Save.write();
      const wait = reducedMotion() ? 250 : 650;
      setTimeout(() => showComplete(sess, this.puzzle, result), wait);
    },

    fail() {
      const sess = this.session;
      if (sess.done) return;
      sess.done = true;
      sess.failed = true;
      this.stopSolve();
      if (counted(sess)) {
        const st = Save.data.stats;
        st.failed = (st.failed || 0) + 1;
        st.perfectStreak = 0;
        if (sess.mode === 'campaign') {
          const lv = Save.data.campaign.levels;
          lv[sess.key] = Object.assign({ plays: 1 }, lv[sess.key]);
          lv[sess.key].fails = (lv[sess.key].fails || 0) + 1;
        } else if (sess.mode === 'daily') {
          const hist = Save.data.daily.history;
          hist[sess.key] = Object.assign({ attempted: true }, hist[sess.key]);
          hist[sess.key].fails = (hist[sess.key].fails || 0) + 1;
        }
      }
      Save.data.active = null;
      Save.write();
      setTimeout(() => showFailed(sess, this.puzzle), reducedMotion() ? 250 : 750);
    },

    restart() {
      const sess = this.session;
      if (!sess) return;
      confirmDialog({
        title: 'Restart this board?',
        body: '<p>All arrows return. Time, blocked taps and hints start from zero, so a perfect clear is possible again.</p>',
        ok: 'Restart',
      }).then((yes) => {
        if (!yes) return;
        Save.data.active = null;
        this.open(sess.mode, sess.key, sess.diff, { fresh: true });
      });
    },

    leave() {
      this.stopSolve();
      this.loadToken++;
      const mode = this.session ? this.session.mode : 'home';
      Save.write();
      showScreen(mode === 'debug' ? 'home' : mode);
    },

    /* ---- developer tools ---- */
    autoSolve() {
      if (!this.board || this.session.done) return;
      this.session.assisted = true;
      this.updateHud();
      const step = () => {
        if (!this.board || this.session.done || currentScreen !== 'game') { this.solving = 0; return; }
        const id = this.board.hint();
        if (id == null) { this.solving = 0; return; }
        this.release(id);
        this.solving = setTimeout(step, clamp(2400 / this.puzzle.arrows.length, 45, 160));
      };
      this.stopSolve();
      step();
    },
    stopSolve() { clearTimeout(this.solving); this.solving = 0; },
    showingOrder: false,

    updateDebug() {
      if ($('#debug-panel').hidden || !this.puzzle || !this.board) return;
      const p = this.puzzle;
      const rows = [
        ['Seed', p.seed],
        ['Difficulty', `${diffLabel(p.diff)} (t=${p.t.toFixed(2)})`],
        ['Board', `${p.cols} × ${p.rows} · ${p.shape}`],
        ["Arrows", `${p.arrows.length} · avg ${(p.arrows.reduce((t, a) => t + a.cells.length, 0) / p.arrows.length).toFixed(1)} cells`],
        ['Known solution', `${p.solution.length} moves`],
        ['Dependency depth', `${p.meta.depth} waves`],
        ['Opening moves', `${p.meta.initialFree}`],
        ['Free right now', `${this.board.freeArrows().length}`],
        ['Generator attempts', `${p.meta.attempts} · ${p.meta.genMs} ms`],
        ['Empty cells', `${p.meta.emptyCells || 0}`],
      ];
      const dl = $('#debug-info');
      dl.textContent = '';
      for (const [k, v] of rows) dl.append(h('dt', { text: k }), h('dd', { text: v }));
    },
  };

  /* ======================================================================
     STATISTICS RECORDING
     ====================================================================== */
  function recordStart(sess) {
    if (sess.mode === 'debug') return;
    Save.data.stats.played++;
    if (sess.mode === 'daily') {
      const hist = Save.data.daily.history;
      hist[sess.key] = Object.assign({}, hist[sess.key], { attempted: true, diff: sess.diff });
    }
    if (sess.mode === 'campaign') {
      const lv = Save.data.campaign.levels;
      lv[sess.key] = Object.assign({ plays: 0 }, lv[sess.key]);
      lv[sess.key].plays++;
    }
  }

  /* STARS: 1 for clearing a board, 2 for clearing it without hints,
     3 for a perfect clear (no hints and no blocked taps). */
  const MAX_STARS = 3;
  function starsFor(sess) {
    if (sess.hints > 0) return 1;
    return sess.blocked > 0 ? 2 : 3;
  }
  function campaignStars() {
    const lv = Save.data.campaign.levels;
    let n = 0;
    for (const k in lv) n += lv[k].stars || 0;
    return n;
  }
  /** Older saves have no stars: give completed levels 3 if perfect, else 1. */
  function migrateStars() {
    const lv = Save.data.campaign.levels;
    for (const k in lv) if (lv[k].completed && !lv[k].stars) lv[k].stars = lv[k].perfect ? 3 : 1;
    const hist = Save.data.daily.history;
    for (const k in hist) if (hist[k].completed && !hist[k].stars) hist[k].stars = hist[k].perfect ? 3 : 1;
  }
  const STAR_PATH = 'M12 2.6l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.3l-5.8 3.1 1.2-6.5-4.8-4.5 6.5-.8z';
  function starIcons(n, cls) {
    const wrap = h('span', { class: 'stars ' + (cls || ''), 'aria-hidden': 'true' });
    for (let i = 0; i < MAX_STARS; i++) {
      const svg = s('svg', { viewBox: '0 0 24 24', class: 'star' + (i < n ? ' is-on' : '') });
      svg.append(s('path', { d: STAR_PATH }));
      wrap.append(svg);
    }
    return wrap;
  }

  function recordFinish(sess, puzzle) {
    const res = { perfect: false, counted: counted(sess), time: sess.elapsed, notes: [], stars: starsFor(sess) };
    if (!res.counted) {
      res.notes.push(sess.mode === 'debug' ? 'Sandbox board. Nothing was recorded.' : 'Solved with developer tools, so it was not recorded.');
      Save.data.active = null;
      return res;
    }
    const st = Save.data.stats;
    const perfect = sess.blocked === 0 && sess.hints === 0;
    res.perfect = perfect;
    st.completed++;
    if (perfect) {
      st.perfect++;
      st.perfectStreak++;
      st.bestPerfectStreak = Math.max(st.bestPerfectStreak, st.perfectStreak);
    } else st.perfectStreak = 0;
    const d = sess.diff;
    if (st.fastest[d] == null || sess.elapsed < st.fastest[d]) { st.fastest[d] = sess.elapsed; res.fastest = true; }
    const n = puzzle.arrows.length;
    if (!st.largest || n > st.largest.arrows) st.largest = { arrows: n, cols: puzzle.cols, rows: puzzle.rows, diff: d };
    st.deepest = Math.max(st.deepest || 0, puzzle.meta.depth);
    if (d === 'hard' && (st.fewestBlockedHard == null || sess.blocked < st.fewestBlockedHard)) st.fewestBlockedHard = sess.blocked;

    if (sess.mode === 'campaign') {
      const L = Number(sess.key);
      const lv = Save.data.campaign.levels;
      const rec = Object.assign({ plays: 1 }, lv[L]);
      if (rec.bestTime == null || sess.elapsed < rec.bestTime) { if (rec.completed) res.notes.push('New best time for this level'); rec.bestTime = sess.elapsed; }
      rec.bestBlocked = rec.bestBlocked == null ? sess.blocked : Math.min(rec.bestBlocked, sess.blocked);
      rec.completed = true;
      rec.perfect = !!rec.perfect || perfect;
      if (rec.stars && res.stars > rec.stars) res.notes.push(`New best: ${res.stars} stars`);
      rec.stars = Math.max(rec.stars || 0, res.stars);
      rec.clears = (rec.clears || 0) + 1;
      lv[L] = rec;
      if (L < E.CAMPAIGN_LENGTH && Save.data.campaign.unlocked <= L) {
        Save.data.campaign.unlocked = L + 1;
        res.unlocked = L + 1;
        res.notes.push(`Level ${L + 1} unlocked`);
      }
      if (L === E.CAMPAIGN_LENGTH) res.notes.push('That was the final level. Campaign complete!');
    } else if (sess.mode === 'daily') {
      const hist = Save.data.daily.history;
      const rec = Object.assign({ attempted: true }, hist[sess.key]);
      if (!rec.completed) {
        rec.completed = true;
        rec.time = sess.elapsed;
        rec.perfect = perfect;
        rec.stars = res.stars;
        rec.diff = sess.diff;
      }
      hist[sess.key] = rec;
      const sk = dailyStreaks();
      Save.data.daily.longestStreak = Math.max(Save.data.daily.longestStreak || 0, sk.longest);
      res.streak = sk.current;
      res.notes.push(sk.current > 1 ? `Daily streak: ${sk.current} days` : 'Daily streak started');
    } else if (sess.mode === 'zen') {
      const z = Save.data.zen;
      z.boards[d] = (z.boards[d] || 0) + 1;
      if (perfect) z.perfect++;
      z.session.count = (z.session.count || 0) + 1;
      z.longestSession = Math.max(z.longestSession || 0, z.session.count);
      res.sessionCount = z.session.count;
      res.notes.push(`${z.session.count} board${z.session.count === 1 ? '' : 's'} this session`);
    }
    if (res.fastest && sess.mode !== 'campaign') res.notes.push(`Fastest ${diffLabel(d)} clear yet`);
    if (perfect && st.perfectStreak > 1) res.notes.push(`${st.perfectStreak} perfect clears in a row`);
    Save.data.active = null;
    return res;
  }

  /* ======================================================================
     SCREENS
     ====================================================================== */
  let currentScreen = null;
  const renderers = {};
  function showScreen(name) {
    if (!document.getElementById('screen-' + name)) name = 'home';
    for (const sc of $$('.screen')) sc.hidden = sc.dataset.screen !== name;
    currentScreen = name;
    Save.data.route = name;
    if (name !== 'game') {
      document.title = 'Slipstream';
      $('#complete-overlay').hidden = true;
      clearTimeout(zenTimer);
    }
    if (renderers[name]) renderers[name]();
    Save.soon();
    const scr = $('#screen-' + name);
    if (name !== 'game') scr.scrollTop = 0;
  }

  /* ---------------- Home ---------------- */
  renderers.home = function () {
    const lb = Save.data.lastBackup ? Date.parse(Save.data.lastBackup) : 0;
    $('#home-backup-nudge').hidden = !(Save.data.stats.completed >= 5 && Date.now() - lb > 30 * 864e5);
    HeroStream.start();
    const act = Save.data.active;
    const cont = $('#home-continue');
    if (act && !act.done && act.mode !== 'debug') {
      cont.hidden = false;
      let title = '';
      if (act.mode === 'campaign') title = `Level ${act.key} · ${diffLabel(act.diff)}`;
      else if (act.mode === 'daily') title = act.key === dateKey() ? `Today's Daily · ${diffLabel(act.diff)}` : `Daily ${shortDate(act.key)}`;
      else title = `Zen · ${diffLabel(act.diff)}`;
      $('#home-continue-title').textContent = title;
      const left = act.total ? act.total - act.removed.length : null;
      $('#home-continue-sub').textContent = (left != null ? `${left} arrows left · ` : '') + fmtTime(act.elapsed);
    } else cont.hidden = true;

    const lv = Save.data.campaign.levels;
    const done = Object.keys(lv).filter((k) => lv[k].completed).length;
    const un = Save.data.campaign.unlocked;
    $('#home-campaign-sub').textContent = done ? `${done} cleared · ★ ${campaignStars()} · next up: Level ${Math.min(un, E.CAMPAIGN_LENGTH)}` : `${E.CAMPAIGN_LENGTH} levels · Easy to ${diffLabel(E.DIFFICULTY_ORDER[E.DIFFICULTY_ORDER.length - 1])}`;
    $('#home-campaign-bar').style.width = `${pct(done, E.CAMPAIGN_LENGTH)}%`;

    const today = dateKey();
    const info = E.dailyInfo(today);
    const rec = Save.data.daily.history[today];
    const sk = dailyStreaks();
    $('#home-daily-sub').textContent = `${shortDate(today)} · ${diffLabel(info.diff)}`;
    const badge = $('#home-daily-badge');
    if (rec && rec.completed) { badge.hidden = false; badge.textContent = rec.perfect ? '★ Perfect' : '✓ Solved'; badge.classList.add('is-done'); }
    else if (sk.current > 0) { badge.hidden = false; badge.textContent = `${sk.current}-day streak`; badge.classList.remove('is-done'); }
    else badge.hidden = true;

    const z = Save.data.zen;
    const zt = Object.values(z.boards).reduce((a, b) => a + b, 0);
    $('#home-zen-sub').textContent = zt ? `${fmtNum(zt)} boards cleared · endless` : 'Endless boards, no final level';
  };

  /* ---------------- Campaign ---------------- */
  renderers.campaign = function () {
    const wrap = $('#campaign-tiers');
    wrap.textContent = '';
    const lv = Save.data.campaign.levels;
    const unlocked = Save.data.campaign.unlocked;
    let total = 0;
    for (const tier of E.CAMPAIGN_TIERS) {
      const grid = h('div', { class: 'level-grid' });
      let done = 0, tierStars = 0;
      for (let L = tier.from; L <= tier.to; L++) {
        const rec = lv[L] || {};
        if (rec.completed) done++;
        const locked = L > unlocked;
        const cls = ['level', 'tier-' + tier.diff];
        if (rec.completed) cls.push('is-done');
        if (rec.perfect) cls.push('is-perfect');
        if (L === unlocked && !rec.completed) cls.push('is-next');
        const label = locked ? `Level ${L}, locked`
          : `Level ${L}, ${diffLabel(tier.diff)}${rec.completed ? `, ${rec.stars || 1} of 3 stars` : ''}${rec.bestTime != null ? ', best time ' + fmtTime(rec.bestTime) : ''}`;
        const btn = h('button', { class: cls.join(' '), type: 'button', disabled: locked, 'aria-label': label, 'data-level': L,
          title: rec.bestTime != null ? `Best time ${fmtTime(rec.bestTime)}` : null },
          h('span', { class: 'level-num', text: String(L) }),
          rec.completed ? starIcons(rec.stars || 1, 'tiny') : null);
        tierStars += rec.stars || 0;
        grid.append(btn);
      }
      total += done;
      const count = tier.to - tier.from + 1;
      wrap.append(h('section', { class: 'tier' },
        h('div', { class: 'tier-head' },
          h('h3', null, h('span', { class: 'diff-chip diff-' + tier.diff, text: diffLabel(tier.diff) }), `Levels ${tier.from}–${tier.to}`),
          h('span', { class: 'tier-count' }, `${done} / ${count}`, h('span', { class: 'tier-stars', text: ` · ★ ${tierStars}/${count * 3}` }))),
        grid));
    }
    $('#campaign-count').textContent = `★ ${campaignStars()} / ${E.CAMPAIGN_LENGTH * 3}`;
    const next = wrap.querySelector('.is-next');
    if (next) requestAnimationFrame(() => next.scrollIntoView({ block: 'center', behavior: 'auto' }));
  };
  $('#campaign-tiers').addEventListener('click', (e) => {
    const b = e.target.closest('.level');
    if (!b || b.disabled) return;
    Sound.play('tap');
    Game.open('campaign', Number(b.dataset.level));
  });

  /* ---------------- Daily ---------------- */
  let calMonth = null; // [year, monthIndex]
  renderers.daily = function () {
    const today = dateKey();
    const d = parseKey(today);
    const info = E.dailyInfo(today);
    $('#daily-weekday').textContent = WEEKDAYS[d.getDay()];
    $('#daily-day').textContent = d.getDate();
    $('#daily-month').textContent = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    const chip = $('#daily-diff');
    chip.textContent = diffLabel(info.diff);
    chip.className = 'diff-chip diff-' + info.diff;
    const rec = Save.data.daily.history[today];
    const act = Save.data.active;
    const play = $('#daily-play');
    const status = $('#daily-status');
    play.disabled = false;
    if (rec && rec.completed) {
      status.textContent = `Solved in ${fmtTime(rec.time)}${rec.perfect ? ' · ★ Perfect clear' : ''}. A new board arrives tomorrow.`;
      play.textContent = 'Solved today';
      play.disabled = true;
    } else if (act && act.mode === 'daily' && act.key === today) {
      status.textContent = `In progress · ${act.total ? act.total - act.removed.length + ' arrows left · ' : ''}${fmtTime(act.elapsed)}`;
      play.textContent = 'Continue';
    } else {
      status.textContent = (rec && rec.fails ? `Out of hearts ${rec.fails}× so far. Try again, the board is the same. ` : 'Same board for everyone who plays today. ') + '3 hearts per try.';
      play.textContent = "Play today's puzzle";
    }
    const sk = dailyStreaks();
    const tot = dailyTotals();
    $('#daily-streak').textContent = sk.current;
    $('#daily-best').textContent = sk.longest;
    $('#daily-done').textContent = tot.completed;
    $('#daily-perfect').textContent = tot.perfect;
    if (!calMonth) calMonth = [d.getFullYear(), d.getMonth()];
    renderCalendar();
  };
  function renderCalendar() {
    const [y, m] = calMonth;
    const today = dateKey();
    const hist = Save.data.daily.history;
    const first = Object.keys(hist).sort()[0] || today;
    $('#cal-title').textContent = `${MONTHS[m]} ${y}`;
    const grid = $('#cal-grid');
    grid.textContent = '';
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((n) => grid.append(h('div', { class: 'cal-dow', role: 'columnheader', text: n })));
    const lead = new Date(y, m, 1, 12).getDay();
    const days = new Date(y, m + 1, 0, 12).getDate();
    for (let i = 0; i < lead; i++) grid.append(h('div', { class: 'cal-day', 'aria-hidden': 'true' }));
    for (let day = 1; day <= days; day++) {
      const k = `${y}-${pad2(m + 1)}-${pad2(day)}`;
      const rec = hist[k];
      const cls = ['cal-day'];
      let mark = '', desc = 'not played';
      if (rec && rec.perfect) { cls.push('is-perfect'); mark = '★'; desc = 'perfect clear'; }
      else if (rec && rec.completed) { cls.push('is-done'); mark = '✓'; desc = 'completed'; }
      else if (k < today && k >= first) { mark = '•'; desc = 'missed'; }
      if (k === today) { cls.push('is-today'); if (!rec || !rec.completed) desc = 'today, not solved yet'; }
      if (k > today) { cls.push('is-future'); desc = 'upcoming'; }
      const mk = mark === '★' ? 'mark-perfect' : mark === '✓' ? 'mark-done' : 'mark-missed';
      grid.append(h('div', { class: cls.join(' '), role: 'gridcell', 'aria-label': `${MONTHS[m]} ${day}: ${desc}` },
        h('span', { text: String(day) }), h('i', { class: 'mark ' + mk, 'aria-hidden': 'true', text: mark })));
    }
    const now = new Date();
    $('#cal-next').disabled = y > now.getFullYear() || (y === now.getFullYear() && m >= now.getMonth());
  }
  $('#cal-prev').addEventListener('click', () => { let [y, m] = calMonth; m--; if (m < 0) { m = 11; y--; } calMonth = [y, m]; renderCalendar(); });
  $('#cal-next').addEventListener('click', () => { let [y, m] = calMonth; m++; if (m > 11) { m = 0; y++; } calMonth = [y, m]; renderCalendar(); });
  $('#daily-play').addEventListener('click', () => { Sound.play('tap'); Game.open('daily', dateKey()); });

  /* ---------------- Zen ---------------- */
  renderers.zen = function () {
    const box = $('#zen-choices');
    box.textContent = '';
    const z = Save.data.zen;
    for (const id of E.DIFFICULTY_ORDER) {
      const d = E.DIFFICULTIES[id];
      box.append(h('button', { class: 'zen-choice', type: 'button', role: 'listitem', 'data-diff': id, 'aria-label': `Start Zen on ${d.label}. ${z.boards[id] || 0} boards cleared.` },
        h('span', { class: 'diff-chip diff-' + id, text: d.label }),
        h('p', { text: d.blurb }),
        h('span', { class: 'zen-count' }, h('strong', { text: fmtNum(z.boards[id] || 0) }), h('span', { text: 'cleared' }))));
    }
    const act = Save.data.active;
    const cont = $('#zen-continue');
    if (act && act.mode === 'zen' && !act.done) {
      cont.hidden = false;
      $('#zen-continue-title').textContent = `${diffLabel(act.diff)} · ${act.total ? act.total - act.removed.length + ' arrows left' : 'in progress'}`;
    } else cont.hidden = true;
  };
  $('#zen-choices').addEventListener('click', (e) => {
    const b = e.target.closest('.zen-choice');
    if (!b) return;
    Sound.play('tap');
    startZen(b.dataset.diff);
  });
  $('#zen-continue').addEventListener('click', () => {
    const act = Save.data.active;
    if (act && act.mode === 'zen') Game.open('zen', act.key, act.diff);
  });
  function startZen(diff) {
    Save.data.zen.session = { diff, count: 0 };
    Game.open('zen', newZenSeed(), diff, { fresh: true });
  }
  function nextZen() {
    const diff = (Game.session && Game.session.diff) || Save.data.zen.session.diff || 'easy';
    Game.open('zen', newZenSeed(), diff, { fresh: true });
  }

  /* ---------------- Stats ---------------- */
  renderers.stats = function () {
    const st = Save.data.stats;
    const lv = Save.data.campaign.levels;
    const z = Save.data.zen;
    const tot = dailyTotals();
    const sk = dailyStreaks();
    const acc = pct(st.success, st.taps);
    const body = $('#stats-body');
    body.textContent = '';

    const big = (v, k, sub, cls) => h('div', { class: 'big-stat' + (cls ? ' ' + cls : '') }, h('span', { class: 'v', text: v }), h('span', { class: 'k', text: k }), sub ? h('span', { class: 'sub', text: sub }) : null);
    const row = (k, v) => h('div', { class: 'stat-row' }, h('span', { class: 'k', text: k }), h('span', { class: 'v', text: v }));
    const section = (title, ...kids) => h('section', { class: 'stats-section' }, h('h3', { text: title }), ...kids);
    const meter = (label, n, max, color) => h('div', { class: 'meter' },
      h('span', { text: label }),
      h('span', { class: 'bar', role: 'img', 'aria-label': `${label}: ${n} of ${max}` }, h('span', { style: `width:${pct(n, max)}%;--c:${color}` })),
      h('span', { class: 'n', text: `${n} / ${max}` }));

    body.append(h('div', { class: 'stats-hero' },
      big(fmtNum(st.completed), 'Puzzles completed', `${pct(st.completed, st.played)}% of ${fmtNum(st.played)} started`),
      big(fmtNum(st.perfect), 'Perfect clears', 'No blocked taps, no hints', 'accent'),
      big(fmtNum(st.arrows), 'Arrows escaped'),
      big(st.taps ? acc + '%' : '—', 'Tap accuracy', `${fmtNum(st.success)} of ${fmtNum(st.taps)} taps`)));

    if (!st.played) body.append(h('p', { class: 'empty-note', text: 'Play a board and your numbers will start filling in here.' }));

    body.append(section('General', h('div', { class: 'stat-rows' },
      row('Puzzles played', fmtNum(st.played)),
      row('Puzzles completed', fmtNum(st.completed)),
      row('Completion rate', st.played ? pct(st.completed, st.played) + '%' : '—'),
      row('Perfect clears', fmtNum(st.perfect)),
      row('Boards lost (out of hearts)', fmtNum(st.failed || 0)),
      row('Total play time', fmtDuration(st.playMs)))));

    const ring = (() => {
      const r = 26, c = 2 * Math.PI * r, f = st.taps ? st.success / st.taps : 0;
      const svg = s('svg', { viewBox: '0 0 64 64', role: 'img', 'aria-label': `Accuracy ${acc} percent` });
      const bg = s('circle', { cx: 32, cy: 32, r, fill: 'none', 'stroke-width': 7 }); bg.style.stroke = 'var(--surface-2)';
      const fg = s('circle', { cx: 32, cy: 32, r, fill: 'none', 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-dasharray': `${(c * f).toFixed(2)} ${c.toFixed(2)}`, transform: 'rotate(-90 32 32)' });
      fg.style.stroke = 'var(--good)';
      const tx = s('text', { x: 32, y: 36.5, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 800 });
      tx.style.fill = 'var(--text)';
      tx.textContent = st.taps ? acc + '%' : '—';
      svg.append(bg, fg, tx);
      return h('div', { class: 'accuracy-ring' }, svg, h('span', { class: 'k', style: 'color:var(--muted)', text: 'Successful releases out of every arrow you tapped. Hints never count as blocked taps.' }));
    })();
    body.append(section('Arrows', ring, h('div', { class: 'stat-rows' },
      row('Arrows escaped', fmtNum(st.arrows)),
      row('Total taps', fmtNum(st.taps)),
      row('Successful taps', fmtNum(st.success)),
      row('Blocked taps', fmtNum(st.blocked)),
      row('Tap accuracy', st.taps ? acc + '%' : '—'),
      row('Hints used', fmtNum(st.hints)))));

    const doneBy = {}, perfectCamp = { n: 0 };
    let campDone = 0;
    for (const tier of E.CAMPAIGN_TIERS) {
      doneBy[tier.diff] = 0;
      for (let L = tier.from; L <= tier.to; L++) if (lv[L] && lv[L].completed) { doneBy[tier.diff]++; campDone++; if (lv[L].perfect) perfectCamp.n++; }
    }
    body.append(section('Campaign',
      h('div', { class: 'meter-block' }, E.CAMPAIGN_TIERS.map((t) => meter(diffLabel(t.diff), doneBy[t.diff], t.to - t.from + 1, DIFF_COLOR[t.diff] || 'var(--accent)'))),
      h('div', { class: 'stat-rows' },
        row('Highest level unlocked', `Level ${Save.data.campaign.unlocked}`),
        row('Levels completed', `${campDone} / ${E.CAMPAIGN_LENGTH}`),
        ...E.CAMPAIGN_TIERS.map((t) => row(`${diffLabel(t.diff)} levels completed`, `${doneBy[t.diff] || 0} / ${t.to - t.from + 1}`)),
        row('Campaign perfect clears', `${perfectCamp.n}`),
        row('Campaign stars', `★ ${campaignStars()} / ${E.CAMPAIGN_LENGTH * 3}`))));

    body.append(section('Daily', h('div', { class: 'stat-rows' },
      row('Daily puzzles attempted', fmtNum(tot.attempted)),
      row('Daily puzzles completed', fmtNum(tot.completed)),
      row('Current streak', `${sk.current} day${sk.current === 1 ? '' : 's'}`),
      row('Longest streak', `${sk.longest} day${sk.longest === 1 ? '' : 's'}`),
      row('Perfect daily clears', fmtNum(tot.perfect)))));

    const zt = E.DIFFICULTY_ORDER.reduce((a, d) => a + (z.boards[d] || 0), 0);
    body.append(section('Zen', h('div', { class: 'stat-rows' },
      row('Zen boards completed', fmtNum(zt)),
      ...E.DIFFICULTY_ORDER.map((d) => row(`${diffLabel(d)} Zen boards`, fmtNum(z.boards[d] || 0))),
      row('Zen perfect clears', fmtNum(z.perfect)),
      row('Longest Zen session', `${z.longestSession || 0} board${z.longestSession === 1 ? '' : 's'}`),
      row('Zen arrows escaped', fmtNum(z.arrows)))));

    body.append(section('Records', h('div', { class: 'stat-rows' },
      ...E.DIFFICULTY_ORDER.map((d) => row(`Fastest ${diffLabel(d)} clear`, fmtTime(st.fastest[d]))),
      row('Largest puzzle completed', st.largest ? `${st.largest.arrows} arrows · ${st.largest.cols}×${st.largest.rows}` : '—'),
      row('Most arrows in one clear', st.largest ? fmtNum(st.largest.arrows) : '—'),
      row('Longest chain cleared', st.deepest ? `${st.deepest} waves deep` : '—'),
      row('Longest perfect streak', fmtNum(st.bestPerfectStreak)),
      row('Current perfect streak', fmtNum(st.perfectStreak)),
      row('Fewest blocked taps on Hard', st.fewestBlockedHard == null ? '—' : fmtNum(st.fewestBlockedHard)))));
  };

  /* ---------------- Settings ---------------- */
  let versionTaps = 0;
  renderers.settings = function () {
    renderBackupStatus();
    const st = Save.data.settings;
    $('#set-sound').checked = !!st.sound;
    $('#set-motion').value = st.motion;
    $('#set-speed').value = ESCAPE_SPEEDS[st.speed] ? st.speed : 'normal';
    $('#set-contrast').checked = !!st.highContrast;
    $('#set-preview').checked = !!st.preview;
    $('#set-dev').checked = !!st.dev;
    $('#set-dev-row').hidden = !st.dev && versionTaps < 5;
  };
  $('#set-sound').addEventListener('change', (e) => { Save.data.settings.sound = e.target.checked; Save.soon(); if (e.target.checked) Sound.play('hint'); });
  $('#set-motion').addEventListener('change', (e) => { Save.data.settings.motion = e.target.value; applySettings(); Save.soon(); });
  $('#set-speed').addEventListener('change', (e) => { Save.data.settings.speed = e.target.value; Save.soon(); });
  $('#set-contrast').addEventListener('change', (e) => { Save.data.settings.highContrast = e.target.checked; applySettings(); Save.soon(); });
  $('#set-preview').addEventListener('change', (e) => { Save.data.settings.preview = e.target.checked; Save.soon(); });
  $('#set-dev').addEventListener('change', (e) => { Save.data.settings.dev = e.target.checked; applySettings(); Save.soon(); });
  $('#version-tap').addEventListener('click', () => {
    versionTaps++;
    if (versionTaps === 5) { $('#set-dev-row').hidden = false; toast('Developer tools unlocked'); }
  });
  $('#reset-open').addEventListener('click', () => {
    confirmDialog({
      title: 'Reset all progress?',
      body: '<p>This will permanently erase:</p><ul><li>Campaign progress</li><li>Statistics</li><li>Daily history and streaks</li><li>Zen records</li><li>Any board in progress</li></ul><p class="hold-note">Press and hold Reset to confirm. Your settings stay as they are.</p>',
      ok: 'Reset',
      danger: true,
      hold: 1200,
    }).then((yes) => {
      if (!yes) return;
      Save.reset();
      puzzleCache.clear();
      calMonth = null;
      toast('All progress erased');
      showScreen('home');
    });
  });
  if (motionQuery && motionQuery.addEventListener) motionQuery.addEventListener('change', applySettings);

  /* ======================================================================
     OVERLAYS — confirm dialog (in-page; native confirm() is unavailable
     in some embeds) and the completion sheet.
     ====================================================================== */
  let confirmResolve = null;
  function confirmDialog(o) {
    const ov = $('#confirm-overlay');
    $('#confirm-title').textContent = o.title;
    $('#confirm-body').innerHTML = o.body || '';
    const ok = $('#confirm-ok');
    ok.className = o.danger ? 'danger-btn is-armed hold-btn' : 'primary-btn';
    ok.innerHTML = '';
    ok.append(o.hold ? h('span', { class: 'hold-fill' }) : '', o.hold ? 'Hold to reset' : o.ok);
    ok.dataset.hold = o.hold || '';
    ov.hidden = false;
    $('#confirm-cancel').focus();
    return new Promise((res) => { confirmResolve = res; });
  }
  function closeConfirm(v) {
    $('#confirm-overlay').hidden = true;
    const r = confirmResolve;
    confirmResolve = null;
    if (r) r(v);
  }
  $('#confirm-cancel').addEventListener('click', () => closeConfirm(false));
  $('#confirm-overlay').addEventListener('click', (e) => { if (e.target.id === 'confirm-overlay') closeConfirm(false); });
  (function holdButton() {
    const ok = $('#confirm-ok');
    let t0 = 0, raf = 0;
    const stop = () => { cancelAnimationFrame(raf); raf = 0; const f = $('.hold-fill', ok); if (f) f.style.transform = 'scaleX(0)'; };
    ok.addEventListener('click', () => { if (!ok.dataset.hold) closeConfirm(true); });
    ok.addEventListener('keydown', (e) => { if (ok.dataset.hold && (e.key === 'Enter' || e.key === ' ')) e.preventDefault(); });
    ok.addEventListener('pointerdown', (e) => {
      const need = Number(ok.dataset.hold);
      if (!need) return;
      e.preventDefault();
      t0 = performance.now();
      const tick = (now) => {
        const f = Math.min(1, (now - t0) / need);
        const fill = $('.hold-fill', ok);
        if (fill) fill.style.transform = `scaleX(${f})`;
        if (f >= 1) { stop(); closeConfirm(true); return; }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => ok.addEventListener(ev, () => { if (raf) stop(); }));
  })();

  let zenTimer = 0;
  function showComplete(sess, puzzle, res) {
    if (currentScreen !== 'game' || Game.session !== sess) return;
    const ov = $('#complete-overlay');
    $$('.zen-next', ov).forEach((n) => n.remove());
    const sheet = $('.complete-sheet', ov);
    sheet.classList.remove('is-failed');
    sheet.classList.toggle('is-perfect', res.perfect);
    let kicker = '';
    if (sess.mode === 'campaign') kicker = `Level ${sess.key} · ${diffLabel(sess.diff)}`;
    else if (sess.mode === 'daily') kicker = `Daily · ${shortDate(sess.key)}`;
    else if (sess.mode === 'zen') kicker = `Zen · ${diffLabel(sess.diff)}`;
    else kicker = 'Sandbox';
    $('#complete-kicker').textContent = kicker;
    $('#complete-title').textContent = res.perfect ? 'Perfect' : 'Cleared';
    const starBox = $('#complete-stars');
    starBox.textContent = '';
    starBox.hidden = !res.counted;
    if (res.counted) {
      starBox.append(starIcons(res.stars, 'big'));
      starBox.setAttribute('aria-label', `${res.stars} of ${MAX_STARS} stars`);
      if (res.stars === 1) res.notes.push('Clear it without hints for 2 stars');
      else if (res.stars === 2) res.notes.push('Clear it without a blocked tap for 3 stars');
    }
    if (usesHearts(sess.mode) && res.counted && sess.hearts < MAX_HEARTS) res.notes.push(`${sess.hearts} of ${MAX_HEARTS} hearts left`);
    $('#complete-note').textContent = res.notes.join(' · ');
    const stats = $('#complete-stats');
    stats.textContent = '';
    [[fmtTime(sess.elapsed), 'time'], [puzzle.arrows.length, 'arrows'], [sess.blocked, 'blocked'], [sess.hints, 'hints']]
      .forEach(([v, k]) => stats.append(h('div', null, h('strong', { text: String(v) }), h('span', { text: k }))));

    const burst = $('.burst', ov);
    burst.textContent = '';
    if (!reducedMotion()) {
      const n = res.perfect ? 20 : 12;
      for (let i = 0; i < n; i++) {
        const c = res.perfect && i % 2 === 0 ? 'var(--gold)' : `var(--a${i % 8})`;
        burst.append(h('i', { style: `--c:${c};--r:${(360 / n) * i}deg;animation-delay:${(i % 3) * 50}ms` }));
      }
    }

    const acts = $('#complete-actions');
    acts.textContent = '';
    const btn = (label, cls, fn) => h('button', { class: cls, type: 'button', onclick: fn, text: label });
    clearTimeout(zenTimer);
    if (sess.mode === 'campaign') {
      const L = Number(sess.key);
      acts.append(btn('All levels', 'ghost-btn', () => showScreen('campaign')));
      if (L < E.CAMPAIGN_LENGTH) acts.append(btn(`Level ${L + 1} →`, 'primary-btn', () => { ov.hidden = true; Game.open('campaign', L + 1); }));
      else acts.append(btn('Replay level', 'primary-btn', () => { ov.hidden = true; Game.open('campaign', L, null, { fresh: true }); }));
    } else if (sess.mode === 'daily') {
      acts.append(btn('Home', 'ghost-btn', () => showScreen('home')));
      acts.append(btn('See calendar', 'primary-btn', () => showScreen('daily')));
    } else if (sess.mode === 'zen') {
      const dur = 2400;
      const next = h('div', { class: 'zen-next' }, 'Next board in a moment', h('div', { class: 'bar' }, h('span', { style: `--dur:${dur}ms` })));
      $('#complete-note').after(next);
      acts.append(btn('Stop here', 'ghost-btn', () => { clearTimeout(zenTimer); showScreen('zen'); }));
      acts.append(btn('Next board', 'primary-btn', () => { clearTimeout(zenTimer); ov.hidden = true; nextZen(); }));
      zenTimer = setTimeout(() => { if (currentScreen === 'game' && !ov.hidden) { ov.hidden = true; nextZen(); } }, dur);
    } else {
      acts.append(btn('Close', 'ghost-btn', () => { ov.hidden = true; }));
      acts.append(btn('New seed', 'primary-btn', () => { ov.hidden = true; debugAction('newseed'); }));
    }
    ov.hidden = false;
    const primary = acts.querySelector('.primary-btn');
    if (primary) primary.focus();
    if (sess.mode === 'daily' && res.counted) Sound.play('daily');
    Sound.play(res.perfect ? 'perfect' : 'complete');
    announce(`${res.perfect ? 'Perfect clear' : 'Board cleared'} in ${fmtTime(sess.elapsed)}. ${res.notes.join('. ')}`);
  }

  function showFailed(sess, puzzle) {
    if (currentScreen !== 'game' || Game.session !== sess) return;
    const ov = $('#complete-overlay');
    $$('.zen-next', ov).forEach((n) => n.remove());
    const sheet = $('.complete-sheet', ov);
    sheet.classList.remove('is-perfect');
    sheet.classList.add('is-failed');
    $('#complete-stars').hidden = true;
    $('.burst', ov).textContent = '';
    $('#complete-kicker').textContent = sess.mode === 'campaign' ? `Level ${sess.key} · ${diffLabel(sess.diff)}` : `Daily · ${shortDate(sess.key)}`;
    $('#complete-title').textContent = 'Out of hearts';
    $('#complete-note').textContent = 'Three blocked taps ends the run. The board resets when you try again.';
    const stats = $('#complete-stats');
    stats.textContent = '';
    [[fmtTime(sess.elapsed), 'time'], [`${sess.removed.length}/${puzzle.arrows.length}`, 'cleared'], [sess.blocked, 'blocked'], [sess.hints, 'hints']]
      .forEach(([v, k]) => stats.append(h('div', null, h('strong', { text: String(v) }), h('span', { text: k }))));
    const acts = $('#complete-actions');
    acts.textContent = '';
    const btn = (label, cls, fn) => h('button', { class: cls, type: 'button', onclick: fn, text: label });
    acts.append(sess.mode === 'campaign'
      ? btn('All levels', 'ghost-btn', () => showScreen('campaign'))
      : btn('Home', 'ghost-btn', () => showScreen('home')));
    acts.append(btn('Try again', 'primary-btn', () => { ov.hidden = true; Game.open(sess.mode, sess.key, sess.diff, { fresh: true }); }));
    ov.hidden = false;
    acts.querySelector('.primary-btn').focus();
    Sound.play('fail');
    announce('Out of hearts. Press Try again to restart the board.');
  }

  /* ======================================================================
     DEBUG / DEVELOPER TOOLS (hidden: Settings → tap the version line
     five times → enable Developer tools; or open with #debug)
     ====================================================================== */
  function debugAction(kind) {
    const out = $('#debug-out');
    const p = Game.puzzle;
    if (kind === 'newseed') {
      const diff = (Game.session && Game.session.diff) || 'medium';
      Game.open('debug', newZenSeed(), diff, { fresh: true });
      $('#debug-panel').hidden = false;
      out.textContent = 'Generated a sandbox board. It does not affect stats.';
      return;
    }
    if (!p || !Game.board) return;
    if (kind === 'validate') {
      const t0 = performance.now();
      const full = E.analyze(p);
      const now = E.analyze(p, Game.session.removed);
      const replay = E.verifySolution(p, p.solution);
      out.textContent = `Full board: ${full.solvable ? 'solvable' : 'NOT solvable'} (${full.depth} waves, ${full.initialFree} opening moves). ` +
        `From here: ${now.solvable ? 'solvable in ' + now.depth + ' more waves' : 'stuck'}. Stored solution replays: ${replay ? 'yes' : 'NO'}. ` +
        `${(performance.now() - t0).toFixed(1)} ms.`;
    } else if (kind === 'order') {
      Game.showingOrder = !Game.showingOrder;
      Game.view.showOrder(Game.showingOrder);
      out.textContent = Game.showingOrder ? 'Numbers at each tail show the stored removal order.' : 'Solution order hidden.';
    } else if (kind === 'solve') {
      out.textContent = 'Auto-solving. This board will not count toward stats.';
      Game.autoSolve();
    }
    Game.updateDebug();
  }
  $('#btn-debug').addEventListener('click', () => {
    const panel = $('#debug-panel');
    panel.hidden = !panel.hidden;
    Game.updateDebug();
  });
  $('#debug-close').addEventListener('click', () => { $('#debug-panel').hidden = true; });
  $('.debug-actions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-debug]');
    if (b) debugAction(b.dataset.debug);
  });

  /* ======================================================================
     SMALL UI HELPERS
     ====================================================================== */
  let toastTimer = 0;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-on'), ms || 2400);
  }
  let liveTimer = 0;
  function announce(msg) {
    const l = $('#live');
    clearTimeout(liveTimer);
    l.textContent = '';
    liveTimer = setTimeout(() => { l.textContent = msg; }, 30);
  }
  const touchScreen = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  /* ======================================================================
     HOW TO PLAY — four short steps with small hand-made practice boards.
     Uses its own BoardView/BoardState, so nothing here touches progress
     or statistics. Shown automatically on a brand-new install.
     ====================================================================== */
  /** Build a practice puzzle from tail→head cell lists. */
  function practiceBoard(cols, rows, list) {
    const arrows = list.map((a, id) => {
      const [p, q] = [a.cells[a.cells.length - 2], a.cells[a.cells.length - 1]];
      const dir = q[0] > p[0] ? 1 : q[0] < p[0] ? 3 : q[1] > p[1] ? 2 : 0;
      return { id, dir, cells: a.cells, color: a.color };
    });
    const p = { cols, rows, mask: new Array(cols * rows).fill(1), arrows, solution: [], meta: {} };
    p.solution = E.analyze(p).order;
    return p;
  }
  const HOWTO_STEPS = [
    {
      title: 'Tap an arrow',
      text: 'Each arrow flies off the board in the direction its head points. Tap the arrow to set it free.',
      done: 'That’s it! It flew straight off the board.',
      board: () => practiceBoard(5, 3, [{ cells: [[0, 1], [1, 1], [2, 1]], color: 4 }]),
      pulse: 0,
    },
    {
      title: 'Arrows can block each other',
      text: 'An arrow can’t fly through another arrow. Try the arrow pointing right.',
      blocked: 'Blocked! The arrow pointing up is in the way. Tap it first, then try again.',
      cleared: 'The path is clear now. Tap the arrow pointing right.',
      done: 'Nice. Finding the right order is the whole game.',
      board: () => practiceBoard(5, 5, [
        { cells: [[0, 2], [1, 2], [2, 2]], color: 0 },
        { cells: [[3, 3], [3, 2], [3, 1]], color: 3 },
      ]),
      pulse: 0,
    },
    {
      title: 'Clear the whole board',
      text: 'Bent arrows follow their own path out. Start with arrows that have a clear way to the edge.',
      blocked: 'Blocked, but no harm done here. Look for an arrow with nothing in front of it.',
      done: 'You solved it! Every board works like this, just bigger.',
      board: () => practiceBoard(5, 5, [
        { cells: [[0, 0], [1, 0], [2, 0]], color: 0 },               // blocked by the bent one
        { cells: [[2, 1], [3, 1], [4, 1], [4, 0]], color: 4 },       // bent, free
        { cells: [[3, 2], [2, 2], [1, 2]], color: 6 },               // blocked by the one below
        { cells: [[0, 1], [0, 2], [0, 3]], color: 1 },               // blocked by the bottom one
        { cells: [[0, 4], [1, 4], [2, 4], [3, 4]], color: 3 },       // free
      ]),
    },
    { title: 'Good to know', tips: true },
  ];
  const HowTo = {
    step: 0, view: null, board: null, cleared: false, pulseTimer: 0,
    init() {
      this.view = new BoardView($('#howto-board'));
      new Input(this.view, $('#howto-board'), this);
      $('#howto-next').addEventListener('click', () => this.next());
      $('#howto-skip').addEventListener('click', () => this.finish());
    },
    open() {
      Save.data.seenHowTo = true;
      Save.soon();
      this.show(0);
    },
    show(i) {
      this.step = i;
      const st = HOWTO_STEPS[i];
      $('#howto-step').textContent = `Step ${i + 1} of ${HOWTO_STEPS.length}`;
      $('#howto-title').textContent = st.title;
      const dots = $('#howto-dots');
      dots.textContent = '';
      HOWTO_STEPS.forEach((_, k) => dots.append(h('i', { class: k === i ? 'is-on' : k < i ? 'is-done' : '' })));
      const last = i === HOWTO_STEPS.length - 1;
      $('#howto-skip').hidden = last;
      $('#howto-next').textContent = last ? 'Start playing' : 'Next';
      $('#howto-board-wrap').hidden = !!st.tips;
      $('#howto-tips').hidden = !st.tips;
      clearTimeout(this.pulseTimer);
      if (st.tips) {
        $('#howto-text').textContent = '';
        this.renderTips();
        this.board = null;
        $('#howto-next').disabled = false;
        return;
      }
      $('#howto-text').textContent = st.text;
      $('#howto-next').disabled = true;
      this.cleared = false;
      const p = st.board();
      this.board = new E.BoardState(p);
      requestAnimationFrame(() => {
        this.view.load(p, this.board);
        // Nudge a first-timer who hasn't tapped anything yet.
        if (st.pulse != null) this.pulseTimer = setTimeout(() => { if (this.board && this.board.alive.has(st.pulse)) this.view.showHint(st.pulse); }, 1600);
      });
    },
    renderTips() {
      const ICONS = {
        heart: '<path d="M12 20.5s-7.3-4.5-9.3-9C1.3 8.3 3.3 4.5 6.9 4.5c2.1 0 3.6 1.2 5.1 3 1.5-1.8 3-3 5.1-3 3.6 0 5.6 3.8 4.2 7-2 4.5-9.3 9-9.3 9z"/>',
        hint: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
        star: `<path d="${STAR_PATH}"/>`,
        pinch: '<path d="M7 7l-3-3M4 8V4h4M17 17l3 3M20 16v4h-4"/><circle cx="12" cy="12" r="2.2"/>',
        save: '<path d="M12 3v12M7 10l5 5 5-5M5 20h14"/>',
        path: '<path d="M4 12h8" /><path d="M14 12h2M19 12h1" stroke-dasharray="0" /><path d="M9 8l4 4-4 4" />',
      };
      const tips = [
        ['heart', 'Campaign and Daily give you 3 hearts. Each blocked tap costs one, and losing all 3 restarts the board.'],
        ['hint', 'Stuck? Tap Hint and a safe arrow lights up.'],
        ['path', 'Not sure where an arrow goes? Press and hold it to see its path. Letting go won’t move it.'],
        ['star', 'Earn up to 3 stars: clear the board, clear it without hints, then clear it without a single blocked tap.'],
        ['pinch', touchScreen() ? 'On big boards, use two fingers to zoom: spread them apart to zoom in, bring them together to zoom out. Drag with one finger to move around.' : 'On big boards, scroll to zoom in and out, and drag to move around.'],
        ['save', 'Your progress lives in this app. Removing the app deletes it, so make a backup in Settings first.'],
      ];
      const ul = $('#howto-tips');
      ul.innerHTML = tips.map(([k, t]) => `<li><svg viewBox="0 0 24 24" class="tip-${k}" aria-hidden="true">${ICONS[k]}</svg><span>${t}</span></li>`).join('');
    },
    inputLocked() { return !this.board || this.cleared || currentScreen !== 'howto'; },
    release(id) {
      const b = this.board, st = HOWTO_STEPS[this.step];
      if (!b || !b.alive.has(id)) return;
      clearTimeout(this.pulseTimer);
      const blocker = b.firstBlocker(id);
      if (blocker) {
        this.view.blocked(id, blocker);
        Sound.play('blocked');
        if (st.blocked) $('#howto-text').textContent = st.blocked;
        return;
      }
      b.remove(id);
      this.view.escape(id);
      Sound.play('escape', b.arrowsGone = (b.arrowsGone || 0) + 1);
      if (b.count === 0) {
        this.cleared = true;
        $('#howto-text').textContent = st.done;
        $('#howto-next').disabled = false;
        setTimeout(() => Sound.play('complete'), 250);
        setTimeout(() => $('#howto-next').focus(), 300);
      } else if (st.cleared && b.alive.has(0) && !b.firstBlocker(0)) {
        $('#howto-text').textContent = st.cleared;
        this.view.showHint(0);
      }
    },
    next() {
      if (this.step < HOWTO_STEPS.length - 1) { this.show(this.step + 1); return; }
      this.finish(true);
    },
    finish(play) {
      clearTimeout(this.pulseTimer);
      this.board = null;
      const lv = Save.data.campaign.levels;
      if (play && !(lv[1] && lv[1].completed)) Game.open('campaign', 1);
      else showScreen('home');
    },
  };
  renderers.howto = function () { HowTo.open(); };

  /* ======================================================================
     BACKUP & RESTORE — the whole save as one text code.
     Format: "SLIP1." + base64url(gzip(JSON)) where the browser can
     compress, otherwise "SLIP0." + base64url(JSON).
     ====================================================================== */
  const Backup = {
    toB64(bytes) {
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    fromB64(str) {
      str = str.replace(/-/g, '+').replace(/_/g, '/');
      while (str.length % 4) str += '=';
      const bin = atob(str);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },
    async pipe(bytes, stream) {
      const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
      return new Uint8Array(await res.arrayBuffer());
    },
    async encode() {
      Save.data.lastBackup = new Date().toISOString();
      const json = JSON.stringify({ app: 'slipstream', savedAt: Save.data.lastBackup, data: Save.data });
      const raw = new TextEncoder().encode(json);
      if (window.CompressionStream) {
        try { return 'SLIP1.' + this.toB64(await this.pipe(raw, new CompressionStream('gzip'))); } catch (e) { /* fall through */ }
      }
      return 'SLIP0.' + this.toB64(raw);
    },
    async decode(code) {
      code = String(code || '').replace(/\s+/g, '');
      const m = /^SLIP([01])\.([A-Za-z0-9_-]+)$/.exec(code);
      if (!m) throw new Error('That doesn’t look like a Slipstream backup code. Make sure you copied all of it.');
      let bytes = this.fromB64(m[2]);
      if (m[1] === '1') {
        if (!window.DecompressionStream) throw new Error('This browser is too old to read this backup. Try updating it.');
        bytes = await this.pipe(bytes, new DecompressionStream('gzip'));
      }
      const obj = JSON.parse(new TextDecoder().decode(bytes));
      if (!obj || obj.app !== 'slipstream' || !obj.data || !obj.data.campaign || !obj.data.stats) throw new Error('This backup is damaged or from a different app.');
      return obj;
    },
    fileName() { return `slipstream-backup-${dateKey()}.txt`; },
  };
  function renderBackupStatus() {
    const lb = Save.data.lastBackup;
    $('#backup-last').textContent = lb ? `Last backup: ${shortDate(dateKey(new Date(lb)))}, ${new Date(lb).getFullYear()}` : 'No backup yet';
  }
  $('#backup-copy').addEventListener('click', async () => {
    const box = $('#backup-code');
    let code;
    try { code = await Backup.encode(); } catch (e) { toast('Could not make a backup code on this device.'); return; }
    Save.write();
    renderBackupStatus();
    box.value = code;
    try {
      await navigator.clipboard.writeText(code);
      box.hidden = true;
      toast('Backup code copied. Paste it into Notes or a message to yourself.', 4200);
    } catch (e) {
      box.hidden = false;
      box.focus();
      box.select();
      toast('Copy this code and keep it somewhere safe.', 4200);
    }
  });
  $('#backup-file').addEventListener('click', async () => {
    let code;
    try { code = await Backup.encode(); } catch (e) { toast('Could not make a backup on this device.'); return; }
    Save.write();
    renderBackupStatus();
    const file = new File([code], Backup.fileName(), { type: 'text/plain' });
    try {
      // Phones: the share sheet offers "Save to Files", AirDrop, Messages and so on.
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Slipstream backup' });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
    const a = h('a', { href: URL.createObjectURL(file), download: Backup.fileName() });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Backup file saved.');
  });
  async function restoreFrom(code) {
    let obj;
    try { obj = await Backup.decode(code); } catch (e) { toast(e.message || 'That backup code didn’t work.', 4200); return; }
    const d = obj.data;
    const lv = d.campaign.levels || {};
    const levels = Object.keys(lv).filter((k) => lv[k].completed).length;
    const when = obj.savedAt ? `${shortDate(dateKey(new Date(obj.savedAt)))}, ${new Date(obj.savedAt).getFullYear()}` : 'an unknown date';
    const yes = await confirmDialog({
      title: 'Restore this backup?',
      body: `<p>Backup from ${when}: ${levels} campaign level${levels === 1 ? '' : 's'} cleared, ${fmtNum(d.stats.completed || 0)} boards completed.</p><p class="hold-note">This replaces the progress currently on this device.</p>`,
      ok: 'Restore',
    });
    if (!yes) return;
    Save.data = fillDefaults(d, defaultSave());
    Save.data.route = 'home';
    Save.data.seenHowTo = true;
    migrateStars();
    Save.write();
    puzzleCache.clear();
    calMonth = null;
    $('#restore-code').value = '';
    applySettings();
    showScreen('home');
    toast('Progress restored');
  }
  $('#restore-go').addEventListener('click', () => {
    const v = $('#restore-code').value.trim();
    if (!v) { toast('Paste a backup code first.'); $('#restore-code').focus(); return; }
    restoreFrom(v);
  });
  $('#restore-file').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { restoreFrom(await f.text()); } catch (err) { toast('Could not read that file.'); }
  });

  /* ======================================================================
     HERO STREAM — the arrows gliding past above the title.
     Three lanes; each lane has its own speed so arrows never overtake.
     Every arrow gets a random colour, length and shape: straight, or
     stepping up/down once or twice, always ending on a straight run so
     the head lines up (same proportions as the game pieces).
     ====================================================================== */
  const HeroStream = {
    svg: null, lanes: [], raf: 0, last: 0, W: 360, H: 118,
    LANE_Y: [24, 59, 94], JOG: 11, STROKE: 7, HEAD_LEN: 15, HEAD_HALF: 9,
    init() {
      this.svg = $('#hero-stream');
      this.resize();
      window.addEventListener('resize', () => this.resize());
      this.reset();
    },
    resize() {
      const r = this.svg.getBoundingClientRect();
      if (r.width) this.W = r.width;
      this.svg.setAttribute('viewBox', `0 0 ${this.W.toFixed(1)} ${this.H}`);
    },
    rand(a, b) { return a + Math.random() * (b - a); },
    /** Build one arrow's points, starting at x = 0 and ending at the head. */
    shape(baseY) {
      const levels = [baseY - this.JOG, baseY, baseY + this.JOG];
      const jogs = Math.random() < 0.35 ? 0 : Math.random() < 0.6 ? 1 : 2;
      const len = this.rand(50, 190);
      const pieces = jogs + 1;
      let y = jogs ? levels[Math.floor(Math.random() * 3)] : baseY;
      let x = 0;
      const pts = [[0, y]];
      for (let i = 0; i < pieces; i++) {
        const run = i === pieces - 1 ? Math.max(24, len / pieces) : Math.max(16, len / pieces * this.rand(0.6, 1.4));
        x += run;
        pts.push([x, y]);
        if (i < pieces - 1) {
          const others = levels.filter((v) => v !== y);
          y = others[Math.floor(Math.random() * others.length)];
          pts.push([x, y]);
        }
      }
      return { pts, width: x + this.HEAD_LEN };
    },
    makeArrow(lane) {
      const { pts, width } = this.shape(this.LANE_Y[lane.i]);
      const color = `var(--a${Math.floor(Math.random() * 8)})`;
      const g = s('g', { class: 'hs-arrow' });
      const body = s('path', { class: 'hs-body' });
      const head = s('path', { class: 'hs-head' });
      const [ex, ey] = pts[pts.length - 1];
      // Body stops at the head's base; the round cap tucks under the head.
      const bodyPts = pts.slice(0, -1).concat([[ex - 2, ey]]);
      body.setAttribute('d', bodyPts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1]).join(''));
      head.setAttribute('d', `M${(ex + this.HEAD_LEN).toFixed(1)} ${ey}L${(ex - 3).toFixed(1)} ${ey - this.HEAD_HALF}L${(ex - 3).toFixed(1)} ${ey + this.HEAD_HALF}Z`);
      body.style.stroke = color;
      head.style.fill = color;
      head.style.stroke = color;
      g.append(body, head);
      this.svg.append(g);
      return { g, width, x: 0 };
    },
    place(a) { a.g.setAttribute('transform', `translate(${a.x.toFixed(1)} 0)`); },
    reset() {
      this.svg.textContent = '';
      this.lanes = this.LANE_Y.map((_, i) => ({ i, speed: this.rand(45, 105), arrows: [], gap: this.rand(30, 140) }));
      const still = reducedMotion();
      for (const lane of this.lanes) {
        // Seed each lane with arrows already spread across the view.
        let x = this.rand(-120, 40);
        while (x < this.W) {
          const a = this.makeArrow(lane);
          a.x = x;
          this.place(a);
          lane.arrows.push(a);
          x += a.width + this.rand(still ? 40 : 30, still ? 120 : 160);
        }
        // Queue order: rightmost (next to leave) first, leftmost (newest) last.
        lane.arrows.reverse();
        lane.gap = this.rand(30, 160);
      }
    },
    start() {
      this.resize();
      if (reducedMotion()) { this.stop(); this.reset(); return; }
      if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame((t) => this.tick(t)); }
    },
    stop() { cancelAnimationFrame(this.raf); this.raf = 0; },
    tick(now) {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (currentScreen !== 'home' || reducedMotion()) { this.raf = 0; return; }
      if (!document.hidden) {
        for (const lane of this.lanes) {
          for (const a of lane.arrows) { a.x += lane.speed * dt; this.place(a); }
          // Drop arrows that have left; spawn a new one once the lane's
          // last arrow has moved far enough in.
          while (lane.arrows.length && lane.arrows[0].x > this.W + 4) lane.arrows.shift().g.remove();
          const lastA = lane.arrows[lane.arrows.length - 1];
          if (!lastA || lastA.x > lane.gap) {
            const a = this.makeArrow(lane);
            a.x = -a.width - 4;
            this.place(a);
            lane.arrows.push(a);
            lane.gap = this.rand(30, 160);
          }
        }
      }
      this.raf = requestAnimationFrame((t) => this.tick(t));
    },
  };

  /* ======================================================================
     WIRING & BOOT
     ====================================================================== */
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => { Sound.play('tap'); showScreen(b.dataset.go); }));
  $$('[data-back]').forEach((b) => b.addEventListener('click', () => { Sound.play('tap'); showScreen('home'); }));
  $('#home-continue').addEventListener('click', () => {
    const a = Save.data.active;
    if (a) { Sound.play('tap'); Game.open(a.mode, a.key, a.diff); }
  });
  $('#game-back').addEventListener('click', () => Game.leave());
  $('#btn-hint').addEventListener('click', () => Game.hint());
  $('#btn-restart').addEventListener('click', () => Game.restart());
  function zoomCenter(f) {
    const r = Game.view.svg.getBoundingClientRect();
    Game.view.zoomBy(f, r.left + r.width / 2, r.top + r.height / 2);
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (!$('#confirm-overlay').hidden) { if (e.key === 'Escape') closeConfirm(false); return; }
    if (e.key === 'Escape') {
      if (currentScreen === 'game') {
        if (!$('#debug-panel').hidden) { $('#debug-panel').hidden = true; return; }
        Game.leave();
      } else if (currentScreen !== 'home') showScreen('home');
      return;
    }
    if (currentScreen !== 'game' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!$('#complete-overlay').hidden) return;
    const k = e.key.toLowerCase();
    if (k === 'h') Game.hint();
    else if (k === '+' || k === '=') zoomCenter(1.35);
    else if (k === '-' || k === '_') zoomCenter(1 / 1.35);
    else if (k === '0') Game.view.fit();
  });

  // Play-time clock: only runs while a board is on screen and the tab is visible.
  let lastTick = performance.now(), sinceSave = 0;
  setInterval(() => {
    const now = performance.now();
    const dt = Math.min(now - lastTick, 1500);
    lastTick = now;
    const sess = Game.session;
    if (currentScreen !== 'game' || !sess || sess.done || !Game.board || document.hidden) return;
    if (!$('#complete-overlay').hidden || !$('#confirm-overlay').hidden) return;
    sess.elapsed += dt;
    if (counted(sess)) Save.data.stats.playMs += dt;
    $('#hud-time').textContent = fmtTime(sess.elapsed);
    sinceSave += dt;
    if (sinceSave > 4000) { sinceSave = 0; Save.soon(); }
  }, 250);

  window.addEventListener('resize', () => { if (Game.view && Game.view.p) Game.view.applyView(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) Save.write(); });
  window.addEventListener('pagehide', () => Save.write());
  // Unlock audio on the first gesture (browsers require it).
  window.addEventListener('pointerdown', () => { if (Save.data.settings.sound) Sound.ensure(); }, { once: true });

  function boot() {
    Save.load();
    if (/debug/.test(location.hash)) Save.data.settings.dev = true;
    migrateStars();
    if (Save.data.settings.sound) Sound.preload();
    HeroStream.init();
    Game.view = new BoardView($('#board'));
    new Input(Game.view, $('#board'));
    HowTo.init();
    applySettings();
    // A board saved by an older generator can't be rebuilt identically; drop it.
    if (Save.data.active && Save.data.active.gen !== E.GENERATOR_VERSION) Save.data.active = null;
    const a = Save.data.active;
    const brandNew = !Save.data.seenHowTo && Save.data.stats.played === 0 && !a;
    if (brandNew) showScreen('howto');
    else if (Save.data.route === 'game' && a && !a.done) Game.open(a.mode, a.key, a.diff);
    else showScreen(Save.data.route === 'game' ? 'home' : Save.data.route || 'home');
    if (!Save.ok) setTimeout(() => toast('This browser is blocking storage, so progress will not be saved.'), 600);
  }
  boot();

  // Exposed for console testing only.
  window.Slipstream = { Game, Save, E, Sound };
})();
