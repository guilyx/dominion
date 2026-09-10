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
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      this.renderer.outputEncoding = THREE.sRGBEncoding;
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x9fc4e8);
      this.scene.fog = new THREE.Fog(0x9fc4e8, 250, 700);
      this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);
      this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a6a3a, 0.7);
      this.sun = new THREE.DirectionalLight(0xfff4e0, 1.1);
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
      this.sun.intensity = 0.15 + day * 1.05;
      const evil = clamp(-alignment, 0, 1);
      const skyDay = new THREE.Color(0x9fc4e8).lerp(new THREE.Color(0xb59aa0), evil * 0.6);
      const skyDusk = new THREE.Color(0xe39a5a).lerp(new THREE.Color(0x8a2a2a), evil * 0.6);
      const skyNight = new THREE.Color(0x0e1630);
      const dusk = 1 - Math.abs(elev * 2.2 - 0.3) < 0.7 ? clamp(1 - Math.abs(elev * 3), 0, 1) : 0;
      const sky = skyNight.clone().lerp(skyDay, day).lerp(skyDusk, dusk * 0.6);
      this.scene.background.copy(sky);
      this.scene.fog.color.copy(sky);
      this.sun.color.set(0xfff4e0).lerp(new THREE.Color(0xff9a50), dusk * 0.7);
      this.hemi.intensity = 0.25 + day * 0.5;
      this.hemi.groundColor.set(evil > 0.5 ? 0x5a3a3a : 0x5a6a3a);
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
      this._m = new THREE.Matrix4();
      this._q = new THREE.Quaternion();
      this._p = new THREE.Vector3();
      this._s = new THREE.Vector3();
      this._e = new THREE.Euler();
      this._c = new THREE.Color();
      this.n = 0;
    }
    begin() { this.n = 0; }
    // Write one instance at index n for all parts.
    add(x, y, z, rotY, scale, color, tiltX = 0, partScales = null) {
      if (this.n >= this.max) return;
      const i = this.n++;
      for (let k = 0; k < this.meshes.length; k++) {
        const p = this.parts[k];
        const ps = partScales ? partScales[k] : 1;
        this._e.set(tiltX, rotY, 0);
        this._q.setFromEuler(this._e);
        this._p.set(x, y + p.offsetY * scale, z);
        this._s.set(scale * ps, scale * ps, scale * ps);
        this._m.compose(this._p, this._q, this._s);
        this.meshes[k].setMatrixAt(i, this._m);
        if (p.colored) {
          this._c.set(color !== undefined ? color : 0xffffff);
          this.meshes[k].setColorAt(i, this._c);
        }
      }
    }
    end() {
      for (const m of this.meshes) {
        m.count = this.n;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  }

  function makePeopleCrowd(max) {
    const bodyGeo = new THREE.BoxGeometry(0.55, 0.9, 0.35);
    const headGeo = new THREE.SphereGeometry(0.24, 8, 6);
    const carryGeo = new THREE.BoxGeometry(0.5, 0.35, 0.5);
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const skin = new THREE.MeshLambertMaterial({ color: 0xe8b58c });
    const carryMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    return new Crowd([
      { geo: bodyGeo, mat: white, offsetY: 0.75, colored: true },
      { geo: headGeo, mat: skin, offsetY: 1.42, colored: false },
      { geo: carryGeo, mat: carryMat, offsetY: 1.85, colored: true },
      { geo: new THREE.SphereGeometry(0.22, 6, 5), mat: new THREE.MeshBasicMaterial({ color: 0xffffff }), offsetY: 2.25, colored: true },
    ], max);
  }
  function makeTreeCrowd(max) {
    const trunk = new THREE.CylinderGeometry(0.22, 0.35, 1.6, 6);
    const canopy = new THREE.ConeGeometry(1.5, 3.4, 7);
    return new Crowd([
      { geo: trunk, mat: new THREE.MeshLambertMaterial({ color: 0x6b4a2a }), offsetY: 0.8, colored: false },
      { geo: canopy, mat: new THREE.MeshLambertMaterial({ color: 0xffffff }), offsetY: 2.9, colored: true },
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
        g.add(box(4, 2.4, 4, 0xc9b58f, 0, 1.2, 0));
        g.add(box(0.8, 1.4, 0.2, 0x4a3018, 0, 0.7, 2.05));
        g.add(cone(3.1, 1.8, 4, roof, 0, 3.3, 0, Math.PI / 4));
        g.add(box(0.5, 1.2, 0.5, 0x777, 1.2, 3.4, 1.0));
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
    g.userData.entityId = b.id;
    // Construction scaffold, hidden once built.
    const sc = new THREE.Mesh(boxGeo(def.w + 0.6, 4, def.d + 0.6), new THREE.MeshBasicMaterial({ color: 0xffd080, wireframe: true, transparent: true, opacity: 0.6 }));
    sc.position.y = 2; sc.name = 'scaffold'; g.add(sc);
    return g;
  }

  // ---------------------------------------------------------------- Creature
  function creatureMesh(species, alignment) {
    const s = BW.SPECIES[species];
    const evil = alignment < -0.25, good = alignment > 0.25;
    let body = s.color, accent = s.accent;
    if (evil) { body = new THREE.Color(body).lerp(new THREE.Color(0x2a0a0a), 0.5).getHex(); accent = 0xff3322; }
    if (good) { body = new THREE.Color(body).lerp(new THREE.Color(0xffffff), 0.25).getHex(); }
    const g = new THREE.Group();
    const parts = { legs: [] };
    const biped = species === 'ape';
    if (biped) {
      parts.body = box(1.6, 1.8, 1.1, body, 0, 2.2, 0);
      parts.head = box(1.1, 1.0, 1.0, body, 0, 3.6, 0.2);
      parts.head.add(box(0.7, 0.5, 0.3, accent, 0, -0.2, 0.5)); // muzzle
      parts.head.add(box(0.15, 0.15, 0.1, 0x111111, -0.25, 0.15, 0.5));
      parts.head.add(box(0.15, 0.15, 0.1, 0x111111, 0.25, 0.15, 0.5));
      for (let i = 0; i < 2; i++) {
        const leg = new THREE.Group(); leg.position.set(i ? 0.5 : -0.5, 1.3, 0);
        leg.add(box(0.5, 1.3, 0.5, body, 0, -0.65, 0)); parts.legs.push(leg); g.add(leg);
        const arm = new THREE.Group(); arm.position.set(i ? 1.05 : -1.05, 2.9, 0);
        arm.add(box(0.45, 1.9, 0.45, body, 0, -0.95, 0)); arm.add(box(0.5, 0.35, 0.5, accent, 0, -1.9, 0)); parts.legs.push(arm); g.add(arm);
      }
      parts.chest = box(1.0, 1.0, 0.2, accent, 0, 2.3, 0.6); g.add(parts.chest);
    } else {
      const long = species === 'wolf' ? 2.6 : 2.4, tall = species === 'tortoise' ? 0.9 : 1.3;
      const legH = species === 'tortoise' ? 0.7 : 1.3;
      parts.body = box(1.4, tall, long, body, 0, legH + tall / 2, 0);
      if (species === 'tortoise') { const sh = sphere(1.5, accent, 0, legH + 0.5, 0); sh.scale.set(1.1, 0.7, 1.2); g.add(sh); }
      if (species === 'lion') { const mane = box(1.9, 1.7, 1.0, accent, 0, legH + tall / 2 + 0.2, long / 2 - 0.2); g.add(mane); }
      parts.head = box(0.9, 0.85, 1.0, body, 0, legH + tall / 2 + 0.55, long / 2 + 0.5);
      parts.head.add(box(0.5, 0.4, 0.5, accent, 0, -0.2, 0.6));
      parts.head.add(box(0.14, 0.14, 0.1, 0x111111, -0.22, 0.15, 0.52));
      parts.head.add(box(0.14, 0.14, 0.1, 0x111111, 0.22, 0.15, 0.52));
      if (species === 'wolf') { parts.head.add(cone(0.18, 0.5, 4, body, -0.3, 0.6, -0.1)); parts.head.add(cone(0.18, 0.5, 4, body, 0.3, 0.6, -0.1)); }
      if (species === 'cow') { parts.head.add(cyl(0.06, 0.12, 0.7, 5, 0xeeeecc, -0.5, 0.5, -0.1)); parts.head.add(cyl(0.06, 0.12, 0.7, 5, 0xeeeecc, 0.5, 0.5, -0.1)); parts.head.children[3].rotation.z = 0.6; parts.head.children[4].rotation.z = -0.6; g.add(box(0.5, 0.5, 0.5, 0x222222, 0.3, legH + 0.4, -0.3), box(0.5, 0.6, 0.7, 0x222222, -0.4, legH + 0.9, 0.6)); }
      for (let i = 0; i < 4; i++) {
        const leg = new THREE.Group();
        leg.position.set(i % 2 ? 0.5 : -0.5, legH, i < 2 ? long / 2 - 0.4 : -long / 2 + 0.4);
        leg.add(box(0.42, legH, 0.42, body, 0, -legH / 2, 0)); parts.legs.push(leg); g.add(leg);
      }
      parts.tail = box(0.25, 0.25, 1.3, body, 0, legH + tall / 2 + 0.3, -long / 2 - 0.6); g.add(parts.tail);
    }
    if (evil) { parts.head.add(cone(0.18, 0.7, 5, 0x1a1010, -0.35, 0.65, 0)); parts.head.add(cone(0.18, 0.7, 5, 0x1a1010, 0.35, 0.65, 0)); }
    if (good) { const halo = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 6, 16), mat(0xfff2a0, { emissive: 0xffdd66, emissiveIntensity: 1 })); halo.rotation.x = Math.PI / 2; halo.position.y = 0.95; parts.head.add(halo); }
    g.add(parts.body, parts.head);
    g.userData.parts = parts;
    return g;
  }

  // ---------------------------------------------------------------- Hand
  function handMesh() {
    const g = new THREE.Group();
    const m = new THREE.MeshLambertMaterial({ color: 0xf1e4d0, emissive: 0x332211, emissiveIntensity: 0.2 });
    const palm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 1.7), m); palm.position.set(0, 0, 0); palm.castShadow = true; g.add(palm);
    const fingers = [];
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Group(); f.position.set(-0.6 + i * 0.4, 0, 0.85);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 1.1), m); seg.position.z = 0.55; seg.castShadow = true; f.add(seg);
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 5), new THREE.MeshLambertMaterial({ color: 0x220000 })); claw.rotation.x = Math.PI / 2; claw.position.z = 1.3; claw.visible = false; claw.name = 'claw'; f.add(claw);
      fingers.push(f); g.add(f);
    }
    const thumb = new THREE.Group(); thumb.position.set(-0.9, 0, 0.1); thumb.rotation.y = 0.9;
    const tseg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.9), m); tseg.position.z = 0.45; thumb.add(tseg); g.add(thumb);
    const glow = new THREE.PointLight(0xffe0a0, 0.0, 14); glow.position.y = 1; g.add(glow);
    g.userData = { fingers, thumb, mat: m, glow, palm };
    return g;
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

  Object.assign(BW, { Gfx, Crowd, makePeopleCrowd, makeTreeCrowd, makeRockCrowd, makeItemCrowd, buildingMesh, creatureMesh, handMesh, Particles, groundRing, updateRing, box, mat });
})(window.BW);
