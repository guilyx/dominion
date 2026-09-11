// ---------------------------------------------------------------------------
// world.js — the game state container: entities, towns, the player god, and
// the glue that keeps meshes in sync with state. All entities are plain data
// with ids; meshes hang off `_mesh` and are never serialized.
// ---------------------------------------------------------------------------
(function (BW) {
  'use strict';
  const { uid, dist, dist2, clamp } = BW;

  class World {
    constructor(gfx) {
      this.gfx = gfx;
      this.ents = new Map();
      this.people = []; this.trees = []; this.rocks = []; this.items = []; this.buildings = [];
      this.towns = []; this.creatures = []; this.platoons = [];
      this.time = 0;                 // seconds of game time
      this.dayLength = 300;          // seconds per day
      this.tod = 0.3;                // time of day 0..1, start morning
      this.god = { prayer: 300, maxPrayer: 1000, alignment: 0, tribute: 0, unlocks: {}, miracleImpress: 0, influence: 45, shields: [], stats: { casts: 0, kills: 0, thrown: 0 }, renown: 0, renownRate: 0 };
      this.effects = [];             // timed world effects (rain zones, shields, fires)
      this.msgs = [];
      this.peopleCrowd = BW.makePeopleCrowd(2500);
      this.iconCrowd = BW.makeIconCrowd(1000);
      this.treeCrowd = BW.makeTreeCrowd(20000);
      this.leafCrowd = BW.makeBroadleafCrowd(20000);
      this.rockCrowd = BW.makeRockCrowd(400);
      this.itemCrowd = BW.makeItemCrowd(400);
      this.particles = new BW.Particles(8000);
      this.root = new THREE.Group();
      this.root.add(this.peopleCrowd.group, this.iconCrowd.group, this.treeCrowd.group, this.leafCrowd.group, this.rockCrowd.group, this.itemCrowd.group, this.particles.points);
      gfx.world.add(this.root);
      this.treesDirty = true;
      this.rng = new BW.RNG(12345);
      this.grids = { person: new BW.Grid(8), tree: new BW.Grid(8), rock: new BW.Grid(8), item: new BW.Grid(8) };
      this.nav = null; this.navDirty = true;
      this.weather = { kind: 'clear', t: 60, intensity: 0 };
      this.season = 'summer';
      this.director = { tension: 0, nextEvent: 240, last: '', log: [] };
      this.history = []; this.historyT = 0;
      this.frame = 0;
      this.names = { used: 0 };
    }
    rebuildGrids() {
      this.grids.person.rebuild(this.people); this.grids.tree.rebuild(this.trees);
      this.grids.rock.rebuild(this.rocks); this.grids.item.rebuild(this.items);
    }
    _gridFor(list) { return list === this.people ? this.grids.person : list === this.trees ? this.grids.tree : list === this.rocks ? this.grids.rock : list === this.items ? this.grids.item : null; }
    ensureNav() {
      if (!this.nav) { this.nav = new BW.NavGrid(this.terrain.size, 3); this.nav.rebuild(this.terrain, this.buildings); this.nav.base = this.nav.cells.slice(); this.navDirty = false; }
      if (this.navDirty) { this.nav.cells.set(this.nav.base); this.nav.cost.fill(10); for (const b of this.buildings) this.nav.stamp(b); this.nav.version++; this.navDirty = false; }
      return this.nav;
    }
    // Procedural villager names: a tribe flavour from the town's colour index.
    makeName(town) {
      const sets = [['ka', 'ri', 'to', 'ma', 'el', 'an', 'su', 'ne'], ['bjo', 'sig', 'ulf', 'ra', 'gn', 'hel', 'ei', 'tor'], ['xo', 'chi', 'tla', 'me', 'ca', 'zi', 'pa', 'tl'], ['the', 'ly', 'ar', 'is', 'do', 'ph', 'on', 'kle'], ['ra', 'nef', 'set', 'am', 'ho', 'tep', 'ka', 'is']];
      const s = sets[(town && town.color) % sets.length] || sets[0];
      const n = 2 + (this.rng.next() < 0.4 ? 1 : 0);
      let out = ''; for (let i = 0; i < n; i++) out += s[Math.floor(this.rng.next() * s.length)];
      return out.charAt(0).toUpperCase() + out.slice(1);
    }

    // ------------------------------------------------------------ creation
    _register(e, list) { this.ents.set(e.id, e); list.push(e); return e; }
    groundY(x, z) { return Math.max(this.terrain.heightAt(x, z), 0); }

    addTown(o) {
      const t = Object.assign({ id: uid(), type: 'town', owner: 0, name: 'Town', color: 0, x: 0, z: 0, centerId: 0, food: 200, wood: 150, stone: 40, iron: 10, gold: 0, loyalty: 100, impress: 0, autoJobs: true, ai: null, timers: {}, alive: true }, o);
      this.towns.push(t); this.ents.set(t.id, t); return t;
    }
    addPerson(town, x, z, job = 'idle', age) {
      const r = this.rng;
      const traitKeys = ['strong', 'pious', 'fertile', 'coward', 'hardy'];
      const p = { type: 'person', id: uid(), town: town.id, owner: town.owner, x, z, y: this.groundY(x, z), dir: r.next() * 6.28, job, state: 'idle', tx: x, tz: z, targetId: 0, hunger: r.next() * 40, health: 30, maxHealth: 30, carry: null, workId: 0, platoon: 0, timer: r.next() * 2, held: false, thrown: null, inside: false, speed: 5.5, age: age === undefined ? 300 + r.next() * 900 : age, lifespan: 1900 + r.next() * 700, fear: 0, name: this.makeName(town), trait: r.next() < 0.35 ? traitKeys[Math.floor(r.next() * traitKeys.length)] : '', needs: { food: 1, home: 1, worship: 1, safety: 1, rest: 1 }, happy: 0.8, desire: '', sick: 0, hurry: 0, unit: '', slept: 1 };
      return this._register(p, this.people);
    }
    addTree(x, z, size = 1) {
      const t = { type: 'tree', id: uid(), x, z, y: this.groundY(x, z), size, wood: Math.round(30 * size), hp: 40 * size, fire: 0, burnt: 0, tint: BW.rand() };
      this.treesDirty = true;
      return this._register(t, this.trees);
    }
    addRock(x, z, size = 1, kind = 'stone') {
      const r = { type: 'rock', id: uid(), x, z, y: this.groundY(x, z), size, kind, ore: Math.round(40 * size) };
      return this._register(r, this.rocks);
    }
    addItem(kind, amount, x, z) {
      const it = { type: 'item', id: uid(), kind, amount, x, z, y: this.groundY(x, z), thrown: null, held: false };
      return this._register(it, this.items);
    }
    addBuilding(kind, town, x, z, rot = 0, built = false) {
      const def = BW.BUILDINGS[kind];
      const b = { type: 'building', id: uid(), kind, owner: town.owner, town: town.id, x, z, y: this.groundY(x, z), rot, hp: built ? def.hp : def.hp * 0.2, maxHp: def.hp, progress: built ? 1 : 0, built, fire: 0, crop: kind === 'field' ? 0.3 : 0, timer: 0, garrison: 0, level: 1, upgrading: false };
      this._register(b, this.buildings);
      this.navDirty = true;
      this._buildBuildingMesh(b);
      return b;
    }
    addCreature(owner, species, x, z, size = 1) {
      const s = BW.SPECIES[species];
      const c = { type: 'creature', id: uid(), owner, species, x, z, y: this.groundY(x, z), dir: 0, size, health: s.hp * size, maxHealth: s.hp * size, hunger: 30, energy: 100, alignment: 0, leash: 'free', goal: null, state: 'idle', timer: 0, lastAction: null, actionLog: [], learned: { eatTree: 0.4, eatVillager: 0.02, eatFood: 0.5, gatherWood: 0.3, waterField: 0.2, fight: 0.5, wander: 0.5, sleep: 0.3, castWater: 0, castHeal: 0, castFire: 0, castLightning: 0, harvest: 0.2, playful: 0.3 }, holding: null, xp: 0, kills: 0, growth: 0, walkPhase: 0, cooldown: 0, name: s.name, speak: '' };
      this._register(c, this.creatures);
      this._buildCreatureMesh(c);
      return c;
    }
    addPlatoon(town, members) {
      const pl = { type: 'platoon', id: uid(), owner: town.owner, town: town.id, members: members.map((m) => m.id), x: 0, z: 0, tx: null, tz: null, mode: 'idle', targetId: 0, name: 'Platoon ' + (this.platoons.filter((p) => p.owner === town.owner).length + 1) };
      for (const m of members) { m.job = 'soldier'; m.platoon = pl.id; m.state = 'idle'; m.carry = null; m.workId = 0; m.maxHealth = 60; m.health = 60; }
      this.platoons.push(pl); this.ents.set(pl.id, pl);
      this.updatePlatoonCenter(pl);
      return pl;
    }
    updatePlatoonCenter(pl) {
      let n = 0, sx = 0, sz = 0;
      for (const id of pl.members) { const m = this.ents.get(id); if (m) { n++; sx += m.x; sz += m.z; } }
      if (n) { pl.x = sx / n; pl.z = sz / n; }
      return n;
    }

    // ------------------------------------------------------------ removal
    remove(e) {
      if (!e || e.dead) return;
      e.dead = true;
      this.ents.delete(e.id);
      const lists = { person: this.people, tree: this.trees, rock: this.rocks, item: this.items, building: this.buildings, creature: this.creatures, platoon: this.platoons, town: this.towns };
      const L = lists[e.type];
      const i = L.indexOf(e); if (i >= 0) L.splice(i, 1);
      if (e._mesh) { this.gfx.world.remove(e._mesh); e._mesh = null; }
      if (e.type === 'tree') this.treesDirty = true;
      if (e.type === 'building') this.navDirty = true;
      if (e.type === 'person' && e.platoon) { const pl = this.ents.get(e.platoon); if (pl) { const j = pl.members.indexOf(e.id); if (j >= 0) pl.members.splice(j, 1); if (!pl.members.length) this.remove(pl); } }
    }

    // ------------------------------------------------------------ queries
    town(id) { return this.ents.get(id); }
    center(town) { return this.ents.get(town.centerId); }
    playerTown() { return this.towns.find((t) => t.owner === 0 && t.alive); }
    playerTowns() { return this.towns.filter((t) => t.owner === 0 && t.alive); }
    enemyTowns() { return this.towns.filter((t) => t.owner !== 0 && t.alive); }
    playerCreature() { return this.creatures.find((c) => c.owner === 0); }
    nearest(list, x, z, maxD, filter) {
      const g = this._gridFor(list);
      if (g && maxD <= 240) return g.nearest(x, z, maxD, filter);
      let best = null, bd = maxD * maxD;
      for (const e of list) { if (filter && !filter(e)) continue; const d = dist2(e.x, e.z, x, z); if (d < bd) { bd = d; best = e; } }
      return best;
    }
    inRadius(list, x, z, r, filter) {
      const g = this._gridFor(list);
      if (g && r <= 240) return g.inRadius(x, z, r, filter);
      const out = [], rr = r * r;
      for (const e of list) { if (filter && !filter(e)) continue; if (dist2(e.x, e.z, x, z) < rr) out.push(e); }
      return out;
    }
    buildingAt(x, z, pad = 0) {
      for (const b of this.buildings) {
        const d = BW.BUILDINGS[b.kind];
        if (Math.abs(x - b.x) < d.w / 2 + pad && Math.abs(z - b.z) < d.d / 2 + pad) return b;
      }
      return null;
    }
    townBuildings(town, kind) { return this.buildings.filter((b) => b.town === town.id && (!kind || b.kind === kind)); }
    townPeople(town) { return this.people.filter((p) => p.town === town.id); }
    townCapacity(town) { let c = 0; for (const b of this.buildings) if (b.town === town.id && b.built) c += Math.round((BW.BUILDINGS[b.kind].capacity || 0) * BW.UPGRADE.capacity[(b.level || 1) - 1]); return c; }
    townImpress(town) { let s = 0; for (const b of this.buildings) if (b.town === town.id && b.built) s += BW.BUILDINGS[b.kind].impress * BW.UPGRADE.impress[(b.level || 1) - 1]; return s; }
    levelMul(b, what) { return BW.UPGRADE[what][(b.level || 1) - 1]; }
    // Player influence: centred on every player town center.
    influenceCenters() { return this.playerTowns().map((t) => this.center(t)).filter(Boolean); }
    inInfluence(x, z) {
      const r = this.god.influence;
      for (const c of this.influenceCenters()) if (dist2(c.x, c.z, x, z) < r * r) return true;
      return false;
    }
    influenceDist(x, z) { // negative when inside
      let best = 1e9;
      for (const c of this.influenceCenters()) best = Math.min(best, dist(c.x, c.z, x, z) - this.god.influence);
      return best;
    }
    hasUnlock(k) { return !k || !!this.god.unlocks[k]; }

    // ------------------------------------------------------------ resources
    storageCap(town) { let c = 0; for (const b of this.buildings) if (b.town === town.id && b.built) c += (BW.BUILDINGS[b.kind].storage || 0) * BW.UPGRADE.storage[(b.level || 1) - 1]; return Math.round(c + 40 * this.townBuildings(town, 'house').filter((b) => b.built).length); }
    deposit(town, kind, amount) { const cap = town.cap_ || this.storageCap(town); town[kind] = Math.min(cap, (town[kind] || 0) + amount); if (town[kind] >= cap && town.owner === 0 && (!this.lastFullMsg || this.time - this.lastFullMsg > 90)) { this.lastFullMsg = this.time; this.say(`${kind.charAt(0).toUpperCase() + kind.slice(1)} storage is full. Build a Storehouse.`, 'warn'); } }
    canAfford(town, cost) { for (const k in cost) if ((town[k] || 0) < cost[k]) return false; return true; }
    pay(town, cost) { for (const k in cost) town[k] -= cost[k]; }

    // ------------------------------------------------------------ messages
    say(text, kind = 'info') { this.msgs.push({ text, kind, t: this.time }); if (this.onMessage) this.onMessage(text, kind); }

    // ------------------------------------------------------------ meshes
    _buildBuildingMesh(b) {
      if (b._mesh) this.gfx.world.remove(b._mesh);
      const town = this.ents.get(b.town);
      const m = BW.buildingMesh(b, town ? town.color : 0, b.owner === 0 ? this.god.alignment : 0);
      m.position.set(b.x, b.y, b.z); m.rotation.y = b.rot;
      b._mesh = m;
      this.gfx.world.add(m);
      this.syncBuilding(b);
    }
    syncBuilding(b) {
      const m = b._mesh; if (!m) return;
      const sc = m.getObjectByName('scaffold');
      if (sc) sc.visible = !b.built || !!b.upgrading;
      const lv = BW.UPGRADE.scale[(b.level || 1) - 1];
      m.scale.set(lv, 1, lv);
      const s = b.built ? 1 : 0.15 + 0.85 * b.progress;
      m.children.forEach((ch) => { if (ch.name !== 'scaffold') ch.scale.y = s; ch.position.y = ch.userData.baseY !== undefined ? ch.userData.baseY * s : (ch.userData.baseY = ch.position.y) * s; });
      if (b.kind === 'field') {
        m.children.forEach((ch) => { if (ch.name === 'crop') { const g = clamp(b.crop, 0.05, 1); ch.scale.y = g * s; ch.position.y = 0.15 + 0.4 * g; ch.material = BW.mat(b.crop > 0.9 ? 0xe0c040 : 0x7fbf3f); } });
      }
    }
    rebuildOwnerMeshes(town) { for (const b of this.buildings) if (b.town === town.id) this._buildBuildingMesh(b); }
    _buildCreatureMesh(c) {
      if (c._mesh) this.gfx.world.remove(c._mesh);
      const m = BW.creatureMesh(c.species, c.alignment);
      c._mesh = m; c._meshAlign = c.alignment;
      this.gfx.world.add(m);
    }

    // Draw all instanced crowds from state. Villagers are little articulated
    // figures: legs and arms swing, tools chop, worshippers raise their arms,
    // idle folk look around and wave.
    syncCrowds() {
      const P = BW.PEOPLE_PARTS;
      const pc = this.peopleCrowd; pc.begin();
      const ic = this.iconCrowd; ic.begin();
      const carryCol = BW.RES_COLORS;
      const TUNIC = { idle: 0, farmer: 0x6fa84a, forester: 0x8a5a2a, miner: 0x6e6e80, builder: 0xd08a2a, breeder: 0xd07aa0, worshipper: 0xf4f0e6, soldier: 0x5a5a6a };
      const TOOL = { farmer: 0x9a7a4a, forester: 0x7a5a3a, miner: 0x5a5a66, builder: 0x8a5a2a, soldier: 0x9a9aa8 };
      const SKINS = [0xf1c9a5, 0xe0ac7e, 0xc68642, 0x8d5524, 0x6b4423];
      const HAIRS = [0x2b1b0e, 0x0f0f0f, 0x6b3a1a, 0xc9a24a, 0xa0341c];
      const L = this._locals || (this._locals = Array.from({ length: 12 }, () => ({ px: 0, py: undefined, pz: 0, rx: 0, ry: 0, rz: 0, s: 1 })));
      const S = this._pscales || (this._pscales = new Array(12).fill(1));
      const time = this.time;
      const cam = this.camera; const cx = cam ? cam.tx : 0, cz = cam ? cam.tz : 0, cull = cam ? (cam.dist * 4 + 260) : 1e9;
      const cull2 = cull * cull;
      for (const p of this.people) {
        if (p.inside) continue;
        if ((p.x - cx) * (p.x - cx) + (p.z - cz) * (p.z - cz) > cull2) continue;
        const town = this.ents.get(p.town);
        const team = BW.TEAM_COLORS[town ? town.color : 0];
        const look = p.look || (p.look = { skin: SKINS[p.id % 5], hair: HAIRS[(p.id * 7 + 3) % 5] });
        const elder = p.age > 1500, child = p.age < 300;
        const soldier = p.job === 'soldier';
        let tunic = TUNIC[p.job] || team; if (p.unit === 'archer') tunic = 0x3f8f4f; else if (p.unit === 'siege') tunic = 0x5a3a1a;
        const walking = p.state === 'walk' || p.state === 'flee' || p.state === 'eatwalk' || p.state === 'sleepwalk';
        const working = p.state === 'work';
        const worship = working && p.job === 'worshipper';
        const idle = p.state === 'idle' && !p.thrown;
        const ph = p.timer * 11 + p.id;
        const swing = walking ? Math.sin(ph) * 0.75 : 0;
        const bob = walking ? Math.abs(Math.sin(ph)) * 0.12 : 0;
        for (let k = 0; k < 12; k++) { const l = L[k]; l.px = 0; l.py = undefined; l.pz = 0; l.rx = 0; l.ry = 0; l.rz = 0; l.s = 1; S[k] = 1; }
        L[P.legL].px = -0.14; L[P.legL].rx = swing; L[P.legR].px = 0.14; L[P.legR].rx = -swing;
        L[P.armL].px = -0.38; L[P.armL].rx = -swing * 0.8; L[P.armR].px = 0.38; L[P.armR].rx = swing * 0.8;
        L[P.armL].rz = 0.12; L[P.armR].rz = -0.12;
        S[P.carry] = p.carry ? 1 : 0; S[P.tool] = 0; S[P.helmet] = soldier ? 1 : 0; S[P.shield] = soldier && p.unit !== 'siege' && p.unit !== 'archer' ? 1 : 0;
        if (p.carry) { L[P.armL].rx = -1.6; L[P.armR].rx = -1.6; L[P.armL].rz = 0.3; L[P.armR].rz = -0.3; L[P.carry].py = 1.45; L[P.carry].pz = 0.5; }
        if (working && !worship && TOOL[p.job]) { S[P.tool] = 1; const a = -0.7 + Math.sin(time * 9 + p.id) * 0.9; L[P.armR].rx = a; L[P.tool].px = 0.38; L[P.tool].py = 1.25; L[P.tool].rx = a + 0.4; L[P.tool].pz = 0.15; }
        if (soldier) { S[P.tool] = 1; L[P.tool].px = 0.42; L[P.tool].py = 1.25; L[P.tool].rx = p.state === 'fight' ? -1.2 + Math.sin(time * 12 + p.id) * 0.8 : 0.1; L[P.tool].s = 1.4; L[P.armR].rx = L[P.tool].rx; L[P.shield].px = -0.5; L[P.shield].py = 1.15; L[P.shield].ry = 0.3; }
        if (worship) { const up = -2.6 + Math.sin(time * 3 + p.id) * 0.2; L[P.armL].rx = up; L[P.armR].rx = up; L[P.armL].rz = 0.35; L[P.armR].rz = -0.35; }
        if (idle) { L[P.head].ry = Math.sin(time * 0.8 + p.id) * 0.6; L[P.hair].ry = L[P.head].ry; if (((time + p.id * 0.37) % 14) < 1.2) L[P.armR].rx = -2.8 + Math.sin(time * 10) * 0.35; }
        if (p.hurry > 0) { L[P.legL].rx *= 1.4; L[P.legR].rx *= 1.4; }
        let tilt = p.thrown ? p.timer * 8 : elder ? 0.14 : 0;
        let y = p.y + bob;
        if (p.state === 'sleep' && !p.inside) { tilt = 1.45; y = p.y - 0.55; }
        const scale = child ? 0.6 : soldier ? 1.08 : 1;
        pc.add(p.x, y, p.z, p.dir, scale, tunic, tilt, S, L);
        const i = pc.n - 1;
        pc.setPartColor(i, P.head, look.skin);
        pc.setPartColor(i, P.hair, elder ? 0xb8b8b8 : look.hair);
        pc.setPartColor(i, P.legL, 0x5a4a3a); pc.setPartColor(i, P.legR, 0x5a4a3a);
        pc.setPartColor(i, P.armL, look.skin); pc.setPartColor(i, P.armR, look.skin);
        pc.setPartColor(i, P.band, p.trait === 'chosen' ? 0xffffff : team);
        if (p.carry) pc.setPartColor(i, P.carry, carryCol[p.carry.kind]);
        if (S[P.tool]) pc.setPartColor(i, P.tool, TOOL[p.job] || 0x9a9aa8);
        if (S[P.shield]) pc.setPartColor(i, P.shield, team);
        if (p.desire && !p.thrown) {
          const k = BW.NEED_PARTS.indexOf(p.desire);
          if (k >= 0) { const IS = this._iscales || (this._iscales = new Array(7).fill(0)); IS.fill(0); IS[k] = 1; ic.add(p.x, p.y + Math.sin(time * 3 + p.id) * 0.1, p.z, time * 1.5, scale, undefined, 0, IS); }
        }
      }
      pc.end(); ic.end();
      if (this.treesDirty) {
        const tc = this.treeCrowd; tc.begin(); const lc = this.leafCrowd; lc.begin();
        const sA = new THREE.Color(this.season === 'autumn' ? 0xb8702a : this.season === 'winter' ? 0x9fb8a8 : this.season === 'spring' ? 0x5faa4a : 0x2f7a2a);
        const sB = new THREE.Color(this.season === 'autumn' ? 0xe0a03a : this.season === 'winter' ? 0xe0ecf0 : this.season === 'spring' ? 0x9fdc6a : 0x7fc24a);
        const cA = new THREE.Color(this.season === 'winter' ? 0xcfe0dc : 0x24602a), cB = new THREE.Color(this.season === 'winter' ? 0xe8f2f4 : 0x3f8a3a);
        const tmp = new THREE.Color();
        for (const t of this.trees) {
          const burnt = t.burnt > 0;
          const kind = t.kind === undefined ? ((t.tint * 7) % 1 < 0.45 ? 0 : 1) : t.kind;
          const c = burnt ? 0x2a2018 : (t.fire > 0 ? 0xff6a22 : (kind ? tmp.copy(sA).lerp(sB, t.tint) : tmp.copy(cA).lerp(cB, t.tint)).getHex());
          const sc = 0.7 + t.size * 0.5;
          if (kind) lc.add(t.x, t.y, t.z, t.tint * 6.28, sc, c, 0, [1, burnt ? 0.3 : 1, burnt ? 0 : 1]);
          else tc.add(t.x, t.y, t.z, t.tint * 6.28, sc, c, 0, [1, burnt ? 0.3 : 1, burnt ? 0 : 1]);
        }
        tc.end(); lc.end();
        this.treesDirty = false;
      }
      const rc = this.rockCrowd; rc.begin();
      for (const r of this.rocks) rc.add(r.x, r.y, r.z, r.id, 0.6 + r.size * 0.6, BW.VEIN_COLORS[r.kind] || 0x8a8a8a);
      rc.end();
      const ic2 = this.itemCrowd; ic2.begin();
      for (const it of this.items) ic2.add(it.x, it.y, it.z, it.id, 0.6 + Math.min(it.amount, 200) / 250, carryCol[it.kind] || 0xffffff);
      ic2.end();
    }

    // ------------------------------------------------------------ save/load
    serialize() {
      const strip = (k, v) => (k.startsWith('_') ? undefined : v);
      const data = {
        version: 1, landIndex: this.landIndex, seed: this.seed, time: this.time, tod: this.tod, god: this.god, towns: this.towns,
        people: this.people, treesC: this.trees.map((t) => [t.id, +t.x.toFixed(1), +t.z.toFixed(1), +t.size.toFixed(2), t.wood, +t.fire.toFixed(2), t.burnt, +t.tint.toFixed(2), t.kind === undefined ? 1 : t.kind]), rocks: this.rocks, items: this.items, buildings: this.buildings, creatures: this.creatures, platoons: this.platoons, effects: this.effects, nextId: BW.uid(),
        camera: this.cameraState ? this.cameraState() : null, rng: this.rng.s, weather: this.weather, season: this.season, director: this.director, history: this.history,
      };
      return JSON.stringify(data, strip);
    }
    loadState(data) {
      for (const b of this.buildings) if (b._mesh) this.gfx.world.remove(b._mesh);
      for (const c of this.creatures) if (c._mesh) this.gfx.world.remove(c._mesh);
      this.ents.clear();
      this.time = data.time; this.tod = data.tod; this.god = data.god; this.effects = data.effects || [];
      this.towns = data.towns; this.people = data.people; this.rocks = data.rocks; this.items = data.items;
      this.trees = data.treesC ? data.treesC.map((a) => ({ type: 'tree', id: a[0], x: a[1], z: a[2], y: this.groundY(a[1], a[2]), size: a[3], wood: a[4], hp: 40 * a[3], fire: a[5], burnt: a[6], tint: a[7], kind: a[8] })) : (data.trees || []);
      if (data.rng !== undefined) this.rng.s = data.rng;
      if (data.weather) this.weather = data.weather; if (data.season) this.season = data.season; if (data.director) this.director = data.director;
      this.history = data.history || [];
        for (const b of this.buildings) { if (!b.level) b.level = 1; if (b.upgrading === undefined) b.upgrading = false; }
      // Older saves: ore became stone.
      for (const t of this.towns) { if (t.ore !== undefined) { t.stone = (t.stone || 0) + t.ore; delete t.ore; } for (const k of BW.RESOURCES) if (t[k] === undefined) t[k] = 0; }
      for (const r of this.rocks) if (!r.kind) r.kind = 'stone';
      for (const it of this.items) if (it.kind === 'ore') it.kind = 'stone';
      for (const p of this.people) if (p.carry && p.carry.kind === 'ore') p.carry.kind = 'stone';
      if (this.god.renown === undefined) { this.god.renown = 0; this.god.renownRate = 0; }
      this.navDirty = true;
      this.buildings = data.buildings; this.creatures = data.creatures; this.platoons = data.platoons;
      for (const L of [this.towns, this.people, this.trees, this.rocks, this.items, this.buildings, this.creatures, this.platoons]) for (const e of L) { e.dead = false; this.ents.set(e.id, e); }
      BW.setUidFloor(data.nextId);
      for (const b of this.buildings) this._buildBuildingMesh(b);
      for (const c of this.creatures) this._buildCreatureMesh(c);
      for (const p of this.people) { p.held = false; if (!p.needs) p.needs = { food: 1, home: 1, worship: 1, safety: 1, rest: 1 }; }
      for (const it of this.items) it.held = false;
      this.treesDirty = true;
    }
  }

  BW.World = World;
})(window.BW);
