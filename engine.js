/* ==========================================================================
   SLIPSTREAM — puzzle engine
   Pure logic, no DOM: seeded RNG, difficulty table, arrow geometry,
   collision, reverse-order generator, validator/solver, campaign/daily/zen
   seeding. Loaded by the browser as a plain script (window.SlipEngine) and
   by Node for testing (module.exports).
   ========================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------
     Seeded RNG
     A string seed is hashed (cyrb53 variant) to 32 bits, then drives a
     mulberry32 generator. Only integer ops + one division, so every
     browser produces the identical sequence for the identical seed.
     ------------------------------------------------------------------ */
  function hashString(str) {
    str = String(str);
    let h1 = 0xdeadbeef ^ str.length, h2 = 0x41c6ce57 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h1 ^ h2) >>> 0;
  }

  class RNG {
    constructor(seed) { this.s = hashString(seed); }
    float() {
      let t = (this.s = (this.s + 0x6D2B79F5) | 0);
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    int(a, b) { return a + Math.floor(this.float() * (b - a + 1)); }
    range(a, b) { return a + (b - a) * this.float(); }
    chance(p) { return this.float() < p; }
    pick(arr) { return arr[Math.floor(this.float() * arr.length)]; }
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this.float() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    }
  }

  /* ------------------------------------------------------------------
     Directions: 0 up, 1 right, 2 down, 3 left (screen coordinates).
     ------------------------------------------------------------------ */
  const DX = [0, 1, 0, -1];
  const DY = [-1, 0, 1, 0];
  const DIR_NAMES = ['up', 'right', 'down', 'left'];
  const opposite = (d) => (d + 2) & 3;

  /* ------------------------------------------------------------------
     Difficulty table — the single place to tune difficulty.
     Every numeric setting is a [start, end] pair. A value t in 0..1
     interpolates between them: campaign levels use their position
     inside their tier, Daily and Zen pick t from the seed.
     To add "Expert" later, add another entry with a higher rank.
     ------------------------------------------------------------------ */
  //  Arrow shapes: each arrow's length is drawn from a mix of
  //    short  (2-4 cells)          — shortChance
  //    long   (longLen range)      — longChance
  //    medium (medLen range)       — everything else
  //  and it turns after straight runs of segMin..segMax cells, up to
  //  maxBends turns, so long arrows wind like the ones in maze puzzles.
  const DIFFICULTIES = {
    easy: {
      id: 'easy', label: 'Easy', rank: 1,
      blurb: 'Compact boards, gentle bends, short chains.',
      cols: [6, 8], rows: [8, 11],
      shortChance: [0.35, 0.25], longChance: [0.08, 0.18],
      medLen: [[3, 5], [4, 6]], longLen: [[6, 8], [7, 11]],
      segMin: [2, 1], segMax: [4, 3], maxBends: [2, 4],
      blockBias: [0.6, 1.2], candidates: [5, 9],
      maxFreeRatio: [0.6, 0.45], minDepth: [2, 4],
      shapes: ['rect', 'rect', 'notch'],
    },
    medium: {
      id: 'medium', label: 'Medium', rank: 2,
      blurb: 'Bigger boards, winding arrows, longer dependency chains.',
      cols: [9, 12], rows: [12, 16],
      shortChance: [0.25, 0.2], longChance: [0.22, 0.3],
      medLen: [[4, 8], [5, 9]], longLen: [[9, 15], [11, 19]],
      segMin: [1, 1], segMax: [4, 3], maxBends: [4, 8],
      blockBias: [1.2, 1.8], candidates: [10, 14],
      maxFreeRatio: [0.4, 0.3], minDepth: [5, 8],
      shapes: ['rect', 'notch', 'oval', 'rect'],
    },
    hard: {
      id: 'hard', label: 'Hard', rank: 3,
      blurb: 'Dense mazes of long, twisting arrows. Few safe openings.',
      cols: [13, 17], rows: [17, 23],
      shortChance: [0.2, 0.15], longChance: [0.3, 0.38],
      medLen: [[5, 10], [6, 11]], longLen: [[12, 22], [14, 28]],
      segMin: [1, 1], segMax: [3, 3], maxBends: [8, 14],
      blockBias: [1.8, 2.6], candidates: [14, 20],
      maxFreeRatio: [0.3, 0.24], minDepth: [8, 12],
      shapes: ['rect', 'notch', 'oval', 'cross', 'hole'],
    },
    expert: {
      id: 'expert', label: 'Expert', rank: 4,
      blurb: 'Big mazes, very long snakes, deep chains. Zoom helps.',
      cols: [17, 20], rows: [22, 27],
      shortChance: [0.15, 0.12], longChance: [0.38, 0.45],
      medLen: [[6, 11], [7, 12]], longLen: [[14, 28], [16, 34]],
      segMin: [1, 1], segMax: [3, 3], maxBends: [12, 18],
      blockBias: [2.4, 2.9], candidates: [18, 22],
      maxFreeRatio: [0.24, 0.2], minDepth: [11, 14],
      shapes: ['rect', 'rect', 'notch', 'oval', 'hole'],
    },
    nightmare: {
      id: 'nightmare', label: 'Nightmare', rank: 5,
      blurb: 'Huge wall-to-wall labyrinths. Only for the stubborn.',
      cols: [21, 25], rows: [28, 34],
      shortChance: [0.12, 0.1], longChance: [0.45, 0.52],
      medLen: [[7, 12], [8, 14]], longLen: [[18, 36], [20, 44]],
      segMin: [1, 1], segMax: [3, 4], maxBends: [16, 24],
      blockBias: [2.8, 3.2], candidates: [20, 24],
      maxFreeRatio: [0.2, 0.16], minDepth: [14, 18],
      shapes: ['rect', 'rect', 'notch', 'hole'],
    },
    insane: {
      id: 'insane', label: 'Insane', rank: 6,
      blurb: 'Colossal mazes of endless snakes. Bring patience and zoom.',
      cols: [26, 29], rows: [35, 39],
      shortChance: [0.1, 0.08], longChance: [0.5, 0.56],
      medLen: [[8, 14], [9, 15]], longLen: [[22, 44], [24, 52]],
      segMin: [1, 1], segMax: [4, 4], maxBends: [20, 28],
      blockBias: [3.2, 3.6], candidates: [22, 26],
      maxFreeRatio: [0.16, 0.13], minDepth: [18, 22],
      shapes: ['rect', 'rect', 'notch', 'hole'],
      maxAttempts: 16, acceptFirstFull: true,
    },
    impossible: {
      id: 'impossible', label: 'Impossible', rank: 7,
      blurb: 'The biggest boards there are. Probably not impossible.',
      cols: [31, 34], rows: [42, 46],
      shortChance: [0.08, 0.06], longChance: [0.56, 0.62],
      medLen: [[10, 16], [11, 18]], longLen: [[28, 56], [32, 64]],
      segMin: [1, 1], segMax: [4, 5], maxBends: [26, 36],
      blockBias: [3.6, 4], candidates: [24, 28],
      maxFreeRatio: [0.13, 0.1], minDepth: [22, 26],
      shapes: ['rect', 'rect', 'hole'],
      maxAttempts: 16, acceptFirstFull: true,
    },
  };
  const DIFFICULTY_ORDER = Object.keys(DIFFICULTIES).sort((a, b) => DIFFICULTIES[a].rank - DIFFICULTIES[b].rank);

  const lerp = (a, b, t) => a + (b - a) * t;
  const at = (pair, t) => lerp(pair[0], pair[1], t);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /** Turn a difficulty + t into the concrete numbers the generator uses. */
  function resolveParams(diffId, t, rng) {
    const d = DIFFICULTIES[diffId];
    if (!d) throw new Error('Unknown difficulty ' + diffId);
    t = clamp(t, 0, 1);
    const cols = clamp(Math.round(at(d.cols, t) + rng.range(-0.7, 0.7)), 4, 60);
    const rows = clamp(Math.round(at(d.rows, t) + rng.range(-0.7, 0.7)), 4, 60);
    // Early levels of a tier always use a plain rectangle; shapes appear later.
    const shape = t < 0.25 ? 'rect' : rng.pick(d.shapes);
    const mask = buildMask(shape, cols, rows);
    let playable = 0;
    for (let i = 0; i < mask.length; i++) playable += mask[i];
    const pairAt = (pp) => [Math.round(at([pp[0][0], pp[1][0]], t)), Math.round(at([pp[0][1], pp[1][1]], t))];
    return {
      diff: diffId, t, cols, rows, shape, mask, playable,
      shortChance: at(d.shortChance, t),
      longChance: at(d.longChance, t),
      medLen: pairAt(d.medLen),
      longLen: pairAt(d.longLen),
      segMin: Math.round(at(d.segMin, t)),
      segMax: Math.round(at(d.segMax, t)),
      maxBends: Math.round(at(d.maxBends, t)),
      blockBias: at(d.blockBias, t),
      candidates: Math.round(at(d.candidates, t)),
      maxFreeRatio: at(d.maxFreeRatio, t),
      minDepth: Math.round(at(d.minDepth, t)),
      rescue: !!d.acceptFirstFull,
    };
  }

  function sampleLength(p, rng) {
    const r = rng.float();
    if (r < p.shortChance) return rng.int(2, 4);
    if (r < p.shortChance + p.longChance) return rng.int(p.longLen[0], p.longLen[1]);
    return rng.int(p.medLen[0], p.medLen[1]);
  }

  /* ------------------------------------------------------------------
     Board shapes. Cells outside the mask never hold arrows, but exit
     corridors pass over them freely.
     ------------------------------------------------------------------ */
  function buildMask(shape, cols, rows) {
    const m = new Uint8Array(cols * rows);
    const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let on = 1;
        if (shape === 'notch') {
          const k = Math.max(1, Math.floor(Math.min(cols, rows) / 4));
          const rx = cols - 1 - x, ry = rows - 1 - y;
          if (x + y < k || rx + y < k || x + ry < k || rx + ry < k) on = 0;
        } else if (shape === 'oval') {
          const dx = (x - cx) / (cols / 2), dy = (y - cy) / (rows / 2);
          if (dx * dx + dy * dy > 1.12) on = 0;
        } else if (shape === 'cross') {
          const kx = Math.floor(cols / 4), ky = Math.floor(rows / 4);
          if ((x < kx || x >= cols - kx) && (y < ky || y >= rows - ky)) on = 0;
        } else if (shape === 'hole') {
          const hx = Math.max(1, cols / 7), hy = Math.max(1, rows / 7);
          if (Math.abs(x - cx) < hx && Math.abs(y - cy) < hy) on = 0;
        }
        m[y * cols + x] = on;
      }
    }
    return m;
  }

  /* ------------------------------------------------------------------
     Arrow geometry & collision
     An arrow is a path of orthogonally adjacent cells, stored tail→head.
     Its exit direction is the direction of its last step. When released
     it slides like a snake: the head travels straight along `dir` and the
     body follows through cells the arrow itself just vacated. So the only
     cells that can block it are the head's EXIT CORRIDOR: every cell from
     the head (exclusive) to the board edge in `dir`.
     ------------------------------------------------------------------ */
  function corridor(cols, rows, hx, hy, dir) {
    const out = [];
    let x = hx + DX[dir], y = hy + DY[dir];
    while (x >= 0 && y >= 0 && x < cols && y < rows) {
      out.push(y * cols + x);
      x += DX[dir]; y += DY[dir];
    }
    return out;
  }

  /** Live board used during play: occupancy grid + alive set. */
  class BoardState {
    constructor(puzzle, removed) {
      this.p = puzzle;
      this.occ = new Int16Array(puzzle.cols * puzzle.rows).fill(-1);
      this.alive = new Set();
      for (const a of puzzle.arrows) {
        this.alive.add(a.id);
        for (const [x, y] of a.cells) this.occ[y * puzzle.cols + x] = a.id;
      }
      if (removed) for (const id of removed) this.remove(id);
    }
    get count() { return this.alive.size; }
    corridorOf(id) {
      const a = this.p.arrows[id];
      const h = a.cells[a.cells.length - 1];
      return corridor(this.p.cols, this.p.rows, h[0], h[1], a.dir);
    }
    /** First arrow in the exit corridor, or null if the way out is clear. */
    firstBlocker(id) {
      const cells = this.corridorOf(id);
      for (let i = 0; i < cells.length; i++) {
        const o = this.occ[cells[i]];
        if (o !== -1 && o !== id) return { id: o, cell: cells[i], steps: i + 1 };
      }
      return null;
    }
    isFree(id) { return this.alive.has(id) && !this.firstBlocker(id); }
    remove(id) {
      if (!this.alive.has(id)) return false;
      this.alive.delete(id);
      for (const [x, y] of this.p.arrows[id].cells) this.occ[y * this.p.cols + x] = -1;
      return true;
    }
    freeArrows() {
      const out = [];
      for (const id of this.alive) if (!this.firstBlocker(id)) out.push(id);
      return out;
    }
    /** Hint: the earliest arrow in the known solution that is still here.
        Every arrow before it in that order is gone, and only those can
        block it, so it is guaranteed free. Falls back to any free arrow. */
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

  /* ------------------------------------------------------------------
     Validator / solver
     Removing an arrow can only ever clear corridors, never block one, so
     the set of releasable arrows only grows. That means there are no dead
     ends: a board is solvable iff repeatedly removing every free arrow
     empties it. This is exact (not a heuristic) and runs in polynomial
     time, so every board — any size — is fully validated.
     Each round of simultaneous removals is one "wave"; the wave count is
     the length of the longest dependency chain.
     ------------------------------------------------------------------ */
  function analyze(puzzle, removed) {
    const b = new BoardState(puzzle, removed);
    let depth = 0, initialFree = -1;
    const order = [];
    while (b.count > 0) {
      const free = b.freeArrows();
      if (initialFree < 0) initialFree = free.length;
      if (!free.length) {
        return { solvable: false, depth, initialFree, remaining: b.count, order };
      }
      for (const id of free) { b.remove(id); order.push(id); }
      depth++;
    }
    return { solvable: true, depth, initialFree: Math.max(0, initialFree), remaining: 0, order };
  }

  /** Replay a specific removal order and confirm every step is legal. */
  function verifySolution(puzzle, order) {
    const b = new BoardState(puzzle);
    for (const id of order) {
      if (!b.alive.has(id) || b.firstBlocker(id)) return false;
      b.remove(id);
    }
    return b.count === 0;
  }

  /* ------------------------------------------------------------------
     Generator — reverse construction
     Arrows are PLACED in the reverse of the order they will be REMOVED.
     Rule for placing a new arrow:
       • its cells must be empty, and
       • its own exit corridor must be empty right now.
     Its cells MAY sit in corridors of arrows already placed — that is
     how dependencies form ("B blocks A"). Since everything that could
     block the new arrow is placed later (and so removed earlier), the
     reversed placement order is always a valid solution.
     Several random candidates are tried for each placement and scored;
     candidates that block currently-free arrows score higher, which
     builds long chains and leaves few safe openings on Hard.
     ------------------------------------------------------------------ */
  function buildBoard(p, rng) {
    const { cols, rows, mask } = p;
    const N = cols * rows;
    const occ = new Int16Array(N).fill(-1);
    const cellRays = Array.from({ length: N }, () => []); // ids whose corridor crosses each cell
    const blockCount = [];                                // occupied cells in each arrow's corridor
    const placed = [];
    const playable = [];
    for (let i = 0; i < N; i++) if (mask[i]) playable.push(i);

    // Candidate heads are sampled only from (cell, direction) pairs whose
    // corridor is currently clear, so late placements still find room.
    function headOptions() {
      // For each row and column, where are its outermost occupied cells?
      // A corridor is clear exactly when no occupied cell lies beyond the
      // head in that direction, so each check is O(1) instead of a walk.
      // Output order matches the original cell-by-cell scan, so boards are identical.
      const minC = new Int32Array(rows).fill(cols), maxC = new Int32Array(rows).fill(-1);
      const minR = new Int32Array(cols).fill(rows), maxR = new Int32Array(cols).fill(-1);
      for (let i = 0; i < N; i++) {
        if (occ[i] === -1) continue;
        const x = i % cols, y = (i / cols) | 0;
        if (x < minC[y]) minC[y] = x;
        if (x > maxC[y]) maxC[y] = x;
        if (y < minR[x]) minR[x] = y;
        if (y > maxR[x]) maxR[x] = y;
      }
      const out = [];
      for (const i of playable) {
        if (occ[i] !== -1) continue;
        const x = i % cols, y = (i / cols) | 0;
        if (minR[x] > y) out.push(i * 4);      // up
        if (maxC[y] < x) out.push(i * 4 + 1);  // right
        if (maxR[x] < y) out.push(i * 4 + 2);  // down
        if (minC[y] > x) out.push(i * 4 + 3);  // left
      }
      return out;
    }

    function tryCandidate(options) {
      if (!options.length) return null;
      const o = options[Math.floor(rng.float() * options.length)];
      const head = o >> 2, d = o & 3;
      const hx = head % cols, hy = (head / cols) | 0;
      return growBody(head, hx, hy, d, corridor(cols, rows, hx, hy, d));
    }

    // Walk backwards from the head. The first step is straight behind the
    // head so the arrowhead always sits on a straight segment. The walk
    // runs straight for a random segMin..segMax cells, then turns; if the
    // way ahead is blocked it turns early, so bodies snake around others.
    function growBody(head, hx, hy, d, ray) {
      const len = sampleLength(p, rng);
      const cells = [head];
      const used = new Set(cells);
      const raySet = new Set(ray); // never let the body sit in its own corridor
      let x = hx, y = hy, heading = opposite(d), bends = 0, straight = 0;
      let seg = rng.int(Math.max(1, p.segMin), Math.max(p.segMin, p.segMax));
      const ok = (nx, ny) => {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return -1;
        const ni = ny * cols + nx;
        return (!mask[ni] || occ[ni] !== -1 || used.has(ni) || raySet.has(ni)) ? -1 : ni;
      };
      while (cells.length < len) {
        const canTurn = straight >= 1 && bends < p.maxBends;
        const perps = rng.shuffle([(heading + 1) & 3, (heading + 3) & 3]);
        const options = !canTurn ? [heading] : straight >= seg ? perps.concat([heading]) : [heading].concat(perps);
        let moved = false;
        for (const nd of options) {
          const ni = ok(x + DX[nd], y + DY[nd]);
          if (ni < 0) continue;
          if (nd !== heading) {
            bends++; straight = 0; heading = nd;
            seg = rng.int(Math.max(1, p.segMin), Math.max(p.segMin, p.segMax));
          }
          cells.push(ni); used.add(ni);
          x += DX[nd]; y += DY[nd]; straight++;
          moved = true;
          break;
        }
        if (!moved) break;
      }
      if (cells.length < 2) return null;
      return { cells: cells.reverse(), dir: d, ray, bends };
    }

    // `sealed` is how strongly the generator avoids arrows whose corridor has
    // no empty playable cell left: nothing placed later could ever block
    // them, so they would stay free from the first move.
    function score(c) {
      let open = 0;
      for (const r of c.ray) if (mask[r] && occ[r] === -1) open++;
      const sealedPenalty = open === 0 ? p.blockBias * 1.6 : -Math.min(open, 6) * 0.08 * p.blockBias;
      const hit = new Set();
      for (const cell of c.cells) for (const id of cellRays[cell]) hit.add(id);
      let freeHits = 0;
      for (const id of hit) if (blockCount[id] === 0) freeHits++;
      return c.cells.length * 0.45 + c.bends * 0.2 +
        p.blockBias * (freeHits + hit.size * 0.35) - sealedPenalty + rng.float() * 0.9;
    }

    function place(c) {
      const id = placed.length;
      for (const cell of c.cells) {
        occ[cell] = id;
        for (const rid of cellRays[cell]) blockCount[rid]++;
      }
      for (const r of c.ray) cellRays[r].push(id);
      blockCount[id] = 0;
      placed.push(c);
    }

    let fails = 0;
    const maxFails = 40 + playable.length;
    // Keep placing until no head has a clear way out; the gap-fill pass
    // below then covers whatever space is left.
    while (fails < maxFails) {
      let best = null, bestScore = -Infinity;
      const options = headOptions();
      if (!options.length) break;
      for (let k = 0; k < p.candidates; k++) {
        const c = tryCandidate(options);
        if (!c) continue;
        const s = score(c);
        if (s > bestScore) { best = c; bestScore = s; }
      }
      if (!best) { fails++; continue; }
      place(best);
    }

    fillGaps(p, rng, occ, cellRays, placed);

    const arrows = placed.map((c, id) => ({
      id,
      dir: c.dir,
      cells: c.cells.map((i) => [i % cols, (i / cols) | 0]),
    }));
    // Removal order = arrows sorted by rank (lowest rank leaves first).
    const solution = arrows.map((a) => a.id).sort((a, b) => placed[a].rank - placed[b].rank);
    let empty = 0;
    for (const i of playable) if (occ[i] === -1) empty++;
    return { arrows, solution, empty };
  }

  /* ------------------------------------------------------------------
     Gap fill — cover every leftover empty cell.
     Each arrow carries a RANK: its position in the known removal order
     (lower leaves first). Placement order gives the initial ranks. The one
     rule that keeps the board solvable:
         if arrow Y sits in arrow X's exit corridor, rank(Y) < rank(X).
     Every fill move below checks that rule before touching the board,
     so the sorted ranks remain a valid solution. Ranks are real numbers,
     so a new arrow can be slotted in anywhere in the order.
     Moves, tried for each empty cell until nothing changes:
       1. a new 2-cell arrow on this cell and an empty neighbour
       2. grow an adjacent arrow's head forward or tail back into the
          cell, moving it in the order if its window allows
       3. split off a neighbour's tail end and join it to the cell
     ------------------------------------------------------------------ */
  function fillGaps(p, rng, occ, cellRays, placed) {
    const { cols, rows, mask } = p;
    placed.forEach((c, i) => { c.rank = -i; });
    const nb = (i) => {
      const x = i % cols, y = (i / cols) | 0, out = [];
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) out.push([ny * cols + nx, d]);
      }
      return out;
    };
    // Lowest rank among arrows whose corridor crosses `cell` (they must leave after).
    // `self` may be one id or a Set of ids to ignore (used when merging two arrows).
    const isSelf = (id, self) => (self instanceof Set ? self.has(id) : id === self);
    const minWatcherRank = (cell, except) => {
      let m = Infinity;
      for (const id of cellRays[cell]) if (!isSelf(id, except) && placed[id].rank < m) m = placed[id].rank;
      return m;
    };

    // Where in the removal order could an arrow with these cells and this
    // corridor go? After everything in its corridor, before everything whose
    // corridor crosses its cells. Returns a rank, or null if the window is empty.
    function rankWindow(cells, ray, self) {
      let lower = -Infinity, upper = Infinity;
      for (const r of ray) { const o = occ[r]; if (o !== -1 && !isSelf(o, self)) lower = Math.max(lower, placed[o].rank); }
      for (const x of cells) upper = Math.min(upper, minWatcherRank(x, self));
      if (!(lower < upper)) return null;
      if (lower === -Infinity) return upper === Infinity ? 0 : upper - 1;
      return upper === Infinity ? lower + 1 : (lower + upper) / 2;
    }

    function newArrowOn(c, t, d0) {
      // d0 = direction from c to t. The head can be either cell.
      for (const [tail, head, dir] of rng.shuffle([[t, c, (d0 + 2) & 3], [c, t, d0]])) {
        const ray = corridor(cols, rows, head % cols, (head / cols) | 0, dir);
        const rank = rankWindow([tail, head], ray, -1);
        if (rank == null) continue;
        const id = placed.length;
        placed.push({ cells: [tail, head], dir, ray, bends: 0, rank });
        occ[tail] = id; occ[head] = id;
        for (const r of ray) cellRays[r].push(id);
        return true;
      }
      return false;
    }

    // A new arrow that winds through empty cells starting at c. The walk
    // follows the same straight-then-turn rhythm as the main generator;
    // if the full path can't be slotted into the order, shorter ones are tried.
    function tryNewArrow(c, minLen) {
      const want = sampleLength(p, rng);
      const path = [c];
      const used = new Set(path);
      let heading = rng.int(0, 3), straight = 0;
      let seg = rng.int(Math.max(1, p.segMin), Math.max(p.segMin, p.segMax));
      while (path.length < want) {
        const cur = path[path.length - 1];
        const x = cur % cols, y = (cur / cols) | 0;
        const perps = rng.shuffle([(heading + 1) & 3, (heading + 3) & 3]);
        const opts = straight >= seg ? perps.concat([heading]) : [heading].concat(perps);
        let moved = false;
        for (const nd of opts) {
          const nx = x + DX[nd], ny = y + DY[nd];
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const ni = ny * cols + nx;
          if (!mask[ni] || occ[ni] !== -1 || used.has(ni)) continue;
          if (nd !== heading) { heading = nd; straight = 0; seg = rng.int(Math.max(1, p.segMin), Math.max(p.segMin, p.segMax)); }
          path.push(ni); used.add(ni); straight++; moved = true;
          break;
        }
        if (!moved) break;
      }
      for (let n = path.length; n >= minLen; n--) {
        const fwd = path.slice(0, n);
        const back = fwd.slice().reverse();
        for (const q of rng.shuffle([fwd, back])) {
          if (tryAddPath(q, dirBetween(q[q.length - 2], q[q.length - 1]))) return true;
        }
      }
      return false;
    }

    // Grow a neighbouring arrow into c, re-ranking it if its window allows.
    function tryGrow(c) {
      for (const [n] of rng.shuffle(nb(c))) {
        const id = occ[n];
        if (id === -1) continue;
        const a = placed[id];
        const head = a.cells[a.cells.length - 1];
        if (a.cells.length >= p.longLen[1] + 4) continue;
        if (n === head && a.ray[0] === c) {
          const rank = rankWindow(a.cells.concat([c]), a.ray.slice(1), id);
          if (rank != null) {
            a.cells.push(c);
            a.ray = a.ray.slice(1);
            const list = cellRays[c];
            list.splice(list.indexOf(id), 1);
            occ[c] = id;
            a.rank = rank;
            return true;
          }
        }
        if (n === a.cells[0] && !a.ray.includes(c)) {
          const rank = rankWindow([c].concat(a.cells), a.ray, id);
          if (rank != null) {
            a.cells.unshift(c);
            occ[c] = id;
            a.rank = rank;
            return true;
          }
        }
      }
      return false;
    }

    // Split a neighbouring arrow where it touches c: its tail end (up to
    // the touching cell) breaks off and joins c as a new arrow, while the
    // original keeps its head and at least 2 cells. Shrinking an arrow only
    // removes constraints, so the original stays valid.
    function dirBetween(from, to) {
      const dx = (to % cols) - (from % cols), dy = ((to / cols) | 0) - ((from / cols) | 0);
      return dx === 1 ? 1 : dx === -1 ? 3 : dy === 1 ? 2 : 0;
    }
    function tryAddPath(path, dir) {
      const head = path[path.length - 1];
      const ray = corridor(cols, rows, head % cols, (head / cols) | 0, dir);
      for (const r of ray) if (path.includes(r)) return false;
      const rank = rankWindow(path, ray, -1);
      if (rank == null) return false;
      const id = placed.length;
      placed.push({ cells: path, dir, ray, bends: 0, rank });
      for (const x of path) occ[x] = id;
      for (const r of ray) cellRays[r].push(id);
      return true;
    }
    function trySteal(c) {
      for (const [n] of rng.shuffle(nb(c))) {
        const id = occ[n];
        if (id === -1) continue;
        const a = placed[id];
        const k = a.cells.indexOf(n);
        if (k > a.cells.length - 3) continue;
        const piece = a.cells.slice(0, k + 1);
        const rest = a.cells.slice(k + 1);
        a.cells = rest;
        for (const x of piece) occ[x] = -1;
        // Either the gap becomes the new head, or the old tail end does.
        const forward = piece.concat([c]);
        const backward = [c].concat(piece.slice().reverse());
        const options = [[forward, dirBetween(n, c)]];
        if (backward.length >= 2) options.push([backward, dirBetween(backward[backward.length - 2], backward[backward.length - 1])]);
        for (const [path, dir] of rng.shuffle(options)) if (tryAddPath(path, dir)) return true;
        a.cells = piece.concat(rest);
        for (const x of piece) occ[x] = id;
      }
      return false;
    }

    // Split a neighbour at the touching cell the other way round: its HEAD
    // end (with the original head and corridor) takes in c, and its tail end
    // becomes a separate arrow with a new head. Both need valid ranks, and if
    // the tail part's new corridor crosses the head part, the head part must
    // leave first.
    function bounds(cells, ray, self) {
      let lower = -Infinity, upper = Infinity;
      for (const r of ray) { const o = occ[r]; if (o !== -1 && !isSelf(o, self)) lower = Math.max(lower, placed[o].rank); }
      for (const x of cells) upper = Math.min(upper, minWatcherRank(x, self));
      return { lower, upper };
    }
    const between = (lo, hi) => (lo === -Infinity ? (hi === Infinity ? 0 : hi - 1) : hi === Infinity ? lo + 1 : (lo + hi) / 2);
    function trySplitHead(c) {
      for (const [n] of rng.shuffle(nb(c))) {
        const id = occ[n];
        if (id === -1) continue;
        const a = placed[id];
        const k = a.cells.indexOf(n);
        if (k < 2 || a.ray.includes(c)) continue;
        const rest = a.cells.slice(0, k);
        const front = [c].concat(a.cells.slice(k));
        const newDir = dirBetween(rest[rest.length - 2], rest[rest.length - 1]);
        const head = rest[rest.length - 1];
        const newRay = corridor(cols, rows, head % cols, (head / cols) | 0, newDir);
        if (newRay.some((r) => rest.includes(r))) continue;
        // Apply tentatively: `front` takes a new id with the old corridor,
        // the original id keeps `rest` with its new corridor.
        const fid = placed.length;
        const old = { cells: a.cells, dir: a.dir, ray: a.ray, rank: a.rank };
        placed.push({ cells: front, dir: a.dir, ray: a.ray, bends: 0, rank: 0 });
        for (const x of front) occ[x] = fid;
        for (const r of a.ray) { const l = cellRays[r]; l.splice(l.indexOf(id), 1, fid); }
        a.cells = rest; a.dir = newDir; a.ray = newRay;
        for (const r of newRay) cellRays[r].push(id);
        const both = new Set([id, fid]);
        const bf = bounds(front, placed[fid].ray, both);
        const br = bounds(rest, newRay, both);
        const restSeesFront = newRay.some((r) => occ[r] === fid);
        let rf = null, rr = null;
        const hiF = restSeesFront ? Math.min(bf.upper, br.upper) : bf.upper;
        if (bf.lower < hiF) {
          rf = between(bf.lower, hiF);
          const loR = restSeesFront ? Math.max(br.lower, rf) : br.lower;
          if (loR < br.upper) rr = between(loR, br.upper);
        }
        if (rr != null) { placed[fid].rank = rf; a.rank = rr; return true; }
        // Roll back.
        for (const r of newRay) { const l = cellRays[r]; l.splice(l.indexOf(id), 1); }
        for (const r of old.ray) { const l = cellRays[r]; l.splice(l.indexOf(fid), 1, id); }
        Object.assign(a, old);
        for (const x of old.cells) occ[x] = id;
        occ[c] = -1;
        placed.pop();
      }
      return false;
    }

    // Pass order matters for variety: first winding new arrows (3+ cells),
    // then lengthen neighbours, then 2-cell arrows, then splitting.
    let changed = true;
    while (changed) {
      changed = false;
      const gaps = [];
      for (let i = 0; i < occ.length; i++) if (mask[i] && occ[i] === -1) gaps.push(i);
      for (const c of rng.shuffle(gaps)) {
        if (occ[c] !== -1) continue;
        if (tryNewArrow(c, 3) || tryGrow(c) || tryNewArrow(c, 2) || trySteal(c)) changed = true;
      }
    }
    // Rescue pass for the giant tiers (Insane, Impossible): one more fill
    // move for gaps that survived the normal pass. Other tiers skip it so
    // their boards stay exactly as they were.
    changed = !!p.rescue;
    while (changed) {
      changed = false;
      const gaps = [];
      for (let i = 0; i < occ.length; i++) if (mask[i] && occ[i] === -1) gaps.push(i);
      for (const c of rng.shuffle(gaps)) {
        if (occ[c] !== -1) continue;
        if (trySplitHead(c) || tryNewArrow(c, 2) || tryGrow(c) || trySteal(c)) changed = true;
      }
    }
    mergeShort();
    const alive = placed.filter((c) => !c.dead);
    placed.length = 0;
    for (const c of alive) placed.push(c);

    /* Merge pass: join short arrows (<= 3 cells) end-to-end with a
       neighbour — one arrow's head touching the other's tail — so the
       board isn't littered with stubs. The merged arrow keeps the front
       arrow's head and corridor, and must still fit the rank rule. */
    function mergeShort() {
      const cap = p.longLen[1] + 6;
      for (let round = 0; round < 3; round++) {
        let merged = false;
        const shorts = placed.map((c, i) => i).filter((i) => !placed[i].dead && placed[i].cells.length <= 3);
        for (const sid of rng.shuffle(shorts)) {
          const A = placed[sid];
          if (A.dead || A.cells.length > 3) continue;
          const tailA = A.cells[0], headA = A.cells[A.cells.length - 1];
          const pairs = [];
          for (const [n] of nb(tailA)) {           // B's head touches A's tail -> B then A
            const bid = occ[n];
            if (bid === -1 || bid === sid) continue;
            const B = placed[bid];
            if (B.cells[B.cells.length - 1] === n) pairs.push([B, A, bid, sid]);
          }
          for (const [n] of nb(headA)) {           // A's head touches B's tail -> A then B
            const bid = occ[n];
            if (bid === -1 || bid === sid) continue;
            const B = placed[bid];
            if (B.cells[0] === n) pairs.push([A, B, sid, bid]);
          }
          for (const [back, front, backId, frontId] of rng.shuffle(pairs)) {
            const cells = back.cells.concat(front.cells);
            if (cells.length > cap) continue;
            const raySet = new Set(front.ray);
            if (back.cells.some((x) => raySet.has(x))) continue;
            const rank = rankWindow(cells, front.ray, new Set([backId, frontId]));
            if (rank == null) continue;
            front.cells = cells;
            front.rank = rank;
            front.bends = (front.bends || 0) + 1;
            for (const x of back.cells) occ[x] = frontId;
            for (const r of back.ray) { const l = cellRays[r]; const k = l.indexOf(backId); if (k >= 0) l.splice(k, 1); }
            back.dead = true;
            back.cells = [];
            merged = true;
            break;
          }
        }
        if (!merged) break;
      }
    }
  }

  /** Neighbouring arrows get different colours (greedy graph colouring). */
  function assignColors(arrows, cols, rows, rng, paletteSize) {
    const occ = new Int16Array(cols * rows).fill(-1);
    for (const a of arrows) for (const [x, y] of a.cells) occ[y * cols + x] = a.id;
    const order = rng.shuffle(arrows.map((a) => a.id));
    const color = new Array(arrows.length).fill(-1);
    for (const id of order) {
      const near = new Set();
      for (const [x, y] of arrows[id].cells) {
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const o = occ[ny * cols + nx];
          if (o !== -1 && o !== id && color[o] !== -1) near.add(color[o]);
        }
      }
      const options = [];
      for (let c = 0; c < paletteSize; c++) if (!near.has(c)) options.push(c);
      color[id] = options.length ? rng.pick(options) : rng.int(0, paletteSize - 1);
    }
    arrows.forEach((a) => { a.color = color[a.id]; });
  }

  const PALETTE_SIZE = 8;
  const MAX_ATTEMPTS = 24;

  /**
   * Generate a validated puzzle. Deterministic: the same seed, difficulty
   * and t always give the same board. Each attempt uses a derived seed;
   * a board is accepted only if the validator proves it solvable, the
   * stored solution replays cleanly, and it is non-trivial for its tier.
   */
  function generate({ seed, diff, t }) {
    const started = Date.now();
    const prng = new RNG(seed + '|params');
    if (t == null) t = prng.float();
    const params = resolveParams(diff, t, prng);
    let best = null, bestQuality = -Infinity;
    let attempts = 0;
    const maxAttempts = DIFFICULTIES[diff].maxAttempts || MAX_ATTEMPTS; // huge boards: fewer retries
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      attempts++;
      const rng = new RNG(seed + '|board|' + attempt);
      const { arrows, solution, empty } = buildBoard(params, rng);
      if (arrows.length < 4) continue;
      const puzzle = { cols: params.cols, rows: params.rows, arrows, solution };
      const report = analyze(puzzle);
      if (!report.solvable || !verifySolution(puzzle, solution)) continue; // discard, try again
      const n = arrows.length;
      const freeCap = Math.max(2, Math.ceil(params.maxFreeRatio * n));
      const ok = report.initialFree <= freeCap && report.depth >= params.minDepth;
      // A fully covered board beats everything else.
      const quality = (empty === 0 ? 5000 : -empty * 50) + (ok ? 1000 : 0) + report.depth * 3 - (report.initialFree / n) * 20;
      if (quality > bestQuality) {
        bestQuality = quality;
        best = { arrows, solution, report, rng, empty };
      }
      if (empty === 0 && (ok || DIFFICULTIES[diff].acceptFirstFull)) break;
    }
    if (!best) throw new Error('Generator could not build a solvable board for seed ' + seed);
    assignColors(best.arrows, params.cols, params.rows, new RNG(seed + '|colors'), PALETTE_SIZE);
    const mask = Array.from(params.mask);
    return {
      seed: String(seed),
      diff,
      t: params.t,
      cols: params.cols,
      rows: params.rows,
      shape: params.shape,
      mask,
      arrows: best.arrows,
      solution: best.solution,
      meta: {
        attempts,
        depth: best.report.depth,
        initialFree: best.report.initialFree,
        genMs: Date.now() - started,
        emptyCells: best.empty,
      },
    };
  }

  /* ------------------------------------------------------------------
     Campaign, Daily, Zen seeding
     ------------------------------------------------------------------ */
  const CAMPAIGN_TIERS = [
    { diff: 'easy', from: 1, to: 30 },
    { diff: 'medium', from: 31, to: 70 },
    { diff: 'hard', from: 71, to: 100 },
    { diff: 'expert', from: 101, to: 115 },
    { diff: 'nightmare', from: 116, to: 130 },
    { diff: 'insane', from: 131, to: 140 },
    { diff: 'impossible', from: 141, to: 150 },
  ];
  const CAMPAIGN_LENGTH = 150;
  const GENERATOR_VERSION = 'v3'; // v2: fully covered boards · v3: mixed lengths, winding arrows

  function campaignLevelInfo(level) {
    const tier = CAMPAIGN_TIERS.find((tr) => level >= tr.from && level <= tr.to) || CAMPAIGN_TIERS[CAMPAIGN_TIERS.length - 1];
    const t = tier.to === tier.from ? 1 : (level - tier.from) / (tier.to - tier.from);
    return { level, diff: tier.diff, t, seed: 'campaign|' + GENERATOR_VERSION + '|' + level };
  }
  function campaignPuzzle(level) {
    const info = campaignLevelInfo(level);
    return generate(info);
  }

  // Daily difficulty climbs through the week: Mon easy → weekend hard.
  const DAILY_BY_WEEKDAY = ['hard', 'easy', 'medium', 'medium', 'medium', 'hard', 'hard']; // Sun..Sat
  function dailyInfo(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const weekday = new Date(y, m - 1, d, 12).getDay();
    const diff = DAILY_BY_WEEKDAY[weekday];
    const seed = 'daily|' + GENERATOR_VERSION + '|' + dateKey;
    const t = 0.3 + new RNG(seed + '|t').float() * 0.55;
    return { dateKey, diff, t, seed };
  }
  function dailyPuzzle(dateKey) { return generate(dailyInfo(dateKey)); }

  function zenPuzzle(seed, diff) {
    return generate({ seed: 'zen|' + GENERATOR_VERSION + '|' + seed, diff, t: null });
  }

  const api = {
    RNG, hashString, DX, DY, DIR_NAMES, DIFFICULTIES, DIFFICULTY_ORDER,
    resolveParams, buildMask, corridor, BoardState, analyze, verifySolution,
    generate, CAMPAIGN_TIERS, CAMPAIGN_LENGTH, campaignLevelInfo, campaignPuzzle,
    dailyInfo, dailyPuzzle, zenPuzzle, DAILY_BY_WEEKDAY, PALETTE_SIZE, GENERATOR_VERSION,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SlipEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
