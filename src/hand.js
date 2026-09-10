// ---------------------------------------------------------------------------
// hand.js — the divine hand: hover picking, grabbing, throwing, dropping onto
// things, stroking/slapping the creature, and the build/miracle/army modes.
// ---------------------------------------------------------------------------
(function (BW) {
  'use strict';
  const { dist, dist2, clamp } = BW;
  const input = BW.input;

  class Hand {
    constructor(G, camera) {
      this.G = G; this.camera = camera;
      this.mesh = BW.handMesh();
      G.gfx.scene.add(this.mesh);
      this.hover = null; this.hoverEnt = null;
      this.held = null;
      this.hist = [];
      this.touch = null;
      this.mode = null;         // {type:'build',kind} | {type:'miracle',kind} | {type:'army'}
      this.ghost = null; this.ghostRot = 0;
      this.ring = BW.groundRing(10, 0xffffff); this.ring.visible = false; G.gfx.world.add(this.ring);
      this.selRing = BW.groundRing(4, 0xffff66); this.selRing.visible = false; G.gfx.world.add(this.selRing);
      this.downPos = null; this.downT = 0; this.rightDown = null;
      this.lineStart = null;
      this.lineMesh = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xffe9a0 })); this.lineMesh.visible = false; G.gfx.world.add(this.lineMesh);
      this.gesture = null;
      this.gcanvas = document.getElementById('gesture');
      input.onDown = (e) => this.onDown(e);
      input.onUp = (e) => this.onUp(e);
      input.onMove = () => { if (this.gesture) { const last = this.gesture[this.gesture.length - 1]; if (Math.hypot(input.mx - last.x, input.my - last.y) > 3) this.gesture.push({ x: input.mx, y: input.my }); } };
    }

    // ---------------------------------------------------------- gestures
    // Hold Ctrl and draw with the left button: circle = Water, V = Heal,
    // zigzag = Fireball, vertical stroke = Lightning, horizontal = Shield.
    static templates() {
      if (Hand._tpl) return Hand._tpl;
      const mk = (fn) => { const pts = []; for (let i = 0; i <= 40; i++) pts.push(fn(i / 40)); return Hand.normalize(pts); };
      Hand._tpl = {
        water: mk((t) => ({ x: Math.cos(t * 6.283 - 1.57), y: Math.sin(t * 6.283 - 1.57) })),
        heal: mk((t) => ({ x: t * 2 - 1, y: t < 0.5 ? t * 2 : 2 - t * 2 })),
        fire: mk((t) => ({ x: t * 2 - 1, y: (Math.floor(t * 4) % 2 ? 1 : -1) * (1 - Math.abs(((t * 4) % 1) * 2 - 1)) })),
        lightning: mk((t) => ({ x: 0, y: 1 - t * 2 })),
        shield: mk((t) => ({ x: t * 2 - 1, y: 0 })),
      };
      return Hand._tpl;
    }
    static normalize(pts) {
      // resample to 32 points along the stroke, then scale to a unit box and centre.
      let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      const step = len / 31, out = [pts[0]]; let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        let a = pts[i - 1], b = pts[i]; let d = Math.hypot(b.x - a.x, b.y - a.y);
        while (acc + d >= step && out.length < 32) { const t = (step - acc) / d; const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; out.push(q); a = q; d = Math.hypot(b.x - a.x, b.y - a.y); acc = 0; }
        acc += d;
      }
      while (out.length < 32) out.push(pts[pts.length - 1]);
      let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
      for (const p of out) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y); }
      const w = Math.max(maxx - minx, 1e-3), hh = Math.max(maxy - miny, 1e-3), s = Math.max(w, hh);
      const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
      return out.map((p) => ({ x: (p.x - cx) / s * 2, y: (p.y - cy) / s * 2 }));
    }
    // Feature-based recognition: shape features are robust to where the
    // stroke starts and how fast it was drawn.
    recognize(pts) {
      if (pts.length < 3) return null;
      let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, L = 0;
      for (let i = 0; i < pts.length; i++) { const p = pts[i]; minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y); if (i) L += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y); }
      const w = maxx - minx, h = maxy - miny, d = Math.max(w, h);
      if (d < 30) return null;
      const closure = Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y) / d;
      const aspect = w / Math.max(h, 1);
      if (h > 2.5 * w && L < 1.4 * h) return 'lightning';
      if (w > 2.5 * h && L < 1.4 * w) return 'shield';
      // Zigzag: repeated reversals along the stroke's minor axis, with hysteresis.
      const minor = w > h ? 'y' : 'x', span = Math.min(w, h);
      let rev = 0, dir = 0, ref = pts[0][minor];
      for (const p of pts) { const v = p[minor]; if (dir >= 0 && v < ref - span * 0.3) { if (dir === 1) rev++; dir = -1; ref = v; } else if (dir <= 0 && v > ref + span * 0.3) { if (dir === -1) rev++; dir = 1; ref = v; } else if ((dir >= 0 && v > ref) || (dir <= 0 && v < ref)) ref = v; }
      if (rev >= 2 && closure > 0.3) return 'fire';
      if (closure < 0.4 && L > 2.4 * d && aspect > 0.5 && aspect < 2) return 'water';
      // V: one sharp low point in the middle, both ends high
      let lowI = 0; for (let i = 0; i < pts.length; i++) if (pts[i].y > pts[lowI].y) lowI = i;
      const frac = lowI / (pts.length - 1);
      if (closure > 0.5 && frac > 0.25 && frac < 0.75 && pts[0].y < miny + h * 0.4 && pts[pts.length - 1].y < miny + h * 0.4 && L < 2.6 * d) return 'heal';
      return null;
    }
    drawGesture() {
      const c = this.gcanvas; if (!c) return;
      if (c.width !== innerWidth || c.height !== innerHeight) { c.width = innerWidth; c.height = innerHeight; }
      const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height);
      if (!this.gesture) return;
      ctx.strokeStyle = 'rgba(255,233,160,0.9)'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.shadowColor = '#ffd080'; ctx.shadowBlur = 12;
      ctx.beginPath(); this.gesture.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
    }

    setMode(m) {
      this.mode = m;
      if (this.ghost) { this.G.gfx.world.remove(this.ghost); this.ghost = null; }
      if (m && m.type === 'build') {
        const fake = { id: -1, kind: m.kind, owner: 0 };
        const g = BW.buildingMesh(fake, 0, this.G.god.alignment);
        g.traverse((o) => { if (o.isMesh && o.name !== 'scaffold') { o.material = new THREE.MeshLambertMaterial({ color: 0x66ff66, transparent: true, opacity: 0.55 }); o.castShadow = false; } });
        const sc = g.getObjectByName('scaffold'); if (sc) sc.visible = false;
        this.ghost = g; this.G.gfx.world.add(g);
      }
      this.ring.visible = !!(m && m.type === 'miracle');
      if (m && m.type === 'miracle') this.ring.material.color.set(BW.MIRACLES[m.kind].color);
      if (this.G.ui) this.G.ui.onModeChanged(m);
    }

    pickable(e) { return e && (e.type === 'person' || e.type === 'item' || e.type === 'tree' || e.type === 'rock'); }

    findHover() {
      const G = this.G, h = this.hover; if (!h) return null;
      const scale = clamp(this.camera.dist / 60, 0.8, 2.5);
      let best = null, bd = 1e9;
      const consider = (e, r) => { const d = dist(e.x, e.z, h.x, h.z); if (d < r * scale && d < bd) { bd = d; best = e; } };
      for (const c of G.creatures) consider(c, 2.2 * c.size + 0.5);
      for (const p of G.people) if (!p.inside && !p.held) consider(p, 1.3);
      for (const it of G.items) if (!it.held) consider(it, 1.4);
      for (const t of G.trees) if (!t.burnt) consider(t, 1.6);
      for (const r of G.rocks) consider(r, 1.7);
      if (best) return best;
      const b = G.buildingAt(h.x, h.z, 0.5);
      return b || null;
    }

    update(dt) {
      const G = this.G;
      this.hover = this.camera.groundPoint(input.mx, input.my);
      this.hoverEnt = this.hover ? this.findHover() : null;
      if (this.hoverEnt === this.held) this.hoverEnt = null;
      // pointer history for throw velocity
      if (this.hover) { this.hist.push({ x: this.hover.x, z: this.hover.z, t: performance.now() }); if (this.hist.length > 8) this.hist.shift(); }
      // Gesture drawing
      if (this.gesture) this.drawGesture();
      // Wall / road drag preview
      if (this.lineStart && this.hover) {
        const a = this.lineStart, b = this.hover; const pos = this.lineMesh.geometry.attributes.position;
        pos.setXYZ(0, a.x, a.y + 1.5, a.z); pos.setXYZ(1, b.x, b.y + 1.5, b.z); pos.needsUpdate = true; this.lineMesh.visible = true;
        this.ghostErr = `${Math.max(1, Math.round(dist(a.x, a.z, b.x, b.z) / BW.BUILDINGS[this.mode.kind].w) + 1)} segments`;
      } else this.lineMesh.visible = false;
      // Stroke detection
      if (this.touch && this.hover) {
        this.touch.moved += Math.hypot(input.dx, input.dy);
        if (this.touch.moved > 60 && !this.touch.stroked && performance.now() - this.touch.t0 > 250) { this.touch.stroked = true; const c = G.ents.get(this.touch.id); if (c && !c.dead) BW.creatureFeedback(G, c, +1); }
      }
      // Mesh
      const m = this.mesh;
      if (this.hover) {
        m.visible = true;
        let lift = this.held ? 3.2 : 2.2;
        const hb = G.buildingAt(this.hover.x, this.hover.z, 0.5); if (hb) lift += (BW.BUILDING_HEIGHT[hb.kind] || 3) * (hb.built ? 1 : 0.15 + 0.85 * hb.progress);
        if (this.hoverEnt && this.hoverEnt.type === 'creature') lift += this.hoverEnt.size * 3.5;
        if (this.hoverEnt && this.hoverEnt.type === 'tree') lift += 3;
        m.position.set(this.hover.x, this.hover.y + lift, this.hover.z);
        m.rotation.set(0, this.camera.yaw + Math.PI, 0);
        m.rotation.x = -0.35;
        const ud = m.userData;
        const grab = !!this.held || !!this.touch;
        const point = !!this.mode;
        for (let i = 0; i < ud.fingers.length; i++) {
          const f = ud.fingers[i];
          const target = grab ? -1.3 : point ? (i === 0 ? 0 : -1.2) : 0;
          f.rotation.x += (target - f.rotation.x) * Math.min(1, dt * 14);
          f.children[1].visible = G.god.alignment < -0.4;
        }
        ud.thumb.rotation.x += ((grab ? -0.9 : 0) - ud.thumb.rotation.x) * Math.min(1, dt * 14);
        const al = G.god.alignment;
        ud.mat.color.set(al < -0.4 ? 0x6a2a2a : al > 0.4 ? 0xfff8ec : 0xf1e4d0);
        ud.mat.emissive.set(al < -0.4 ? 0x330000 : al > 0.4 ? 0x443311 : 0x221100);
        ud.glow.intensity = this.mode && this.mode.type === 'miracle' ? 1.5 : 0;
        if (this.mode && this.mode.type === 'miracle') ud.glow.color.set(BW.MIRACLES[this.mode.kind].color);
        if (this.held) { const e = this.held; e.x = this.hover.x; e.z = this.hover.z; e.y = this.hover.y + 1.6; if (e.type === 'person') e.dir += dt * 3; }
        if (this.ghost) {
          this.ghost.position.set(this.hover.x, this.hover.y, this.hover.z); this.ghost.rotation.y = this.ghostRot;
          const t = G.playerTown();
          const err = BW.footprintOk(G, this.mode.kind, this.hover.x, this.hover.z, t);
          const can = t && G.canAfford(t, BW.BUILDINGS[this.mode.kind].cost);
          const col = err || !can ? 0xff5555 : 0x66ff66;
          this.ghost.traverse((o) => { if (o.isMesh && o.name !== 'scaffold') o.material.color.set(col); });
          this.ghostErr = err || (!can ? 'Not enough resources' : null);
        }
        if (this.ring.visible) BW.updateRing(this.ring, this.hover.x, this.hover.z, BW.MIRACLES[this.mode.kind].radius, G.terrain);
      } else m.visible = false;
      // Selected platoon ring
      const pl = G.ents.get(G.selectedPlatoon);
      if (pl && this.mode && this.mode.type === 'army') { this.selRing.visible = true; BW.updateRing(this.selRing, pl.x, pl.z, 4, G.terrain); }
      else this.selRing.visible = false;
    }

    velocity() {
      if (this.hist.length < 3) return { x: 0, z: 0 };
      const a = this.hist[0], b = this.hist[this.hist.length - 1];
      const dtm = (b.t - a.t) / 1000; if (dtm < 0.01) return { x: 0, z: 0 };
      return { x: (b.x - a.x) / dtm, z: (b.z - a.z) / dtm };
    }

    onDown(e) {
      const G = this.G;
      BW.audio.init(); BW.audio.resume();
      if (e.button === 0) {
        this.downPos = { x: input.mx, y: input.my }; this.downT = performance.now();
        if (!this.hover) return;
        const h = this.hover, ent = this.hoverEnt;
        if (input.keys.ControlLeft || input.keys.ControlRight) { this.gesture = [{ x: input.mx, y: input.my }]; return; }
        if (this.mode) {
          if (this.mode.type === 'build') { if (BW.BUILDINGS[this.mode.kind].line) { this.lineStart = { x: h.x, y: h.y, z: h.z }; return; } return this.tryBuild(); }
          if (this.mode.type === 'miracle') { if (BW.castMiracle(G, this.mode.kind, h.x, h.z, 0)) { if (!input.keys.ShiftLeft) this.setMode(null); } return; }
          if (this.mode.type === 'send') { const c = G.playerCreature(); if (c) { c.sendGoal = { x: h.x, z: h.z }; c.leash = 'free'; c.state = 'going'; G.say('Creature is on its way.', 'info'); } this.setMode(null); return; }
          if (this.mode.type === 'army') { const pl = G.ents.get(G.selectedPlatoon); if (pl) BW.commandPlatoon(G, pl, h.x, h.z, ent); if (!input.keys.ShiftLeft) this.setMode(null); return; }
        }
        if (this.held) return;
        if (ent && ent.type === 'creature') {
          if (ent.owner === 0) this.touch = { id: ent.id, t0: performance.now(), moved: 0, stroked: false };
          else this.camera.beginPan(input.mx, input.my);
          return;
        }
        if (ent && this.pickable(ent)) {
          if (!G.inInfluence(ent.x, ent.z)) { G.say('That is outside your influence.', 'warn'); this.camera.beginPan(input.mx, input.my); return; }
          if (ent.type === 'person' && (input.keys.AltLeft || input.keys.AltRight)) { // slap to hurry
            ent.hurry = 10; ent.fear = 0.6; ent.fx = h.x + 1; ent.fz = h.z + 1; G.particles.burst(ent.x, ent.y + 1.5, ent.z, 8, 2, 0.4, 0xffcc66, 1.2); BW.audio.play('thud'); if (ent.owner === 0) BW.shiftAlignment(G, -0.002); return;
          }
          this.pickUp(ent); return;
        }
        if (ent && ent.type === 'building') { G.selectedBuilding = ent.id; if (G.ui) G.ui.showBuilding(ent); }
        this.camera.beginPan(input.mx, input.my);
      } else if (e.button === 2 || e.button === 1) {
        this.rightDown = { x: input.mx, y: input.my, t: performance.now() };
        this.camera.rotating = true;
      }
    }

    onUp(e) {
      const G = this.G;
      if (e.button === 0) {
        this.camera.endPan();
        if (this.gesture) {
          const pts = this.gesture; this.gesture = null; this.drawGesture();
          const kind = this.recognize(pts);
          if (kind) { let cx = 0, cy = 0; for (const p of pts) { cx += p.x; cy += p.y; } const gp = this.camera.groundPoint(cx / pts.length, cy / pts.length); if (gp) { G.say(`Gesture: ${BW.MIRACLES[kind].name}`, 'info'); BW.castMiracle(G, kind, gp.x, gp.z, 0); } }
          else G.say('Gesture not recognised. Try a circle, V, zigzag, vertical or horizontal stroke.', 'warn');
          return;
        }
        if (this.lineStart) {
          const a = this.lineStart; this.lineStart = null;
          if (this.hover) { const town = G.playerTown(); const r = BW.placeLine(G, this.mode.kind, town, a.x, a.z, this.hover.x, this.hover.z); if (r.placed) { BW.audio.play('place'); G.say(`${r.placed} ${BW.BUILDINGS[this.mode.kind].name.toLowerCase()} segments placed.`, 'info'); } if (r.err && !r.placed) G.say(r.err, 'warn'); }
          return;
        }
        if (this.touch) {
          const t = this.touch; this.touch = null;
          const c = G.ents.get(t.id);
          if (c && !t.stroked && t.moved < 12 && performance.now() - t.t0 < 350) BW.creatureFeedback(G, c, -1);
        }
        if (this.held) this.release();
      } else if (e.button === 2 || e.button === 1) {
        this.camera.rotating = false;
        const rd = this.rightDown; this.rightDown = null;
        if (rd && Math.hypot(input.mx - rd.x, input.my - rd.y) < 6 && performance.now() - rd.t < 400) {
          if (this.mode) this.setMode(null);
          else if (this.held) this.release();
          else if (G.selectedBuilding) { G.selectedBuilding = 0; if (G.ui) G.ui.hideBuilding(); }
        }
      }
    }

    pickUp(ent) {
      const G = this.G;
      if (ent.type === 'tree') { const it = G.addItem('wood', ent.wood, ent.x, ent.z); G.remove(ent); ent = it; }
      else if (ent.type === 'rock') { const it = G.addItem('ore', ent.ore, ent.x, ent.z); G.remove(ent); ent = it; }
      ent.held = true; ent.thrown = null;
      if (ent.type === 'person') { ent.state = 'idle'; ent.fear = 0; if (ent.inside) { const h = G.ents.get(ent.workId); if (h) h.garrison = Math.max(0, h.garrison - 1); ent.inside = false; } }
      this.held = ent;
      this.hist.length = 0;
      BW.audio.play('pick');
    }

    release() {
      const G = this.G, e = this.held; this.held = null;
      if (!e || e.dead) return;
      e.held = false;
      const v = this.velocity();
      const speed = Math.hypot(v.x, v.z);
      const h = this.hover;
      if (speed > 9) {
        const s = Math.min(speed, 45);
        e.thrown = { vx: v.x / speed * s * 0.75, vy: 5 + s * 0.18, vz: v.z / speed * s * 0.75, by: 0 };
        if (e.type === 'person') { e.state = 'idle'; if (e.owner === 0) BW.shiftAlignment(G, -0.012); else BW.shiftAlignment(G, -0.004); G.god.stats.thrown++; BW.advise(G, 'throw'); BW.creatureObserve(G, 'throw', e.x, e.z); }
        BW.audio.play('throw');
        return;
      }
      if (!h) return;
      const target = this.hoverEnt;
      const town = G.playerTown();
      // Feed the creature
      if (target && target.type === 'creature' && target.owner === 0) { if (BW.feedCreature(G, target, e)) { BW.creatureObserve(G, 'feed', e.x, e.z); return; } }
      if (e.type === 'item') {
        const b = G.buildingAt(h.x, h.z, 2);
        if (b && b.kind === 'center') {
          const t = G.ents.get(b.town);
          if (t) { G.deposit(t, e.kind, e.amount); G.remove(e); BW.audio.play('drop'); BW.creatureObserve(G, e.kind === 'wood' ? 'wood' : 'food', b.x, b.z); if (t.owner !== 0) { t.loyalty -= 4; BW.shiftAlignment(G, 0.01); G.say(`A gift for ${t.name}. They are impressed.`, 'good'); } return; }
        }
        e.y = G.groundY(e.x, e.z); if (G.terrain.heightAt(e.x, e.z) < 0.5) { G.remove(e); return; }
        BW.audio.play('drop'); return;
      }
      if (e.type === 'person') {
        e.y = G.groundY(e.x, e.z);
        if (G.terrain.heightAt(e.x, e.z) < 0.5) { BW.die(G, e, 'drowned'); BW.shiftAlignment(G, -0.02); return; }
        const b = G.buildingAt(h.x, h.z, 2.5);
        let pt = G.ents.get(e.town);
        // Moving your own villagers between your towns.
        if (e.owner === 0 && b && b.owner === 0 && b.town !== e.town) { const nt = G.ents.get(b.town); if (nt) { BW.migrate(G, e, nt); pt = nt; G.say(`${e.name} moves to ${nt.name}.`, 'info'); } }
        // Sacrifice: Alt-drop on your own altar.
        if (e.owner === 0 && b && b.kind === 'altar' && b.owner === 0 && b.built && (input.keys.AltLeft || input.keys.AltRight)) { BW.sacrifice(G, e, b); return; }
        // Kidnapped enemy villagers dropped at your temple convert.
        if (e.owner !== 0 && b && b.kind === 'center' && b.owner === 0 && town) { const from = BW.migrate(G, e, town); if (from) from.loyalty -= 1; G.say('The villager joins your town.', 'good'); BW.shiftAlignment(G, -0.005); BW.audio.play('drop'); return; }
        if (e.owner === 0 && pt) {
          if (b && b.town === e.town) {
            if (!b.built) { e.job = 'builder'; e.workId = b.id; }
            else if (b.kind === 'field') { e.job = 'farmer'; e.workId = b.id; }
            else if (b.kind === 'house') { e.job = 'breeder'; e.workId = b.id; }
            else if (b.kind === 'altar') { e.job = 'worshipper'; e.workId = b.id; }
            else if (b.kind === 'armory') { this.recruit(e, b); }
            else if (b.kind === 'center') { if (e.carry) { G.deposit(pt, e.carry.kind, e.carry.amount); e.carry = null; } e.job = 'idle'; e.workId = 0; }
            if (e.platoon && e.job !== 'soldier') { const pl = G.ents.get(e.platoon); if (pl) { const i = pl.members.indexOf(e.id); if (i >= 0) pl.members.splice(i, 1); if (!pl.members.length) G.remove(pl); } e.platoon = 0; e.maxHealth = 30; }
            G.say(`Villager is now a ${BW.JOB_NAMES[e.job]}.`, 'info');
          } else {
            const tr = G.nearest(G.trees, h.x, h.z, 3.5, (t) => !t.burnt && t.wood > 0);
            const rk = G.nearest(G.rocks, h.x, h.z, 3.5);
            if (tr) { e.job = 'forester'; e.workId = tr.id; G.say('Villager is now a Forester.', 'info'); }
            else if (rk) { e.job = 'miner'; e.workId = rk.id; G.say('Villager is now a Miner.', 'info'); }
          }
          e.state = 'idle';
        }
        BW.audio.play('drop');
      }
    }

    recruit(p, armory) {
      const G = this.G; const town = G.ents.get(p.town);
      let pl = G.platoons.find((q) => q.owner === 0 && q.members.length < 12 && dist(q.x, q.z, armory.x, armory.z) < 20);
      if (!pl) { if (town.ore < 30) { G.say('A new platoon costs 30 ore.', 'warn'); return; } town.ore -= 30; pl = G.addPlatoon(town, [p]); pl.tx = armory.x + 7; pl.tz = armory.z + 2; pl.mode = 'move'; G.say(`${pl.name} formed.`, 'good'); }
      else { p.job = 'soldier'; p.platoon = pl.id; p.maxHealth = 60; p.health = 60; pl.members.push(p.id); }
    }

    tryBuild() {
      const G = this.G, h = this.hover, kind = this.mode.kind;
      const town = G.playerTown(); if (!town) return;
      const err = BW.footprintOk(G, kind, h.x, h.z, town);
      if (err) { G.say(err, 'warn'); return; }
      const def = BW.BUILDINGS[kind];
      if (!G.canAfford(town, def.cost)) { G.say('Not enough resources: ' + Object.entries(def.cost).map(([k, v]) => `${v} ${k}`).join(', '), 'warn'); return; }
      G.pay(town, def.cost);
      const placed = BW.placeBuilding(G, kind, town, h.x, h.z, this.ghostRot);
      if (kind === 'center') placed.newTown = true;
      BW.audio.play('place');
      G.say(`${def.name} site placed. Builders will get to work (drop villagers on it to speed up).`, 'info');
      if (!input.keys.ShiftLeft) this.setMode(null);
    }
  }

  // The evil economy: a life for prayer power. Terrifies the neighbours.
  BW.sacrifice = function (G, p, altar) {
    G.particles.burst(altar.x, altar.y + 2, altar.z, 60, 5, 1.5, 0xff3322, 2.5, 1, 4);
    BW.die(G, p, 'sacrificed');
    G.god.prayer = Math.min(G.god.maxPrayer, G.god.prayer + 90);
    BW.shiftAlignment(G, -0.05);
    BW.frighten(G, altar.x, altar.z, 12);
    BW.scare(G, altar.x, altar.z, 18, 3);
    G.say('A villager was sacrificed. +90 prayer. The land shudders.', 'bad');
    BW.audio.play('growl');
  };

  BW.Hand = Hand;
})(window.BW);
