// ---------------------------------------------------------------------------
// game.js — bootstrap: builds a land from its definition, runs the main loop,
// handles keys, save/load and the campaign flow.
// ---------------------------------------------------------------------------
(function (BW) {
  'use strict';
  const { dist, clamp } = BW;
  const SAVE_KEY = 'dominion_save_v1';

  class Game {
    constructor() {
      this.canvas = document.getElementById('game');
      this.gfx = new BW.Gfx(this.canvas);
      BW.bindInput(this.canvas);
      this.ui = new BW.UI(this);
      this.G = null; this.hand = null; this.camera = null;
      this.paused = false; this.speed = 1; this.shadows = true;
      this.profile = null;
      this.last = performance.now();
      this.fpsT = 0; this.frames = 0;
      this.running = false;
      BW.input.onKey = (e) => this.onKey(e);
      document.addEventListener('pointerdown', () => { BW.audio.init(); BW.audio.resume(); }, { capture: true });
      this.showMainMenu();
      requestAnimationFrame((t) => this.frame(t));
    }

    // Save slots: quick (F5/F9), auto (every two minutes) and five named slots.
    slotKey(slot) { return slot === 'quick' ? SAVE_KEY : SAVE_KEY + '_' + slot; }
    listSaves() {
      const out = [];
      for (const slot of ['quick', 'auto', '1', '2', '3', '4', '5']) {
        let meta = null; try { meta = JSON.parse(localStorage.getItem(this.slotKey(slot) + '_meta')); if (!meta && localStorage.getItem(this.slotKey(slot))) meta = { name: 'Older save' }; } catch (e) { meta = null; }
        out.push({ slot, meta });
      }
      return out;
    }
    hasSave() { return this.listSaves().some((s) => s.meta); }
    latestSlot() { let best = null; for (const s of this.listSaves()) if (s.meta && (!best || (s.meta.savedAt || 0) > (best.meta.savedAt || 0))) best = s; return best ? best.slot : null; }

    newCampaign(species, landIndex = 0, skirmish = false, opts = null) {
      this.demo = false;
      this.profile = { species, landIndex, alignment: 0, tribute: skirmish ? 14 : 0, unlocks: {}, creature: null, skirmish, custom: opts };
      this.startLand(landIndex);
    }

    // A skirmish land generated from a seed: tribes spread around the island.
    // Spread towns around a ring so each has its own stretch of coast and hinterland.
    ringPositions(land, count, seed) {
      const rng = new BW.RNG(seed * 13 + 7); const R = land.size * 0.29; const base = rng.next() * 6.28;
      return Array.from({ length: count }, (_, k) => { const a = base + k / count * 6.28 + (rng.next() - 0.5) * 0.25; const r = R * (0.9 + rng.next() * 0.2); return { x: Math.round(Math.cos(a) * r), z: Math.round(Math.sin(a) * r) }; });
    }
    landFor(index) {
      const P = this.profile;
      if (!P.custom) {
        const land = BW.LANDS[index];
        if (land.player.x === undefined) { const pos = this.ringPositions(land, land.enemies.length + 1, land.seed); Object.assign(land.player, pos[0]); land.enemies.forEach((e, i) => Object.assign(e, pos[i + 1])); }
        return land;
      }
      if (P.customLand) return P.customLand;
      const o = P.custom; const rng = new BW.RNG(o.seed);
      const n = o.tribes;
      const pos = this.ringPositions({ size: o.size }, n + 1, o.seed);
      const names = BW.TRIBE_NAMES.slice(); for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
      const species = ['wolf', 'lion', 'ape', 'cow', 'tortoise'];
      const enemies = [];
      for (let k = 1; k <= n; k++) { const p = pos[k]; enemies.push({ name: names[(k - 1) % names.length], x: p.x, z: p.z, pop: 14 + Math.floor(rng.next() * 12), aggression: 0.2 + rng.next() * 0.6, color: 1 + ((k - 1) % 4), creature: rng.next() < 0.4 ? { species: species[Math.floor(rng.next() * 5)], size: 1.8 + rng.next() * 1.2 } : null, godMiracles: rng.next() < 0.4 }); }
      const pp = pos[0];
      P.customLand = { name: `Isle ${o.seed}`, seed: o.seed, size: o.size, custom: true, intro: `A ${o.size >= 1000 ? 'huge' : o.size >= 800 ? 'vast' : o.size >= 500 ? 'large' : 'small'} island with ${n} rival tribe${n > 1 ? 's' : ''}. Win it by awe or by war.`, player: { x: pp.x, z: pp.z, pop: 18 }, enemies, objectives: ['Convert or conquer every town'], treeDensity: 1.1 };
      return P.customLand;
    }

    // ------------------------------------------------------------ land setup
    startLand(index) {
      this.profile.landIndex = index;
      const land = this.landFor(index);
      this.running = false;
      document.getElementById('loading').classList.add('show');
      this.ui.hideOverlay();
      setTimeout(() => {
        this.buildLand(land, index);
        document.getElementById('loading').classList.remove('show');
        this.ui.landIntro(land, () => { this.running = true; this.paused = false; this.G.say(`Welcome to ${land.name}. Press H for controls.`, 'info'); BW.advise(this.G, 'start'); });
      }, 50);
    }

    teardown() {
      if (this.G) {
        this.gfx.world.remove(this.G.root);
        for (const b of this.G.buildings) if (b._mesh) this.gfx.world.remove(b._mesh);
        for (const c of this.G.creatures) if (c._mesh) this.gfx.world.remove(c._mesh);
        for (const s of this.G.god.shields) if (s._mesh) this.gfx.world.remove(s._mesh);
        if (this.G.terrain) { this.gfx.world.remove(this.G.terrain.group); this.G.terrain.dispose(); }
        if (this.G.inflRing) this.gfx.world.remove(this.G.inflRing);
        if (this.G.grass) this.gfx.world.remove(this.G.grass.mesh);
        if (this.hand) { this.gfx.scene.remove(this.hand.mesh); for (const o of [this.hand.ring, this.hand.selRing, this.hand.hoverRing, this.hand.reticle, this.hand.hexes.group, this.hand.lineMesh, this.hand.ghost]) if (o) this.gfx.world.remove(o); }
      }
    }

    buildLand(land, index) {
      this.teardown();
      const snapSite = (p) => { const s = BW.hex.snap(p.x, p.z); return { x: s.x, z: s.z }; };
      const ps = snapSite(land.player); const es = land.enemies.map(snapSite);
      const sites = [{ x: ps.x, z: ps.z, r: 62 }].concat(es.map((e) => ({ x: e.x, z: e.z, r: 56 })));
      const terrain = new BW.Terrain(land.seed, land.size, sites);
      const G = new BW.World(this.gfx);
      BW.G = G; this.G = G;
      G.terrain = terrain; G.landIndex = index; G.seed = land.seed;
      G.rng = new BW.RNG(land.seed * 7 + 1);
      this.gfx.world.add(terrain.group);
      G.onMessage = (t, k) => this.ui.message(t, k);
      G.onAdvice = (a, b) => this.ui.advice(a, b);
      G.onDefeat = () => this.onDefeat();
      G.cameraState = () => this.camera.state();
      // Profile carry-over
      const P = this.profile;
      G.god.alignment = P.alignment; G.god.tribute = P.tribute; G.god.unlocks = Object.assign({}, P.unlocks);
      // Camera + hand
      this.camera = new BW.GodCamera(this.gfx, terrain);
      G.camera = this.camera;
      this.hand = new BW.Hand(G, this.camera); G.hand = this.hand; G.ui = this.ui;
      this.camera.lookAt(ps.x, ps.z);
      this.camera.yaw = Math.atan2(ps.x, ps.z) + Math.PI; // look inland
      // Towns
      const rng = G.rng;
      const pt = G.addTown({ name: 'Your town', owner: 0, color: 0, x: ps.x, z: ps.z, food: 260, wood: 220, stone: 60, iron: 20, gold: 0 });
      this.setupTown(G, pt, land.player.pop, true, rng);
      land.enemies.forEach((e, i) => {
        const t = G.addTown({ name: e.name, owner: i + 1, color: e.color, x: es[i].x, z: es[i].z, food: 300, wood: 260, stone: 90, iron: 30, gold: 5, ai: { aggression: e.aggression, godMiracles: !!e.godMiracles, timers: {} } });
        this.setupTown(G, t, e.pop, false, rng);
        if (e.creature) { const c = G.addCreature(i + 1, e.creature.species, es[i].x + 14, es[i].z + 10, e.creature.size); c.name = BW.SPECIES[e.creature.species].name; }
      });
      // Trees & rocks
      this.scatter(G, land, rng);
      // Player creature
      const c = G.addCreature(0, P.species, ps.x + 12, ps.z + 10, 1);
      if (P.creature) { Object.assign(c.learned, P.creature.learned); c.growth = P.creature.growth; c.alignment = P.creature.alignment; c.size = clamp(1 + c.growth, 1, 3.4); c.maxHealth = BW.SPECIES[c.species].hp * c.size; c.health = c.maxHealth; G._buildCreatureMesh(c); }
      c.leash = 'free';
      // Influence ring
      G.inflRing = BW.groundRing(G.god.influence, 0xffe9a0, 160); this.gfx.world.add(G.inflRing);
      G.grass = new BW.Grass(6000); this.gfx.world.add(G.grass.mesh);
      G.god.influence = 45;
      G.season = 'spring';
      terrain.recolor(G.god.alignment, 'spring');
      G.ensureNav(); G.rebuildGrids();
      terrain.updateChunks(this.camera.cam.position.x, this.camera.cam.position.z, this.camera.cam.position.y);
      this.ui.initMinimap();
      BW.audio.setAlignment(G.god.alignment);
      this.ui.closeTab();
      this.ui.hideBuilding();
      document.getElementById('landname').textContent = land.name;
      document.getElementById('messages').innerHTML = '';
    }

    setupTown(G, town, pop, isPlayer, rng) {
      const c = BW.placeBuilding(G, 'center', town, town.x, town.z, 0, true);
      town.centerId = c.id;
      // A short road from the temple door, so people learn what roads do.
      if (isPlayer) for (let i = 1; i <= 3; i++) { const x = town.x, z = town.z + 6 + i * 4; if (!BW.footprintOk(G, 'road', x, z, town, false)) BW.placeBuilding(G, 'road', town, x, z, 0, true); }
      const put = (kind, rmin, rmax) => { const s = BW.findSpot(G, kind, town, town.x, town.z, rmin, rmax, rng, 40); if (s) BW.placeBuilding(G, kind, town, s.x, s.z, s.rot, true); };
      const houses = Math.ceil(pop / 5) + 1;
      for (let i = 0; i < houses; i++) put('house', 9, 24);
      for (let i = 0; i < Math.max(2, Math.ceil(pop / 6)); i++) put('field', 14, 32);
      put('altar', 10, 22);
      // Every town gets a stone outcrop, an iron vein and a gold vein within reach.
      for (const kind of ['stone', 'stone', 'iron', 'gold']) for (let i = 0; i < 30; i++) { const a = rng.next() * 6.28, r = 26 + rng.next() * 14; const x = town.x + Math.sin(a) * r, z = town.z + Math.cos(a) * r; if (G.terrain.isLand(x, z) && !G.buildingAt(x, z, 3) && !G.nearest(G.rocks, x, z, 8)) { G.addRock(x, z, 1.2 + rng.next() * 0.8, kind); break; } }
      for (let i = 0; i < pop; i++) { const a = rng.next() * 6.28, r = 6 + rng.next() * 10; G.addPerson(town, town.x + Math.sin(a) * r, town.z + Math.cos(a) * r, 'idle'); }
    }

    scatter(G, land, rng) {
      const T = G.terrain, half = T.half;
      const n = Math.floor(land.size * land.size / 22 * land.treeDensity);
      const DENS = { grassland: 1.0, tundra: 0.35, desert: 0.12, swamp: 1.3, jungle: 1.6, badlands: 0.25 };
      for (let i = 0; i < n; i++) {
        const x = rng.range(-half + 4, half - 4), z = rng.range(-half + 4, half - 4);
        const h = T.heightAt(x, z);
        if (h < 1.5 || h > 30) continue;
        if (T.slopeAt(x, z) > 0.8) continue;
        const v = T.noise.fbm(x * 0.03 + 50, z * 0.03 + 50, 3) * 0.5 + 0.5;
        const w = T.biomeWeights(x, z, h); let dens = 0; for (const k in w) dens += w[k] * DENS[k];
        if (rng.next() > (v * 1.6 + 0.1) * dens) continue;
        let tooClose = false;
        for (const t of G.towns) if (dist(t.x, t.z, x, z) < 14) { tooClose = true; break; }
        if (tooClose || G.buildingAt(x, z, 1.5)) continue;
        const tree = G.addTree(x, z, 0.7 + rng.next() * 0.8);
        // Conifers on cold and high ground, broadleaf in the wet and warm.
        const cold = w.tundra + w.badlands + (h > 18 ? 0.6 : 0), wet = w.swamp + w.jungle + w.desert;
        tree.kind = cold > wet + 0.2 ? 0 : wet > cold + 0.2 ? 1 : tree.kind;
      }
      const nr = Math.floor(land.size / 9);
      for (let i = 0; i < nr; i++) {
        const x = rng.range(-half + 4, half - 4), z = rng.range(-half + 4, half - 4);
        const h = T.heightAt(x, z);
        if (h < 2 || G.buildingAt(x, z, 2)) continue;
        if (T.slopeAt(x, z) < 0.25 && rng.next() < 0.6) continue; // rocks prefer hills
        const k = rng.next(); const bw = T.biomeWeights(x, z);
        const goldP = 0.12 + bw.desert * 0.3, ironP = 0.23 + bw.badlands * 0.35;
        G.addRock(x, z, 0.8 + rng.next() * 1.2, k < goldP ? 'gold' : k < goldP + ironP ? 'iron' : 'stone');
      }
      // Guarantee a few rocks near the player.
      const pt = G.playerTown();
      for (let i = 0; i < 4; i++) { const a = rng.next() * 6.28, r = 26 + rng.next() * 12; const x = pt.x + Math.sin(a) * r, z = pt.z + Math.cos(a) * r; if (T.isLand(x, z) && !G.buildingAt(x, z, 2)) G.addRock(x, z, 1.2 + rng.next()); }
      // Guarantee a forest near the player.
      for (let i = 0; i < 60; i++) { const a = rng.next() * 6.28, r = 22 + rng.next() * 22; const x = pt.x + Math.sin(a) * r, z = pt.z + Math.cos(a) * r; if (T.isLand(x, z) && T.slopeAt(x, z) < 0.7 && !G.buildingAt(x, z, 2)) G.addTree(x, z, 0.8 + rng.next() * 0.7); }
    }

    // ------------------------------------------------------------ loop
    frame(now) {
      requestAnimationFrame((t) => this.frame(t));
      let dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
      this.frames++; this.fpsT += dt;
      if (this.fpsT > 1) { document.getElementById('fps').textContent = Math.round(this.frames / this.fpsT) + ' fps'; this.frames = 0; this.fpsT = 0; }
      if (!this.G) return;
      const G = this.G;
      if (this.demo) { this.camera.yaw += dt * 0.06; const t = G.playerTown(); if (t) { this.camera.tx += (t.x - this.camera.tx) * dt; this.camera.tz += (t.z - this.camera.tz) * dt; } }
      this.camera.update(dt);
      G.terrain.updateChunks(this.camera.cam.position.x, this.camera.cam.position.z, this.camera.cam.position.y);
      G.grass.update(G.terrain, this.camera.tx, this.camera.tz, dt, G.terrain.palette, G.season);
      const wu = G.terrain.water.userData.uniforms; wu.time.value += dt; wu.sunDir.value.copy(this.gfx.sun.position).sub(this.gfx.sunTarget.position).normalize(); wu.fogColor.value.copy(this.gfx.scene.fog.color); wu.fogNear.value = this.gfx.scene.fog.near; wu.fogFar.value = this.gfx.scene.fog.far;
      this.gfx.scene.fog.near = 200 + this.camera.dist * 0.8; this.gfx.scene.fog.far = 700 + this.camera.dist * 1.5;
      if (!this.demo) this.hand.update(dt); else this.hand.mesh.visible = false;
      if (this.running && !this.paused) {
        for (let s = 0; s < this.speed; s++) this.simulate(dt);
      }
      G.particles.update(dt);
      G.syncCrowds();
      this.gfx.setDaylight(G.tod, G.god.alignment, { x: this.camera.tx, z: this.camera.tz });
      if (G.alignmentDirty && (!G.lastRecolor || G.time - G.lastRecolor > 3)) { G.alignmentDirty = false; G.lastRecolor = G.time; G.terrain.recolor(G.god.alignment); BW.audio.setAlignment(G.god.alignment); const t = G.playerTown(); if (t) { const c = G.center(t); if (c && Math.abs((c._align || 0) - G.god.alignment) > 0.35) { c._align = G.god.alignment; G._buildBuildingMesh(c); } } }
      // Influence ring follows the main temple
      const pt = G.playerTown();
      if (pt) { const c = G.center(pt); if (c) BW.updateRing(G.inflRing, c.x, c.z, G.god.influence, G.terrain, 0.5); G.inflRing.material.opacity = 0.35 + Math.sin(G.time * 2) * 0.1; }
      this.updateAudioScene();
      this.gfx.render();
      if (!this.demo) this.ui.update(dt);
      BW.endInputFrame();
    }

    // Tell the sound engine what the camera is looking at.
    updateAudioScene() {
      const G = this.G, cam = this.camera; const T = G.terrain;
      let water = 0; for (let i = 0; i < 8; i++) { const a = i / 8 * 6.28; if (T.heightAt(cam.tx + Math.cos(a) * 28, cam.tz + Math.sin(a) * 28) < 0.5) water++; }
      let tension = 0;
      if (!this.demo) {
        const pt = G.playerTown(); const c = pt && G.center(pt);
        if (c) { const hostile = G.people.filter((p) => p.owner !== 0 && p.job === 'soldier' && BW.dist(p.x, p.z, c.x, c.z) < 90).length; tension = Math.min(1, hostile / 6); }
        for (const cr of G.creatures) if (cr.state === 'fight' || cr.state === 'rampage') tension = Math.max(tension, cr.owner === 0 ? 0.5 : 0.8);
        if (G.god.shields.length) tension = Math.max(tension, 0.3);
      }
      BW.audio.setScene({ night: 1 - (this.gfx.day === undefined ? 1 : this.gfx.day), rain: G.weather.kind === 'rain' ? 0.7 : G.weather.kind === 'storm' ? 1 : 0, sea: water / 8, tension, alignment: G.god.alignment, inGame: !this.demo });
    }

    simulate(dt) {
      const G = this.G;
      G.time += dt; G.frame++;
      G.tod = (G.tod + dt / G.dayLength) % 1;
      G.rebuildGrids();
      G.ensureNav();
      BW.updateWorld(G, dt);
      BW.updatePeople(G, dt);
      BW.updateBuildings(G, dt);
      BW.updateTowns(G, dt);
      BW.updateCreatures(G, dt);
      BW.updateArmy(G, dt);
      BW.updateEffects(G, dt);
      // Thrown items physics
      for (const it of G.items.slice()) {
        if (!it.thrown) continue;
        const th = it.thrown; it.x += th.vx * dt; it.z += th.vz * dt; it.y += th.vy * dt; th.vy -= 24 * dt;
        const gy = G.terrain.heightAt(it.x, it.z);
        if (it.y <= Math.max(gy, 0) || !G.terrain.inBounds(it.x, it.z)) {
          it.thrown = null; it.y = Math.max(gy, 0);
          if (gy < 0.5 || !G.terrain.inBounds(it.x, it.z)) { G.remove(it); continue; }
          const b = G.buildingAt(it.x, it.z, 1);
          if (b) { if (b.kind === 'center') { const t = G.ents.get(b.town); if (t) { G.deposit(t, it.kind, it.amount); if (t.owner !== 0) t.loyalty -= 2; } G.remove(it); } else if (b.owner !== 0) { BW.damageBuilding(G, b, it.amount * 0.4, 0); G.remove(it); } }
          BW.audio.play('thud');
        }
      }
      if (this.demo) return;
      // Objectives / victory
      if (!G.won && G.time > 5 && G.enemyTowns().length === 0) this.onVictory();
      if (G.time - (G.lastAutosave || 0) > 120) { G.lastAutosave = G.time; this.save(true, 'auto'); }
    }

    objectiveDone(text) {
      const G = this.G;
      const m = /Reach (\d+) villagers/.exec(text);
      if (m) return (G.god.pop || 0) >= +m[1];
      if (/Survive/.test(text)) return !G.creatures.some((c) => c.owner !== 0) || G.enemyTowns().length === 0;
      return G.enemyTowns().length === 0;
    }

    onVictory() {
      const G = this.G; G.won = true; this.running = false;
      BW.audio.play('win');
      G.god.tribute += 10;
      const isLast = this.profile.landIndex >= BW.LANDS.length - 1 || this.profile.skirmish || this.profile.custom;
      this.storeProfile();
      const stats = { day: Math.floor(G.time / G.dayLength) + 1, pop: G.god.pop, casts: G.god.stats.casts, align: G.god.alignment > 0.2 ? 'good' : G.god.alignment < -0.2 ? 'evil' : 'neutral' };
      this.ui.victory(stats, isLast, () => { if (isLast) this.showMainMenu(); else { this.profile.landIndex++; this.startLand(this.profile.landIndex); } });
    }
    onDefeat() { this.running = false; BW.audio.play('lose'); this.ui.defeat(() => this.startLand(this.profile.landIndex), () => this.showMainMenu()); }
    // The menu floats over a small living island that the camera slowly orbits.
    showMainMenu() {
      this.running = false; this.teardown(); this.G = null; BW.G = null;
      this.profile = { species: 'ape', landIndex: 0, alignment: 0, tribute: 0, unlocks: {}, creature: null, custom: null };
      const demo = { name: 'Demo', seed: 4242, size: 240, intro: '', player: { x: -40, z: 20, pop: 14 }, enemies: [{ name: 'Aztec', x: 60, z: -30, pop: 12, aggression: 0, color: 2 }], objectives: [], treeDensity: 1.2, custom: true };
      this.profile.customLand = demo; this.profile.custom = { seed: 4242, size: 240, tribes: 1 };
      this.buildLand(demo, 0);
      this.demo = true; this.running = true; this.paused = false;
      this.camera.targetDist = this.camera.dist = 95; this.camera.pitch = 0.62;
      this.ui.mainMenu();
    }

    storeProfile() {
      const G = this.G, c = G.playerCreature();
      Object.assign(this.profile, { alignment: G.god.alignment, tribute: G.god.tribute, unlocks: Object.assign({}, G.god.unlocks), creature: c ? { learned: c.learned, growth: c.growth, alignment: c.alignment } : this.profile.creature });
    }

    // ------------------------------------------------------------ save/load
    save(silent = false, slot = 'quick') {
      if (!this.G || this.demo) return;
      try {
        this.storeProfile();
        const G = this.G; const land = this.landFor(G.landIndex);
        const meta = { name: land.name, land: G.landIndex + 1, day: Math.floor(G.time / G.dayLength) + 1, pop: G.god.pop || 0, savedAt: Date.now(), custom: !!this.profile.custom, species: this.profile.species };
        localStorage.setItem(this.slotKey(slot), JSON.stringify({ profile: this.profile, world: JSON.parse(G.serialize()) }));
        localStorage.setItem(this.slotKey(slot) + '_meta', JSON.stringify(meta));
        if (!silent) this.G.say(slot === 'quick' ? 'Game saved.' : `Saved to slot ${slot}.`, 'good');
      } catch (e) { if (!silent) this.G.say('Save failed: ' + e.message, 'bad'); }
    }
    load(slot) {
      if (!slot) slot = this.latestSlot() || 'quick';
      let data;
      try { data = JSON.parse(localStorage.getItem(this.slotKey(slot))); } catch (e) { data = null; }
      if (!data) { if (this.G) this.G.say('No save in that slot.', 'warn'); return; }
      this.profile = data.profile; this.demo = false;
      const land = this.landFor(data.world.landIndex);
      this.running = false;
      document.getElementById('loading').classList.add('show');
      this.ui.hideOverlay();
      setTimeout(() => {
        this.buildLand(land, data.world.landIndex);
        this.G.loadState(data.world);
        if (data.world.camera) this.camera.restore(data.world.camera);
        this.G.terrain.recolor(this.G.god.alignment, this.G.season);
        this.G.ensureNav(); this.G.rebuildGrids();
        this.ui.initMinimap();
        document.getElementById('landname').textContent = land.name;
        document.getElementById('loading').classList.remove('show');
        document.getElementById('ui').classList.remove('photo');
        this.ui.closeTab(); this.ui.hideBuilding();
        this.running = true; this.paused = false;
        this.G.say('Game loaded.', 'good');
      }, 50);
    }

    togglePause() { this.paused = !this.paused; }

    // ------------------------------------------------------------ keys
    onKey(e) {
      const G = this.G; if (!G || !this.running || this.demo) return;
      const k = e.code;
      const tabs = { KeyB: 'build', KeyM: 'miracles', KeyC: 'creature', KeyT: 'army', KeyU: 'tribute', KeyI: 'stats' };
      if (tabs[k]) return this.ui.toggleTab(tabs[k]);
      if (k === 'Escape') { if (this.hand.mode) this.hand.setMode(null); else if (this.ui.tab) this.ui.closeTab(); else this.ui.toggleTab('menu'); return; }
      if (k === 'KeyH') return this.ui.toggleHelp();
      if (k === 'KeyY') { document.getElementById('ui').classList.toggle('photo'); return; }
      if (k === 'KeyP') { this.togglePause(); return; }
      if (k === 'KeyR' && this.hand.ghost) { this.hand.ghostRot += Math.PI / 2; return; }
      if (k === 'Space') { const t = G.playerTown(); if (t) this.camera.lookAt(t.x, t.z); return; }
      if (k === 'KeyF') { const c = G.playerCreature(); if (c) this.camera.lookAt(c.x, c.z); return; }
      if (k === 'F5') { e.preventDefault(); this.save(); return; }
      if (k === 'F9') { e.preventDefault(); this.load('quick'); return; }
      if (/^Digit[1-9]$/.test(k)) { const kind = BW.MIRACLE_ORDER[+k.slice(5) - 1]; if (kind) this.ui.selectMiracle(kind); return; }
      if (k === 'Equal' || k === 'NumpadAdd') { this.speed = Math.min(3, this.speed + 1); }
      if (k === 'Minus' || k === 'NumpadSubtract') { this.speed = Math.max(1, this.speed - 1); }
    }
  }

  window.addEventListener('DOMContentLoaded', () => { window.game = new Game(); });
})(window.BW);
