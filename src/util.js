// ---------------------------------------------------------------------------
// util.js — small helpers shared by every module. Everything hangs off BW.
// ---------------------------------------------------------------------------
window.BW = window.BW || {};

(function (BW) {
  'use strict';

  // Deterministic PRNG (mulberry32) so a land regenerates identically from a seed.
  class RNG {
    constructor(seed) { this.s = (seed >>> 0) || 1; }
    next() {
      let t = (this.s += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    range(a, b) { return a + (b - a) * this.next(); }
    int(a, b) { return Math.floor(this.range(a, b + 1)); }
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
    chance(p) { return this.next() < p; }
  }

  // Value noise with fBm. Cheap, seedable, good enough for island terrain.
  class Noise {
    constructor(seed) {
      const rng = new RNG(seed);
      this.perm = new Uint8Array(512);
      const p = [];
      for (let i = 0; i < 256; i++) p[i] = i;
      for (let i = 255; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
      for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
      this.grad = new Float32Array(256);
      for (let i = 0; i < 256; i++) this.grad[i] = rng.next() * 2 - 1;
    }
    _v(ix, iy) { return this.grad[this.perm[(ix & 255) + this.perm[iy & 255]]]; }
    noise(x, y) {
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = x - x0, fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = this._v(x0, y0), b = this._v(x0 + 1, y0);
      const c = this._v(x0, y0 + 1), d = this._v(x0 + 1, y0 + 1);
      return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
    }
    fbm(x, y, oct = 5, lac = 2.0, gain = 0.5) {
      let sum = 0, amp = 1, f = 1, norm = 0;
      for (let i = 0; i < oct; i++) { sum += this.noise(x * f, y * f) * amp; norm += amp; amp *= gain; f *= lac; }
      return sum / norm;
    }
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  const dist2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
  const angleLerp = (a, b, t) => {
    let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    return a + d * t;
  };
  const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : Math.floor(n).toString());

  let _id = 1;
  const uid = () => _id++;
  const setUidFloor = (n) => { if (n >= _id) _id = n + 1; };

  class Emitter {
    constructor() { this.h = {}; }
    on(ev, fn) { (this.h[ev] = this.h[ev] || []).push(fn); return this; }
    emit(ev, ...a) { (this.h[ev] || []).forEach((f) => f(...a)); }
  }

  Object.assign(BW, { RNG, Noise, clamp, lerp, smoothstep, dist, dist2, angleLerp, fmt, uid, setUidFloor, Emitter });
})(window.BW);

// ---------------------------------------------------------------------------
// Spatial hash for fast neighbourhood queries, and a grid A* pathfinder.
// ---------------------------------------------------------------------------
(function (BW) {
  'use strict';

  // Global seeded random: deterministic once a world exists (replays, seeds).
  BW.rand = () => (BW.G && BW.G.rng ? BW.G.rng.next() : Math.random());

  class Grid {
    constructor(cell = 8) { this.cell = cell; this.map = new Map(); }
    key(cx, cz) { return cx * 73856 + cz; }
    clear() { this.map.clear(); }
    insert(e) {
      const cx = Math.floor(e.x / this.cell), cz = Math.floor(e.z / this.cell);
      const k = this.key(cx, cz);
      let b = this.map.get(k); if (!b) { b = []; this.map.set(k, b); }
      b.push(e);
    }
    rebuild(list) { this.clear(); for (const e of list) this.insert(e); }
    // Visit every entity within radius r of (x,z). fn returns true to stop.
    each(x, z, r, fn) {
      const c = this.cell;
      const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const b = this.map.get(this.key(cx, cz)); if (!b) continue;
        for (let i = 0; i < b.length; i++) if (fn(b[i])) return;
      }
    }
    nearest(x, z, maxD, filter) {
      let best = null, bd = maxD * maxD;
      // Expand in rings so small searches stay small.
      let r = Math.min(maxD, this.cell * 2);
      while (true) {
        this.each(x, z, r, (e) => { if (filter && !filter(e)) return false; const d = (e.x - x) * (e.x - x) + (e.z - z) * (e.z - z); if (d < bd) { bd = d; best = e; } return false; });
        if (best && bd <= r * r) return best;
        if (r >= maxD) return best;
        r = Math.min(maxD, r * 2);
      }
    }
    inRadius(x, z, r, filter) {
      const out = [], rr = r * r;
      this.each(x, z, r, (e) => { if (filter && !filter(e)) return false; const d = (e.x - x) * (e.x - x) + (e.z - z) * (e.z - z); if (d < rr) out.push(e); return false; });
      return out;
    }
  }

  // Binary min-heap keyed on f.
  class Heap {
    constructor() { this.a = []; }
    push(n) { const a = this.a; a.push(n); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
    pop() { const a = this.a; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
    get size() { return this.a.length; }
  }

  // Walkability grid over the island. Cells: 0 = open, 1 = blocked, 2+ = gate owned by (v-2).
  class NavGrid {
    constructor(size, cell = 3) {
      this.size = size; this.cell = cell; this.half = size / 2;
      this.n = Math.ceil(size / cell);
      this.cells = new Uint8Array(this.n * this.n);
      this.cost = new Uint8Array(this.n * this.n).fill(10); // 10 = normal, 6 = road
      this.version = 0;
    }
    toCell(x, z) { return [Math.floor((x + this.half) / this.cell), Math.floor((z + this.half) / this.cell)]; }
    toWorld(cx, cz) { return { x: (cx + 0.5) * this.cell - this.half, z: (cz + 0.5) * this.cell - this.half }; }
    idx(cx, cz) { return cz * this.n + cx; }
    inside(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.n && cz < this.n; }
    // Rebuild from terrain and buildings.
    rebuild(terrain, buildings) {
      const n = this.n;
      for (let cz = 0; cz < n; cz++) for (let cx = 0; cx < n; cx++) {
        const w = this.toWorld(cx, cz);
        this.cells[this.idx(cx, cz)] = terrain.heightAt(w.x, w.z) > 0.5 && terrain.inBounds(w.x, w.z) ? 0 : 1;
        this.cost[this.idx(cx, cz)] = 10;
      }
      for (const b of buildings) this.stamp(b);
      this.version++;
    }
    stamp(b) {
      const def = BW.BUILDINGS[b.kind];
      if (!def) return;
      if (def.walkable && !def.road) return;
      const thin = def.line || b.kind === 'gate';
      const hw = def.w / 2 - (thin ? 0 : 0.2), hd = def.d / 2 - (thin ? 0 : 0.2);
      const [x0, z0] = this.toCell(b.x - hw, b.z - hd), [x1, z1] = this.toCell(b.x + hw, b.z + hd);
      for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
        if (!this.inside(cx, cz)) continue;
        // Big buildings block only cells whose centre is inside them, so the
        // blocked area never spills past the walls; thin walls block any overlap.
        if (!thin && !def.road) { const w = this.toWorld(cx, cz); if (Math.abs(w.x - b.x) > hw || Math.abs(w.z - b.z) > hd) continue; }
        const i = this.idx(cx, cz);
        if (def.road) { this.cost[i] = 6; continue; }
        if (b.kind === 'gate') this.cells[i] = 2 + b.owner;
        else this.cells[i] = 1;
      }
    }
    passable(i, owner) { const v = this.cells[i]; return v === 0 || (v >= 2 && v - 2 === owner); }
    walkableAt(x, z, owner) { const [cx, cz] = this.toCell(x, z); if (!this.inside(cx, cz)) return false; return this.passable(this.idx(cx, cz), owner); }
    // Nearest passable cell to a point (for targets inside buildings).
    nearestOpen(cx, cz, owner) {
      if (this.inside(cx, cz) && this.passable(this.idx(cx, cz), owner)) return [cx, cz];
      for (let r = 1; r < 8; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = cx + dx, z = cz + dz; if (this.inside(x, z) && this.passable(this.idx(x, z), owner)) return [x, z];
      }
      return null;
    }
    // A* from world (ax,az) to (bx,bz). Returns array of {x,z} waypoints (excluding start) or null.
    find(ax, az, bx, bz, owner = -1, maxNodes = 40000) {
      let [sx, sz] = this.toCell(ax, az); let [gx, gz] = this.toCell(bx, bz);
      const s = this.nearestOpen(sx, sz, owner); const g = this.nearestOpen(gx, gz, owner);
      if (!s || !g) return null;
      [sx, sz] = s; [gx, gz] = g;
      if (sx === gx && sz === gz) return [{ x: bx, z: bz }];
      const n = this.n, N = n * n;
      const gScore = this._g || (this._g = new Float32Array(N)); const came = this._came || (this._came = new Int32Array(N)); const closed = this._closed || (this._closed = new Uint8Array(N));
      const stamp = (this._stamp = (this._stamp || 0) + 1); const seen = this._seen || (this._seen = new Uint32Array(N));
      const heap = new Heap();
      const start = this.idx(sx, sz), goal = this.idx(gx, gz);
      const h = (i) => { const cx = i % n, cz = (i / n) | 0; const dx = Math.abs(cx - gx), dz = Math.abs(cz - gz); return (Math.max(dx, dz) + 0.41 * Math.min(dx, dz)) * 10; };
      seen[start] = stamp; gScore[start] = 0; came[start] = -1; closed[start] = 0;
      heap.push({ i: start, f: h(start) });
      let expanded = 0, found = false;
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      while (heap.size) {
        const cur = heap.pop(); const i = cur.i;
        if (seen[i] === stamp && closed[i] === stamp % 255 + 1) continue;
        closed[i] = stamp % 255 + 1;
        if (i === goal) { found = true; break; }
        if (++expanded > maxNodes) break;
        const cx = i % n, cz = (i / n) | 0;
        for (let d = 0; d < 8; d++) {
          const nx = cx + dirs[d][0], nz = cz + dirs[d][1];
          if (!this.inside(nx, nz)) continue;
          const ni = this.idx(nx, nz);
          if (!this.passable(ni, owner)) continue;
          if (d >= 4) { // no corner cutting
            if (!this.passable(this.idx(cx + dirs[d][0], cz), owner) || !this.passable(this.idx(cx, cz + dirs[d][1]), owner)) continue;
          }
          const step = (d >= 4 ? 1.414 : 1) * this.cost[ni];
          const ng = gScore[i] + step;
          if (seen[ni] !== stamp || ng < gScore[ni]) { seen[ni] = stamp; closed[ni] = 0; gScore[ni] = ng; came[ni] = i; heap.push({ i: ni, f: ng + h(ni) }); }
        }
      }
      if (!found) return null;
      const path = [];
      for (let i = goal; i !== -1 && i !== start; i = came[i]) { const w = this.toWorld(i % n, (i / n) | 0); path.push({ x: w.x, z: w.z }); }
      path.reverse();
      path[path.length - 1] = { x: bx, z: bz };
      // String-pull: drop waypoints with a clear straight line (cheap smoothing).
      const out = [];
      let from = { x: ax, z: az };
      for (let k = 0; k < path.length; k++) {
        const next = path[k + 1];
        if (next && this.lineClear(from.x, from.z, next.x, next.z, owner)) continue;
        out.push(path[k]); from = path[k];
      }
      return out;
    }
    lineClear(ax, az, bx, bz, owner) {
      const d = Math.hypot(bx - ax, bz - az); const steps = Math.ceil(d / (this.cell * 0.5));
      for (let i = 1; i < steps; i++) { const t = i / steps; if (!this.walkableAt(ax + (bx - ax) * t, az + (bz - az) * t, owner)) return false; }
      return true;
    }
  }

  // Flat-top hex grid used for building placement (Civilization-style tiles).
  const HEX_R = 5.6, SQ3 = Math.sqrt(3);
  const hex = {
    R: HEX_R,
    center(q, r) { return { x: HEX_R * 1.5 * q, z: HEX_R * SQ3 * (r + q / 2) }; },
    toHex(x, z) {
      const qf = (2 / 3 * x) / HEX_R, rf = (-1 / 3 * x + SQ3 / 3 * z) / HEX_R;
      let q = Math.round(qf), r = Math.round(rf); const s = Math.round(-qf - rf);
      const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s + qf + rf);
      if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
      return { q, r };
    },
    snap(x, z) { const h = hex.toHex(x, z); return Object.assign(hex.center(h.q, h.r), h); },
    key(q, r) { return q * 100003 + r; },
    same(ax, az, bx, bz) { const a = hex.toHex(ax, az), b = hex.toHex(bx, bz); return a.q === b.q && a.r === b.r; },
    corners(cx, cz) { const out = []; for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; out.push({ x: cx + Math.cos(a) * HEX_R, z: cz + Math.sin(a) * HEX_R }); } return out; },
  };

  Object.assign(BW, { Grid, NavGrid, Heap, hex });
})(window.BW);
