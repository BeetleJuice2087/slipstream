/* Slipstream picture boards.
   Each picture is a simple silhouette made of basic pieces on a cell grid:
     ['e', cx, cy, rx, ry]          ellipse
     ['r', x, y, w, h]              rectangle
     ['rr', x, y, w, h, r]          rounded rectangle
     ['p', [x1, y1, x2, y2, ...]]   polygon
     ['l', x1, y1, x2, y2, width]   thick line with round ends
   A leading '-' (e.g. '-e') cuts the piece out instead of adding it.
   Pieces are applied in order; a cell is part of the picture when its
   centre falls inside. All drawings are original, generic everyday things. */
(function (global) {
  'use strict';

  const PICTURES = [
    { id: 'heart', name: 'Heart', size: [16, 15], parts: [['e', 4.6, 4.8, 4.4, 4.4], ['e', 11.4, 4.8, 4.4, 4.4], ['p', [0.4, 6, 15.6, 6, 8, 14.8]]] },
    { id: 'fish', name: 'Fish', size: [20, 13], parts: [['e', 8.5, 6.5, 8, 5.2], ['p', [14, 6.5, 19.8, 1, 19.8, 12]], ['-e', 4.5, 5, 1, 1]] },
    { id: 'mushroom', name: 'Mushroom', size: [16, 16], parts: [['e', 8, 6.5, 7.8, 6.2], ['-r', 0, 6.6, 16, 10], ['rr', 5, 6, 6, 9.6, 1.5]] },
    { id: 'house', name: 'House', size: [16, 17], parts: [['p', [0.2, 8, 8, 0.6, 15.8, 8]], ['r', 2, 7.5, 12, 9.3], ['r', 11, 1.5, 2.2, 5], ['-r', 6.5, 11.5, 3, 5.4]] },
    { id: 'apple', name: 'Apple', size: [16, 18], parts: [['e', 5.6, 10.4, 5.3, 6.4], ['e', 10.4, 10.4, 5.3, 6.4], ['-e', 8, 17.6, 1.6, 1.2], ['l', 8, 4.6, 9.2, 0.6, 1.4], ['e', 11.6, 2.6, 2.4, 1.3]] },
    { id: 'star', name: 'Star', size: [18, 17], parts: [['p', [9, 0.2, 11.2, 6.2, 17.8, 6.4, 12.6, 10.4, 14.5, 16.8, 9, 13, 3.5, 16.8, 5.4, 10.4, 0.2, 6.4, 6.8, 6.2]]] },
    { id: 'tree', name: 'Pine tree', size: [16, 20], parts: [['p', [8, 0.2, 13.4, 6.8, 2.6, 6.8]], ['p', [8, 3.6, 15, 11.6, 1, 11.6]], ['p', [8, 7.6, 15.8, 16.2, 0.2, 16.2]], ['r', 6.4, 15.6, 3.2, 4.4]] },
    { id: 'cat', name: 'Cat', size: [16, 20], parts: [['e', 7.5, 13.6, 5.6, 6]], },
    { id: 'umbrella', name: 'Umbrella', size: [20, 19], parts: [['e', 10, 8, 9.8, 7.6], ['-r', 0, 8.2, 20, 12], ['l', 10, 7, 10, 16.4, 1.6], ['l', 10, 16.4, 7.2, 16.6, 1.6], ['l', 7.2, 16.6, 6.8, 14.6, 1.6]] },
    { id: 'rocket', name: 'Rocket', size: [16, 22], parts: [['e', 8, 9, 3.6, 8.8], ['r', 4.4, 9, 7.2, 8], ['p', [4.6, 11, 0.6, 18.6, 4.6, 17]], ['p', [11.4, 11, 15.4, 18.6, 11.4, 17]], ['p', [5.6, 17, 10.4, 17, 8, 21.8]], ['-e', 8, 8, 1.5, 1.5]] },
    { id: 'bell', name: 'Bell', size: [18, 18], parts: [['e', 9, 6.5, 5.6, 5.8], ['p', [3.4, 6.5, 14.6, 6.5, 17.2, 14.2, 0.8, 14.2]], ['e', 9, 15.6, 2, 2], ['r', 8, 0, 2, 1.6]] },
    { id: 'moon', name: 'Crescent moon', size: [16, 18], parts: [['e', 8, 9, 7.8, 8.8], ['-e', 11.6, 7.2, 6.8, 7.8]] },
    { id: 'anchor', name: 'Anchor', size: [18, 21], parts: [['e', 9, 2.6, 2.6, 2.6], ['-e', 9, 2.6, 1, 1], ['l', 9, 4.6, 9, 19.4, 2], ['l', 4.4, 7.2, 13.6, 7.2, 1.8], ['l', 1.4, 13.2, 3.8, 17.4, 2], ['l', 3.8, 17.4, 9, 19.6, 2], ['l', 16.6, 13.2, 14.2, 17.4, 2], ['l', 14.2, 17.4, 9, 19.6, 2], ['p', [0.2, 14.4, 1.4, 11.2, 3.2, 13.6]], ['p', [17.8, 14.4, 16.6, 11.2, 14.8, 13.6]]] },
    { id: 'snowman', name: 'Snowman', size: [22, 24], parts: [['e', 11, 18.2, 6.6, 5.6], ['e', 11, 10.6, 4.6, 3.8], ['e', 11, 5, 3.2, 3], ['r', 7, 1.6, 8, 1.2], ['r', 8.6, 0, 4.8, 2.2], ['l', 6.8, 10, 1.4, 6.4, 1.2], ['l', 15.2, 10, 20.6, 6.4, 1.2]] },
    { id: 'cupcake', name: 'Cupcake', size: [18, 20], parts: [['e', 9, 8.6, 8.6, 3.8], ['e', 9, 5.6, 5.8, 3], ['e', 9, 3, 3.2, 2.2], ['e', 9, 0.9, 1.1, 1], ['p', [3, 11, 15, 11, 13.2, 19.8, 4.8, 19.8]]] },
    { id: 'icecream', name: 'Ice cream', size: [16, 22], parts: [['e', 8, 6.2, 7.4, 5.4], ['e', 8, 2.2, 3, 2], ['p', [3.4, 10.2, 12.6, 10.2, 8, 21.8]]] },
    { id: 'turtle', name: 'Turtle', size: [22, 15], parts: [['e', 10.4, 7.6, 7.4, 5.8], ['-r', 0, 9.2, 22, 6], ['r', 3, 8.6, 15, 2.4], ['e', 19.4, 8.2, 2.6, 2.2], ['e', 5.6, 12, 1.8, 2], ['e', 15, 12, 1.8, 2], ['p', [3.2, 9.2, 0.2, 10.8, 3.2, 10.8]]] },
    { id: 'butterfly', name: 'Butterfly', size: [22, 18], parts: [['e', 5.8, 5.6, 5.4, 5.2], ['e', 16.2, 5.6, 5.4, 5.2], ['e', 6.6, 13, 4, 4.2], ['e', 15.4, 13, 4, 4.2], ['rr', 10, 2.4, 2, 15, 1], ['l', 10.6, 2.6, 8.6, 0.4, 1], ['l', 11.4, 2.6, 13.4, 0.4, 1]] },
    { id: 'whale', name: 'Whale', size: [24, 15], parts: [['e', 10, 9, 9.6, 5.6], ['-r', 0, 12.6, 24, 3], ['p', [17, 10.4, 23.8, 5.2, 23.8, 13]], ['l', 21, 3, 21, 6, 1], ['e', 21, 2.2, 2.2, 1.2]] },
    { id: 'teapot', name: 'Teapot', size: [22, 16], parts: [['e', 10.6, 9.8, 6.4, 5.6], ['e', 10.6, 3.4, 3.4, 1.6], ['r', 10, 0.4, 1.2, 2], ['l', 16.4, 9.6, 21, 5, 2], ['e', 3.6, 9.8, 3, 3.8], ['-e', 3.8, 9.8, 1.4, 2.2]] },
    { id: 'owl', name: 'Owl', size: [16, 20], parts: [['e', 8, 12, 6.6, 7.6], ['p', [1.6, 3.2, 4.8, 6.4, 1.6, 7.6]], ['p', [14.4, 3.2, 11.2, 6.4, 14.4, 7.6]], ['e', 8, 7, 6.2, 4.4], ['-e', 5.4, 7.6, 1.4, 1.4], ['-e', 10.6, 7.6, 1.4, 1.4], ['r', 4.4, 19, 2.4, 1], ['r', 9.2, 19, 2.4, 1]] },
    { id: 'rabbit', name: 'Rabbit', size: [16, 22], parts: [['e', 8, 16.4, 5.8, 5.4], ['e', 8, 9.6, 3.8, 3.6], ['e', 5.4, 3.8, 1.3, 4], ['e', 10.6, 3.8, 1.3, 4], ['e', 13.4, 18, 1.8, 1.8]] },
    { id: 'guitar', name: 'Guitar', size: [14, 24], parts: [['e', 7, 19, 6.4, 4.8], ['e', 7, 13.6, 4.6, 3.8], ['-e', 7, 16.4, 1.4, 1.4], ['r', 6, 1.8, 2, 10], ['rr', 5, 0, 4, 3, 1]] },
    { id: 'duck', name: 'Duck', size: [20, 16], parts: [['e', 9.6, 11, 8, 4.6], ['p', [1.4, 9.6, 0.2, 6.6, 4, 9]], ['e', 14.4, 5, 3.4, 3.4], ['p', [16.8, 4, 20, 5.2, 16.8, 6.6]], ['-e', 14.8, 4, 0.8, 0.8]] },
    { id: 'sailboat', name: 'Sailboat', size: [20, 20], parts: [['p', [9, 0.2, 9, 14.6, 1.8, 14.6]], ['p', [11, 2.6, 11, 14.6, 17.8, 14.6]], ['p', [0.4, 14.2, 19.6, 14.2, 16.4, 19.4, 3.6, 19.4]]] },
    { id: 'key', name: 'Key', size: [22, 12], parts: [['e', 4.6, 6, 4.4, 4.4], ['-e', 4.6, 6, 1.8, 1.8], ['r', 8, 4.8, 13.6, 2.4], ['r', 14.2, 7, 2, 3.4], ['r', 18.4, 7, 2, 4.2]] },
    { id: 'crown', name: 'Crown', size: [20, 15], parts: [['p', [0.4, 3, 5.2, 8, 10, 0.6, 14.8, 8, 19.6, 3, 18, 12, 2, 12]], ['r', 2, 11.4, 16, 3.4], ['e', 0.8, 2.4, 1, 1], ['e', 10, 0.8, 1, 1], ['e', 19.2, 2.4, 1, 1]] },
    { id: 'lightbulb', name: 'Light bulb', size: [16, 21], parts: [['e', 8, 7.4, 7, 7.2], ['p', [3, 11.4, 13, 11.4, 11, 15.6, 5, 15.6]], ['rr', 5, 15.2, 6, 4, 1], ['r', 6.6, 19, 2.8, 2]] },
    { id: 'cactus', name: 'Cactus', size: [18, 21], parts: [['rr', 6.6, 0.4, 4.8, 20.6, 2.4], ['rr', 1, 5, 3.6, 8, 1.8], ['l', 2.8, 11.2, 7, 11.2, 3], ['rr', 13.4, 3, 3.6, 7.4, 1.8], ['l', 15.2, 8.6, 11, 8.6, 3]] },
    { id: 'balloon', name: 'Hot air balloon', size: [18, 22], parts: [['e', 9, 7.6, 8.6, 7.6], ['p', [1.4, 10, 16.6, 10, 11.8, 16, 6.2, 16]], ['l', 6.6, 15.4, 7.2, 18, 0.9], ['l', 11.4, 15.4, 10.8, 18, 0.9], ['rr', 6.2, 18, 5.6, 3.8, 0.8]] },
    { id: 'elephant', name: 'Elephant', size: [24, 18], parts: [['e', 11.6, 8.4, 8, 6], ['rr', 4.6, 11, 3.4, 6.8, 1], ['rr', 9.4, 11, 3.4, 6.8, 1], ['rr', 13.6, 11, 3.4, 6.8, 1], ['e', 19.2, 6.4, 3.8, 3.8], ['e', 17.2, 6.6, 3, 4.2], ['l', 22, 7.4, 22.6, 14.6, 2], ['l', 22.6, 14.6, 21.2, 16.4, 1.8], ['l', 3.8, 7.6, 1.6, 12.4, 0.9]] },
    { id: 'lighthouse', name: 'Lighthouse', size: [14, 24], parts: [['p', [3.6, 22, 10.4, 22, 9, 8, 5, 8]], ['r', 4.4, 4, 5.2, 4], ['p', [3.6, 4.4, 10.4, 4.4, 7, 0.4]], ['r', 3.2, 7.4, 7.6, 1.2], ['r', 1, 21.6, 12, 2.4]] },
  ];
  // The cat: body, head, ears and a curling tail.
  PICTURES.find((p) => p.id === 'cat').parts.push(
    ['e', 7.5, 6.2, 4.4, 4], ['p', [3.4, 4.4, 3.6, 0.2, 6.6, 2.8]], ['p', [11.6, 4.4, 11.4, 0.2, 8.4, 2.8]],
    ['l', 12.6, 17.8, 14.8, 14, 1.6], ['l', 14.8, 14, 14.4, 9.4, 1.6]);

  /* ---- drawing to cells ---- */
  function inPoly(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
      const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }
  function hit(part, x, y) {
    const k = part[0].replace('-', '');
    if (k === 'e') return ((x - part[1]) / part[3]) ** 2 + ((y - part[2]) / part[4]) ** 2 <= 1;
    if (k === 'r') return x >= part[1] && x <= part[1] + part[3] && y >= part[2] && y <= part[2] + part[4];
    if (k === 'rr') {
      const [, rx, ry, w, h, r] = part;
      if (x < rx || x > rx + w || y < ry || y > ry + h) return false;
      const cx = Math.max(rx + r, Math.min(rx + w - r, x)), cy = Math.max(ry + r, Math.min(ry + h - r, y));
      return Math.hypot(x - cx, y - cy) <= r;
    }
    if (k === 'p') return inPoly(x, y, part[1]);
    if (k === 'l') return segDist(x, y, part[1], part[2], part[3], part[4]) <= part[5] / 2;
    return false;
  }
  /** Cell mask for a picture, scaled by `scale` (1 = its own size). Keeps the
      largest connected piece so every board is one region. */
  function pictureMask(pic, scale) {
    scale = scale || 1;
    const cols = Math.round(pic.size[0] * scale), rows = Math.round(pic.size[1] * scale);
    const mask = new Array(cols * rows).fill(0);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const px = (x + 0.5) / scale, py = (y + 0.5) / scale;
      let on = false;
      for (const part of pic.parts) if (hit(part, px, py)) on = part[0][0] !== '-';
      mask[y * cols + x] = on ? 1 : 0;
    }
    // keep the biggest 4-connected region
    const seen = new Uint8Array(cols * rows);
    let best = [];
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || seen[i]) continue;
      const comp = [], stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const c = stack.pop(); comp.push(c);
        const x = c % cols, y = (c / cols) | 0;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const n = ny * cols + nx;
          if (mask[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
        }
      }
      if (comp.length > best.length) best = comp;
    }
    const out = new Array(cols * rows).fill(0);
    for (const c of best) out[c] = 1;
    return { cols, rows, mask: out, cells: best.length };
  }

  /* Picture k (0-based) in gallery order: later pictures are drawn bigger
     and use harder arrow settings, so the collection ramps up gently. */
  const PICTURE_VERSION = 'p1';
  function pictureLevel(k) {
    const pic = PICTURES[k];
    if (!pic) return null;
    const f = PICTURES.length > 1 ? k / (PICTURES.length - 1) : 0;
    const diff = k < 8 ? 'medium' : k < 20 ? 'hard' : 'expert';
    // Scale each drawing to a target number of squares, so sizes climb smoothly.
    const target = 230 + 430 * f;
    const base = pictureMask(pic, 1).cells;
    const scale = Math.max(1.2, Math.min(2.2, Math.sqrt(target / base)));
    return { k, id: pic.id, name: pic.name, diff, scale, seed: 'picture|' + PICTURE_VERSION + '|' + pic.id };
  }
  /** Build picture k's board with the flat engine (passed in so this file has no load order). */
  function picturePuzzle(E, k) {
    const L = pictureLevel(k);
    const m = pictureMask(PICTURES[k], L.scale);
    const p = E.generate({ seed: L.seed, diff: L.diff, t: 0.5, tight: true, mask: m });
    p.picture = L;
    return p;
  }

  const api = { PICTURES, PICTURE_VERSION, pictureMask, pictureLevel, picturePuzzle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SlipPictures = api;
})(typeof window !== 'undefined' ? window : globalThis);
