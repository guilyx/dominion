// ---------------------------------------------------------------------------
// miracles.js — casting miracles and running their timed effects.
// ---------------------------------------------------------------------------
(function (BW) {
  'use strict';
  const { dist, dist2, clamp } = BW;

  function shieldBlocking(G, x, z, owner) {
    for (const s of G.god.shields) if (s.owner !== owner && dist(s.x, s.z, x, z) < s.r) return s;
    return null;
  }

  function creatureWatch(G, kind, x, z) {
    const c = G.playerCreature();
    if (!c || !G.hasUnlock('c_miracles')) return;
    const key = 'cast' + kind.charAt(0).toUpperCase() + kind.slice(1);
    if (!(key in c.learned)) return;
    if (dist(c.x, c.z, x, z) < 55) { c.learned[key] = clamp(c.learned[key] + 0.12 * BW.SPECIES[c.species].learnRate, 0, 1); c.speak = `I saw you cast ${BW.MIRACLES[kind].name}. I think I can do that too.`; }
  }

  // owner 0 = player (pays prayer), others = enemy gods, 'creature' = free.
  function castMiracle(G, kind, x, z, owner = 0, free = false) {
    const def = BW.MIRACLES[kind];
    if (!def) return false;
    const y = G.groundY(x, z);
    if (owner === 0 && !free) {
      if (!G.hasUnlock(def.unlock)) { G.say('Miracle not unlocked. Spend Tribute to learn it.', 'warn'); return false; }
      if (G.god.prayer < def.cost) { G.say('Not enough Prayer Power. Assign more worshippers to an altar.', 'warn'); return false; }
      if (!G.inInfluence(x, z)) { G.say('You can only cast miracles inside your influence.', 'warn'); return false; }
      G.god.prayer -= def.cost; G.track(G.playerTown(), 'prayer', -def.cost);
      BW.shiftAlignment(G, def.align);
      G.god.stats.casts++;
      G.god.miracleImpress += def.cost / 6;
      for (const t of G.enemyTowns()) { const c = G.center(t); if (c && dist(c.x, c.z, x, z) < 45) t.loyalty -= def.align >= 0 ? 4 : 6; }
      creatureWatch(G, kind, x, z);
      if (kind === 'water') BW.creatureObserve(G, 'water', x, z);
      if (kind === 'fire' || kind === 'lightning' || kind === 'meteor') BW.advise && BW.advise(G, 'fireCast');
      if (!G.god.stats.firstCast) { G.god.stats.firstCast = 1; BW.grantTribute(G, 1, 'First miracle'); }
    }
    const hostile = ['fire', 'lightning', 'hurricane', 'meteor', 'siren'].includes(kind);
    if (hostile) {
      const s = shieldBlocking(G, x, z, owner);
      if (s) { G.particles.burst(x, y + 6, z, 40, 6, 1, 0x88ffee, 2); if (owner !== 0) G.say('Your shield absorbed an enemy miracle.', 'good'); else G.say('A shield blocks your miracle.', 'warn'); return true; }
    }
    const P = G.particles;
    switch (kind) {
      case 'water':
        G.effects.push({ kind: 'rain', x, z, r: def.radius, t: 9, owner });
        BW.audio.play('water');
        break;
      case 'heal':
        for (const p of G.inRadius(G.people, x, z, def.radius)) { p.health = p.maxHealth; p.hunger = Math.max(0, p.hunger - 30); }
        for (const c of G.inRadius(G.creatures, x, z, def.radius + 4)) c.health = Math.min(c.maxHealth, c.health + c.maxHealth * 0.5);
        P.burst(x, y + 1, z, 120, 6, 1.6, 0xffee88, 2.2, -2, 3);
        BW.audio.play('heal');
        break;
      case 'food': {
        const c = G.buildingAt(x, z, 2);
        if (c && c.kind === 'center') { const t = G.ents.get(c.town); if (t) { t.food += 140; if (t.owner !== 0) t.loyalty -= 6; } }
        else G.addItem('food', 140, x, z);
        P.burst(x, y + 1, z, 60, 4, 1.2, 0xd9b24c, 2, 3, 3);
        BW.audio.play('miracle');
        break;
      }
      case 'fire':
        explode(G, x, z, def.radius, 45, 140, owner, true);
        BW.audio.play('fire');
        if (G.camera) G.camera.shake = 1.2;
        break;
      case 'lightning':
        for (let i = 0; i < 40; i++) P.spawn(x + (BW.rand() - 0.5) * 2, y + i * 1.2, z + (BW.rand() - 0.5) * 2, 0, 0, 0, 0.5, 0xddeeff, 3);
        for (let i = 0; i < 20; i++) P.spawn(x + (BW.rand() - 0.5) * 6, y + 30 + i, z + (BW.rand() - 0.5) * 6, 0, 0, 0, 0.3, 0xffffff, 4);
        explode(G, x, z, def.radius, 70, 450, owner, true);
        BW.audio.play('lightning');
        if (G.camera) G.camera.shake = 1.5;
        break;
      case 'shield':
        G.god.shields.push({ x, z, r: def.radius, t: def.duration, owner });
        P.burst(x, y + 2, z, 80, 8, 1.5, 0x88ffee, 2.4);
        BW.audio.play('shield');
        break;
      case 'siren': {
        const pt = G.playerTown();
        let n = 0;
        for (const p of G.inRadius(G.people, x, z, def.radius)) if (p.owner !== owner && p.job !== 'soldier' && !p.inside && pt && owner === 0) { const from = BW.migrate(G, p, pt); if (from) from.loyalty -= 3; n++; }
        for (let i = 0; i < 100; i++) P.spawn(x + (BW.rand() - 0.5) * def.radius * 2, y + 1 + BW.rand() * 3, z + (BW.rand() - 0.5) * def.radius * 2, 0, 2 + BW.rand() * 2, 0, 2, 0xff88ff, 2.5);
        if (owner === 0) G.say(n ? `${n} villagers heed your song and join you.` : 'The song echoes, but nobody was there to hear it.', n ? 'good' : 'warn');
        BW.audio.play('siren');
        break;
      }
      case 'hurricane':
        G.effects.push({ kind: 'hurricane', x, z, r: def.radius, t: 7, owner, tick: 0 });
        BW.audio.play('water');
        break;
      case 'meteor':
        G.effects.push({ kind: 'meteor', x, z, r: def.radius, t: 3.0, owner });
        BW.audio.play('meteor');
        break;
    }
    return true;
  }

  function explode(G, x, z, r, personDmg, buildingDmg, owner, burn) {
    const y = G.groundY(x, z);
    const P = G.particles;
    P.burst(x, y + 1.5, z, 140, 12, 1.2, 0xff5522, 3, 4, 4);
    P.burst(x, y + 1.5, z, 60, 6, 2.0, 0x333333, 4, -1, 3);
    for (const p of G.inRadius(G.people, x, z, r)) { if (!p.inside) { const f = 1 - dist(p.x, p.z, x, z) / r * 0.5; BW.hurt(G, p, personDmg * f, owner); } }
    for (const b of G.inRadius(G.buildings, x, z, r + 3)) { BW.damageBuilding(G, b, buildingDmg, owner); b._lastAttacker = owner; if (burn && !b.dead && BW.rand() < 0.7) BW.igniteBuilding(G, b, 1); }
    for (const t of G.inRadius(G.trees, x, z, r)) if (burn) BW.igniteTree(G, t, 1);
    for (const c of G.inRadius(G.creatures, x, z, r + 2)) BW.hurtCreature(G, c, personDmg * 1.4, owner);
    if (owner === 0) BW.frighten(G, x, z, 10);
    for (const it of G.inRadius(G.items, x, z, r)) G.remove(it);
    BW.scare(G, x, z, r * 2.5, 5);
    if (owner === 0) { for (const p of G.people) if (p.owner === 0 && dist(p.x, p.z, x, z) < r) BW.shiftAlignment(G, -0.004); }
  }

  function updateEffects(G, dt) {
    const P = G.particles;
    for (const e of G.effects.slice()) {
      e.t -= dt;
      const y = G.groundY(e.x, e.z);
      if (e.kind === 'rain') {
        for (let i = 0; i < 40; i++) { const a = BW.rand() * 6.28, rr = Math.sqrt(BW.rand()) * e.r; P.spawn(e.x + Math.cos(a) * rr, y + 14 + BW.rand() * 4, e.z + Math.sin(a) * rr, 0, -22, 0, 0.7, 0x77bbff, 1.4); }
        if (BW.rand() < dt * 8) for (let i = 0; i < 8; i++) { const a = BW.rand() * 6.28, rr = BW.rand() * e.r; P.spawn(e.x + Math.cos(a) * rr, y + 16, e.z + Math.sin(a) * rr, (BW.rand() - 0.5) * 2, 0.2, (BW.rand() - 0.5) * 2, 1.5, 0xccddee, 5); }
        for (const b of G.inRadius(G.buildings, e.x, e.z, e.r + 2)) { if (b.kind === 'field') { b.rain = 14; } if (b.fire > 0) { b.fire = 0; b._dirty = true; } }
        for (const t of G.inRadius(G.trees, e.x, e.z, e.r + 1)) { if (t.fire > 0) { t.fire = 0; G.treesDirty = true; } t.hp = Math.min(40 * t.size, t.hp + dt * 5); }
        for (const c of G.inRadius(G.creatures, e.x, e.z, e.r)) if (c.owner === 0 && e.owner === 0 && !c.rained) { c.rained = 1; }
      } else if (e.kind === 'hurricane') {
        e.tick += dt;
        for (let i = 0; i < 30; i++) { const a = G.time * 6 + i * 0.7, rr = 2 + (i / 30) * e.r; P.spawn(e.x + Math.cos(a) * rr, y + 0.5 + i * 0.5, e.z + Math.sin(a) * rr, -Math.sin(a) * 10, 3, Math.cos(a) * 10, 0.6, 0xbbccdd, 2.2); }
        if (e.tick > 0.4) {
          e.tick = 0;
          for (const p of G.inRadius(G.people, e.x, e.z, e.r)) if (!p.inside && !p.held) { p.thrown = { vx: (BW.rand() - 0.5) * 24, vy: 10 + BW.rand() * 8, vz: (BW.rand() - 0.5) * 24, by: e.owner }; p.state = 'idle'; }
          for (const t of G.inRadius(G.trees, e.x, e.z, e.r).slice(0, 3)) { const it = G.addItem('wood', t.wood, t.x, t.z); it.thrown = { vx: (BW.rand() - 0.5) * 20, vy: 12, vz: (BW.rand() - 0.5) * 20 }; G.remove(t); }
          for (const b of G.inRadius(G.buildings, e.x, e.z, e.r + 2)) BW.damageBuilding(G, b, 25, e.owner);
          for (const c of G.inRadius(G.creatures, e.x, e.z, e.r)) BW.hurtCreature(G, c, 15, e.owner);
        }
      } else if (e.kind === 'meteor') {
        const h = e.t * 60;
        for (let i = 0; i < 6; i++) P.spawn(e.x + (BW.rand() - 0.5) * 3 + e.t * 20, y + h + BW.rand() * 4, e.z + (BW.rand() - 0.5) * 3, 0, 0, 0, 0.6, 0xff9933, 6);
        if (e.t <= 0) {
          explode(G, e.x, e.z, e.r, 120, 1200, e.owner, true);
          P.burst(e.x, y + 2, e.z, 200, 20, 2, 0xffaa55, 4, 5, 6);
          for (const t of G.inRadius(G.trees, e.x, e.z, e.r)) G.remove(t);
          if (G.camera) G.camera.shake = 4;
          BW.audio.play('fire');
        }
      }
      if (e.t <= 0) G.effects.splice(G.effects.indexOf(e), 1);
    }
    // Shields
    for (const s of G.god.shields.slice()) {
      s.t -= dt;
      if (!s._mesh) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(s.r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhongMaterial({ color: 0x88ffee, transparent: true, opacity: 0.22, emissive: 0x228877, emissiveIntensity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
        m.position.set(s.x, G.groundY(s.x, s.z) - 1, s.z); s._mesh = m; G.gfx.world.add(m);
      }
      s._mesh.material.opacity = 0.15 + Math.sin(G.time * 3) * 0.05 + (s.t < 5 ? Math.sin(G.time * 20) * 0.1 : 0);
      if (s.t <= 0) { G.gfx.world.remove(s._mesh); G.god.shields.splice(G.god.shields.indexOf(s), 1); }
    }
  }

  Object.assign(BW, { castMiracle, updateEffects, explode, shieldBlocking });
})(window.BW);
