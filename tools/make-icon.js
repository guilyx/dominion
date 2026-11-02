// Draws build-assets/icon.png, the application icon electron-builder turns
// into .ico, .icns and Linux icons. Written by hand with zlib so the repo keeps
// its "no external assets, no dependencies" rule.
// Usage: node tools/make-icon.js [size]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = Number(process.argv[2]) || 1024;
const OUT = path.join(__dirname, '..', 'build-assets', 'icon.png');

// ---------------------------------------------------------------- png writer
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function writePng(file, w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;  // 8-bit RGBA
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;  // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// ---------------------------------------------------------------- the drawing
// A gilded stepped temple under a divine orb: the game's own temple silhouette.
const px = Buffer.alloc(SIZE * SIZE * 4);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (edge0, edge1, x) => { const t = clamp01((x - edge0) / (edge1 - edge0)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

const DEEP = [0x0b, 0x0f, 0x18], NAVY = [0x1b, 0x24, 0x3a];
const GOLD = [0xe6, 0xb8, 0x4a], GOLD_HI = [0xff, 0xf1, 0xc0], GOLD_LO = [0x9a, 0x73, 0x1f];

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const u = x / SIZE, v = y / SIZE;              // 0..1
    const cx = u - 0.5, cy = v - 0.5;
    const rad = Math.hypot(cx, cy) * 2;             // 0 at centre, 1 at edge

    // Background: deep navy, lifted towards the middle so the icon reads small.
    let col = [0, 1, 2].map((i) => mix(NAVY[i], DEEP[i], smooth(0.1, 1.05, rad)));

    // Halo behind the temple.
    const halo = Math.exp(-Math.pow((Math.hypot(cx, (v - 0.33)) * 2) / 0.52, 2)) * 0.55;
    col = col.map((c, i) => mix(c, GOLD[i], halo * 0.5));

    // Four stepped tiers, widening towards the base.
    let lit = 0;
    const TIERS = [
      { y0: 0.50, y1: 0.60, half: 0.115 },
      { y0: 0.60, y1: 0.70, half: 0.175 },
      { y0: 0.70, y1: 0.80, half: 0.235 },
      { y0: 0.80, y1: 0.885, half: 0.300 },
    ];
    for (const t of TIERS) {
      if (v >= t.y0 && v < t.y1 && Math.abs(cx) <= t.half) {
        // A shadowed seam between tiers keeps the steps legible at 16px.
        lit = v < t.y0 + 0.014 ? -1 : 1;
        break;
      }
    }
    if (lit) {
      // Light from the upper left, so the block reads as solid.
      const shade = clamp01(0.62 + (0.5 - Math.abs(cx)) * 0.5 - (v - 0.5) * 0.35);
      const g = lit < 0
        ? GOLD_LO.map((c) => c * 0.45)                      // seam: shadowed gold, never grey
        : [0, 1, 2].map((i) => mix(GOLD_LO[i], GOLD_HI[i], shade));
      col = g;
    }

    // The orb above the temple, with its glow.
    const od = Math.hypot(cx, v - 0.295) * 2;
    const orb = 1 - smooth(0.085, 0.10, od);
    const glow = Math.exp(-Math.pow(od / 0.16, 2)) * 0.8;
    col = col.map((c, i) => mix(c, GOLD[i], glow * 0.55));
    col = col.map((c, i) => mix(c, mix(0xff, GOLD_HI[i], smooth(0, 0.09, od)), orb));

    const o = (y * SIZE + x) * 4;
    px[o] = Math.round(clamp01(col[0] / 255) * 255);
    px[o + 1] = Math.round(clamp01(col[1] / 255) * 255);
    px[o + 2] = Math.round(clamp01(col[2] / 255) * 255);
    px[o + 3] = 255;
  }
}

writePng(OUT, SIZE, SIZE, px);
console.log(`wrote ${path.relative(process.cwd(), OUT)} — ${SIZE}x${SIZE}, ${Math.round(fs.statSync(OUT).size / 1024)} KB`);
