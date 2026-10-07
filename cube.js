/* ==========================================================================
   SLIPSTREAM — 3D cube puzzle engine
   Pure logic, no DOM. Arrows live on the six faces of an N×N×N cube and
   may bend around its edges onto the next face. A released arrow slides
   along its own path and flies straight off the edge of the face its
   head is on, so only arrows in that straight run to the edge can block
   it. Loaded by the browser (window.SlipCube) and by Node for testing.

   Coordinates are "doubled" integers so every cell centre and edge point
   is whole: the cube spans 0..2N on each axis, a cell centre has one
   coordinate on the surface (0 or 2N) and the other two odd.
   ========================================================================== */
(function (global) {
  'use strict';
  const E = global.SlipEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const RNG = E.RNG;

  // Unit directions: +x, -x, +y, -y, +z, -z
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const dirIndex = (v) => DIRS.findIndex((d) => d[0] === v[0] && d[1] === v[1] && d[2] === v[2]);
  const neg = (i) => i ^ 1; // opposite direction

  /* ------------------------------------------------------------------
     Geometry for any block shape
     A shape is a union of boxes on a unit voxel grid. Every exposed voxel
     face is one cell. Walking from a cell in a tangent direction:
       • flat ground ahead       → the next cell on the same plane
       • the ground drops away   → wrap over the outside corner (convex)
       • a wall rises ahead      → bend up the wall (concave)
     A released arrow leaves in a straight line: it passes over coplanar
     cells (those are in its way), can cross gaps, and must never point
     into a wall (the generator never builds that).
     ------------------------------------------------------------------ */
  const geoCache = new Map();
  const boxesKey = (boxes) => boxes.map((b) => b.join(',')).join(';');
  function geometryFor(boxes) {
    const key = boxesKey(boxes);
    if (geoCache.has(key)) return geoCache.get(key);
    let X = 0, Y = 0, Z = 0;
    for (const b of boxes) { X = Math.max(X, b[3]); Y = Math.max(Y, b[4]); Z = Math.max(Z, b[5]); }
    const vox = new Uint8Array(X * Y * Z);
    for (const b of boxes) for (let x = b[0]; x < b[3]; x++) for (let y = b[1]; y < b[4]; y++) for (let z = b[2]; z < b[5]; z++) vox[(x * Y + y) * Z + z] = 1;
    const solid = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < X && y < Y && z < Z && vox[(x * Y + y) * Z + z] === 1;
    const cells = [], byKey = new Map();
    const ck = (x, y, z, d) => ((x * Y + y) * Z + z) * 6 + d;
    for (let x = 0; x < X; x++) for (let y = 0; y < Y; y++) for (let z = 0; z < Z; z++) {
      if (!solid(x, y, z)) continue;
      for (let d = 0; d < 6; d++) {
        const D = DIRS[d];
        if (solid(x + D[0], y + D[1], z + D[2])) continue;
        const cell = { id: cells.length, v: [x, y, z], n: d, f: d, c: [2 * x + 1 + D[0], 2 * y + 1 + D[1], 2 * z + 1 + D[2]] };
        byKey.set(ck(x, y, z, d), cell.id);
        cells.push(cell);
      }
    }
    const cellAt = (x, y, z, d) => { const id = byKey.get(ck(x, y, z, d)); return id == null ? -1 : id; };
    const tanCache = [[2, 3, 4, 5], [2, 3, 4, 5], [0, 1, 4, 5], [0, 1, 4, 5], [0, 1, 2, 3], [0, 1, 2, 3]];
    const tangents = (id) => tanCache[cells[id].n];
    const stepCache = new Int32Array(cells.length * 6 * 2).fill(-2);
    /** One step along the surface. Returns [cellId, newDir]. */
    function step(id, d) {
      const k = (id * 6 + d) * 2;
      if (stepCache[k] !== -2) return [stepCache[k], stepCache[k + 1]];
      const cell = cells[id], [x, y, z] = cell.v, D = DIRS[d], N = DIRS[cell.n];
      const w = [x + D[0], y + D[1], z + D[2]];
      let out;
      if (!solid(w[0], w[1], w[2])) out = [cellAt(x, y, z, d), neg(cell.n)];                        // over the outside corner
      else if (!solid(w[0] + N[0], w[1] + N[1], w[2] + N[2])) out = [cellAt(w[0], w[1], w[2], cell.n), d]; // flat
      else out = [cellAt(w[0] + N[0], w[1] + N[1], w[2] + N[2], neg(d)), cell.n];                          // up the wall
      if (out[0] < 0) out = [-1, -1];
      stepCache[k] = out[0]; stepCache[k + 1] = out[1];
      return out;
    }
    const span = Math.max(X, Y, Z) + 2;
    /** Straight exit run: cells passed over (with distance), or null if it hits a wall. */
    function exitRun(id, d) {
      const cell = cells[id], [x, y, z] = cell.v, D = DIRS[d], N = DIRS[cell.n];
      const out = [], dist = [];
      let last = 0;
      for (let k = 1; k <= span; k++) {
        const a = [x + D[0] * k, y + D[1] * k, z + D[2] * k];
        if (solid(a[0] + N[0], a[1] + N[1], a[2] + N[2])) return null; // wall
        if (solid(a[0], a[1], a[2])) { out.push(cellAt(a[0], a[1], a[2], cell.n)); dist.push(k); last = k; }
      }
      return { cells: out, dist, edge: last + 0.5 };
    }
    const corridor = (id, d) => { const r = exitRun(id, d); return r ? r.cells : null; };
    // Each cell's four sides: is the surface folding there (an edge of a block)?
    const folds = cells.map((cell) => tanCache[cell.n].map((t) => { const [nid] = step(cell.id, t); return nid < 0 || cells[nid].n !== cell.n; }));
    const g = { boxes, X, Y, Z, cells, step, corridor, exitRun, tangents, solid, folds, DIRS, N: Math.max(X, Y, Z) };
    geoCache.set(key, g);
    return g;
  }
  const geometry = (N) => geometryFor([[0, 0, 0, N, N, N]]);
  const geometryOf = (p) => geometryFor(p.boxes || [[0, 0, 0, p.N, p.N, p.N]]);

  /* ------------------------------------------------------------------
     Random block shapes: a base box plus a few boxes stuck onto it.
     Rejects shapes with blocks touching only along an edge (the surface
     would pinch there) and keeps the surface size in the target range.
     ------------------------------------------------------------------ */
  function manifold(g) {
    const { X, Y, Z, solid } = g;
    const pairs = [[0, 2], [0, 4], [2, 4]];
    for (let x = -1; x <= X; x++) for (let y = -1; y <= Y; y++) for (let z = -1; z <= Z; z++) {
      if (!solid(x, y, z)) continue;
      for (const [a, b] of pairs) for (const sa of [0, 1]) for (const sb of [0, 1]) {
        const A = DIRS[a + sa], B = DIRS[b + sb];
        const diag = solid(x + A[0] + B[0], y + A[1] + B[1], z + A[2] + B[2]);
        if (diag && !solid(x + A[0], y + A[1], z + A[2]) && !solid(x + B[0], y + B[1], z + B[2])) return false;
      }
    }
    return true;
  }
  function randomShape(rng, S) {
    for (let tries = 0; tries < 400; tries++) {
      const dim = () => rng.int(S.dim[0], S.dim[1]);
      const boxes = [[0, 0, 0, dim(), dim(), dim()]];
      if (rng.chance(0.35)) boxes[0][4] = Math.min(S.dim[1] + 3, boxes[0][4] + rng.int(1, 3)); // sometimes a tower
      const extra = rng.int(S.boxes[0], S.boxes[1]);
      for (let e = 0; e < extra; e++) {
        const host = rng.pick(boxes);
        const axis = rng.int(0, 2), side = rng.chance(0.5) ? 1 : -1;
        const size = [dim(), dim(), dim()];
        if (rng.chance(0.3)) size[axis] = Math.max(2, Math.round(size[axis] * 0.6)); // a thinner slab now and then
        const nb = [0, 0, 0, 0, 0, 0];
        for (let k = 0; k < 3; k++) {
          if (k === axis) {
            if (side > 0) { nb[k] = host[k + 3]; nb[k + 3] = host[k + 3] + size[k]; }
            else { nb[k + 3] = host[k]; nb[k] = host[k] - size[k]; }
          } else {
            // overlap the host by at least 2 cells across the touching face
            const lo = host[k] - size[k] + 2, hi = host[k + 3] - 2;
            const at = lo > hi ? host[k] : rng.int(lo, hi);
            nb[k] = at; nb[k + 3] = at + size[k];
          }
        }
        boxes.push(nb);
      }
      // move to positive coordinates
      const m = [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b[k])));
      const norm = boxes.map((b) => [b[0] - m[0], b[1] - m[1], b[2] - m[2], b[3] - m[0], b[4] - m[1], b[5] - m[2]]);
      const ext = [0, 1, 2].map((k) => Math.max(...norm.map((b) => b[k + 3])));
      if (Math.max(...ext) > S.maxExt) continue;
      const g = geometryFor(norm);
      if (g.cells.length < S.cells[0] || g.cells.length > S.cells[1]) { geoCache.delete(boxesKey(norm)); continue; }
      if (!manifold(g)) { geoCache.delete(boxesKey(norm)); continue; }
      return norm;
    }
    return null;
  }

  /* ------------------------------------------------------------------
     Difficulty table for cube boards
     ------------------------------------------------------------------ */
  // N = size of the plain cube. shape: surface-size range for block shapes,
  // box size range, how many extra boxes, largest extent; plain = chance of a plain cube.
  const CUBE = {
    easy:       { N: 3, len: [2, 4], turn: 0.35, minDepth: 3, cand: 4, plain: 0.35, shape: { cells: [50, 96], dim: [2, 3], boxes: [1, 2], maxExt: 7 } },
    medium:     { N: 4, len: [2, 6], turn: 0.4, minDepth: 5, cand: 6, plain: 0.3, shape: { cells: [90, 160], dim: [2, 4], boxes: [1, 3], maxExt: 9 } },
    hard:       { N: 5, len: [3, 8], turn: 0.45, minDepth: 7, cand: 8, plain: 0.25, shape: { cells: [150, 230], dim: [3, 4], boxes: [2, 3], maxExt: 10 } },
    expert:     { N: 6, len: [3, 7], turn: 0.45, minDepth: 9, cand: 8, plain: 0.25, shape: { cells: [230, 320], dim: [3, 5], boxes: [2, 4], maxExt: 12 } },
    nightmare:  { N: 7, len: [3, 8], turn: 0.5, minDepth: 10, cand: 8, plain: 0.25, shape: { cells: [310, 410], dim: [3, 5], boxes: [2, 4], maxExt: 13 } },
    insane:     { N: 8, len: [3, 9], turn: 0.5, minDepth: 11, cand: 6, plain: 0.25, shape: { cells: [390, 500], dim: [4, 6], boxes: [2, 4], maxExt: 14 } },
    impossible: { N: 9, len: [3, 10], turn: 0.5, minDepth: 12, cand: 6, plain: 0.25, shape: { cells: [470, 600], dim: [4, 6], boxes: [3, 5], maxExt: 15 } },
    inconceivable: { N: 10, len: [3, 8], turn: 0.5, minDepth: 13, cand: 6, plain: 0.25, shape: { cells: [580, 720], dim: [4, 7], boxes: [3, 5], maxExt: 16 } },
  };

  /* ------------------------------------------------------------------
     Live board: same API as the flat engine's BoardState
     ------------------------------------------------------------------ */
  class CubeBoardState {
    constructor(puzzle, removed) {
      this.p = puzzle;
      this.g = geometryOf(puzzle);
      this.occ = new Int16Array(this.g.cells.length).fill(-1);
      this.alive = new Set();
      const runs = puzzle.arrows.map((a) => this.g.exitRun(a.cells[a.cells.length - 1], a.dir) || { cells: [], dist: [] });
      this.corr = runs.map((r) => r.cells);
      this.dist = runs.map((r) => r.dist);
      for (const a of puzzle.arrows) {
        this.alive.add(a.id);
        for (const c of a.cells) this.occ[c] = a.id;
      }
      if (removed) for (const id of removed) this.remove(id);
    }
    get count() { return this.alive.size; }
    corridorOf(id) { return this.corr[id]; }
    firstBlocker(id) {
      const cells = this.corr[id];
      for (let i = 0; i < cells.length; i++) {
        const o = this.occ[cells[i]];
        if (o !== -1 && o !== id) return { id: o, cell: cells[i], steps: this.dist[id][i] };
      }
      return null;
    }
    isFree(id) { return this.alive.has(id) && !this.firstBlocker(id); }
    remove(id) {
      if (!this.alive.has(id)) return false;
      this.alive.delete(id);
      for (const c of this.p.arrows[id].cells) this.occ[c] = -1;
      return true;
    }
    freeArrows() {
      const out = [];
      for (const id of this.alive) if (!this.firstBlocker(id)) out.push(id);
      return out;
    }
    hint() {
      for (const id of this.p.solution) {
        if (this.alive.has(id)) {
          if (!this.firstBlocker(id)) return id;
          break;
        }
      }
      const free = this.freeArrows();
      return free.length ? free[0] : null;
    }
  }

  /** Exact solvability check (removing an arrow never blocks another). */
  function analyze(puzzle, removed) {
    const b = new CubeBoardState(puzzle, removed);
    let depth = 0, initialFree = -1;
    const order = [];
    while (b.count > 0) {
      const free = b.freeArrows();
      if (initialFree < 0) initialFree = free.length;
      if (!free.length) return { solvable: false, depth, initialFree, remaining: b.count, order };
      for (const id of free) { b.remove(id); order.push(id); }
      depth++;
    }
    return { solvable: true, depth, initialFree: Math.max(0, initialFree), remaining: 0, order };
  }
  function verifySolution(puzzle, order) {
    const b = new CubeBoardState(puzzle);
    for (const id of order) {
      if (!b.alive.has(id) || b.firstBlocker(id)) return false;
      b.remove(id);
    }
    return b.count === 0;
  }

  /* ------------------------------------------------------------------
     Generator
     Every arrow gets a real-valued rank; the board is solved by removing
     arrows from highest rank to lowest. The one rule that keeps that order
     valid: if arrow Y sits in arrow X's exit run, rank(Y) > rank(X).
     A new arrow (or a cell added to an arrow) is accepted only if some
     rank satisfies that rule, so every board is solvable by construction
     — and the exact validator double-checks it anyway.
     ------------------------------------------------------------------ */
  function build(g, P, rng) {
    const n = g.cells.length;
    let occ = new Int32Array(n).fill(-1);
    let inCorr = Array.from({ length: n }, () => []); // arrows whose exit run covers this cell
    let arrows = []; // { cells, dir, rank, corr, dead }
    const snapshot = () => ({ occ: occ.slice(), inCorr: inCorr.map((a) => a.slice()), arrows: arrows.map((a) => Object.assign({}, a, { cells: a.cells.slice(), corr: a.corr.slice() })) });
    const restore = (st) => { occ = st.occ; inCorr = st.inCorr; arrows = st.arrows; };
    const kill = (id) => {
      const A = arrows[id];
      for (const c of A.cells) occ[c] = -1;
      for (const c of A.corr) inCorr[c] = inCorr[c].filter((x) => x !== id);
      A.dead = true; A.cells = []; A.corr = [];
    };

    const rankBounds = (cells, corr) => {
      let lo = -Infinity, hi = Infinity;
      for (const c of cells) for (const x of inCorr[c]) if (arrows[x].rank > lo) lo = arrows[x].rank;
      for (const c of corr) if (occ[c] !== -1 && arrows[occ[c]].rank < hi) hi = arrows[occ[c]].rank;
      return [lo, hi];
    };
    const pickRank = (lo, hi) => {
      if (lo === -Infinity && hi === Infinity) return rng.range(-1, 1);
      if (lo === -Infinity) return hi - 1 - rng.float();
      if (hi === Infinity) return lo + 1 + rng.float();
      return lo + (hi - lo) * (0.3 + 0.4 * rng.float());
    };
    const place = (cells, dir, rank, corr) => {
      const id = arrows.length;
      arrows.push({ cells, dir, rank, corr });
      for (const c of cells) occ[c] = id;
      for (const c of corr) inCorr[c].push(id);
      return id;
    };

    /** Random walk through empty cells, turning now and then, crossing edges freely. */
    const walk = (start, len) => {
      let d = rng.pick(g.tangents(start));
      const cells = [start], seen = new Set(cells);
      let cur = start;
      while (cells.length < len) {
        const opts = [];
        if (!rng.chance(P.turn)) opts.push(d);
        for (const t of rng.shuffle(g.tangents(cur).slice())) if (t !== d && t !== neg(d)) opts.push(t);
        if (!opts.includes(d)) opts.push(d);
        let moved = false;
        for (const t of opts) {
          const [nid, nd] = g.step(cur, t);
          if (nid < 0 || occ[nid] !== -1 || seen.has(nid)) continue;
          cells.push(nid); seen.add(nid); cur = nid; d = nd; moved = true;
          break;
        }
        if (!moved) break;
      }
      return { cells, dir: d };
    };

    const tryCandidate = (start, len) => {
      const { cells, dir } = walk(start, len);
      if (cells.length < 2) return null;
      const head = cells[cells.length - 1];
      const corr = g.corridor(head, dir);
      if (!corr || corr.some((c) => cells.includes(c))) return null;
      const [lo, hi] = rankBounds(cells, corr);
      if (!(lo < hi)) return null;
      // Prefer arrows that create dependencies (sit in exit runs, or have arrows in theirs).
      let score = 0;
      for (const c of cells) score += inCorr[c].length ? 1 : 0;
      for (const c of corr) if (occ[c] !== -1) score += 1;
      score += cells.length * 0.3 + rng.float() * 0.5;
      return { cells, dir, corr, lo, hi, score };
    };

    // Phase 1: grow the board with winding arrows. Starts favour tight spots
    // (cells with few empty neighbours) so fewer lonely cells get left behind.
    const emptyNeighbours = (c) => {
      let k = 0;
      for (const t of g.tangents(c)) { const [nid] = g.step(c, t); if (nid >= 0 && occ[nid] === -1) k++; }
      return k;
    };
    let fails = 0;
    while (fails < 60) {
      const empty = [];
      for (let i = 0; i < n; i++) if (occ[i] === -1) empty.push(i);
      if (!empty.length) break;
      let tight = empty;
      if (rng.chance(0.7)) {
        let m = 5;
        for (const c of empty) m = Math.min(m, emptyNeighbours(c));
        tight = empty.filter((c) => emptyNeighbours(c) <= Math.max(1, m));
      }
      let best = null;
      for (let k = 0; k < P.cand; k++) {
        const c = tryCandidate(rng.pick(tight), rng.int(P.len[0], P.len[1]));
        if (c && (!best || c.score > best.score)) best = c;
      }
      if (!best) { fails++; continue; }
      fails = 0;
      place(best.cells, best.dir, pickRank(best.lo, best.hi), best.corr);
    }

    // Phase 2: fill every leftover cell (new short arrows, or grow a neighbour).
    const growTail = (gc) => {
      for (const t of rng.shuffle(g.tangents(gc).slice())) {
        const [nid] = g.step(gc, t);
        if (nid < 0 || occ[nid] === -1) continue;
        const A = arrows[occ[nid]];
        if (A.cells[0] !== nid || A.corr.includes(gc)) continue;
        // The new tail cell must not need to leave before an arrow whose run it sits in.
        if (inCorr[gc].some((x) => arrows[x].rank >= A.rank)) continue;
        // The cell before the old tail must step into it: that is guaranteed by adjacency.
        A.cells.unshift(gc); occ[gc] = occ[nid];
        return true;
      }
      return false;
    };
    const growHead = (gc) => {
      for (let id = 0; id < arrows.length; id++) {
        const A = arrows[id];
        if (A.dead || A.corr[0] !== gc) continue;
        const [sn, sd] = g.step(A.cells[A.cells.length - 1], A.dir);
        if (sn !== gc || sd !== A.dir) continue; // only straight onto the next flat cell
        if (inCorr[gc].some((x) => x !== id && arrows[x].rank >= A.rank)) continue;
        // Head moves forward one cell; its exit run shrinks by that cell.
        A.cells.push(gc); occ[gc] = id;
        inCorr[gc] = inCorr[gc].filter((x) => x !== id);
        A.corr = A.corr.slice(1);
        return true;
      }
      return false;
    };
    const newPair = (gc) => {
      for (const t of rng.shuffle(g.tangents(gc).slice())) {
        const [nid, nd] = g.step(gc, t);
        if (nid < 0 || occ[nid] !== -1) continue;
        for (const [cells, dir] of [[[gc, nid], nd], [[nid, gc], neg(t)]]) {
          // For the reversed pair the head is gc; its direction is the step from nid back to gc.
          let d = dir;
          if (cells[1] === gc) { const back = g.tangents(nid).find((tt) => g.step(nid, tt)[0] === gc); if (back == null) continue; d = g.step(nid, back)[1]; }
          const corr = g.corridor(cells[1], d);
          if (!corr || corr.some((c) => cells.includes(c))) continue;
          const [lo, hi] = rankBounds(cells, corr);
          if (!(lo < hi)) continue;
          place(cells, d, pickRank(lo, hi), corr);
          return true;
        }
      }
      return false;
    };
    /** Borrow the tail cell of a neighbouring arrow (3+ cells) and pair it with the gap. */
    const steal = (gc) => {
      for (const t of rng.shuffle(g.tangents(gc).slice())) {
        const [nid] = g.step(gc, t);
        if (nid < 0 || occ[nid] === -1) continue;
        const aid = occ[nid], A = arrows[aid];
        if (A.cells.length < 3 || A.cells[0] !== nid) continue;
        A.cells.shift(); occ[nid] = -1;
        if (newPair(gc)) return true;
        A.cells.unshift(nid); occ[nid] = aid; // undo
      }
      return false;
    };
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < n; i++) {
        if (occ[i] !== -1) continue;
        if (newPair(i) || growTail(i) || growHead(i) || steal(i)) changed = true;
      }
    }
    const fillPass = () => {
      let ch = true;
      while (ch) {
        ch = false;
        for (let i = 0; i < n; i++) {
          if (occ[i] !== -1) continue;
          if (newPair(i) || growTail(i) || growHead(i) || steal(i)) ch = true;
        }
      }
    };
    const gaps = () => { const out = []; for (let i = 0; i < n; i++) if (occ[i] === -1) out.push(i); return out; };

    // Phase 3: rip up and redo. Remove an arrow next to a stuck cell, refill
    // the freed area with fresh arrows, and keep it only if no gap remains there.
    const near = (c) => {
      const ids = new Set();
      for (const t of g.tangents(c)) {
        const [a] = g.step(c, t);
        if (a < 0) continue;
        if (occ[a] !== -1) ids.add(occ[a]);
        for (const t2 of g.tangents(a)) { const [b] = g.step(a, t2); if (b >= 0 && occ[b] !== -1) ids.add(occ[b]); }
      }
      return [...ids];
    };
    for (let round = 0; round < 6 && gaps().length; round++) {
      for (const gc of gaps()) {
        if (occ[gc] !== -1) continue;
        for (let tries = 0; tries < 24 && occ[gc] === -1; tries++) {
          const st = snapshot();
          const victims = rng.shuffle(near(gc)).slice(0, rng.int(1, 2));
          const region = new Set([gc]);
          for (const v of victims) { for (const c of arrows[v].cells) region.add(c); kill(v); }
          let ok = true;
          for (let k = 0; k < 40; k++) {
            const left = [...region].filter((c) => occ[c] === -1);
            if (!left.length) break;
            left.sort((a, b) => a - b);
            let best = null;
            for (let j = 0; j < 6; j++) {
              const c = tryCandidate(rng.pick(left), rng.int(2, Math.max(2, Math.min(P.len[1], left.length))));
              if (c && (!best || c.score > best.score)) best = c;
            }
            if (!best) { fillPass(); break; }
            place(best.cells, best.dir, pickRank(best.lo, best.hi), best.corr);
          }
          fillPass();
          if ([...region].some((c) => occ[c] === -1)) ok = false;
          if (!ok) restore(st);
        }
      }
      fillPass();
    }

    const live = arrows.filter((a) => !a.dead);
    return { arrows: live, empty: gaps().length };
  }

  function assignColors(g, arrows, rng, palette) {
    const owner = new Int32Array(g.cells.length).fill(-1);
    arrows.forEach((a, i) => a.cells.forEach((c) => { owner[c] = i; }));
    const nb = arrows.map(() => new Set());
    arrows.forEach((a, i) => {
      for (const c of a.cells) {
        for (const t of g.tangents(c)) {
          const [nid] = g.step(c, t);
          if (nid >= 0 && owner[nid] !== -1 && owner[nid] !== i) nb[i].add(owner[nid]);
        }
      }
    });
    const order = rng.shuffle(arrows.map((_, i) => i));
    for (const i of order) {
      const used = new Set([...nb[i]].map((j) => arrows[j].color).filter((c) => c != null));
      const free = [];
      for (let c = 0; c < palette; c++) if (!used.has(c)) free.push(c);
      arrows[i].color = free.length ? rng.pick(free) : rng.int(0, palette - 1);
    }
  }

  const CUBE_VERSION = 'c3'; // c2: block shapes · c3: more, shorter arrows on Expert and up
  function generateCube({ seed, diff, plain, blocks }) {
    const started = Date.now();
    const P = CUBE[diff] || CUBE.easy;
    const srng = new RNG(seed + '|shape');
    let boxes = null;
    if (!plain && (blocks || !srng.chance(P.plain))) boxes = randomShape(srng, P.shape);
    const isPlain = !boxes;
    if (!boxes) boxes = [[0, 0, 0, P.N, P.N, P.N]];
    const g = geometryFor(boxes);
    let best = null, bestQ = -Infinity, attempts = 0;
    for (let attempt = 0; attempt < 40; attempt++) {
      attempts++;
      const rng = new RNG(seed + '|cube|' + attempt);
      const { arrows, empty } = build(g, P, rng);
      if (empty > 0 || arrows.length < 4) continue;
      const list = arrows.map((a, i) => ({ id: i, cells: a.cells, dir: a.dir, rank: a.rank }));
      const solution = list.slice().sort((a, b) => b.rank - a.rank).map((a) => a.id);
      const puzzle = { N: P.N, boxes, arrows: list, solution };
      const rep = analyze(puzzle);
      if (!rep.solvable || !verifySolution(puzzle, solution)) continue;
      const q = rep.depth * 3 - rep.initialFree + (rep.depth >= P.minDepth ? 1000 : 0);
      if (q > bestQ) { bestQ = q; best = { list, solution, rep, rng }; }
      if (rep.depth >= P.minDepth) break;
    }
    if (!best) throw new Error('Could not build a cube board for seed ' + seed);
    assignColors(g, best.list, new RNG(seed + '|cube-colors'), E.PALETTE_SIZE || 8);
    for (const a of best.list) delete a.rank;
    return {
      cube: true, seed: String(seed), diff, t: 0, N: g.N, boxes, cols: g.X, rows: g.Y, shape: isPlain ? 'cube' : 'blocks',
      arrows: best.list, solution: best.solution,
      meta: { attempts, depth: best.rep.depth, initialFree: best.rep.initialFree, genMs: Date.now() - started, emptyCells: 0 },
    };
  }
  function zenCube(seed, diff) {
    return generateCube({ seed: 'zen3d|' + CUBE_VERSION + '|' + seed, diff });
  }


  /* ------------------------------------------------------------------
     Campaign 3D bonus levels: one after every 10th campaign level.
     They are stored as finished boards (not re-generated), so they stay
     exactly the same for everyone even if the Zen 3D generator changes.
     ------------------------------------------------------------------ */
  const BONUS_AFTER = 10;
  const BONUS = [
    {"d":"easy","b":null,"N":3,"a":"5:1:51.53.32.31|5:6:52.50.49.46|3:5:30.28.47.48|0:0:29.15.13.14|2:4:24.39.38|4:6:22.21.23|5:7:17.19.20.18|0:5:16.10.11.12|5:0:40.45.44|3:3:27.25|2:7:8.0.1.2|3:4:9.26.42.35|2:1:5.3.4.6.7|1:7:34.33.36.37|5:5:43.41","s":"14,11,8,2,9,1,3,0,7,10,4,6,12,5,13","dep":6,"op":4,"nc":54},
    {"d":"easy","b":[[3,0,1,6,2,3],[3,0,3,6,2,5],[0,0,0,3,2,3]],"N":6,"a":"0:1:37.31.30.40|0:0:20.19.18.29|5:7:44.42|2:6:38.39.47|5:5:25.15.7.6|0:4:41.49.51.53|4:1:2.17.16|4:2:54.56|4:7:4.1.0.3|0:4:5.13.11.12|0:0:43.45.59|2:5:84.83.73.74.75|0:1:58.57.72|3:3:60.61|5:3:14.24.36.35|1:7:23.21.33.32.34|4:2:46.48|2:6:67.70.69|1:4:71.81.82|1:5:22.10|0:1:8.9|1:1:85.65.64.52|0:7:55.68|3:5:66.76.77.78|1:1:79.80|4:5:26.28.27|1:5:62.63.50","s":"19,15,26,22,21,20,14,16,13,12,23,24,9,17,3,7,8,11,5,18,1,10,4,0,6,2,25","dep":7,"op":6,"nc":86},
    {"d":"easy","b":[[1,3,2,4,5,4],[2,0,2,5,3,4],[0,3,0,3,5,2]],"N":5,"a":"2:5:16.14.4.3|4:0:5.15.17|5:1:51.45.46.43|2:3:18.40.41.47|0:2:6.9.10.22|5:1:19.27.26|4:7:11.23.25|5:5:24.53.52.49|1:6:42.44.13.2|5:2:54.55.73.72.69|2:3:12.1.0|1:3:48.50.21|0:7:8.7.20|3:3:71.68.70.65|4:2:35.39.38|1:7:88.66.67|3:6:64.85.84.80|1:5:57.30|2:4:59.33.37|3:0:86.62.60|1:7:81.76.74.75.56|5:0:79.77|2:1:82.83.61.63|1:3:78.58|5:1:31.32.29|1:4:87.89|3:7:36.34.28","s":"24,7,9,20,4,12,17,21,1,10,3,0,26,8,5,19,16,2,6,13,23,11,14,18,15,22,25","dep":6,"op":9,"nc":90},
    {"d":"medium","b":null,"N":4,"a":"0:3:43.24.23.22.16.17|4:0:40.56.81.88.86|4:4:59.58.60|4:0:42.44|2:1:66.75|1:3:87.90.92.61.45|3:1:26.28.30.29|3:5:31.47.46.62.63|0:0:27.19.13.5.7.9|0:5:25.18.12.3.4.34|3:6:20.14|0:4:15.21.41.57.85|1:6:50.48.49.54.38|5:1:51.52.53.55.79.78|0:6:39.37.36.8.6.35|2:0:10.0.1.2.11|3:1:83.91.89.82.76|4:7:33.32|5:4:77.69.71.73.72|3:2:84.93.94.95|4:6:64.67|5:7:70.68.65|3:5:80.74","s":"21,18,20,16,22,13,14,8,10,6,11,19,1,5,7,4,2,0,15,12,3,9,17","dep":12,"op":2,"nc":96},
    {"d":"medium","b":[[1,0,0,4,4,3],[0,1,3,4,4,7],[1,0,3,3,2,5],[1,2,1,4,4,5]],"N":7,"a":"5:0:106.74.44.9.7|2:0:87.86.94.107.116|1:3:88.95.108.75.46|0:0:27.26.28|4:6:39.71.63.62.64|4:4:118.117.120.122.124|2:3:8.6.4.1.2.11|0:0:0.10.16.17.57|0:1:18.55.56.80|5:4:19.12.13.5.3|0:5:81.82.58.59.60.84|3:7:83.128.126.125|3:6:20.22.24.25.15|4:0:52.50.51.54|3:7:79.77.78|3:6:53.47.40|3:7:45.38|5:5:14.23.21|0:7:48.41.31.32.65.92|4:5:90.89.96.109.119.121|0:5:29.30|5:2:43.42.37.36.34|4:3:110.97.91.93.66|5:4:35.33|3:1:123.111.98|4:4:67.69.68.70.72.73|4:0:99.101.103|2:2:112.100.102.113.127|2:7:105.104.114.115.76.85|3:3:61.49|3:1:131.130.129","s":"27,25,28,18,11,24,30,10,26,4,22,2,19,5,7,8,9,20,0,6,1,15,14,3,13,21,17,29,12,16,23","dep":7,"op":7,"nc":132},
    {"d":"medium","b":[[0,5,0,3,7,2],[0,1,0,3,5,3],[0,0,3,2,3,5],[3,1,0,5,3,3]],"N":7,"a":"1:0:47.48.46.56.60.61|5:4:21.20.13.11|0:7:32.27.18.9.10|0:0:19.28.33.35.69|5:1:29.66.87.86|0:3:12.55.54.78|2:4:121.108.80.82|2:5:79.107.120.118.117|1:6:106.104.76.52|3:0:119.127.128.129|5:2:113.112.111.85.83|0:4:7.6.16.25.30.31|4:7:123.124.116.115|0:2:26.17.8.53.77|3:1:109.110.105|3:6:126.125.122.114|5:2:2.1.4.50.51.49|5:1:0.3.5.15.14|1:7:81.84.89.67.70.37|2:4:59.65|3:4:64.58|0:0:72.41.42.73|4:1:101.98.100.95.94.96|1:6:88.90.91.93.92.68|3:6:38.43.40.36|0:5:34.39.45.75|2:2:71.97.103|1:3:99.102.74.44|3:7:24.22.23.63.62.57","s":"22,21,18,19,15,11,7,8,24,26,5,12,25,14,23,2,10,13,1,3,27,4,0,17,6,16,20,28,9","dep":9,"op":7,"nc":130},
    {"d":"medium","b":[[0,0,3,2,3,5],[0,1,5,3,4,7],[0,0,0,2,2,3]],"N":7,"a":"0:1:17.15.3.4.1.41|4:3:56.55.57.59.60.76.75|2:0:44.46.6.5.7.19|1:6:82.77.78|3:6:27.65.64|5:0:74.80.81.67|1:5:47.45.43.40.52.54.14|5:6:23.21.20|4:2:42.2.0|3:5:30.68.71.70.85.86|5:7:84.87.89.88|4:2:28.26.29|5:4:66.58.18.16|2:7:10.9.11.22.24.25|3:3:32.37.38.72.73|4:6:8.48.50.49.51.61|3:4:62.63.69.83.79|2:6:33.39|4:7:31.34.36.35|0:7:12.13.53","s":"17,13,16,14,3,18,11,15,0,6,1,19,2,4,12,7,8,5,9,10","dep":8,"op":5,"nc":90},
    {"d":"hard","b":null,"N":5,"a":"0:4:15.22.29.38.36.33.35.59|3:3:34.58.78.98.99.140.139.138|4:7:79.76.74.72.92.118.107.105|3:5:125.94.96.132.131.124|1:4:117.119.120.121.122.123|0:5:5.7.8.6.4.3.14.12.13|0:2:47.48.49.50.51.53.55.75.95|2:3:113.112.110.111.88.89.90.91|0:5:93.73.71.70.69.68.67.87|4:1:21.28.26.19.20.54.52.46.45|1:6:56.27|5:0:63.43.42.31.30|5:3:40.41.62.82.81|2:6:2.1.0|5:6:108.109.106|5:2:114.116.115|1:0:134.135.136.147.148|0:4:137.97.77.84.104.149|5:2:83.103.102.101.100|2:1:130.129.128.127.126.133.141|5:6:142.144.146.145.143|4:2:85.86.66.65|0:6:57.32.44.64|2:4:9.10.11.18.25|5:7:80.60.61.39.37|5:3:16.17.24.23","s":"14,19,17,8,6,22,7,21,23,4,15,2,3,9,1,24,5,12,18,20,0,10,13,11,25,16","dep":10,"op":4,"nc":150},
    {"d":"hard","b":[[1,2,1,4,6,5],[0,0,0,4,2,4],[4,0,2,7,4,6]],"N":7,"a":"4:6:140.138.139.144.165.164|4:7:20.21.59.82.80.81.58.60|2:5:84.85.61.23.6.5|4:0:22.4.1.2.12.10.0.3|0:3:11.14.29.30.26.27.65.90|3:2:97.100.101.98.94.89.88|2:6:13.15.17.18.32|2:2:168.161.159.167.166.172|1:6:71.69.68.95.92.87.86.62|2:7:57.47.41.40.39.45|4:0:46.55.53.51.48.50.49.52|2:0:93.91.83.117.124.128.132|0:1:16.31.38.36.37|2:6:64.67.70.72|5:5:25.28.34.35.33|2:0:24.8.7.9.19|3:6:175.147.153.185.183.174|3:2:131.148.177.178.149.146|4:3:43.42.44|5:2:116.118.120.122.123.143.142|4:4:173.181.179.180.150.151|2:1:141.160.162.163.169|1:7:136.134.133.103.102.109.110.76|2:3:171.170.176|3:5:112.111.113.115.79.73|1:3:182.184.152|3:0:108.107.106|4:0:157.154.156.155.158|0:1:135.137|4:1:114.78.77.54.56|4:5:121.119.125.126|4:3:75.74|3:4:66.63|5:2:99.105.104|1:0:129.96|0:3:130.127.145","s":"29,10,9,22,25,18,6,31,20,15,2,8,7,3,24,11,1,30,0,13,23,16,5,32,21,4,19,17,28,12,26,33,35,27,14,34","dep":10,"op":7,"nc":186},
    {"d":"hard","b":[[0,0,4,4,4,7],[2,4,3,6,6,6],[2,2,0,6,6,4]],"N":7,"a":"5:5:77.67.60.52.54.55.53.51|0:1:50.59.57.47.48.99|4:4:61.68.79.80.78.76.118.119.120|2:6:101.126.124.125.100.49.58.65|3:1:32.12.17.16.23.21.15.13.8|4:5:133.109.104.94.86.87.90.92|5:0:103.102.127.150.149.157.156.154|0:4:43.42.40.26.1.0.2.27.41|0:7:3.10.11.5.7.6.4.28|3:7:122.142.182.181.167|0:1:169.183.143.123.85.84.82.121|4:0:70.83.81.69.35.36.20.18|5:2:29.30.44.46.98.97|1:1:89.96.105.110.111.113.63.39|1:3:91.93|3:0:139.138.136.171.172.137.132|2:6:19.22.37.38.62.71|3:4:135.134.168.166.165.164.158.151|3:3:33.14.9.31.45.95.88|1:3:148.147.144.145.146.155.130|2:7:112.115|1:5:106.107.56.34|5:0:25.24|3:2:114.108|5:2:116.73.72.75.66.64|5:7:152.153.159.131.129.128|1:5:117.74|1:6:174.173.175.176|5:2:178.177.179.180.141.140|1:5:170.160.161|4:2:162.163","s":"26,3,23,19,15,28,1,29,18,10,9,24,20,7,16,0,22,17,2,13,6,4,5,8,25,12,30,27,11,21,14","dep":12,"op":7,"nc":184},
    {"d":"expert","b":[[4,4,2,9,7,6],[0,4,0,4,7,4],[5,0,2,9,4,6],[7,2,6,10,5,9],[7,1,6,10,4,10]],"N":10,"a":"1:3:39.38.37.51.50.48.49.35.18|5:6:36.20.22.24.23.21|1:3:80.81.85.84.83.65|2:4:79.77.78.76.60.61|3:5:52.53.73.72.88.128.129.130.131|5:1:25.15.33.47.45.44|4:7:34.17.16.19.12.3.5|0:4:13.14.7.8.30.29.28.42.58|0:7:43.59.74.116.117.142|1:7:31.9|3:0:125.123.121.115|3:0:93.91.92.90.89|2:3:160.170.176.183.191|3:1:287.286.284.283.280.282.236.229|3:3:245.244.243.234.227.221.211|5:6:285.276.270.271.264.262.260.257|0:3:95.96.133.132.154|4:0:214.215.261.258.259.268.274.273.275|4:4:267.269|0:2:134.98.100.99.107.106.104.110.111|1:1:140.138.105|1:5:200.203.156|3:5:251.253.255.197.198.192.185.184|2:1:135.136.158.159.137.139.141|4:1:94.97|5:0:101.103.102|4:5:109.108.114.113.112.118.119.120|4:0:186.188.189.187.238.239.240.230|1:0:126.86.87.82.64.62.63.46|4:3:143.177.171.161.163|3:4:145.147.153.152.151.150.148.149|4:5:169.167.165.166.168.217.216.263.265|2:2:190.181.182.180.179.173.172.178|4:6:162.164|3:1:127.124.146.144|4:2:69.70.71|2:1:174.175.224.218.266.272|1:6:68.66.67|3:3:231.279.278.277|0:2:196.195.193.194.249|5:4:208.207|4:0:26.1.4.6|0:2:56.54.57.75.122|0:7:2.11.32.27.41.40.55|2:2:0.10|4:6:213.223.222.212.204.206|4:1:155.201.210.209.199.202|3:7:235.228|1:7:205.157|1:4:250.247.248|2:4:219.220.226.233.242|5:6:281.237.246.256.254.252|3:0:241.232.225","s":"39,20,12,50,31,19,26,8,43,29,33,21,7,45,16,25,34,24,30,10,5,46,9,15,23,47,41,6,4,38,13,48,42,0,52,36,17,18,2,40,44,35,1,14,22,27,28,37,3,32,49,11,51","dep":11,"op":11,"nc":288},
    {"d":"nightmare","b":[[4,4,0,7,9,5],[0,1,0,4,6,5],[4,0,1,9,3,5]],"N":9,"a":"3:2:278.277.285.284.291.288.289.266.207.208|1:1:267.264.259.200|2:0:290.283.282.272.274.273.276.275|1:3:205.171.174.125.93.94.72.52.13|5:6:293.295.296.270.269.268|5:3:294.292|1:6:166.114.112.113.165.199.258.260.261.202|1:5:201.167.168.118.116.115.89|2:5:122.85.87.66.46.2.1.4.6.5|4:2:56.54.20.27.26.33.36.28.29.30|5:6:59.35.34.37.60.80.81.82.109.108|5:1:206.172.170.204.203|5:3:53.51.71.70.50.10.8|0:0:169.120.121.119.117.90.91.92.123|3:0:154.157.156.158.160.162.164.198.191.189.187|4:4:192.247.248.193.155.153|2:6:3.14.15.22|4:1:0.12.19.21|4:4:95.129.178.177.176.127.100.99.133.134|5:5:279.280.281.263.262|3:1:43.41.39.61.62.63.64.44.42.31|5:3:40.38|3:2:73.75.77.84.111.138.136.104.102|2:0:128.101.135.184.223.222|3:7:196.197.163.161.159.195.252.254.256.257.245|3:4:83.110.144.151.152.145|3:0:286.287.297.271.265|5:1:185.224.231.238.237.230.229.228|4:1:194.250.249.241.242.243|3:5:96.97.103.76.74|4:7:45.47.67.65.86.88|3:5:173.175.209.210.211.212|4:3:246.239.240.190.188.233.232|4:1:126.124.98.132.130.131.180.179.181.182.183|2:0:217.219.218|3:4:17.24.23.16|3:0:25.32.57.55|0:2:147.146.148.141.107.105.139.140|2:1:11.18|4:7:7.9|4:5:143.142.149.150|4:4:69.68.48.49|2:3:221.220|1:7:137.106.79.78.58|5:4:186.226.225.227.216.213|4:5:215.214|4:7:234.235.236|2:4:244.255|4:3:251.253","s":"39,35,20,9,21,16,8,44,47,17,27,12,41,7,46,36,23,32,6,37,38,33,18,11,48,1,19,31,28,10,26,3,14,24,13,0,34,42,29,43,15,30,22,45,5,2,4,25,40","dep":17,"op":4,"nc":298},
    {"d":"nightmare","b":[[1,0,0,5,8,5],[0,8,3,3,10,6],[5,0,0,9,5,5]],"N":10,"a":"1:4:235.215.216.236.259.258.268.267.256.253.255|1:0:257.254.233.234.214.213.193|2:5:155.129.128.90.88.126.127.133.135|4:6:163.137.99.43.42.35.37.38|0:0:162.160.158.132.94.27.26.93.131|5:1:130.156.197.217.218.219.239.264.262.260|2:7:196.195.154.152.153|5:7:221.241.271.270.269|1:5:243.278.285.284.295.293.291.289.286.288|0:4:25.33.34.96|3:3:175.183.146.108.72.71.74.73.65.58|1:0:14.13.15.7.82.117.115.116.111.79|4:3:194.200.202.204.224.227.226|2:1:159.161|5:4:297.296.294.250.249.248.246|4:1:70.63.64.57.56.49.51.52.59.60.61|4:2:81.6.4.1.0.8.10.9|0:4:50.101.103.105.143.141.168|4:6:287.290.292|0:4:5.3.11.12.85|4:1:277.276.275.282.283|5:6:261.263.238.237|0:0:247.244.280|2:5:265.266.240.242|2:5:139.165.207.206.167.174.181|2:4:220.222|4:6:123.121.118.119.120.84.83|2:3:97.95.29.36|3:6:76.75.66.67.77.78.68.69.62|2:1:89.18.17.16|4:5:44.45.46.47|5:4:106.144.151.150.191.192.190|2:0:98.100.102.104.142.140.166.173.180|5:7:114.112.149.189.188.186|5:2:178.177.176.184.185.182|4:7:169.208.228.229.230.231|2:1:170.171.172.179|5:7:273.272.274.281.279|0:7:122.124.86.87.125|5:3:211.210.209|2:4:20.22.21.31|3:7:28.30.19|4:6:91.92|5:7:39.40.41.48.55.54.53|0:2:32.23.24|0:0:187.148.147.109.107.145|5:5:113.110|0:1:2.80|5:6:232.212.205.203.223.225.245.252.251|0:2:134.136.138.164|2:3:157.198.199.201","s":"34,24,41,30,15,17,43,3,45,33,10,13,29,6,35,31,2,27,12,46,22,1,36,32,14,8,38,47,39,25,23,0,48,19,20,18,37,11,21,5,7,50,49,16,26,4,9,42,44,28,40","dep":13,"op":12,"nc":298},
    {"d":"insane","b":[[0,4,2,4,10,6],[0,10,2,4,12,6],[2,7,6,8,12,11],[0,0,0,4,4,5]],"N":12,"a":"2:4:203.128.127.126.199.196.124.88.1.0.12|4:0:201.200.198.195.197.125.89.95.97.20.19|2:7:2.13|3:2:131.208.215.223.221.222.225.224.216.209|0:4:133.136.100.99.101.30.36.103.106.142|4:6:37.32.23.22.21.14.15|4:0:135.137.139.231.238.237.239.240.233.234|3:4:214.207|5:4:210.211.212.213.220.219|1:5:304.307.285.276.270.269.268.266.267.165.114|2:2:202.204.205.129.93.92.8.6.5|2:0:91.90.4.3|1:2:375.368.358.360.369.376.377.384.385|0:4:104.102.34.40.39.46.47.107.143|3:4:16.7|1:2:18.25.98.134.138.140.141.105.41|2:1:29.31.35.42.44.50|1:3:45.51.52.58.64.65.113.159.147.111|0:1:59.53.109.145.148.254|4:6:43.49.108.110.55.61.67.66.60.62.63|4:4:391.389.390.348.346.387.388.380.373.372|0:3:272.273.172.180.119.80.78.81.82.120|4:0:71.115.166.173.174.186.188.190.176.177|2:6:175.168.161.160.167|0:2:265.271.277.178.194.292|0:5:169.162.153.151.152.256|3:2:112.158.261.260.249.243|1:4:301.299.319.321.323.325.332.331.330.310|5:7:374.367.365.366.355.354.357.356.353|0:7:192.193.191.290.289.288.308.309.329.349.392|3:6:263.262.251.245|2:2:314.294.293.313.315.335.333.334|1:0:303.305.312.311.291|1:0:382.383.393.394.350|5:6:232.230.226.227.218.217|4:5:48.54.56.57|2:2:381.379.386|1:0:328.326.306.287|1:7:228.229.235.236.242.241.247.248|0:4:246.252.253.264.300|0:4:157.164.163.170.171|2:7:250.244.144.146|0:1:318.298.297.317|2:2:347.344.324.327|4:7:27.28.26|2:1:302.322.320.340.342|1:6:395.397.396.351|2:5:11.10.9.17.24.33.38|0:3:96.132|1:1:206.130.94|1:6:280.279.282.181.179.118.79|0:1:83.75.76.70.69.68.74.72.73.116|3:7:85.87.77|0:2:84.121.182|0:2:155.156.154.257|2:0:258.259|3:2:185.184.123.117|3:2:283.275|3:1:278.281.274|5:4:86.122.183.286.284|5:3:189.187|2:7:255.150.149|5:4:361.359|2:3:336.337.338.339.341.371.378.343.345.352|2:0:370.362.363.364|0:6:295.296.316","s":"43,45,31,28,39,18,17,50,35,19,14,21,51,62,47,29,38,63,5,16,27,32,49,59,46,65,24,33,15,10,13,11,44,1,25,42,55,54,6,22,12,3,0,52,36,7,2,9,23,34,20,4,40,56,37,53,64,8,61,30,60,48,26,57,58,41","dep":14,"op":10,"nc":398},
    {"d":"impossible","b":[[7,0,7,12,5,11],[6,3,1,11,7,7],[1,4,4,6,8,9],[0,5,0,6,9,5]],"N":12,"a":"4:5:284.283.276.275.262.264.258.259.265.277.285.287|3:2:278.266.267.309.307.261.260.253|5:4:255.305.304.303.302.336.370.430.427|1:0:162.160.161.207.191.186.152.147.146.148.120|0:0:254.252.251.249.250|0:3:424.423.425.411.410.409.397.398.389.449|3:7:419.421.422.420.418.416.362.360.413.412|2:5:85.86.87.115.143.172.171.182.183.188.202|4:5:415.417|1:5:322.323.317.351.357.403.391.453.463.462.460.401|1:7:402.356.355.321.286|3:4:288.289.279|4:4:414.361.327.293.292.294.295.296|0:1:280.318.352.345.380.379.344.346.347.384|0:3:244.198.196.243.297.298.299.245.237.291|4:6:326.328.329.363.364|2:3:382.381.383.395|1:4:176.185.190.205.206.209.208.210.212.214.216|2:0:239.238.240.241.194|5:1:193.192|1:2:378.392.393|3:1:163.164.165.166.155.156.157.158.159.153|1:6:187.200.201|0:5:195.242|2:4:203.204.189.184.175.174.173|5:3:215.213.211|0:1:330.331.365.366.332.333.367|3:1:40.39.38.41.43.45.57.63.64.58.47|4:0:197.199|5:1:434.432.431.439.440.446.445.444|1:6:433.435.441.375.341.339.373.372.338|2:6:170.228.229.230|1:3:371.337|1:0:447.377.343|0:2:235.281.282.319|4:7:325.359.353|0:3:320.354.400|0:3:31.29.30.78.76.77.105.104.132|5:1:308.316.350.342.376.390|2:4:458.457.459.451.452.461|0:2:22.21.19.20.28.26.27|4:7:32.79.107.106.134.135|1:5:169.226.227.225.223.222.234.168.181.150.122.94|2:0:54.8.7|1:7:149.121|1:2:224.167.139.111.83|5:1:23.16.15.5.3.0|5:3:141.142.114.113|3:2:348.314.313.271.272.273.274.263|1:5:349.315|1:7:369.368.334.335.301.306.257|1:4:140.112.84|5:2:428.437.443.442.436.438.429.426|0:2:247.300|3:5:70.72.71.73.74.102.130.131|1:7:117.116.144.145.151.123.125.97.103.75|4:0:2.13.12.14|0:5:340.374|3:2:36.37|0:1:256.246.248|2:2:18.11.10.9.17|4:6:68.82.81.80.34.33.35.24.25.67|2:3:61.55.56.62.69|5:4:65.59.95.89.88|2:0:48.49|4:3:42.44.46|4:6:96.98.66.60.51.50.1.4.6|2:1:154.126.133|4:0:129.128.127.138.137.136.108.109.110.99.100.101|5:3:91.90.92.93.53.52|2:5:118.119.124|2:3:179.177.178|0:3:311.269.219.217.218.268.310|1:6:394.406.404.405.358.324.290.236.232.231.233.180|0:1:220.221|0:7:270.312|5:0:387.388.386.385.396.408.407|4:5:454.448.450|3:0:399.455.456","s":"55,62,54,61,46,39,52,60,68,67,13,43,77,50,57,36,66,21,69,44,70,56,73,58,59,72,10,20,0,48,35,17,29,3,5,41,78,34,42,6,22,14,76,26,27,7,1,19,9,15,12,8,2,37,31,49,18,25,71,24,51,4,33,45,53,11,23,28,16,40,75,32,47,63,74,30,64,38,65","dep":14,"op":15,"nc":464},
    {"d":"inconceivable","b":[[7,10,5,13,14,9],[9,8,0,13,14,5],[2,6,7,9,10,12],[1,0,10,7,6,15],[0,0,6,4,5,10]],"N":15,"a":"1:0:410.411.412.365.364.348.282.246|1:3:349.353.355.289.253.251.247.211|2:7:283.287|2:5:210.127.126.136|4:7:128.137.215.217.220.219.221|2:2:144.143.145.146.147.157|0:5:256.255.291.357.385.391.392.393|4:0:292.358.375.384.381.380.383|0:0:155.156.222.223.224.260.296.362|1:7:587.589.591.590.555.554.553.523|3:5:588.586.585.595.594.592.593.582|0:3:361.360.294.293.359.386.387.449|0:1:257.258.259.295|0:7:158.160.159.148.149.218.254|5:2:608.610.612.611.623.634.633|0:3:161.225.261.297.363|1:6:371.423.430.373|2:3:583.580.581.584.552.522.464.463|2:1:322.329.330.337.336.335.334.341|2:5:175.231.267.308.307|5:7:82.81.80.37.27.21.20.19|0:6:461.520.550|0:1:521.551|0:7:102.101.100.98.99.164|3:7:562.532.531.486.485.446.448.437|5:2:530.528.478.477|2:0:524.468.467.476.475.474.481.492|2:7:604.619.618.617.616.614.625|2:4:466.465|1:3:630.631.647.648.650.652.577.547.517|1:0:451.496.536.566.624.635.655.579.549.519|4:4:613.564.534.489.488.438.439.441.443|5:6:370.369.420.418.416.414|3:2:487.436.429|0:5:533.563|2:5:422.424.431.432.425.426.433|4:3:413.415.417.419|4:6:263.300.298.301.302.304.303.305|4:2:299.262.264|1:7:421.428.427.434.435.374.372.354|1:5:356.290.288.252.216.142|0:4:141.140.139.131.132.130.212|1:1:306.266.265.229|0:1:214.250.286|5:2:382.389.450.495.494.493.500.499|2:4:278.342.352|0:0:13.12.18.16.17.61|5:7:230.174.173.105.106.50.48.46|1:6:482.483.484.447|2:0:129.138|3:4:366.367.351.339|5:6:112.110.108.107|3:7:350.284.248.249.241|3:1:184.190.197.116.113.111|5:0:213.205.121.119.118|3:7:368.338.340.333.331.332.325.318|3:2:285.277.275.239.237|3:4:273.271.235.187.181.169|4:6:189.183.177.179.165.166.168.170.171|1:5:310.311.269.233.227.226.228.172|4:2:178.109.54.39.2.1.0.3|1:4:162.163|0:5:10.11|4:1:104.103.44.43.45|1:0:38.40.41.42.8|3:6:4.6.5.7.14.15.9|0:0:29.30.28.31.33.34|5:5:167.180.186.192.200.201.199.196|3:7:32.77.75.76.68|1:3:193.202.203|2:3:89.86.88.87.133|5:6:36.79.78|4:2:540.539.569.637.638.636|5:2:117.115|5:7:234.270.316.315.314.313|0:5:35.26.25.24.22.23|5:3:513.502.501.511.509.507.504|0:2:545.546.576|2:2:323.272.274.238.240.276.281|4:0:312.319.326.327|2:4:320.321.328|5:6:575.574.646.644.573.572|3:3:324.317|1:3:309.268.232|0:3:388.390.396.394.400.401.454|3:1:236.188.182.176|1:5:645.643.629.628.641.642.640.571|3:6:654.653.651.649.632.621.607|2:0:627.639|5:0:185.191.198.195|2:1:512.510.508.505.506.498.537.567.570|3:6:626.615.600.599.601.602.603.596|2:0:58.57.47.49.51.52.53|4:1:597.598.606|1:4:541.542.543.544.514|3:1:279.280.244.208.124.123.94.93|5:0:91.92.90|1:3:346.344.343.345.347|3:3:96.95.84.83.72.65|2:1:59.60.67.66.73.74.114.120|1:4:497.490.491.535.565.559.529.480|5:6:242.243.207.206.122.135.134|1:7:402.455.452.395|3:6:204.194|3:1:62.69.70.63|2:5:64.71|4:4:55.56|2:0:609.622|1:7:245.209.125|2:6:85.97|5:5:152.150.153.154.151|2:0:605.620|0:6:379.445|0:7:442.440.376.377.378.444|5:6:568.538.503.453.399.398.397|0:2:407.405.403.404|5:1:456.516.515|0:5:457.406.408.409.459.458.518|0:7:548.578|2:6:525.526.471.470.469|4:3:560.561|3:4:558.556|2:5:460.462.473.472.479|0:3:527.557","s":"109,108,99,113,90,92,94,98,100,8,40,95,86,65,87,88,64,63,110,118,117,106,44,116,76,4,39,112,60,5,29,48,73,72,31,27,104,30,57,3,47,26,77,78,49,18,97,13,111,1,59,80,67,28,62,121,15,11,23,53,46,79,9,14,10,81,54,35,89,122,22,74,56,85,115,36,102,6,51,42,7,45,0,68,71,91,107,66,20,2,17,34,19,61,16,93,12,123,52,69,84,33,103,83,32,21,37,38,75,24,58,55,25,114,50,41,43,82,120,119,70,96,101,105","dep":16,"op":27,"nc":656},
    {"d":"easy","b":[[0,0,0,3,2,2],[1,0,2,4,2,4],[4,0,1,6,2,4]],"N":6,"a":"0:4:3.0.1|1:5:36.38.21|2:6:4.14.12.13|4:4:29.32.33|4:3:2.8.7.10|1:0:45.31.28.30|4:2:6.9|4:1:5.11.23|1:6:37.20|0:5:15.17.25.26|0:7:16.18.34|3:7:24.22.40.39|1:3:49.48.41|0:1:42.50|0:1:44.55.53.65|1:4:56.46.47.35|0:0:19.27.43.51|2:3:68.70.71|2:5:57.63|5:6:79.77.75.72|3:5:52.58.60.54|5:4:69.67.64|1:3:66.74.73.59|0:7:76.61.62.78","s":"18,19,23,16,17,15,13,4,10,9,3,8,6,1,7,21,20,2,14,0,5,11,12,22","dep":6,"op":8,"nc":80},
    {"d":"expert","b":[[0,0,5,4,4,8],[2,4,2,6,8,7],[0,1,0,5,4,5]],"N":8,"a":"1:7:157.155.148.149.144.86.62|5:3:88.93.74.73.72.71|4:4:200.198.189.146.153.154|2:0:147.142.130.132.143|5:5:64.32.22.21.20|5:5:77.75.76.85.61.18.16|0:7:15.13.11.8.10.9.56|5:0:50.48.46.44.29.19.17|3:4:234.242.241.244.246.248.250.251|2:6:49.47.45.43.41.69.96|0:0:60.59.14.12.58|5:6:145.136.135.137.138.83.82|2:1:84.139.179.177.175.172.173|1:0:80.81.87.90.66|0:1:57.63.24.35.34.37.67|5:4:31.30|2:2:65.89.91.95.94.101|4:5:68.39.38.40|5:4:42.28.27.26|1:7:171.183.190.191.150|4:4:216.199.194.193.195|1:5:184.192.151|2:7:124.113.112.111.110.108.115|5:1:70.97.104.103|2:5:185.186.187.196.218.217.228.235|4:0:152.158.160.162.165.164.166|3:1:168.169.170.163.206.204.202|0:7:5.3.0.2.52|5:6:201.224.223.221|4:2:215.214.226.233.240.243|4:3:222.220.219.229.236.245.247.249|5:7:213.212.211.210.209.207|5:6:100.159.161.107.106|2:4:99.98.105|5:0:114.126.125.123.122.120.118|1:6:181.140.129.127.128|3:2:25.36.33.23|4:2:7.55.54.53.51.1.4.6|5:3:167.121.119.116|0:2:92.156|0:5:208.205.203.227|2:6:102.109.117|5:3:131.133.134.79.78|4:3:182.141|5:4:178.176.174|3:0:197.188.180|1:7:225.232.231.238.239|2:0:230.237","s":"30,47,29,45,26,24,38,22,20,34,25,16,28,14,33,19,13,21,23,12,44,11,46,32,6,36,18,7,9,4,40,17,0,10,15,37,1,31,41,8,39,5,2,3,35,27,42,43","dep":14,"op":10,"nc":252},
    {"d":"expert","b":[[5,0,0,9,4,5],[0,1,3,5,4,7],[9,0,1,12,3,4]],"N":12,"a":"0:0:88.91.93.95.97.98.125|0:4:96.124.142.161.188.200.215|4:1:63.49.35.18.11.10.12|4:6:94.92.89.90.121.120.122|2:0:123.141.140.159.157.158.166|1:7:160.187.199.213.210.197.185|3:7:135.134.116.115.108|1:2:138.139.145.147.129.106|2:4:127.101.100.102.107.105.110|3:3:113.114.133.131.111.112|1:2:103.69.68.70.72.74.58|4:5:132.150.175.170.169.173.176|2:3:143.163.162.167|1:5:57.56.42.43.44.45.31|4:4:174.149.151.177.179.181.183|3:0:152.153.154.155.148.146.144|4:0:2.27.32.46.60.55.54|3:5:76.81.80.117.118.119.109|0:6:164.168.172.184.182.180.195|0:3:38.37.36.34.48.62|1:1:85.78.77.71.73.75|0:7:21.19.20|0:5:16.17|3:6:22.24.23.14|5:0:83.84.65.51.50|0:6:136.137.130.128.104.99.126|3:4:59.61.67.66.52.53|0:1:64.82|4:3:9.8.6.29.30|2:3:3.0.1.26.40.41|3:1:178.194.206.226.228.229|5:2:171.196.208.207|5:7:221.216.214.220.227.225|3:7:192.193.190|5:3:79.87.86|0:6:201.189.191.203|3:1:47.33.39.25.15|4:4:13.5.7|1:0:28.4|0:6:204.223|0:5:222.224.205.202.218|2:3:211.198.186.156.165|4:6:219.217.209.212","s":"40,32,39,42,35,30,31,37,18,23,28,11,2,38,12,36,41,14,13,7,15,25,17,8,4,0,1,10,26,33,20,6,3,16,27,19,5,24,9,22,29,21,34","dep":11,"op":10,"nc":230},
    {"d":"insane","b":[[2,6,1,7,10,7],[3,2,4,7,6,10],[0,0,0,5,4,4],[4,4,7,8,9,10]],"N":10,"a":"5:3:78.64.65.161.163.164.151.143.134|5:5:68.70.72.71.82.81.69.67|0:6:80.88.97.98.172|2:1:243.277.349.346.345.334.336.348|0:1:87.86.94.96|3:3:75.76.77.85.93.92.84.83.73|3:7:74.152.153.154.156.158.160.149|1:0:181.190.196.209.206.208|3:4:150.142.144.136|1:4:347.335.270.233.228.268.264.263.220|0:0:242.276|2:2:293.291.253.202.124.123.138.146|3:5:145.137.121.122.201.200.199.193|1:0:300.288.286.283.285.284.287.251|0:3:252.289|5:4:133.212.211.213.198.192.185.183|3:5:197.191|3:1:131.130.58.59.43.24.22.25.18|3:3:2.11.17.40.38.54.56.116.114|4:2:16.10.0.3|1:7:214.216.259.261.218|0:6:12.13.5.6.35.51.111|3:6:207.210.132.60.44.45.46.47|5:0:27.29.31.21.15.9.8|2:0:266.223.222.265.319.316.315|3:2:280.281.357.355.354.352.338|0:4:30.28.26.23.42|3:2:19.20.14.7|1:3:117.135.63|5:1:119.120.118.115.113.112|5:7:62.61|1:7:110.50.34.4|3:2:318.328.326.327.317|5:2:187.186.184.182.179|0:6:1.32.33.49.48.108.109.180|1:5:53.52.36.37.39.55.57.41|4:6:90.91.103.104.106.176.177.169.234|0:2:89.99.100|5:0:107.105|0:0:157.159.226.227.267|0:1:101.102|0:3:238.236.237|0:0:205.129.128.127.140.141|0:5:356.340.339.331.332.378|5:4:323.324.313.368.373.372.374.379.377|0:6:148.147.139.125.126.203.254|3:6:381.380.375.376.325.314|0:6:231.232.240.274.344.343.342.386|3:4:178.188.194.195.189|4:0:239.273.272.271.341.383.384.382.385.387|3:1:366.309.304.296|1:5:365.364.362.359.367.369.370.371|3:2:308.361.360.363.302.303.294|0:3:269.333|1:3:295.255.204|4:3:301.290.292|3:5:258.256|3:2:215.217.219.262.260|4:2:244.245|1:0:305.306|3:5:388.389|1:3:171.170.95|0:7:168.166.79.66.162.221|1:7:275.241|4:5:246.247.248.235|4:5:224.225.230.229.167.165.155|5:4:175.174.173|1:6:358.282|3:1:322.330.329.320.321.311|4:3:307.299.297.298.257.250.249|5:2:312.310|3:6:353.279.278.351.350.337","s":"33,34,21,50,27,31,48,46,49,23,56,19,32,47,35,3,29,57,39,42,41,22,17,53,12,8,24,65,2,6,30,36,43,54,7,15,0,14,52,61,26,28,44,5,18,9,51,11,13,16,10,1,4,55,20,62,60,63,70,64,45,69,59,68,25,66,58,71,40,37,38,67","dep":14,"op":17,"nc":390},
  ];
  const BONUS_COUNT = BONUS.length;
  /* Which bonus sits after every 10th campaign level (slot 1 = after level 10,
     slot 20 = after level 200), so each bonus matches the tier it's in. Bonus
     levels keep their ids (17–20 were added with the 200-level campaign), so
     saved progress stays with the right board. */
  const BONUS_SLOTS = [1, 2, 3, 17, 4, 5, 6, 7, 8, 9, 10, 11, 18, 19, 12, 13, 14, 20, 15, 16];
  function bonusCube(k) {
    const B = BONUS[k - 1];
    if (!B) throw new Error('No bonus level ' + k);
    const boxes = B.b || [[0, 0, 0, B.N, B.N, B.N]];
    const g = geometryFor(boxes);
    if (g.cells.length !== B.nc) throw new Error('Bonus level ' + k + ' does not match the shape code');
    const arrows = B.a.split('|').map((t, id) => {
      const [dir, color, cells] = t.split(':');
      return { id, dir: Number(dir), color: Number(color), cells: cells.split('.').map(Number) };
    });
    return {
      cube: true, bonus: k, seed: 'bonus|' + k, diff: B.d, t: 0, N: g.N, boxes: B.b ? boxes : undefined,
      cols: g.X, rows: g.Y, shape: B.b ? 'blocks' : 'cube', arrows, solution: B.s.split(',').map(Number),
      meta: { attempts: 0, depth: B.dep, initialFree: B.op, genMs: 0, emptyCells: 0 },
    };
  }

  const api = { DIRS, geometry, geometryFor, geometryOf, randomShape, CUBE, CubeBoardState, BoardState: CubeBoardState, analyze, verifySolution, generateCube, zenCube, CUBE_VERSION, BONUS_AFTER, BONUS_COUNT, BONUS_SLOTS, bonusCube };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SlipCube = api;
})(typeof window !== 'undefined' ? window : globalThis);
