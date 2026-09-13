// ---------------------------------------------------------------------------
// buildings.js — construction, placement validation, fire, fields, towers,
// damage and destruction. Also tree fire.
// ---------------------------------------------------------------------------
(function (BW) {
  'use strict';
  const { dist, dist2, clamp } = BW;

  function footprintOk(G, kind, x, z, town, requireInfluence = true) {
    const def = BW.BUILDINGS[kind];
    const T = G.terrain;
    const hw = def.w / 2, hd = def.d / 2;
    if (!T.inBounds(x, z)) return 'Out of bounds';
    if (def.coast) {
      // Harbours straddle the shore: the centre on land, water within reach of the pier.
      if (!T.isLand(x, z)) return 'Must be on land';
      if (!nearWater(G, x, z, 9)) return 'Must touch the water';
      if (nearWater(G, x, z, 2.5)) return 'Too far into the water';
    } else {
      for (const [ox, oz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, 0]]) if (!T.isLand(x + ox, z + oz)) return 'Must be on land';
      let hmin = 1e9, hmax = -1e9;
      for (const [ox, oz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, 0], [0, hd], [0, -hd], [hw, 0], [-hw, 0]]) { const h = T.heightAt(x + ox, z + oz); hmin = Math.min(hmin, h); hmax = Math.max(hmax, h); }
      if (hmax - hmin > 3.2) return 'Ground too steep';
    }
    if (def.era && town && (town.owner === 0 ? (G.god.era || 0) : (town.era || 0)) < def.era) return 'Needs the ' + BW.ERAS[def.era].name;
    // Tile buildings sit one per hex; walls, gates and roads are free-form.
    const tiled = !def.line && kind !== 'gate';
    if (tiled) { const h = BW.hex.toHex(x, z); for (const b of G.buildings) { const d = BW.BUILDINGS[b.kind]; if (d.line || b.kind === 'gate') continue; const bh = BW.hex.toHex(b.x, b.z); if (bh.q === h.q && bh.r === h.r) return 'Tile occupied'; } }
    const pad = def.line || kind === 'gate' ? 0 : 0.6;
    if (def.road) { for (const b of G.buildings) if (BW.BUILDINGS[b.kind].road && Math.abs(x - b.x) < 2 && Math.abs(z - b.z) < 2) return 'Road already here'; }
    for (const b of G.buildings) {
      const d = BW.BUILDINGS[b.kind];
      if (d.road || def.road) continue; // roads run under everything
      const bp = d.line || b.kind === 'gate' ? 0 : pad;
      if (Math.abs(x - b.x) < hw + d.w / 2 + bp - 0.05 && Math.abs(z - b.z) < hd + d.d / 2 + bp - 0.05) return 'Overlaps a building';
    }
    if (kind === 'mine' && !G.nearest(G.rocks, x, z, 9)) return 'Must be next to a vein';
    if (kind === 'center') { for (const t of G.towns) if (t.alive && dist(t.x, t.z, x, z) < 70) return 'Too close to another town'; return requireInfluence && !G.inInfluence(x, z) ? 'Outside your influence' : null; }
    if (requireInfluence && town && town.owner === 0 && !G.inInfluence(x, z)) return 'Outside your influence';
    if (town) { const c = G.center(town); if (c && dist(c.x, c.z, x, z) > 70) return 'Too far from the town'; }
    return null;
  }

  function nearWater(G, x, z, r) {
    const T = G.terrain;
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; if (!T.isLand(x + Math.sin(a) * r, z + Math.cos(a) * r)) return true; }
    return false;
  }

  // Civilization-style adjacency: what sits on the six neighbouring hexes (and
  // a few town-wide wonders) multiplies what a building produces. Cached for 2 s.
  function adjacency(G, b) {
    if (b._adj && G.time - b._adj.t < 2) return b._adj;
    const rules = BW.ADJACENCY[b.kind];
    const out = { t: G.time, mul: 1, bonus: 0, notes: [] };
    if (!rules) { b._adj = out; return out; }
    const h = BW.hex.toHex(b.x, b.z);
    const seen = {};
    for (const o of G.buildings) {
      if (o === b || !o.built || o.town !== b.town) continue;
      const d = BW.BUILDINGS[o.kind]; if (d.line || o.kind === 'gate') continue;
      const oh = BW.hex.toHex(o.x, o.z);
      const dq = oh.q - h.q, dr = oh.r - h.r;
      const hexDist = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
      if (hexDist === 1 && rules[o.kind]) { seen[o.kind] = (seen[o.kind] || 0) + 1; out.bonus += rules[o.kind]; }
      if (rules[o.kind + 'Town'] && !seen[o.kind + 'Town']) { seen[o.kind + 'Town'] = 1; out.bonus += rules[o.kind + 'Town']; out.notes.push(BW.BUILDINGS[o.kind].name + ' in town +' + Math.round(rules[o.kind + 'Town'] * 100) + '%'); }
    }
    for (const k in seen) if (!k.endsWith('Town')) out.notes.push(seen[k] + '× ' + BW.BUILDINGS[k].name + ' +' + Math.round(rules[k] * seen[k] * 100) + '%');
    if (rules.water && nearWater(G, b.x, b.z, 9)) { out.bonus += rules.water; out.notes.push('by the water +' + Math.round(rules.water * 100) + '%'); }
    if (rules.highGround && b.y > 11) { out.bonus += rules.highGround; out.notes.push('high ground +' + Math.round(rules.highGround * 100) + '%'); }
    out.bonus = Math.min(rules.cap || 1, out.bonus);
    out.mul = 1 + out.bonus;
    b._adj = out; return out;
  }

  // The one pool used by both the assignment buttons and the "available" count,
  // so the panel never promises villagers that cannot be assigned. Sleepers
  // count (they are woken); children, soldiers, held villagers and anyone away
  // on a mission do not.
  function assignable(G, town, excludeJob, excludeSite) {
    return G.people.filter((p) => p.town === town.id && p.age >= 300 && !p.held && !p.thrown && !p.dead && p.job !== 'soldier' && !p.mission && (p.job === 'idle' || p.job === 'breeder') && !(p.job === excludeJob && (excludeJob === 'forester' ? p.baseId === excludeSite : p.workId === excludeSite)));
  }
  function wake(G, p) {
    if (p.inside) { const h = G.ents.get(p.workId); if (h && h.kind === 'house') { h.garrison = Math.max(0, h.garrison - 1); p.x = h.x + 2.5; p.z = h.z + 2.5; p.y = G.groundY(p.x, p.z); } p.inside = false; }
    if (p.state === 'sleepwalk') { const h = G.ents.get(p.sleepId); if (h) h.garrison = Math.max(0, h.garrison - 1); }
    p.workIdBackup = 0; p.state = 'idle'; p.path = null;
  }

  // Monastery: turn a villager into a missionary or an emissary bound for a rival town.
  function trainHoly(G, b, kind, targetTownId) {
    const town = G.ents.get(b.town); const def = BW.HOLY_UNITS[kind]; if (!town || !def) return false;
    const target = G.ents.get(targetTownId);
    if (!target || !target.alive || target.owner === town.owner) { if (town.owner === 0) G.say('Pick a rival town first.', 'warn'); return false; }
    if (def.cost.prayer && G.god.prayer < def.cost.prayer) { if (town.owner === 0) G.say(`Needs ${def.cost.prayer} prayer.`, 'warn'); return false; }
    const cost = {}; for (const k in def.cost) if (k !== 'prayer') cost[k] = def.cost[k];
    if (!G.canAfford(town, cost)) { if (town.owner === 0) G.say('Not enough ' + Object.keys(cost).join(', ') + '.', 'warn'); return false; }
    const pool = assignable(G, town).sort((p, q) => (p.job === 'idle' ? 0 : 1) - (q.job === 'idle' ? 0 : 1) || BW.dist2(p.x, p.z, b.x, b.z) - BW.dist2(q.x, q.z, b.x, b.z));
    const p = pool[0]; if (!p) { if (town.owner === 0) G.say('No available villagers to train.', 'warn'); return false; }
    if (def.cost.prayer) { G.god.prayer -= def.cost.prayer; G.track(town, 'prayer', -def.cost.prayer); }
    G.pay(town, cost);
    wake(G, p); p.job = kind; p.workId = b.id; p.baseId = 0; p.mission = { town: target.id, phase: 'go', t: 0 };
    G.particles.burst(b.x, b.y + 3, b.z, 16, 2, 0.6, 0xffe9a0, 1.4, 2, 2);
    if (town.owner === 0) { G.say(`${p.name} sets out for ${target.name} as ${kind === 'emissary' ? 'an emissary' : 'a missionary'}.`, 'good'); BW.audio.play('chime'); }
    return true;
  }

  function placeBuilding(G, kind, town, x, z, rot = 0, built = false) {
    const def = BW.BUILDINGS[kind];
    // Clear trees and rocks under the footprint.
    for (const t of G.trees.slice()) if (Math.abs(t.x - x) < def.w / 2 + 0.5 && Math.abs(t.z - z) < def.d / 2 + 0.5) { if (town.owner === 0) G.deposit(town, 'wood', Math.floor(t.wood * 0.5)); G.remove(t); }
    if (kind !== 'mine') for (const r of G.rocks.slice()) if (Math.abs(r.x - x) < def.w / 2 + 0.5 && Math.abs(r.z - z) < def.d / 2 + 0.5) G.remove(r);
    const b = G.addBuilding(kind, town, x, z, rot, built);
    if (kind === 'mine') { const v = G.nearest(G.rocks, x, z, 9); b.vein = v ? v.kind : 'stone'; }
    if (kind === 'field') b.biome = G.terrain.biomeAt(x, z);
    return b;
  }

  function completeBuilding(G, b) {
    const def = BW.BUILDINGS[b.kind];
    b.built = true; b.progress = 1; b.hp = def.hp;
    G.syncBuilding(b);
    G.particles.burst(b.x, b.y + 3, b.z, 30, 4, 1, 0xffe9a0, 1.6, 2, 3);
    if (b.owner === 0) {
      if (!def.line) { BW.audio.play('build'); G.say(def.name + ' completed.', 'good'); }
      if (b.kind === 'wonder') { BW.grantTribute(G, 2, 'Great Pyramid built'); for (const t of G.enemyTowns()) t.loyalty = Math.max(0, t.loyalty - 12); G.say('The Great Pyramid rises. Every tribe in the land is shaken.', 'good'); }
      if (b.kind === 'obelisk' || b.kind === 'terraces') BW.grantTribute(G, 1, def.name + ' built');
      if (b.kind === 'library' && !G.god.stats.libraryMsg) { G.god.stats.libraryMsg = 1; G.say('Assign scholars to the Library: their Insight carries you into the Bronze Age.', 'info'); }
      if (b.kind === 'monastery') G.say('Click the Monastery to send missionaries and emissaries to rival towns.', 'info');
      if (b.kind === 'center' && b.newTown) foundSettlement(G, b);
    }
  }

  // A player-built temple becomes the centre of a new town; its builders move in.
  function foundSettlement(G, b) {
    const n = G.playerTowns().length;
    const t = G.addTown({ name: 'Settlement ' + n, owner: 0, color: 0, x: b.x, z: b.z, centerId: b.id, food: 120, wood: 120, stone: 30, iron: 5, gold: 0 });
    b.town = t.id; b.newTown = false;
    for (const p of G.people) if (p.owner === 0 && p.workId === b.id) { p.town = t.id; p.job = 'idle'; p.workId = 0; }
    G.say(`${t.name} founded! Drop villagers on its temple to move them there.`, 'good');
    BW.grantTribute(G, 2, 'New settlement');
    BW.advise && BW.advise(G, 'settle');
  }

  function damageBuilding(G, b, amount, attackerOwner) {
    if (!b || b.dead) return;
    b.hp -= amount;
    b._dirty = true;
    if (b.hp <= 0) destroyBuilding(G, b, attackerOwner);
  }

  function destroyBuilding(G, b, attackerOwner) {
    if (b.dead) return;
    const town = G.ents.get(b.town);
    G.particles.burst(b.x, b.y + 2, b.z, 60, 8, 1.5, 0x998877, 2, 6, 4);
    G.particles.burst(b.x, b.y + 2, b.z, 30, 5, 1.2, 0xff8833, 2, 2, 3);
    BW.audio.play('thud');
    for (const p of G.people) if (p.inside && p.workId === b.id) { p.inside = false; p.fear = 4; p.fx = b.x; p.fz = b.z; }
    for (const p of G.people) if (p.workId === b.id) p.workId = 0;
    if (b.kind === 'center' && town) {
      const lastPlayerTown = town.owner === 0 && G.playerTowns().length <= 1;
      if (lastPlayerTown) { G.remove(b); BW.townFalls(G, town, attackerOwner, 'destroyed'); return; }
      b.hp = b.maxHp * 0.4; b.fire = 0; b.dead = false; b._dirty = true;
      BW.townFalls(G, town, attackerOwner === undefined ? -1 : attackerOwner, 'captured');
      return;
    }
    if (b.owner === 0 && town) G.say(BW.BUILDINGS[b.kind].name + ' destroyed!', 'bad');
    G.remove(b);
  }

  function igniteBuilding(G, b, amount = 1) {
    if (b.dead) return;
    if (b.fire <= 0 && b.owner === 0 && (!G.lastFireMsg || G.time - G.lastFireMsg > 15)) { G.lastFireMsg = G.time; G.say('Fire! Cast Water on it before it spreads.', 'bad'); }
    b.fire = Math.max(b.fire, amount);
  }
  function igniteTree(G, t, amount = 1) {
    if (t.dead || t.burnt) return;
    if (t.fire <= 0) G.treesDirty = true;
    t.fire = Math.max(t.fire, amount);
  }

  function updateBuildings(G, dt) {
    const list = G.buildings.slice();
    for (const b of list) {
      if (b.dead) continue;
      const def = BW.BUILDINGS[b.kind];
      if (b.fire > 0) {
        b.fire -= dt * 0.04;
        b.hp -= dt * (b.kind === 'center' ? 5 : 7);
        b._dirty = true;
        if (BW.rand() < dt * 20) G.particles.spawn(b.x + (BW.rand() - 0.5) * def.w * 0.8, b.y + 1 + BW.rand() * 3, b.z + (BW.rand() - 0.5) * def.d * 0.8, (BW.rand() - 0.5), 4 + BW.rand() * 3, (BW.rand() - 0.5), 0.9, BW.rand() < 0.5 ? 0xff6a22 : 0xffaa33, 2.4, -2);
        if (BW.rand() < dt * 3) G.particles.spawn(b.x, b.y + 4, b.z, 0, 3, 0, 2.5, 0x333333, 4, -1);
        if (BW.rand() < dt * 0.25 * b.fire) {
          for (const t of G.inRadius(G.trees, b.x, b.z, 8)) if (BW.rand() < 0.3) igniteTree(G, t, 0.8);
          for (const o of G.inRadius(G.buildings, b.x, b.z, 10)) if (o !== b && BW.rand() < 0.25) igniteBuilding(G, o, 0.8);
        }
        if (b.hp <= 0) { destroyBuilding(G, b, b._lastAttacker); continue; }
      }
      if (b.rain > 0) b.rain -= dt;
      // Woodcutter's lodge: saplings sprout around it.
      if (b.kind === 'lodge' && b.built) { b.timer += dt; if (b.timer > 6) { b.timer = 0; if (G.inRadius(G.trees, b.x, b.z, 18).length < 22) { for (let k = 0; k < 8; k++) { const a = BW.rand() * 6.28, r = 6 + BW.rand() * 12; const x = b.x + Math.sin(a) * r, z = b.z + Math.cos(a) * r; if (G.terrain.isLand(x, z) && G.terrain.slopeAt(x, z) < 0.7 && !G.buildingAt(x, z, 1.5) && !G.nearest(G.trees, x, z, 2.5)) { G.addTree(x, z, 0.3); break; } } } } }
      if (b.kind === 'house' && b.built && (G.season === 'winter' || !BW.isDay(G)) && BW.rand() < dt * 1.5) {
        const cs = Math.cos(b.rot), sn = Math.sin(b.rot); const lx = 1.2, lz = 1.0;
        G.particles.spawn(b.x + lx * cs + lz * sn, b.y + 4.3, b.z - lx * sn + lz * cs, (BW.rand() - 0.5) * 0.3, 0.9 + BW.rand() * 0.5, (BW.rand() - 0.5) * 0.3, 3.5, 0x555555, 2.6, -0.05);
      }
      if (b.kind === 'field' && b.built) {
        if (G.weather.kind === 'rain' || G.weather.kind === 'storm') b.rain = Math.max(b.rain || 0, 1);
        let grow = (b.rain > 0 ? 0.02 : 0.003) * (BW.BIOME_GROWTH[b.biome] || 1) * BW.UPGRADE.yield[(b.level || 1) - 1] * adjacency(G, b).mul;
        if (G.season === 'winter') grow *= 0.15; else if (G.weather.kind === 'drought') grow *= 0.4;
        if (b.crop < 1) { b.crop = Math.min(1, b.crop + grow * dt); if (BW.rand() < dt) b._dirty = true; }
      }
      if (b.kind === 'tower' && b.built) {
        b.timer += dt;
        if (b.timer > 0.9) {
          b.timer = 0;
          const lvl = BW.UPGRADE.yield[(b.level || 1) - 1];
          let target = G.nearest(G.people, b.x, b.z, 18 * lvl, (p) => p.owner !== b.owner && (p.job === 'soldier' || G.ents.get(p.town) && G.ents.get(p.town).owner !== b.owner) && !p.inside);
          let isCreature = false;
          const c = G.nearest(G.creatures, b.x, b.z, 22, (cr) => cr.owner !== b.owner);
          if (c && (!target || dist2(c.x, c.z, b.x, b.z) < dist2(target.x, target.z, b.x, b.z))) { target = c; isCreature = true; }
          if (target) {
            const dx = target.x - b.x, dz = target.z - b.z, dy = (target.y + 1) - (b.y + 9), l = Math.hypot(dx, dy, dz);
            for (let k = 0; k < 6; k++) G.particles.spawn(b.x + dx / l * k * 2, b.y + 9 + dy / l * k * 2, b.z + dz / l * k * 2, dx / l * 30, dy / l * 30, dz / l * 30, 0.25, 0xffffff, 1.2);
            if (isCreature) BW.hurtCreature(G, target, 6 * lvl, b.owner); else BW.hurt(G, target, 7 * lvl, b.owner);
          }
        }
      }
      if (b._dirty) { b._dirty = false; G.syncBuilding(b); }
      if (b._mesh) {
        const fl = b._mesh.getObjectByName('flame'); if (fl) fl.scale.setScalar(0.9 + Math.sin(G.time * 9 + b.id) * 0.15);
        const orb = b._mesh.getObjectByName('orb'); if (orb) orb.position.y = (b.kind === 'wonder' ? 11 : 11.4) + Math.sin(G.time * 2 + b.id) * 0.3;
      }
    }
    // Forest regrowth: saplings grow, and every few seconds a thin patch seeds a new one.
    G.regrowT = (G.regrowT || 0) + dt;
    if (G.regrowT > 2) {
      const step = G.regrowT; G.regrowT = 0;
      for (const t of G.trees) if (t.size < 1.3 && !t.burnt && t.fire <= 0) { t.size = Math.min(1.3, t.size + step * 0.004); t.wood = Math.round(30 * t.size); t.hp = 40 * t.size; G.treesDirty = true; }
      for (let k = 0; k < 3 && G.trees.length; k++) { const t = G.trees[Math.floor(BW.rand() * G.trees.length)]; if (t.burnt || t.size < 1) continue; if (G.inRadius(G.trees, t.x, t.z, 10).length < 5) { const a = BW.rand() * 6.28, r = 3 + BW.rand() * 5; const x = t.x + Math.sin(a) * r, z = t.z + Math.cos(a) * r; if (G.terrain.isLand(x, z) && G.terrain.slopeAt(x, z) < 0.7 && !G.buildingAt(x, z, 1.5) && !G.nearest(G.trees, x, z, 2.5)) G.addTree(x, z, 0.3); } }
    }
    // Trees on fire
    let any = false;
    for (const t of G.trees) {
      if (t.fire > 0) {
        any = true;
        t.fire -= dt * 0.05; t.hp -= dt * 10;
        if (BW.rand() < dt * 12) G.particles.spawn(t.x + (BW.rand() - 0.5), t.y + 2 + BW.rand() * 2, t.z + (BW.rand() - 0.5), 0, 3 + BW.rand() * 2, 0, 0.7, 0xff7a22, 2.2, -2);
        if (BW.rand() < dt * 0.3 * t.fire) { for (const o of G.inRadius(G.trees, t.x, t.z, 5.5)) if (o !== t && !o.burnt && o.fire <= 0 && BW.rand() < 0.4) igniteTree(G, o, 0.9); for (const b of G.inRadius(G.buildings, t.x, t.z, 6)) if (BW.rand() < 0.15) igniteBuilding(G, b, 0.7); }
        if (t.hp <= 0 || t.fire <= 0) { t.fire = 0; if (t.hp <= 0) { t.burnt = 1; t.wood = 0; } G.treesDirty = true; }
      }
    }
    if (any && BW.rand() < dt * 2) G.treesDirty = true;
  }

  // Find a valid spot for a building around a center (used by AI and setup).
  function findSpot(G, kind, town, cx, cz, rmin, rmax, rng, tries = 30) {
    for (let i = 0; i < tries; i++) {
      const a = rng.next() * Math.PI * 2, r = rmin + rng.next() * (rmax - rmin);
      let x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      const def = BW.BUILDINGS[kind];
      if (!def.line && kind !== 'gate') { const s = BW.hex.snap(x, z); x = s.x; z = s.z; }
      if (!footprintOk(G, kind, x, z, town, false)) return { x, z, rot: Math.round(a / (Math.PI / 2)) * (Math.PI / 2) };
    }
    return null;
  }

  // Upgrades: pay now, builders raise the level over time.
  function upgradeCost(b) { const def = BW.BUILDINGS[b.kind]; const mul = BW.UPGRADE.costMul[b.level] || 0; const c = {}; for (const k in def.cost) c[k] = Math.round(def.cost[k] * mul); if (b.kind === 'center') { c.stone = (c.stone || 0) + 120 * b.level; c.gold = (c.gold || 0) + 20 * b.level; } return c; }
  function canUpgrade(b) { return BW.UPGRADABLE.includes(b.kind) && b.built && !b.upgrading && (b.level || 1) < BW.UPGRADE.maxLevel; }
  function startUpgrade(G, b) {
    const town = G.ents.get(b.town); if (!town || !canUpgrade(b)) return false;
    const cost = upgradeCost(b);
    if (!G.canAfford(town, cost)) { if (town.owner === 0) G.say('Upgrade costs ' + Object.entries(cost).map(([k, v]) => v + ' ' + k).join(', ') + '.', 'warn'); return false; }
    G.pay(town, cost); b.upgrading = true; b.progress = 0; b._dirty = true;
    if (town.owner === 0) { G.say(`${BW.BUILDINGS[b.kind].name} upgrade started. Builders will raise it to level ${b.level + 1}.`, 'info'); BW.audio.play('place'); }
    return true;
  }
  function finishUpgrade(G, b) {
    b.upgrading = false; b.level = (b.level || 1) + 1; b.progress = 1;
    const def = BW.BUILDINGS[b.kind]; b.maxHp = Math.round(def.hp * BW.UPGRADE.hp[b.level - 1]); b.hp = b.maxHp;
    G._buildBuildingMesh(b); G.navDirty = true;
    G.particles.burst(b.x, b.y + 4, b.z, 40, 5, 1.2, 0xffe9a0, 1.8, 2, 3);
    if (b.owner === 0) { BW.audio.play('build'); G.say(`${def.name} is now level ${b.level}.`, 'good'); }
  }
  // Assign or release workers for a building from the town's idle pool.
  function assignWorkers(G, b, delta) {
    const town = G.ents.get(b.town); if (!town) return;
    const job = (!b.built || b.upgrading) ? 'builder' : BW.WORKER_JOB[b.kind];
    if (!job) return;
    const workers = G.people.filter((p) => p.town === town.id && p.job === job && (job === 'forester' ? p.baseId === b.id : p.workId === b.id));
    const max = job === 'builder' ? 6 : (BW.WORKER_SLOTS[b.kind] || [3, 3, 3])[(b.level || 1) - 1];
    if (delta > 0) {
      if (workers.length >= max) { G.say('No more room for workers there.', 'warn'); return; }
      const pool = assignable(G, town, job, b.id);
      // Prefer the idle, then whoever already knows the job best, then the nearest.
      pool.sort((p, q) => (p.job === 'idle' ? 0 : 1) - (q.job === 'idle' ? 0 : 1) || BW.skillXp(q, job) - BW.skillXp(p, job) || BW.dist2(p.x, p.z, b.x, b.z) - BW.dist2(q.x, q.z, b.x, b.z));
      const p = pool[0]; if (!p) { G.say('No available villagers. Free someone up first (click their building and press −, or drop them on the temple).', 'warn'); return; }
      wake(G, p); p.job = job; if (job === 'forester') { p.baseId = b.id; p.workId = 0; } else p.workId = b.id;
      if (town.owner === 0) G.god.stats.assigned = (G.god.stats.assigned || 0) + 1;
    } else if (workers.length) {
      workers.sort((p, q) => BW.skillXp(p, job) - BW.skillXp(q, job)); // release the least experienced first
      const p = workers[0]; p.job = 'idle'; p.workId = 0; p.baseId = 0; p.state = 'idle'; p.path = null;
    }
  }

  // Lay a stretch of wall or road between two points; pays per segment.
  function placeLine(G, kind, town, ax, az, bx, bz) {
    const def = BW.BUILDINGS[kind];
    const len = dist(ax, az, bx, bz); const n = Math.max(1, Math.round(len / def.w));
    const ang = Math.atan2(bx - ax, bz - az);
    let placed = 0, err = null;
    for (let i = 0; i <= n; i++) {
      const t = n ? i / n : 0; const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const e = footprintOk(G, kind, x, z, town);
      if (e) { err = e; continue; }
      if (!G.canAfford(town, def.cost)) { err = 'Not enough resources'; break; }
      G.pay(town, def.cost); placeBuilding(G, kind, town, x, z, ang); placed++;
    }
    return { placed, err };
  }

  BW.hexOccupied = (G, q, r) => G.buildings.some((b) => { const d = BW.BUILDINGS[b.kind]; if (d.line || b.kind === 'gate') return false; const h = BW.hex.toHex(b.x, b.z); return h.q === q && h.r === r; });
  Object.assign(BW, { adjacency, assignable, nearWater, trainHoly, wake, footprintOk, placeBuilding, completeBuilding, damageBuilding, destroyBuilding, igniteBuilding, igniteTree, updateBuildings, findSpot, placeLine, foundSettlement, upgradeCost, canUpgrade, startUpgrade, finishUpgrade, assignWorkers });
})(window.BW);
