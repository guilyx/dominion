// ---------------------------------------------------------------------------
// creature.js — the creature: needs, autonomous action selection weighted by
// what it has learned, reward/punish feedback, combat, and the enemy creature.
// ---------------------------------------------------------------------------
(function (BW) {
  'use strict';
  const { dist, dist2, clamp } = BW;

  const ACTION_ALIGN = { eatTree: 0, eatVillager: -1, eatFood: 0, gatherWood: 0.5, waterField: 0.8, harvest: 0.5, fight: -0.2, wander: 0, sleep: 0, playful: -0.4, castWater: 0.6, castHeal: 1, castFire: -1, castLightning: -0.8 };
  const ACTION_NAMES = { guard: 'standing guard', going: 'on its way', follow: 'following your hand', downed: 'knocked out', eatTree: 'eating a tree', eatVillager: 'eating a villager', eatFood: 'eating from the stores', gatherWood: 'gathering wood', waterField: 'watering a field', harvest: 'harvesting a field', fight: 'fighting', wander: 'exploring', sleep: 'sleeping', playful: 'playing with a villager', castWater: 'casting Water', castHeal: 'casting Heal', castFire: 'casting Fireball', castLightning: 'casting Lightning' };
  BW.CREATURE_ACTION_NAMES = ACTION_NAMES;

  function speak(c, text) { c.speak = text; c.speakT = 6; }

  function hurtCreature(G, c, amount, attackerOwner) {
    if (!c || c.dead || c.downed) return;
    c.health -= amount;
    c.hurtFlash = 0.3;
    if (c.health <= 0) {
      c.health = 0;
      if (c.owner === 0) {
        c.downed = 45; c.state = 'downed';
        G.say('Your creature has been knocked out. It will recover at your temple.', 'bad');
        BW.advise && BW.advise(G, 'creatureDown');
        G.particles.burst(c.x, c.y + 2, c.z, 40, 5, 1.5, 0xff4444, 2.5);
      } else {
        G.say(`The enemy ${c.name} has been slain!`, 'good');
        G.particles.burst(c.x, c.y + 2, c.z, 80, 7, 2, 0xff4444, 3, 3);
        BW.grantTribute(G, 3, 'Enemy creature slain');
        G.remove(c);
      }
      BW.audio.play('growl');
    }
  }

  function feedback(G, c, sign) {
    const a = c.lastAction;
    const rate = BW.SPECIES[c.species].learnRate;
    if (a && G.time - a.t < 25 && a.kind in c.learned) {
      c.learned[a.kind] = clamp(c.learned[a.kind] + sign * 0.14 * rate, 0, 1);
      c.alignment = clamp(c.alignment + sign * (ACTION_ALIGN[a.kind] || 0) * 0.12, -1, 1);
      a.judged = (a.judged || 0) + sign;
      speak(c, sign > 0 ? `You liked me ${ACTION_NAMES[a.kind]}. I'll do that more.` : `You didn't like me ${ACTION_NAMES[a.kind]}. I'll do that less.`);
    } else {
      speak(c, sign > 0 ? 'That felt nice.' : 'Ouch! What did I do?');
      c.alignment = clamp(c.alignment + sign * 0.01, -1, 1);
    }
    c.mood = clamp((c.mood || 0) + sign * 0.3, -1, 1);
    G.particles.burst(c.x, c.y + c.size * 3, c.z, 20, 2, 1, sign > 0 ? 0xffee88 : 0xff4444, 2, -1, 2);
    BW.audio.play(sign > 0 ? 'happy' : 'sad');
    BW.shiftAlignment(G, sign > 0 ? 0.002 : -0.004);
  }

  function setAction(c, kind, targetId, goal) {
    c.state = kind; c.targetId = targetId || 0; c.goal = goal || null; c.actionT = 0;
    c.lastAction = { kind, t: BW.G.time };
    c.actionLog.push(kind); if (c.actionLog.length > 8) c.actionLog.shift();
  }

  // Weighted choice of what to do next, from learned tendencies and needs.
  function choose(G, c) {
    const L = c.learned, hunger = c.hunger / 100, tired = 1 - c.energy / 100;
    const town = G.playerTown(); const center = town && G.center(town);
    const near = (list, r, f) => G.nearest(list, c.x, c.z, r, f);
    const w = {};
    w.eatTree = L.eatTree * (0.2 + hunger * 1.5) * (near(G.trees, 70, (t) => !t.burnt) ? 1 : 0);
    w.eatVillager = L.eatVillager * (0.2 + hunger * 1.5) * (c.alignment < -0.2 ? 1.6 : 0.3) * (near(G.people, 60, (p) => !p.inside && !p.held) ? 1 : 0);
    w.eatFood = L.eatFood * (0.1 + hunger * 1.5) * ((town && town.food > 60) || near(G.items, 40, (i) => i.kind === 'food') ? 1 : 0);
    w.gatherWood = L.gatherWood * (town && town.wood < 400 ? 0.8 : 0.2) * (near(G.trees, 80, (t) => !t.burnt) && center ? 1 : 0);
    w.waterField = L.waterField * (near(G.buildings, 80, (b) => b.kind === 'field' && b.built && b.owner === 0 && b.crop < 0.75 && !(b.rain > 0)) ? 1 : 0);
    w.harvest = L.harvest * (near(G.buildings, 80, (b) => b.kind === 'field' && b.built && b.owner === 0 && b.crop >= 0.95) ? 1 : 0);
    const hostile = near(G.people, 45, (p) => p.owner !== 0 && p.job === 'soldier' && !p.inside) || near(G.creatures, 45, (o) => o.owner !== 0);
    w.fight = L.fight * (hostile ? 2.0 : (c.alignment < -0.3 && near(G.buildings, 50, (b) => b.owner !== 0) ? 0.5 : 0));
    w.wander = L.wander * 0.5;
    w.sleep = L.sleep * (tired * 1.5 + (BW.isDay(G) ? 0 : 0.5));
    w.playful = L.playful * 0.35 * (near(G.people, 25, (p) => !p.inside && !p.held) ? 1 : 0);
    if (c.cooldown <= 0 && G.hasUnlock('c_miracles')) {
      w.castWater = L.castWater * (near(G.buildings, 60, (b) => b.kind === 'field' && b.built && b.crop < 0.8 && !(b.rain > 0)) || near(G.buildings, 60, (b) => b.fire > 0) ? 1.2 : 0);
      w.castHeal = L.castHeal * (near(G.people, 40, (p) => p.owner === 0 && p.health < p.maxHealth * 0.6) || c.health < c.maxHealth * 0.5 ? 1.2 : 0);
      w.castFire = L.castFire * (near(G.buildings, 60, (b) => b.owner !== 0) ? 1.0 : 0);
      w.castLightning = L.castLightning * (near(G.buildings, 60, (b) => b.owner !== 0) ? 1.0 : 0);
    }
    let sum = 0; for (const k in w) sum += Math.max(0, w[k]);
    if (sum <= 0) return 'wander';
    let r = BW.rand() * sum;
    for (const k in w) { r -= Math.max(0, w[k]); if (r <= 0) return k; }
    return 'wander';
  }

  function goTo(G, c, x, z, dt, r) {
    const d = dist(c.x, c.z, x, z);
    if (d <= r) { c.moving = false; return true; }
    const sp = BW.SPECIES[c.species].speed * (0.8 + c.size * 0.25);
    let ang = Math.atan2(x - c.x, z - c.z);
    const step = Math.min(sp * dt, d);
    const T = G.terrain;
    for (const off of [0, 0.6, -0.6, 1.3, -1.3, 2, -2]) {
      const a = ang + off, nx = c.x + Math.sin(a) * step, nz = c.z + Math.cos(a) * step;
      if (T.heightAt(nx, nz) > 0.3 && T.inBounds(nx, nz)) { c.x = nx; c.z = nz; c.dir = BW.angleLerp(c.dir, a, 0.2); c.moving = true; c.walkPhase += step * 1.6 / c.size; c.energy = Math.max(0, c.energy - dt * 0.4); return false; }
    }
    c.moving = false; return false;
  }

  function attack(G, c, target, dt) {
    const strength = BW.SPECIES[c.species].strength * (G.hasUnlock('c_strength') && c.owner === 0 ? 2 : 1) * c.size;
    c.attackT = (c.attackT || 0) + dt;
    if (c.attackT < 0.9) return;
    c.attackT = 0;
    const dmg = 14 * strength;
    G.particles.burst(target.x, target.y + 1.5, target.z, 12, 4, 0.5, 0xffcc66, 1.6, 4);
    BW.audio.play('thud');
    if (target.type === 'person') BW.hurt(G, target, dmg, c.owner);
    else if (target.type === 'building') BW.damageBuilding(G, target, dmg * 2.5, c.owner);
    else if (target.type === 'creature') BW.hurtCreature(G, target, dmg, c.owner);
    if (c.owner === 0) BW.shiftAlignment(G, target.type === 'person' && target.job !== 'soldier' ? -0.006 : 0);
  }

  function targetRadius(t) { if (!t) return 2; if (t.type === 'building') return BW.BUILDINGS[t.kind].w / 2 + 2.5; if (t.type === 'creature') return t.size * 2 + 2; return 2.2; }

  function playerCreature(G, c, dt) {
    const town = G.playerTown(); const center = town && G.center(town);
    const hand = G.hand;
    if (c.downed) {
      c.downed -= dt; c.moving = false;
      if (c.downed <= 0) { c.downed = 0; c.health = c.maxHealth * 0.6; c.state = 'idle'; if (center) { c.x = center.x + 8; c.z = center.z + 8; } speak(c, "I'm back. That hurt."); }
      return;
    }
    if (c.cooldown > 0) c.cooldown -= dt;
    // Direct orders from the hand: attack a target, or guard a spot.
    if (c.command) {
      const cmd = c.command;
      if (cmd.type === 'attack') {
        const t = G.ents.get(cmd.targetId);
        if (!t || t.dead || (t.type === 'creature' && t.owner === 0)) { c.command = null; c.state = 'idle'; speak(c, 'Done.'); }
        else { c.state = 'fight'; c.targetId = t.id; if (goTo(G, c, t.x, t.z, dt, targetRadius(t))) { c.moving = false; attack(G, c, t, dt); } return; }
      } else if (cmd.type === 'guard') {
        const hostile = G.nearest(G.people, cmd.x, cmd.z, 32, (p) => p.owner !== 0 && p.job === 'soldier' && !p.inside) || G.nearest(G.creatures, cmd.x, cmd.z, 32, (o) => o.owner !== 0 && !o.downed);
        if (hostile) { c.state = 'fight'; c.targetId = hostile.id; if (goTo(G, c, hostile.x, hostile.z, dt, targetRadius(hostile))) { c.moving = false; attack(G, c, hostile, dt); } return; }
        if (dist(c.x, c.z, cmd.x, cmd.z) > 8) { goTo(G, c, cmd.x, cmd.z, dt, 6); c.state = 'going'; return; }
        c.moving = false; if (c.state !== 'sleep') c.state = 'guard';
        if (c.hunger > 85 && !c.guardHungry) { c.guardHungry = true; speak(c, "I'm hungry. Feed me or let me roam."); }
        return;
      }
    }
    // Leash overrides
    if (c.leash === 'follow' && hand && hand.hover) {
      const hx = hand.hover.x, hz = hand.hover.z;
      if (dist(c.x, c.z, hx, hz) > 9) { goTo(G, c, hx, hz, dt, 8); c.state = 'follow'; return; }
      if (c.state === 'follow') { c.state = 'idle'; c.moving = false; }
    }
    if (c.leash === 'stay' && !['sleep', 'idle', 'fight'].includes(c.state)) { c.state = 'idle'; c.moving = false; }
    if (c.sendGoal) {
      if (goTo(G, c, c.sendGoal.x, c.sendGoal.z, dt, 3)) { c.sendGoal = null; c.state = 'idle'; }
      else { c.state = 'going'; return; }
    }
    c.actionT = (c.actionT || 0) + dt;
    const tgt = G.ents.get(c.targetId);
    switch (c.state) {
      case 'idle':
        c.moving = false;
        c.idleT = (c.idleT || 0) + dt;
        if (c.idleT > 1.5 + BW.rand() * 2 && c.leash !== 'stay') { c.idleT = 0; setAction(c, choose(G, c)); }
        else if (c.leash === 'stay' && c.idleT > 3) { c.idleT = 0; const k = choose(G, c); if (['sleep', 'castWater', 'castHeal', 'castFire', 'castLightning'].includes(k)) setAction(c, k); }
        break;
      case 'wander':
        if (!c.goal) { const a = BW.rand() * 6.28, r = 10 + BW.rand() * 20; const bx = center ? center.x : c.x, bz = center ? center.z : c.z; c.goal = { x: (dist(c.x, c.z, bx, bz) > 60 ? bx : c.x) + Math.sin(a) * r, z: (dist(c.x, c.z, bx, bz) > 60 ? bz : c.z) + Math.cos(a) * r }; }
        if (goTo(G, c, c.goal.x, c.goal.z, dt, 2) || c.actionT > 12) { c.state = 'idle'; c.goal = null; }
        break;
      case 'sleep':
        c.moving = false; c.energy = Math.min(100, c.energy + dt * 3);
        if (BW.rand() < dt * 2) G.particles.spawn(c.x, c.y + c.size * 2.5, c.z, 0.3, 1, 0, 1.5, 0xffffff, 2);
        if (c.energy >= 100 || c.actionT > 25) c.state = 'idle';
        break;
      case 'eatTree': {
        const t = tgt && tgt.type === 'tree' ? tgt : G.nearest(G.trees, c.x, c.z, 70, (t) => !t.burnt);
        if (!t) { c.state = 'idle'; break; }
        c.targetId = t.id;
        if (goTo(G, c, t.x, t.z, dt, 2.5)) {
          c.eatT = (c.eatT || 0) + dt; c.moving = false;
          if (BW.rand() < dt * 8) G.particles.burst(t.x, t.y + 2, t.z, 3, 2, 0.5, 0x4a8a3a, 1.2, 3);
          if (c.eatT > 2.5) { c.eatT = 0; G.remove(t); c.hunger = Math.max(0, c.hunger - 25); grow(G, c, 0.008); c.state = 'idle'; speak(c, 'Crunchy.'); }
        }
        break;
      }
      case 'eatVillager': {
        const p = tgt && tgt.type === 'person' && !tgt.held && !tgt.inside ? tgt : G.nearest(G.people, c.x, c.z, 60, (p) => !p.inside && !p.held && (c.alignment > -0.3 ? p.owner !== 0 : true));
        if (!p) { c.state = 'idle'; break; }
        c.targetId = p.id;
        if (goTo(G, c, p.x, p.z, dt, 1.8)) {
          const own = p.owner === 0;
          BW.die(G, p, 'eaten');
          c.hunger = Math.max(0, c.hunger - 45); grow(G, c, 0.015);
          c.alignment = clamp(c.alignment - 0.05, -1, 1);
          BW.scare(G, c.x, c.z, 15, 5);
          if (own) { BW.shiftAlignment(G, -0.03); G.say('Your creature ate one of your villagers!', 'bad'); BW.advise && BW.advise(G, 'ateVillager'); }
          else { BW.shiftAlignment(G, -0.01); const t = G.ents.get(p.town); if (t) t.loyalty -= 2; }
          BW.frighten(G, c.x, c.z, 3);
          speak(c, 'Tasty. Was that wrong?');
          c.state = 'idle';
        } else if (c.actionT > 15) c.state = 'idle';
        break;
      }
      case 'eatFood': {
        const it = G.nearest(G.items, c.x, c.z, 40, (i) => i.kind === 'food' && !i.held);
        if (it) { if (goTo(G, c, it.x, it.z, dt, 2)) { c.hunger = Math.max(0, c.hunger - it.amount * 0.5); grow(G, c, 0.02); G.remove(it); c.state = 'idle'; } }
        else if (center && town.food > 30) { if (goTo(G, c, center.x, center.z, dt, 7)) { const take = Math.min(40, town.food); town.food -= take; c.hunger = Math.max(0, c.hunger - take); grow(G, c, 0.015); c.state = 'idle'; } }
        else c.state = 'idle';
        break;
      }
      case 'gatherWood': {
        if (c.holding) {
          if (!center) { c.holding = null; c.state = 'idle'; break; }
          if (goTo(G, c, center.x, center.z, dt, 7)) { town.wood += c.holding.amount; G.particles.burst(center.x, center.y + 3, center.z, 10, 2, 0.6, 0xa07040, 1.4); c.holding = null; c.state = 'idle'; speak(c, 'Wood for the town.'); BW.shiftAlignment(G, 0.003); }
        } else {
          const t = tgt && tgt.type === 'tree' ? tgt : G.nearest(G.trees, c.x, c.z, 80, (t) => !t.burnt && t.wood > 0);
          if (!t) { c.state = 'idle'; break; }
          c.targetId = t.id;
          if (goTo(G, c, t.x, t.z, dt, 2.5)) { c.holding = { kind: 'wood', amount: t.wood }; G.remove(t); }
        }
        break;
      }
      case 'harvest': {
        if (c.holding) {
          if (!center) { c.holding = null; c.state = 'idle'; break; }
          if (goTo(G, c, center.x, center.z, dt, 7)) { town.food += c.holding.amount; c.holding = null; c.state = 'idle'; speak(c, 'Food for everyone.'); BW.shiftAlignment(G, 0.003); }
        } else {
          const f = G.nearest(G.buildings, c.x, c.z, 90, (b) => b.kind === 'field' && b.built && b.owner === 0 && b.crop >= 0.9);
          if (!f) { c.state = 'idle'; break; }
          if (goTo(G, c, f.x, f.z, dt, 3.5)) { c.holding = { kind: 'food', amount: 40 }; f.crop = 0.05; f._dirty = true; }
        }
        break;
      }
      case 'waterField': {
        const f = tgt && tgt.type === 'building' ? tgt : G.nearest(G.buildings, c.x, c.z, 90, (b) => b.kind === 'field' && b.built && b.owner === 0 && b.crop < 0.8);
        if (!f) { c.state = 'idle'; break; }
        c.targetId = f.id;
        if (goTo(G, c, f.x, f.z, dt, 4)) { G.effects.push({ kind: 'rain', x: f.x, z: f.z, r: 5, t: 4, owner: 0 }); c.state = 'idle'; speak(c, 'Grow, little plants.'); BW.shiftAlignment(G, 0.004); }
        break;
      }
      case 'playful': {
        const p = tgt && tgt.type === 'person' && !tgt.held ? tgt : G.nearest(G.people, c.x, c.z, 25, (p) => !p.inside && !p.held);
        if (!p) { c.state = 'idle'; break; }
        c.targetId = p.id;
        if (goTo(G, c, p.x, p.z, dt, 1.8)) { p.thrown = { vx: Math.sin(c.dir) * 10, vy: 9, vz: Math.cos(c.dir) * 10, by: 0 }; speak(c, 'Wheee!'); c.state = 'idle'; if (p.owner === 0) BW.shiftAlignment(G, -0.004); }
        else if (c.actionT > 10) c.state = 'idle';
        break;
      }
      case 'fight': {
        let t = tgt && !tgt.dead && (tgt.type !== 'person' || !tgt.inside) ? tgt : null;
        if (!t) t = G.nearest(G.people, c.x, c.z, 45, (p) => p.owner !== 0 && p.job === 'soldier' && !p.inside) || G.nearest(G.creatures, c.x, c.z, 45, (o) => o.owner !== 0) || (c.alignment < -0.3 ? G.nearest(G.buildings, c.x, c.z, 50, (b) => b.owner !== 0) : null);
        if (!t) { c.state = 'idle'; break; }
        c.targetId = t.id;
        if (goTo(G, c, t.x, t.z, dt, targetRadius(t))) { c.moving = false; attack(G, c, t, dt); }
        if (c.actionT > 40) c.state = 'idle';
        break;
      }
      case 'castWater': case 'castHeal': case 'castFire': case 'castLightning': {
        const kind = c.state.slice(4).toLowerCase();
        let t = null;
        if (kind === 'water') t = G.nearest(G.buildings, c.x, c.z, 60, (b) => b.fire > 0) || G.nearest(G.buildings, c.x, c.z, 60, (b) => b.kind === 'field' && b.built && b.crop < 0.8);
        else if (kind === 'heal') t = G.nearest(G.people, c.x, c.z, 40, (p) => p.owner === 0 && p.health < p.maxHealth * 0.6) || c;
        else t = G.nearest(G.buildings, c.x, c.z, 60, (b) => b.owner !== 0);
        if (!t) { c.state = 'idle'; break; }
        if (goTo(G, c, t.x, t.z, dt, 14)) {
          BW.castMiracle(G, kind, t.x, t.z, 0, true); c.cooldown = 35; c.state = 'idle';
          speak(c, `I cast ${BW.MIRACLES[kind].name}!`);
          if (kind === 'fire' || kind === 'lightning') { BW.shiftAlignment(G, -0.01); for (const tw of G.enemyTowns()) { const cc = G.center(tw); if (cc && dist(cc.x, cc.z, t.x, t.z) < 45) tw.loyalty -= 4; } }
          else BW.shiftAlignment(G, 0.005);
        }
        break;
      }
      default: c.state = 'idle';
    }
  }

  function maxHp(G, c) { return BW.SPECIES[c.species].hp * c.size * (c.owner === 0 && G.hasUnlock('c_armour') ? 1.5 : 1); }
  function grow(G, c, amount) {
    if (c.owner !== 0) return;
    c.growth += amount * (G.hasUnlock('c_growth') ? 2 : 1);
    const size = clamp(1 + c.growth, 1, G.hasUnlock('c_growth') ? 3.4 : 2.6);
    const want = maxHp(G, c);
    if (size !== c.size || Math.abs(want - c.maxHealth) > 1) { const ratio = c.health / c.maxHealth; c.size = size; c.maxHealth = maxHp(G, c); c.health = c.maxHealth * ratio; }
  }
  // The creature copies what it sees the hand do nearby.
  function observe(G, kind, x, z) {
    const c = G.playerCreature(); if (!c || dist(c.x, c.z, x, z) > 45) return;
    const map = { water: 'waterField', throw: 'playful', feed: 'eatFood', wood: 'gatherWood', food: 'harvest' };
    const k = map[kind]; if (!k) return;
    c.learned[k] = clamp(c.learned[k] + 0.05 * BW.SPECIES[c.species].learnRate, 0, 1);
    if (BW.rand() < 0.3) speak(c, `I saw that. Maybe I should try ${ACTION_NAMES[k]} too.`);
  }

  function enemyCreature(G, c, dt) {
    const town = G.towns.find((t) => t.owner === c.owner && t.alive);
    const center = town && G.center(town);
    const home = center ? { x: center.x, z: center.z } : { x: c.x, z: c.z };
    c.actionT = (c.actionT || 0) + dt;
    const tgt = G.ents.get(c.targetId);
    const nearHome = dist(c.x, c.z, home.x, home.z) < 60;
    if (c.health < c.maxHealth * 0.25 && c.state !== 'retreat') { c.state = 'retreat'; }
    if (c.state === 'retreat') { if (goTo(G, c, home.x, home.z, dt, 6)) { c.state = 'idle'; } c.health = Math.min(c.maxHealth, c.health + dt * 2); return; }
    if (nearHome) c.health = Math.min(c.maxHealth, c.health + dt * 1.5);
    if (c.state !== 'rampage' && c.state !== 'fight') {
      const threat = G.nearest(G.people, c.x, c.z, 45, (p) => p.owner === 0 && p.job === 'soldier' && !p.inside) || G.nearest(G.creatures, c.x, c.z, 40, (o) => o.owner === 0 && !o.downed) || G.nearest(G.people, c.x, c.z, 30, (p) => p.owner === 0 && !p.inside);
      if (threat) { c.state = 'fight'; c.targetId = threat.id; c.actionT = 0; }
      else if (town && town.ai && G.time > (c.nextRampage || 300)) { c.state = 'rampage'; c.actionT = 0; c.nextRampage = G.time + 320 + BW.rand() * 120; G.say(`The enemy ${c.name} is rampaging towards your town!`, 'bad'); BW.audio.play('growl'); }
    }
    switch (c.state) {
      case 'fight': {
        let t = tgt && !tgt.dead && !(tgt.type === 'creature' && tgt.downed) ? tgt : null;
        if (!t || c.actionT > 30) { c.state = 'idle'; c.actionT = 0; break; }
        if (goTo(G, c, t.x, t.z, dt, targetRadius(t))) attack(G, c, t, dt);
        break;
      }
      case 'rampage': {
        const pt = G.playerTown(); const pc = pt && G.center(pt);
        if (!pc || c.actionT > 75) { c.state = 'idle'; c.nextRampage = G.time + 220 + BW.rand() * 120; c.actionT = 0; break; }
        const t = G.nearest(G.buildings, c.x, c.z, 30, (b) => b.owner === 0) || G.nearest(G.people, c.x, c.z, 20, (p) => p.owner === 0 && !p.inside);
        if (t && dist(c.x, c.z, pc.x, pc.z) < 70) { if (goTo(G, c, t.x, t.z, dt, targetRadius(t))) attack(G, c, t, dt); }
        else goTo(G, c, pc.x, pc.z, dt, 10);
        break;
      }
      default: {
        c.moving = false;
        if (!c.goal || goTo(G, c, c.goal.x, c.goal.z, dt, 2)) { if (BW.rand() < dt * 0.4) { const a = BW.rand() * 6.28, r = 6 + BW.rand() * 24; c.goal = { x: home.x + Math.sin(a) * r, z: home.z + Math.cos(a) * r }; } }
        if (c.state !== 'idle') { c.state = 'idle'; }
      }
    }
  }

  function updateCreatures(G, dt) {
    for (const c of G.creatures.slice()) {
      if (c.dead) continue;
      c.hunger = Math.min(100, c.hunger + dt * (c.owner === 0 ? 0.22 : 0));
      if (c.hunger >= 100 && c.owner === 0) { c.health -= dt * 0.6; if (c.health <= 0) hurtCreature(G, c, 1, -1); }
      else if (c.health < c.maxHealth && !c.downed) c.health = Math.min(c.maxHealth, c.health + dt * 0.5);
      if (c.speakT > 0) { c.speakT -= dt; if (c.speakT <= 0) c.speak = ''; }
      if (c.mood) c.mood *= Math.max(0, 1 - dt * 0.02);
      if (c.hurtFlash > 0) c.hurtFlash -= dt;
      if (c.owner === 0) { playerCreature(G, c, dt); grow(G, c, dt * 0.0005); }
      else enemyCreature(G, c, dt);
      // Impress or frighten nearby enemy villagers by presence.
      if (c.owner === 0 && BW.rand() < dt) for (const t of G.enemyTowns()) { const cc = G.center(t); if (cc && dist(cc.x, cc.z, c.x, c.z) < 40) t.loyalty -= 0.3 * c.size; }
      // Mesh sync
      c.y = G.groundY(c.x, c.z);
      const m = c._mesh;
      if (Math.abs((c._meshAlign || 0) - c.alignment) > 0.5) G._buildCreatureMesh(c);
      if (m) {
        const t = G.time, parts = m.userData.parts, mood = c.mood || 0;
        m.rotation.y = c.dir; m.scale.set(c.size, c.size * (1 + c.growth * 0.08), c.size);
        const swing = c.moving ? Math.sin(c.walkPhase * 2) * 0.6 : 0;
        parts.legs.forEach((l, i) => { l.rotation.x = swing * (i % 2 ? 1 : -1); l.scale.y = 1 + c.growth * 0.12; });
        m.rotation.z = c.downed ? Math.PI / 2 : c.state === 'sleep' ? 0.4 : 0;
        const bob = c.moving ? Math.abs(Math.sin(c.walkPhase * 2)) * 0.12 * c.size : 0;
        m.position.set(c.x, c.y + bob + (c.downed ? 0.8 * c.size : 0), c.z);
        parts.body.scale.y = 1 + Math.sin(t * 2.1 + c.id) * 0.025; // breathing
        if (parts.tailSegs) { const wag = 3 + Math.max(0, mood) * 6 + (c.moving ? 3 : 0); parts.tailSegs.forEach((s, i) => { s.rotation.y = Math.sin(t * wag + i * 0.8) * (0.35 + Math.max(0, mood) * 0.2); s.rotation.x = -0.25 + (i ? 0 : mood * 0.4); }); }
        // Eyes: blink now and then, close when asleep or knocked out.
        const blink = c.state === 'sleep' || c.downed ? 0.08 : ((t * 1.3 + c.id) % 4.7) < 0.14 ? 0.1 : 1;
        for (const e of parts.eyes) e.scale.y = blink;
        // Head: eating bobs, mood tilts, and it watches the hand when it is close.
        let hx = 0, hy = c.state.startsWith('eat') ? 0.45 + Math.sin(t * 8) * 0.15 : mood < -0.3 ? 0.3 : mood > 0.3 ? -0.15 : 0;
        const hand = G.hand; if (hand && hand.hover && c.owner === 0 && !c.downed) { const d = dist(hand.hover.x, hand.hover.z, c.x, c.z); if (d < 28) { const a = Math.atan2(hand.hover.x - c.x, hand.hover.z - c.z) - c.dir; hx = clamp(Math.atan2(Math.sin(a), Math.cos(a)), -0.9, 0.9); } }
        parts.head.rotation.y += (hx - parts.head.rotation.y) * Math.min(1, 6 * dt);
        parts.head.rotation.x += (hy - parts.head.rotation.x) * Math.min(1, 6 * dt);
        const fl = c.hurtFlash > 0;
        m.traverse((o) => { if (o.material && o.material.emissive) { if (fl) { o.userData.em = o.userData.em || o.material.emissive.getHex(); } } });
        if (fl) { parts.body.material = BW.mat(0xff4444); } else if (parts.body.userData.baseMat) parts.body.material = parts.body.userData.baseMat;
        if (!parts.body.userData.baseMat) parts.body.userData.baseMat = parts.body.material;
      }
    }
  }

  // Hand interactions
  function feedCreature(G, c, thing) {
    if (thing.type === 'item' && thing.kind === 'food') { c.hunger = Math.max(0, c.hunger - thing.amount * 0.6); grow(G, c, 0.03); c.learned.eatFood = clamp(c.learned.eatFood + 0.05, 0, 1); G.remove(thing); speak(c, 'Thank you!'); G.particles.burst(c.x, c.y + c.size * 2, c.z, 15, 2, 0.8, 0xd9b24c, 1.6); return true; }
    if (thing.type === 'item' && thing.kind === 'wood') { c.hunger = Math.max(0, c.hunger - 15); G.remove(thing); speak(c, 'Splinters. But fine.'); return true; }
    if (thing.type === 'person') {
      if (c.alignment > 0.3) { speak(c, "I won't eat them. Put them down."); return false; }
      BW.die(G, thing, 'eaten'); c.hunger = Math.max(0, c.hunger - 45); grow(G, c, 0.04); c.learned.eatVillager = clamp(c.learned.eatVillager + 0.08, 0, 1); c.alignment = clamp(c.alignment - 0.06, -1, 1);
      BW.shiftAlignment(G, thing.owner === 0 ? -0.04 : -0.02); speak(c, 'Mmm. More?'); return true;
    }
    return false;
  }

  Object.assign(BW, { updateCreatures, hurtCreature, creatureFeedback: feedback, feedCreature, creatureSetAction: setAction, creatureObserve: observe });
})(window.BW);
