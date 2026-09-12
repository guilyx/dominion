// ---------------------------------------------------------------------------
// director.js — seasons, weather, the pacing director that schedules events
// (raids, plagues, migrants, storms...) and the two conscience advisors.
// ---------------------------------------------------------------------------
(function (BW) {
  'use strict';
  const { dist, clamp } = BW;

  const ADVICE = {
    start: ['Your people are waiting. Feed them, house them, give them somewhere to pray, and they will adore you.', 'Or pick one up and hurl him into the sea. The rest will work twice as hard.'],
    starve: ['Someone starved. More fields, more farmers, and rain on the crops when you can spare the prayer.', 'Starvation is a lesson. The survivors will value your generosity more.'],
    attack: ['Enemy soldiers are coming. Walls and a watchtower buy time; your creature is your best defender.', 'Let them come. Fireball the column while it marches and there will be nothing left to fight.'],
    prayerFull: ['Your prayer is full and going to waste. Cast Water on the fields, or Heal your people.', 'Full prayer is a weapon on a shelf. Use it on the neighbours.'],
    ateVillager: ['Your creature ate one of your own. Tap it firmly, now, before it learns to like it.', 'Stroke it. A creature that eats villagers will make short work of enemy towns.'],
    tribute: ['Tribute! Spend it on things that help your people: Heal, Food, wider influence.', 'Spend it on Fireball. Everything else is decoration.'],
    lowLoyalty: ['A rival town is wavering. A gift of food on their hall would tip them over.', 'They are afraid. Good. Cast something loud near them and they will beg to join.'],
    winter: ['Winter is here. Crops barely grow and your people burn wood to stay warm. Keep the store full.', 'Winter is when the weak die. Fewer mouths, more wood.'],
    plague: ['Plague! Heal the sick before it spreads, and keep them away from the temple.', 'Throw the sick out of town. Far. Preferably into the sea.'],
    unhappy: ['Your villagers are unhappy. Check what they lack: food, homes, an altar, safety.', 'Unhappy people pray harder. Let them stew.'],
    era: ['A new age! New buildings are open to you in the Build tab. Keep the scholars studying.', 'Progress. Now build the armoury and put it to use.'],
    legend: ['A legend among your workers. Keep them at their trade and everyone beside them improves.', 'Work them until they drop. Legends are replaceable.'],
    settle: ['A new settlement. Send it families and it will grow into a second heart for your faith.', 'A second temple means a second army.'],
    converted: ['They chose you. Treat them as your own and the next town will follow.', 'They folded without a fight. Weak. But useful.'],
    conquered: ['Taken by force. It will take time before they truly believe.', 'That is how it is done. Who is next?'],
    creatureDown: ['Your creature is down. Keep it fed and out of hopeless fights. Heal helps it recover.', 'Pathetic. Punish it when it wakes so it fights harder next time.'],
    fireCast: ['Fire spreads. Be ready to cast Water if it turns on you.', 'Beautiful, is it not? Do it again.'],
    throw: ['You threw a villager. They remember these things.', 'Ha! Did you see him fly? Further next time.'],
    storm: ['A storm is coming. Lightning starts fires; keep Water ready.', 'A storm. Free lightning. Enjoy the show.'],
    raid: ['Raiders! Get your creature home and rally your soldiers.', 'Raiders. Fresh meat for the creature.'],
  };

  function advise(G, key) {
    if (!ADVICE[key]) return;
    G.advised = G.advised || {};
    if (G.advised[key]) return;
    G.advised[key] = 1;
    if (G.onAdvice) G.onAdvice(ADVICE[key][0], ADVICE[key][1]);
  }

  function updateSeasons(G) {
    const day = Math.floor(G.time / G.dayLength);
    const season = BW.SEASONS[Math.floor(day / 2) % 4];
    if (season !== G.season) {
      G.season = season; G.treesDirty = true;
      G.terrain.recolor(G.god.alignment, season);
      G.say(`${season.charAt(0).toUpperCase() + season.slice(1)} has come.`, 'info');
      if (season === 'winter') advise(G, 'winter');
    }
  }

  function updateWeather(G, dt) {
    const w = G.weather;
    w.t -= dt;
    if (w.t <= 0) {
      const r = BW.rand();
      if (w.kind !== 'clear') { w.kind = 'clear'; w.t = 60 + BW.rand() * 120; }
      else if (r < 0.22) { w.kind = 'rain'; w.t = 40 + BW.rand() * 50; }
      else if (r < 0.32 && G.season !== 'winter') { w.kind = 'storm'; w.t = 30 + BW.rand() * 30; G.say('Storm clouds gather.', 'warn'); advise(G, 'storm'); }
      else if (r < 0.45 && G.season === 'summer') { w.kind = 'drought'; w.t = 60 + BW.rand() * 60; G.say('A drought sets in. Crops wither without Water.', 'warn'); }
      else { w.kind = 'clear'; w.t = 60 + BW.rand() * 120; }
      w.strike = 0;
    }
    const cam = G.camera; if (!cam) return;
    const P = G.particles;
    if (w.kind === 'rain' || w.kind === 'storm') {
      const n = w.kind === 'storm' ? 70 : 40, r = Math.min(160, 60 + cam.dist);
      for (let i = 0; i < n; i++) { const a = BW.rand() * 6.28, rr = Math.sqrt(BW.rand()) * r; const x = cam.tx + Math.cos(a) * rr, z = cam.tz + Math.sin(a) * rr; P.spawn(x, G.groundY(x, z) + 18 + BW.rand() * 10, z, w.kind === 'storm' ? 3 : 0, -26, 0, 0.8, 0x7fb0e0, 1.2); }
      if (G.season === 'winter') { for (let i = 0; i < 20; i++) { const a = BW.rand() * 6.28, rr = Math.sqrt(BW.rand()) * r; const x = cam.tx + Math.cos(a) * rr, z = cam.tz + Math.sin(a) * rr; P.spawn(x, G.groundY(x, z) + 16, z, 0.5, -4, 0.3, 4, 0xffffff, 1.6); } }
    }
    if (w.kind === 'storm') {
      w.strike = (w.strike || 0) + dt;
      if (w.strike > 7 + BW.rand() * 6) {
        w.strike = 0;
        const t = G.towns[Math.floor(BW.rand() * G.towns.length)];
        const a = BW.rand() * 6.28, rr = 20 + BW.rand() * 50;
        const x = t.x + Math.cos(a) * rr, z = t.z + Math.sin(a) * rr;
        if (G.terrain.isLand(x, z)) {
          const y = G.groundY(x, z);
          for (let i = 0; i < 30; i++) P.spawn(x + (BW.rand() - 0.5) * 2, y + i * 1.5, z + (BW.rand() - 0.5) * 2, 0, 0, 0, 0.4, 0xddeeff, 3);
          BW.explode(G, x, z, 3, 25, 120, -1, true);
          if (cam.dist < 200 && dist(cam.tx, cam.tz, x, z) < 150) { BW.audio.play('lightning'); cam.shake = 0.6; }
        }
      }
    }
    if (w.kind === 'drought' && BW.rand() < dt * 0.01) { const t = G.trees[Math.floor(BW.rand() * G.trees.length)]; if (t && !t.burnt && G.enemyTowns().concat(G.playerTowns()).some((tw) => dist(tw.x, tw.z, t.x, t.z) < 90)) BW.igniteTree(G, t, 0.6); }
  }

  // Pacing: after a calm period, throw something at the player, scaled to how strong they are.
  function updateDirector(G, dt) {
    const d = G.director; d.nextEvent -= dt;
    if (d.nextEvent > 0 || G.time < 180) return;
    const pt = G.playerTown(); if (!pt) return;
    const pc = G.center(pt); if (!pc) return;
    const soldiers = G.people.filter((p) => p.owner === 0 && p.job === 'soldier').length;
    const strength = (G.god.pop || 0) / 40 + soldiers / 10 + (G.god.impress || 0) / 200;
    const weak = strength < 0.8;
    const enemies = G.enemyTowns();
    const opts = [
      ['migrants', weak ? 3 : 1], ['bounty', weak ? 3 : 1], ['prophet', 1], ['storm', weak ? 1 : 2],
      ['plague', weak ? 0.4 : 2], ['raid', enemies.length ? (weak ? 0.5 : 3) : 0], ['wildfire', G.weather.kind === 'drought' ? 2 : 0],
    ];
    let sum = 0; for (const o of opts) sum += o[1];
    let r = BW.rand() * sum, kind = 'bounty';
    for (const o of opts) { r -= o[1]; if (r <= 0) { kind = o[0]; break; } }
    d.last = kind; d.log.push(Math.round(G.time) + ':' + kind);
    d.nextEvent = 220 + BW.rand() * 160 - G.landIndex * 20;
    switch (kind) {
      case 'migrants': {
        const n = 3 + Math.floor(BW.rand() * 5);
        let sx = pc.x, sz = pc.z;
        for (let i = 0; i < 20; i++) { const a = BW.rand() * 6.28, rr = 70 + BW.rand() * 40; const x = pc.x + Math.cos(a) * rr, z = pc.z + Math.sin(a) * rr; if (G.terrain.isLand(x, z) && G.terrain.inBounds(x, z)) { sx = x; sz = z; break; } }
        for (let i = 0; i < n; i++) G.addPerson(pt, sx + (BW.rand() - 0.5) * 6, sz + (BW.rand() - 0.5) * 6, 'idle');
        G.say(`${n} wanderers heard of you and are walking to your temple.`, 'good'); break;
      }
      case 'bounty': { G.addItem('food', 220, pc.x + 12, pc.z + 8); G.say('A herd passed through. There is meat piled by the temple. Drop it in to store it.', 'good'); break; }
      case 'prophet': { const cands = G.people.filter((p) => p.owner === 0 && p.job !== 'soldier'); if (cands.length) { const p = cands[Math.floor(BW.rand() * cands.length)]; p.trait = 'chosen'; G.say(`${p.name} has visions of you. The town calls them a prophet. Impressiveness rises while they live.`, 'good'); } break; }
      case 'storm': { G.weather = { kind: 'storm', t: 35 + BW.rand() * 20, strike: 0 }; G.say('A sudden storm rolls in.', 'warn'); advise(G, 'storm'); break; }
      case 'plague': { const cands = G.people.filter((p) => p.owner === 0 && p.job !== 'soldier'); const n = Math.min(cands.length, 2 + Math.floor(cands.length / 10)); for (let i = 0; i < n; i++) cands[Math.floor(BW.rand() * cands.length)].sick = 120; G.say('Plague! Sick villagers glow green. Cast Heal on them before it spreads.', 'bad'); advise(G, 'plague'); break; }
      case 'raid': {
        const t = enemies[Math.floor(BW.rand() * enemies.length)]; const c = G.center(t); if (!c) break;
        const n = 5 + Math.floor(strength * 3);
        const members = []; for (let i = 0; i < n; i++) { const s = G.addPerson(t, c.x + 6 + i, c.z + 6, 'idle'); members.push(s); }
        const pl = G.addPlatoon(t, members); pl.initial = n; pl.mode = 'attack';
        const target = G.nearest(G.buildings, c.x, c.z, 1e4, (b) => b.owner === 0 && b.built); if (target) pl.targetId = target.id;
        for (const s of members) { s.unit = 'melee'; s.maxHealth = 60; s.health = 60; }
        G.say(`Raiders from ${t.name} are marching on your town!`, 'bad'); advise(G, 'raid'); BW.audio.play('growl'); break;
      }
      case 'wildfire': { const t = G.nearest(G.trees, pc.x, pc.z, 80, (x) => !x.burnt); if (t) { BW.igniteTree(G, t, 1); G.say('Wildfire! The drought has set the forest alight.', 'bad'); } break; }
    }
  }

  function updateWorld(G, dt) { updateSeasons(G); updateWeather(G, dt); updateDirector(G, dt); if (G.god.prayer >= G.god.maxPrayer - 1) advise(G, 'prayerFull'); }

  Object.assign(BW, { advise, updateWorld: updateWorld });
})(window.BW);
