// ---------------------------------------------------------------------------
// ui.js — HUD, tabs (build / miracles / creature / army / tribute / menu),
// tooltips, messages and full-screen overlays (menu, land intro, win/lose).
// ---------------------------------------------------------------------------
(function (BW) {
  'use strict';
  const { clamp, fmt } = BW;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  class UI {
    constructor(game) {
      this.game = game;
      this.tab = null;
      this.t = 0;
      this.msgTimers = [];
      $('tabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => this.toggleTab(b.dataset.tab)));
      $('helpbtn').addEventListener('click', () => this.toggleHelp());
      $('autojobs').addEventListener('change', (e) => { const t = this.G && this.G.playerTown(); if (t) t.autoJobs = e.target.checked; });
      this.subpanel = $('subpanel');
      this.tooltip = $('tooltip');
      this.minimap = $('minimap');
      this.minimap.addEventListener('click', (e) => { const G = this.G; if (!G) return; const r = this.minimap.getBoundingClientRect(); const fx = (e.clientX - r.left) / r.width, fz = (e.clientY - r.top) / r.height; this.game.camera.lookAt(fx * G.terrain.size - G.terrain.half, fz * G.terrain.size - G.terrain.half); });
      this.adviceT = 0;
    }

    // ------------------------------------------------------------ minimap
    initMinimap() {
      const G = this.G, T = G.terrain, c = this.minimap, ctx = c.getContext('2d', { willReadFrequently: true });
      const n = c.width; const img = ctx.createImageData(n, n);
      const col = new THREE.Color();
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = i / n * T.size - T.half, z = j / n * T.size - T.half;
        const h = T.heightAt(x, z);
        if (h <= 0.3) col.set(0x2a6fa8); else T._vertexColor(x, z, h, col);
        const k = (j * n + i) * 4; img.data[k] = col.r * 255; img.data[k + 1] = col.g * 255; img.data[k + 2] = col.b * 255; img.data[k + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      this.minimapBase = ctx.getImageData(0, 0, n, n);
      this.minimapVersion = T.colorVersion;
    }
    drawMinimap() {
      const G = this.G, T = G.terrain, c = this.minimap, ctx = c.getContext('2d', { willReadFrequently: true }), n = c.width;
      if (!this.minimapBase || this.minimapVersion !== T.colorVersion) this.initMinimap();
      ctx.putImageData(this.minimapBase, 0, 0);
      const px = (x) => (x + T.half) / T.size * n, pz = (z) => (z + T.half) / T.size * n;
      for (const b of G.buildings) { ctx.fillStyle = '#' + BW.TEAM_COLORS[(G.ents.get(b.town) || {}).color || 0].toString(16).padStart(6, '0'); ctx.fillRect(px(b.x) - 1.5, pz(b.z) - 1.5, 3, 3); }
      for (const p of G.people) { if (p.inside) continue; ctx.fillStyle = p.job === 'soldier' ? '#fff' : '#' + BW.TEAM_COLORS[(G.ents.get(p.town) || {}).color || 0].toString(16).padStart(6, '0'); ctx.fillRect(px(p.x), pz(p.z), 1, 1); }
      for (const cr of G.creatures) { ctx.fillStyle = cr.owner === 0 ? '#7fd4ff' : '#ff5a3c'; ctx.beginPath(); ctx.arc(px(cr.x), pz(cr.z), 3, 0, 6.28); ctx.fill(); }
      // Influence ring and camera target
      ctx.strokeStyle = 'rgba(255,233,160,0.8)'; ctx.lineWidth = 1;
      for (const ce of G.influenceCenters()) { ctx.beginPath(); ctx.arc(px(ce.x), pz(ce.z), G.god.influence / T.size * n, 0, 6.28); ctx.stroke(); }
      const cam = this.game.camera; ctx.strokeStyle = '#fff'; ctx.strokeRect(px(cam.tx) - 5, pz(cam.tz) - 5, 10, 10);
    }
    advice(good, evil) {
      const g = $('adv-good'), e = $('adv-evil');
      g.textContent = good; e.textContent = evil; g.classList.add('show'); e.classList.add('show');
      this.adviceT = 16;
      BW.audio.play('ui');
    }
    // Health bars over creatures that are hurt or fighting.
    drawBars() {
      const G = this.G, box = $('bars'); const cam = this.game.gfx.camera; const v = new THREE.Vector3();
      const want = G.creatures.filter((c) => c.health < c.maxHealth - 1 || c.state === 'fight' || c.state === 'rampage');
      while (box.children.length > want.length) box.removeChild(box.lastChild);
      while (box.children.length < want.length) { const d = document.createElement('div'); d.className = 'hb'; d.innerHTML = '<i></i><span></span>'; box.appendChild(d); }
      want.forEach((c, i) => {
        const el = box.children[i]; v.set(c.x, c.y + c.size * 4.2, c.z).project(cam);
        if (v.z > 1) { el.style.display = 'none'; return; }
        el.style.display = 'block'; el.style.left = ((v.x + 1) / 2 * innerWidth) + 'px'; el.style.top = ((1 - v.y) / 2 * innerHeight) + 'px';
        el.className = 'hb' + (c.owner === 0 ? ' mine' : ''); el.firstElementChild.style.width = clamp(c.health / c.maxHealth * 100, 0, 100) + '%';
        el.lastElementChild.textContent = (c.owner === 0 ? 'Your ' : 'Enemy ') + c.name;
      });
    }
    get G() { return this.game.G; }
    get hand() { return this.game.hand; }

    toggleHelp() { $('help').classList.toggle('hidden'); }
    onModeChanged(m) {
      const canvas = $('game'); canvas.classList.toggle('mode', !!m);
      if (this.tab) this.refreshTab();
    }
    toggleTab(name) {
      if (this.tab === name) { this.closeTab(); return; }
      this.tab = name;
      $('tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
      this.subpanel.classList.add('open');
      this.renderTab();
      BW.audio.play('ui');
    }
    closeTab() { this.tab = null; this.subpanel.classList.remove('open'); $('tabs').querySelectorAll('button').forEach((b) => b.classList.remove('active')); }

    renderTab() {
      const G = this.G; if (!G) return;
      const p = this.subpanel;
      const mode = this.hand.mode;
      if (this.tab === 'build') {
        const town = G.playerTown();
        p.innerHTML = `<h3>Build <small>— click an item, then click the ground. R rotates, Shift keeps placing.</small></h3><div class="items">` + BW.BUILD_ORDER.map((k) => {
          const d = BW.BUILDINGS[k]; const locked = !G.hasUnlock(d.unlock); const can = town && G.canAfford(town, d.cost);
          return `<div class="item ${locked ? 'locked' : ''} ${mode && mode.type === 'build' && mode.kind === k ? 'active' : ''}" data-kind="${k}" title="${esc(d.desc)}"><b>${d.name}</b><span class="cost" style="${can ? '' : 'color:#ff8a70'}">${Object.entries(d.cost).map(([r, v]) => `${v} ${r}`).join(', ') || 'free'}</span>${locked ? '<br><small>Needs Tribute unlock</small>' : ''}</div>`;
        }).join('') + `</div><div class="desc" id="tabdesc">Hover an item for details.</div>`;
        p.querySelectorAll('.item').forEach((el) => {
          el.addEventListener('mouseenter', () => { $('tabdesc').textContent = BW.BUILDINGS[el.dataset.kind].desc; });
          el.addEventListener('click', () => { const k = el.dataset.kind; if (!G.hasUnlock(BW.BUILDINGS[k].unlock)) { G.say('Unlock this in the Tribute tab first.', 'warn'); return; } this.hand.setMode(mode && mode.type === 'build' && mode.kind === k ? null : { type: 'build', kind: k }); });
        });
      } else if (this.tab === 'miracles') {
        p.innerHTML = `<h3>Miracles <small>— pick one, then click inside your influence. Shift keeps casting.</small></h3><div class="items">` + BW.MIRACLE_ORDER.map((k) => {
          const d = BW.MIRACLES[k]; const locked = !G.hasUnlock(d.unlock); const can = G.god.prayer >= d.cost;
          return `<div class="item ${locked ? 'locked' : ''} ${mode && mode.type === 'miracle' && mode.kind === k ? 'active' : ''}" data-kind="${k}" style="border-color:#${d.color.toString(16).padStart(6, '0')}55"><span class="key">${d.key}</span><b>${d.name}</b><span class="cost" style="${can ? '' : 'color:#ff8a70'}">${d.cost} prayer · ${d.align > 0 ? 'good' : d.align < 0 ? 'evil' : 'neutral'}</span>${locked ? '<br><small>Needs Tribute unlock</small>' : ''}</div>`;
        }).join('') + `</div><div class="desc" id="tabdesc">Hover a miracle for details.</div>`;
        p.querySelectorAll('.item').forEach((el) => {
          el.addEventListener('mouseenter', () => { $('tabdesc').textContent = BW.MIRACLES[el.dataset.kind].desc; });
          el.addEventListener('click', () => this.selectMiracle(el.dataset.kind));
        });
      } else if (this.tab === 'creature') this.renderCreature();
      else if (this.tab === 'army') this.renderArmy();
      else if (this.tab === 'tribute') this.renderTribute();
      else if (this.tab === 'menu') this.renderMenu();
    }

    selectMiracle(k) {
      const G = this.G, mode = this.hand.mode;
      if (!G.hasUnlock(BW.MIRACLES[k].unlock)) { G.say('Unlock this miracle in the Tribute tab first.', 'warn'); return; }
      this.hand.setMode(mode && mode.type === 'miracle' && mode.kind === k ? null : { type: 'miracle', kind: k });
    }

    renderCreature() {
      const G = this.G, c = G.playerCreature(), p = this.subpanel;
      if (!c) { p.innerHTML = '<h3>Creature</h3><div class="desc">You have no creature.</div>'; return; }
      const sp = BW.SPECIES[c.species];
      const doing = c.downed ? 'knocked out' : (BW.CREATURE_ACTION_NAMES[c.state] || c.state);
      const bar = (v, id = '') => `<div class="bar" ${id ? 'id="' + id + '"' : ''}><i style="width:${clamp(v * 100, 0, 100)}%"></i></div>`;
      const learned = Object.keys(c.learned).filter((k) => !k.startsWith('cast') || G.hasUnlock('c_miracles'));
      p.innerHTML = `<div id="creaturepanel"><h3>${sp.name} <small id="cr-doing">— size ${c.size.toFixed(1)} · ${c.alignment > 0.3 ? 'good' : c.alignment < -0.3 ? 'evil' : 'neutral'} · currently ${esc(doing)}</small></h3>
        <div class="stats">
          <span>Health</span>${bar(c.health / c.maxHealth, 'cr-b-health')}
          <span>Hunger</span>${bar(c.hunger / 100, 'cr-b-hunger')}
          <span>Energy</span>${bar(c.energy / 100, 'cr-b-energy')}
          <span>Alignment</span><div class="bar" style="background:linear-gradient(90deg,#ff5a3c,#333 50%,#7fd4ff)"><i id="cr-b-align" style="left:${(c.alignment + 1) / 2 * 100}%;width:4px;background:#fff"></i></div>
        </div>
        <div class="speak" id="cr-speak">${c.speak ? '“' + esc(c.speak) + '”' : (c.lastAction ? 'Last did: ' + esc(BW.CREATURE_ACTION_NAMES[c.lastAction.kind] || c.lastAction.kind) : '')}</div>
        <div class="actions">
          <button id="cr-reward" title="Reinforce the last thing it did">👍 Reward</button>
          <button id="cr-punish" title="Discourage the last thing it did">👎 Punish</button>
          <button id="cr-follow" class="${c.leash === 'follow' ? 'active' : ''}">Follow hand</button>
          <button id="cr-free" class="${c.leash === 'free' ? 'active' : ''}">Roam free</button>
          <button id="cr-stay" class="${c.leash === 'stay' ? 'active' : ''}">Stay</button>
          <button id="cr-send" class="${this.hand.mode && this.hand.mode.type === 'send' ? 'active' : ''}">Send to…</button>
          <button id="cr-find">Find (F)</button>
        </div>
        <div class="learned">${learned.map((k) => `<div title="${esc(BW.CREATURE_ACTION_NAMES[k] || k)}"><span>${esc(BW.CREATURE_ACTION_NAMES[k] || k)}</span>${bar(c.learned[k], 'cr-l-' + k)}</div>`).join('')}</div>
        <div class="desc">Stroke it (hold and move the hand over it) to reward, tap it to punish. Reward what you want more of. It learns miracles by watching you cast them nearby once you unlock Creature miracles.</div></div>`;
      $('cr-reward').onclick = () => BW.creatureFeedback(G, c, +1);
      $('cr-punish').onclick = () => BW.creatureFeedback(G, c, -1);
      $('cr-follow').onclick = () => { c.leash = 'follow'; c.sendGoal = null; this.renderTab(); };
      $('cr-free').onclick = () => { c.leash = 'free'; this.renderTab(); };
      $('cr-stay').onclick = () => { c.leash = 'stay'; c.sendGoal = null; c.state = 'idle'; this.renderTab(); };
      $('cr-send').onclick = () => this.hand.setMode(this.hand.mode && this.hand.mode.type === 'send' ? null : { type: 'send' });
      $('cr-find').onclick = () => this.game.camera.lookAt(c.x, c.z);
    }

    // In-place refresh of the open tab: never rebuilds DOM the user may be clicking.
    refreshTab() {
      const G = this.G, p = this.subpanel, mode = this.hand.mode;
      if (this.tab === 'build') {
        const town = G.playerTown();
        p.querySelectorAll('.item').forEach((el) => { const d = BW.BUILDINGS[el.dataset.kind]; const can = town && G.canAfford(town, d.cost); el.querySelector('.cost').style.color = can ? '' : '#ff8a70'; el.classList.toggle('active', !!(mode && mode.type === 'build' && mode.kind === el.dataset.kind)); });
      } else if (this.tab === 'miracles') {
        p.querySelectorAll('.item').forEach((el) => { const d = BW.MIRACLES[el.dataset.kind]; el.querySelector('.cost').style.color = G.god.prayer >= d.cost ? '' : '#ff8a70'; el.classList.toggle('active', !!(mode && mode.type === 'miracle' && mode.kind === el.dataset.kind)); });
      } else if (this.tab === 'creature') {
        const c = G.playerCreature(); if (!c || !$('cr-doing')) return;
        const w = (id, v) => { const el = $(id); if (el) el.querySelector('i').style.width = clamp(v * 100, 0, 100) + '%'; };
        w('cr-b-health', c.health / c.maxHealth); w('cr-b-hunger', c.hunger / 100); w('cr-b-energy', c.energy / 100);
        $('cr-b-align').style.left = ((c.alignment + 1) / 2 * 100) + '%';
        const doing = c.downed ? 'knocked out' : (BW.CREATURE_ACTION_NAMES[c.state] || c.state);
        $('cr-doing').textContent = `— size ${c.size.toFixed(1)} · ${c.alignment > 0.3 ? 'good' : c.alignment < -0.3 ? 'evil' : 'neutral'} · currently ${doing}`;
        $('cr-speak').textContent = c.speak ? '“' + c.speak + '”' : (c.lastAction ? 'Last did: ' + (BW.CREATURE_ACTION_NAMES[c.lastAction.kind] || c.lastAction.kind) : '');
        for (const k in c.learned) w('cr-l-' + k, c.learned[k]);
        ['follow', 'free', 'stay'].forEach((l) => { const b = $('cr-' + l); if (b) b.classList.toggle('active', c.leash === l); });
        const sb = $('cr-send'); if (sb) sb.classList.toggle('active', !!(mode && mode.type === 'send'));
      } else if (this.tab === 'army') {
        const sig = G.platoons.filter((q) => q.owner === 0).map((q) => q.id + ':' + q.members.length + ':' + q.mode).join('|') + '#' + G.selectedPlatoon + (mode && mode.type === 'army' ? 'a' : '');
        if (sig !== this.armySig) { this.armySig = sig; this.renderArmy(); }
      }
    }

    renderArmy() {
      const G = this.G, p = this.subpanel, town = G.playerTown();
      const pls = G.platoons.filter((q) => q.owner === 0);
      this.armySig = pls.map((q) => q.id + ':' + q.members.length + ':' + q.mode).join('|') + '#' + G.selectedPlatoon + (this.hand.mode && this.hand.mode.type === 'army' ? 'a' : '');
      p.innerHTML = `<h3>Army <small>— ${pls.length} platoon${pls.length === 1 ? '' : 's'}</small></h3>
        <div>${pls.map((pl) => `<div class="platoon"><b>${esc(pl.name)}</b> <span class="muted">${pl.members.length} soldiers · ${pl.mode}</span>
          <button data-sel="${pl.id}" class="${G.selectedPlatoon === pl.id && this.hand.mode && this.hand.mode.type === 'army' ? 'active' : ''}">Select &amp; order</button>
          <button data-find="${pl.id}">Find</button><button data-dis="${pl.id}" class="danger">Disband</button></div>`).join('') || '<div class="muted">No platoons. Build an Armoury, then train one, or drop villagers on the Armoury.</div>'}</div>
        <div class="actions" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${BW.UNIT_ORDER.map((k) => { const un = BW.UNITS[k]; const locked = !G.hasUnlock(un.unlock); return `<button data-train="${k}" ${locked ? 'disabled' : ''} title="${esc(un.desc)}">Train ${un.name} (${un.count} villagers, ${Object.entries(un.cost).map(([r, v]) => v + ' ' + r).join(', ')})${locked ? ' · locked' : ''}</button>`; }).join('')}</div>
        <div class="desc">Select a platoon, then click the ground to move it or click an enemy building, soldier or creature to attack. Soldiers automatically fight anything hostile nearby.</div>`;
      p.querySelectorAll('[data-train]').forEach((b) => b.onclick = () => { if (town) { BW.trainPlatoon(G, town, b.dataset.train); this.renderTab(); } });
      p.querySelectorAll('[data-sel]').forEach((b) => b.onclick = () => { G.selectedPlatoon = +b.dataset.sel; this.hand.setMode({ type: 'army' }); });
      p.querySelectorAll('[data-find]').forEach((b) => b.onclick = () => { const pl = G.ents.get(+b.dataset.find); if (pl) this.game.camera.lookAt(pl.x, pl.z); });
      p.querySelectorAll('[data-dis]').forEach((b) => b.onclick = () => { const pl = G.ents.get(+b.dataset.dis); if (pl) BW.disbandPlatoon(G, pl); this.renderTab(); });
    }

    renderTribute() {
      const G = this.G, p = this.subpanel;
      const cats = {};
      for (const [k, u] of Object.entries(BW.UNLOCKS)) (cats[u.cat] = cats[u.cat] || []).push([k, u]);
      p.innerHTML = `<h3>Tribute <small>— you have <b style="color:#fff">${G.god.tribute}</b>. Earn it by growing, converting towns and building wonders.</small></h3>` +
        Object.entries(cats).map(([cat, list]) => `<div style="margin-top:6px"><small>${cat}</small><div class="items">` + list.map(([k, u]) => {
          const have = !!G.god.unlocks[k];
          return `<div class="item ${have ? 'active' : G.god.tribute < u.cost ? 'locked' : ''}" data-unlock="${k}" title="${esc(u.desc)}"><b>${u.name}</b><span class="cost">${have ? 'Unlocked' : u.cost + ' tribute'}</span></div>`;
        }).join('') + '</div></div>').join('') + `<div class="desc" id="tabdesc">Hover an item for details.</div>`;
      p.querySelectorAll('[data-unlock]').forEach((el) => {
        el.addEventListener('mouseenter', () => { $('tabdesc').textContent = BW.UNLOCKS[el.dataset.unlock].desc; });
        el.onclick = () => {
          const k = el.dataset.unlock, u = BW.UNLOCKS[k];
          if (G.god.unlocks[k]) return;
          if (G.god.tribute < u.cost) { G.say('Not enough Tribute.', 'warn'); return; }
          G.god.tribute -= u.cost; G.god.unlocks[k] = true; G.say(`Unlocked: ${u.name}`, 'good'); BW.audio.play('chime'); this.renderTab();
        };
      });
    }

    renderMenu() {
      const p = this.subpanel, g = this.game;
      p.innerHTML = `<h3>Menu</h3><div class="actions" style="display:flex;gap:6px;flex-wrap:wrap">
        <button id="m-save">Save (F5)</button><button id="m-load" ${g.hasSave() ? '' : 'disabled'}>Load (F9)</button>
        <button id="m-pause">${g.paused ? 'Resume' : 'Pause'} (P)</button>
        <button id="m-speed">Speed: ${g.speed}x</button>
        <button id="m-shadows">Shadows: ${g.shadows ? 'on' : 'off'}</button>
        <button id="m-mute">Sound: ${BW.audio.muted ? 'off' : 'on'}</button>
        <button id="m-help">Controls</button>
        <button id="m-restart" class="danger">Restart land</button>
        <button id="m-main" class="danger">Main menu</button></div>
        <div class="desc">Progress is saved in your browser (localStorage).</div>`;
      $('m-save').onclick = () => g.save();
      $('m-load').onclick = () => g.load();
      $('m-pause').onclick = () => { g.togglePause(); this.renderTab(); };
      $('m-speed').onclick = () => { g.speed = g.speed === 1 ? 2 : g.speed === 2 ? 3 : 1; this.renderTab(); };
      $('m-shadows').onclick = () => { g.shadows = !g.shadows; g.gfx.setShadows(g.shadows); this.renderTab(); };
      $('m-mute').onclick = () => { BW.audio.init(); BW.audio.setMuted(!BW.audio.muted); this.renderTab(); };
      $('m-help').onclick = () => this.toggleHelp();
      $('m-restart').onclick = () => { if (confirm('Restart this land?')) g.startLand(g.profile.landIndex); };
      $('m-main').onclick = () => { if (confirm('Return to the main menu? Unsaved progress is lost.')) g.showMainMenu(); };
    }

    showBuilding(b) {
      const G = this.G, el = $('buildinginfo'); const d = BW.BUILDINGS[b.kind]; const town = G.ents.get(b.town);
      const workers = G.people.filter((p) => p.workId === b.id && !p.inside).length;
      el.classList.add('open');
      el.innerHTML = `<h3>${d.name} <small>— ${town ? esc(town.name) : ''}</small></h3>
        <div>HP ${Math.ceil(b.hp)} / ${b.maxHp}${b.fire > 0 ? ' · <span style="color:#ff8a70">ON FIRE</span>' : ''}</div>
        ${b.built ? '' : `<div>Construction ${Math.round(b.progress * 100)}% · ${workers} builders</div>`}
        ${b.kind === 'field' ? `<div>Crop ${Math.round(b.crop * 100)}% · ${workers} farmers${b.rain > 0 ? ' · watered' : ''}</div>` : ''}
        ${b.kind === 'house' ? `<div>${b.garrison} sleeping inside</div>` : ''}
        ${b.kind === 'altar' ? `<div>${workers} worshippers</div>` : ''}
        <div class="muted" style="margin-top:4px">${esc(d.desc)}</div>
        ${b.owner === 0 && b.kind !== 'center' ? '<button id="bi-demolish" class="danger" style="margin-top:6px">Demolish</button>' : ''}
        ${b.owner === 0 && b.kind === 'armory' && b.built ? '<button id="bi-train" style="margin-top:6px">Train swordsmen</button>' : ''}
        ${b.owner === 0 && b.kind === 'altar' && b.built ? '<button id="bi-sac" class="danger" style="margin-top:6px" title="Sacrifice a worshipper for 90 prayer. Evil.">Sacrifice a worshipper</button>' : ''}`;
      const dem = $('bi-demolish'); if (dem) dem.onclick = () => { const t = G.ents.get(b.town); if (t) { for (const k in d.cost) t[k] += Math.floor(d.cost[k] * 0.5); } BW.destroyBuilding(G, b, 0); this.hideBuilding(); };
      const tr = $('bi-train'); if (tr) tr.onclick = () => { BW.trainPlatoon(G, town); };
      const sac = $('bi-sac'); if (sac) sac.onclick = () => { const w = G.nearest(G.people, b.x, b.z, 8, (p) => p.town === b.town && p.job === 'worshipper'); if (w) BW.sacrifice(G, w, b); else G.say('No worshipper at the altar to sacrifice.', 'warn'); };
    }
    hideBuilding() { $('buildinginfo').classList.remove('open'); }

    message(text, kind) {
      const box = $('messages');
      const el = document.createElement('div'); el.className = 'msg ' + kind; el.textContent = text; box.appendChild(el);
      while (box.children.length > 4) box.removeChild(box.firstChild);
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, kind === 'bad' || kind === 'tribute' ? 9000 : 6500);
    }

    tooltipFor(e) {
      const G = this.G;
      if (!e) return '';
      if (e.type === 'person') { const t = G.ents.get(e.town); const yrs = Math.floor(e.age / 300); return `${e.name || 'Villager'} · ${e.age < 300 ? 'child' : yrs >= 5 ? 'elder' : 'adult'}, ${yrs} yrs · ${e.job === 'soldier' ? (BW.UNITS[e.unit] || BW.UNITS.melee).name : BW.JOB_NAMES[e.job]}${t ? ' · ' + t.name : ' · wild'}\nHealth ${Math.ceil(e.health)}/${e.maxHealth} · Hunger ${Math.round(e.hunger)}% · Happy ${Math.round((e.happy || 0) * 100)}%${e.trait ? '\n' + BW.TRAITS[e.trait] : ''}${e.desire ? '\n' + BW.NEED_NAMES[e.desire] : ''}${e.carry ? `\nCarrying ${e.carry.amount} ${e.carry.kind}` : ''}${e.state === 'sleep' ? '\nSleeping' : ''}`; }
      if (e.type === 'tree') return `Tree · ${e.wood} wood${e.fire > 0 ? ' · burning!' : ''}`;
      if (e.type === 'rock') return `Rock · ${e.ore} ore`;
      if (e.type === 'item') return `Heap of ${Math.round(e.amount)} ${e.kind}\nDrop it on a temple to store it`;
      if (e.type === 'creature') return `${e.owner === 0 ? 'Your' : 'Enemy'} ${e.name} · size ${e.size.toFixed(1)}\nHealth ${Math.ceil(e.health)}/${Math.ceil(e.maxHealth)}${e.owner === 0 ? ` · Hunger ${Math.round(e.hunger)}%\n${BW.CREATURE_ACTION_NAMES[e.state] || e.state}` : ''}`;
      if (e.type === 'building') { const d = BW.BUILDINGS[e.kind]; const t = G.ents.get(e.town); return `${e.owner === 0 && e.kind === 'center' ? 'Your Temple' : e.kind === 'center' ? 'Great Hall' : d.name}${t ? ' · ' + t.name : ''}\nHP ${Math.ceil(e.hp)}/${e.maxHp}${e.built ? '' : ` · building ${Math.round(e.progress * 100)}%`}${e.kind === 'field' ? ` · crop ${Math.round(e.crop * 100)}%` : ''}${e.fire > 0 ? '\nON FIRE' : ''}`; }
      return '';
    }

    update(dt) {
      const G = this.G; if (!G) return;
      const nowMs = performance.now(); this.t = nowMs - (this.lastRefresh || 0);
      // Tooltip every frame (cheap)
      const hand = this.hand;
      let tip = '';
      if (hand.mode && hand.mode.type === 'build' && hand.ghostErr) tip = hand.ghostErr;
      else if (hand.hoverEnt && !hand.held) tip = this.tooltipFor(hand.hoverEnt);
      else if (hand.held) tip = 'Holding: ' + this.tooltipFor(hand.held).split('\n')[0] + (hand.hoverEnt ? '\nDrop on: ' + this.tooltipFor(hand.hoverEnt).split('\n')[0] : '');
      if (tip) { this.tooltip.style.display = 'block'; this.tooltip.textContent = tip; this.tooltip.style.left = (BW.input.mx + 18) + 'px'; this.tooltip.style.top = (BW.input.my + 18) + 'px'; }
      else this.tooltip.style.display = 'none';
      this.drawBars();
      if (this.adviceT > 0) { this.adviceT -= dt; if (this.adviceT <= 0) { $('adv-good').classList.remove('show'); $('adv-evil').classList.remove('show'); } }
      if (this.t < 250) return;
      this.lastRefresh = nowMs;
      this.drawMinimap();
      const god = G.god;
      $('prayer').textContent = `${Math.floor(god.prayer)} / ${Math.floor(god.maxPrayer)}`;
      $('prayerbar').firstElementChild.style.width = (god.prayer / god.maxPrayer * 100) + '%';
      $('alignbar').firstElementChild.style.left = ((god.alignment + 1) / 2 * 100) + '%';
      $('aligntext').textContent = god.alignment > 0.6 ? 'Benevolent' : god.alignment > 0.2 ? 'Good' : god.alignment < -0.6 ? 'Malevolent' : god.alignment < -0.2 ? 'Evil' : 'Neutral';
      $('tribute').textContent = god.tribute;
      $('influence').textContent = Math.round(god.influence) + ' m';
      const day = Math.floor(G.time / G.dayLength) + 1; const hour = Math.floor(G.tod * 24);
      const wk = G.weather.kind; $('clock').textContent = `Day ${day} · ${String(hour).padStart(2, '0')}:00 · ${G.season}${wk !== 'clear' ? ' · ' + wk : ''}${this.game.paused ? ' · PAUSED' : this.game.speed > 1 ? ' · ' + this.game.speed + 'x' : ''}`;
      const town = G.playerTown();
      if (town) {
        const people = G.byTown ? G.byTown.get(town.id) || [] : [];
        $('townname').textContent = town.name;
        $('pop').textContent = `${G.playerTowns().reduce((s, t) => s + (t.pop || 0), 0)} / ${G.playerTowns().reduce((s, t) => s + (t.cap || 0), 0)}`;
        const cap = town.cap_ || G.storageCap(town);
        $('food').textContent = fmt(town.food) + ' / ' + fmt(cap); $('wood').textContent = fmt(town.wood) + ' / ' + fmt(cap); $('ore').textContent = fmt(town.ore) + ' / ' + fmt(cap);
        $('impress').textContent = Math.round(god.impress);
        const hp = Math.round((town.happiness === undefined ? 0.8 : town.happiness) * 100);
        $('happy').textContent = hp + '%'; $('happy').style.color = hp < 45 ? '#ff8a70' : hp > 70 ? '#8fd48f' : '';
        const counts = BW.countJobs(G, town, people);
        $('jobs').innerHTML = BW.JOBS.map((j) => `<div class="row"><span>${BW.JOB_NAMES[j]}</span><span>${counts[j]}</span></div>`).join('');
        $('autojobs').checked = !!town.autoJobs;
      }
      // Objectives
      const land = this.game.landFor(G.landIndex);
      $('objlist').innerHTML = land.objectives.map((o) => `<li class="${this.game.objectiveDone(o) ? 'done' : ''}">${esc(o)}</li>`).join('');
      $('enemytowns').innerHTML = G.enemyTowns().map((t) => `<div class="town"><span style="color:#${BW.TEAM_COLORS[t.color].toString(16).padStart(6, '0')}">${esc(t.name)} <small>(${t.pop || 0})</small></span><span>loyalty <div class="bar"><i style="width:${clamp(t.loyalty, 0, 100)}%"></i></div></span></div>`).join('');
      if (this.tab) this.refreshTab();
      if (G.selectedBuilding) { const b = G.ents.get(G.selectedBuilding); if (b && !b.dead) this.showBuilding(b); else { G.selectedBuilding = 0; this.hideBuilding(); } }
    }

    // ------------------------------------------------------------ overlays
    overlay(html) { $('overlay').classList.remove('hidden'); $('overlaybox').innerHTML = html; }
    hideOverlay() { $('overlay').classList.add('hidden'); }
    mainMenu() {
      const g = this.game;
      const hasSave = g.hasSave();
      let species = 'ape';
      const opts = { seed: String(Math.floor(Math.random() * 90000) + 10000), size: '500', tribes: '3' };
      const render = () => {
        this.overlay(`<h1>DOMINION</h1><h2>A god game for the browser</h2>
          <p>Rule a tribe from above. Nurture or terrorise your villagers, raise a colossal creature, and win the island by awe or by war.</p>
          <div><small>Choose your creature</small><div class="species">${Object.entries(BW.SPECIES).map(([k, s]) => `<div class="item ${k === species ? 'active' : ''}" data-sp="${k}"><b>${s.name}</b><small>${esc(s.desc)}</small></div>`).join('')}</div></div>
          <div class="menu"><button id="mm-new">New campaign</button><button id="mm-continue" ${hasSave ? '' : 'disabled'}>Continue</button><button id="mm-skirmish">Skirmish</button><button id="mm-help">Controls</button></div>
          <div id="skirmish"><label>Seed <input id="sk-seed" value="${esc(opts.seed)}"></label><label>Map <select id="sk-size"><option value="300" ${opts.size === '300' ? 'selected' : ''}>Small</option><option value="500" ${opts.size === '500' ? 'selected' : ''}>Large</option><option value="800" ${opts.size === '800' ? 'selected' : ''}>Vast</option></select></label><label>Tribes <select id="sk-tribes">${[1, 2, 3, 4, 5].map((n) => `<option ${String(n) === opts.tribes ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
          <p class="muted" style="font-size:12px">Tip: this runs entirely in your browser. Saves live in localStorage.</p>`);
        $('overlaybox').querySelectorAll('[data-sp]').forEach((el) => el.onclick = () => { species = el.dataset.sp; render(); });
        $('mm-new').onclick = () => { BW.audio.init(); g.newCampaign(species, 0); };
        $('mm-skirmish').onclick = () => { BW.audio.init(); g.newCampaign(species, 0, true, { seed: parseInt($('sk-seed').value, 10) || 12345, size: parseInt($('sk-size').value, 10), tribes: parseInt($('sk-tribes').value, 10) }); };
        ['sk-seed', 'sk-size', 'sk-tribes'].forEach((id) => $(id).addEventListener('change', () => { opts.seed = $('sk-seed').value; opts.size = $('sk-size').value; opts.tribes = $('sk-tribes').value; }));
        $('mm-continue').onclick = () => { BW.audio.init(); g.load(); };
        $('mm-help').onclick = () => this.toggleHelp();
      };
      render();
    }
    landIntro(land, onBegin) {
      this.overlay(`<h1 style="font-size:30px">${esc(land.name)}</h1><h2>${land.custom ? 'Skirmish · seed ' + land.seed : 'Land ' + (this.game.profile.landIndex + 1) + ' of ' + BW.LANDS.length}</h2>
        <p>${esc(land.intro)}</p><p><b>Objectives</b><br>${land.objectives.map(esc).join('<br>')}</p>
        <div class="menu"><button id="li-begin">Begin</button></div>`);
      $('li-begin').onclick = () => { this.hideOverlay(); onBegin(); };
    }
    victory(stats, isLast, onNext) {
      this.overlay(`<h1 style="font-size:34px">${isLast ? 'THE ISLANDS ARE YOURS' : 'LAND CONQUERED'}</h1><h2>${isLast ? 'Every tribe worships you. Campaign complete.' : 'The tribes of this land now worship you.'}</h2>
        <p>Day ${stats.day} · ${stats.pop} villagers · ${stats.casts} miracles · alignment ${stats.align}<br>+10 Tribute</p>
        <div class="menu"><button id="v-next">${isLast ? 'Main menu' : 'Next land'}</button></div>`);
      $('v-next').onclick = onNext;
    }
    defeat(onRetry, onMenu) {
      this.overlay(`<h1 style="font-size:34px;color:#ff5a3c">YOUR TEMPLE HAS FALLEN</h1><h2>Without believers, a god is nothing.</h2>
        <div class="menu"><button id="d-retry">Retry this land</button><button id="d-load" ${this.game.hasSave() ? '' : 'disabled'}>Load save</button><button id="d-menu">Main menu</button></div>`);
      $('d-retry').onclick = onRetry; $('d-menu').onclick = onMenu; $('d-load').onclick = () => this.game.load();
    }
  }
  BW.UI = UI;
})(window.BW);
