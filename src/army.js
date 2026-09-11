// ---------------------------------------------------------------------------
// army.js — platoons: formation movement, attack-move, combat with people,
// buildings and creatures. Training and disbanding for the player.
// ---------------------------------------------------------------------------
(function (BW) {
  'use strict';
  const { dist, dist2, clamp } = BW;

  function slotOffset(i) { const cols = 4; const r = Math.floor(i / cols), c = i % cols; return { x: (c - 1.5) * 1.6, z: -r * 1.6 }; }

  function findHostile(G, s, r) {
    const own = s.owner;
    const p = G.nearest(G.people, s.x, s.z, r, (q) => q.owner !== own && !q.inside && !q.held && !q.thrown && (q.job === 'soldier' || G.ents.get(q.town)));
    const c = G.nearest(G.creatures, s.x, s.z, r, (q) => q.owner !== own && !q.downed);
    const b = G.nearest(G.buildings, s.x, s.z, r + 3, (q) => q.owner !== own && q.built);
    let best = null, bd = 1e12;
    for (const t of [p, c, b]) if (t) { let d = dist2(t.x, t.z, s.x, s.z); if (t.type === 'person' && t.job !== 'soldier') d *= 1.5; if (t.type === 'building') d *= 2; if (d < bd) { bd = d; best = t; } }
    return best;
  }

  function unitOf(s) { return BW.UNITS[s.unit] || BW.UNITS.melee; }
  // Raiders ignore civilians and buildings; only soldiers and creatures distract them.
  function findArmed(G, s, r) {
    return G.nearest(G.people, s.x, s.z, r, (q) => q.owner !== s.owner && q.job === 'soldier' && !q.inside) || G.nearest(G.creatures, s.x, s.z, r, (q) => q.owner !== s.owner && !q.downed);
  }
  function reach(t, s) { const u = s ? unitOf(s) : BW.UNITS.melee; const base = t.type === 'building' ? BW.BUILDINGS[t.kind].w / 2 + 1.2 : t.type === 'creature' ? t.size * 1.6 + 1 : 1.5; return Math.max(base, u.range); }

  function blockedByShield(G, s, x, z) {
    for (const sh of G.god.shields) if (sh.owner !== s.owner && dist(sh.x, sh.z, x, z) < sh.r) return true;
    return false;
  }

  function soldierAttack(G, s, t, dt) {
    const u = unitOf(s);
    s.atk = (s.atk || 0) + dt;
    s.dir = Math.atan2(t.x - s.x, t.z - s.z);
    if (s.atk < (s.unit === 'siege' ? 1.6 : 0.8)) return;
    s.atk = 0;
    if (s.unit === 'archer') {
      // Arrow: a short streak of particles from bow to target.
      const dx = t.x - s.x, dz = t.z - s.z, dy = (t.y + 1) - (s.y + 1.5), l = Math.hypot(dx, dy, dz) || 1;
      for (let k = 0; k < 5; k++) G.particles.spawn(s.x + dx / l * k * 1.5, s.y + 1.5 + dy / l * k * 1.5, s.z + dz / l * k * 1.5, dx / l * 28, dy / l * 28 + 2, dz / l * 28, 0.3, 0xffffff, 1.1, 6);
    } else if (BW.rand() < 0.3) BW.audio.play(s.unit === 'siege' ? 'thud' : 'sword');
    if (t.type === 'person') BW.hurt(G, t, u.dmg, s.owner);
    else if (t.type === 'building') { BW.damageBuilding(G, t, u.bdmg, s.owner); t._lastAttacker = s.owner; if (BW.rand() < 0.15) G.particles.burst(t.x, t.y + 2, t.z, 4, 2, 0.5, 0xaa9988, 1.2, 3); }
    else if (t.type === 'creature') BW.hurtCreature(G, t, u.dmg * 0.7, s.owner);
  }

  // When the way is blocked, hit the nearest enemy wall or gate instead.
  function blockingWall(G, s) {
    return G.nearest(G.buildings, s.x, s.z, 30, (b) => b.owner !== s.owner && (b.kind === 'wall' || b.kind === 'gate') && b.built);
  }

  function updateArmy(G, dt) {
    for (const pl of G.platoons.slice()) {
      const n = G.updatePlatoonCenter(pl);
      if (!n) { G.remove(pl); continue; }
      let target = pl.mode === 'attack' || pl.mode === 'raid' ? G.ents.get(pl.targetId) : null;
      // Raids: reach the enemy field, strip it, walk the loot home.
      if (pl.mode === 'raid') {
        if (!target || target.dead) { pl.mode = 'idle'; pl.targetId = 0; }
        else if (pl.members.some((id) => { const m = G.ents.get(id); return m && dist(m.x, m.z, target.x, target.z) < 5; })) {
          const take = Math.round(20 + target.crop * 40); target.crop = 0.05; target._dirty = true;
          pl.loot = (pl.loot || 0) + take; const et = G.ents.get(target.town); if (et) { et.loyalty -= 2; et.fearRecent = 60; }
          G.particles.burst(target.x, target.y + 1, target.z, 20, 3, 0.8, 0xe0c040, 1.4, 2);
          const home = G.ents.get(pl.town); const hc = home && G.center(home);
          pl.mode = 'move'; pl.targetId = 0; pl.tx = hc ? hc.x + 8 : pl.x; pl.tz = hc ? hc.z + 6 : pl.z; pl.returning = true;
          G.say(`Raiders seized ${take} food. Bringing it home.`, 'good'); BW.shiftAlignment(G, -0.01);
          target = null;
        }
      }
      if (pl.returning && pl.mode === 'idle' && pl.loot) { const home = G.ents.get(pl.town); if (home) { home.food += pl.loot; G.say(`${pl.loot} raided food stored.`, 'good'); } pl.loot = 0; pl.returning = false; }
      if (pl.mode === 'attack' && (!target || target.dead)) {
        // Enemy platoons keep hunting player buildings nearby; player platoons stop.
        if (pl.owner !== 0) {
          const next = G.nearest(G.buildings, pl.x, pl.z, 70, (b) => b.owner !== pl.owner && b.built) || G.nearest(G.people, pl.x, pl.z, 40, (p) => p.owner !== pl.owner && !p.inside);
          if (next) { pl.targetId = next.id; target = next; }
          else { const t = G.ents.get(pl.town); const c = t && G.center(t); pl.mode = 'move'; pl.tx = c ? c.x + 8 : pl.x; pl.tz = c ? c.z + 8 : pl.z; pl.targetId = 0; }
        } else { pl.mode = 'idle'; pl.targetId = 0; pl.tx = pl.x; pl.tz = pl.z; }
      }
      // Morale: enemy platoons cut to a third run home.
      if (pl.owner !== 0 && pl.initial && n < pl.initial * 0.3 && pl.mode === 'attack') { const t = G.ents.get(pl.town); const c = t && G.center(t); pl.mode = 'move'; pl.tx = c ? c.x + 8 : pl.x; pl.tz = c ? c.z + 8 : pl.z; pl.targetId = 0; }
      let allArrived = true;
      pl.members.forEach((id, i) => {
        const s = G.ents.get(id); if (!s || s.held || s.thrown || s.fear > 0) return;
        s.timer += dt;
        // Engage anything hostile that is close, whatever the mode.
        let enemy = s.engage && G.ents.get(s.engage); if (enemy && (enemy.dead || dist(enemy.x, enemy.z, s.x, s.z) > 16)) enemy = null;
        if (!enemy && s.timer > 0.5) { s.timer = 0; enemy = pl.mode === 'raid' ? findArmed(G, s, 8) : findHostile(G, s, pl.mode === 'attack' ? 14 : 9); if (!enemy && s.pathFail > G.time) enemy = blockingWall(G, s); }
        s.engage = enemy ? enemy.id : 0;
        const goal = enemy || (pl.mode === 'raid' ? null : target);
        const u = unitOf(s);
        if (pl.mode === 'raid' && target && !enemy) { allArrived = false; s.state = 'walk'; BW.moveToward(G, s, target.x + (i % 3) * 1.5 - 1.5, target.z + Math.floor(i / 3) * 1.5, dt, u.speed, 1.2); return; }
        if (goal) {
          allArrived = false;
          s.state = 'walk';
          const r = reach(goal, s);
          if (dist(s.x, s.z, goal.x, goal.z) <= r) { s.state = 'fight'; soldierAttack(G, s, goal, dt); }
          else {
            const nx = s.x + Math.sin(Math.atan2(goal.x - s.x, goal.z - s.z)) * 2, nz = s.z + Math.cos(Math.atan2(goal.x - s.x, goal.z - s.z)) * 2;
            if (blockedByShield(G, s, nx, nz)) { s.state = 'idle'; }
            else { BW.moveToward(G, s, goal.x, goal.z, dt, u.speed, r); if (s.pathFail > G.time && !enemy) { const w = blockingWall(G, s); if (w) s.engage = w.id; } }
          }
          return;
        }
        const off = slotOffset(i);
        const bx = pl.mode === 'move' && pl.tx !== null ? pl.tx : pl.x, bz = pl.mode === 'move' && pl.tz !== null ? pl.tz : pl.z;
        const gx = bx + off.x, gz = bz + off.z;
        if (dist(s.x, s.z, gx, gz) > 1.0) { allArrived = false; s.state = 'walk'; BW.moveToward(G, s, gx, gz, dt, u.speed, 0.8); }
        else s.state = 'idle';
      });
      if (pl.mode === 'move' && allArrived) { pl.mode = 'idle'; pl.x = pl.tx; pl.z = pl.tz; }
      if (pl.mode === 'idle' && pl.tx !== null && pl.tx !== undefined) { pl.x = pl.tx; pl.z = pl.tz; }
    }
  }

  function trainPlatoon(G, town, unit = 'melee') {
    const u = BW.UNITS[unit] || BW.UNITS.melee;
    if (!G.hasUnlock('b_armory')) return G.say('Unlock the Armoury with Tribute first.', 'warn');
    if (!G.hasUnlock(u.unlock)) return G.say(`Unlock ${u.name} with Tribute first.`, 'warn');
    const armory = G.buildings.find((b) => b.town === town.id && b.kind === 'armory' && b.built);
    if (!armory) return G.say('Build an Armoury first.', 'warn');
    if (!G.canAfford(town, u.cost)) return G.say(`${u.name} cost ${Object.entries(u.cost).map(([k, v]) => v + ' ' + k).join(', ')}.`, 'warn');
    const cands = G.people.filter((p) => p.town === town.id && p.job !== 'soldier' && p.job !== 'builder' && !p.held && !p.inside && !p.thrown && p.age >= 300);
    cands.sort((a, b) => (a.job === 'idle' ? 0 : 1) - (b.job === 'idle' ? 0 : 1));
    if (cands.length < u.count) return G.say(`You need at least ${u.count} free adult villagers to form ${u.name}.`, 'warn');
    if (G.people.filter((p) => p.town === town.id).length - u.count < 6) return G.say('Your town would be left empty. Grow first.', 'warn');
    G.pay(town, u.cost);
    const pl = G.addPlatoon(town, cands.slice(0, u.count));
    for (const id of pl.members) { const s = G.ents.get(id); s.unit = unit; s.maxHealth = u.hp; s.health = u.hp; }
    pl.name = u.name + ' ' + G.platoons.filter((p) => p.owner === town.owner).length; pl.initial = u.count;
    pl.tx = armory.x + 7; pl.tz = armory.z + 2; pl.mode = 'move';
    G.say(`${pl.name} formed. Select it in the Army panel and click the ground to send it.`, 'good');
    BW.audio.play('build');
    return pl;
  }

  function disbandPlatoon(G, pl) {
    for (const id of pl.members) { const s = G.ents.get(id); if (s) { s.job = 'idle'; s.platoon = 0; s.unit = ''; s.maxHealth = 30; s.health = Math.min(s.health, 30); s.engage = 0; } }
    pl.members = [];
    G.remove(pl);
    if (G.selectedPlatoon === pl.id) G.selectedPlatoon = 0;
  }

  function commandPlatoon(G, pl, x, z, target) {
    if (target && target.type === 'building' && target.kind === 'field' && target.owner !== pl.owner && target.built) { pl.mode = 'raid'; pl.targetId = target.id; G.say('Raiding the field: your soldiers will pillage the crop and bring the food home.', 'info'); }
    else if (target && target.owner !== pl.owner && ['person', 'building', 'creature'].includes(target.type)) { pl.mode = 'attack'; pl.targetId = target.id; }
    else { pl.mode = 'move'; pl.tx = x; pl.tz = z; pl.targetId = 0; }
    BW.audio.play('ui');
  }

  Object.assign(BW, { updateArmy, trainPlatoon, disbandPlatoon, commandPlatoon });
})(window.BW);
