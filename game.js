/* ==========================================================================
   ARROW ESCAPE (formerly Slipstream) — game
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
  const DIFF_COLOR = { easy: 'var(--a3)', medium: 'var(--a1)', hard: 'var(--a0)', expert: 'var(--a6)', nightmare: 'var(--a7)', insane: 'var(--a0)', impossible: 'var(--text)', inconceivable: 'var(--a6)' };
  const diffLabel = (d) => (E.DIFFICULTIES[d] ? E.DIFFICULTIES[d].label : d);

  /* ======================================================================
     SAVE SYSTEM — one JSON document in localStorage.
     Missing keys are filled from defaults so older saves keep working.
     ====================================================================== */
  const SAVE_KEY = 'slipstream.save.v1'; // kept from the old name so everyone's progress carries over
  function defaultSave() {
    return {
      v: 1,
      settings: { sound: true, motion: 'auto', speed: 'normal', thickness: 'normal', outline: 'auto', colorblind: false, highContrast: false, preview: true, autoRelease: true, dev: false },
      campaign: { unlocked: 1, levels: {}, bonus: {} },
      daily: { history: {}, longestStreak: 0, unlocked: {} }, // unlocked: past days bought with coins
      startedOn: null, // first day this player opened the game
      pictures: { done: {} }, // picture index -> { completed, stars, perfect, bestTime, plays, clears }
      zen: { boards: {}, perfect: 0, arrows: 0, longestSession: 0, session: { diff: null, count: 0 }, recentSeeds: [], dim: '2d',
        boards3d: {}, perfect3d: 0, arrows3d: 0 }, // the 3D share of the totals above (2D = total − 3D)
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
      progress: {
        xp: 0, coins: 0, coinsEarned: 0, migrated: false,
        owned: { arrows: ['classic'], board: ['default'], trail: ['classic'] },
        equip: { arrows: 'classic', board: 'default', trail: 'classic' },
        login: { last: null, streak: 0, best: 0 }, // daily coins
      },
      milestones: {},   // id -> ISO date earned
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
    for (const k in THICKNESS) document.body.classList.toggle('aw-' + k, (st.thickness || 'normal') === k);
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
          // Board cleared: the fanfare. A perfect clear plays it two
          // semitones higher, so it sounds brighter than a normal clear.
          case 'complete':
            if (!this.sample('complete', 0.6, 1)) {
              [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.28, { type: 'triangle', vol: 0.08, delay: i * 0.08 }));
            }
            break;
          case 'perfect':
            if (!this.sample('complete', 0.62, Math.pow(2, 2 / 12))) {
              [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(f, 0.35, { type: 'triangle', vol: 0.075, delay: i * 0.07 }));
              [2093, 2637].forEach((f, i) => this.tone(f, 0.5, { vol: 0.03, delay: 0.45 + i * 0.1 }));
            }
            break;
          case 'daily':
            // Extra chord for a Daily clear, only with the synth sounds;
            // the fanfare already covers it.
            if (!(window.SLIP_SOUNDS && window.SLIP_SOUNDS.complete)) {
              [392, 494, 587, 784].forEach((f) => this.tone(f, 0.7, { type: 'sine', vol: 0.05, delay: 0.3 }));
            }
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
    const onTime = (r) => r && r.completed && !r.late; // past days played later never count
    if (!onTime(hist[d])) d = addDays(d, -1);
    while (onTime(hist[d])) { current++; d = addDays(d, -1); }
    const days = Object.keys(hist).filter((k) => onTime(hist[k])).sort();
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
  /** Zen 3D boards are stored with a "3d." prefix on their seed. */
  const isCubeKey = (key) => String(key).startsWith('3d.');
  /** Which generator built a board; a saved board from another version is dropped. */
  /* 3D bonus levels: bonus k unlocks when campaign level 10k is cleared.
     They are optional extras and never block the main campaign. */
  const bonusAfter = (k) => k * SlipCube.BONUS_AFTER;
  const bonusUnlocked = (k) => { const r = Save.data.campaign.levels[bonusAfter(k)]; return !!(r && r.completed); };
  const levelStore = (mode) => (mode === 'bonus' ? Save.data.campaign.bonus : Save.data.campaign.levels);
  const bonusDone = () => { const b = Save.data.campaign.bonus; let n = 0; for (const k in b) if (b[k].completed) n++; return n; };
  // Which generator built a saved board. Zen 2D boards are also "tightened", so they have their own tag.
  /* Pictures: picture k unlocks once you've found k-2 others, so three are always open. */
  const PIC = window.SlipPictures;
  const picDone = () => { const d = Save.data.pictures.done; let n = 0; for (const k in d) if (d[k].completed) n++; return n; };
  const picUnlocked = (k) => k < picDone() + 3 || !!(Save.data.pictures.done[k] && Save.data.pictures.done[k].completed);
  /** The picture's outline as one SVG path of squares (for gallery tiles and the reveal). */
  function picSvg(k, cls) {
    const L = PIC.pictureLevel(k), m = PIC.pictureMask(PIC.PICTURES[k], 1);
    let d = '';
    for (let y = 0; y < m.rows; y++) for (let x = 0; x < m.cols; x++) if (m.mask[y * m.cols + x]) d += `M${x} ${y}h1.04v1.04h-1.04z`;
    return `<svg class="${cls || ''}" viewBox="-0.5 -0.5 ${m.cols + 1} ${m.rows + 1}" aria-hidden="true" data-pic="${L.id}"><path d="${d}"/></svg>`;
  }
  const genFor = (key, mode) => (mode === 'picture' ? E.GENERATOR_VERSION + '+' + E.ZEN_TIGHT_VERSION + '+' + PIC.PICTURE_VERSION : isCubeKey(key) ? E.GENERATOR_VERSION + '+' + SlipCube.CUBE_VERSION
    : (mode === 'zen' || mode === 'debug') ? E.GENERATOR_VERSION + '+' + E.ZEN_TIGHT_VERSION
    : (mode === 'campaign' && Number(key) >= E.CAMPAIGN_TIGHT_FROM) ? E.GENERATOR_VERSION + '+c' + E.ZEN_TIGHT_VERSION
    : E.GENERATOR_VERSION);
  function puzzleFor(sess) {
    const key = `${sess.mode}|${sess.key}|${sess.diff}`;
    if (puzzleCache.has(key)) return puzzleCache.get(key);
    let p;
    if (sess.mode === 'campaign') p = E.campaignPuzzle(Number(sess.key));
    else if (sess.mode === 'bonus') p = SlipCube.bonusCube(Number(sess.key));
    else if (sess.mode === 'picture') p = PIC.picturePuzzle(E, Number(sess.key));
    else if (sess.mode === 'daily') p = E.dailyPuzzle(sess.key);
    else if (isCubeKey(sess.key)) p = SlipCube.zenCube(String(sess.key).slice(3), sess.diff);
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
  /* ======================================================================
     STYLE SHOP CATALOG — looks bought with coins. Palettes live in
     styles.css (.skin.th-*, .skin.bg-*); trails are drawn in BoardView.escape.
     ====================================================================== */
  const STYLE = {
    arrows: [
      { id: 'classic', name: 'Classic', price: 0 },
      { id: 'pastel', name: 'Pastel', price: 80 },
      { id: 'sunset', name: 'Sunset', price: 120 },
      { id: 'ocean', name: 'Ocean', price: 120 },
      { id: 'forest', name: 'Forest', price: 150 },
      { id: 'neon', name: 'Neon', price: 200 },
      { id: 'jewel', name: 'Jewel', price: 300 },
    ],
    board: [
      { id: 'default', name: 'Default', price: 0, tone: 'auto' },
      { id: 'paper', name: 'Paper', price: 80, tone: 'light' },
      { id: 'midnight', name: 'Midnight', price: 100, tone: 'dark' },
      { id: 'blush', name: 'Blush', price: 120, tone: 'light' },
      { id: 'deepsea', name: 'Deep Sea', price: 150, tone: 'dark' },
      { id: 'pine', name: 'Pine', price: 150, tone: 'dark' },
    ],
    trail: [
      { id: 'classic', name: 'Classic', price: 0, desc: 'A soft streak' },
      { id: 'comet', name: 'Comet', price: 100, desc: 'A long bright tail' },
      { id: 'sparkle', name: 'Sparkle', price: 150, desc: 'Leaves glitter behind' },
      { id: 'firework', name: 'Firework', price: 200, desc: 'Big burst at the edge' },
      { id: 'rainbow', name: 'Rainbow', price: 250, desc: 'A striped rainbow tail' },
    ],
  };
  const STYLE_KINDS = [['arrows', 'Arrow colors'], ['board', 'Board'], ['trail', 'Flight trail']];
  const styleItem = (kind, id) => STYLE[kind].find((it) => it.id === id) || STYLE[kind][0];
  /** Put the equipped (or given) arrow theme and board on an SVG board. */
  const OUTLINED_THEMES = ['pastel', 'sunset', 'ocean'];
  const lightQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  function applySkin(svg, arrows, board, ignoreCvd) {
    const eq = Save.data.progress.equip;
    const b = styleItem('board', board || eq.board);
    const th = styleItem('arrows', arrows || eq.arrows).id;
    const lightBoard = b.tone === 'light' || (b.tone === 'auto' && !!(lightQuery && lightQuery.matches));
    const mode = Save.data.settings.outline || 'auto';
    const cvd = !!Save.data.settings.colorblind && !ignoreCvd;
    const outline = mode === 'on' || (mode === 'auto' && (OUTLINED_THEMES.includes(th) || cvd) && lightBoard);
    svg.setAttribute('class', svg.getAttribute('class').replace(/\s*\b(skin|th-\S+|bg-\S+|tone-\S+|outline-on|on-dark|cvd)\b/g, '').trim() +
      ` skin th-${th} bg-${b.id} tone-${b.tone}` + (outline ? ' outline-on' : '') + (lightBoard ? '' : ' on-dark') + (cvd ? ' cvd' : ''));
  }
  if (lightQuery && lightQuery.addEventListener) lightQuery.addEventListener('change', () => {
    for (const el of document.querySelectorAll('.skin')) if (el.id) applySkin(el);
  });

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
  /* Flight trails (Style shop). len = cells of trail behind the tail. */
  const TRAILS = {
    classic:  { len: 2, opacity: 0.35 },
    comet:    { len: 4.5, opacity: 0.75, width: 0.95 },
    sparkle:  { len: 2, opacity: 0.3, sparkle: true },
    firework: { len: 2, opacity: 0.35, firework: true },
    rainbow:  { len: 6, opacity: 0.95, width: 1, rainbow: true },
  };
  const RAINBOW = [0, 1, 2, 3, 4, 6]; // palette slots: red, orange, yellow-green, teal, blue, purple
  const EXIT_GLIDE_CELLS = 2.6;   // how far past the edge an arrow travels before it's gone

  const TIP = 0.36;      // how far the arrowhead tip reaches past the head cell centre
  const HEAD_BACK = 0.1; // where the arrowhead base sits behind the head cell centre
  const HOOK_STEM = 0.2;  // turned heads: how far the elbow runs out the new way before the arrowhead
  const HOOK_HEAD = 0.32; // turned heads: arrowhead length (a little shorter, so the tip stays near its square)
  /* Arrow thickness (Settings). The stroke width lives in CSS (--aw);
     the arrowhead grows a little with it so heads stay in proportion. */
  const THICKNESS = { thin: 0.9, normal: 1, thick: 1.14 };
  const headHalf = () => 0.29 * (THICKNESS[Save.data.settings.thickness] || 1);

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
      applySkin(this.svg);
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
      // The board background follows the board's outline: every playable cell
      // as a square, drawn twice with thick round-joined strokes so the shape
      // gets a soft rounded edge and a thin border line.
      let cells = '';
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (mask[y * cols + x]) cells += `M${x} ${y}h1v1h-1z`;
      this.gGrid.append(s('path', { class: 'board-edge', d: cells }), s('path', { class: 'board-bg', d: cells }));
      // All dots in a single path keeps the DOM small on big boards.
      const r = 0.07;
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
      // Does the head turn in its last square (it points a different way from its last step)?
      const n = pts.length;
      const hook = n > 1 && (pts[n - 1][0] - pts[n - 2][0] !== E.DX[a.dir] || pts[n - 1][1] - pts[n - 2][1] !== E.DY[a.dir]);
      return { pts, ext, cum, len: pts.length - 1, hook };
    }

    createArrow(a) {
      const g = s('g', { class: 'arrow', 'data-id': a.id });
      const color = `var(--a${a.color})`;
      g.style.setProperty('--c', color);
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
      // A head that turns in its last square gets a short elbow: the body bends,
      // runs a little way out the new direction, then the arrowhead. Without the
      // elbow the body would meet the head from the side and look like a flag.
      const hook = geo.hook;
      const bodyEnd = off + geo.len + (hook ? HOOK_STEM : -HEAD_BACK);
      const bodyD = BoardView.pathD(this.windowPts(geo, off, bodyEnd));
      const tip = this.pointAt(geo, off + geo.len + (hook ? HOOK_STEM + HOOK_HEAD : TIP));
      const back = hook ? HOOK_HEAD + 0.05 : TIP + HEAD_BACK;
      const base = [tip[0] - E.DX[dir] * back, tip[1] - E.DY[dir] * back];
      const hh = headHalf() * (hook ? 0.88 : 1);
      const px = -E.DY[dir] * hh, py = E.DX[dir] * hh;
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
      const tr = TRAILS[Save.data.progress.equip.trail] || TRAILS.classic;
      let lastSpark = 0;
      node.trail.style.display = '';
      if (tr.width) node.trail.style.strokeWidth = `calc(var(--aw) * ${tr.width})`;
      // Rainbow: the tail is split into bands, red at the arrow end through purple.
      let bandGroup = null;
      const bands = tr.rainbow ? RAINBOW.map((c, i) => {
        if (!bandGroup) { bandGroup = s('g'); node.g.insertBefore(bandGroup, node.body); }
        const b = s('path', { class: 'trail' });
        b.style.stroke = `var(--a${c})`;
        b.style.strokeWidth = 'var(--aw)';
        b.style.strokeLinecap = i === RAINBOW.length - 1 ? 'round' : 'butt';
        b.style.strokeLinejoin = 'round';
        bandGroup.append(b);
        return b;
      }) : null;
      if (bands) node.trail.style.display = 'none';
      node.g.style.pointerEvents = 'none';
      this.addAnim((now) => {
        const t = Math.min(1, (now - start) / dur);
        const e = 1 - Math.pow(1 - t, sp.ease); // launches on the tap, in step with the sound
        const off = total * e;
        this.shape(node, off);
        const trailFrom = Math.max(0, off - tr.len);
        node.trail.setAttribute('d', BoardView.pathD(this.windowPts(geo, trailFrom, off)));
        node.trail.style.opacity = String(tr.opacity * (1 - t));
        if (bands) {
          const span = Math.min(off, tr.len), w = span / bands.length;
          bands.forEach((b, i) => {
            const t1 = off - i * w, t0 = Math.max(0, t1 - w);
            b.setAttribute('d', w > 0.01 ? BoardView.pathD(this.windowPts(geo, t0, t1)) : '');
          });
          bandGroup.style.opacity = String(tr.opacity * (1 - t * 0.3));
        }
        if (tr.sparkle && now - lastSpark > 32 && off < fadeFrom) {
          lastSpark = now;
          this.sparkle(this.pointAt(geo, off + Math.random() * 0.6), node.a.color);
        }
        // Fully visible while any part is on the board; fade only past the edge.
        node.g.style.opacity = off <= fadeFrom ? '1' : String(Math.max(0, 1 - (off - fadeFrom) / EXIT_GLIDE_CELLS));
        if (!burst && off >= edge) {
          burst = true;
          const hd = geo.pts[geo.pts.length - 1];
          this.burst(hd[0] + E.DX[node.a.dir] * edge, hd[1] + E.DY[node.a.dir] * edge, node.a.dir, node.a.color, tr.firework);
        }
        if (t >= 1) { node.g.remove(); return false; }
        return true;
      });
    }

    /** A glitter speck left behind by the Sparkle trail. */
    sparkle(pt, color) {
      const c = s('circle', { r: 0.045 + Math.random() * 0.05, cx: pt[0] + (Math.random() - 0.5) * 0.35, cy: pt[1] + (Math.random() - 0.5) * 0.35 });
      c.style.fill = Math.random() < 0.35 ? '#fff' : `var(--a${(color + Math.floor(Math.random() * 3)) % 8})`;
      this.gFx.append(c);
      const start = performance.now(), life = 380 + Math.random() * 220;
      this.addAnim((now) => {
        const t = (now - start) / life;
        c.style.opacity = String(Math.max(0, 1 - t));
        if (t >= 1) { c.remove(); return false; }
        return true;
      });
    }

    burst(x, y, dir, color, big) {
      const parts = [];
      const n = big ? 22 : 7;
      for (let i = 0; i < n; i++) {
        const c = s('circle', { r: (big ? 0.06 : 0.05) + Math.random() * (big ? 0.07 : 0.05), cx: x, cy: y });
        c.style.fill = `var(--a${big ? (color + i) % 8 : color})`;
        this.gFx.append(c);
        const spread = (Math.random() - 0.5) * (big ? 4.2 : 1.6);
        const speed = (big ? 0.6 : 1.2) + Math.random() * (big ? 2.6 : 1.6);
        parts.push({ c, vx: E.DX[dir] * speed + -E.DY[dir] * spread, vy: E.DY[dir] * speed + E.DX[dir] * spread });
      }
      const start = performance.now();
      this.addAnim((now) => {
        const t = (now - start) / (big ? 620 : 420);
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

    /** Red "waiting" look for a blocked arrow (auto-release). */
    setStuck(id, on) {
      const n = this.nodes.get(id);
      if (!n) return;
      const c = on ? 'var(--stuck)' : `var(--a${n.a.color})`;
      n.g.style.setProperty('--c', c);
      n.body.style.stroke = c; n.trail.style.stroke = c;
      n.head.style.fill = c; n.head.style.stroke = c;
      n.g.classList.toggle('is-stuck', on);
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

  /* ======================================================================
     CUBE VIEW — the 3D board (Zen 3D). Drawn on a <canvas> with a small
     hand-written 3D pipeline: rotate, perspective-project, hide the faces
     that point away. Arrows are polylines on the cube's surface; a released
     arrow slithers along its path and flies straight off the face's edge.
     Same interface as BoardView so Game can use either one.
     ====================================================================== */
  const CUBE_HOLD_MS = 320;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  /* Tiny OKLab helpers so outlines match the 2D board's look. */
  const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const linToSrgb = (c) => { c = clamp01(c); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
  function hexToRgb(hex) {
    hex = String(hex || '').trim();
    if (hex.startsWith('rgb')) { const m = hex.match(/[\d.]+/g) || [0, 0, 0]; return [m[0] / 255, m[1] / 255, m[2] / 255]; }
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex || '0', 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  function rgbToCss([r, g, b], a) {
    const f = (v) => Math.round(clamp01(v) * 255);
    return a == null ? `rgb(${f(r)},${f(g)},${f(b)})` : `rgba(${f(r)},${f(g)},${f(b)},${a})`;
  }
  function toOklch(rgb) {
    const [r, g, b] = rgb.map(srgbToLin);
    let l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, s2 = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    l = Math.cbrt(l); m = Math.cbrt(m); s2 = Math.cbrt(s2);
    const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s2, A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s2, B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s2;
    return [L, Math.hypot(A, B), Math.atan2(B, A)];
  }
  function fromOklch([L, C, H]) {
    const A = C * Math.cos(H), B = C * Math.sin(H);
    let l = L + 0.3963377774 * A + 0.2158037573 * B, m = L - 0.1055613458 * A - 0.0638541728 * B, s2 = L - 0.0894841775 * A - 1.2914855480 * B;
    l = l * l * l; m = m * m * m; s2 = s2 * s2 * s2;
    return [linToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s2), linToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s2), linToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s2)];
  }
  const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  /* 3×3 rotation helpers (row-major arrays of 9). */
  const matMul = (a, b) => {
    const o = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    return o;
  };
  const rotX = (t) => [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)];
  const rotY = (t) => [Math.cos(t), 0, Math.sin(t), 0, 1, 0, -Math.sin(t), 0, Math.cos(t)];
  const rotAxis = (ax, t) => {
    const [x, y, z] = ax, c = Math.cos(t), s2 = Math.sin(t), C = 1 - c;
    return [c + x * x * C, x * y * C - z * s2, x * z * C + y * s2, y * x * C + z * s2, c + y * y * C, y * z * C - x * s2, z * x * C - y * s2, z * y * C + x * s2, c + z * z * C];
  };
  const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  const applyT = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const START_ROT = () => matMul(rotX(0.42), rotY(-0.62));
  /* Quaternions, for smooth turns between two orientations. */
  function matToQuat(m) {
    const t = m[0] + m[4] + m[8];
    let w, x, y, z;
    if (t > 0) { const s2 = Math.sqrt(t + 1) * 2; w = s2 / 4; x = (m[7] - m[5]) / s2; y = (m[2] - m[6]) / s2; z = (m[3] - m[1]) / s2; }
    else if (m[0] > m[4] && m[0] > m[8]) { const s2 = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; w = (m[7] - m[5]) / s2; x = s2 / 4; y = (m[1] + m[3]) / s2; z = (m[2] + m[6]) / s2; }
    else if (m[4] > m[8]) { const s2 = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; w = (m[2] - m[6]) / s2; x = (m[1] + m[3]) / s2; y = s2 / 4; z = (m[5] + m[7]) / s2; }
    else { const s2 = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; w = (m[3] - m[1]) / s2; x = (m[2] + m[6]) / s2; y = (m[5] + m[7]) / s2; z = s2 / 4; }
    return [w, x, y, z];
  }
  function quatToMat([w, x, y, z]) {
    return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  }
  function slerp(a, b, t) {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (d < 0) { b = b.map((v) => -v); d = -d; }
    if (d > 0.9995) { const r = a.map((v, i) => v + (b[i] - v) * t); const l = Math.hypot(...r); return r.map((v) => v / l); }
    const th = Math.acos(d), s0 = Math.sin((1 - t) * th) / Math.sin(th), s1 = Math.sin(t * th) / Math.sin(th);
    return a.map((v, i) => v * s0 + b[i] * s1);
  }
  /* The 24 ways to turn a cube onto itself (signed permutation matrices, det +1). */
  const CUBE_TURNS = (() => {
    const out = [], perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const p of perms) for (let sg = 0; sg < 8; sg++) {
      const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let r = 0; r < 3; r++) m[r * 3 + p[r]] = (sg >> r) & 1 ? -1 : 1;
      const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
      if (det > 0) out.push(m);
    }
    return out;
  })();

  class CubeView {
    constructor(canvas, host) {
      this.svg = canvas;           // Game code calls it .svg for both views
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.h = host;               // { release(id), inputLocked() }
      this.p = null;
      this.board = null;
      this.nodes = new Map();      // alive arrows (id → info), mirrors BoardView
      this.R = START_ROT();
      this.zoom = { scale: 1 };
      this.selected = -1;
      this.anims = new Set();
      this.fx = [];                // particles, rays, flashes
      this.flying = [];            // arrows in flight
      this.raf = 0;
      this.dirty = true;
      this.loop = this.loop.bind(this);
      this.pointers = new Map();
      this.spin = null;            // momentum
      this.bindInput();
    }

    /* ---------------- setup ---------------- */
    load(puzzle, board) {
      this.p = puzzle;
      this.board = board;
      this.g = SlipCube.geometryOf(puzzle);
      const g = this.g;
      // Spin around the shape's own middle, and size it by the farthest real corner
      // (a block shape's bounding box has empty corners, so this fits it tighter).
      let sx = 0, sy = 0, sz = 0, nv = 0;
      for (let x = 0; x < g.X; x++) for (let y = 0; y < g.Y; y++) for (let z = 0; z < g.Z; z++)
        if (g.solid(x, y, z)) { sx += x + 0.5; sy += y + 0.5; sz += z + 0.5; nv++; }
      this.ctr = [sx / nv, sy / nv, sz / nv];
      let r2 = 0;
      for (let x = 0; x < g.X; x++) for (let y = 0; y < g.Y; y++) for (let z = 0; z < g.Z; z++) {
        if (!g.solid(x, y, z)) continue;
        for (let k = 0; k < 8; k++) {
          const dx = x + (k & 1) - this.ctr[0], dy = y + ((k >> 1) & 1) - this.ctr[1], dz = z + ((k >> 2) & 1) - this.ctr[2];
          r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
        }
      }
      this.radius = Math.sqrt(r2);
      this.nodes.clear();
      this.flying = [];
      this.fx = [];
      this.anims.clear();
      this.R = START_ROT();
      this.zoom.scale = 1;
      this.hintId = -1; this.pressId = -1; this.flash = new Map(); this.stuck = new Set(); this.order = null;
      applySkin(this.canvas);
      this.refreshColors();
      for (const id of board.alive) this.nodes.set(id, this.geometry(puzzle.arrows[id]));
      this.applyView();
    }
    refreshColors() {
      const cs = getComputedStyle(this.canvas);
      const v = (k) => cs.getPropertyValue(k).trim();
      this.col = {
        board: hexToRgb(v('--board')), line: hexToRgb(v('--line')), dot: hexToRgb(v('--dot')),
        arrows: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => hexToRgb(v('--a' + i))),
        bad: hexToRgb(v('--bad')), gold: hexToRgb(v('--gold')), text: hexToRgb(v('--text')),
        stuck: hexToRgb(v('--stuck') || '#ff4f4f'),
      };
      this.aw = parseFloat(v('--aw')) || 0.17;
      const cls = this.canvas.getAttribute('class') || '';
      this.outline = /\boutline-on\b/.test(cls);
      this.onDark = /\bon-dark\b/.test(cls);
      this.hc = document.body.classList.contains('hc');
      const outlineOf = (c) => {
        if (!this.onDark) return mixRgb(c, [0, 0, 0], 0.38);
        const [L, C, H] = toOklch(c);
        return fromOklch([Math.max(0.6, L - 0.2), C + 0.09, H]);
      };
      this.outlineCol = this.col.arrows.map(outlineOf);
      this.stuckOutline = outlineOf(this.col.stuck);
      this.dirty = true; this.kick();
    }
    applyView() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      this.w = r.width; this.hgt = r.height;
      this.canvas.width = Math.max(1, Math.round(r.width * dpr));
      this.canvas.height = Math.max(1, Math.round(r.height * dpr));
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.dirty = true; this.kick();
    }
    fit() { this.zoom.scale = 1; this.R = START_ROT(); this.dirty = true; this.kick(); }
    zoomBy(f) { this.zoom.scale = Math.max(0.6, Math.min(2.6, this.zoom.scale * f)); this.dirty = true; this.kick(); }
    panBy() {}
    /** Debug: number each arrow's tail with its place in the stored solution. */
    showOrder(on) {
      this.order = null;
      if (on && this.p) {
        const m = new Map();
        let n = 1;
        for (const id of this.p.solution) { const geo = this.nodes.get(id); if (geo) m.set(geo.a.cells[0], n++); }
        this.order = m;
      }
      this.dirty = true; this.kick();
    }
    setSelected() {}
    get busy() { return this.flying.length > 0; }

    /* ---------------- geometry ---------------- */
    u3(c) { return [c[0] / 2 - this.ctr[0], c[1] / 2 - this.ctr[1], c[2] / 2 - this.ctr[2]]; }
    /** Path of an arrow as 3D points; tags[i] = the cell the segment ending at
        point i lies on (-1 = in the air). Ends with its straight exit run. */
    geometry(a) {
      const g = this.g, pts = [], tags = [], D3 = SlipCube.DIRS;
      for (let i = 0; i < a.cells.length; i++) {
        const cell = g.cells[a.cells[i]];
        if (i > 0) {
          const prev = g.cells[a.cells[i - 1]];
          const t = g.tangents(prev.id).find((tt) => g.step(prev.id, tt)[0] === cell.id);
          const D = D3[t];
          pts.push(this.u3([prev.c[0] + D[0], prev.c[1] + D[1], prev.c[2] + D[2]])); tags.push(prev.id);
        }
        pts.push(this.u3(cell.c)); tags.push(cell.id);
      }
      const headCell = g.cells[a.cells[a.cells.length - 1]];
      const D = D3[a.dir];
      const run = g.exitRun(headCell.id, a.dir) || { edge: 0.5 };
      const hd = pts[pts.length - 1];
      const edgeLen = run.edge;
      pts.push([hd[0] + D[0] * edgeLen, hd[1] + D[1] * edgeLen, hd[2] + D[2] * edgeLen]); tags.push(headCell.id);
      const far = this.radius * 2 + a.cells.length + 4;
      pts.push([hd[0] + D[0] * (edgeLen + far), hd[1] + D[1] * (edgeLen + far), hd[2] + D[2] * (edgeLen + far)]); tags.push(-1);
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
      return { a, pts, tags, cum, len: cum[cum.length - 3], edgeAt: cum[cum.length - 2], headCell: headCell.id, headN: headCell.n, D, normal: D3[headCell.n], off: 0 };
    }
    pointAt(geo, t) {
      const { pts, cum } = geo;
      if (t <= 0) return { p: pts[0], i: 1 };
      for (let i = 1; i < pts.length; i++) {
        if (t <= cum[i]) {
          const f = (t - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
          return { p: [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f, pts[i - 1][2] + (pts[i][2] - pts[i - 1][2]) * f], i };
        }
      }
      return { p: pts[pts.length - 1], i: pts.length - 1 };
    }
    camera() {
      const r = this.radius;
      const D = r * 3.0;
      const k = D / (D - r);
      const S = (Math.min(this.w, this.hgt) * 0.47 / (0.95 * r * k)) * this.zoom.scale;
      return { D, S, cx: this.w / 2, cy: this.hgt / 2 };
    }
    project(p, cam) {
      const q = apply(this.R, p);
      const k = cam.D / (cam.D - q[2]);
      return [cam.cx + q[0] * k * cam.S, cam.cy - q[1] * k * cam.S, k];
    }
    /** Does this cell face the camera? (Being hidden behind other blocks is handled by draw order.) */
    cellVisible(id, cam) {
      const cell = this.g.cells[id];
      const n = apply(this.R, SlipCube.DIRS[cell.n]);
      const c = apply(this.R, this.u3(cell.c));
      return n[0] * -c[0] + n[1] * -c[1] + n[2] * (cam.D - c[2]) > 0.02;
    }

    /* ---------------- drawing ---------------- */
    kick() { if (!this.raf) this.raf = requestAnimationFrame(this.loop); }
    loop(now) {
      this.raf = 0;
      for (const fn of Array.from(this.anims)) { let keep = false; try { keep = fn(now); } catch (e) { keep = false; } if (!keep) this.anims.delete(fn); }
      if (this.spin && !this.pointers.size) {
        this.rotate(this.spin.dx, this.spin.dy);
        this.spin.dx *= 0.92; this.spin.dy *= 0.92;
        if (Math.abs(this.spin.dx) + Math.abs(this.spin.dy) < 0.15) this.spin = null;
      }
      const pulsing = this.stuck && this.stuck.size > 0 && !reducedMotion();
      if (this.dirty || pulsing || this.anims.size || this.flying.length || this.fx.length || this.spin || this.hintId >= 0 || this.flash.size) this.draw(now);
      if (pulsing || this.anims.size || this.flying.length || this.fx.length || this.spin || this.hintId >= 0 || this.flash.size) this.raf = requestAnimationFrame(this.loop);
    }
    rotate(dx, dy) {
      this.R = matMul(matMul(rotY(dx * 0.009), rotX(dy * 0.009)), this.R);
      this.dirty = true;
    }
    draw(now) {
      const ctx = this.ctx, cam = this.camera(), g = this.g, D3 = SlipCube.DIRS;
      this.dirty = false;
      ctx.clearRect(0, 0, this.w, this.hgt);
      const vis = new Uint8Array(g.cells.length);
      const order = [];
      for (const cell of g.cells) {
        if (!this.cellVisible(cell.id, cam)) continue;
        vis[cell.id] = 1;
        order.push({ id: cell.id, z: apply(this.R, this.u3(cell.c))[2] });
      }
      order.sort((a, b) => a.z - b.z); // far → near
      this.vis = vis;
      // Soft shadow under the shape.
      const r = this.radius;
      const shx = cam.cx, shy = cam.cy + r * 1.02 * cam.S, shr = r * 0.95 * cam.S;
      const grd = ctx.createRadialGradient(shx, shy, 0, shx, shy, shr);
      grd.addColorStop(0, this.onDark ? 'rgba(0,0,0,0.32)' : 'rgba(30,40,110,0.13)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save(); ctx.translate(shx, shy); ctx.scale(1, 0.26); ctx.translate(-shx, -shy);
      ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(shx, shy, shr, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // What sits on each cell: pieces of resting arrows (drawn right after their cell).
      const pulse = this.hintId >= 0 ? 0.5 + 0.5 * Math.sin(now / 140) : 0;
      this.stuckFade = reducedMotion() ? 0 : 0.38 * (0.5 - 0.5 * Math.cos((now / 1300) * Math.PI * 2));
      const bucket = new Map();
      const put = (cid, item) => { if (!vis[cid]) return; let b = bucket.get(cid); if (!b) bucket.set(cid, (b = [])); b.push(item); };
      for (const [id, geo] of this.nodes) {
        let glow = null;
        if (id === this.hintId) glow = { col: this.col.gold, a: 0.35 + 0.4 * pulse };
        if (this.flash.has(id)) glow = { col: this.col.bad, a: 0.6 * this.flash.get(id)() };
        if (id === this.pressId) glow = { col: this.col.text, a: 0.25 };
        const off = geo.off || 0;
        const runs = this.runs(geo, off, off + geo.len - HEAD_BACK);
        // Pieces are drawn cell by cell. Where an arrow carries on flat into the
        // next cell, its colour reaches a hair past the line so no seam shows.
        const same = (m, n2) => m[0] === n2[0] && m[1] === n2[1] && m[2] === n2[2];
        runs.forEach((run, i) => {
          const extS = i > 0 && same(runs[i - 1].n, run.n), extE = i < runs.length - 1 && same(runs[i + 1].n, run.n);
          put(run.tag, { geo, run, glow, tail: i === 0, ext: extS || extE ? [extS ? 0.03 : 0, extE ? 0.03 : 0] : null });
        });
        const head = this.headPoly(geo, off, cam);
        put(head.tag >= 0 ? head.tag : geo.headCell, { geo, head, glow });
      }
      // Lighting per face direction
      const L = norm3([-0.45, 0.75, 0.55]);
      const shadeRgb = D3.map((n) => {
        const lit = Math.max(0, dot3(apply(this.R, n), L));
        return this.onDark ? mixRgb(this.col.board, [1, 1, 1], 0.04 + 0.08 * lit) : mixRgb(this.col.board, [0.16, 0.18, 0.4], 0.03 + 0.11 * (1 - lit));
      });
      const shadeFor = shadeRgb.map((c) => rgbToCss(c));
      const edgeCol = rgbToCss(this.onDark ? mixRgb(this.col.line, [1, 1, 1], 0.08) : mixRgb(this.col.line, this.col.text, 0.25));
      const dotCol = rgbToCss(this.col.dot);
      const AX = [[1, 0, 0], [1, 0, 0], [0, 1, 0], [0, 1, 0], [0, 0, 1], [0, 0, 1]];
      for (const { id } of order) {
        const cell = g.cells[id];
        const c = this.u3(cell.c);
        const tans = g.tangents(id);
        const U = AX[tans[0]], V = AX[tans[2]];
        const corner = (su, sv) => this.project([c[0] + (U[0] * su + V[0] * sv) * 0.5, c[1] + (U[1] * su + V[1] * sv) * 0.5, c[2] + (U[2] * su + V[2] * sv) * 0.5], cam);
        const q = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
        ctx.beginPath(); q.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath();
        ctx.fillStyle = shadeFor[cell.n]; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = shadeFor[cell.n]; ctx.stroke(); // hides hairline seams
        // Block edges where the surface folds
        const folds = g.folds[id];
        ctx.lineWidth = this.onDark ? 1.4 : 1.8; ctx.strokeStyle = edgeCol; ctx.lineCap = 'round';
        for (let i = 0; i < 4; i++) {
          if (!folds[i]) continue;
          const T = D3[tans[i]], P = i < 2 ? V : U;
          const a1 = this.project([c[0] + T[0] * 0.5 + P[0] * 0.5, c[1] + T[1] * 0.5 + P[1] * 0.5, c[2] + T[2] * 0.5 + P[2] * 0.5], cam);
          const a2 = this.project([c[0] + T[0] * 0.5 - P[0] * 0.5, c[1] + T[1] * 0.5 - P[1] * 0.5, c[2] + T[2] * 0.5 - P[2] * 0.5], cam);
          ctx.beginPath(); ctx.moveTo(a1[0], a1[1]); ctx.lineTo(a2[0], a2[1]); ctx.stroke();
        }
        // The dot lies flat on the face too, so it narrows on a tilted face.
        ctx.fillStyle = dotCol; ctx.beginPath();
        for (let k = 0; k < 14; k++) {
          const t = (k / 14) * Math.PI * 2, cu = Math.cos(t) * 0.075, sv = Math.sin(t) * 0.075;
          const pp = this.project([c[0] + U[0] * cu + V[0] * sv, c[1] + U[1] * cu + V[1] * sv, c[2] + U[2] * cu + V[2] * sv], cam);
          k ? ctx.lineTo(pp[0], pp[1]) : ctx.moveTo(pp[0], pp[1]);
        }
        ctx.closePath(); ctx.fill();
        const items = bucket.get(id);
        if (items) this.drawItems(items, cam, shadeRgb[cell.n]);
        if (this.order && this.order.has(id)) {
          const pc = this.project(c, cam), fs = Math.max(9, 0.36 * cam.S * pc[2]);
          ctx.font = `800 ${fs}px Figtree, system-ui, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
          ctx.lineWidth = fs * 0.28; ctx.strokeStyle = rgbToCss(this.col.board); ctx.strokeText(String(this.order.get(id)), pc[0], pc[1]);
          ctx.fillStyle = rgbToCss(this.col.text); ctx.fillText(String(this.order.get(id)), pc[0], pc[1]);
        }
      }
      for (const fx of this.fx) if (fx.kind === 'ray') this.drawRay(fx, cam, now);
      for (const fl of this.flying) {
        this.drawTrail(fl, cam);
        this.drawArrow(fl.geo, fl.off, cam, null, fl.alpha);
      }
      for (const fx of this.fx) if (fx.kind !== 'ray') this.drawFx(fx, cam, now);
    }
    /** Resting arrow pieces on one cell: glow, then outline, then colour. */
    drawItems(items, cam, face) {
      for (const pass of ['glow', 'outline', 'body']) {
        for (const it of items) {
          const a = it.geo.a, stuck = this.stuck.has(a.id);
          const fade = (c) => (stuck && this.stuckFade ? mixRgb(c, face, this.stuckFade) : c);
          const color = fade(stuck ? this.col.stuck : this.col.arrows[a.color % 8]);
          const cap = it.tail ? 'round' : 'butt';
          if (pass === 'glow') {
            if (!it.glow) continue;
            // Solid colour (glow already blended onto this face), so pieces can overlap cleanly.
            const gc = mixRgb(face, it.glow.col, Math.max(0, Math.min(1, it.glow.a)));
            if (it.run) this.strokeRuns([it.run], cam, this.aw + 0.3, gc, 1, cap, true, it.ext && it.ext.map((e) => e / 2));
            else this.fillHead(this.headPoly(it.geo, it.geo.off || 0, cam, 0.12), gc, 1, 0.1, cam, true);
          } else if (pass === 'outline') {
            if (!(this.outline || this.hc)) continue;
            const oc = this.hc ? this.col.board : fade(stuck ? this.stuckOutline : this.outlineCol[a.color % 8]);
            if (it.run) this.strokeRuns([it.run], cam, this.aw + (this.hc ? 0.14 : 0.09), oc, 1, cap, true, it.ext);
            else this.fillHead(it.head, oc, 1, this.hc ? 0.2 : 0.15, cam, true);
          } else if (it.run) this.strokeRuns([it.run], cam, this.aw, color, 1, cap, true, it.ext && it.ext.map((e) => e * 2));
          else this.fillHead(it.head, color, 1, 0.06, cam, true);
        }
      }
    }
    /** Arrow bodies as flat strips lying on the faces (true perspective, so a
        strip never spills off its own square on a tilted face). All the strips
        go in one path, so overlapping pieces never double up or show seams. */
    strokeRuns(runs, cam, width, color, alpha, cap, force, ext) {
      const ctx = this.ctx, h = width / 2, round = (cap || 'round') === 'round';
      ctx.beginPath();
      let any = false;
      const poly = (pts3) => {
        const pr = pts3.map((p) => this.project(p, cam));
        let area = 0;
        for (let i = 0; i < pr.length; i++) { const q = pr[i], r2 = pr[(i + 1) % pr.length]; area += q[0] * r2[1] - r2[0] * q[1]; }
        if (area < 0) pr.reverse();
        pr.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
        ctx.closePath(); any = true;
      };
      const disc = (c, n, e1) => {
        const e2 = cross3(n, e1), out = [];
        for (let k = 0; k < 18; k++) {
          const t = (k / 18) * Math.PI * 2, co = Math.cos(t) * h, si = Math.sin(t) * h;
          out.push([c[0] + e1[0] * co + e2[0] * si, c[1] + e1[1] * co + e2[1] * si, c[2] + e1[2] * co + e2[2] * si]);
        }
        poly(out);
      };
      runs.forEach((run, ri) => {
        if (!force && run.tag >= 0 && !this.vis[run.tag]) return;
        const P = run.pts, n = run.n;
        if (P.length < 2) return;
        let prevU = null;
        for (let j = 0; j < P.length - 1; j++) {
          let a = P[j], b = P[j + 1];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
          if (L < 1e-6) continue;
          const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L];
          if (ext && j === 0 && ext[0]) a = [a[0] - u[0] * ext[0], a[1] - u[1] * ext[0], a[2] - u[2] * ext[0]];
          if (ext && j === P.length - 2 && ext[1]) b = [b[0] + u[0] * ext[1], b[1] + u[1] * ext[1], b[2] + u[2] * ext[1]];
          const sd = cross3(n, u), sx = [sd[0] * h, sd[1] * h, sd[2] * h];
          poly([[a[0] + sx[0], a[1] + sx[1], a[2] + sx[2]], [b[0] + sx[0], b[1] + sx[1], b[2] + sx[2]], [b[0] - sx[0], b[1] - sx[1], b[2] - sx[2]], [a[0] - sx[0], a[1] - sx[1], a[2] - sx[2]]]);
          if (prevU ? dot3(prevU, u) < 0.999 : (round && ri === 0)) disc(P[j], n, u); // rounded bend / tail
          prevU = u;
        }
      });
      if (!any) return;
      ctx.fillStyle = rgbToCss(color, alpha);
      ctx.fill('nonzero');
    }
    headPoly(geo, off, cam, grow) {
      const t = off + geo.len;
      const tipP = this.pointAt(geo, t + TIP).p, baseP = this.pointAt(geo, t - HEAD_BACK).p;
      const dir = this.dirAt(geo, t);
      const seg = this.pointAt(geo, t).i;
      const tag = geo.tags[seg];
      const fn = tag >= 0 ? SlipCube.DIRS[this.g.cells[tag].n] : geo.normal;
      const side = norm3(cross3(fn, dir));
      const hh = headHalf() + (grow || 0);
      const pts = [tipP, [baseP[0] + side[0] * hh, baseP[1] + side[1] * hh, baseP[2] + side[2] * hh], [baseP[0] - side[0] * hh, baseP[1] - side[1] * hh, baseP[2] - side[2] * hh]];
      return { tag, pr: pts.map((p) => this.project(p, cam)) };
    }
    fillHead(h, color, alpha, strokeW, cam, force) {
      if (!force && h.tag >= 0 && !this.vis[h.tag]) return;
      const ctx = this.ctx;
      ctx.beginPath();
      h.pr.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
      ctx.closePath();
      ctx.fillStyle = rgbToCss(color, alpha);
      ctx.fill();
      if (strokeW) { ctx.lineJoin = 'round'; ctx.lineWidth = strokeW * cam.S * h.pr[0][2]; ctx.strokeStyle = rgbToCss(color, alpha); ctx.stroke(); }
    }
    drawArrow(geo, off, cam, glow, alpha) {
      const a = geo.a, color = this.col.arrows[a.color % 8];
      const body = this.runs(geo, off, off + geo.len - HEAD_BACK);
      const head = this.headPoly(geo, off, cam);
      if (glow) {
        this.strokeRuns(body, cam, this.aw + 0.3, glow.col, glow.a * alpha);
        this.fillHead(this.headPoly(geo, off, cam, 0.12), glow.col, glow.a * alpha, 0.1, cam);
      }
      if (this.outline || this.hc) {
        const oc = this.hc ? this.col.board : this.outlineCol[a.color % 8];
        this.strokeRuns(body, cam, this.aw + (this.hc ? 0.14 : 0.09), oc, alpha);
        this.fillHead(head, oc, alpha, this.hc ? 0.2 : 0.15, cam);
      }
      this.strokeRuns(body, cam, this.aw, color, alpha);
      this.fillHead(head, color, alpha, 0.06, cam);
    }
    drawTrail(fl, cam) {
      const tr = fl.trail, geo = fl.geo;
      const from = Math.max(0, fl.off - tr.len);
      if (fl.off <= 0.01) return;
      if (tr.rainbow) {
        const span = Math.min(fl.off, tr.len), w = span / RAINBOW.length;
        RAINBOW.forEach((slot, i) => {
          const t1 = fl.off - i * w, t0 = Math.max(0, t1 - w);
          if (t1 - t0 > 0.01) this.strokeRuns(this.runs(geo, t0, t1), cam, this.aw, this.col.arrows[slot], tr.opacity * fl.fade);
        });
        return;
      }
      this.strokeRuns(this.runs(geo, from, fl.off), cam, this.aw * (tr.width || 0.7), this.col.arrows[geo.a.color % 8], tr.opacity * fl.fade);
    }
    drawRay(fx, cam) {
      const ctx = this.ctx;
      if (!this.vis[fx.cell]) return;
      const a = this.project(fx.from, cam), b = this.project(fx.to, cam);
      ctx.save();
      ctx.setLineDash([Math.max(3, 0.18 * cam.S), Math.max(3, 0.14 * cam.S)]);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, 0.08 * cam.S * a[2]);
      ctx.strokeStyle = rgbToCss(fx.bad ? this.col.bad : this.col.gold, fx.alpha == null ? 0.95 : fx.alpha);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      ctx.restore();
      if (fx.bad) {
        const r = 0.13 * cam.S * b[2];
        ctx.lineWidth = Math.max(2, 0.07 * cam.S * b[2]);
        ctx.strokeStyle = rgbToCss(this.col.bad);
        ctx.beginPath(); ctx.moveTo(b[0] - r, b[1] - r); ctx.lineTo(b[0] + r, b[1] + r); ctx.moveTo(b[0] + r, b[1] - r); ctx.lineTo(b[0] - r, b[1] + r); ctx.stroke();
      }
    }
    drawFx(fx, cam) {
      const ctx = this.ctx;
      if (fx.kind === 'dot') {
        const q = this.project(fx.p, cam);
        ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(1, fx.r * cam.S * q[2]), 0, Math.PI * 2);
        ctx.fillStyle = fx.white ? `rgba(255,255,255,${fx.a})` : rgbToCss(this.col.arrows[fx.color % 8], fx.a);
        ctx.fill();
      }
    }

    /* ---------------- play feedback ---------------- */
    escape(id) {
      const geo = this.nodes.get(id);
      if (!geo) return;
      this.nodes.delete(id);
      if (this.hintId === id) this.hintId = -1;
      if (reducedMotion()) {
        const fl = { geo, off: 0, alpha: 1, fade: 0, trail: TRAILS.classic };
        this.flying.push(fl);
        const start = performance.now();
        this.anims.add((now) => { fl.alpha = Math.max(0, 1 - (now - start) / 160); if (fl.alpha <= 0) { this.flying.splice(this.flying.indexOf(fl), 1); return false; } return true; });
        this.kick();
        return;
      }
      const tr = TRAILS[Save.data.progress.equip.trail] || TRAILS.classic;
      const sp = escapeSpeed();
      const edge = geo.edgeAt - geo.len;           // distance from head to the face edge
      const total = geo.len + edge + EXIT_GLIDE_CELLS;
      const dur = clamp(sp.baseMs + total * sp.perCellMs, sp.minMs, sp.maxMs);
      const fadeFrom = geo.len + edge;
      const fl = { geo, off: 0, alpha: 1, fade: 1, trail: tr };
      this.flying.push(fl);
      const start = performance.now();
      let burst = false, lastSpark = 0;
      this.anims.add((now) => {
        const t = Math.min(1, (now - start) / dur);
        const e = 1 - Math.pow(1 - t, sp.ease);
        fl.off = total * e;
        fl.fade = 1 - t;
        fl.alpha = fl.off <= fadeFrom ? 1 : Math.max(0, 1 - (fl.off - fadeFrom) / EXIT_GLIDE_CELLS);
        if (tr.sparkle && now - lastSpark > 32 && fl.off < fadeFrom) {
          lastSpark = now;
          const p = this.pointAt(geo, fl.off + Math.random() * 0.6).p;
          this.particle([p[0] + (Math.random() - 0.5) * 0.3, p[1] + (Math.random() - 0.5) * 0.3, p[2] + (Math.random() - 0.5) * 0.3], [0, 0, 0], geo.a.color + Math.floor(Math.random() * 3), 0.05 + Math.random() * 0.05, 400, Math.random() < 0.35);
        }
        if (!burst && fl.off >= edge) {
          burst = true;
          const ep = geo.pts[geo.pts.length - 2];
          const side = norm3(cross3(geo.normal, geo.D));
          const n = tr.firework ? 22 : 7;
          for (let i = 0; i < n; i++) {
            const spread = (Math.random() - 0.5) * (tr.firework ? 4.2 : 1.6), speed = (tr.firework ? 0.6 : 1.2) + Math.random() * (tr.firework ? 2.6 : 1.6);
            const up = tr.firework ? (Math.random() - 0.5) * 2 : 0;
            const v = [geo.D[0] * speed + side[0] * spread + geo.normal[0] * up, geo.D[1] * speed + side[1] * spread + geo.normal[1] * up, geo.D[2] * speed + side[2] * spread + geo.normal[2] * up];
            this.particle(ep.slice(), v, tr.firework ? geo.a.color + i : geo.a.color, (tr.firework ? 0.06 : 0.05) + Math.random() * 0.05, tr.firework ? 620 : 420, false);
          }
        }
        if (t >= 1) { this.flying.splice(this.flying.indexOf(fl), 1); return false; }
        return true;
      });
      this.kick();
    }
    particle(p, v, color, r, life, white) {
      const fx = { kind: 'dot', p, color, r, a: 1, white };
      this.fx.push(fx);
      const start = performance.now(), p0 = p.slice();
      this.anims.add((now) => {
        const t = (now - start) / life;
        fx.p = [p0[0] + v[0] * t * 0.6, p0[1] + v[1] * t * 0.6, p0[2] + v[2] * t * 0.6];
        fx.a = Math.max(0, 1 - t);
        if (t >= 1) { this.fx.splice(this.fx.indexOf(fx), 1); return false; }
        return true;
      });
    }
    rayFor(id, bad) {
      const geo = this.nodes.get(id);
      if (!geo) return null;
      const hd = geo.pts[geo.pts.length - 3];
      const D = geo.D;
      const blocker = this.board.firstBlocker(id);
      const steps = blocker ? blocker.steps - 0.28 : geo.edgeAt - geo.len;
      const from = [hd[0] + D[0] * (TIP + 0.1), hd[1] + D[1] * (TIP + 0.1), hd[2] + D[2] * (TIP + 0.1)];
      const to = [hd[0] + D[0] * steps, hd[1] + D[1] * steps, hd[2] + D[2] * steps];
      return { kind: 'ray', cell: geo.headCell, from, to, bad: bad == null ? !!blocker : bad, blocker };
    }
    blocked(id, blocker) {
      const geo = this.nodes.get(id);
      if (!geo) return;
      const ray = this.rayFor(id, true);
      if (ray) this.fx.push(ray);
      const start = performance.now();
      const fl = this.flash;
      fl.set(blocker.id, () => Math.max(0, 1 - (performance.now() - start) / 650));
      const amp = reducedMotion() ? 0 : Math.min(0.45, blocker.steps - 0.6);
      this.anims.add((now) => {
        const k = (now - start) / 420;
        geo.off = Math.max(0, amp * Math.sin(Math.PI * Math.min(1, k)) * (1 - 0.3 * k));
        if (k >= 1) geo.off = 0;
        if (now - start > 900) {
          if (ray) { const i = this.fx.indexOf(ray); if (i >= 0) this.fx.splice(i, 1); }
          fl.delete(blocker.id);
          return false;
        }
        return true;
      });
      this.kick();
    }
    /** Red "waiting" look for a blocked arrow (auto-release). */
    setStuck(id, on) {
      if (on) this.stuck.add(id); else this.stuck.delete(id);
      this.dirty = true; this.kick();
    }
    showHint(id) {
      if (!this.nodes.has(id)) return;
      this.hintId = id;
      this.bringToFront(this.nodes.get(id).headN);
      const ray = this.rayFor(id, false);
      if (ray) this.fx.push(ray);
      clearTimeout(this.hintTimer);
      this.hintTimer = setTimeout(() => {
        if (this.hintId === id) this.hintId = -1;
        if (ray) { const i = this.fx.indexOf(ray); if (i >= 0) this.fx.splice(i, 1); }
        this.dirty = true; this.kick();
      }, 2600);
      this.kick();
    }
    hitTest(clientX, clientY) {
      if (!this.p) return null;
      const r = this.canvas.getBoundingClientRect();
      const cam = this.camera();
      const sx = clientX - r.left, sy = clientY - r.top;
      const dir = [(sx - cam.cx) / cam.S, -(sy - cam.cy) / cam.S, -cam.D];
      const camP = [0, 0, cam.D];
      const AX = [[1, 0, 0], [1, 0, 0], [0, 1, 0], [0, 1, 0], [0, 0, 1], [0, 0, 1]];
      let best = null;
      for (const cell of this.g.cells) {
        if (!this.cellVisible(cell.id, cam)) continue;
        const n = apply(this.R, SlipCube.DIRS[cell.n]), c3 = this.u3(cell.c), c = apply(this.R, c3);
        const den = dot3(dir, n);
        if (Math.abs(den) < 1e-6) continue;
        const t = dot3([c[0] - camP[0], c[1] - camP[1], c[2] - camP[2]], n) / den;
        if (t <= 0 || (best && t >= best.t)) continue;
        const hit = applyT(this.R, [camP[0] + dir[0] * t, camP[1] + dir[1] * t, camP[2] + dir[2] * t]);
        const tans = this.g.tangents(cell.id), U = AX[tans[0]], V = AX[tans[2]];
        const du = dot3([hit[0] - c3[0], hit[1] - c3[1], hit[2] - c3[2]], U), dv = dot3([hit[0] - c3[0], hit[1] - c3[1], hit[2] - c3[2]], V);
        if (Math.abs(du) > 0.52 || Math.abs(dv) > 0.52) continue;
        best = { t, id: cell.id };
      }
      if (!best) return null;
      const id = this.board.occ[best.id];
      return id >= 0 && this.nodes.has(id) ? id : null;
    }
    runs(geo, t0, t1) {
      const out = [];
      const a = this.pointAt(geo, t0), b = this.pointAt(geo, t1);
      const nOf = (tag) => (tag >= 0 ? SlipCube.DIRS[this.g.cells[tag].n] : geo.normal);
      let cur = { tag: geo.tags[a.i], n: nOf(geo.tags[a.i]), pts: [a.p] };
      for (let i = a.i; i < b.i; i++) {
        cur.pts.push(geo.pts[i]);
        if (geo.tags[i + 1] !== cur.tag) { out.push(cur); cur = { tag: geo.tags[i + 1], n: nOf(geo.tags[i + 1]), pts: [geo.pts[i]] }; }
      }
      cur.pts.push(b.p);
      out.push(cur);
      return out;
    }
    dirAt(geo, t) {
      const a = this.pointAt(geo, t - 0.01), b = this.pointAt(geo, t + 0.01);
      return norm3([b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]]);
    }
    showPress(id, on) {
      this.fx = this.fx.filter((f) => !f.press);
      this.pressId = -1;
      if (on && this.nodes.has(id)) {
        const ray = this.rayFor(id);
        if (ray) { ray.press = true; this.fx.push(ray); }
        this.pressId = id;
        if (ray && ray.blocker) this.flash.set(ray.blocker.id, () => 0.8);
      } else {
        for (const [k, f] of this.flash) if (f() === 0.8) this.flash.delete(k);
      }
      this.dirty = true; this.kick();
    }
    /** Turn the shape so faces pointing this way look at the player (only if
        they're turned away). Of the four upright views that do that, the one
        closest to the current view is used. */
    bringToFront(nIndex) {
      const n = SlipCube.DIRS[nIndex];
      if (apply(this.R, n)[2] > 0.3) return;
      const base = START_ROT();
      let best = null, bestScore = -Infinity;
      for (const Q of CUBE_TURNS) {
        const q = apply(Q, n);
        if (q[2] !== 1) continue;
        const cand = matMul(base, Q);
        let tr = 0; for (let i = 0; i < 9; i++) tr += cand[i] * this.R[i];
        if (tr > bestScore) { bestScore = tr; best = cand; }
      }
      if (!best) return;
      const q0 = matToQuat(this.R), q1 = matToQuat(best);
      if (reducedMotion()) { this.R = best; this.dirty = true; this.kick(); return; }
      const start = performance.now(), dur = 520;
      this.anims.add((now) => {
        const t = Math.min(1, (now - start) / dur);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        this.R = quatToMat(slerp(q0, q1, e));
        this.dirty = true;
        return t < 1;
      });
      this.kick();
    }
    bindInput() {
      const el = this.canvas;
      el.addEventListener('pointerdown', (e) => {
        if (!this.p) return;
        el.setPointerCapture && el.setPointerCapture(e.pointerId);
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.spin = null;
        if (this.pointers.size === 1) {
          this.tap = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false, held: false, id: this.h.inputLocked() ? null : this.hitTest(e.clientX, e.clientY) };
          clearTimeout(this.holdTimer);
          if (this.tap.id != null && Save.data.settings.preview) {
            this.holdTimer = setTimeout(() => { if (this.tap && !this.tap.moved) { this.tap.held = true; this.showPress(this.tap.id, true); } }, CUBE_HOLD_MS);
          }
        } else {
          this.tap = null; clearTimeout(this.holdTimer); this.showPress(null, false);
          const pts = [...this.pointers.values()];
          this.pinch = { d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) };
        }
      });
      el.addEventListener('pointermove', (e) => {
        const prev = this.pointers.get(e.pointerId);
        if (!prev) return;
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.lastMove = performance.now();
        if (this.pointers.size === 2 && this.pinch) {
          const pts = [...this.pointers.values()];
          const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          if (this.pinch.d > 0) this.zoomBy(d / this.pinch.d);
          this.pinch.d = d;
          return;
        }
        if (this.tap && !this.tap.moved && Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) > 8) {
          this.tap.moved = true; clearTimeout(this.holdTimer);
          if (this.tap.held) this.showPress(null, false);
        }
        if (!this.tap || this.tap.moved) {
          this.rotate(dx, dy);
          this.spin = { dx, dy };
          this.kick();
        }
      });
      const end = (e) => {
        if (!this.pointers.has(e.pointerId)) return;
        this.pointers.delete(e.pointerId);
        clearTimeout(this.holdTimer);
        if (this.pointers.size < 2) this.pinch = null;
        const tap = this.tap;
        this.tap = null;
        if (this.spin && performance.now() - (this.lastMove || 0) > 70) this.spin = null; // finger had stopped: no fling
        if (tap && tap.held) { this.showPress(null, false); return; }
        if (tap && !tap.moved && e.type === 'pointerup' && tap.id != null && !this.h.inputLocked()) {
          this.spin = null;
          this.h.release(tap.id);
        }
        this.kick();
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
      el.addEventListener('keydown', (e) => {
        const k = { ArrowLeft: [-14, 0], ArrowRight: [14, 0], ArrowUp: [0, -14], ArrowDown: [0, 14] }[e.key];
        if (k) { this.rotate(k[0], k[1]); this.kick(); e.preventDefault(); }
      });
    }
  }

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
    if (mode === 'bonus') diff = SlipCube.bonusCube(Number(key)).diff;
    if (mode === 'picture') diff = PIC.pictureLevel(Number(key)).diff;
    if (mode === 'daily') diff = E.dailyInfo(key).diff;
    return { mode, key: String(key), diff, gen: genFor(key, mode), hearts: usesHearts(mode) ? MAX_HEARTS : null, removed: [], taps: 0, success: 0, blocked: 0, hints: 0, elapsed: 0, assisted: false, done: false, total: 0, stuck: [], day: dateKey() };
  }
  const counted = (sess) => sess.mode !== 'debug' && !sess.assisted;
  /* Hearts: Campaign and Daily allow three blocked taps. The third ends
     the run and the board resets. Zen and the sandbox have no limit. */
  const MAX_HEARTS = 3;
  function usesHearts(mode) { return mode === 'campaign' || mode === 'bonus' || mode === 'daily'; }
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
      return !this.board || !this.session || this.session.done || !$('#complete-overlay').hidden || !$('#confirm-overlay').hidden || !$('#quick-overlay').hidden;
    },

    /** Open a board. Resumes the saved session if it matches, else starts fresh. */
    open(mode, key, diff, opts) {
      opts = opts || {};
      const act = Save.data.active;
      let sess;
      const matches = act && !act.done && act.gen === genFor(key, mode) && act.mode === mode && String(act.key) === String(key) && (mode === 'campaign' || mode === 'bonus' || mode === 'picture' || mode === 'daily' || act.diff === diff);
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
        this.useView(!!puzzle.cube);
        this.board = puzzle.cube ? new SlipCube.BoardState(puzzle, sess.removed) : new E.BoardState(puzzle, sess.removed);
        this.view.load(puzzle, this.board);
        this.view.showOrder(this.showingOrder);
        sess.stuck = (sess.stuck || []).filter((id) => this.board.alive.has(id));
        if (!Save.data.settings.autoRelease) sess.stuck = [];
        for (const id of sess.stuck) this.view.setStuck(id, true);
        loading.hidden = true;
        this.combo = 0;
        this.renderHeader();
        this.updateHud();
        this.updateDebug();
        Save.write();
        if (this.board.count === 0) this.finish();
        if (sess.mode === 'bonus' && !Save.data.seenBonusTip) {
          Save.data.seenBonusTip = true;
          toast('3D bonus! Drag to spin the shape. Arrows bend over edges and fly off the way they point.', 6000);
        } else if (usesHearts(sess.mode) && !Save.data.seenHeartsTip) {
          Save.data.seenHeartsTip = true;
          toast('You have 3 hearts. Each blocked tap costs one.');
        }
      }, 16));
    },

    /** Swap between the flat SVG board and the 3D cube canvas. */
    useView(cube) {
      if (!this.flatView) return;
      this.view = cube ? this.cubeView : this.flatView;
      $('#board').toggleAttribute('hidden', cube); // SVG elements need the attribute itself
      $('#cube').hidden = !cube;
      $('#board-wrap').classList.toggle('is-cube', cube);
    },

    renderHeader() {
      renderHearts(this.session);
      const sess = this.session;
      const chip = $('#game-diff');
      chip.textContent = diffLabel(sess.diff);
      chip.className = 'diff-chip diff-' + sess.diff;
      let mode = '', name = '';
      if (sess.mode === 'campaign') { mode = 'Campaign'; name = 'Level ' + sess.key; }
      else if (sess.mode === 'bonus') { mode = 'Campaign · 3D bonus'; name = 'Bonus ' + sess.key; }
      else if (sess.mode === 'picture') {
        const k = Number(sess.key), rec = Save.data.pictures.done[k];
        mode = 'Pictures'; name = rec && rec.completed ? PIC.PICTURES[k].name : `Picture ${k + 1}`; // a mystery until found
      }
      else if (sess.mode === 'daily') { mode = 'Daily Puzzle'; name = shortDate(sess.key); }
      else if (sess.mode === 'zen') { mode = isCubeKey(sess.key) ? 'Zen · 3D' : 'Zen'; name = 'Board ' + ((Save.data.zen.session.count || 0) + 1); }
      else { mode = isCubeKey(sess.key) ? 'Sandbox 3D · not counted' : 'Sandbox · not counted'; name = 'Seed ' + (isCubeKey(sess.key) ? String(sess.key).slice(3) : sess.key); }
      $('#game-mode').textContent = mode;
      $('#game-name').textContent = name;
      document.title = `${name} · Arrow Escape`;
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

    release(id, auto) {
      const sess = this.session;
      if (!this.board || !sess || sess.done || !this.board.alive.has(id)) return;
      const st = Save.data.stats;
      const count = counted(sess);
      if (!sess.stuck) sess.stuck = [];
      if (!auto) {
        sess.taps++;
        if (count) st.taps++;
      }
      const blocker = this.board.firstBlocker(id);
      if (blocker) {
        if (auto) return;
        sess.blocked++;
        if (count) st.blocked++;
        this.combo = 0;
        this.view.blocked(id, blocker);
        // Auto-release: the arrow turns red and waits; it flies out by itself
        // as soon as its way is clear.
        if (Save.data.settings.autoRelease && !sess.stuck.includes(id)) {
          sess.stuck.push(id);
          this.view.setStuck(id, true);
        }
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
        const wasStuck = sess.stuck.indexOf(id);
        if (wasStuck >= 0) { sess.stuck.splice(wasStuck, 1); this.view.setStuck(id, false); }
        this.board.remove(id);
        sess.removed.push(id);
        sess.success++;
        if (count) {
          st.success++;
          st.arrows++;
          if (sess.mode === 'zen') { Save.data.zen.arrows++; if (isCubeKey(sess.key)) Save.data.zen.arrows3d++; }
        }
        this.combo++;
        this.view.escape(id);
        Sound.play('escape', this.combo - 1);
        if (this.showingOrder) this.view.showOrder(true);
        announce(this.board.count ? `${auto ? 'Waiting arrow flew out' : 'Released'}. ${this.board.count} left.` : 'Board cleared.');
        if (this.board.count === 0) this.finish();
        else if (sess.stuck.length) this.queueWaiting();
      }
      this.updateHud();
      this.updateDebug();
      Save.soon();
    },
    /** Shortly after an arrow leaves, any red (waiting) arrow whose way is now
        clear flies out by itself, which can set off a chain. */
    queueWaiting() {
      const sess = this.session, board = this.board;
      clearTimeout(this.waitTimer);
      this.waitTimer = setTimeout(() => {
        if (this.session !== sess || this.board !== board || sess.done || !sess.stuck) return;
        const free = sess.stuck.filter((id) => board.alive.has(id) && !board.firstBlocker(id));
        free.forEach((id, i) => setTimeout(() => {
          if (this.session === sess && this.board === board && !sess.done) this.release(id, true);
        }, i * 110));
      }, reducedMotion() ? 120 : 260);
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
      if (this.puzzle.cube) announce('Hint: the glowing arrow can escape.');
      else announce(`Hint: the arrow pointing ${E.DIR_NAMES[a.dir]} with its head at column ${a.cells[a.cells.length - 1][0] + 1}, row ${a.cells[a.cells.length - 1][1] + 1} can escape.`);
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
        if (sess.mode === 'campaign' || sess.mode === 'bonus') {
          const lv = levelStore(sess.mode);
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
      showScreen(mode === 'debug' ? (this.debugFrom || 'zen') : mode === 'bonus' ? 'campaign' : mode === 'picture' ? 'pictures' : mode);
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
        ['Difficulty', p.cube ? `${diffLabel(p.diff)} · 3D` : `${diffLabel(p.diff)} (t=${p.t.toFixed(2)})`],
        ['Board', p.cube ? (() => { const g = SlipCube.geometryOf(p); return `${g.X} × ${g.Y} × ${g.Z} · ${p.shape === 'blocks' ? (p.boxes || []).length + ' blocks' : 'cube'} · ${g.cells.length} squares`; })() : `${p.cols} × ${p.rows} · ${p.shape}`],
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
    if (sess.mode === 'picture') {
      const pd = Save.data.pictures.done;
      pd[sess.key] = Object.assign({ plays: 0 }, pd[sess.key]);
      pd[sess.key].plays++;
    }
    if (sess.mode === 'campaign' || sess.mode === 'bonus') {
      const lv = levelStore(sess.mode);
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
    // Past dailies can be bought back to this day. Older saves: the first daily in the history, else today.
    if (!Save.data.startedOn) Save.data.startedOn = Object.keys(hist).sort()[0] || dateKey();
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

  /* ======================================================================
     PROGRESS — XP, player level and coins. Coins only buy looks in the
     Style shop; hints stay free (they cost stars instead).
     ====================================================================== */
  const XP_BASE = { easy: 10, medium: 15, hard: 20, expert: 30, nightmare: 40, insane: 55, impossible: 75, inconceivable: 110 };
  /** XP needed to go from level L to L + 1. */
  const xpToNext = (L) => 60 + 20 * (L - 1);
  function levelInfo(xp) {
    let level = 1, need = xpToNext(1), into = xp;
    while (into >= need) { into -= need; level++; need = xpToNext(level); }
    return { level, into, need };
  }
  const levelUpCoins = (L) => 15 + 5 * L;
  /** XP and coins for one clear. `replay` = this board was already cleared before. */
  function rewardFor(mode, diff, stars, replay) {
    const base = XP_BASE[diff] || 10;
    let xp = base + (stars - 1) * Math.round(base * 0.25);
    let coins = 1 + stars + Math.round(base / 10);
    if (mode === 'zen') { xp = Math.round(xp * 0.6); coins = Math.max(1, Math.round(coins * 0.6)); }
    if (replay) { xp = Math.max(1, Math.round(xp / 2)); coins = Math.max(1, Math.round(coins / 2)); }
    if (mode === 'daily' && !replay) { xp += 20; coins += 10; }
    if (mode === 'bonus' && !replay) { xp += 15; coins += 5; }
    return { xp, coins };
  }
  /** Add XP/coins; pays the level-up bonus for every level gained. */
  function grant(xp, coins) {
    const pr = Save.data.progress;
    const before = levelInfo(pr.xp);
    pr.xp += xp;
    const after = levelInfo(pr.xp);
    let bonus = 0;
    for (let L = before.level + 1; L <= after.level; L++) bonus += levelUpCoins(L);
    pr.coins += coins + bonus;
    pr.coinsEarned += coins + bonus;
    return { xp, coins, bonus, before, after, levelUp: after.level > before.level };
  }
  /** One-time catch-up so players who already cleared boards don't start at Level 1. */
  function migrateProgress() {
    const pr = Save.data.progress;
    if (pr.migrated) return null;
    pr.migrated = true;
    let xp = 0, coins = 0;
    const add = (r) => { xp += r.xp; coins += r.coins; };
    const lv = Save.data.campaign.levels;
    for (const k in lv) if (lv[k].completed) add(rewardFor('campaign', E.campaignLevelInfo(Number(k)).diff, lv[k].stars || 1, false));
    const hist = Save.data.daily.history;
    for (const k in hist) if (hist[k].completed) add(rewardFor('daily', hist[k].diff || 'medium', hist[k].stars || 1, false));
    const zb = Save.data.zen.boards;
    for (const d in zb) add({ xp: zb[d] * rewardFor('zen', d, 2, false).xp, coins: zb[d] * rewardFor('zen', d, 2, false).coins });
    if (!xp) return null;
    return grant(xp, coins);
  }

  /* ======================================================================
     ACHIEVEMENTS (stored as milestones) — one-time goals with a coin bonus. Each has a progress
     function returning [done, goal]; earned ones are stored by id.
     ====================================================================== */
  const TIER_BONUS = { easy: 50, medium: 75, hard: 100, expert: 150, nightmare: 200, insane: 250, impossible: 400 };
  const tierDone = (tr) => { const lv = Save.data.campaign.levels; let n = 0; for (let L = tr.from; L <= tr.to; L++) if (lv[L] && lv[L].completed) n++; return n; };
  const zenTotal = () => Object.values(Save.data.zen.boards).reduce((a, b) => a + b, 0);
  const MILESTONES = [
    ...E.CAMPAIGN_TIERS.map((tr) => ({
      id: 'tier-' + tr.diff, name: `${diffLabel(tr.diff)} complete`, desc: `Clear all ${tr.to - tr.from + 1} ${diffLabel(tr.diff)} levels`,
      coins: TIER_BONUS[tr.diff] || 100, progress: () => [tierDone(tr), tr.to - tr.from + 1],
    })),
    { id: 'campaign-all', name: 'Campaign champion', desc: `Clear all ${E.CAMPAIGN_LENGTH} campaign levels`, coins: 500,
      progress: () => [E.CAMPAIGN_TIERS.reduce((a, tr) => a + tierDone(tr), 0), E.CAMPAIGN_LENGTH] },
    { id: 'login-week', name: 'Regular', desc: 'Collect daily coins 7 days in a row', coins: 50,
      progress: () => [Math.min(7, Save.data.progress.login.best || 0), 7] },
    { id: 'inconceivable', name: 'Inconceivable!', desc: 'Clear an Inconceivable board in Zen', coins: 200,
      progress: () => [Math.min(1, Save.data.zen.boards.inconceivable || 0), 1] },
    { id: 'pictures-10', name: 'Art collector', desc: 'Find 10 pictures', coins: 100,
      progress: () => [Math.min(10, picDone()), 10] },
    { id: 'pictures-all', name: 'Full gallery', desc: `Find all ${window.SlipPictures.PICTURES.length} pictures`, coins: 300,
      progress: () => [picDone(), window.SlipPictures.PICTURES.length] },
    { id: 'bonus-first', name: 'Third dimension', desc: 'Clear your first 3D bonus level', coins: 50,
      progress: () => [Math.min(1, bonusDone()), 1] },
    { id: 'bonus-all', name: 'Cube master', desc: `Clear all ${SlipCube.BONUS_COUNT} 3D bonus levels`, coins: 300,
      progress: () => [bonusDone(), SlipCube.BONUS_COUNT] },
    { id: 'streak-7', name: 'Week streak', desc: 'Solve the Daily Puzzle 7 days in a row', coins: 50,
      progress: () => [Math.min(7, Math.max(Save.data.daily.longestStreak || 0, dailyStreaks().longest)), 7] },
    { id: 'streak-30', name: 'Month streak', desc: 'Solve the Daily Puzzle 30 days in a row', coins: 150,
      progress: () => [Math.min(30, Math.max(Save.data.daily.longestStreak || 0, dailyStreaks().longest)), 30] },
    { id: 'perfect-10', name: 'Flawless ten', desc: '10 perfect clears in a row', coins: 75,
      progress: () => [Math.min(10, Save.data.stats.bestPerfectStreak || 0), 10] },
    { id: 'zen-100', name: 'Zen master', desc: 'Clear 100 Zen boards', coins: 75, progress: () => [Math.min(100, zenTotal()), 100] },
    { id: 'level-25', name: 'Level 25', desc: 'Reach player level 25', coins: 100,
      progress: () => [Math.min(25, levelInfo(Save.data.progress.xp).level), 25] },
  ];
  /** Award every milestone that is now complete but not yet recorded. */
  function checkMilestones() {
    const got = Save.data.milestones, earned = [];
    for (const m of MILESTONES) {
      if (got[m.id]) continue;
      const [n, goal] = m.progress();
      if (n >= goal) {
        got[m.id] = new Date().toISOString();
        Save.data.progress.coins += m.coins;
        Save.data.progress.coinsEarned += m.coins;
        earned.push(m);
      }
    }
    return earned;
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
      res.replay = !!rec.completed;
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
      if (L % SlipCube.BONUS_AFTER === 0 && L / SlipCube.BONUS_AFTER <= SlipCube.BONUS_COUNT && !rec.bonusNoted) {
        rec.bonusNoted = true;
        res.notes.push(`3D Bonus ${L / SlipCube.BONUS_AFTER} unlocked`);
      }
    } else if (sess.mode === 'picture') {
      const k = Number(sess.key);
      const pd = Save.data.pictures.done;
      const rec = Object.assign({ plays: 1 }, pd[k]);
      res.replay = !!rec.completed;
      res.firstFind = !rec.completed;
      if (rec.bestTime == null || sess.elapsed < rec.bestTime) { if (rec.completed) res.notes.push('New best time for this picture'); rec.bestTime = sess.elapsed; }
      rec.completed = true;
      rec.perfect = !!rec.perfect || perfect;
      if (rec.stars && res.stars > rec.stars) res.notes.push(`New best: ${res.stars} stars`);
      rec.stars = Math.max(rec.stars || 0, res.stars);
      rec.clears = (rec.clears || 0) + 1;
      pd[k] = rec;
      if (res.firstFind) res.notes.push(`${picDone()} of ${PIC.PICTURES.length} pictures found`);
    } else if (sess.mode === 'bonus') {
      const k = Number(sess.key);
      const bl = Save.data.campaign.bonus;
      const rec = Object.assign({ plays: 1 }, bl[k]);
      res.replay = !!rec.completed;
      if (rec.bestTime == null || sess.elapsed < rec.bestTime) { if (rec.completed) res.notes.push('New best time for this level'); rec.bestTime = sess.elapsed; }
      rec.completed = true;
      rec.perfect = !!rec.perfect || perfect;
      if (rec.stars && res.stars > rec.stars) res.notes.push(`New best: ${res.stars} stars`);
      rec.stars = Math.max(rec.stars || 0, res.stars);
      rec.clears = (rec.clears || 0) + 1;
      bl[k] = rec;
    } else if (sess.mode === 'daily') {
      const hist = Save.data.daily.history;
      const rec = Object.assign({ attempted: true }, hist[sess.key]);
      res.replay = !!rec.completed;
      const late = sess.key < (sess.day || dateKey());
      res.late = late;
      if (!rec.completed) {
        rec.completed = true;
        if (late) rec.late = true;
        rec.time = sess.elapsed;
        rec.perfect = perfect;
        rec.stars = res.stars;
        rec.diff = sess.diff;
      } else if (res.stars > (rec.stars || 0)) {
        /* A replay can raise the stars; the first clear's time and streak stay. */
        res.notes.push(`New best: ${res.stars} stars`);
        rec.stars = res.stars;
        if (perfect) rec.perfect = true;
      }
      hist[sess.key] = rec;
      const sk = dailyStreaks();
      Save.data.daily.longestStreak = Math.max(Save.data.daily.longestStreak || 0, sk.longest);
      res.streak = sk.current;
      if (late) res.notes.push('Played late, so it doesn’t count toward your streak');
      else res.notes.push(sk.current > 1 ? `Daily streak: ${sk.current} days` : 'Daily streak started');
    } else if (sess.mode === 'zen') {
      const z = Save.data.zen;
      z.boards[d] = (z.boards[d] || 0) + 1;
      if (perfect) z.perfect++;
      if (isCubeKey(sess.key)) { z.boards3d[d] = (z.boards3d[d] || 0) + 1; if (perfect) z.perfect3d++; }
      z.session.count = (z.session.count || 0) + 1;
      z.longestSession = Math.max(z.longestSession || 0, z.session.count);
      res.sessionCount = z.session.count;
      res.notes.push(`${z.session.count} board${z.session.count === 1 ? '' : 's'} this session`);
    }
    if (res.fastest && sess.mode !== 'campaign') res.notes.push(`Fastest ${diffLabel(d)} clear yet`);
    if (perfect && st.perfectStreak > 1) res.notes.push(`${st.perfectStreak} perfect clears in a row`);
    const rw = rewardFor(res.late ? 'daily-late' : sess.mode, d, res.stars, !!res.replay); // no daily bonus for past days
    res.reward = grant(rw.xp, rw.coins);
    res.milestones = checkMilestones();
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
      document.title = 'Arrow Escape';
      $('#complete-overlay').hidden = true;
      clearTimeout(zenTimer);
    }
    if (renderers[name]) renderers[name]();
    Save.soon();
    const scr = $('#screen-' + name);
    if (name !== 'game') scr.scrollTop = 0;
  }

  /* ---------------- Home ---------------- */
  const COIN_SVG = '<svg class="coin" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /></svg>';
  /* DAILY COINS: claim once a day from the home screen. Coming back on
     consecutive days climbs a 7-day ladder; missing a day starts it over. */
  const LOGIN_COINS = [5, 8, 10, 12, 15, 20, 40];
  function loginState() {
    const lg = Save.data.progress.login, today = dateKey();
    if (lg.last === today) return { claimed: true, streak: lg.streak, day: ((lg.streak - 1) % 7) + 1 };
    const streak = lg.last === addDays(today, -1) ? lg.streak + 1 : 1;
    return { claimed: false, streak, day: ((streak - 1) % 7) + 1, reset: lg.streak > 0 && streak === 1 };
  }
  /** Pop-up on the home screen the first time you open the app each day.
      The coins are added as it opens, so closing the app early never loses them. */
  function showDailyGift() {
    if (!Save.ok || !$('#gift-overlay').hidden) return;
    const st = loginState();
    if (st.claimed) return;
    const lg = Save.data.progress.login;
    lg.last = dateKey(); lg.streak = st.streak; lg.best = Math.max(lg.best || 0, st.streak);
    const amt = LOGIN_COINS[st.day - 1];
    grant(0, amt);
    const ms = checkMilestones();
    Save.write();
    const ov = $('#gift-overlay');
    $('#gift-day').textContent = `Day ${st.day}`;
    $('#gift-amount').textContent = `+${amt} coins`;
    const next = LOGIN_COINS[st.day % 7];
    $('#gift-text').textContent = st.day === 7
      ? `A full week! Tomorrow the ladder starts again at ${next}.`
      : st.reset ? `Your streak started over. Come back tomorrow for ${next}.`
      : `Your daily coins. Come back tomorrow for ${next}.`;
    const pips = $('#gift-pips');
    pips.textContent = '';
    for (let d = 1; d <= 7; d++) pips.append(h('i', { class: d < st.day ? 'is-got' : d === st.day ? 'is-today' : '', title: `Day ${d}: ${LOGIN_COINS[d - 1]}` }));
    ov.classList.toggle('is-big', st.day === 7);
    ov.hidden = false;
    Sound.play('daily');
    announce(`Day ${st.day}. ${amt} coins added.`);
    setTimeout(() => $('#gift-ok').focus(), 50);
    ov._ms = ms;
  }
  function closeDailyGift() {
    const ov = $('#gift-overlay');
    if (ov.hidden) return;
    ov.hidden = true;
    renderPlayer();
    const pill = $('#home-player .coin-pill');
    pill.classList.remove('is-bump'); void pill.offsetWidth; pill.classList.add('is-bump');
    const ms = ov._ms || [];
    if (ms.length) toast(`🏆 Achievement unlocked: ${ms[0].name} · +${ms[0].coins} coins`, 3200);
  }
  function renderPlayer() {
    const pr = Save.data.progress;
    const li = levelInfo(pr.xp);
    $('#home-level').textContent = li.level;
    $('#home-xp').textContent = `${fmtNum(li.into)} / ${fmtNum(li.need)} XP`;
    $('#home-xp-bar').style.width = `${pct(li.into, li.need)}%`;
    $('#home-coins').textContent = fmtNum(pr.coins);
  }
  renderers.home = function () {
    HeroStream.start();
    renderPlayer();
    setTimeout(() => { if (currentScreen === 'home') showDailyGift(); }, 450);
    const achN = MILESTONES.filter((m) => Save.data.milestones[m.id]).length;
    $('#home-ach-count').textContent = `${achN} / ${MILESTONES.length}`;
    const act = Save.data.active;
    const cont = $('#home-continue');
    if (act && !act.done && act.mode !== 'debug') {
      cont.hidden = false;
      let title = '';
      if (act.mode === 'campaign') title = `Level ${act.key} · ${diffLabel(act.diff)}`;
      else if (act.mode === 'bonus') title = `3D Bonus ${act.key} · ${diffLabel(act.diff)}`;
      else if (act.mode === 'picture') title = `Picture ${Number(act.key) + 1} · ${diffLabel(act.diff)}`;
      else if (act.mode === 'daily') title = act.key === dateKey() ? `Today's Daily · ${diffLabel(act.diff)}` : `Daily ${shortDate(act.key)}`;
      else title = `Zen · ${diffLabel(act.diff)}`;
      $('#home-continue-title').textContent = title;
      const left = act.total ? act.total - act.removed.length : null;
      $('#home-continue-sub').textContent = (left != null ? `${left} arrows left · ` : '') + fmtTime(act.elapsed);
    } else cont.hidden = true;

    const lv = Save.data.campaign.levels;
    const done = Object.keys(lv).filter((k) => lv[k].completed).length;
    const un = Save.data.campaign.unlocked;
    $('#home-campaign-sub').textContent = done ? `${done} cleared · ★ ${campaignStars()} · next up: Level ${Math.min(un, E.CAMPAIGN_LENGTH)}` : `${E.CAMPAIGN_LENGTH} levels · Easy to ${diffLabel(E.CAMPAIGN_TIERS[E.CAMPAIGN_TIERS.length - 1].diff)}`;
    $('#home-campaign-bar').style.width = `${pct(done, E.CAMPAIGN_LENGTH)}%`;
    const pf = picDone(), pn = PIC.PICTURES.length;
    $('#home-pictures-sub').textContent = pf ? `${pf} of ${pn} pictures found` : `${pn} hidden pictures to find`;
    $('#home-pictures-bar').style.width = `${pct(pf, pn)}%`;

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

  /* ---------------- Style shop ---------------- */
  /** Little preview boards for the shop cards (static SVG, no BoardView). */
  function previewArrow(pts, color, extra) {
    const d = BoardView.pathD(pts);
    const [x1, y1] = pts[pts.length - 2], [x2, y2] = pts[pts.length - 1];
    const dx = Math.sign(x2 - x1), dy = Math.sign(y2 - y1);
    const tip = [x2 + dx * TIP, y2 + dy * TIP], base = [x2 - dx * HEAD_BACK, y2 - dy * HEAD_BACK];
    const px = -dy * headHalf(), py = dx * headHalf();
    const head = `M${tip[0]} ${tip[1]}L${base[0] + px} ${base[1] + py}L${base[0] - px} ${base[1] - py}Z`;
    const body = BoardView.pathD(pts.slice(0, -1).concat([base]));
    return `<g class="arrow" style="--c:var(--a${color})" ${extra || ''}><path class="casing" d="${body}"/><path class="head-casing" d="${head}"/><path d="${body}" fill="none" stroke="var(--a${color})" style="stroke-width:var(--aw)" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="${head}" fill="var(--a${color})" stroke="var(--a${color})" stroke-width="0.06" stroke-linejoin="round"/></g>`;
  }
  function previewBoard(cols, rows, inner, arrows, board, ignoreCvd) {
    let dots = '';
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) dots += `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.06"/>`;
    const svg = `<svg class="style-prev" viewBox="-0.3 -0.3 ${cols + 0.6} ${rows + 0.6}" aria-hidden="true">` +
      `<rect class="board-bg" x="-0.3" y="-0.3" width="${cols + 0.6}" height="${rows + 0.6}" rx="0.5"/><g class="board-dot">${dots}</g>${inner}</svg>`;
    const wrap = document.createElement('div');
    wrap.innerHTML = svg;
    const el = wrap.firstChild;
    applySkin(el, arrows, board, ignoreCvd);
    return el;
  }
  const PREVIEW_ARROWS = () =>
    previewArrow([[0.5, 0.5], [2.5, 0.5]], 0) +
    previewArrow([[0.5, 2.5], [0.5, 1.5], [2.5, 1.5]], 4) +
    previewArrow([[1.5, 2.5], [3.5, 2.5]], 2) +
    previewArrow([[3.5, 1.5], [3.5, 0.5], [4.5, 0.5]], 6) +
    previewArrow([[4.5, 2.5], [4.5, 1.5]], 1);
  function trailPreview(id) {
    const y = 1;
    const tr = TRAILS[id];
    const tail = 3.0, len = tr.len;
    let fx = '';
    if (tr.rainbow) {
      const L = Math.min(len, tail), n = RAINBOW.length;
      RAINBOW.forEach((c, i) => {
        const x1 = tail - (L / n) * i, x0 = x1 - L / n;
        fx += `<path d="M${x0.toFixed(2)} ${y}H${x1.toFixed(2)}" stroke="var(--a${c})" style="stroke-width:var(--aw)" opacity="0.95" stroke-linecap="${i === n - 1 ? 'round' : 'butt'}"/>`;
      });
    } else {
      fx += `<path d="M${tail - len} ${y}H${tail}" stroke="var(--a4)" stroke-width="${0.17 * (tr.width || 0.7)}" opacity="${tr.opacity}" stroke-linecap="round"/>`;
    }
    if (tr.sparkle) {
      [[0.6, 0.62, 0.07], [1.2, 1.38, 0.05], [1.7, 0.8, 0.08], [2.3, 1.3, 0.06], [0.9, 1.15, 0.05], [2.6, 0.7, 0.05]]
        .forEach(([x, yy, r], i) => { fx += `<circle cx="${x}" cy="${yy}" r="${r}" fill="${i % 3 === 0 ? '#fff' : `var(--a${(4 + i) % 8})`}"/>`; });
    }
    let arrow = previewArrow([[tail, y], [tail + 2, y]], 4);
    if (tr.firework) {
      for (let i = 0; i < 12; i++) {
        const ang = (Math.PI * 2 * i) / 12, r = 0.45 + (i % 3) * 0.18;
        fx += `<circle cx="${(5.9 + Math.cos(ang) * r).toFixed(2)}" cy="${(y + Math.sin(ang) * r).toFixed(2)}" r="0.07" fill="var(--a${i % 8})"/>`;
      }
      arrow = previewArrow([[tail + 0.4, y], [tail + 2, y]], 4);
    }
    return previewBoard(7, 2, fx + arrow);
  }
  function buyOrEquip(kind, item) {
    const pr = Save.data.progress;
    const owned = pr.owned[kind].includes(item.id);
    if (!owned) {
      if (pr.coins < item.price) return;
      pr.coins -= item.price;
      pr.owned[kind].push(item.id);
      Sound.play('complete');
      toast(`${item.name} unlocked`);
    } else Sound.play('tap');
    pr.equip[kind] = item.id;
    Save.write();
    renderers.style();
  }
  renderers.style = function () {
    const pr = Save.data.progress;
    const li = levelInfo(pr.xp);
    $('#style-coins').textContent = fmtNum(pr.coins);
    const lvl = $('#style-level');
    lvl.innerHTML = `<span class="lvl-badge"><small>Level</small><b>${li.level}</b></span>` +
      `<span class="player-mid"><span class="player-row"><span>${fmtNum(li.need - li.into)} XP to Level ${li.level + 1}</span><span>+${levelUpCoins(li.level + 1)} coins</span></span>` +
      `<span class="xp-bar"><span style="width:${pct(li.into, li.need)}%"></span></span></span>`;
    const wrap = $('#style-sections');
    wrap.textContent = '';
    for (const [kind, title] of STYLE_KINDS) {
      const grid = h('div', { class: 'style-grid' });
      for (const it of STYLE[kind]) {
        const owned = pr.owned[kind].includes(it.id);
        const on = pr.equip[kind] === it.id;
        const prev = kind === 'arrows' ? previewBoard(5, 3, PREVIEW_ARROWS(), it.id, null, true)
          : kind === 'board' ? previewBoard(5, 3, PREVIEW_ARROWS(), null, it.id)
          : trailPreview(it.id);
        let label, cls = 'style-btn', disabled = false;
        if (on) { label = 'Equipped'; cls += ' is-on'; disabled = true; }
        else if (owned) label = 'Use';
        else if (pr.coins >= it.price) { label = ''; cls += ' is-buy'; }
        else { label = ''; cls += ' is-locked'; disabled = true; }
        const btn = h('button', { class: cls, type: 'button', onclick: () => buyOrEquip(kind, it) });
        if (label) btn.textContent = label;
        else btn.innerHTML = `${COIN_SVG}<span>${fmtNum(it.price)}</span>`;
        btn.disabled = disabled;
        if (!owned) btn.setAttribute('aria-label', pr.coins >= it.price ? `Buy ${it.name} for ${it.price} coins` : `${it.name}: needs ${it.price - pr.coins} more coins`);
        const card = h('div', { class: 'style-card' + (on ? ' is-on' : '') }, prev,
          h('div', { class: 'style-meta' }, h('strong', { text: it.name }), it.desc ? h('span', { text: it.desc }) : null), btn);
        grid.append(card);
      }
      const note = kind === 'arrows' && Save.data.settings.colorblind
        ? h('p', { class: 'style-note', text: 'Color-blind friendly colors are on in Settings, so puzzles use those instead of a theme. Turn them off to use these.' }) : null;
      wrap.append(h('section', { class: 'style-section' }, h('h3', { text: title }), note, grid));
    }
  };

  /* ---------------- Achievements ---------------- */
  renderers.achievements = function () {
    const got = Save.data.milestones;
    const list = $('#ach-list');
    list.textContent = '';
    // Earned ones first (newest first), then the rest in their natural order.
    const earned = MILESTONES.filter((m) => got[m.id]).sort((a, b) => (got[b.id] > got[a.id] ? 1 : -1));
    const open = MILESTONES.filter((m) => !got[m.id]);
    for (const m of earned.concat(open)) {
      const [n, goal] = m.progress();
      const done = !!got[m.id];
      const item = h('div', { class: 'ms-item' + (done ? ' is-done' : '') },
        h('span', { class: 'ms-icon', html: TROPHY_SVG }),
        h('span', { class: 'ms-text' }, h('strong', { text: m.name }), h('small', { text: m.desc }),
          done ? h('small', { class: 'ms-when', text: 'Earned ' + new Date(got[m.id]).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) })
            : h('span', { class: 'ms-prog' }, h('span', { style: `width:${pct(Math.min(n, goal), goal)}%` }))),
        h('span', { class: 'ms-state' }, done ? '✓ Earned' : `${fmtNum(Math.min(n, goal))} / ${fmtNum(goal)}`,
          h('small', { html: `${COIN_SVG}+${m.coins}` })));
      list.append(item);
    }
    const k = earned.length;
    $('#ach-count').textContent = `${k} / ${MILESTONES.length}`;
    $('#ach-bar').style.width = `${pct(k, MILESTONES.length)}%`;
  };

  /* ---------------- Pictures ---------------- */
  renderers.pictures = function () {
    const grid = $('#pic-grid');
    grid.textContent = '';
    const pd = Save.data.pictures.done, n = PIC.PICTURES.length;
    let next = null;
    for (let k = 0; k < n; k++) {
      const rec = pd[k] || {}, L = PIC.pictureLevel(k);
      const open = picUnlocked(k);
      const cls = ['pic-tile', 'tier-' + L.diff];
      if (rec.completed) cls.push('is-done'); else if (open) cls.push('is-open'); else cls.push('is-locked');
      if (open && !rec.completed && next == null) { next = k; cls.push('is-next'); }
      const label = rec.completed ? `${PIC.PICTURES[k].name}, ${rec.stars || 1} of 3 stars` : open ? `Picture ${k + 1}, a mystery. ${diffLabel(L.diff)}` : `Picture ${k + 1}, locked`;
      const tile = h('button', { class: cls.join(' '), type: 'button', disabled: !open, 'aria-label': label, 'data-pic': k });
      if (rec.completed) {
        tile.innerHTML = picSvg(k, 'pic-art');
        tile.append(h('span', { class: 'pic-name', text: PIC.PICTURES[k].name }), starIcons(rec.stars || 1, 'tiny'));
      } else {
        tile.append(h('span', { class: 'pic-mystery', text: open ? '?' : '' }), h('span', { class: 'pic-name', text: open ? `#${k + 1}` : `#${k + 1} · locked` }));
      }
      grid.append(tile);
    }
    const found = picDone();
    $('#pic-count').textContent = `${found} / ${n}`;
    $('#pic-bar').style.width = `${pct(found, n)}%`;
  };
  $('#pic-grid').addEventListener('click', (e) => {
    const t = e.target.closest('.pic-tile');
    if (!t || t.disabled) return;
    Sound.play('tap');
    Game.open('picture', Number(t.dataset.pic));
  });

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
        if (L % SlipCube.BONUS_AFTER === 0 && L / SlipCube.BONUS_AFTER <= SlipCube.BONUS_COUNT) grid.append(bonusTile(L / SlipCube.BONUS_AFTER));
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
  /** A 3D bonus tile, shown right after every 10th level. */
  function bonusTile(k) {
    const rec = Save.data.campaign.bonus[k] || {};
    const locked = !bonusUnlocked(k);
    const diff = SlipCube.bonusCube(k).diff;
    const cls = ['level', 'level-bonus', 'tier-' + diff];
    if (rec.completed) cls.push('is-done');
    if (rec.perfect) cls.push('is-perfect');
    if (!locked && !rec.completed) cls.push('is-new');
    const label = locked ? `3D bonus ${k}, unlocks after level ${bonusAfter(k)}`
      : `3D bonus ${k}, ${diffLabel(diff)}${rec.completed ? `, ${rec.stars || 1} of 3 stars` : ''}`;
    return h('button', { class: cls.join(' '), type: 'button', disabled: locked, 'aria-label': label, 'data-bonus': k,
      title: locked ? `Clear level ${bonusAfter(k)} to unlock` : `3D bonus ${k}` },
      h('span', { class: 'level-num', html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z M4 7.5l8 4.5 8-4.5 M12 12v9"/></svg>' }),
      rec.completed ? starIcons(rec.stars || 1, 'tiny') : h('span', { class: 'bonus-tag', text: '3D' }));
  }
  $('#campaign-tiers').addEventListener('click', (e) => {
    const b = e.target.closest('.level');
    if (!b || b.disabled) return;
    Sound.play('tap');
    if (b.dataset.bonus) { Game.open('bonus', Number(b.dataset.bonus)); return; }
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
    const first = Save.data.startedOn || Object.keys(hist).sort()[0] || today;
    const bought = Save.data.daily.unlocked || {};
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
      else if (k < today && k >= first) { mark = bought[k] ? '▸' : '•'; desc = bought[k] ? 'unlocked, not solved yet' : `missed, tap to unlock for ${DAILY_PAST_COST} coins`; }
      if (rec && rec.completed && rec.late) { cls.push('is-late'); desc += ', played late'; }
      if (k === today) { cls.push('is-today'); if (!rec || !rec.completed) desc = 'today, not solved yet'; }
      if (k > today) { cls.push('is-future'); desc = 'upcoming'; }
      const mk = mark === '★' ? 'mark-perfect' : mark === '✓' ? 'mark-done' : mark === '▸' ? 'mark-open' : 'mark-missed';
      // Every day from the first one you played up to yesterday can be opened.
      const playable = k < today && k >= first;
      if (playable) cls.push('is-playable');
      grid.append(h(playable ? 'button' : 'div', { class: cls.join(' '), type: playable ? 'button' : null, role: playable ? null : 'gridcell', 'data-day': playable ? k : null, 'aria-label': `${MONTHS[m]} ${day}: ${desc}` },
        h('span', { text: String(day) }), h('i', { class: 'mark ' + mk, 'aria-hidden': 'true', text: mark })));
    }
    const now = new Date();
    $('#cal-next').disabled = y > now.getFullYear() || (y === now.getFullYear() && m >= now.getMonth());
  }
  $('#cal-prev').addEventListener('click', () => { let [y, m] = calMonth; m--; if (m < 0) { m = 11; y--; } calMonth = [y, m]; renderCalendar(); });
  $('#cal-next').addEventListener('click', () => { let [y, m] = calMonth; m++; if (m > 11) { m = 0; y++; } calMonth = [y, m]; renderCalendar(); });
  $('#daily-play').addEventListener('click', () => { Sound.play('tap'); Game.open('daily', dateKey()); });
  /* Past dailies: solved or already-unlocked days open for free; a missed
     day costs DAILY_PAST_COST coins once, then it's yours to retry. */
  const DAILY_PAST_COST = 10;
  $('#cal-grid').addEventListener('click', async (e) => {
    const cell = e.target.closest('[data-day]');
    if (!cell) return;
    const k = cell.dataset.day;
    const rec = Save.data.daily.history[k];
    const bought = Save.data.daily.unlocked;
    Sound.play('tap');
    if ((rec && rec.completed) || bought[k]) { Game.open('daily', k); return; }
    const info = E.dailyInfo(k);
    const pr = Save.data.progress;
    const date = `${MONTHS[parseKey(k).getMonth()]} ${parseKey(k).getDate()}`;
    if (pr.coins < DAILY_PAST_COST) {
      await confirmDialog({ title: `${date} · ${diffLabel(info.diff)}`, body: `<p>Playing a past day costs ${DAILY_PAST_COST} coins. You have ${pr.coins}, so you need ${DAILY_PAST_COST - pr.coins} more.</p><p class="hold-note">Clear a few boards or collect your daily coins, then come back.</p>`, ok: 'OK' });
      return;
    }
    const yes = await confirmDialog({
      title: `Play ${date}?`,
      body: `<p>${diffLabel(info.diff)} · unlock it for <b>${DAILY_PAST_COST} coins</b> (you have ${fmtNum(pr.coins)}).</p><p class="hold-note">Once unlocked, retries are free. Past days don't count toward your streak and don't get the daily bonus.</p>`,
      ok: `Unlock for ${DAILY_PAST_COST} coins`,
    });
    if (!yes) return;
    pr.coins -= DAILY_PAST_COST;
    bought[k] = true;
    Save.write();
    Game.open('daily', k);
  });

  /* ---------------- Zen ---------------- */
  renderers.zen = function () {
    const box = $('#zen-choices');
    box.textContent = '';
    const z = Save.data.zen;
    const cube = z.dim === '3d';
    for (const b of $$('#zen-dim button')) { const on = b.dataset.dim === (cube ? '3d' : '2d'); b.classList.toggle('is-on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); }
    $('#zen-dim-note').hidden = !cube;
    const zenCount = (id) => (cube ? (z.boards3d[id] || 0) : (z.boards[id] || 0) - (z.boards3d[id] || 0));
    for (const id of E.DIFFICULTY_ORDER) {
      const d = E.DIFFICULTIES[id];
      const n = SlipCube.CUBE[id] ? SlipCube.CUBE[id].N : 3;
      box.append(h('button', { class: 'zen-choice', type: 'button', role: 'listitem', 'data-diff': id, 'aria-label': `Start Zen${cube ? ' 3D' : ''} on ${d.label}. ${zenCount(id)} boards cleared.` },
        h('span', { class: 'diff-chip diff-' + id, text: d.label }),
        h('p', { text: cube ? `Cubes up to ${n}×${n}×${n} and block shapes of a similar size.` : d.blurb }),
        h('span', { class: 'zen-count' }, h('strong', { text: fmtNum(zenCount(id)) }), h('span', { text: 'cleared' }))));
    }
    const act = Save.data.active;
    const cont = $('#zen-continue');
    if (act && act.mode === 'zen' && !act.done) {
      cont.hidden = false;
      $('#zen-continue-title').textContent = `${isCubeKey(act.key) ? '3D · ' : ''}${diffLabel(act.diff)} · ${act.total ? act.total - act.removed.length + ' arrows left' : 'in progress'}`;
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
  $('#zen-dim').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-dim]');
    if (!b) return;
    Sound.play('tap');
    Save.data.zen.dim = b.dataset.dim;
    Save.soon();
    renderers.zen();
  });
  const zenPrefix = (cube) => (cube ? '3d.' : '');
  function startZen(diff) {
    Save.data.zen.session = { diff, count: 0 };
    Game.open('zen', zenPrefix(Save.data.zen.dim === '3d') + newZenSeed(), diff, { fresh: true });
  }
  function nextZen() {
    const diff = (Game.session && Game.session.diff) || Save.data.zen.session.diff || 'easy';
    const cube = Game.session ? isCubeKey(Game.session.key) : Save.data.zen.dim === '3d';
    Game.open('zen', zenPrefix(cube) + newZenSeed(), diff, { fresh: true });
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
    // Each section folds open/closed from its title; which ones are closed is remembered.
    const closed = Save.data.statsCollapsed || (Save.data.statsCollapsed = {});
    const section = (title, ...kids) => {
      const isClosed = !!closed[title];
      const content = h('div', { class: 'stats-body', hidden: isClosed }, ...kids);
      const btn = h('button', { class: 'stats-toggle', type: 'button', 'aria-expanded': isClosed ? 'false' : 'true' },
        h('span', { class: 'stats-title', text: title }), h('span', { class: 'stats-line', 'aria-hidden': 'true' }),
        h('span', { class: 'stats-chev', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>' }));
      const sec = h('section', { class: 'stats-section' + (isClosed ? ' is-collapsed' : '') }, h('h3', null, btn), content);
      btn.addEventListener('click', () => {
        const nowClosed = !sec.classList.contains('is-collapsed');
        sec.classList.toggle('is-collapsed', nowClosed);
        content.hidden = nowClosed;
        btn.setAttribute('aria-expanded', nowClosed ? 'false' : 'true');
        if (nowClosed) closed[title] = true; else delete closed[title];
        Save.soon();
      });
      return sec;
    };
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
        row('Campaign stars', `★ ${campaignStars()} / ${E.CAMPAIGN_LENGTH * 3}`),
        row('3D bonus levels completed', `${bonusDone()} / ${SlipCube.BONUS_COUNT}`),
        row('Pictures found', `${picDone()} / ${PIC.PICTURES.length}`))));

    body.append(section('Daily', h('div', { class: 'stat-rows' },
      row('Daily puzzles attempted', fmtNum(tot.attempted)),
      row('Daily puzzles completed', fmtNum(tot.completed)),
      row('Current streak', `${sk.current} day${sk.current === 1 ? '' : 's'}`),
      row('Longest streak', `${sk.longest} day${sk.longest === 1 ? '' : 's'}`),
      row('Perfect daily clears', fmtNum(tot.perfect)))));

    // 3D clears are counted on their own; 2D is the total minus the 3D share.
    const b3 = (d) => (z.boards3d && z.boards3d[d]) || 0;
    const b2 = (d) => Math.max(0, (z.boards[d] || 0) - b3(d));
    const zt2 = E.DIFFICULTY_ORDER.reduce((a, d) => a + b2(d), 0);
    const zt3 = E.DIFFICULTY_ORDER.reduce((a, d) => a + b3(d), 0);
    body.append(section('Zen 2D Boards', h('div', { class: 'stat-rows' },
      row('2D boards completed', fmtNum(zt2)),
      ...E.DIFFICULTY_ORDER.map((d) => row(`${diffLabel(d)} boards`, fmtNum(b2(d)))),
      row('2D perfect clears', fmtNum(Math.max(0, z.perfect - (z.perfect3d || 0)))),
      row('Longest Zen session', `${z.longestSession || 0} board${z.longestSession === 1 ? '' : 's'}`),
      row('2D arrows escaped', fmtNum(Math.max(0, z.arrows - (z.arrows3d || 0)))))));
    body.append(section('Zen 3D Shapes', h('div', { class: 'stat-rows' },
      row('3D shapes completed', fmtNum(zt3)),
      ...E.DIFFICULTY_ORDER.map((d) => row(`${diffLabel(d)} shapes`, fmtNum(b3(d)))),
      row('3D perfect clears', fmtNum(z.perfect3d || 0)),
      row('3D arrows escaped', fmtNum(z.arrows3d || 0)))));

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
    $('#set-thick').value = THICKNESS[st.thickness] ? st.thickness : 'normal';
    $('#set-outline').value = ['auto', 'on', 'off'].includes(st.outline) ? st.outline : 'auto';
    $('#set-cvd').checked = !!st.colorblind;
    renderThickPreview();
    $('#set-contrast').checked = !!st.highContrast;
    $('#set-preview').checked = !!st.preview;
    $('#set-auto').checked = !!st.autoRelease;
    $('#set-dev').checked = !!st.dev;
    $('#set-dev-row').hidden = !st.dev && versionTaps < 5;
  };
  $('#set-sound').addEventListener('change', (e) => { Save.data.settings.sound = e.target.checked; Save.soon(); if (e.target.checked) Sound.play('hint'); });
  $('#set-motion').addEventListener('change', (e) => { Save.data.settings.motion = e.target.value; applySettings(); Save.soon(); });
  $('#set-speed').addEventListener('change', (e) => { Save.data.settings.speed = e.target.value; Save.soon(); });
  function renderThickPreview() {
    const box = $('#thick-preview');
    box.textContent = '';
    box.append(previewBoard(5, 3, PREVIEW_ARROWS()));
  }
  $('#set-cvd').addEventListener('change', (e) => {
    Save.data.settings.colorblind = e.target.checked;
    renderThickPreview();
    Save.soon();
  });
  $('#set-outline').addEventListener('change', (e) => {
    Save.data.settings.outline = e.target.value;
    renderThickPreview();
    Save.soon();
  });
  $('#set-thick').addEventListener('change', (e) => {
    Save.data.settings.thickness = e.target.value;
    applySettings();
    renderThickPreview();
    Save.soon();
  });
  $('#set-contrast').addEventListener('change', (e) => { Save.data.settings.highContrast = e.target.checked; applySettings(); Save.soon(); });
  $('#set-preview').addEventListener('change', (e) => { Save.data.settings.preview = e.target.checked; Save.soon(); });
  $('#set-auto').addEventListener('change', (e) => { setAutoRelease(e.target.checked); });
  $('#set-dev').addEventListener('change', (e) => { Save.data.settings.dev = e.target.checked; applySettings(); Save.soon(); });
  $('#version-tap').addEventListener('click', () => {
    versionTaps++;
    if (versionTaps === 5) { $('#set-dev-row').hidden = false; toast('Developer tools unlocked'); }
  });
  $('#reset-open').addEventListener('click', () => {
    confirmDialog({
      title: 'Reset all progress?',
      body: '<p>This will permanently erase:</p><ul><li>Campaign progress</li><li>Your level, coins and Style shop items</li><li>Statistics</li><li>Daily history and streaks</li><li>Zen records</li><li>Any board in progress</li></ul><p class="hold-note">Press and hold Reset to confirm. Your settings stay as they are.</p>',
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
    $$('.zen-next, .pic-reveal', ov).forEach((n) => n.remove());
    const sheet = $('.complete-sheet', ov);
    sheet.classList.remove('is-failed');
    sheet.classList.toggle('is-perfect', res.perfect);
    let kicker = '';
    if (sess.mode === 'campaign') kicker = `Level ${sess.key} · ${diffLabel(sess.diff)}`;
    else if (sess.mode === 'bonus') kicker = `3D Bonus ${sess.key} · ${diffLabel(sess.diff)}`;
    else if (sess.mode === 'picture') kicker = `Picture ${Number(sess.key) + 1} · ${diffLabel(sess.diff)}`;
    else if (sess.mode === 'daily') kicker = `Daily · ${shortDate(sess.key)}`;
    else if (sess.mode === 'zen') kicker = `Zen${isCubeKey(sess.key) ? ' 3D' : ''} · ${diffLabel(sess.diff)}`;
    else kicker = 'Sandbox';
    $('#complete-kicker').textContent = kicker;
    $('#complete-title').textContent = res.perfect ? 'Perfect' : 'Cleared';
    if (sess.mode === 'picture') {
      // The reveal: the picture's outline and its name.
      const k = Number(sess.key);
      const rv = h('div', { class: 'pic-reveal' + (res.firstFind ? ' is-new' : ''), html: picSvg(k, 'pic-reveal-art') });
      rv.append(h('p', { class: 'pic-reveal-name', text: `${res.firstFind ? 'You found: ' : ''}${PIC.PICTURES[k].name}!` }));
      $('#complete-title').after(rv);
    }
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
    showReward(res.reward, res.milestones);
    const stats = $('#complete-stats');
    stats.textContent = '';
    [[fmtTime(sess.elapsed), 'time'], [puzzle.arrows.length, 'arrows'], [sess.blocked, 'blocked'], [sess.hints, 'hints']]
      .forEach(([v, k]) => stats.append(h('div', null, h('strong', { text: String(v) }), h('span', { text: k }))));

    const burst = $('.burst', ov);
    burst.textContent = '';
    if (!reducedMotion()) {
      const n = (res.milestones && res.milestones.length) ? 28 : res.perfect ? 20 : 12;
      for (let i = 0; i < n; i++) {
        const c = res.perfect && i % 2 === 0 ? 'var(--gold)' : `var(--a${i % 8})`;
        burst.append(h('i', { style: `--c:${c};--r:${(360 / n) * i}deg;animation-delay:${(i % 3) * 50}ms` }));
      }
    }

    const acts = $('#complete-actions');
    acts.textContent = '';
    const btn = (label, cls, fn) => h('button', { class: cls, type: 'button', onclick: fn, text: label });
    clearTimeout(zenTimer);
    /* Fewer than 3 stars: offer a fresh run of the same board. */
    const canRetry = res.counted && res.stars < MAX_STARS && (sess.mode === 'campaign' || sess.mode === 'bonus' || sess.mode === 'picture' || sess.mode === 'daily');
    if (canRetry) {
      acts.append(btn(`Try again for ${MAX_STARS} stars`, 'ghost-btn retry-btn', () => {
        ov.hidden = true;
        Game.open(sess.mode, sess.key, sess.diff, { fresh: true });
      }));
    }
    if (sess.mode === 'campaign') {
      const L = Number(sess.key);
      const bk = L / SlipCube.BONUS_AFTER;
      if (Number.isInteger(bk) && bk <= SlipCube.BONUS_COUNT && !(Save.data.campaign.bonus[bk] || {}).completed)
        acts.append(btn('Play 3D bonus', 'ghost-btn bonus-btn', () => { ov.hidden = true; Game.open('bonus', bk); }));
      else acts.append(btn('All levels', 'ghost-btn', () => showScreen('campaign')));
      if (L < E.CAMPAIGN_LENGTH) acts.append(btn(`Level ${L + 1} →`, 'primary-btn', () => { ov.hidden = true; Game.open('campaign', L + 1); }));
      else acts.append(btn('Replay level', 'primary-btn', () => { ov.hidden = true; Game.open('campaign', L, null, { fresh: true }); }));
    } else if (sess.mode === 'picture') {
      const next = Number(sess.key) + 1;
      acts.append(btn('Gallery', 'ghost-btn', () => showScreen('pictures')));
      if (next < PIC.PICTURES.length && picUnlocked(next)) acts.append(btn(`Picture ${next + 1} →`, 'primary-btn', () => { ov.hidden = true; Game.open('picture', next); }));
      else acts.append(btn('Gallery', 'primary-btn', () => showScreen('pictures')));
    } else if (sess.mode === 'bonus') {
      // Back to the main path: the level after the one this bonus follows.
      const L = Math.min(E.CAMPAIGN_LENGTH, bonusAfter(Number(sess.key)) + 1);
      acts.append(btn('All levels', 'ghost-btn', () => showScreen('campaign')));
      if (L <= Save.data.campaign.unlocked && bonusAfter(Number(sess.key)) < E.CAMPAIGN_LENGTH) acts.append(btn(`Level ${L} →`, 'primary-btn', () => { ov.hidden = true; Game.open('campaign', L); }));
      else acts.append(btn('Replay bonus', 'primary-btn', () => { ov.hidden = true; Game.open('bonus', sess.key, null, { fresh: true }); }));
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

  const TROPHY_SVG = '<svg class="trophy" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4v3h-4z"/></svg>';
  function showReward(rw, ms) {
    const box = $('#complete-reward');
    box.textContent = '';
    box.hidden = !rw;
    if (!rw) return;
    const msHtml = (ms || []).map((m) => `<div class="milestone">${TROPHY_SVG}<span><small class="ach-kicker">Achievement unlocked</small><strong>${m.name}!</strong><small>${m.desc}</small></span><span class="ms-coins">${COIN_SVG}+${m.coins}</span></div>`).join('');
    const a = rw.after, b = rw.before;
    const from = rw.levelUp ? 0 : pct(b.into, b.need);
    box.innerHTML =
      `<div class="reward-row"><span class="reward-xp">+${fmtNum(rw.xp)} XP</span><span class="coin-pill">${COIN_SVG}<b>+${fmtNum(rw.coins + rw.bonus)}</b></span></div>` +
      `<div class="reward-level"><span class="lvl-badge small"><small>Level</small><b>${a.level}</b></span>` +
      `<span class="xp-bar"><span style="width:${from}%"></span></span><span class="reward-need">${fmtNum(a.into)} / ${fmtNum(a.need)}</span></div>` +
      (rw.levelUp ? `<p class="levelup">Level up! You reached Level ${a.level}. +${fmtNum(rw.bonus)} bonus coins</p>` : '') + msHtml;
    const bar = $('.xp-bar span', box);
    requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = `${pct(a.into, a.need)}%`; }));
  }

  function showFailed(sess, puzzle) {
    $('#complete-reward').hidden = true;
    if (currentScreen !== 'game' || Game.session !== sess) return;
    const ov = $('#complete-overlay');
    $$('.zen-next', ov).forEach((n) => n.remove());
    const sheet = $('.complete-sheet', ov);
    sheet.classList.remove('is-perfect');
    sheet.classList.add('is-failed');
    $('#complete-stars').hidden = true;
    $('.burst', ov).textContent = '';
    $('#complete-kicker').textContent = sess.mode === 'campaign' ? `Level ${sess.key} · ${diffLabel(sess.diff)}` : sess.mode === 'bonus' ? `3D Bonus ${sess.key} · ${diffLabel(sess.diff)}` : `Daily · ${shortDate(sess.key)}`;
    $('#complete-title').textContent = 'Out of hearts';
    $('#complete-note').textContent = 'Three blocked taps ends the run. The board resets when you try again.';
    const stats = $('#complete-stats');
    stats.textContent = '';
    [[fmtTime(sess.elapsed), 'time'], [`${sess.removed.length}/${puzzle.arrows.length}`, 'cleared'], [sess.blocked, 'blocked'], [sess.hints, 'hints']]
      .forEach(([v, k]) => stats.append(h('div', null, h('strong', { text: String(v) }), h('span', { text: k }))));
    const acts = $('#complete-actions');
    acts.textContent = '';
    const btn = (label, cls, fn) => h('button', { class: cls, type: 'button', onclick: fn, text: label });
    acts.append(sess.mode === 'campaign' || sess.mode === 'bonus'
      ? btn('All levels', 'ghost-btn', () => showScreen('campaign'))
      : btn('Home', 'ghost-btn', () => showScreen('home')));
    acts.append(btn('Try again', 'primary-btn', () => { ov.hidden = true; Game.open(sess.mode, sess.key, sess.diff, { fresh: true }); }));
    ov.hidden = false;
    acts.querySelector('.primary-btn').focus();
    Sound.play('fail');
    announce('Out of hearts. Press Try again to restart the board.');
  }

  /* ======================================================================
     QUICK SETTINGS — the gear on the puzzle screen. Changes apply to the
     board straight away; the timer and taps pause while it is open.
     ====================================================================== */
  const Quick = {
    open() {
      const st = Save.data.settings, pr = Save.data.progress;
      $('#q-sound').checked = !!st.sound;
      $('#q-preview').checked = !!st.preview;
      $('#q-auto').checked = !!st.autoRelease;
      $('#q-cvd').checked = !!st.colorblind;
      $('#q-thick').value = THICKNESS[st.thickness] ? st.thickness : 'normal';
      $('#q-outline').value = ['auto', 'on', 'off'].includes(st.outline) ? st.outline : 'auto';
      $('#q-speed').value = ESCAPE_SPEEDS[st.speed] ? st.speed : 'normal';
      for (const [kind, id] of [['arrows', '#q-arrows'], ['board', '#q-board']]) {
        const sel = $(id);
        sel.textContent = '';
        for (const it of STYLE[kind]) if (pr.owned[kind].includes(it.id)) sel.append(h('option', { value: it.id, text: it.name }));
        sel.value = pr.equip[kind];
        sel.closest('.setting').hidden = sel.options.length < 2; // nothing to switch between yet
      }
      $('#quick-overlay').hidden = false;
      $('#quick-done').focus();
    },
    close() { $('#quick-overlay').hidden = true; },
    refreshBoard() {
      applySettings();
      if (Game.view && Game.view.svg) applySkin(Game.view.svg);
      if (Game.view && Game.view.refreshColors) Game.view.refreshColors();
      Save.soon();
    },
  };
  $('#game-settings').addEventListener('click', () => { Sound.play('tap'); Quick.open(); });
  $('#quick-done').addEventListener('click', () => Quick.close());
  let settingsFromGame = false;
  $('#quick-all').addEventListener('click', () => { Quick.close(); Save.write(); settingsFromGame = true; showScreen('settings'); });
  $('#quick-overlay').addEventListener('click', (e) => { if (e.target.id === 'quick-overlay') Quick.close(); });
  $('#q-sound').addEventListener('change', (e) => { Save.data.settings.sound = e.target.checked; if (e.target.checked) { Sound.ensure(); Sound.play('hint'); } Save.soon(); });
  $('#q-preview').addEventListener('change', (e) => { Save.data.settings.preview = e.target.checked; Save.soon(); });
  $('#q-auto').addEventListener('change', (e) => { setAutoRelease(e.target.checked); });
  /** Turning auto-release off clears any red waiting arrows on the open board. */
  function setAutoRelease(on) {
    Save.data.settings.autoRelease = on;
    const sess = Game.session;
    if (!on && sess && sess.stuck) {
      for (const id of sess.stuck) if (Game.view) Game.view.setStuck(id, false);
      sess.stuck = [];
    }
    Save.soon();
  }
  $('#q-thick').addEventListener('change', (e) => { Save.data.settings.thickness = e.target.value; Quick.refreshBoard(); });
  $('#q-outline').addEventListener('change', (e) => { Save.data.settings.outline = e.target.value; Quick.refreshBoard(); });
  $('#q-cvd').addEventListener('change', (e) => { Save.data.settings.colorblind = e.target.checked; Quick.refreshBoard(); });
  $('#q-speed').addEventListener('change', (e) => { Save.data.settings.speed = e.target.value; Save.soon(); });
  $('#q-arrows').addEventListener('change', (e) => { Save.data.progress.equip.arrows = e.target.value; Quick.refreshBoard(); });
  $('#q-board').addEventListener('change', (e) => { Save.data.progress.equip.board = e.target.value; Quick.refreshBoard(); });

  /* ======================================================================
     DEBUG / DEVELOPER TOOLS (hidden: Settings → tap the version line
     five times → enable Developer tools; or open with #debug)
     ====================================================================== */
  function debugAction(kind) {
    const out = $('#debug-out');
    const p = Game.puzzle;
    if (kind === 'newseed') {
      const diff = (Game.session && Game.session.diff) || 'medium';
      const cube = !!(p && p.cube); // stay in 3D when you're on a 3D board
      // Remember where the sandbox was started from, so Back returns there.
      if (Game.session && Game.session.mode !== 'debug') Game.debugFrom = Game.session.mode === 'bonus' ? 'campaign' : Game.session.mode;
      Game.open('debug', (cube ? '3d.' : '') + newZenSeed(), diff, { fresh: true });
      $('#debug-panel').hidden = false;
      out.textContent = `Generated a ${cube ? '3D ' : ''}sandbox board. It does not affect stats.`;
      return;
    }
    if (!p || !Game.board) return;
    if (kind === 'validate') {
      const t0 = performance.now();
      const ENG = p.cube ? SlipCube : E;
      const full = ENG.analyze(p);
      const now = ENG.analyze(p, Game.session.removed);
      const replay = ENG.verifySolution(p, p.solution);
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
      // Skip jumps past the practice boards to the "Good to know" tips.
      $('#howto-skip').addEventListener('click', () => {
        const tipsAt = HOWTO_STEPS.findIndex((st) => st.tips);
        if (tipsAt >= 0 && this.step < tipsAt) this.show(tipsAt); else this.finish();
      });
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
      const board = this.board = new E.BoardState(p);
      requestAnimationFrame(() => {
        if (this.board !== board) return;   // moved to another step before this one drew
        this.view.load(p, board);
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
        coin: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/>',
        cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
        path: '<path d="M4 12h8" /><path d="M14 12h2M19 12h1" stroke-dasharray="0" /><path d="M9 8l4 4-4 4" />',
      };
      const tips = [
        ['heart', 'Campaign and Daily give you 3 hearts. Each blocked tap costs one, and losing all 3 restarts the board.'],
        ['hint', 'Stuck? Tap Hint and a safe arrow lights up.'],
        ['path', 'Not sure where an arrow goes? Press and hold it to see its path. Letting go won’t move it.'],
        ['star', 'Earn up to 3 stars: clear the board, clear it without hints, then clear it without a single blocked tap.'],
        ['coin', 'Every clear earns XP and coins. More stars and harder boards earn more. Spend coins on new arrow colors, boards and trails in the Style shop.'],
        ['cube', 'Want a twist? Switch Zen to 3D, or play the 3D bonus levels in Campaign. Drag to spin the shape; arrows bend over its edges and fly off the way they point.'],
        ['pinch', 'On big boards, zoom in and out by pinching with two fingers on a phone or tablet, or with the mouse wheel or trackpad on a computer. Drag to move around.'],
        ['save', 'Your progress lives in this app. Removing the app deletes it, so make a backup in Settings first.'],
      ];
      const ul = $('#howto-tips');
      ul.innerHTML = tips.map(([k, t]) => `<li><svg viewBox="0 0 24 24" class="tip-${k}" aria-hidden="true">${ICONS[k]}</svg><span>${t}${k === 'save' ? '<button type="button" class="tip-link" id="howto-backup">Back up now →</button>' : ''}</span></li>`).join('');
      $('#howto-backup').addEventListener('click', () => {
        this.finish(false);
        showScreen('settings');
        requestAnimationFrame(() => $('#backup-block').scrollIntoView({ block: 'start' }));
      });
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
      if (!m) throw new Error('That doesn’t look like an Arrow Escape backup code. Make sure you copied all of it.');
      let bytes = this.fromB64(m[2]);
      if (m[1] === '1') {
        if (!window.DecompressionStream) throw new Error('This browser is too old to read this backup. Try updating it.');
        bytes = await this.pipe(bytes, new DecompressionStream('gzip'));
      }
      const obj = JSON.parse(new TextDecoder().decode(bytes));
      if (!obj || obj.app !== 'slipstream' || !obj.data || !obj.data.campaign || !obj.data.stats) throw new Error('This backup is damaged or from a different app.');
      return obj;
    },
    fileName() { return `arrow-escape-backup-${dateKey()}.txt`; },
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
        await navigator.share({ files: [file], title: 'Arrow Escape backup' });
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
    migrateProgress();
    checkMilestones();
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
     Every arrow gets a random color, length and shape: straight, or
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
  $$('[data-back]').forEach((b) => b.addEventListener('click', () => {
    Sound.play('tap');
    // Settings opened from a puzzle's gear: go back to that puzzle.
    const a = Save.data.active;
    if (currentScreen === 'settings' && settingsFromGame && a && !a.done) { settingsFromGame = false; Game.open(a.mode, a.key, a.diff); return; }
    settingsFromGame = false;
    showScreen('home');
  }));
  $('#gift-ok').addEventListener('click', closeDailyGift);
  $('#gift-overlay').addEventListener('click', (e) => { if (e.target.id === 'gift-overlay') closeDailyGift(); });
  // A new day while the app sat open: the gift pops up when you come back to it.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && currentScreen === 'home') showDailyGift(); });
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
    if (!$('#quick-overlay').hidden) { if (e.key === 'Escape') Quick.close(); return; }
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
    if (!$('#complete-overlay').hidden || !$('#confirm-overlay').hidden || !$('#quick-overlay').hidden) return;
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
    const caughtUp = migrateProgress();
    const bootMilestones = checkMilestones();
    if (caughtUp || bootMilestones.length) Save.write();
    if (Save.data.settings.sound) Sound.preload();
    HeroStream.init();
    Game.view = new BoardView($('#board'));
    new Input(Game.view, $('#board'));
    Game.flatView = Game.view;
    Game.cubeView = new CubeView($('#cube'), Game);
    HowTo.init();
    applySettings();
    // A board saved by an older generator can't be rebuilt identically; drop it.
    if (Save.data.active && Save.data.active.gen !== genFor(Save.data.active.key, Save.data.active.mode)) Save.data.active = null;
    const a = Save.data.active;
    const brandNew = !Save.data.seenHowTo && Save.data.stats.played === 0 && !a;
    if (brandNew) showScreen('howto');
    else if (Save.data.route === 'game' && a && !a.done) Game.open(a.mode, a.key, a.diff);
    else showScreen(Save.data.route === 'game' ? 'home' : Save.data.route || 'home');
    if (!Save.ok) setTimeout(() => toast('This browser is blocking storage, so progress will not be saved.'), 600);
    else if (caughtUp) setTimeout(() => toast(`New: levels and coins! You start at Level ${caughtUp.after.level}.`, 5000), 700);
    if (Save.ok && bootMilestones.length) {
      const coins = bootMilestones.reduce((a, m) => a + m.coins, 0);
      setTimeout(() => toast(`🏆 ${bootMilestones.length === 1 ? 'Achievement' : bootMilestones.length + ' achievements'} unlocked: ${bootMilestones.map((m) => m.name).join(', ')} · +${coins} coins`, 6000), caughtUp ? 5900 : 700);
    }
  }
  boot();

  // Exposed for console testing only.
  window.Slipstream = { Game, Save, E, Sound, levelInfo, rewardFor };
})();
