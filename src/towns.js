// ---------------------------------------------------------------------------
// towns.js — town economy (births, auto jobs), player god bookkeeping,
// impressiveness/loyalty conversion, and the enemy town AI.
// ---------------------------------------------------------------------------
(function (BW) {
  'use strict';
  const { dist, dist2, clamp } = BW;

  function grantTribute(G, n, why) {
    G.god.tribute += n;
    G.say(`+${n} Tribute: ${why}`, 'tribute');
    BW.audio.play('chime');
  }

  function assignJobs(G, town, people) {
    const counts = BW.countJobs(G, town, people);
    const idle = people.filter((p) => p.job === 'idle' && !p.held && !p.thrown);
    if (!idle.length) return;
    const fields = G.buildings.filter((b) => b.town === town.id && b.kind === 'field' && b.built).length;
    const sites = G.buildings.filter((b) => b.town === town.id && (!b.built || b.hp < b.maxHp * 0.8)).length;
    const altars = G.buildings.filter((b) => b.town === town.id && b.kind === 'altar' && b.built).length;
    const houses = G.buildings.filter((b) => b.town === town.id && b.kind === 'house' && b.built).length;
    const pop = people.length;
    const wants = [
      ['builder', sites ? Math.min(4, sites * 2) : 0],
      ['farmer', Math.min(fields, Math.ceil(pop * 0.35)) + (town.food < 60 ? 1 : 0)],
      ['forester', town.wood < 120 ? 3 : town.wood < 400 ? 2 : 1],
      ['miner', town.ore < 150 && G.rocks.length ? (town.owner === 0 ? 1 : 2) : 0],
      ['worshipper', altars ? 2 + Math.floor(pop / 7) : 0],
      ['breeder', houses ? 1 + Math.floor(pop / 12) : 0],
    ];
    for (const [job, want] of wants) {
      while (counts[job] < want && idle.length) { const p = idle.pop(); p.job = job; p.workId = 0; counts[job]++; }
    }
  }

  function spawnBirth(G, town, people) {
    const houses = G.buildings.filter((b) => b.town === town.id && b.kind === 'house' && b.built);
    const at = houses.length ? houses[Math.floor(Math.random() * houses.length)] : G.center(town);
    if (!at) return;
    const p = G.addPerson(town, at.x + (Math.random() - 0.5) * 5, at.z + 3 + Math.random() * 2, 'idle');
    G.particles.burst(p.x, p.y + 1, p.z, 8, 1.5, 0.8, 0xffffff, 1.2, 0.3, 1.5);
    if (town.owner === 0) BW.audio.play('birth');
  }

  function migrate(G, p, toTown) {
    const from = G.ents.get(p.town);
    if (p.inside) { const h = G.ents.get(p.workId); if (h) h.garrison = Math.max(0, h.garrison - 1); p.inside = false; }
    if (p.platoon) { const pl = G.ents.get(p.platoon); if (pl) { const i = pl.members.indexOf(p.id); if (i >= 0) pl.members.splice(i, 1); if (!pl.members.length) G.remove(pl); } p.platoon = 0; }
    p.town = toTown.id; p.owner = toTown.owner; p.job = 'idle'; p.workId = 0; p.state = 'idle'; p.carry = null; p.maxHealth = 30; p.health = Math.min(p.health, 30);
    return from;
  }

  function townFalls(G, town, newOwner, how) {
    if (!town.alive) return;
    const old = town.owner;
    const newTown = newOwner === 0 ? G.playerTown() : G.towns.find((t) => t.owner === newOwner && t.alive && t !== town);
    if (old === 0) {
      // Player lost a town.
      const remaining = G.playerTowns().filter((t) => t !== town);
      if (!remaining.length) { town.alive = false; G.onDefeat && G.onDefeat(); return; }
      G.say(`${town.name} has fallen to the enemy!`, 'bad');
    }
    // Flip ownership of everything.
    const ownerTown = G.towns.find((t) => t.owner === newOwner && t.alive);
    town.owner = newOwner; town.loyalty = 100; town.ai = newOwner === 0 ? null : (ownerTown && ownerTown.ai ? Object.assign({}, ownerTown.ai, { timers: {} }) : { aggression: 0.4, timers: {} });
    town.color = ownerTown ? ownerTown.color : (newOwner === 0 ? 0 : town.color);
    town.autoJobs = true;
    for (const b of G.buildings) if (b.town === town.id) { b.owner = newOwner; b.fire = 0; }
    for (const p of G.people) if (p.town === town.id) { p.owner = newOwner; if (p.job === 'soldier') { p.job = 'idle'; p.platoon = 0; } p.fear = 0; }
    for (const pl of G.platoons.slice()) if (pl.town === town.id) G.remove(pl);
    if (how === 'destroyed') {
      // Rebuild a center for the new owner.
      const c = BW.placeBuilding(G, 'center', town, town.x, town.z, 0, true);
      c.hp = c.maxHp * 0.5; town.centerId = c.id;
    }
    G.rebuildOwnerMeshes(town);
    for (const c of G.creatures.slice()) if (c.owner === old && old !== 0) {
      const other = G.towns.find((t) => t.owner === old && t.alive);
      if (!other) { G.say(`The enemy ${c.name} flees the land.`, 'info'); G.particles.burst(c.x, c.y + 3, c.z, 40, 6, 1.5, 0x9999ff, 2.5); G.remove(c); }
    }
    if (newOwner === 0) {
      G.say(`${town.name} ${how === 'destroyed' ? 'has been conquered' : 'now worships you'}!`, 'good');
      BW.audio.play('win');
      grantTribute(G, 5, 'Town won');
      if (how === 'destroyed') BW.shiftAlignment(G, -0.08); else BW.shiftAlignment(G, 0.05);
    }
  }

  function shiftAlignment(G, d) {
    G.god.alignment = clamp(G.god.alignment + d, -1, 1);
    G.alignmentDirty = true;
  }

  // ------------------------------------------------------------------ AI
  function enemyAI(G, town, people, dt) {
    const ai = town.ai; if (!ai) return;
    const T = ai.timers;
    T.think = (T.think || 0) + dt;
    const center = G.center(town);
    if (!center) return;
    const rng = G.rng;
    // Slight passive income keeps the AI from stalling.
    town.food += dt * 0.35; town.wood += dt * 0.45; town.ore += dt * (ai.aggression > 0.2 ? 0.25 : 0.1);
    if (T.think < 3) return;
    T.think = 0;
    const pop = people.length, cap = G.townCapacity(town);
    const bs = G.townBuildings(town);
    const count = (k, builtOnly) => bs.filter((b) => b.kind === k && (!builtOnly || b.built)).length;
    const sites = bs.filter((b) => !b.built).length;
    if (sites < 2) {
      let kind = null;
      if (pop >= cap - 3 && town.wood >= 40) kind = 'house';
      else if (count('field') < Math.ceil(pop / 5) && town.wood >= 15) kind = 'field';
      else if (!count('altar') && pop >= 10 && town.wood >= 90) kind = 'altar';
      else if (!count('armory') && ai.aggression > 0.15 && pop >= 14 && town.wood >= 160 && town.ore >= 60) kind = 'armory';
      else if (ai.aggression > 0.4 && count('tower') < 2 && pop > 18 && town.wood >= 90 && town.ore >= 50) kind = 'tower';
      else if (pop > 28 && !count('wonder') && town.wood >= 450 && town.ore >= 180) kind = 'wonder';
      else if (town.wood >= 60 && count('house') < pop / 4) kind = 'house';
      if (kind) {
        const spot = BW.findSpot(G, kind, town, center.x, center.z, 9, 12 + Math.min(30, count('house') * 3 + count('field') * 3), rng);
        if (spot) { G.pay(town, BW.BUILDINGS[kind].cost); BW.placeBuilding(G, kind, town, spot.x, spot.z, spot.rot); }
      }
    }
    // Military
    const armory = bs.find((b) => b.kind === 'armory' && b.built);
    const soldiers = people.filter((p) => p.job === 'soldier').length;
    if (armory && G.time > (T.nextTrain || 0) && pop - soldiers >= 12 && town.ore >= 30) {
      const cands = people.filter((p) => p.job !== 'soldier' && p.job !== 'builder' && p.job !== 'farmer' && !p.held && !p.inside).slice(0, 5 + Math.round(ai.aggression * 3));
      if (cands.length >= 5) {
        town.ore -= 30;
        const pl = G.addPlatoon(town, cands);
        pl.tx = armory.x + 6; pl.tz = armory.z; pl.mode = 'move';
        T.nextTrain = G.time + 80 / (0.4 + ai.aggression);
      }
    }
    const playerTowns = G.playerTowns();
    if (playerTowns.length) {
      const myPl = G.platoons.filter((p) => p.town === town.id);
      const need = 4 + Math.round((1 - ai.aggression) * 10);
      // Defend: hostile units close to home.
      const threat = G.nearest(G.people, center.x, center.z, 38, (p) => p.owner !== town.owner && p.job === 'soldier') || G.nearest(G.creatures, center.x, center.z, 38, (c) => c.owner !== town.owner);
      if (threat) { for (const pl of myPl) { pl.mode = 'attack'; pl.targetId = threat.id; } }
      else if (soldiers >= need && G.time > (T.nextAttack || (330 - ai.aggression * 150))) {
        // Attack the nearest player building.
        let target = null, bd = 1e12;
        for (const b of G.buildings) if (b.owner === 0 && b.built) { const d = dist2(b.x, b.z, center.x, center.z) * (b.kind === 'center' ? 1.3 : 1); if (d < bd) { bd = d; target = b; } }
        if (target) {
          for (const pl of myPl) { pl.mode = 'attack'; pl.targetId = target.id; }
          T.nextAttack = G.time + 200 - ai.aggression * 100;
          G.say(`${town.name} soldiers are marching on your town!`, 'bad');
          BW.audio.play('growl');
        }
      }
    }
    // Enemy god miracles: fireballs on player things near its towns.
    if (ai.godMiracles && G.time > (T.nextMiracle || 90)) {
      const victim = G.nearest(G.people, center.x, center.z, 70, (p) => p.owner === 0 && !p.inside) || G.nearest(G.creatures, center.x, center.z, 80, (c) => c.owner === 0) || G.nearest(G.buildings, center.x, center.z, 90, (b) => b.owner === 0);
      if (victim) {
        BW.castMiracle(G, 'fire', victim.x, victim.z, town.owner);
        G.say(`The ${town.name} god hurls fire at you!`, 'bad');
        T.nextMiracle = G.time + 70 + Math.random() * 60;
      } else T.nextMiracle = G.time + 20;
    }
  }

  // ------------------------------------------------------------------ main
  function updateTowns(G, dt) {
    const byTown = new Map();
    for (const t of G.towns) byTown.set(t.id, []);
    for (const p of G.people) { const L = byTown.get(p.town); if (L) L.push(p); }
    G.byTown = byTown;
    const god = G.god;
    // Player influence and prayer caps.
    let pop0 = 0, impress0 = 0;
    for (const t of G.towns) {
      if (!t.alive) continue;
      const people = byTown.get(t.id);
      t.pop = people.length; t.cap = G.townCapacity(t); t.impress = G.townImpress(t);
      if (t.owner === 0) { pop0 += t.pop; impress0 += t.impress; }
      t.timers.tick = (t.timers.tick || 0) + dt;
      if (t.timers.tick >= 1) {
        t.timers.tick -= 1;
        // Births
        const breeders = people.filter((p) => p.job === 'breeder').length;
        if (t.pop >= 2 && t.pop < t.cap && t.food > 15) {
          let rate = 0.016 + 0.028 * Math.min(1, breeders / Math.max(1, t.pop / 8));
          if (t.owner === 0 && G.hasUnlock('g_fertility')) rate *= 1.5;
          if (t.owner !== 0) rate *= 0.9;
          if (Math.random() < rate) spawnBirth(G, t, people);
        }
        if (t.autoJobs) assignJobs(G, t, people);
        if (t.owner === 0 && t.food < 20 && (!t.timers.foodWarn || G.time - t.timers.foodWarn > 60)) { t.timers.foodWarn = G.time; G.say('Food is running low! Build fields, assign farmers, or cast Water on crops.', 'warn'); }
      }
      if (t.owner !== 0) enemyAI(G, t, people, dt);
    }
    god.pop = pop0; god.impress = impress0 + god.miracleImpress;
    god.miracleImpress = Math.max(0, god.miracleImpress - dt * 0.5);
    let infl = 45 + pop0 * 1.6 + god.impress * 0.35;
    if (G.hasUnlock('g_influence')) infl *= 1.3;
    god.influence += (Math.min(infl, 230) - god.influence) * Math.min(1, dt * 0.5);
    god.maxPrayer = 800 + pop0 * 40 + (G.hasUnlock('g_prayer') ? 600 : 0);
    god.prayer = Math.min(god.maxPrayer, god.prayer + dt * (0.6 + pop0 * 0.02)); // trickle of belief
    // Tribute milestones
    god.popMilestone = god.popMilestone || 20;
    if (pop0 >= god.popMilestone) { grantTribute(G, 1, `${god.popMilestone} villagers`); god.popMilestone += 15; }

    // Loyalty of enemy towns under the player's awe.
    for (const t of G.towns) {
      if (!t.alive || t.owner === 0) continue;
      const c = G.center(t); if (!c) continue;
      let d = 1e9; for (const pc of G.influenceCenters()) d = Math.min(d, dist(pc.x, pc.z, c.x, c.z));
      const cover = clamp((god.influence + 25 - d) / 50, 0, 1);
      const pressure = cover * (god.impress / (t.impress + 30));
      let drop = pressure * 0.35;
      if (t.food <= 0) drop += 0.25;
      if (t.shieldedBySiren) drop += 0;
      if (pressure < 0.2 && t.food > 0) t.loyalty = Math.min(100, t.loyalty + dt * 0.12);
      t.loyalty -= drop * dt;
      t.pressure = pressure;
      if (t.loyalty < 40 && pressure > 0 && G.time > (t.timers.nextMigrant || 0)) {
        t.timers.nextMigrant = G.time + 12;
        const people = byTown.get(t.id).filter((p) => p.job !== 'soldier' && !p.held);
        const pt = G.playerTown();
        if (people.length && pt) {
          const p = people[Math.floor(Math.random() * people.length)];
          migrate(G, p, pt);
          if (!t.timers.migrantMsg) { t.timers.migrantMsg = 1; G.say(`Impressed villagers from ${t.name} are joining your town!`, 'good'); }
        }
      }
      if (t.loyalty <= 0) townFalls(G, t, 0, 'converted');
    }
    // Creature converts a little by presence when good, scares when evil (handled in creature.js).
  }

  Object.assign(BW, { updateTowns, grantTribute, migrate, townFalls, shiftAlignment, assignJobs });
})(window.BW);
