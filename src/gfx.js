// ---------------------------------------------------------------------------
// gfx.js — everything that touches THREE directly: renderer, lights, mesh
// kits for buildings/creatures/hand, instanced crowds, and particles.
// ---------------------------------------------------------------------------
(function (BW) {
  'use strict';
  const { clamp, lerp } = BW;

  const matCache = new Map();
  function mat(color, opts) {
    const key = color + '|' + JSON.stringify(opts || {});
    if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial(Object.assign({ color }, opts || {})));
    return matCache.get(key);
  }
  const geoCache = new Map();
  function boxGeo(w, h, d) {
    const key = `b${w},${h},${d}`;
    if (!geoCache.has(key)) geoCache.set(key, new THREE.BoxGeometry(w, h, d));
    return geoCache.get(key);
  }
  function box(w, h, d, color, x = 0, y = 0, z = 0, opts) {
    const m = new THREE.Mesh(boxGeo(w, h, d), mat(color, opts));
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function cone(r, h, seg, color, x = 0, y = 0, z = 0, rotY = 0) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat(color));
    m.position.set(x, y, z); m.rotation.y = rotY;
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function cyl(rt, rb, h, seg, color, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function sphere(r, color, x = 0, y = 0, z = 0, opts) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat(color, opts));
    m.position.set(x, y, z); m.castShadow = true;
    return m;
  }

  // ---------------------------------------------------------------- Renderer
  class Gfx {
    constructor(canvas) {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.outputEncoding = THREE.sRGBEncoding;
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x9fc4e8);
      this.scene.fog = new THREE.Fog(0x9fc4e8, 250, 700);
      this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);
      this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x3f4a2c, 0.55);
      this.sun = new THREE.DirectionalLight(0xfff4e0, 1.35);
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const sc = this.sun.shadow.camera;
      sc.left = -140; sc.right = 140; sc.top = 140; sc.bottom = -140; sc.near = 10; sc.far = 600;
      this.sun.shadow.bias = -0.0015;
      this.sunTarget = new THREE.Object3D();
      this.sun.target = this.sunTarget;
      this.scene.add(this.hemi, this.sun, this.sunTarget);
      this.world = new THREE.Group();
      this.scene.add(this.world);
      this.sky = new Sky(); this.scene.add(this.sky.group);
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }
    resize() {
      const w = window.innerWidth, h = window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    setShadows(on) { this.renderer.shadowMap.enabled = on; this.sun.castShadow = on; this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); }
    // t: 0..1 time of day (0 = midnight, 0.5 = noon), alignment: -1..1
    setDaylight(t, alignment, focus) {
      const ang = t * Math.PI * 2 - Math.PI / 2;
      const elev = Math.sin(ang);
      const day = clamp(elev * 1.6 + 0.35, 0, 1);
      const sx = Math.cos(ang) * 200, sy = Math.max(elev, 0.08) * 220 + 30, sz = 90;
      this.sun.position.set(focus.x + sx, sy, focus.z + sz);
      this.sunTarget.position.set(focus.x, 0, focus.z);
      this.sun.intensity = 0.15 + day * 1.3;
      const evil = clamp(-alignment, 0, 1);
      const skyDay = new THREE.Color(0x9fc4e8).lerp(new THREE.Color(0xb59aa0), evil * 0.6);
      const skyDusk = new THREE.Color(0xe39a5a).lerp(new THREE.Color(0x8a2a2a), evil * 0.6);
      const skyNight = new THREE.Color(0x0e1630);
      const dusk = 1 - Math.abs(elev * 2.2 - 0.3) < 0.7 ? clamp(1 - Math.abs(elev * 3), 0, 1) : 0;
      const sky = skyNight.clone().lerp(skyDay, day).lerp(skyDusk, dusk * 0.6);
      this.scene.background.copy(sky);
      this.scene.fog.color.copy(sky);
      this.sun.color.set(0xfff4e0).lerp(new THREE.Color(0xff9a50), dusk * 0.7);
      this.hemi.intensity = 0.2 + day * 0.4;
      this.hemi.groundColor.set(evil > 0.5 ? 0x5a3a3a : 0x5a6a3a);
      this.sky.update(t, day, dusk, evil, sky, focus, this.camera);
      windowMat.emissiveIntensity = (1 - day) * 1.4;
      this.day = day;
    }
    render() { this.renderer.render(this.scene, this.camera); }
  }

  // ---------------------------------------------------------------- Crowds
  // People, trees, rocks and loose items are drawn as InstancedMeshes.
  class Crowd {
    constructor(parts, max) {
      // parts: [{geo, mat, offsetY, scale?}]
      this.max = max;
      this.meshes = parts.map((p) => {
        const im = new THREE.InstancedMesh(p.geo, p.mat, max);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.castShadow = true; im.receiveShadow = true;
        im.count = 0;
        im.frustumCulled = false;
        im.userData.part = p;
        return im;
      });
      this.parts = parts;
      this.group = new THREE.Group();
      this.meshes.forEach((m) => this.group.add(m));
      this._m = new THREE.Matrix4(); this._base = new THREE.Matrix4();
      this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion();
      this._p = new THREE.Vector3(); this._p2 = new THREE.Vector3();
      this._s = new THREE.Vector3(); this._s2 = new THREE.Vector3();
      this._e = new THREE.Euler(); this._e2 = new THREE.Euler();
      this._c = new THREE.Color();
      this.n = 0;
    }
    begin() { this.n = 0; }
    // Write one instance at index n for all parts. `locals` may carry a per-part
    // local transform {px,py,pz,rx,ry,rz,s} (in the instance's frame); parts
    // without one sit at their default offsetY.
    add(x, y, z, rotY, scale, color, tiltX = 0, partScales = null, locals = null) {
      if (this.n >= this.max) return;
      const i = this.n++;
      this._e.set(tiltX, rotY, 0); this._q.setFromEuler(this._e);
      this._p.set(x, y, z); this._s.set(scale, scale, scale);
      this._base.compose(this._p, this._q, this._s);
      for (let k = 0; k < this.meshes.length; k++) {
        const p = this.parts[k];
        const ps = partScales ? partScales[k] : 1;
        const L = locals && locals[k];
        if (L) { this._e2.set(L.rx || 0, L.ry || 0, L.rz || 0); this._q2.setFromEuler(this._e2); this._p2.set(L.px || 0, L.py === undefined ? p.offsetY : L.py, L.pz || 0); const ls = (L.s || 1) * ps; this._s2.set(ls, ls, ls); }
        else { this._q2.identity(); this._p2.set(0, p.offsetY, 0); this._s2.set(ps, ps, ps); }
        this._m.compose(this._p2, this._q2, this._s2);
        this._m.premultiply(this._base);
        this.meshes[k].setMatrixAt(i, this._m);
        if (p.colored) { this._c.set(color !== undefined ? color : 0xffffff); this.meshes[k].setColorAt(i, this._c); }
      }
    }
    setPartColor(i, k, color) { this.meshes[k].setColorAt(i, this._c.set(color)); }
    end() {
      for (const m of this.meshes) {
        m.count = this.n;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  }

  // Villager parts, in this order (world.js animates them by index):
  // 0 body 1 head 2 carry 3 hair 4 legL 5 legR 6 armL 7 armR 8 tool 9 helmet 10 shield 11 band
  BW.PEOPLE_PARTS = { body: 0, head: 1, carry: 2, hair: 3, legL: 4, legR: 5, armL: 6, armR: 7, tool: 8, helmet: 9, shield: 10, band: 11 };
  function makePeopleCrowd(max) {
    const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
    const body = new THREE.CapsuleGeometry(0.27, 0.42, 3, 8); body.translate(0, 0, 0);
    const head = new THREE.SphereGeometry(0.25, 10, 8);
    const hair = new THREE.SphereGeometry(0.265, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const leg = new THREE.CapsuleGeometry(0.09, 0.3, 2, 6); leg.translate(0, -0.2, 0);
    const arm = new THREE.CapsuleGeometry(0.07, 0.34, 2, 6); arm.translate(0, -0.22, 0);
    const tool = new THREE.BoxGeometry(0.08, 0.9, 0.08); tool.translate(0, -0.2, 0);
    const helmet = new THREE.ConeGeometry(0.3, 0.35, 8);
    const shield = new THREE.BoxGeometry(0.5, 0.6, 0.06);
    const band = new THREE.TorusGeometry(0.25, 0.05, 6, 12);
    const carry = new THREE.BoxGeometry(0.55, 0.38, 0.55);
    return new Crowd([
      { geo: body, mat: lam(0xffffff), offsetY: 0.95, colored: true },
      { geo: head, mat: lam(0xffffff), offsetY: 1.55, colored: true },
      { geo: carry, mat: lam(0xffffff), offsetY: 2.0, colored: true },
      { geo: hair, mat: lam(0xffffff), offsetY: 1.6, colored: true },
      { geo: leg, mat: lam(0xffffff), offsetY: 0.62, colored: true },
      { geo: leg, mat: lam(0xffffff), offsetY: 0.62, colored: true },
      { geo: arm, mat: lam(0xffffff), offsetY: 1.25, colored: true },
      { geo: arm, mat: lam(0xffffff), offsetY: 1.25, colored: true },
      { geo: tool, mat: lam(0xffffff), offsetY: 1.0, colored: true },
      { geo: helmet, mat: lam(0x9a9aa8), offsetY: 1.85, colored: false },
      { geo: shield, mat: lam(0xffffff), offsetY: 1.05, colored: true },
      { geo: band, mat: lam(0xffffff), offsetY: 1.62, colored: true },
    ], max);
  }
  // Floating need icons: one part per need, only one visible per villager.
  BW.NEED_PARTS = ['food', 'home', 'worship', 'safety', 'rest', 'sick', 'cold'];
  function makeIconCrowd(max) {
    const basic = (c) => new THREE.MeshBasicMaterial({ color: c });
    const parts = [
      { geo: new THREE.SphereGeometry(0.22, 8, 6), mat: basic(0xf2c94c) },              // food: grain
      { geo: new THREE.ConeGeometry(0.28, 0.32, 4), mat: basic(0xc8794b) },             // home: roof
      { geo: new THREE.OctahedronGeometry(0.24, 0), mat: basic(0xffffff) },             // worship: star
      { geo: new THREE.TetrahedronGeometry(0.28, 0), mat: basic(0xff4040) },            // safety: warning
      { geo: new THREE.TorusGeometry(0.16, 0.07, 6, 10), mat: basic(0x5d8fff) },        // rest: ring
      { geo: new THREE.IcosahedronGeometry(0.22, 0), mat: basic(0x69d84f) },            // sick
      { geo: new THREE.OctahedronGeometry(0.22, 0), mat: basic(0xbfefff) },             // cold
    ];
    return new Crowd(parts.map((p) => ({ geo: p.geo, mat: p.mat, offsetY: 2.4, colored: false })), max);
  }
  // Two kinds of tree: conifers (stacked cones) and broadleaf (round canopy).
  function makeTreeCrowd(max) {
    const trunk = new THREE.CylinderGeometry(0.2, 0.34, 1.8, 6);
    const c1 = new THREE.ConeGeometry(1.5, 2.6, 7), c2 = new THREE.ConeGeometry(1.1, 2.2, 7);
    return new Crowd([
      { geo: trunk, mat: new THREE.MeshLambertMaterial({ color: 0x4e3620 }), offsetY: 0.9, colored: false },
      { geo: c1, mat: new THREE.MeshLambertMaterial({ color: 0xd8d8d8 }), offsetY: 2.6, colored: true },
      { geo: c2, mat: new THREE.MeshLambertMaterial({ color: 0xffffff }), offsetY: 4.1, colored: true },
    ], max);
  }
  function makeBroadleafCrowd(max) {
    const trunk = new THREE.CylinderGeometry(0.18, 0.32, 2.2, 6);
    const can = new THREE.SphereGeometry(1.7, 9, 7); can.scale(1, 0.85, 1);
    const can2 = new THREE.SphereGeometry(1.1, 8, 6);
    return new Crowd([
      { geo: trunk, mat: new THREE.MeshLambertMaterial({ color: 0x5a4028 }), offsetY: 1.1, colored: false },
      { geo: can, mat: new THREE.MeshLambertMaterial({ color: 0xd0d0d0 }), offsetY: 3.2, colored: true },
      { geo: can2, mat: new THREE.MeshLambertMaterial({ color: 0xffffff }), offsetY: 4.3, colored: true },
    ], max);
  }
  function makeRockCrowd(max) {
    const g = new THREE.DodecahedronGeometry(1.1, 0);
    return new Crowd([{ geo: g, mat: new THREE.MeshLambertMaterial({ color: 0xffffff }), offsetY: 0.6, colored: true }], max);
  }
  function makeItemCrowd(max) {
    const g = new THREE.BoxGeometry(1.2, 0.7, 1.2);
    return new Crowd([{ geo: g, mat: new THREE.MeshLambertMaterial({ color: 0xffffff }), offsetY: 0.35, colored: true }], max);
  }

  // ---------------------------------------------------------------- Buildings
  const ROOF = { 0: 0xb8862b, 1: 0x3f6fd8, 2: 0xc83c3c, 3: 0x9c4fd0, 4: 0x2fa86a };
  const windowMat = new THREE.MeshLambertMaterial({ color: 0xffe2a0, emissive: 0xffb347, emissiveIntensity: 0 });
  function win(w, h, x, y, z, ry = 0) { const m = new THREE.Mesh(boxGeo(w, h, 0.08), windowMat); m.position.set(x, y, z); m.rotation.y = ry; return m; }
  function buildingMesh(b, teamColorIdx, alignment) {
    const g = new THREE.Group();
    const roof = ROOF[teamColorIdx] || 0xb8862b;
    const def = BW.BUILDINGS[b.kind];
    const evil = alignment < -0.3, good = alignment > 0.3;
    switch (b.kind) {
      case 'center': {
        if (b.owner === 0) {
          const stone = evil ? 0x3a2a2e : good ? 0xeeeae0 : 0xcfc8b8;
          g.add(box(9, 1, 9, stone, 0, 0.5, 0));
          g.add(box(7, 0.8, 7, stone, 0, 1.4, 0));
          for (const [px, pz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) g.add(cyl(0.35, 0.4, 5, 8, stone, px, 4.2, pz));
          g.add(box(7.4, 0.6, 7.4, stone, 0, 7, 0));
          g.add(cone(4.6, 3.2, 4, evil ? 0x5a1a1a : good ? 0xf5d76e : 0xb8862b, 0, 8.9, 0, Math.PI / 4));
          const orb = sphere(0.9, evil ? 0xff3322 : 0xffe9a0, 0, 11.4, 0, { emissive: evil ? 0xaa1100 : 0xffcc55, emissiveIntensity: 0.9 });
          orb.name = 'orb'; g.add(orb);
          for (const sx of [-1, 1]) { g.add(cyl(0.08, 0.08, 7, 5, 0x5a3a1a, sx * 5.2, 3.5, 5.2)); const bn = box(0.08, 2.6, 1.3, evil ? 0x7a1a1a : 0xf5d76e, sx * 5.2, 5.4, 5.9); bn.name = 'banner'; g.add(bn); }
          g.add(box(3, 0.4, 5, stone, 0, 0.2, 6.5));
          if (evil) for (const [px, pz] of [[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5]]) g.add(cone(0.35, 2.2, 5, 0x1a1010, px, 2.9, pz));
        } else {
          g.add(box(9, 3.2, 7, 0x8a6a48, 0, 1.6, 0));
          g.add(box(9.6, 1.2, 7.6, roof, 0, 3.8, 0));
          g.add(cone(5.2, 3, 4, roof, 0, 5.9, 0, Math.PI / 4));
          g.add(box(1.4, 2.2, 0.4, 0x3a2a1a, 0, 1.1, 3.6));
          g.add(cyl(0.12, 0.12, 6, 5, 0x442a10, 4.8, 3, 3.8));
          g.add(box(2.2, 1.2, 0.1, roof, 5.9, 5.3, 3.8));
        }
        break;
      }
      case 'house': {
        g.add(box(4, 2.4, 4, 0xd8c6a0, 0, 1.2, 0));
        g.add(box(4.2, 0.25, 4.2, 0x8a6a48, 0, 0.12, 0));
        for (let i = 0; i < 4; i++) g.add(box(0.18, 2.4, 0.18, 0x6a4a2a, i < 2 ? -1.95 : 1.95, 1.2, i % 2 ? -1.95 : 1.95));
        g.add(box(0.8, 1.4, 0.2, 0x4a3018, 0, 0.7, 2.05));
        g.add(win(0.7, 0.7, -1.2, 1.5, 2.02)); g.add(win(0.7, 0.7, 1.2, 1.5, 2.02)); g.add(win(0.7, 0.7, 2.02, 1.5, 0, Math.PI / 2)); g.add(win(0.7, 0.7, -2.02, 1.5, 0, Math.PI / 2));
        g.add(cone(3.1, 1.8, 4, roof, 0, 3.3, 0, Math.PI / 4));
        const ch = box(0.5, 1.4, 0.5, 0x8a8a8a, 1.2, 3.4, 1.0); ch.name = 'chimney'; g.add(ch);
        const variant = Math.abs(b.id || 0) % 3;
        if (variant === 0) { for (let i = 0; i < 5; i++) g.add(box(0.12, 0.6, 0.12, 0x8a6a48, -2.4 + i * 1.2, 0.3, 2.9)); g.add(box(4.9, 0.08, 0.08, 0x8a6a48, 0, 0.5, 2.9)); g.add(sphere(0.3, 0x5faa4a, -2.0, 0.3, 2.5)); }
        else if (variant === 1) { const aw = box(2.0, 0.06, 1.2, roof, -0.2, 2.15, 2.6); aw.rotation.x = 0.3; g.add(aw); g.add(cyl(0.05, 0.05, 1.5, 5, 0x5a3a1a, -1.1, 1.4, 3.1), cyl(0.05, 0.05, 1.5, 5, 0x5a3a1a, 0.7, 1.4, 3.1)); g.add(box(0.7, 0.5, 0.7, 0x9a7a4a, -1.3, 0.25, 2.7)); }
        else { g.add(box(1.4, 1.6, 1.2, 0xc8b690, 2.6, 0.8, -0.6)); const lt = box(1.8, 0.08, 1.5, roof, 2.6, 1.75, -0.6); lt.rotation.z = -0.25; g.add(lt); g.add(cyl(0.35, 0.35, 0.7, 8, 0x7a4a22, 2.8, 0.35, 1.1)); }
        break;
      }
      case 'field': {
        g.add(box(6, 0.3, 6, 0x6b4a2a, 0, 0.15, 0));
        for (let i = 0; i < 4; i++) { const r = box(1.0, 0.8, 5.4, 0x7fbf3f, -2.1 + i * 1.4, 0.55, 0); r.name = 'crop'; g.add(r); }
        g.add(box(0.3, 1.6, 0.3, 0x5a3a1a, 2.8, 0.9, 2.8));
        g.add(box(0.3, 1.6, 0.3, 0x5a3a1a, -2.8, 0.9, -2.8));
        break;
      }
      case 'altar': {
        g.add(cyl(2.8, 3.0, 0.5, 12, 0xd8d0c0, 0, 0.25, 0));
        g.add(cyl(3.4, 3.6, 0.25, 12, 0xc8c0b0, 0, 0.12, 0));
        for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.add(cyl(0.22, 0.26, 2.6, 6, 0xe0d8c8, Math.cos(a) * 2.2, 1.6, Math.sin(a) * 2.2)); }
        g.add(box(1.4, 1, 1.4, 0xb0a898, 0, 1, 0));
        const flame = cone(0.5, 1.4, 6, 0xffaa33, 0, 2.2, 0); flame.material = mat(0xffaa33, { emissive: 0xff6600, emissiveIntensity: 0.8 }); flame.name = 'flame'; g.add(flame);
        break;
      }
      case 'armory': {
        g.add(box(6, 3.5, 6, 0x8a8a90, 0, 1.75, 0));
        for (let i = -2; i <= 2; i++) { g.add(box(0.8, 0.8, 0.8, 0x707078, i * 1.3, 3.9, 2.6)); g.add(box(0.8, 0.8, 0.8, 0x707078, i * 1.3, 3.9, -2.6)); }
        g.add(box(1.6, 2.4, 0.3, 0x3a2a1a, 0, 1.2, 3.0));
        g.add(cyl(0.1, 0.1, 5, 5, 0x442a10, 2.5, 5.5, 2.5));
        g.add(box(1.8, 1.0, 0.08, roof, 3.4, 7.4, 2.5));
        break;
      }
      case 'tower': {
        g.add(cyl(1.3, 1.6, 8, 8, 0x8a8a90, 0, 4, 0));
        g.add(cyl(1.9, 1.7, 1.2, 8, 0x707078, 0, 8.6, 0));
        g.add(cone(1.9, 1.6, 8, roof, 0, 10, 0));
        break;
      }
      case 'storehouse': {
        g.add(box(5, 3, 5, 0x9a7a4a, 0, 1.5, 0));
        g.add(cone(3.8, 1.6, 4, roof, 0, 3.8, 0, Math.PI / 4));
        g.add(box(1.2, 0.8, 1.2, 0xd9b24c, -1.4, 0.4, 3.0)); g.add(box(1.0, 0.6, 1.0, 0x8a5a2a, 1.2, 0.3, 3.0));
        break;
      }
      case 'road': {
        const r = box(4, 0.25, 4, 0x9a8a72, 0, 0.12, 0); r.receiveShadow = true; r.castShadow = false; g.add(r);
        break;
      }
      case 'wall': {
        g.add(box(2.6, 3.2, 2.6, 0x8a8a90, 0, 1.6, 0));
        g.add(box(2.8, 0.5, 2.8, 0x707078, 0, 3.4, 0));
        break;
      }
      case 'gate': {
        g.add(box(1.2, 4.5, 2.6, 0x8a8a90, -1.9, 2.25, 0)); g.add(box(1.2, 4.5, 2.6, 0x8a8a90, 1.9, 2.25, 0));
        g.add(box(5.2, 0.8, 2.8, 0x707078, 0, 4.4, 0));
        g.add(box(2.6, 3.4, 0.3, 0x4a3018, 0, 1.7, 0));
        break;
      }
      case 'lodge': {
        for (let i = 0; i < 5; i++) g.add(cyl(0.35, 0.35, 5, 7, 0x8a5a2a, 0, 0.35 + i * 0.6, 0).rotateZ ? (() => { const l = cyl(0.35, 0.35, 5, 7, i % 2 ? 0x7a4a22 : 0x8f5f30, 0, 0.35 + i * 0.6, 0); l.rotation.z = Math.PI / 2; return l; })() : null);
        for (let i = 0; i < 5; i++) { const l = cyl(0.35, 0.35, 5, 7, i % 2 ? 0x7a4a22 : 0x8f5f30, 0, 0.35 + i * 0.6, i % 2 ? 2.3 : -2.3); l.rotation.z = Math.PI / 2; g.add(l); }
        g.add(cone(3.8, 1.6, 4, roof, 0, 3.7, 0, Math.PI / 4));
        g.add(box(0.5, 1.6, 0.5, 0x5a4a3a, 2.1, 0.8, 2.1)); g.add(box(0.9, 0.25, 0.25, 0x9a9aa8, 2.1, 1.7, 2.1));
        for (let i = 0; i < 4; i++) { const l = cyl(0.25, 0.25, 1.6, 6, 0x9a6a3a, -2.0 + (i % 2) * 0.55, 0.3 + Math.floor(i / 2) * 0.5, 3.0); l.rotation.x = Math.PI / 2; g.add(l); }
        break;
      }
      case 'mine': {
        const vc = BW.VEIN_COLORS[b.vein] || 0x8a8a8a;
        g.add(box(5, 2.2, 3, 0x6a6a72, 0, 1.1, -0.8));
        g.add(box(1.6, 1.8, 0.4, 0x151515, 0, 0.9, 0.75));
        g.add(box(0.3, 2.0, 0.3, 0x6a4a2a, -1.0, 1.0, 0.85), box(0.3, 2.0, 0.3, 0x6a4a2a, 1.0, 1.0, 0.85), box(2.4, 0.3, 0.3, 0x6a4a2a, 0, 2.0, 0.85));
        g.add(box(1.4, 0.7, 1.0, 0x5a4a3a, 1.6, 0.55, 1.9)); const pile = sphere(0.55, vc, 1.6, 1.05, 1.9); pile.scale.set(1.2, 0.6, 1); g.add(pile);
        g.add(sphere(0.6, vc, -1.7, 0.4, 1.8), sphere(0.4, vc, -1.1, 0.3, 2.3));
        g.add(cyl(0.12, 0.12, 4, 5, 0x442a10, -2.2, 3, -2.2)); g.add(box(1.4, 0.9, 0.08, roof, -1.5, 4.5, -2.2));
        break;
      }
      case 'shrine': {
        g.add(cyl(2.1, 2.3, 0.5, 8, 0xd8d0c0, 0, 0.25, 0));
        g.add(cyl(1.2, 1.5, 1.4, 8, 0xc8c0b0, 0, 1.2, 0));
        for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + Math.PI / 4; g.add(cyl(0.16, 0.18, 2.8, 6, 0xe0d8c8, Math.cos(a) * 1.7, 1.9, Math.sin(a) * 1.7)); }
        g.add(cone(2.0, 1.2, 4, roof, 0, 3.9, 0, Math.PI / 4));
        const orb = sphere(0.45, 0xffe9a0, 0, 2.5, 0, { emissive: 0xffcc55, emissiveIntensity: 0.9 }); orb.name = 'orb'; g.add(orb);
        break;
      }
      case 'statue': {
        g.add(box(5, 1.2, 5, 0xd8cfb8, 0, 0.6, 0)); g.add(box(3.2, 1.2, 3.2, 0xc8bda8, 0, 1.8, 0));
        g.add(box(1.4, 3.2, 1.0, 0xf2d24a, 0, 4.0, 0)); g.add(sphere(0.6, 0xf2d24a, 0, 6.2, 0));
        g.add(box(0.4, 2.6, 0.4, 0xf2d24a, -1.0, 4.6, 0).rotateZ ? (() => { const a1 = box(0.4, 2.6, 0.4, 0xf2d24a, -1.1, 4.8, 0); a1.rotation.z = 0.5; return a1; })() : null);
        const a2 = box(0.4, 2.6, 0.4, 0xf2d24a, 1.1, 4.8, 0); a2.rotation.z = -0.5; g.add(a2);
        g.add(box(0.5, 2.2, 0.5, 0xf2d24a, -0.4, 2.9, 0), box(0.5, 2.2, 0.5, 0xf2d24a, 0.4, 2.9, 0));
        break;
      }
      case 'library': {
        // A stone hall with a colonnaded porch, a reading roof and a scroll tower.
        g.add(box(5, 0.5, 5, 0xc8c0b0, 0, 0.25, 0));
        g.add(box(4.2, 2.8, 3.6, 0xe6dcc6, 0, 1.9, -0.4));
        for (let i = -1; i <= 1; i++) g.add(cyl(0.18, 0.2, 2.8, 8, 0xf0e8d8, i * 1.5, 1.9, 1.9));
        g.add(box(4.8, 0.4, 1.6, 0xd8cfb8, 0, 3.5, 1.5));
        g.add(cone(3.4, 1.4, 4, roof, 0, 4.2, 0, Math.PI / 4));
        g.add(cyl(0.7, 0.8, 2.2, 8, 0xe6dcc6, 1.5, 4.6, -1.2)); g.add(cone(0.95, 0.9, 8, roof, 1.5, 6.1, -1.2));
        g.add(win(0.6, 0.9, -1.4, 2.0, 1.42)); g.add(win(0.6, 0.9, 1.4, 2.0, 1.42));
        g.add(box(0.9, 0.5, 0.3, 0x8a5a2a, -1.6, 0.75, 2.4), box(0.9, 0.5, 0.3, 0xb8862b, -1.6, 1.25, 2.4)); // stacked scrolls by the door
        break;
      }
      case 'granary': {
        // Raised on stilts against rats, with a ladder and sacks below.
        for (const [px, pz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) g.add(cyl(0.16, 0.18, 1.4, 6, 0x6a4a2a, px, 0.7, pz));
        g.add(box(3.6, 0.3, 3.6, 0x8a6a48, 0, 1.5, 0));
        g.add(cyl(1.7, 1.8, 2.6, 10, 0xd8b878, 0, 2.9, 0));
        g.add(cone(2.2, 1.6, 10, 0xb08a4a, 0, 5.0, 0));
        g.add(box(0.3, 1.6, 0.05, 0x5a3a1a, 1.9, 0.8, 1.2), box(0.3, 1.6, 0.05, 0x5a3a1a, 1.9, 0.8, 0.5)); for (let i = 0; i < 3; i++) g.add(box(0.05, 0.08, 0.8, 0x5a3a1a, 1.9, 0.4 + i * 0.45, 0.85));
        g.add(sphere(0.45, 0xd9b24c, -1.2, 0.4, 2.2), sphere(0.4, 0xd9b24c, -0.4, 0.35, 2.4));
        break;
      }
      case 'market': {
        // A cobbled square with three awning stalls, crates and a well.
        g.add(cyl(3.2, 3.4, 0.3, 12, 0xa89a82, 0, 0.15, 0));
        const stall = (x, z, ry, col) => { const st = new THREE.Group(); st.add(box(2.2, 0.9, 1.2, 0x8a6a48, 0, 0.75, 0)); for (const sx of [-1, 1]) st.add(cyl(0.07, 0.07, 2.4, 5, 0x5a3a1a, sx * 1.0, 1.4, -0.5)); const aw = box(2.5, 0.08, 1.6, col, 0, 2.5, -0.3); aw.rotation.x = 0.35; st.add(aw); st.add(box(0.5, 0.35, 0.5, 0xd9b24c, -0.6, 1.4, 0.1), box(0.5, 0.35, 0.5, 0xb8563a, 0.5, 1.4, 0.1)); st.position.set(x, 0.3, z); st.rotation.y = ry; return st; };
        g.add(stall(-1.6, -1.4, 0.5, 0xc83c3c), stall(1.7, -1.2, -0.6, 0xf2d24a), stall(0.2, 1.9, Math.PI, 0x3f8f4f));
        g.add(cyl(0.6, 0.65, 0.7, 8, 0x8a8a90, 0, 0.65, 0)); g.add(box(0.1, 1.4, 0.1, 0x5a3a1a, -0.5, 1.5, 0), box(0.1, 1.4, 0.1, 0x5a3a1a, 0.5, 1.5, 0), box(1.3, 0.1, 0.6, roof, 0, 2.2, 0));
        g.add(box(0.7, 0.7, 0.7, 0x9a7a4a, 2.4, 0.65, 1.6), box(0.6, 0.6, 0.6, 0x9a7a4a, 2.4, 1.3, 1.6));
        break;
      }
      case 'harbour': {
        // A stone quay with a pier running out over the water, a boathouse, a boat and crab pots.
        g.add(box(4.5, 0.8, 3.2, 0x8a8a90, -0.6, 0.4, -1.2));
        g.add(box(2.6, 0.25, 6.5, 0x8a6a48, 0.8, 0.9, 1.4));
        for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) g.add(cyl(0.12, 0.14, 1.6, 6, 0x5a3a1a, 0.8 + sx * 1.2, 0.3, -0.6 + i * 1.6));
        g.add(box(2.6, 2.0, 2.4, 0xb89a72, -1.7, 1.8, -1.2)); g.add(cone(2.0, 1.1, 4, roof, -1.7, 3.35, -1.2, Math.PI / 4));
        const hull = box(1.1, 0.5, 2.6, 0x7a4a22, 2.6, 0.35, 2.0); hull.name = 'boat'; g.add(hull);
        g.add(cyl(0.05, 0.05, 2.4, 5, 0x5a3a1a, 2.6, 1.6, 1.8)); const sail = box(0.04, 1.6, 1.0, 0xf4f0e6, 2.6, 1.8, 2.3); g.add(sail);
        g.add(box(0.5, 0.5, 0.5, 0x6a5a3a, -0.3, 1.25, 3.8), box(0.5, 0.5, 0.5, 0x6a5a3a, 0.3, 1.25, 4.3));
        g.add(cyl(0.08, 0.08, 3.6, 5, 0x5a3a1a, 1.9, 2.6, 4.4)); g.add(sphere(0.25, 0xffcc55, 1.9, 4.5, 4.4, { emissive: 0xffaa33, emissiveIntensity: 0.8 }));
        break;
      }
      case 'herbalist': {
        // A round wattle hut with a thatched cone, drying racks and a herb garden.
        g.add(cyl(1.8, 1.9, 2.0, 10, 0xc8b89a, 0, 1.0, 0));
        g.add(cone(2.5, 2.0, 10, 0xb8a060, 0, 3.0, 0));
        g.add(box(0.7, 1.3, 0.15, 0x4a3018, 0, 0.65, 1.85));
        for (let i = 0; i < 3; i++) g.add(box(0.5, 0.15, 0.5, i % 2 ? 0x5faa4a : 0x9c4fd0, -1.6 + i * 0.6, 0.15, -1.9));
        g.add(box(0.06, 1.2, 0.06, 0x5a3a1a, 1.6, 0.6, 1.4), box(0.06, 1.2, 0.06, 0x5a3a1a, 1.6, 0.6, -0.2), box(0.06, 0.06, 1.6, 0x5a3a1a, 1.6, 1.2, 0.6));
        for (let i = 0; i < 3; i++) g.add(box(0.2, 0.4, 0.15, 0x7fbf3f, 1.6, 0.95, 0.1 + i * 0.5));
        g.add(cyl(0.25, 0.3, 0.5, 6, 0x333333, -1.5, 0.25, 1.2));
        break;
      }
      case 'tavern': {
        // Two-storey timber-framed inn with a hanging sign, a barrel and benches.
        g.add(box(4.6, 2.0, 4.2, 0xd8c6a0, 0, 1.0, 0));
        g.add(box(5.0, 1.8, 4.6, 0xe6dcc6, 0, 2.9, 0));
        for (let i = -2; i <= 2; i++) { g.add(box(0.12, 1.8, 0.12, 0x5a3a1a, i * 1.15, 2.9, 2.32)); g.add(box(0.12, 1.8, 0.12, 0x5a3a1a, i * 1.15, 2.9, -2.32)); }
        g.add(box(5.0, 0.12, 4.6, 0x5a3a1a, 0, 2.0, 0));
        g.add(cone(3.7, 1.7, 4, roof, 0, 4.6, 0, Math.PI / 4));
        g.add(box(1.0, 1.5, 0.2, 0x4a3018, 0, 0.75, 2.1));
        g.add(win(0.7, 0.7, -1.4, 1.2, 2.12), win(0.7, 0.7, 1.4, 1.2, 2.12), win(0.7, 0.7, -1.4, 3.0, 2.32), win(0.7, 0.7, 1.4, 3.0, 2.32));
        g.add(box(0.06, 0.06, 1.0, 0x5a3a1a, 2.4, 2.2, 2.6)); g.add(box(0.05, 0.7, 0.7, 0xc83c3c, 2.4, 1.75, 3.0));
        const bar = cyl(0.4, 0.4, 0.8, 8, 0x7a4a22, -2.0, 0.4, 2.7); g.add(bar); g.add(box(1.6, 0.12, 0.4, 0x8a6a48, 1.4, 0.5, 2.8), box(0.1, 0.4, 0.3, 0x8a6a48, 0.8, 0.2, 2.8), box(0.1, 0.4, 0.3, 0x8a6a48, 2.0, 0.2, 2.8));
        const ch = box(0.5, 1.2, 0.5, 0x8a8a8a, 1.6, 5.0, -1.0); ch.name = 'chimney'; g.add(ch);
        break;
      }
      case 'monastery': {
        // A cloister: a walled garden, a chapel with a bell tower, and a light on the tower.
        g.add(box(6, 0.4, 6, 0xc8c0b0, 0, 0.2, 0));
        for (const [w, d, x, z] of [[6, 0.35, 0, -2.85], [6, 0.35, 0, 2.85], [0.35, 6, -2.85, 0], [0.35, 6, 2.85, 0]]) g.add(box(w, 1.6, d, 0xd8cfb8, x, 1.0, z));
        g.add(box(3.4, 3.0, 2.6, 0xe6dcc6, -0.6, 1.9, -1.2)); g.add(cone(2.4, 1.5, 4, roof, -0.6, 4.15, -1.2, Math.PI / 4));
        g.add(box(1.4, 1.4, 1.4, 0xe6dcc6, 1.9, 5.0, -1.6)); g.add(cyl(0.9, 0.9, 5.2, 4, 0xe6dcc6, 1.9, 2.6, -1.6)); g.add(cone(1.1, 1.4, 4, roof, 1.9, 6.4, -1.6, Math.PI / 4));
        g.add(sphere(0.28, 0xb8862b, 1.9, 5.0, -1.6));
        const orb = sphere(0.35, 0xffe9a0, 1.9, 7.4, -1.6, { emissive: 0xffcc55, emissiveIntensity: 0.9 }); orb.name = 'orb'; g.add(orb);
        g.add(box(0.15, 1.2, 0.15, 0xf5d76e, -0.6, 4.6, -1.2), box(0.7, 0.15, 0.15, 0xf5d76e, -0.6, 4.9, -1.2));
        for (let i = 0; i < 4; i++) g.add(cyl(0.4, 0.4, 0.5, 6, 0x5faa4a, -1.6 + i * 1.1, 0.6, 1.8));
        g.add(cyl(0.5, 0.55, 0.5, 8, 0x8a8a90, 1.6, 0.6, 1.2)); g.add(cyl(0.1, 0.1, 0.9, 6, 0x9fd0ff, 1.6, 1.2, 1.2));
        break;
      }
      case 'obelisk': {
        g.add(box(4, 0.6, 4, 0xd8cfb8, 0, 0.3, 0)); g.add(box(2.8, 0.6, 2.8, 0xc8bda8, 0, 0.9, 0));
        const shaft = cyl(0.5, 0.9, 10, 4, 0xe6dcc6, 0, 6.2, 0); shaft.rotation.y = Math.PI / 4; g.add(shaft);
        const tip = cone(0.72, 1.4, 4, 0xf5d76e, 0, 11.9, 0, Math.PI / 4); tip.material = mat(0xf5d76e, { emissive: 0xffcc55, emissiveIntensity: 0.6 }); g.add(tip);
        for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + Math.PI / 4; g.add(cyl(0.12, 0.12, 1.2, 5, 0xb8862b, Math.cos(a) * 1.9, 1.8, Math.sin(a) * 1.9)); g.add(sphere(0.18, 0xffaa33, Math.cos(a) * 1.9, 2.5, Math.sin(a) * 1.9, { emissive: 0xff6600, emissiveIntensity: 0.8 })); }
        const orb = sphere(0.4, 0xffffff, 0, 13.2, 0, { emissive: 0xffe4a0, emissiveIntensity: 1 }); orb.name = 'orb'; g.add(orb);
        break;
      }
      case 'terraces': {
        // Stepped garden terraces with irrigation channels and a shrine on top.
        for (let i = 0; i < 4; i++) { const w = 7 - i * 1.5; g.add(box(w, 0.8, w, 0xa89a82, 0, 0.4 + i * 0.8, 0)); const crop = box(w - 0.6, 0.35, w - 0.6, i % 2 ? 0x7fbf3f : 0x5faa4a, 0, 0.95 + i * 0.8, 0); crop.name = 'garden'; g.add(crop); }
        for (let i = 0; i < 3; i++) g.add(box(0.3, 0.1, 7 - i * 1.5 + 0.2, 0x55aaff, 0, 1.05 + i * 0.8, 0));
        g.add(cyl(0.5, 0.6, 1.2, 8, 0xe6dcc6, 0, 3.8, 0)); g.add(cone(0.9, 0.8, 8, roof, 0, 4.8, 0));
        g.add(box(0.15, 1.2, 0.15, 0x6a4a2a, 3.2, 3.2, 3.2), box(0.15, 1.2, 0.15, 0x6a4a2a, -3.2, 3.2, -3.2));
        break;
      }
      case 'wonder': {
        g.add(box(9, 1.6, 9, 0xd8cfb8, 0, 0.8, 0));
        g.add(box(7, 1.6, 7, 0xcfc4a8, 0, 2.4, 0));
        g.add(box(5, 1.6, 5, 0xc4b898, 0, 4, 0));
        g.add(box(3, 1.6, 3, 0xbcae8c, 0, 5.6, 0));
        g.add(cone(1.6, 4, 4, 0xf5d76e, 0, 8.4, 0, Math.PI / 4));
        const orb = sphere(0.8, 0xffffff, 0, 11, 0, { emissive: 0xffe4a0, emissiveIntensity: 1 }); orb.name = 'orb'; g.add(orb);
        break;
      }
    }
    // Higher levels get taller and gain ornaments so growth is visible at a glance.
    const level = b.level || 1;
    if (level >= 2) {
      const hh = (BW.BUILDING_HEIGHT[b.kind] || 4);
      if (b.kind === 'house') { g.add(box(3.4, 1.8, 3.4, 0xd8c6a0, 0, hh - 0.6, 0)); g.add(cone(2.8, 1.5, 4, roof, 0, hh + 1.1, 0, Math.PI / 4)); g.add(win(0.6, 0.6, 0, hh - 0.6, 1.72)); }
      else if (b.kind === 'field') { for (let i = 0; i < 2; i++) g.add(box(0.15, 0.15, 5.6, 0x8a6a3a, -1.4 + i * 2.8, 1.05, 0)); g.add(cyl(0.6, 0.6, 1.2, 8, 0x7a6a5a, 2.5, 0.6, -2.5)); }
      else if (b.kind === 'altar') { for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.add(cyl(0.12, 0.12, 4.5, 5, 0x5a3a1a, Math.cos(a) * 2.9, 2.2, Math.sin(a) * 2.9)); g.add(box(0.08, 1.2, 0.9, roof, Math.cos(a) * 2.9, 3.6, Math.sin(a) * 2.9)); } }
      else if (b.kind === 'center') { g.add(cyl(0.12, 0.12, 8, 6, 0x5a3a1a, 0, 15, 0)); g.add(box(0.1, 1.6, 2.6, level >= 3 ? 0xf5d76e : roof, 0, 18, 1.3)); }
      else if (b.kind === 'storehouse') { g.add(box(4, 1.6, 4, 0x9a7a4a, 0, hh + 0.2, 0)); g.add(cone(3.2, 1.3, 4, roof, 0, hh + 1.6, 0, Math.PI / 4)); }
      else if (b.kind === 'mine') { g.add(cyl(0.3, 0.3, 4, 6, 0x4a3a2a, -1.8, 3.5, -0.8)); g.add(box(3, 0.3, 0.3, 0x4a3a2a, -0.5, 5.4, -0.8)); }
      else if (b.kind === 'lodge') { g.add(box(2.6, 1.4, 2.6, 0x7a4a22, 0, hh + 0.2, 0)); g.add(cone(2.4, 1.2, 4, roof, 0, hh + 1.4, 0, Math.PI / 4)); }
      else if (b.kind === 'armory') { g.add(box(2.4, 2.4, 2.4, 0x7a7a82, 0, hh + 1, 0)); g.add(cone(1.9, 1.2, 4, roof, 0, hh + 2.7, 0, Math.PI / 4)); }
      else if (b.kind === 'tower') { g.add(cyl(1.5, 1.5, 3, 8, 0x8a8a90, 0, hh + 1.2, 0)); g.add(cone(2.0, 1.6, 8, roof, 0, hh + 3.4, 0)); }
    }
    if (level >= 3) { const flag = box(0.06, 1.0, 1.6, 0xf5d76e, 0, (BW.BUILDING_HEIGHT[b.kind] || 4) + 5.2, 0); flag.name = 'flag'; g.add(flag); g.add(cyl(0.06, 0.06, 4, 5, 0x5a3a1a, 0, (BW.BUILDING_HEIGHT[b.kind] || 4) + 3.5, -0.8)); }
    g.userData.entityId = b.id;
    // Construction scaffold, hidden once built.
    const sc = new THREE.Mesh(boxGeo(def.w + 0.6, 4, def.d + 0.6), new THREE.MeshBasicMaterial({ color: 0xffd080, wireframe: true, transparent: true, opacity: 0.6 }));
    sc.position.y = 2; sc.name = 'scaffold'; g.add(sc);
    return g;
  }

  // ---------------------------------------------------------------- Creature
  // Rounded, expressive creatures: capsule bodies, big eyes, ears, tails.
  function capsule(r, len, color, x = 0, y = 0, z = 0, rotX = 0, rotZ = 0) {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat(color));
    m.position.set(x, y, z); m.rotation.x = rotX; m.rotation.z = rotZ; m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function eye(x, y, z, r = 0.16) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    const white = sphere(r, 0xffffff); white.castShadow = false;
    const pupil = sphere(r * 0.55, 0x111111, 0, 0, r * 0.7); pupil.castShadow = false; pupil.name = 'pupil';
    g.add(white, pupil); g.name = 'eye';
    return g;
  }
  function creatureMesh(species, alignment) {
    const s = BW.SPECIES[species];
    const evil = alignment < -0.25, good = alignment > 0.25;
    let body = s.color, accent = s.accent;
    if (evil) { body = new THREE.Color(body).lerp(new THREE.Color(0x2a0a0a), 0.5).getHex(); accent = 0x8a1a1a; }
    if (good) { body = new THREE.Color(body).lerp(new THREE.Color(0xffffff), 0.25).getHex(); }
    const g = new THREE.Group();
    const parts = { legs: [], eyes: [], tailSegs: [] };
    const biped = species === 'ape';
    const head = new THREE.Group(); parts.head = head;
    if (biped) {
      parts.body = capsule(0.95, 1.2, body, 0, 2.3, 0); g.add(parts.body);
      g.add(sphere(0.8, accent, 0, 2.0, 0.55).scale.set(1, 1.1, 0.5) && g.children[g.children.length - 1]);
      head.position.set(0, 3.7, 0.25);
      head.add(sphere(0.72, body));
      head.add(sphere(0.5, accent, 0, -0.15, 0.5).scale.set(1.2, 0.8, 0.7) && head.children[head.children.length - 1]);
      head.add(sphere(0.22, body, -0.7, 0.1, 0), sphere(0.22, body, 0.7, 0.1, 0));
      head.add(box(0.5, 0.06, 0.1, 0x221111, 0, -0.32, 0.9));
      const eL = eye(-0.28, 0.2, 0.55, 0.17), eR = eye(0.28, 0.2, 0.55, 0.17); head.add(eL, eR); parts.eyes.push(eL, eR);
      for (let i = 0; i < 2; i++) {
        const leg = new THREE.Group(); leg.position.set(i ? 0.5 : -0.5, 1.35, 0);
        leg.add(capsule(0.26, 0.7, body, 0, -0.6, 0)); leg.add(sphere(0.3, accent, 0, -1.2, 0.1)); parts.legs.push(leg); g.add(leg);
        const arm = new THREE.Group(); arm.position.set(i ? 1.05 : -1.05, 3.0, 0);
        arm.add(capsule(0.22, 1.3, body, 0, -0.9, 0)); arm.add(sphere(0.32, accent, 0, -1.8, 0)); parts.legs.push(arm); g.add(arm);
      }
    } else {
      const long = species === 'wolf' ? 2.4 : species === 'tortoise' ? 2.2 : 2.3;
      const legH = species === 'tortoise' ? 0.7 : 1.3, tall = species === 'tortoise' ? 0.8 : 1.15;
      parts.body = capsule(tall * 0.62, long - tall, body, 0, legH + tall / 2, 0, Math.PI / 2); g.add(parts.body);
      if (species === 'tortoise') { const sh = sphere(1.5, accent, 0, legH + 0.45, 0); sh.scale.set(1.15, 0.7, 1.25); g.add(sh); const rim = sphere(1.55, 0x3a4a2a, 0, legH + 0.35, 0); rim.scale.set(1.2, 0.35, 1.3); g.add(rim); }
      if (species === 'cow') { g.add(sphere(0.45, accent, 0.4, legH + 0.95, -0.2), sphere(0.35, accent, -0.5, legH + 0.6, 0.5), sphere(0.3, accent, -0.2, legH + 1.1, -0.7)); g.add(sphere(0.35, 0xf0b0b0, 0, legH + 0.05, -0.2)); }
      if (species === 'lion') { const mane = sphere(1.05, accent, 0, legH + tall / 2 + 0.25, long / 2 - 0.1); mane.scale.set(1, 1, 0.75); g.add(mane); }
      head.position.set(0, legH + tall / 2 + 0.55, long / 2 + 0.55);
      head.add(sphere(0.6, body));
      const snout = sphere(0.38, species === 'cow' ? 0xf0b0b0 : accent, 0, -0.12, 0.45); snout.scale.set(1.1, 0.8, 1); head.add(snout);
      head.add(sphere(0.1, 0x111111, 0, -0.02, 0.85));
      const eL = eye(-0.26, 0.18, 0.42, 0.15), eR = eye(0.26, 0.18, 0.42, 0.15); head.add(eL, eR); parts.eyes.push(eL, eR);
      if (species === 'wolf') { head.add(cone(0.2, 0.5, 4, body, -0.32, 0.6, -0.1), cone(0.2, 0.5, 4, body, 0.32, 0.6, -0.1)); }
      else if (species === 'cow') { const h1 = cyl(0.05, 0.11, 0.6, 5, 0xeeeecc, -0.5, 0.5, -0.1), h2 = cyl(0.05, 0.11, 0.6, 5, 0xeeeecc, 0.5, 0.5, -0.1); h1.rotation.z = 0.7; h2.rotation.z = -0.7; head.add(h1, h2); const e1 = sphere(0.16, body, -0.6, 0.25, -0.1), e2 = sphere(0.16, body, 0.6, 0.25, -0.1); e1.scale.set(1.5, 0.6, 1); e2.scale.set(1.5, 0.6, 1); head.add(e1, e2); }
      else if (species === 'lion') { head.add(sphere(0.18, body, -0.4, 0.5, -0.1), sphere(0.18, body, 0.4, 0.5, -0.1)); }
      else if (species === 'tortoise') { head.scale.set(0.8, 0.8, 0.8); }
      for (let i = 0; i < 4; i++) {
        const leg = new THREE.Group();
        leg.position.set(i % 2 ? 0.5 : -0.5, legH, i < 2 ? long / 2 - 0.5 : -long / 2 + 0.5);
        leg.add(capsule(0.2, legH - 0.35, body, 0, -legH / 2, 0)); leg.add(sphere(0.24, accent, 0, -legH + 0.1, 0.08)); parts.legs.push(leg); g.add(leg);
      }
      const tail = new THREE.Group(); tail.position.set(0, legH + tall / 2 + 0.2, -long / 2 - 0.1);
      let cur = tail; const segs = species === 'tortoise' ? 1 : 3;
      for (let i = 0; i < segs; i++) { const seg = new THREE.Group(); seg.position.z = i ? -0.45 : 0; seg.add(capsule(species === 'wolf' ? 0.2 - i * 0.03 : 0.11, 0.35, body, 0, 0, -0.22, Math.PI / 2)); cur.add(seg); parts.tailSegs.push(seg); cur = seg; }
      if (species === 'lion') cur.add(sphere(0.2, accent, 0, 0, -0.5));
      parts.tail = tail; g.add(tail);
    }
    if (evil) { head.add(cone(0.16, 0.7, 5, 0x1a1010, -0.35, 0.7, 0), cone(0.16, 0.7, 5, 0x1a1010, 0.35, 0.7, 0)); for (const e of parts.eyes) { const p = e.getObjectByName('pupil'); p.material = mat(0xff2200, { emissive: 0xff2200, emissiveIntensity: 1 }); } }
    if (good) { const halo = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.06, 6, 20), mat(0xfff2a0, { emissive: 0xffdd66, emissiveIntensity: 1 })); halo.rotation.x = Math.PI / 2; halo.position.y = 1.0; head.add(halo); }
    g.add(head);
    g.userData.parts = parts;
    return g;
  }

  // ---------------------------------------------------------------- Hand
  // A rounded palm, jointed fingers with knuckles, a thumb, a sleeve of
  // light trailing off towards the heavens, and an orb for miracle casting.
  function handMesh() {
    const g = new THREE.Group();
    const m = new THREE.MeshLambertMaterial({ color: 0xf1e4d0, emissive: 0x332211, emissiveIntensity: 0.2 });
    const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), m); palm.scale.set(1.15, 0.36, 1.25); palm.castShadow = true; g.add(palm);
    const wrist = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 0.8, 3, 10), m); wrist.rotation.x = Math.PI / 2; wrist.position.set(0, 0, -1.2); wrist.scale.set(1.2, 0.7, 1); g.add(wrist);
    const fingers = [];
    const specs = [[-0.85, 1.0, 1.15, 0.19], [-0.3, 1.12, 1.35, 0.2], [0.3, 1.12, 1.28, 0.2], [0.82, 1.0, 1.05, 0.18]];
    for (const [fx, fz, len, r] of specs) {
      const f = new THREE.Group(); f.position.set(fx, 0, fz);
      const seg1 = new THREE.Mesh(new THREE.CapsuleGeometry(r, len * 0.55, 3, 8), m); seg1.rotation.x = Math.PI / 2; seg1.position.z = len * 0.3; seg1.castShadow = true; f.add(seg1);
      const knuckle = new THREE.Group(); knuckle.position.z = len * 0.62; knuckle.name = 'knuckle';
      const seg2 = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.9, len * 0.45, 3, 8), m); seg2.rotation.x = Math.PI / 2; seg2.position.z = len * 0.25; seg2.castShadow = true; knuckle.add(seg2);
      const claw = new THREE.Mesh(new THREE.ConeGeometry(r * 0.8, 0.55, 6), new THREE.MeshLambertMaterial({ color: 0x1a0808 })); claw.rotation.x = Math.PI / 2; claw.position.z = len * 0.55; claw.visible = false; claw.name = 'claw'; knuckle.add(claw);
      f.add(knuckle); fingers.push(f); g.add(f);
    }
    const thumb = new THREE.Group(); thumb.position.set(-1.15, 0.05, 0.2); thumb.rotation.y = 0.95; thumb.rotation.z = -0.3;
    const t1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.45, 3, 8), m); t1.rotation.x = Math.PI / 2; t1.position.z = 0.3; thumb.add(t1);
    const tk = new THREE.Group(); tk.position.z = 0.6; tk.name = 'knuckle';
    const t2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.35, 3, 8), m); t2.rotation.x = Math.PI / 2; t2.position.z = 0.22; tk.add(t2); thumb.add(tk); g.add(thumb);
    // Sleeve of light: a faint cone rising from the wrist.
    const sleeveMat = new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.5, 6, 12, 1, true), sleeveMat); sleeve.position.set(0, 2.6, -2.6); sleeve.rotation.x = -0.65; g.add(sleeve);
    // Miracle orb, hidden unless casting.
    const orbMat = new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.85 });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), orbMat); orb.position.set(0, 0.9, 0.4); orb.visible = false; g.add(orb);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.05, 6, 24), orbMat); ring.position.copy(orb.position); ring.rotation.x = Math.PI / 2; ring.visible = false; g.add(ring);
    const glow = new THREE.PointLight(0xffe0a0, 0.0, 16); glow.position.y = 1.2; g.add(glow);
    g.userData = { fingers, thumb, mat: m, glow, palm, sleeve, sleeveMat, orb, ring, orbMat };
    return g;
  }

  // ---------------------------------------------------------------- Sky
  class Sky {
    constructor() {
      this.group = new THREE.Group();
      this.uniforms = { top: { value: new THREE.Color(0x3d7ac9) }, horizon: { value: new THREE.Color(0xbfe0f5) }, bottom: { value: new THREE.Color(0x9fc4e8) } };
      const mat = new THREE.ShaderMaterial({
        uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, bottom, min(1.0, -h * 4.0)); gl_FragColor = vec4(c, 1.0); }`,
      });
      this.dome = new THREE.Mesh(new THREE.SphereGeometry(1400, 24, 12), mat); this.group.add(this.dome);
      // Stars
      const n = 900, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, e = Math.random() * 1.2 + 0.15; pos[i * 3] = Math.cos(a) * Math.cos(e) * 1300; pos[i * 3 + 1] = Math.sin(e) * 1300; pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 1300; }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, transparent: true, opacity: 0, sizeAttenuation: false, fog: false, depthWrite: false });
      this.stars = new THREE.Points(sg, this.starMat); this.group.add(this.stars);
      // Sun and moon discs
      this.sunMat = new THREE.MeshBasicMaterial({ color: 0xfff4c0, fog: false, transparent: true, opacity: 0.95 });
      this.sun = new THREE.Mesh(new THREE.CircleGeometry(38, 24), this.sunMat); this.group.add(this.sun);
      this.moon = new THREE.Mesh(new THREE.CircleGeometry(24, 24), new THREE.MeshBasicMaterial({ color: 0xe8ecff, fog: false })); this.group.add(this.moon);
      // Clouds: puffs of flattened spheres drifting slowly.
      this.clouds = [];
      const cm = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.88, fog: true });
      for (let i = 0; i < 16; i++) {
        const c = new THREE.Group(); const puffs = 3 + Math.floor(Math.random() * 3);
        for (let k = 0; k < puffs; k++) { const p = new THREE.Mesh(new THREE.SphereGeometry(6 + Math.random() * 7, 8, 6), cm); p.position.set((k - puffs / 2) * 7 + Math.random() * 4, Math.random() * 2, (Math.random() - 0.5) * 6); p.scale.y = 0.45; c.add(p); }
        c.position.set((Math.random() - 0.5) * 900, 95 + Math.random() * 40, (Math.random() - 0.5) * 900);
        c.userData.speed = 1.5 + Math.random() * 2; this.clouds.push(c); this.group.add(c);
      }
      this.time = 0;
    }
    update(t, day, dusk, evil, skyColor, focus, camera) {
      const u = this.uniforms;
      const top = new THREE.Color(0x2f6fc4).lerp(new THREE.Color(0x0a1030), 1 - day).lerp(new THREE.Color(0x6a2a4a), evil * 0.5 * day);
      u.top.value.copy(top);
      u.horizon.value.copy(skyColor).lerp(new THREE.Color(0xffd0a0), dusk * 0.8);
      u.bottom.value.copy(skyColor).lerp(new THREE.Color(0x1a2a3a), 1 - day);
      this.starMat.opacity = Math.max(0, 1 - day * 1.8);
      const ang = t * Math.PI * 2 - Math.PI / 2;
      this.sun.position.set(Math.cos(ang) * 1250, Math.sin(ang) * 1250, 500); this.sun.lookAt(0, 0, 0); this.sunMat.opacity = day > 0.05 ? 0.95 : 0;
      this.sunMat.color.set(0xfff4c0).lerp(new THREE.Color(0xff8a40), dusk);
      this.moon.position.set(-Math.cos(ang) * 1250, -Math.sin(ang) * 1250, -400); this.moon.lookAt(0, 0, 0);
      this.group.position.set(camera.position.x, 0, camera.position.z);
      this.time += 0.016;
      for (const c of this.clouds) { c.position.x += c.userData.speed * 0.016; if (c.position.x > 480) c.position.x = -480; }
    }
  }

  // ---------------------------------------------------------------- Water
  // Sum-of-sines waves in the vertex shader, sky-tinted with a sun glint.
  function makeWater(size) {
    const geo = new THREE.PlaneGeometry(size * 1.7, size * 1.7, 110, 110); geo.rotateX(-Math.PI / 2);
    const uniforms = { time: { value: 0 }, sunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2) }, shallow: { value: new THREE.Color(0x3f9fc8) }, deep: { value: new THREE.Color(0x1d5a8a) }, fogColor: { value: new THREE.Color(0x9fc4e8) }, fogNear: { value: 250 }, fogFar: { value: 700 } };
    const mat = new THREE.ShaderMaterial({
      uniforms, transparent: true, depthWrite: false,
      vertexShader: `uniform float time; varying vec3 vN; varying vec3 vW; varying float vH;
        void main(){ vec3 p = position; float w1 = sin(p.x * 0.11 + time * 1.1) * 0.55; float w2 = sin((p.x * 0.6 + p.z * 0.8) * 0.12 - time * 0.8) * 0.45; float w3 = sin(p.z * 0.19 + time * 1.7) * 0.28;
          p.y += w1 + w2 + w3; vH = w1 + w2 + w3;
          float dx = cos(p.x * 0.11 + time * 1.1) * 0.55 * 0.11 + cos((p.x * 0.6 + p.z * 0.8) * 0.12 - time * 0.8) * 0.45 * 0.072;
          float dz = cos((p.x * 0.6 + p.z * 0.8) * 0.12 - time * 0.8) * 0.45 * 0.096 + cos(p.z * 0.19 + time * 1.7) * 0.28 * 0.19;
          vN = normalize(vec3(-dx, 1.0, -dz)); vec4 wp = modelMatrix * vec4(p, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `uniform vec3 sunDir; uniform vec3 shallow; uniform vec3 deep; uniform vec3 fogColor; uniform float fogNear; uniform float fogFar; varying vec3 vN; varying vec3 vW; varying float vH;
        void main(){ vec3 V = normalize(cameraPosition - vW); float fres = pow(1.0 - max(dot(V, vN), 0.0), 2.0);
          vec3 c = mix(deep, shallow, 0.35 + vH * 0.45); c = mix(c, fogColor, fres * 0.55);
          vec3 H = normalize(V + normalize(sunDir)); float spec = pow(max(dot(vN, H), 0.0), 90.0); c += spec * 1.2;
          float d = length(cameraPosition - vW); float f = clamp((d - fogNear) / (fogFar - fogNear), 0.0, 1.0); c = mix(c, fogColor, f);
          gl_FragColor = vec4(c, 0.82 + fres * 0.15); }`,
    });
    const mesh = new THREE.Mesh(geo, mat); mesh.name = 'water'; mesh.frustumCulled = false;
    mesh.userData.uniforms = uniforms;
    return mesh;
  }

  // ---------------------------------------------------------------- Grass
  // Tufts scattered deterministically around the camera target, swaying.
  class Grass {
    constructor(max = 6000) {
      this.max = max;
      const blade = new THREE.ConeGeometry(0.12, 1.0, 3); blade.translate(0, 0.5, 0);
      const g1 = blade, g2 = blade.clone().rotateY(1.1).translate(0.15, 0, 0.1), g3 = blade.clone().rotateY(2.2).translate(-0.12, 0, 0.12);
      const pos = [], nor = [];
      for (const g of [g1, g2, g3]) { pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      this.uniforms = { time: { value: 0 } };
      const m = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      m.onBeforeCompile = (sh) => { sh.uniforms.time = this.uniforms.time; sh.vertexShader = 'uniform float time;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n float sw = sin(time * 1.6 + instanceMatrix[3][0] * 0.35 + instanceMatrix[3][2] * 0.27) * 0.18 * position.y; transformed.x += sw; transformed.z += sw * 0.5;'); };
      this.mesh = new THREE.InstancedMesh(geo, m, max); this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.receiveShadow = true;
      this.cx = 1e9; this.cz = 1e9;
      this._m = new THREE.Matrix4(); this._c = new THREE.Color();
    }
    // Regenerate around (cx,cz) when the camera target has moved.
    update(terrain, cx, cz, dt, palette, season) {
      this.uniforms.time.value += dt;
      if (Math.hypot(cx - this.cx, cz - this.cz) < 18 && this.version === terrain.colorVersion) return;
      this.cx = cx; this.cz = cz; this.version = terrain.colorVersion;
      const R = 62, step = 1.7; let n = 0;
      const a = palette.grassA, b = palette.grassB;
      const winter = season === 'winter';
      for (let gx = Math.floor((cx - R) / step); gx <= Math.ceil((cx + R) / step); gx++) for (let gz = Math.floor((cz - R) / step); gz <= Math.ceil((cz + R) / step); gz++) {
        const h1 = ((gx * 73856093) ^ (gz * 19349663)) >>> 0; const r1 = (h1 % 1000) / 1000, r2 = ((h1 >> 10) % 1000) / 1000, r3 = ((h1 >> 20) % 1000) / 1000;
        if (r3 < 0.35) continue;
        const x = gx * step + r1 * step, z = gz * step + r2 * step;
        if ((x - cx) * (x - cx) + (z - cz) * (z - cz) > R * R) continue;
        const h = terrain.heightAt(x, z); if (h < 1.6 || h > 28 || terrain.slopeAt(x, z) > 0.6) continue;
        if (n >= this.max) break;
        const sc = 0.7 + r1 * 0.8;
        this._m.makeRotationY(r2 * 6.28); this._m.scale(new THREE.Vector3(sc, sc * (winter ? 0.5 : 1), sc)); this._m.setPosition(x, h, z);
        this.mesh.setMatrixAt(n, this._m);
        this._c.copy(a).lerp(b, r3).multiplyScalar(0.85 + r1 * 0.3); this.mesh.setColorAt(n, this._c); n++;
      }
      this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- Hex overlay
  // Grid lines draped over the terrain around the cursor while placing.
  class HexOverlay {
    constructor() {
      const maxHex = 127, segs = 6 * 3;
      this.geo = new THREE.BufferGeometry();
      this.pos = new Float32Array(maxHex * segs * 2 * 3);
      this.col = new Float32Array(maxHex * segs * 2 * 3);
      this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
      this.lines = new THREE.LineSegments(this.geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }));
      this.lines.frustumCulled = false; this.lines.visible = false;
      this.hover = groundRing(BW.hex.R, 0x66ff66, 36); this.hover.visible = false;
      this.group = new THREE.Group(); this.group.add(this.lines, this.hover);
      this.lastKey = null;
    }
    // occupied(q,r) -> true when a building already sits in that hex.
    update(terrain, cx, cz, radius, occupied, hoverHex, valid) {
      const c = BW.hex.toHex(cx, cz);
      const key = c.q * 100003 + c.r + (valid ? 0.5 : 0) + radius * 1e9;
      if (key !== this.lastKey || this.version !== terrain.colorVersion) {
        this.lastKey = key; this.version = terrain.colorVersion;
        let n = 0; const P = this.pos, C = this.col;
        for (let dq = -radius; dq <= radius; dq++) for (let dr = -radius; dr <= radius; dr++) {
          if (Math.abs(dq + dr) > radius) continue;
          const q = c.q + dq, r = c.r + dr; const ctr = BW.hex.center(q, r);
          if (!terrain.isLand(ctr.x, ctr.z)) continue;
          const occ = occupied(q, r);
          const col = occ ? [0.9, 0.35, 0.3] : [1, 0.95, 0.8];
          const cs = BW.hex.corners(ctr.x, ctr.z);
          for (let i = 0; i < 6; i++) {
            const a = cs[i], b = cs[(i + 1) % 6];
            for (let s = 0; s < 3; s++) {
              const t0 = s / 3, t1 = (s + 1) / 3;
              const x0 = a.x + (b.x - a.x) * t0, z0 = a.z + (b.z - a.z) * t0, x1 = a.x + (b.x - a.x) * t1, z1 = a.z + (b.z - a.z) * t1;
              P[n * 3] = x0; P[n * 3 + 1] = Math.max(terrain.heightAt(x0, z0), 0) + 0.3; P[n * 3 + 2] = z0; C[n * 3] = col[0]; C[n * 3 + 1] = col[1]; C[n * 3 + 2] = col[2]; n++;
              P[n * 3] = x1; P[n * 3 + 1] = Math.max(terrain.heightAt(x1, z1), 0) + 0.3; P[n * 3 + 2] = z1; C[n * 3] = col[0]; C[n * 3 + 1] = col[1]; C[n * 3 + 2] = col[2]; n++;
            }
          }
        }
        this.geo.setDrawRange(0, n); this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
      }
      this.lines.visible = true;
      if (hoverHex) { const hc = BW.hex.center(hoverHex.q, hoverHex.r); updateRing(this.hover, hc.x, hc.z, BW.hex.R * 0.97, terrain, 0.45); this.hover.material.color.set(valid ? 0x66ff66 : 0xff5555); this.hover.visible = true; }
      else this.hover.visible = false;
    }
    hide() { this.lines.visible = false; this.hover.visible = false; }
  }

  // The aimer: a small ring and dot on the ground under the hand, plus a thin
  // thread from the palm down to that point.
  function makeReticle() {
    const g = new THREE.Group();
    const ring = groundRing(0.9, 0xffffff, 28); ring.material.opacity = 0.9;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const thread = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
    thread.frustumCulled = false;
    g.add(ring, dot, thread); g.userData = { ring, dot, thread };
    return g;
  }

  // ---------------------------------------------------------------- Icons
  // Render any mesh to a small image, for menus and build cards.
  let iconRenderer = null;
  function renderIcon(obj, size = 96, opts = {}) {
    if (!iconRenderer) {
      const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
      iconRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      iconRenderer.setSize(size, size, false); iconRenderer.outputEncoding = THREE.sRGBEncoding;
      iconRenderer.scene = new THREE.Scene();
      iconRenderer.scene.add(new THREE.HemisphereLight(0xffffff, 0x665544, 0.9));
      const d = new THREE.DirectionalLight(0xfff4e0, 1.0); d.position.set(3, 6, 4); iconRenderer.scene.add(d);
      iconRenderer.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
    }
    const sc = iconRenderer.scene; sc.add(obj);
    const box = new THREE.Box3().setFromObject(obj); const sph = box.getBoundingSphere(new THREE.Sphere());
    const c = iconRenderer.cam; const dist = sph.radius / Math.sin(THREE.MathUtils.degToRad(15)) * 1.05;
    const ang = opts.angle === undefined ? 0.7 : opts.angle;
    c.position.set(sph.center.x + Math.sin(ang) * dist * 0.85, sph.center.y + dist * 0.5, sph.center.z + Math.cos(ang) * dist * 0.85); c.lookAt(sph.center);
    iconRenderer.setClearColor(0x000000, 0);
    iconRenderer.render(sc, c);
    sc.remove(obj);
    return iconRenderer.domElement.toDataURL();
  }

  // ---------------------------------------------------------------- Particles
  class Particles {
    constructor(max = 6000) {
      this.max = max;
      this.pos = new Float32Array(max * 3);
      this.col = new Float32Array(max * 3);
      this.size = new Float32Array(max);
      this.vel = new Float32Array(max * 3);
      this.life = new Float32Array(max);
      this.maxLife = new Float32Array(max);
      this.grav = new Float32Array(max);
      this.n = 0;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
      const m = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
        uniforms: {},
        vertexShader: `attribute float size; varying vec3 vC; void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize = size * (300.0 / -mv.z); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `varying vec3 vC; void main(){ vec2 d=gl_PointCoord-0.5; float a = smoothstep(0.5,0.1,length(d)); gl_FragColor=vec4(vC, a); }`,
      });
      this.points = new THREE.Points(geo, m);
      this.points.frustumCulled = false;
      this.geo = geo;
      this._c = new THREE.Color();
    }
    spawn(x, y, z, vx, vy, vz, life, color, size, grav = 0) {
      let i;
      if (this.n < this.max) i = this.n++;
      else i = Math.floor(Math.random() * this.max);
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
      this._c.set(color);
      this.col[i * 3] = this._c.r; this.col[i * 3 + 1] = this._c.g; this.col[i * 3 + 2] = this._c.b;
      this.size[i] = size; this.life[i] = life; this.maxLife[i] = life; this.grav[i] = grav;
    }
    burst(x, y, z, count, speed, life, color, size, grav = 0, up = 0) {
      for (let k = 0; k < count; k++) {
        const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2;
        const sp = speed * (0.3 + Math.random() * 0.7);
        this.spawn(x, y, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + up, Math.sin(a) * Math.cos(e) * sp, life * (0.5 + Math.random() * 0.5), color, size, grav);
      }
    }
    update(dt) {
      let n = this.n;
      for (let i = 0; i < n; i++) {
        this.life[i] -= dt;
        if (this.life[i] <= 0) {
          n--;
          if (i !== n) {
            for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[n * 3 + k]; this.vel[i * 3 + k] = this.vel[n * 3 + k]; this.col[i * 3 + k] = this.col[n * 3 + k]; }
            this.size[i] = this.size[n]; this.life[i] = this.life[n]; this.maxLife[i] = this.maxLife[n]; this.grav[i] = this.grav[n];
            i--;
          }
          continue;
        }
        this.vel[i * 3 + 1] -= this.grav[i] * dt;
        this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      }
      this.n = n;
      this.geo.setDrawRange(0, n);
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
      this.geo.attributes.size.needsUpdate = true;
    }
  }

  // Ring on the ground (influence, selection, miracle targeting).
  function groundRing(radius, color, segments = 96) {
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array((segments + 1) * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3).setUsage(THREE.DynamicDrawUsage));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    line.frustumCulled = false;
    line.userData.segments = segments;
    line.userData.radius = radius;
    return line;
  }
  function updateRing(line, cx, cz, radius, terrain, lift = 0.4) {
    const seg = line.userData.segments, arr = line.geometry.attributes.position.array;
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2;
      const x = cx + Math.cos(a) * radius, z = cz + Math.sin(a) * radius;
      arr[i * 3] = x; arr[i * 3 + 1] = Math.max(terrain.heightAt(x, z), 0) + lift; arr[i * 3 + 2] = z;
    }
    line.geometry.attributes.position.needsUpdate = true;
    line.userData.radius = radius;
  }

  Object.assign(BW, { Gfx, Crowd, makePeopleCrowd, makeIconCrowd, makeTreeCrowd, makeBroadleafCrowd, makeRockCrowd, makeItemCrowd, buildingMesh, creatureMesh, handMesh, Particles, groundRing, updateRing, box, mat, Sky, makeWater, Grass, renderIcon, windowMat, HexOverlay, makeReticle });
})(window.BW);
