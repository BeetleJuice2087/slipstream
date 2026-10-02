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
    expert:     { N: 6, len: [3, 9], turn: 0.45, minDepth: 9, cand: 8, plain: 0.25, shape: { cells: [210, 300], dim: [3, 5], boxes: [2, 4], maxExt: 11 } },
    nightmare:  { N: 7, len: [3, 10], turn: 0.5, minDepth: 10, cand: 8, plain: 0.25, shape: { cells: [280, 380], dim: [3, 5], boxes: [2, 4], maxExt: 12 } },
    insane:     { N: 8, len: [3, 11], turn: 0.5, minDepth: 11, cand: 6, plain: 0.25, shape: { cells: [360, 460], dim: [4, 6], boxes: [2, 4], maxExt: 13 } },
    impossible: { N: 9, len: [3, 12], turn: 0.5, minDepth: 12, cand: 6, plain: 0.25, shape: { cells: [440, 560], dim: [4, 6], boxes: [3, 5], maxExt: 14 } },
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

  const CUBE_VERSION = 'c2'; // c2: block shapes
  function generateCube({ seed, diff, plain }) {
    const started = Date.now();
    const P = CUBE[diff] || CUBE.easy;
    const srng = new RNG(seed + '|shape');
    let boxes = null;
    if (!plain && !srng.chance(P.plain)) boxes = randomShape(srng, P.shape);
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

  const api = { DIRS, geometry, geometryFor, geometryOf, randomShape, CUBE, CubeBoardState, BoardState: CubeBoardState, analyze, verifySolution, generateCube, zenCube, CUBE_VERSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SlipCube = api;
})(typeof window !== 'undefined' ? window : globalThis);
