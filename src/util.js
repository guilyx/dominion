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
