// ---------------------------------------------------------------------------
// terrain.js — procedural island heightfield, its mesh, water, and picking.
// ---------------------------------------------------------------------------
(function (BW) {
  'use strict';
  const { Noise, clamp, smoothstep, lerp } = BW;

  class Terrain {
    // sites: [{x,z,r}] areas flattened for towns.
    constructor(seed, size, sites) {
      this.seed = seed;
      this.size = size;
      this.res = Math.round(size / 2);      // 2-unit cells
      this.cell = size / this.res;
      this.half = size / 2;
      this.heights = new Float32Array((this.res + 1) * (this.res + 1));
      this.noise = new Noise(seed);
      this.sites = sites || [];
      this._generate();
      this._buildMesh();
    }

    _rawHeight(x, z) {
      const n = this.noise;
      const nx = x / this.size, nz = z / this.size;
      // Large-scale island shape, distorted radius so the coast is not a circle.
      const ang = Math.atan2(nz, nx);
      const wob = 0.12 * n.fbm(Math.cos(ang) * 2.1 + 7.3, Math.sin(ang) * 2.1 + 3.1, 3);
      const r = Math.hypot(nx, nz) / (0.46 + wob);
      const mask = 1 - smoothstep(0.55, 1.0, r);
      let h = n.fbm(nx * 3.2 + 11, nz * 3.2 + 5, 6, 2.1, 0.5);  // -1..1
      h = (h + 0.35) * 22;
      const ridge = 1 - Math.abs(n.fbm(nx * 6 + 40, nz * 6 + 40, 4));
      h += ridge * ridge * 22 * smoothstep(0.15, 0.75, mask);
      h = h * mask - 6 * (1 - mask);
      return h;
    }

    _generate() {
      const R = this.res;
      for (let j = 0; j <= R; j++) {
        for (let i = 0; i <= R; i++) {
          const x = i * this.cell - this.half, z = j * this.cell - this.half;
          let h = this._rawHeight(x, z);
          // Flatten town sites to a gentle plateau (blend towards site height).
          for (const s of this.sites) {
            const d = Math.hypot(x - s.x, z - s.z);
            if (d < s.r) {
              const t = smoothstep(s.r * 0.55, s.r, d);
              const base = Math.max(6, s.h !== undefined ? s.h : 8);
              h = lerp(base + this.noise.fbm(x * 0.05, z * 0.05, 2) * 0.8, h, t);
            }
          }
          this.heights[j * (R + 1) + i] = h;
        }
      }
      // Make sure the site centers are well above water.
      for (const s of this.sites) s.h = this.heightAt(s.x, s.z);
    }

    heightAt(x, z) {
      const R = this.res;
      const fx = clamp((x + this.half) / this.cell, 0, R - 0.0001);
      const fz = clamp((z + this.half) / this.cell, 0, R - 0.0001);
      const i = Math.floor(fx), j = Math.floor(fz);
      const tx = fx - i, tz = fz - j;
      const H = this.heights, W = R + 1;
      const a = H[j * W + i], b = H[j * W + i + 1], c = H[(j + 1) * W + i], d = H[(j + 1) * W + i + 1];
      return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
    }

    normalAt(x, z) {
      const e = 0.8;
      const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
      const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
      const n = new THREE.Vector3(hl - hr, 2 * e, hd - hu);
      return n.normalize();
    }

    slopeAt(x, z) {
      const e = 1.2;
      const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
      const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
      return Math.hypot(dx, dz) / (2 * e);
    }

    isLand(x, z) { return this.heightAt(x, z) > 0.6; }
    inBounds(x, z) { return Math.abs(x) < this.half - 2 && Math.abs(z) < this.half - 2; }

    // Intersect a ray with the heightfield by marching, then bisecting.
    raycast(origin, dir, maxDist = 900) {
      const step = 1.5;
      let t = 0;
      let px = origin.x, py = origin.y, pz = origin.z;
      let prevAbove = py > this.heightAt(px, pz);
      if (!prevAbove) return null;
      let lastT = 0;
      while (t < maxDist) {
        t += step;
        px = origin.x + dir.x * t; py = origin.y + dir.y * t; pz = origin.z + dir.z * t;
        if (!this.inBoundsLoose(px, pz)) { if (py < -20) return null; lastT = t; continue; }
        const h = Math.max(this.heightAt(px, pz), 0); // water plane counts as a surface
        if (py <= h) {
          let lo = lastT, hi = t;
          for (let k = 0; k < 10; k++) {
            const m = (lo + hi) / 2;
            const mx = origin.x + dir.x * m, my = origin.y + dir.y * m, mz = origin.z + dir.z * m;
            if (my <= Math.max(this.heightAt(mx, mz), 0)) hi = m; else lo = m;
          }
          const fx = origin.x + dir.x * hi, fz = origin.z + dir.z * hi;
          return new THREE.Vector3(fx, Math.max(this.heightAt(fx, fz), 0), fz);
        }
        lastT = t;
      }
      return null;
    }
    inBoundsLoose(x, z) { return Math.abs(x) < this.half * 1.6 && Math.abs(z) < this.half * 1.6; }

    // ------------------------------------------------------------ chunks
    // The mesh is split into chunks built lazily around the camera, at three
    // levels of detail. Each chunk carries a skirt so LOD seams do not show.
    _buildMesh() {
      this.CS = 32;                                   // cells per chunk side
      this.nChunks = Math.ceil(this.res / this.CS);
      this.chunks = new Map();
      this.colorVersion = 1;
      this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      this.group = new THREE.Group();
      const wgeo = new THREE.PlaneGeometry(this.size * 3, this.size * 3, 1, 1);
      wgeo.rotateX(-Math.PI / 2);
      this.waterMat = new THREE.MeshPhongMaterial({ color: 0x2a6fa8, transparent: true, opacity: 0.78, shininess: 90, specular: 0x88bbff });
      this.water = new THREE.Mesh(wgeo, this.waterMat);
      this.water.name = 'water';
      this.group.add(this.water);
      this.setPalette(0, 'summer');
      this.buildBudget = 6;
    }

    setPalette(alignment, season = 'summer') {
      const good = clamp(alignment, 0, 1), evil = clamp(-alignment, 0, 1);
      const P = this.palette = {};
      P.grassA = new THREE.Color(0x4f8a3a).lerp(new THREE.Color(0x6fc55a), good * 0.6).lerp(new THREE.Color(0x6a5a3a), evil * 0.75);
      P.grassB = new THREE.Color(0x3d7031).lerp(new THREE.Color(0x4fa84a), good * 0.6).lerp(new THREE.Color(0x4a3a2c), evil * 0.75);
      if (season === 'autumn') { P.grassA.lerp(new THREE.Color(0xb08a3a), 0.35); P.grassB.lerp(new THREE.Color(0x8a6a2a), 0.35); }
      if (season === 'winter') { P.grassA.lerp(new THREE.Color(0xe8eef2), 0.75); P.grassB.lerp(new THREE.Color(0xd0dae2), 0.75); }
      if (season === 'spring') { P.grassA.lerp(new THREE.Color(0x7fd46a), 0.25); P.grassB.lerp(new THREE.Color(0x5fb85a), 0.25); }
      P.sand = new THREE.Color(0xd8c98a).lerp(new THREE.Color(0x8a7a60), evil * 0.5);
      P.rock = new THREE.Color(0x7a746a).lerp(new THREE.Color(0x5a3c3c), evil * 0.6);
      P.snow = new THREE.Color(0xf4f4f8);
      P.deep = new THREE.Color(0x2b4a5a);
      P.snowLine = season === 'winter' ? 12 : 34;
      this.colorVersion++;
    }

    // Kept for callers: repaint everything for a new alignment/season.
    recolor(alignment, season) { this.setPalette(alignment, season || this.season || 'summer'); if (season) this.season = season; }

    _vertexColor(x, z, h, c) {
      const P = this.palette, n = this.noise;
      const slope = this.slopeAt(x, z);
      const v = n.fbm(x * 0.08, z * 0.08, 2) * 0.5 + 0.5;
      c.copy(P.grassA).lerp(P.grassB, v);
      if (h < 2.5) c.lerp(P.sand, 1 - smoothstep(0.2, 2.5, h));
      if (slope > 0.7) c.lerp(P.rock, smoothstep(0.7, 1.3, slope));
      if (h > P.snowLine) c.lerp(P.snow, smoothstep(P.snowLine, P.snowLine + 10, h));
      if (h < 0) c.lerp(P.deep, smoothstep(0, -6, h));
    }

    _buildChunk(ci, cj, lod) {
      const step = 1 << lod, CS = this.CS, R = this.res, W = R + 1;
      const i0 = ci * CS, j0 = cj * CS;
      const i1 = Math.min(R, i0 + CS), j1 = Math.min(R, j0 + CS);
      const cols = Math.ceil((i1 - i0) / step) + 1, rows = Math.ceil((j1 - j0) / step) + 1;
      const nv = cols * rows, skirtN = 2 * cols + 2 * rows;
      const pos = new Float32Array((nv + skirtN) * 3), col = new Float32Array((nv + skirtN) * 3), nor = new Float32Array((nv + skirtN) * 3);
      const c = new THREE.Color();
      const vi = (r, k) => r * cols + k;
      let p = 0;
      for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
        const i = Math.min(i1, i0 + k * step), j = Math.min(j1, j0 + r * step);
        const x = i * this.cell - this.half, z = j * this.cell - this.half;
        const h = this.heights[j * W + i];
        pos[p * 3] = x; pos[p * 3 + 1] = h; pos[p * 3 + 2] = z;
        const nrm = this.normalAt(x, z); nor[p * 3] = nrm.x; nor[p * 3 + 1] = nrm.y; nor[p * 3 + 2] = nrm.z;
        this._vertexColor(x, z, h, c); col[p * 3] = c.r; col[p * 3 + 1] = c.g; col[p * 3 + 2] = c.b;
        p++;
      }
      const idx = [];
      for (let r = 0; r < rows - 1; r++) for (let k = 0; k < cols - 1; k++) {
        const a = vi(r, k), b = vi(r, k + 1), d = vi(r + 1, k), e = vi(r + 1, k + 1);
        idx.push(a, d, b, b, d, e);
      }
      // Skirt: duplicate edge vertices dropped by 6 units.
      const edge = [];
      for (let k = 0; k < cols; k++) edge.push(vi(0, k));
      for (let r = 1; r < rows; r++) edge.push(vi(r, cols - 1));
      for (let k = cols - 2; k >= 0; k--) edge.push(vi(rows - 1, k));
      for (let r = rows - 2; r >= 1; r--) edge.push(vi(r, 0));
      const sBase = nv;
      for (let e = 0; e < edge.length; e++) {
        const src = edge[e], dst = sBase + e;
        pos[dst * 3] = pos[src * 3]; pos[dst * 3 + 1] = pos[src * 3 + 1] - 6; pos[dst * 3 + 2] = pos[src * 3 + 2];
        col[dst * 3] = col[src * 3] * 0.8; col[dst * 3 + 1] = col[src * 3 + 1] * 0.8; col[dst * 3 + 2] = col[src * 3 + 2] * 0.8;
        nor[dst * 3] = nor[src * 3]; nor[dst * 3 + 1] = nor[src * 3 + 1]; nor[dst * 3 + 2] = nor[src * 3 + 2];
      }
      for (let e = 0; e < edge.length; e++) {
        const a = edge[e], b = edge[(e + 1) % edge.length], sa = sBase + e, sb = sBase + (e + 1) % edge.length;
        idx.push(a, sa, b, b, sa, sb);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.mat);
      mesh.receiveShadow = true; mesh.name = 'terrain';
      return mesh;
    }

    // Called every frame: ensure chunks near the camera exist at the right LOD.
    updateChunks(camX, camZ, camY) {
      let built = 0;
      const CSw = this.CS * this.cell;
      const far = 750 + camY * 0.5;
      for (let cj = 0; cj < this.nChunks; cj++) for (let ci = 0; ci < this.nChunks; ci++) {
        const cx = (ci + 0.5) * CSw - this.half, cz = (cj + 0.5) * CSw - this.half;
        const d = Math.hypot(cx - camX, cz - camZ, camY * 0.6);
        const key = cj * this.nChunks + ci;
        const cur = this.chunks.get(key);
        if (d > far) { if (cur) { this.group.remove(cur.mesh); cur.mesh.geometry.dispose(); this.chunks.delete(key); } continue; }
        const lod = d < 120 ? 0 : d < 300 ? 1 : 2;
        if (cur && cur.lod === lod && cur.version === this.colorVersion) continue;
        if (built >= this.buildBudget) continue;
        if (cur) { this.group.remove(cur.mesh); cur.mesh.geometry.dispose(); }
        const mesh = this._buildChunk(ci, cj, lod);
        this.group.add(mesh);
        this.chunks.set(key, { mesh, lod, version: this.colorVersion });
        built++;
      }
    }

    // Force all visible chunks to rebuild (after terraforming).
    invalidateArea(x, z, r) {
      const CSw = this.CS * this.cell;
      for (const [key, ch] of this.chunks) {
        const ci = key % this.nChunks, cj = Math.floor(key / this.nChunks);
        const cx = (ci + 0.5) * CSw - this.half, cz = (cj + 0.5) * CSw - this.half;
        if (Math.hypot(cx - x, cz - z) < r + CSw) ch.version = -1;
      }
    }

    dispose() { for (const ch of this.chunks.values()) ch.mesh.geometry.dispose(); this.chunks.clear(); this.mat.dispose(); this.water.geometry.dispose(); this.waterMat.dispose(); }
  }

  BW.Terrain = Terrain;
})(window.BW);
