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
      this.res = 160;                       // cells per side
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

    _buildMesh() {
      const R = this.res, W = R + 1;
      const geo = new THREE.PlaneGeometry(this.size, this.size, R, R);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      for (let j = 0; j <= R; j++) for (let i = 0; i <= R; i++) {
        const idx = j * W + i;
        pos.setY(idx, this.heights[idx]);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      const colors = new Float32Array(W * W * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      this.geo = geo;
      this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      this.mesh = new THREE.Mesh(geo, this.mat);
      this.mesh.receiveShadow = true;
      this.mesh.castShadow = false;
      this.mesh.name = 'terrain';
      this.recolor(0);

      // Water
      const wgeo = new THREE.PlaneGeometry(this.size * 3, this.size * 3, 1, 1);
      wgeo.rotateX(-Math.PI / 2);
      this.waterMat = new THREE.MeshPhongMaterial({ color: 0x2a6fa8, transparent: true, opacity: 0.78, shininess: 90, specular: 0x88bbff });
      this.water = new THREE.Mesh(wgeo, this.waterMat);
      this.water.position.y = 0;
      this.water.name = 'water';
      this.group = new THREE.Group();
      this.group.add(this.mesh, this.water);
    }

    // Vertex colouring: sand/grass/rock/snow, tinted by the god's alignment.
    recolor(alignment) {
      const R = this.res, W = R + 1;
      const col = this.geo.attributes.color;
      const n = this.noise;
      const good = clamp(alignment, 0, 1), evil = clamp(-alignment, 0, 1);
      const c = new THREE.Color();
      const grassA = new THREE.Color(0x4f8a3a).lerp(new THREE.Color(0x6fc55a), good * 0.6).lerp(new THREE.Color(0x6a5a3a), evil * 0.75);
      const grassB = new THREE.Color(0x3d7031).lerp(new THREE.Color(0x4fa84a), good * 0.6).lerp(new THREE.Color(0x4a3a2c), evil * 0.75);
      const sand = new THREE.Color(0xd8c98a).lerp(new THREE.Color(0x8a7a60), evil * 0.5);
      const rock = new THREE.Color(0x7a746a).lerp(new THREE.Color(0x5a3c3c), evil * 0.6);
      const snow = new THREE.Color(0xf4f4f8);
      for (let j = 0; j <= R; j++) for (let i = 0; i <= R; i++) {
        const idx = j * W + i;
        const x = i * this.cell - this.half, z = j * this.cell - this.half;
        const h = this.heights[idx];
        const slope = this.slopeAt(x, z);
        const v = n.fbm(x * 0.08, z * 0.08, 2) * 0.5 + 0.5;
        c.copy(grassA).lerp(grassB, v);
        if (h < 2.5) c.lerp(sand, 1 - smoothstep(0.2, 2.5, h));
        if (slope > 0.7) c.lerp(rock, smoothstep(0.7, 1.3, slope));
        if (h > 34) c.lerp(snow, smoothstep(34, 44, h));
        if (h < 0) c.lerp(new THREE.Color(0x2b4a5a), smoothstep(0, -6, h));
        col.setXYZ(idx, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
    }

    dispose() { this.geo.dispose(); this.mat.dispose(); this.water.geometry.dispose(); this.waterMat.dispose(); }
  }

  BW.Terrain = Terrain;
})(window.BW);
