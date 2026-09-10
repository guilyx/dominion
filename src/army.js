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

  function reach(t) { if (t.type === 'building') return BW.BUILDINGS[t.kind].w / 2 + 1.2; if (t.type === 'creature') return t.size * 1.6 + 1; return 1.5; }

  function blockedByShield(G, s, x, z) {
    for (const sh of G.god.shields) if (sh.owner !== s.owner && dist(sh.x, sh.z, x, z) < sh.r) return true;
    return false;
  }

  function soldierAttack(G, s, t, dt) {
    s.atk = (s.atk || 0) + dt;
    s.dir = Math.atan2(t.x - s.x, t.z - s.z);
    if (s.atk < 0.8) return;
    s.atk = 0;
    if (Math.random() < 0.3) BW.audio.play('sword');
    if (t.type === 'person') BW.hurt(G, t, 9, s.owner);
    else if (t.type === 'building') { BW.damageBuilding(G, t, 7, s.owner); t._lastAttacker = s.owner; if (Math.random() < 0.15) G.particles.burst(t.x, t.y + 2, t.z, 4, 2, 0.5, 0xaa9988, 1.2, 3); }
    else if (t.type === 'creature') BW.hurtCreature(G, t, 6, s.owner);
  }

  function updateArmy(G, dt) {
    for (const pl of G.platoons.slice()) {
      const n = G.updatePlatoonCenter(pl);
      if (!n) { G.remove(pl); continue; }
      let target = pl.mode === 'attack' ? G.ents.get(pl.targetId) : null;
      if (pl.mode === 'attack' && (!target || target.dead)) {
        // Enemy platoons keep hunting player buildings nearby; player platoons stop.
        if (pl.owner !== 0) {
          const next = G.nearest(G.buildings, pl.x, pl.z, 70, (b) => b.owner !== pl.owner && b.built) || G.nearest(G.people, pl.x, pl.z, 40, (p) => p.owner !== pl.owner && !p.inside);
          if (next) { pl.targetId = next.id; target = next; }
          else { const t = G.ents.get(pl.town); const c = t && G.center(t); pl.mode = 'move'; pl.tx = c ? c.x + 8 : pl.x; pl.tz = c ? c.z + 8 : pl.z; pl.targetId = 0; }
        } else { pl.mode = 'idle'; pl.targetId = 0; pl.tx = pl.x; pl.tz = pl.z; }
      }
      let allArrived = true;
      pl.members.forEach((id, i) => {
        const s = G.ents.get(id); if (!s || s.held || s.thrown || s.fear > 0) return;
        s.timer += dt;
        // Engage anything hostile that is close, whatever the mode.
        let enemy = s.engage && G.ents.get(s.engage); if (enemy && (enemy.dead || dist(enemy.x, enemy.z, s.x, s.z) > 16)) enemy = null;
        if (!enemy && s.timer > 0.5) { s.timer = 0; enemy = findHostile(G, s, pl.mode === 'attack' ? 14 : 9); }
        s.engage = enemy ? enemy.id : 0;
        const goal = enemy || target;
        if (goal) {
          allArrived = false;
          s.state = 'walk';
          const r = reach(goal);
          if (dist(s.x, s.z, goal.x, goal.z) <= r) { s.state = 'fight'; soldierAttack(G, s, goal, dt); }
          else {
            const nx = s.x + Math.sin(Math.atan2(goal.x - s.x, goal.z - s.z)) * 2, nz = s.z + Math.cos(Math.atan2(goal.x - s.x, goal.z - s.z)) * 2;
            if (blockedByShield(G, s, nx, nz)) { s.state = 'idle'; }
            else BW.moveToward(G, s, goal.x, goal.z, dt, 5.5, r);
          }
          return;
        }
        const off = slotOffset(i);
        const bx = pl.mode === 'move' && pl.tx !== null ? pl.tx : pl.x, bz = pl.mode === 'move' && pl.tz !== null ? pl.tz : pl.z;
        const gx = bx + off.x, gz = bz + off.z;
        if (dist(s.x, s.z, gx, gz) > 1.0) { allArrived = false; s.state = 'walk'; BW.moveToward(G, s, gx, gz, dt, 5.5, 0.8); }
        else s.state = 'idle';
      });
      if (pl.mode === 'move' && allArrived) { pl.mode = 'idle'; pl.x = pl.tx; pl.z = pl.tz; }
      if (pl.mode === 'idle' && pl.tx !== null && pl.tx !== undefined) { pl.x = pl.tx; pl.z = pl.tz; }
    }
  }

  function trainPlatoon(G, town) {
    if (!G.hasUnlock('b_armory')) return G.say('Unlock the Armoury with Tribute first.', 'warn');
    const armory = G.buildings.find((b) => b.town === town.id && b.kind === 'armory' && b.built);
    if (!armory) return G.say('Build an Armoury first.', 'warn');
    if (town.ore < 30) return G.say('Training a platoon costs 30 ore.', 'warn');
    const cands = G.people.filter((p) => p.town === town.id && p.job !== 'soldier' && p.job !== 'builder' && !p.held && !p.inside && !p.thrown);
    cands.sort((a, b) => (a.job === 'idle' ? 0 : 1) - (b.job === 'idle' ? 0 : 1));
    if (cands.length < 6) return G.say('You need at least 6 free villagers to form a platoon.', 'warn');
    if (G.people.filter((p) => p.town === town.id).length - 6 < 6) return G.say('Your town would be left empty. Grow first.', 'warn');
    town.ore -= 30;
    const pl = G.addPlatoon(town, cands.slice(0, 6));
    pl.tx = armory.x + 7; pl.tz = armory.z + 2; pl.mode = 'move';
    G.say(`${pl.name} formed. Select it in the Army panel and click the ground to send it.`, 'good');
    BW.audio.play('build');
    return pl;
  }

  function disbandPlatoon(G, pl) {
    for (const id of pl.members) { const s = G.ents.get(id); if (s) { s.job = 'idle'; s.platoon = 0; s.maxHealth = 30; s.health = Math.min(s.health, 30); s.engage = 0; } }
    pl.members = [];
    G.remove(pl);
    if (G.selectedPlatoon === pl.id) G.selectedPlatoon = 0;
  }

  function commandPlatoon(G, pl, x, z, target) {
    if (target && target.owner !== pl.owner && ['person', 'building', 'creature'].includes(target.type)) { pl.mode = 'attack'; pl.targetId = target.id; }
    else { pl.mode = 'move'; pl.tx = x; pl.tz = z; pl.targetId = 0; }
    BW.audio.play('ui');
  }

  Object.assign(BW, { updateArmy, trainPlatoon, disbandPlatoon, commandPlatoon });
})(window.BW);
