// ---------------------------------------------------------------------------
// people.js — villager brains: needs (food, sleep), jobs, walking with coast
// avoidance, being thrown, fear and death.
// ---------------------------------------------------------------------------
(function (BW) {
  'use strict';
  const { dist, dist2, clamp } = BW;

  const G_ = () => BW.G;

  function isDay(G) { return G.tod > 0.23 && G.tod < 0.79; }

  // Move p toward (x,z). Returns true once within r. Uses the nav grid (A*)
  // when the straight line is blocked, plain steering otherwise.
  function moveToward(G, p, x, z, dt, speed, r = 1.0) {
    const d = dist(p.x, p.z, x, z);
    if (d <= r) { p.path = null; return true; }
    const nav = G.ensureNav();
    if (nav.cost[nav.idx(...nav.toCell(p.x, p.z))] === 6) speed *= 1.4; // road
    if (p.hurry > 0) speed *= 1.3;
    if (p.age < 300 || p.age > 1500) speed *= 0.8;
    const owner = p.owner === undefined ? -1 : p.owner;
    // Targets inside a building (its centre) count as reached from its edge.
    if (d <= r + 4 && !nav.walkableAt(x, z, owner)) { p.path = null; return true; }
    // Path bookkeeping: recompute when the target moved or the nav grid changed.
    if (p.path && (Math.abs(p.pathTx - x) > 2.5 || Math.abs(p.pathTz - z) > 2.5 || p.pathVer !== nav.version)) p.path = null;
    if (!p.path && d > 4) {
      if (nav.lineClear(p.x, p.z, x, z, owner)) p.path = [{ x, z }];
      else if (!(p.pathFail > G.time)) { p.path = nav.find(p.x, p.z, x, z, owner); if (!p.path) p.pathFail = G.time + 2; }
      if (p.path) { p.pathTx = x; p.pathTz = z; p.pathVer = nav.version; }
    }
    let gx = x, gz = z;
    if (p.path && p.path.length) {
      const wp = p.path[0];
      if (dist(p.x, p.z, wp.x, wp.z) < 1.0 && p.path.length > 1) p.path.shift();
      gx = p.path[0].x; gz = p.path[0].z;
    }
    let ang = Math.atan2(gx - p.x, gz - p.z);
    const step = Math.min(speed * dt, d);
    const T = G.terrain;
    const escaping = !nav.walkableAt(p.x, p.z, owner); // standing inside something: walk out
    for (const off of [0, 0.7, -0.7, 1.4, -1.4, 2.2, -2.2]) {
      const a = ang + off;
      const nx = p.x + Math.sin(a) * step, nz = p.z + Math.cos(a) * step;
      if (T.heightAt(nx, nz) > 0.5 && T.inBounds(nx, nz) && (escaping || nav.walkableAt(nx, nz, owner))) {
        p.x = nx; p.z = nz; p.dir = BW.angleLerp(p.dir, a, 0.35); p.y = G.groundY(p.x, p.z);
        return false;
      }
    }
    p.path = null; // stuck: replan next frame
    return false;
  }

  function findFreeHouse(G, town) {
    let best = null;
    for (const b of G.buildings) if (b.town === town.id && b.kind === 'house' && b.built && b.garrison < Math.round(5 * BW.UPGRADE.capacity[(b.level || 1) - 1])) { best = b; break; }
    return best;
  }

  function die(G, p, cause) {
    if (p.dead) return;
    const town = G.ents.get(p.town);
    G.particles.burst(p.x, p.y + 1, p.z, 10, 2, 0.8, 0xdddddd, 1.2, 0.5, 1.5);
    if (p.inside) { const h = G.ents.get(p.workId); if (h && h.kind === 'house') h.garrison = Math.max(0, h.garrison - 1); }
    G.remove(p);
    if (town && town.owner === 0) {
      G.god.deaths = (G.god.deaths || 0) + 1;
      if (cause === 'starved' && (!G.lastStarveMsg || G.time - G.lastStarveMsg > 20)) { G.lastStarveMsg = G.time; G.say('A villager starved to death. Build more fields and assign farmers.', 'bad'); BW.advise && BW.advise(G, 'starve'); }
      if (cause === 'old age' && (!G.lastAgeMsg || G.time - G.lastAgeMsg > 60)) { G.lastAgeMsg = G.time; G.say(`${p.name} died of old age, aged ${Math.floor(p.age / 300)} years.`, 'info'); }
      if (cause === 'plague' && (!G.lastPlagueMsg || G.time - G.lastPlagueMsg > 30)) { G.lastPlagueMsg = G.time; G.say('Plague claims a villager. Cast Heal on the sick.', 'bad'); }
      if (cause === 'cold' && (!G.lastColdMsg || G.time - G.lastColdMsg > 30)) { G.lastColdMsg = G.time; G.say('A villager froze. Keep wood in store through winter.', 'bad'); }
    }
    BW.audio.play('death');
  }

  function hurt(G, p, amount, attackerOwner) {
    p.health -= amount;
    if (p.health <= 0) { die(G, p, 'killed'); if (attackerOwner === 0) G.god.stats.kills++; return true; }
    return false;
  }

  function scare(G, x, z, r, strength = 5) {
    for (const p of G.inRadius(G.people, x, z, r)) { if (p.job === 'soldier') continue; p.fear = strength; p.fx = x; p.fz = z; }
  }

  function countJobs(G, town, people) {
    const c = {}; for (const j of BW.JOBS) c[j] = 0;
    for (const p of people) c[p.job]++;
    return c;
  }

  function deposit(G, p, town) {
    if (!p.carry) return;
    G.deposit(town, p.carry.kind, p.carry.amount);
    p.carry = null;
  }

  function updatePerson(G, p, dt, ctx) {
    if (p.held) { p.timer += dt; return; }
    p.timer += dt; p.age += dt;
    const T = G.terrain;
    if (p.thrown) {
      const th = p.thrown;
      p.x += th.vx * dt; p.z += th.vz * dt; p.y += th.vy * dt; th.vy -= 24 * dt;
      const gy = T.heightAt(p.x, p.z);
      if (!T.inBounds(p.x, p.z) || p.y <= Math.max(gy, 0)) {
        const sp = Math.hypot(th.vx, th.vy, th.vz);
        p.thrown = null; p.state = 'idle';
        if (gy < 0.5 || !T.inBounds(p.x, p.z)) { G.particles.burst(p.x, 0.2, p.z, 14, 3, 0.8, 0x88ccff, 1.4, 2); die(G, p, 'drowned'); return; }
        p.y = gy;
        G.particles.burst(p.x, p.y + 0.3, p.z, 8, 2, 0.5, 0xaa9977, 1, 3);
        BW.audio.play('thud');
        if (sp > 11) { const dmg = (sp - 9) * 4; hurt(G, p, dmg, th.by); }
        // Landing on a hostile building damages it a little.
        const b = G.buildingAt(p.x, p.z);
        if (b && b.owner !== p.owner) BW.damageBuilding(G, b, 15, th.by);
        if (b && b.kind === 'center' && b.owner !== 0 && th.by === 0 && !p.dead) { p.fear = 6; p.fx = b.x; p.fz = b.z; }
      }
      return;
    }

    const town = G.ents.get(p.town);
    if (!town || !town.alive) { // wild: wander sadly
      if (p.timer > 3) { p.timer = 0; p.tx = p.x + (BW.rand() - 0.5) * 12; p.tz = p.z + (BW.rand() - 0.5) * 12; }
      moveToward(G, p, p.tx, p.tz, dt, 3, 1);
      p.hunger += dt * 0.3; if (p.hunger > 100) { p.health -= dt; if (p.health <= 0) die(G, p, 'starved'); }
      return;
    }
    const center = G.center(town);

    // Needs
    let hungerRate = p.inside || p.state === 'sleep' ? 0.15 : p.job === 'worshipper' ? 0.85 : p.job === 'soldier' ? 0.35 : 0.5;
    if (p.trait === 'hardy') hungerRate *= 0.7;
    if (G.season === 'winter') hungerRate *= 1.2;
    p.hunger += dt * hungerRate;
    if (p.job === 'soldier') p.hunger = Math.min(p.hunger, 90); // soldiers forage; they never starve
    if (p.hurry > 0) p.hurry -= dt;
    if (p.sick > 0) { p.sick -= dt; p.health -= dt * 0.25; if (p.health <= 0) { die(G, p, 'plague'); return; } if (BW.rand() < dt * 0.02) { const q = G.nearest(G.people, p.x, p.z, 4, (o) => o !== p && o.sick <= 0 && o.town === p.town); if (q) q.sick = 90; } }
    if (p.age > p.lifespan) { die(G, p, 'old age'); return; }
    if (town.owner === 0 && G.season === 'winter' && town.wood <= 0 && !p.inside) { p.health -= dt * 0.15; p.cold = 1; if (p.health <= 0) { die(G, p, 'cold'); return; } } else p.cold = 0;
    updateNeeds(G, p, town, dt);
    if (p.hunger >= 100) { p.hunger = 100; p.health -= dt * 0.7; if (p.health <= 0) { die(G, p, 'starved'); return; } }
    else if (p.health < p.maxHealth) p.health = Math.min(p.maxHealth, p.health + dt * 0.4);

    if (p.fear > 0) {
      p.fear -= dt; p.state = 'flee';
      if (p.inside) { p.inside = false; }
      const ax = p.x - p.fx, az = p.z - p.fz, l = Math.hypot(ax, az) || 1;
      moveToward(G, p, p.x + ax / l * 6, p.z + az / l * 6, dt, 7.5, 0.5);
      return;
    }

    if (p.job === 'soldier') return; // army.js drives soldiers
    if (p.age < 300 && p.job !== 'idle') { p.job = 'idle'; p.workId = 0; } // children play

    // Sleep at night in a house.
    const day = isDay(G);
    if (p.inside) {
      const h = G.ents.get(p.workId);
      if (day || !h || h.dead || p.hunger > 85) { p.inside = false; p.state = 'idle'; if (h && !h.dead) h.garrison = Math.max(0, h.garrison - 1); if (h) { p.x = h.x + 2.5; p.z = h.z + 2.5; p.y = G.groundY(p.x, p.z); } }
      return;
    }
    if (!day && p.job !== 'builder' && p.hunger < 80) {
      if (p.state !== 'sleepwalk') {
        const h = findFreeHouse(G, town);
        if (h) { p.state = 'sleepwalk'; p.sleepId = h.id; h.garrison++; }
        else { p.state = 'sleep'; p.slept = 0; }
      }
      if (p.state === 'sleepwalk') {
        const h = G.ents.get(p.sleepId);
        if (!h || h.dead) { p.state = 'idle'; return; }
        if (moveToward(G, p, h.x, h.z, dt, p.speed, 2.2)) { p.inside = true; p.workIdBackup = p.workId; p.workId = h.id; p.state = 'sleep'; p.slept = 1; }
        return;
      }
      if (p.state === 'sleep' && p.hunger < 85) return;
      if (p.state === 'sleep') p.state = 'idle';
    } else if (p.state === 'sleepwalk') { const h = G.ents.get(p.sleepId); if (h) h.garrison = Math.max(0, h.garrison - 1); p.state = 'idle'; }
    else if (p.state === 'sleep') p.state = 'idle';
    if (p.workIdBackup) { p.workId = p.workIdBackup; p.workIdBackup = 0; }

    // Eat when hungry.
    if (p.hunger > 62 && center && (town.food >= 5 || p.hunger > 95)) {
      if (p.state !== 'eatwalk') { p.state = 'eatwalk'; }
      if (moveToward(G, p, center.x, center.z, dt, p.speed, 5.5)) {
        if (town.food >= 5) { town.food -= 5; p.hunger = Math.max(0, p.hunger - 70); G.particles.burst(p.x, p.y + 1.5, p.z, 4, 1, 0.5, 0xd9b24c, 1.2); }
        else p.hunger = Math.max(60, p.hunger - 3);
        p.state = 'idle';
      }
      return;
    }
    if (p.state === 'eatwalk') p.state = 'idle';

    switch (p.job) {
      case 'farmer': return doFarmer(G, p, town, center, dt);
      case 'forester': return doGather(G, p, town, center, dt, 'tree');
      case 'miner': { const m = G.ents.get(p.workId); if (m && m.type === 'building' && m.kind === 'mine' && m.built && !m.dead) return doMine(G, p, town, center, dt, m); const mine = G.nearest(G.buildings, p.x, p.z, 400, (x) => x.town === town.id && x.kind === 'mine' && x.built && G.people.filter((q) => q.workId === x.id && q.job === 'miner').length < 3); if (mine) { p.workId = mine.id; return; } return doGather(G, p, town, center, dt, 'rock'); }
      case 'builder': return doBuilder(G, p, town, center, dt);
      case 'breeder': return doBreeder(G, p, town, center, dt);
      case 'worshipper': return doWorship(G, p, town, center, dt);
      default: return doIdle(G, p, town, center, dt);
    }
  }

  function workRate(G, p) { let r = 1; if (p.trait === 'strong') r *= 1.3; if (p.hurry > 0) r *= 2; if (p.age > 1500) r *= 0.7; if (p.happy < 0.4) r *= 0.75; return r; }

  function goDeposit(G, p, center, dt) {
    if (!center) { p.carry = null; return true; }
    p.state = 'walk';
    if (moveToward(G, p, center.x, center.z, dt, p.speed, 6)) { deposit(G, p, G.ents.get(p.town)); p.state = 'idle'; BW.audio && BW.rand() < 0.2 && BW.audio.play('drop'); return true; }
    return false;
  }

  function doIdle(G, p, town, center, dt) {
    if (!center) return;
    if (dist(p.x, p.z, center.x, center.z) > 24) { p.state = 'walk'; moveToward(G, p, center.x, center.z, dt, p.speed, 12); return; }
    if (p.timer > 2 + BW.rand() * 3) { p.timer = 0; const a = BW.rand() * 6.28, r = 5 + BW.rand() * 12; p.tx = center.x + Math.sin(a) * r; p.tz = center.z + Math.cos(a) * r; p.state = 'walk'; }
    if (p.state === 'walk' && moveToward(G, p, p.tx, p.tz, dt, p.speed * 0.6, 1)) p.state = 'idle';
  }

  function doFarmer(G, p, town, center, dt) {
    if (p.carry) return goDeposit(G, p, center, dt);
    let f = G.ents.get(p.workId);
    if (!f || f.dead || f.kind !== 'field' || !f.built || f.town !== town.id) {
      const fields = G.buildings.filter((b) => b.town === town.id && b.kind === 'field' && b.built);
      if (!fields.length) { p.job = 'idle'; return; }
      // Pick the field with the fewest farmers.
      const counts = new Map();
      for (const q of G.people) if (q.job === 'farmer' && q.town === town.id && q.workId) counts.set(q.workId, (counts.get(q.workId) || 0) + 1);
      fields.sort((a, b) => (counts.get(a.id) || 0) - (counts.get(b.id) || 0) || dist2(a.x, a.z, p.x, p.z) - dist2(b.x, b.z, p.x, p.z));
      f = fields[0]; p.workId = f.id;
    }
    p.state = 'walk';
    if (moveToward(G, p, f.x + Math.sin(p.id) * 2, f.z + Math.cos(p.id) * 2, dt, p.speed, 1.2)) {
      p.state = 'work'; p.dir += dt * 0.5;
      f.crop = Math.min(1, f.crop + dt * 0.035 * (f.rain > 0 ? 3 : 1) * workRate(G, p) * (BW.BIOME_GROWTH[f.biome] || 1) * BW.UPGRADE.yield[(f.level || 1) - 1] * (G.season === 'winter' ? 0.2 : G.weather.kind === 'drought' ? 0.5 : 1));
      f._dirty = true;
      if (f.crop >= 1) { f.crop = 0.05; p.carry = { kind: 'food', amount: 28 }; G.particles.burst(f.x, f.y + 1, f.z, 8, 2, 0.6, 0xe0c040, 1.2, 2); }
    }
  }

  function doGather(G, p, town, center, dt, kind) {
    if (p.carry) return goDeposit(G, p, center, dt);
    const list = kind === 'tree' ? G.trees : G.rocks;
    let t = G.ents.get(p.workId);
    const ok = (e) => e && !e.dead && (kind === 'tree' ? (e.wood > 0 && e.fire <= 0 && !e.burnt) : e.ore > 0);
    if (!ok(t) || t.type !== kind) {
      if (!center) { p.job = 'idle'; return; }
      const base = kind === 'tree' && p.baseId ? G.ents.get(p.baseId) : null;
      t = base && !base.dead ? G.nearest(list, base.x, base.z, 26, (e) => ok(e) && e.size >= 0.6) : null;
      if (!t) t = G.nearest(list, center.x, center.z, 110, kind === 'tree' ? (e) => ok(e) && e.size >= 0.6 : ok);
      if (!t) { p.job = 'idle'; if (town.owner === 0 && (!G.lastNoRes || G.time - G.lastNoRes > 30)) { G.lastNoRes = G.time; G.say(kind === 'tree' ? "No trees left near your town. Build a Woodcutter's lodge so the forest regrows." : 'No rocks left near your town. Build a Mine next to a vein.', 'warn'); } return; }
      p.workId = t.id;
    }
    if (!moveToward(G, p, t.x, t.z, dt, p.speed, 1.6)) { p.state = 'walk'; p.workTimer = 0; }
    else {
      p.state = 'work';
      p.workTimer = (p.workTimer || 0) + dt * workRate(G, p);
      if (p.workTimer >= (kind === 'tree' ? 4 : 5)) {
        p.workTimer = 0;
        if (kind === 'tree') {
          const take = Math.min(10, t.wood); t.wood -= take; p.carry = { kind: 'wood', amount: take };
          G.particles.burst(t.x, t.y + 1, t.z, 6, 2, 0.5, 0xa07040, 1, 3);
          if (t.wood <= 0) G.remove(t);
        } else {
          const take = Math.min(8, t.ore); t.ore -= take; p.carry = { kind: t.kind || 'stone', amount: take };
          G.particles.burst(t.x, t.y + 1, t.z, 6, 2, 0.5, 0xbbbbcc, 1, 3);
          if (t.ore <= 0) G.remove(t);
        }
        p.state = 'idle';
      }
    }
  }

  // Miners at a mine dig its vein forever.
  function doMine(G, p, town, center, dt, mine) {
    if (p.carry) return goDeposit(G, p, center, dt);
    if (!moveToward(G, p, mine.x + Math.sin(p.id) * 3.2, mine.z + Math.cos(p.id) * 3.2, dt, p.speed, 1.0)) { p.state = 'walk'; p.workTimer = 0; }
    else {
      p.state = 'work';
      p.workTimer = (p.workTimer || 0) + dt * workRate(G, p);
      if (p.workTimer >= 5) { p.workTimer = 0; p.carry = { kind: mine.vein || 'stone', amount: Math.round((mine.vein === 'gold' ? 4 : mine.vein === 'iron' ? 6 : 8) * BW.UPGRADE.yield[(mine.level || 1) - 1]) }; G.particles.burst(mine.x, mine.y + 2, mine.z, 6, 2, 0.5, BW.RES_COLORS[mine.vein] || 0xbbbbcc, 1, 3); p.state = 'idle'; }
    }
  }

  function doBuilder(G, p, town, center, dt) {
    let s = G.ents.get(p.workId);
    if (!s || s.dead || s.type !== 'building' || (s.built && !s.upgrading && s.hp >= s.maxHp)) {
      s = G.nearest(G.buildings, p.x, p.z, 400, (b) => b.town === town.id && (!b.built || b.upgrading)) || G.nearest(G.buildings, p.x, p.z, 400, (b) => b.town === town.id && b.built && b.hp < b.maxHp * 0.8 && b.fire <= 0);
      if (!s) { p.job = 'idle'; return; }
      p.workId = s.id;
    }
    const def = BW.BUILDINGS[s.kind];
    if (s.upgrading) {
      p.state = 'walk';
      if (moveToward(G, p, s.x + Math.sin(p.id) * (def.w / 2 + 1), s.z + Math.cos(p.id) * (def.d / 2 + 1), dt, p.speed, 1.2)) {
        p.state = 'work'; s.progress += dt / BW.UPGRADE.time[s.level] * workRate(G, p); s._dirty = true;
        if (BW.rand() < dt * 3) G.particles.burst(s.x + (BW.rand() - 0.5) * def.w, s.y + 3, s.z + (BW.rand() - 0.5) * def.d, 2, 1.5, 0.4, 0xffd080, 1, 3);
        if (s.progress >= 1) BW.finishUpgrade(G, s);
      }
      return;
    }
    if (s.built) { // repair
      p.state = 'walk';
      if (moveToward(G, p, s.x + Math.sin(p.id) * (def.w / 2 + 1), s.z + Math.cos(p.id) * (def.d / 2 + 1), dt, p.speed, 1.2)) { p.state = 'work'; s.hp = Math.min(s.maxHp, s.hp + dt * s.maxHp / def.buildTime * 0.5); s._dirty = true; }
      return;
    }
    p.state = 'walk';
    if (moveToward(G, p, s.x + Math.sin(p.id) * (def.w / 2 + 1), s.z + Math.cos(p.id) * (def.d / 2 + 1), dt, p.speed, 1.2)) {
      p.state = 'work';
      s.progress += dt / def.buildTime * workRate(G, p);
      s.hp = Math.min(s.maxHp, s.hp + dt / def.buildTime * s.maxHp * 0.8);
      s._dirty = true;
      if (BW.rand() < dt * 3) G.particles.burst(s.x + (BW.rand() - 0.5) * def.w, s.y + 2, s.z + (BW.rand() - 0.5) * def.d, 2, 1.5, 0.4, 0xffd080, 1, 3);
      if (s.progress >= 1) BW.completeBuilding(G, s);
    }
  }

  function doBreeder(G, p, town, center, dt) {
    let h = G.ents.get(p.workId);
    if (!h || h.dead || h.kind !== 'house' || h.town !== town.id) {
      const houses = G.buildings.filter((b) => b.town === town.id && b.kind === 'house' && b.built);
      if (!houses.length) { p.job = 'idle'; return; }
      h = houses[p.id % houses.length]; p.workId = h.id;
    }
    if (dist(p.x, p.z, h.x, h.z) > 6) { p.state = 'walk'; moveToward(G, p, h.x, h.z, dt, p.speed, 4); return; }
    if (p.timer > 3) { p.timer = 0; p.tx = h.x + (BW.rand() - 0.5) * 7; p.tz = h.z + (BW.rand() - 0.5) * 7; p.state = 'walk'; }
    if (p.state === 'walk' && moveToward(G, p, p.tx, p.tz, dt, p.speed * 0.5, 0.8)) p.state = 'idle';
  }

  function doWorship(G, p, town, center, dt) {
    let a = G.ents.get(p.workId);
    if (!a || a.dead || a.kind !== 'altar' || !a.built || a.town !== town.id) {
      a = G.nearest(G.buildings, p.x, p.z, 400, (b) => b.town === town.id && b.kind === 'altar' && b.built);
      if (!a) { p.job = 'idle'; return; }
      p.workId = a.id;
    }
    p.state = 'walk';
    const ang = p.id * 1.7;
    if (moveToward(G, p, a.x + Math.sin(ang) * 3.4, a.z + Math.cos(ang) * 3.4, dt, p.speed, 0.8)) {
      p.state = 'work'; p.dir = Math.atan2(a.x - p.x, a.z - p.z);
      if (town.owner === 0) {
        const rate = 0.9 * (G.hasUnlock('g_prayer') ? 1.6 : 1) * (p.trait === 'pious' ? 1.5 : 1) * (0.6 + 0.6 * (town.happiness === undefined ? 0.8 : town.happiness)) * BW.UPGRADE.yield[(a.level || 1) - 1];
        G.god.prayer = Math.min(G.god.maxPrayer, G.god.prayer + rate * dt);
      } else {
        town.loyalty = Math.min(100, town.loyalty + dt * 0.08);
      }
      if (BW.rand() < dt * 0.6) G.particles.spawn(p.x, p.y + 1.8, p.z, 0, 1.5, 0, 1.2, 0xffe9a0, 1.5);
    }
  }

  function updateNeeds(G, p, town, dt) {
    const n = p.needs;
    n.food = clamp(1 - p.hunger / 100, 0, 1);
    n.home = town.cap ? clamp(town.cap / Math.max(1, town.pop || 1), 0, 1) : 0;
    n.worship = town.hasAltar ? 1 : 0.35;
    n.safety = clamp(1 - (town.fearRecent || 0) / 60 + (town.guards >= 3 ? 0.35 : 0), 0, 1) * (p.sick > 0 ? 0.5 : 1);
    n.rest = p.slept ? 1 : 0.5;
    p.happy = n.food * 0.35 + n.home * 0.2 + n.worship * 0.15 + n.safety * 0.2 + n.rest * 0.1;
    if (p.trait === 'pious' && !town.hasAltar) p.happy -= 0.1;
    // The loudest unmet need becomes a visible desire.
    let worst = null, wv = 0.45;
    for (const k in n) if (n[k] < wv) { wv = n[k]; worst = k; }
    if (p.sick > 0) worst = 'sick';
    if (p.cold) worst = 'cold';
    p.desire = worst || '';
  }

  function updatePeople(G, dt) {
    for (const b of G.buildings) if (b.kind === 'house') b.garrison = 0;
    for (const p of G.people) if (p.inside) { const h = G.ents.get(p.workId); if (h) h.garrison++; }
    for (const p of G.people) if (p.state === 'sleepwalk') { const h = G.ents.get(p.sleepId); if (h) h.garrison++; }
    // Iterate over a copy: people may die during the update. Villagers far
    // from the camera tick every third frame with a scaled dt (simulation LOD).
    const list = G.people.slice();
    const cam = G.camera; const cx = cam ? cam.tx : 0, cz = cam ? cam.tz : 0;
    const near2 = 260 * 260; const frame = G.frame;
    for (const p of list) {
      if (p.dead) continue;
      const far = (p.x - cx) * (p.x - cx) + (p.z - cz) * (p.z - cz) > near2;
      if (far) { if ((frame + p.id) % 3 !== 0) continue; updatePerson(G, p, dt * 3); }
      else updatePerson(G, p, dt);
    }
  }

  Object.assign(BW, { updatePeople, moveToward, die, hurt, scare, isDay, countJobs, workRate });
})(window.BW);
