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
    BW.audio.play('chime'); BW.advise && BW.advise(G, 'tribute');
  }

  function assignJobs(G, town, people) {
    const counts = BW.countJobs(G, town, people);
    const idle = people.filter((p) => p.job === 'idle' && !p.held && !p.thrown);
    if (!idle.length) return;
    const fields = G.buildings.filter((b) => b.town === town.id && b.kind === 'field' && b.built).length;
    const sites = G.buildings.filter((b) => b.town === town.id && (!b.built || b.upgrading || b.hp < b.maxHp * 0.8)).length;
    const altars = G.buildings.filter((b) => b.town === town.id && b.kind === 'altar' && b.built).length;
    const houses = G.buildings.filter((b) => b.town === town.id && b.kind === 'house' && b.built).length;
    const pop = people.length;
    const wants = [
      ['builder', sites ? Math.min(6, sites * 2) : 0],
      ['farmer', Math.min(fields, Math.ceil(pop * 0.35)) + (town.food < 60 ? 1 : 0)],
      ['forester', town.wood < 120 ? 3 : town.wood < 400 ? 2 : 1],
      ['miner', G.buildings.filter((b) => b.town === town.id && b.kind === 'mine' && b.built).length * 2 + (town.stone < 150 && G.nearest(G.rocks, town.x, town.z, 110) ? 1 : 0)],
      ['worshipper', altars ? 2 + Math.floor(pop / 7) : 0],
      ['breeder', houses ? 1 + Math.floor(pop / 12) : 0],
    ];
    for (const [job, want] of wants) {
      while (counts[job] < want && idle.length) { const p = idle.pop(); p.job = job; p.workId = 0; counts[job]++; }
    }
  }

  function spawnBirth(G, town, people) {
    const houses = G.buildings.filter((b) => b.town === town.id && b.kind === 'house' && b.built);
    const at = houses.length ? houses[Math.floor(BW.rand() * houses.length)] : G.center(town);
    if (!at) return;
    const p = G.addPerson(town, at.x + (BW.rand() - 0.5) * 5, at.z + 3 + BW.rand() * 2, 'idle', 0);
    if (BW.rand() < 0.02 && !G.people.some((q) => q.trait === 'chosen' && q.town === town.id)) { p.trait = 'chosen'; if (town.owner === 0) G.say(`${p.name} was born under a bright star. A chosen one!`, 'good'); }
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
    if (newOwner < 0) newOwner = 0;
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
    town.fear = 0; town.fearRecent = 0;
    G.rebuildOwnerMeshes(town);
    for (const c of G.creatures.slice()) if (c.owner === old && old !== 0) {
      const other = G.towns.find((t) => t.owner === old && t.alive);
      if (!other) { G.say(`The enemy ${c.name} flees the land.`, 'info'); G.particles.burst(c.x, c.y + 3, c.z, 40, 6, 1.5, 0x9999ff, 2.5); G.remove(c); }
    }
    if (newOwner === 0) {
      G.say(`${town.name} ${how === 'converted' ? 'now worships you' : 'has been conquered'}!`, 'good');
      BW.audio.play('win');
      grantTribute(G, 5, 'Town won');
      if (how === 'converted') BW.shiftAlignment(G, 0.05); else BW.shiftAlignment(G, -0.06);
      BW.advise && BW.advise(G, how === 'converted' ? 'converted' : 'conquered');
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
    town.food += dt * 0.35; town.wood += dt * 0.45; town.stone += dt * 0.3; town.iron += dt * (ai.aggression > 0.2 ? 0.15 : 0.06); town.gold += dt * 0.04;
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
      else if (!count('altar') && pop >= 10 && town.wood >= 60 && town.stone >= 40) kind = 'altar';
      else if (!count('mine') && pop >= 12 && town.wood >= 80 && town.stone >= 20 && G.nearest(G.rocks, center.x, center.z, 45)) kind = 'mine';
      else if (!count('lodge') && pop >= 14 && town.wood >= 60) kind = 'lodge';
      else if (!count('armory') && ai.aggression > 0.15 && pop >= 14 && town.wood >= 120 && town.stone >= 60 && town.iron >= 20) kind = 'armory';
      else if (!count('shrine') && pop >= 16 && town.wood >= 100 && town.stone >= 50) kind = 'shrine';
      else if (ai.aggression > 0.4 && count('tower') < 2 && pop > 18 && town.stone >= 90 && town.iron >= 10) kind = 'tower';
      else if (pop > 22 && !count('statue') && town.stone >= 140 && town.gold >= 30) kind = 'statue';
      else if (pop > 28 && !count('wonder') && town.stone >= 320 && town.gold >= 120) kind = 'wonder';
      else if (!count('storehouse') && (town.wood > town.cap_ * 0.85 || town.food > town.cap_ * 0.85) && town.wood >= 120) kind = 'storehouse';
      else if (town.wood >= 60 && count('house') < pop / 4) kind = 'house';
      if (!kind && sites === 0 && rng.next() < 0.5) {
        const cand = bs.filter((b) => BW.canUpgrade(b) && b.kind !== 'center');
        if (cand.length) { const b = cand[Math.floor(rng.next() * cand.length)]; const cost = BW.upgradeCost(b); let rich = true; for (const k in cost) if ((town[k] || 0) < cost[k] * 2) rich = false; if (rich) BW.startUpgrade(G, b); }
      }
      if (kind) {
        let spot;
        if (kind === 'mine') { const v = G.nearest(G.rocks, center.x, center.z, 45); spot = v && BW.findSpot(G, kind, town, v.x, v.z, 4, 9, rng); }
        else spot = BW.findSpot(G, kind, town, center.x, center.z, 12, 16 + Math.min(36, count('house') * 4 + count('field') * 4), rng);
        if (spot) { G.pay(town, BW.BUILDINGS[kind].cost); BW.placeBuilding(G, kind, town, spot.x, spot.z, spot.rot); }
      }
    }
    // Military
    const armory = bs.find((b) => b.kind === 'armory' && b.built);
    const soldiers = people.filter((p) => p.job === 'soldier').length;
    if (armory && G.time > (T.nextTrain || 0) && pop - soldiers >= 12 && town.iron >= 20) {
      const cands = people.filter((p) => p.job !== 'soldier' && p.job !== 'builder' && p.job !== 'farmer' && !p.held && !p.inside).slice(0, 5 + Math.round(ai.aggression * 3));
      if (cands.length >= 5) {
        town.iron -= 20;
        const pl = G.addPlatoon(town, cands);
        const unit = ai.aggression > 0.4 && G.landIndex >= 1 && rng.next() < 0.35 ? 'archer' : ai.aggression > 0.5 && G.landIndex >= 2 && rng.next() < 0.2 ? 'siege' : 'melee';
        for (const id of pl.members) { const s = G.ents.get(id); s.unit = unit; s.maxHealth = BW.UNITS[unit].hp; s.health = s.maxHealth; }
        pl.initial = pl.members.length;
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
      else if (soldiers >= need && G.time > (T.nextAttack || (420 - ai.aggression * 150))) {
        // Attack the nearest player building.
        let target = null, bd = 1e12;
        for (const b of G.buildings) if (b.owner === 0 && b.built) { const d = dist2(b.x, b.z, center.x, center.z) * (b.kind === 'center' ? 1.3 : 1); if (d < bd) { bd = d; target = b; } }
        if (target) {
          for (const pl of myPl) { pl.mode = 'attack'; pl.targetId = target.id; }
          T.nextAttack = G.time + 200 - ai.aggression * 100;
          G.say(`${town.name} soldiers are marching on your town!`, 'bad');
          BW.audio.play('growl'); BW.advise(G, 'attack');
        }
      }
    }
    // Enemy god miracles: fireballs on player things near its towns.
    if (ai.godMiracles && G.time > (T.nextMiracle || 90)) {
      const victim = G.nearest(G.people, center.x, center.z, 70, (p) => p.owner === 0 && !p.inside) || G.nearest(G.creatures, center.x, center.z, 80, (c) => c.owner === 0) || G.nearest(G.buildings, center.x, center.z, 90, (b) => b.owner === 0);
      if (victim) {
        BW.castMiracle(G, 'fire', victim.x, victim.z, town.owner);
        G.say(`The ${town.name} god hurls fire at you!`, 'bad');
        T.nextMiracle = G.time + 70 + BW.rand() * 60;
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
      t.pop = people.length; t.cap = G.townCapacity(t); t.impress = G.townImpress(t); t.cap_ = G.storageCap(t);
      t.hasAltar = G.buildings.some((b) => b.town === t.id && b.kind === 'altar' && b.built);
      if (t.timers.tick === undefined || t.timers.tick + dt >= 1) { const c = G.center(t); t.guards = c ? people.filter((p) => p.job === 'soldier' && dist(p.x, p.z, c.x, c.z) < 40).length : 0; }
      t.fear = Math.max(0, (t.fear || 0) - dt * 0.3); t.fearRecent = Math.max(0, (t.fearRecent || 0) - dt);
      if (G.season === 'winter' && t.pop) { t.wood = Math.max(0, t.wood - dt * t.pop * 0.02); }
      if (people.some((p) => p.trait === 'chosen')) t.impress += 20;
      if (t.owner === 0) { pop0 += t.pop; impress0 += t.impress; }
      t.timers.tick = (t.timers.tick || 0) + dt;
      if (t.timers.tick >= 1) {
        t.timers.tick -= 1;
        // Happiness: the average of everybody's needs.
        let hsum = 0; for (const p of people) hsum += p.happy === undefined ? 0.8 : p.happy;
        t.happiness = people.length ? hsum / people.length : 1;
        if (t.owner === 0 && t.happiness < 0.45 && (!t.timers.unhappy || G.time - t.timers.unhappy > 90)) { t.timers.unhappy = G.time; const worst = {}; for (const p of people) if (p.desire) worst[p.desire] = (worst[p.desire] || 0) + 1; const top = Object.entries(worst).sort((a, b) => b[1] - a[1])[0]; G.say(`Your villagers are unhappy${top ? ': ' + BW.NEED_NAMES[top[0]].toLowerCase() + ' (' + top[1] + ')' : ''}.`, 'warn'); BW.advise && BW.advise(G, 'unhappy'); }
        // Births
        const breeders = people.filter((p) => p.job === 'breeder').length;
        const fertile = people.filter((p) => p.trait === 'fertile').length;
        if (t.pop >= 2 && t.pop < t.cap && t.food > 15) {
          let rate = (0.016 + 0.028 * Math.min(1, breeders / Math.max(1, t.pop / 8))) * (0.5 + t.happiness) * (1 + fertile * 0.1);
          if (t.owner === 0 && G.hasUnlock('g_fertility')) rate *= 1.5;
          if (t.owner !== 0) rate *= 0.9;
          if (BW.rand() < rate) spawnBirth(G, t, people);
        }
        if (t.autoJobs) assignJobs(G, t, people);
        if (t.owner === 0 && t.food < 20 && (!t.timers.foodWarn || G.time - t.timers.foodWarn > 60)) { t.timers.foodWarn = G.time; G.say('Food is running low! Build fields, assign farmers, or cast Water on crops.', 'warn'); }
      }
      if (t.owner !== 0) enemyAI(G, t, people, dt);
    }
    god.pop = pop0; god.impress = impress0 + god.miracleImpress;
    god.miracleImpress = Math.max(0, god.miracleImpress - dt * 0.5);
    let infl = 45 + pop0 * 1.6 + god.impress * 0.35;
    { const pt = G.playerTown(); const c = pt && G.center(pt); if (c && c.level > 1) infl *= 1 + 0.15 * (c.level - 1); }
    if (G.hasUnlock('g_influence')) infl *= 1.3;
    god.influence += (Math.min(infl, 230) - god.influence) * Math.min(1, dt * 0.5);
    god.maxPrayer = 800 + pop0 * 40 + (G.hasUnlock('g_prayer') ? 600 : 0);
    god.prayer = Math.min(god.maxPrayer, god.prayer + dt * (0.6 + pop0 * 0.02)); // trickle of belief
    // Renown: a steady trickle towards the next Tribute point, so unlocks never feel random.
    let hap = 0, n = 0; for (const t of G.playerTowns()) if (t.happiness !== undefined) { hap += t.happiness; n++; } hap = n ? hap / n : 0.8;
    god.renownRate = pop0 * 1.2 + god.impress * 0.6 + hap * pop0 * 0.6; // per minute
    god.renown += god.renownRate / 60 * dt;
    if (god.renown >= 300) { god.renown -= 300; grantTribute(G, 1, 'Renown'); }
    // History for the stats tab: one sample every 5 seconds, 30 minutes kept.
    G.historyT += dt;
    if (G.historyT >= 5) {
      G.historyT = 0; const pt = G.playerTown();
      if (pt) { const tot = {}; for (const k of BW.RESOURCES) tot[k] = 0; for (const t of G.playerTowns()) for (const k of BW.RESOURCES) tot[k] += t[k] || 0; G.history.push({ t: Math.round(G.time), pop: pop0, food: Math.round(tot.food), wood: Math.round(tot.wood), stone: Math.round(tot.stone), iron: Math.round(tot.iron), gold: Math.round(tot.gold), prayer: Math.round(god.prayer), happy: +hap.toFixed(2), tribute: god.tribute }); if (G.history.length > 360) G.history.shift(); }
    }
    // Tribute milestones
    god.popMilestone = god.popMilestone || 20;
    if (pop0 >= god.popMilestone) { grantTribute(G, 1, `${god.popMilestone} villagers`); god.popMilestone += 15; }

    // Loyalty of enemy towns under the player's awe.
    for (const t of G.towns) {
      if (!t.alive || t.owner === 0) continue;
      const c = G.center(t); if (!c) continue;
      let d = 1e9; for (const pc of G.influenceCenters()) d = Math.min(d, dist(pc.x, pc.z, c.x, c.z));
      const cover = clamp((god.influence + 25 - d) / 50, 0, 1);
      const pressure = cover * (god.impress / (t.impress + 30)) * (t.happiness < 0.5 ? 1.4 : 1);
      let drop = pressure * 0.35 + (t.fear || 0) * 0.004;
      if (t.food <= 0) drop += 0.25;
      if (t.shieldedBySiren) drop += 0;
      if (pressure < 0.2 && t.food > 0) t.loyalty = Math.min(100, t.loyalty + dt * 0.12);
      t.loyalty -= drop * dt;
      t.pressure = pressure;
      if (t.loyalty < 50 && !t.timers.lowMsg) { t.timers.lowMsg = 1; BW.advise(G, 'lowLoyalty'); }
      if (t.loyalty < 40 && pressure > 0 && G.time > (t.timers.nextMigrant || 0)) {
        t.timers.nextMigrant = G.time + 12;
        const people = byTown.get(t.id).filter((p) => p.job !== 'soldier' && !p.held);
        const pt = G.playerTown();
        if (people.length && pt) {
          const p = people[Math.floor(BW.rand() * people.length)];
          migrate(G, p, pt);
          if (!t.timers.migrantMsg) { t.timers.migrantMsg = 1; G.say(`Impressed villagers from ${t.name} are joining your town!`, 'good'); }
        }
      }
      if (t.loyalty <= 0) townFalls(G, t, 0, 'converted');
    }
    // Creature converts a little by presence when good, scares when evil (handled in creature.js).
  }

  // Evil acts near a town frighten it (a second conversion channel beside awe).
  function frighten(G, x, z, amount) {
    for (const t of G.towns) { if (!t.alive) continue; const c = G.center(t); if (!c) continue; const d = dist(c.x, c.z, x, z); if (d < 70) { if (t.owner !== 0) t.fear = Math.min(100, (t.fear || 0) + amount * (1 - d / 90)); else t.fearRecent = 60; } }
  }

  Object.assign(BW, { updateTowns, grantTribute, migrate, townFalls, shiftAlignment, assignJobs, frighten });
})(window.BW);
