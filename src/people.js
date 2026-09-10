// ---------------------------------------------------------------------------
// people.js — villager brains: needs (food, sleep), jobs, walking with coast
// avoidance, being thrown, fear and death.
// ---------------------------------------------------------------------------
(function (BW) {
  'use strict';
  const { dist, dist2, clamp } = BW;

  const G_ = () => BW.G;

  function isDay(G) { return G.tod > 0.23 && G.tod < 0.79; }

  // Move p toward (x,z). Returns true once within r. Avoids water by steering.
  function moveToward(G, p, x, z, dt, speed, r = 1.0) {
    const d = dist(p.x, p.z, x, z);
    if (d <= r) return true;
    let ang = Math.atan2(x - p.x, z - p.z);
    const step = Math.min(speed * dt, d);
    const T = G.terrain;
    for (const off of [0, 0.7, -0.7, 1.4, -1.4, 2.2, -2.2]) {
      const a = ang + off;
      const nx = p.x + Math.sin(a) * step, nz = p.z + Math.cos(a) * step;
      if (T.heightAt(nx, nz) > 0.5 && T.inBounds(nx, nz)) {
        p.x = nx; p.z = nz; p.dir = BW.angleLerp(p.dir, a, 0.35); p.y = G.groundY(p.x, p.z);
        return false;
      }
    }
    return false; // stuck; try again next frame
  }

  function findFreeHouse(G, town) {
    let best = null;
    for (const b of G.buildings) if (b.town === town.id && b.kind === 'house' && b.built && b.garrison < 5) { best = b; break; }
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
      if (cause === 'starved' && (!G.lastStarveMsg || G.time - G.lastStarveMsg > 20)) { G.lastStarveMsg = G.time; G.say('A villager starved to death. Build more fields and assign farmers.', 'bad'); }
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
      if (p.timer > 3) { p.timer = 0; p.tx = p.x + (Math.random() - 0.5) * 12; p.tz = p.z + (Math.random() - 0.5) * 12; }
      moveToward(G, p, p.tx, p.tz, dt, 3, 1);
      p.hunger += dt * 0.3; if (p.hunger > 100) { p.health -= dt; if (p.health <= 0) die(G, p, 'starved'); }
      return;
    }
    const center = G.center(town);

    // Needs
    p.hunger += dt * (p.inside || p.state === 'sleep' ? 0.15 : p.job === 'worshipper' ? 0.85 : p.job === 'soldier' ? 0.35 : 0.5);
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
        else { p.state = 'sleep'; }
      }
      if (p.state === 'sleepwalk') {
        const h = G.ents.get(p.sleepId);
        if (!h || h.dead) { p.state = 'idle'; return; }
        if (moveToward(G, p, h.x, h.z, dt, p.speed, 2.2)) { p.inside = true; p.workIdBackup = p.workId; p.workId = h.id; p.state = 'sleep'; }
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
      case 'miner': return doGather(G, p, town, center, dt, 'rock');
      case 'builder': return doBuilder(G, p, town, center, dt);
      case 'breeder': return doBreeder(G, p, town, center, dt);
      case 'worshipper': return doWorship(G, p, town, center, dt);
      default: return doIdle(G, p, town, center, dt);
    }
  }

  function goDeposit(G, p, center, dt) {
    if (!center) { p.carry = null; return true; }
    p.state = 'walk';
    if (moveToward(G, p, center.x, center.z, dt, p.speed, 6)) { deposit(G, p, G.ents.get(p.town)); p.state = 'idle'; BW.audio && Math.random() < 0.2 && BW.audio.play('drop'); return true; }
    return false;
  }

  function doIdle(G, p, town, center, dt) {
    if (!center) return;
    if (dist(p.x, p.z, center.x, center.z) > 24) { p.state = 'walk'; moveToward(G, p, center.x, center.z, dt, p.speed, 12); return; }
    if (p.timer > 2 + Math.random() * 3) { p.timer = 0; const a = Math.random() * 6.28, r = 5 + Math.random() * 12; p.tx = center.x + Math.sin(a) * r; p.tz = center.z + Math.cos(a) * r; p.state = 'walk'; }
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
      f.crop = Math.min(1, f.crop + dt * 0.035 * (f.rain > 0 ? 3 : 1));
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
      t = G.nearest(list, center.x, center.z, 110, ok);
      if (!t) { p.job = 'idle'; if (town.owner === 0 && (!G.lastNoRes || G.time - G.lastNoRes > 30)) { G.lastNoRes = G.time; G.say(kind === 'tree' ? 'No trees left near your town. Foresters have gone idle.' : 'No rocks left near your town. Miners have gone idle.', 'warn'); } return; }
      p.workId = t.id;
    }
    p.state = 'walk';
    if (moveToward(G, p, t.x, t.z, dt, p.speed, 1.6)) {
      if (p.state !== 'work') { p.state = 'work'; p.workTimer = 0; }
      p.workTimer += dt;
      if (p.workTimer >= (kind === 'tree' ? 4 : 5)) {
        p.workTimer = 0;
        if (kind === 'tree') {
          const take = Math.min(10, t.wood); t.wood -= take; p.carry = { kind: 'wood', amount: take };
          G.particles.burst(t.x, t.y + 1, t.z, 6, 2, 0.5, 0xa07040, 1, 3);
          if (t.wood <= 0) G.remove(t);
        } else {
          const take = Math.min(8, t.ore); t.ore -= take; p.carry = { kind: 'ore', amount: take };
          G.particles.burst(t.x, t.y + 1, t.z, 6, 2, 0.5, 0xbbbbcc, 1, 3);
          if (t.ore <= 0) G.remove(t);
        }
        p.state = 'idle';
      }
    }
  }

  function doBuilder(G, p, town, center, dt) {
    let s = G.ents.get(p.workId);
    if (!s || s.dead || s.type !== 'building' || (s.built && s.hp >= s.maxHp)) {
      s = G.nearest(G.buildings, p.x, p.z, 400, (b) => b.town === town.id && !b.built) || G.nearest(G.buildings, p.x, p.z, 400, (b) => b.town === town.id && b.built && b.hp < b.maxHp * 0.8 && b.fire <= 0);
      if (!s) { p.job = 'idle'; return; }
      p.workId = s.id;
    }
    const def = BW.BUILDINGS[s.kind];
    if (s.built) { // repair
      p.state = 'walk';
      if (moveToward(G, p, s.x + Math.sin(p.id) * (def.w / 2 + 1), s.z + Math.cos(p.id) * (def.d / 2 + 1), dt, p.speed, 1.2)) { p.state = 'work'; s.hp = Math.min(s.maxHp, s.hp + dt * s.maxHp / def.buildTime * 0.5); s._dirty = true; }
      return;
    }
    p.state = 'walk';
    if (moveToward(G, p, s.x + Math.sin(p.id) * (def.w / 2 + 1), s.z + Math.cos(p.id) * (def.d / 2 + 1), dt, p.speed, 1.2)) {
      p.state = 'work';
      s.progress += dt / def.buildTime;
      s.hp = Math.min(s.maxHp, s.hp + dt / def.buildTime * s.maxHp * 0.8);
      s._dirty = true;
      if (Math.random() < dt * 3) G.particles.burst(s.x + (Math.random() - 0.5) * def.w, s.y + 2, s.z + (Math.random() - 0.5) * def.d, 2, 1.5, 0.4, 0xffd080, 1, 3);
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
    if (p.timer > 3) { p.timer = 0; p.tx = h.x + (Math.random() - 0.5) * 7; p.tz = h.z + (Math.random() - 0.5) * 7; p.state = 'walk'; }
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
        const rate = 0.9 * (G.hasUnlock('g_prayer') ? 1.6 : 1);
        G.god.prayer = Math.min(G.god.maxPrayer, G.god.prayer + rate * dt);
      } else {
        town.loyalty = Math.min(100, town.loyalty + dt * 0.08);
      }
      if (Math.random() < dt * 0.6) G.particles.spawn(p.x, p.y + 1.8, p.z, 0, 1.5, 0, 1.2, 0xffe9a0, 1.5);
    }
  }

  function updatePeople(G, dt) {
    for (const b of G.buildings) if (b.kind === 'house') b.garrison = 0;
    for (const p of G.people) if (p.inside) { const h = G.ents.get(p.workId); if (h) h.garrison++; }
    for (const p of G.people) if (p.state === 'sleepwalk') { const h = G.ents.get(p.sleepId); if (h) h.garrison++; }
    // Iterate over a copy: people may die during the update.
    const list = G.people.slice();
    for (const p of list) if (!p.dead) updatePerson(G, p, dt);
  }

  Object.assign(BW, { updatePeople, moveToward, die, hurt, scare, isDay, countJobs });
})(window.BW);
