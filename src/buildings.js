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
    for (const [ox, oz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, 0]]) if (!T.isLand(x + ox, z + oz)) return 'Must be on land';
    let hmin = 1e9, hmax = -1e9;
    for (const [ox, oz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, 0], [0, hd], [0, -hd], [hw, 0], [-hw, 0]]) { const h = T.heightAt(x + ox, z + oz); hmin = Math.min(hmin, h); hmax = Math.max(hmax, h); }
    if (hmax - hmin > 3.2) return 'Ground too steep';
    for (const b of G.buildings) {
      const d = BW.BUILDINGS[b.kind];
      if (Math.abs(x - b.x) < hw + d.w / 2 + 1 && Math.abs(z - b.z) < hd + d.d / 2 + 1) return 'Overlaps a building';
    }
    if (requireInfluence && town && town.owner === 0 && !G.inInfluence(x, z)) return 'Outside your influence';
    if (town) { const c = G.center(town); if (c && dist(c.x, c.z, x, z) > 70) return 'Too far from the town'; }
    return null;
  }

  function placeBuilding(G, kind, town, x, z, rot = 0, built = false) {
    const def = BW.BUILDINGS[kind];
    // Clear trees and rocks under the footprint.
    for (const t of G.trees.slice()) if (Math.abs(t.x - x) < def.w / 2 + 0.5 && Math.abs(t.z - z) < def.d / 2 + 0.5) { if (town.owner === 0) G.deposit(town, 'wood', Math.floor(t.wood * 0.5)); G.remove(t); }
    for (const r of G.rocks.slice()) if (Math.abs(r.x - x) < def.w / 2 + 0.5 && Math.abs(r.z - z) < def.d / 2 + 0.5) G.remove(r);
    const b = G.addBuilding(kind, town, x, z, rot, built);
    return b;
  }

  function completeBuilding(G, b) {
    const def = BW.BUILDINGS[b.kind];
    b.built = true; b.progress = 1; b.hp = def.hp;
    G.syncBuilding(b);
    G.particles.burst(b.x, b.y + 3, b.z, 30, 4, 1, 0xffe9a0, 1.6, 2, 3);
    if (b.owner === 0) {
      BW.audio.play('build');
      G.say(def.name + ' completed.', 'good');
      if (b.kind === 'wonder') BW.grantTribute(G, 2, 'Wonder built');
    }
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
      G.remove(b);
      BW.townFalls(G, town, attackerOwner, 'destroyed');
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
        if (Math.random() < dt * 20) G.particles.spawn(b.x + (Math.random() - 0.5) * def.w * 0.8, b.y + 1 + Math.random() * 3, b.z + (Math.random() - 0.5) * def.d * 0.8, (Math.random() - 0.5), 4 + Math.random() * 3, (Math.random() - 0.5), 0.9, Math.random() < 0.5 ? 0xff6a22 : 0xffaa33, 2.4, -2);
        if (Math.random() < dt * 3) G.particles.spawn(b.x, b.y + 4, b.z, 0, 3, 0, 2.5, 0x333333, 4, -1);
        if (Math.random() < dt * 0.25 * b.fire) {
          for (const t of G.inRadius(G.trees, b.x, b.z, 8)) if (Math.random() < 0.3) igniteTree(G, t, 0.8);
          for (const o of G.inRadius(G.buildings, b.x, b.z, 10)) if (o !== b && Math.random() < 0.25) igniteBuilding(G, o, 0.8);
        }
        if (b.hp <= 0) { destroyBuilding(G, b, b._lastAttacker); continue; }
      }
      if (b.rain > 0) b.rain -= dt;
      if (b.kind === 'field' && b.built) {
        const grow = b.rain > 0 ? 0.02 : 0.003;
        if (b.crop < 1) { b.crop = Math.min(1, b.crop + grow * dt); if (Math.random() < dt) b._dirty = true; }
      }
      if (b.kind === 'tower' && b.built) {
        b.timer += dt;
        if (b.timer > 0.9) {
          b.timer = 0;
          let target = G.nearest(G.people, b.x, b.z, 18, (p) => p.owner !== b.owner && (p.job === 'soldier' || G.ents.get(p.town) && G.ents.get(p.town).owner !== b.owner) && !p.inside);
          let isCreature = false;
          const c = G.nearest(G.creatures, b.x, b.z, 22, (cr) => cr.owner !== b.owner);
          if (c && (!target || dist2(c.x, c.z, b.x, b.z) < dist2(target.x, target.z, b.x, b.z))) { target = c; isCreature = true; }
          if (target) {
            const dx = target.x - b.x, dz = target.z - b.z, dy = (target.y + 1) - (b.y + 9), l = Math.hypot(dx, dy, dz);
            for (let k = 0; k < 6; k++) G.particles.spawn(b.x + dx / l * k * 2, b.y + 9 + dy / l * k * 2, b.z + dz / l * k * 2, dx / l * 30, dy / l * 30, dz / l * 30, 0.25, 0xffffff, 1.2);
            if (isCreature) BW.hurtCreature(G, target, 6, b.owner); else BW.hurt(G, target, 7, b.owner);
          }
        }
      }
      if (b._dirty) { b._dirty = false; G.syncBuilding(b); }
      if (b._mesh) {
        const fl = b._mesh.getObjectByName('flame'); if (fl) fl.scale.setScalar(0.9 + Math.sin(G.time * 9 + b.id) * 0.15);
        const orb = b._mesh.getObjectByName('orb'); if (orb) orb.position.y = (b.kind === 'wonder' ? 11 : 11.4) + Math.sin(G.time * 2 + b.id) * 0.3;
      }
    }
    // Trees on fire
    let any = false;
    for (const t of G.trees) {
      if (t.fire > 0) {
        any = true;
        t.fire -= dt * 0.05; t.hp -= dt * 10;
        if (Math.random() < dt * 12) G.particles.spawn(t.x + (Math.random() - 0.5), t.y + 2 + Math.random() * 2, t.z + (Math.random() - 0.5), 0, 3 + Math.random() * 2, 0, 0.7, 0xff7a22, 2.2, -2);
        if (Math.random() < dt * 0.3 * t.fire) { for (const o of G.inRadius(G.trees, t.x, t.z, 5.5)) if (o !== t && !o.burnt && o.fire <= 0 && Math.random() < 0.4) igniteTree(G, o, 0.9); for (const b of G.inRadius(G.buildings, t.x, t.z, 6)) if (Math.random() < 0.15) igniteBuilding(G, b, 0.7); }
        if (t.hp <= 0 || t.fire <= 0) { t.fire = 0; if (t.hp <= 0) { t.burnt = 1; t.wood = 0; } G.treesDirty = true; }
      }
    }
    if (any && Math.random() < dt * 2) G.treesDirty = true;
  }

  // Find a valid spot for a building around a center (used by AI and setup).
  function findSpot(G, kind, town, cx, cz, rmin, rmax, rng, tries = 30) {
    for (let i = 0; i < tries; i++) {
      const a = rng.next() * Math.PI * 2, r = rmin + rng.next() * (rmax - rmin);
      const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      if (!footprintOk(G, kind, x, z, town, false)) return { x, z, rot: Math.round(a / (Math.PI / 2)) * (Math.PI / 2) };
    }
    return null;
  }

  Object.assign(BW, { footprintOk, placeBuilding, completeBuilding, damageBuilding, destroyBuilding, igniteBuilding, igniteTree, updateBuildings, findSpot });
})(window.BW);
