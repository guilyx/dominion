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
    // Speech bubble over the player's creature when it has something to say.
    drawSpeech() {
      const G = this.G; const c = G.playerCreature(); const cam = this.game.gfx.camera;
      let el = this.speechEl; if (!el) { el = this.speechEl = document.createElement('div'); el.className = 'speech'; $('bars').parentNode.appendChild(el); }
      if (!c || !c.speak) { el.style.display = 'none'; return; }
      const v = new THREE.Vector3(c.x, c.y + c.size * 4.6, c.z).project(cam);
      if (v.z > 1) { el.style.display = 'none'; return; }
      el.style.display = 'block'; el.textContent = c.speak; el.style.left = ((v.x + 1) / 2 * innerWidth) + 'px'; el.style.top = ((1 - v.y) / 2 * innerHeight - 14) + 'px';
    }
    drawTutorial() {
      const G = this.G; const el = $('tutorial');
      const show = G.landIndex === 0 && !this.game.profile.custom && !(G.god.stats.tutorialDone);
      el.classList.toggle('hidden', !show); if (!show) return;
      const st = G.god.stats;
      const steps = [['Pick up a villager (click one)', st.picked > 0], ['Drop a villager on a field to make a farmer', st.assigned > 0], ['Cast Water on your crops (press 1, click a field)', st.casts > 0], ['Build a house (B, then click the ground)', st.placed > 0], ['Stroke your creature (hold and move over it)', st.stroked > 0], ['Open the Tribute tab (U) and unlock something', Object.keys(G.god.unlocks).length > 0]];
      const html = steps.map(([t, d]) => `<li class="${d ? 'done' : ''}">${t}</li>`).join('');
      if (html !== this.tutHtml) { this.tutHtml = html; $('tutlist').innerHTML = html; }
      if (steps.every((s) => s[1])) { st.tutorialDone = 1; BW.grantTribute(G, 1, 'First steps complete'); G.say('You know the basics. Grow, impress, conquer.', 'good'); }
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
    icon(key, build) {
      this.icons = this.icons || {};
      if (!this.icons[key]) { try { this.icons[key] = BW.renderIcon(build(), 96); } catch (e) { this.icons[key] = ''; } }
      return this.icons[key];
    }
    get hand() { return this.game.hand; }

    toggleHelp() { $('help').classList.toggle('hidden'); }
    onModeChanged(m) {
      const canvas = $('game'); canvas.classList.toggle('mode', !!m);
      const bar = $('modebar');
      if (m) {
        // Tuck the panel away so the ground is visible; remember which tab to restore.
        if (this.tab) { this.restoreTab = this.tab; this.subpanel.classList.remove('open'); }
        let text = '';
        if (m.type === 'build') { const d = BW.BUILDINGS[m.kind]; text = `<b>Placing ${d.name}</b> · ${d.line ? 'drag a line' : 'click a tile'} · R rotate · Shift keep placing · Esc / right-click cancel`; }
        else if (m.type === 'miracle') { const d = BW.MIRACLES[m.kind]; text = `<b>Casting ${d.name}</b> (${d.cost} prayer) · click inside your influence · Shift keep casting · Esc cancel`; }
        else if (m.type === 'army') text = '<b>Commanding platoon</b> · click ground to move, click an enemy to attack · Esc cancel';
        else if (m.type === 'send') text = '<b>Sending creature</b> · click where it should go · Esc cancel';
        else if (m.type === 'creatureAttack') text = '<b>Creature: attack</b> · click an enemy building, soldier or creature · Esc cancel';
        else if (m.type === 'creatureGuard') text = '<b>Creature: guard</b> · click a spot to hold · Esc cancel';
        bar.innerHTML = text; bar.classList.add('open');
      } else {
        bar.classList.remove('open');
        if (this.restoreTab && this.tab === this.restoreTab) { this.subpanel.classList.add('open'); this.renderTab(); }
        this.restoreTab = null;
      }
      if (this.tab && !m) this.refreshTab();
    }
    toggleTab(name) {
      if (this.tab === name) { this.closeTab(); return; }
      this.tab = name;
      $('tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
      this.subpanel.classList.add('open');
      this.renderTab();
      BW.audio.play('ui');
    }
    closeTab() { this.tab = null; this.restoreTab = null; this.subpanel.classList.remove('open'); $('tabs').querySelectorAll('button').forEach((b) => b.classList.remove('active')); }

    renderTab() {
      const G = this.G; if (!G) return;
      const p = this.subpanel;
      const mode = this.hand.mode;
      if (this.tab === 'build') this.renderBuild();
      else if (this.tab === 'miracles') {
        p.innerHTML = `<h3>Miracles <small>— pick one, then click inside your influence. Shift keeps casting.</small></h3><div class="items">` + BW.MIRACLE_ORDER.map((k) => {
          const d = BW.MIRACLES[k]; const locked = !G.hasUnlock(d.unlock); const can = G.god.prayer >= d.cost;
          const hex = '#' + d.color.toString(16).padStart(6, '0');
          return `<div class="item ${locked ? 'locked' : ''} ${mode && mode.type === 'miracle' && mode.kind === k ? 'active' : ''}" data-kind="${k}" style="border-color:${hex}55"><span class="key">${d.key}</span><i class="miracle-orb" style="--orb:${hex}"></i><b>${d.name}</b><span class="cost" style="${can ? '' : 'color:#ff8a70'}">${d.cost} prayer · ${d.align > 0 ? 'good' : d.align < 0 ? 'evil' : 'neutral'}</span>${locked ? '<br><small>Needs Tribute unlock</small>' : ''}</div>`;
        }).join('') + `</div><div class="desc" id="tabdesc">Hover a miracle for details.</div>`;
        p.querySelectorAll('.item').forEach((el) => {
          el.addEventListener('mouseenter', () => { $('tabdesc').textContent = BW.MIRACLES[el.dataset.kind].desc; });
          el.addEventListener('click', () => this.selectMiracle(el.dataset.kind));
        });
      } else if (this.tab === 'creature') this.renderCreature();
      else if (this.tab === 'army') this.renderArmy();
      else if (this.tab === 'tribute') this.renderTribute();
      else if (this.tab === 'menu') this.renderMenu();
      else if (this.tab === 'stats') this.renderStats();
    }

    // ------------------------------------------------------------ stats
    // Rates are averaged over the last minute of history samples (one per 5 s).
    rates() {
      const H = this.G.history; if (H.length < 2) return null;
      const last = H[H.length - 1]; let i = H.length - 1; while (i > 0 && last.t - H[i].t < 60) i--;
      const base = H[i]; const dtm = Math.max(1, (last.t - base.t)) / 60;
      const r = {}; for (const k of ['pop', 'food', 'wood', 'stone', 'iron', 'gold', 'prayer']) r[k] = (last[k] - base[k]) / dtm;
      return r;
    }
    renderStats() {
      const G = this.G, p = this.subpanel;
      const SERIES = [['food', '#c98500'], ['stone', '#9085e9'], ['wood', '#d95926'], ['gold', '#199e70'], ['iron', '#e66767']];
      p.innerHTML = `<div id="stats"><h3>Stats <small>— net per minute, with (+produced −consumed) beside each stockpile</small></h3>
        <div class="tiles" id="st-tiles"></div>
        <div class="charts">
          <div class="chart"><h4>Population, last 30 min</h4><canvas id="st-pop" width="380" height="120"></canvas></div>
          <div class="chart"><h4>Stockpiles, last 30 min</h4><canvas id="st-res" width="380" height="120"></canvas><div class="legend">${SERIES.map(([k, c]) => `<span><i style="background:${c}"></i>${BW.RES_NAMES[k]}</span>`).join('')}</div></div>
          <div class="chart"><h4>Who does what</h4><canvas id="st-jobs" width="380" height="120"></canvas></div>
          <div class="chart"><h4>What people lack (average need met)</h4><canvas id="st-needs" width="380" height="120"></canvas></div>
        </div></div>`;
      this.statsSeries = SERIES;
      this.refreshStats();
    }
    refreshStats() {
      const G = this.G; if (!$('st-tiles')) return;
      const r = this.rates() || {};
      const town = G.playerTown(); const people = town && G.byTown ? (G.byTown.get(town.id) || []) : [];
      const fmtR = (v) => v === undefined ? '' : (v >= 0 ? '+' : '') + v.toFixed(1) + '/min';
      const flow = (k) => { const f = G.flow && G.flow[k]; if (!f) return ''; const net = f.p - f.c; return `<span class="${net > 0.05 ? 'up' : net < -0.05 ? 'down' : ''}">${net >= 0 ? '+' : ''}${net.toFixed(1)}/min</span> <small>(+${f.p.toFixed(1)} −${f.c.toFixed(1)})</small>`; };
      const era = BW.ERAS[G.god.era || 0], next = BW.ERAS[(G.god.era || 0) + 1];
      const tiles = [['Population', G.god.pop || 0, fmtR(r.pop)], ['Food', Math.round(town ? town.food : 0), flow('food')], ['Wood', Math.round(town ? town.wood : 0), flow('wood')], ['Stone', Math.round(town ? town.stone : 0), flow('stone')], ['Iron', Math.round(town ? town.iron : 0), flow('iron')], ['Gold', Math.round(town ? town.gold : 0), flow('gold')], ['Prayer', Math.round(G.god.prayer), flow('prayer')], ['Insight', Math.round(G.god.insight || 0) + (next ? '/' + next.insight : ''), (G.flow && G.flow.insight ? '+' + G.flow.insight.p.toFixed(1) + '/min · ' : '') + era.name], ['Happiness', Math.round((town && town.happiness !== undefined ? town.happiness : 0.8) * 100) + '%', ''], ['Impressiveness', Math.round(G.god.impress || 0), ''], ['Renown', Math.round(G.god.renown) + '/450', '+' + G.god.renownRate.toFixed(0) + '/min'], ['Soldiers', people.filter((q) => q.job === 'soldier').length, town && town.guards >= 3 ? 'guarding' : '']];
      $('st-tiles').innerHTML = tiles.map(([n, v, rate]) => `<div class="tile"><span>${n}</span><b>${v}</b><div class="rate">${rate}</div></div>`).join('');
      const H = G.history;
      this.lineChart($('st-pop'), H, [['pop', '#3987e5']]);
      this.lineChart($('st-res'), H, this.statsSeries);
      const counts = BW.countJobs(G, town, people);
      this.barChart($('st-jobs'), BW.JOBS.map((j) => [BW.JOB_NAMES[j], counts[j]]), '#3987e5');
      const needs = { food: 0, home: 0, worship: 0, safety: 0, rest: 0 }; let n = 0;
      for (const q of people) if (q.needs) { n++; for (const k in needs) needs[k] += q.needs[k]; }
      this.barChart($('st-needs'), Object.keys(needs).map((k) => [k.charAt(0).toUpperCase() + k.slice(1), n ? Math.round(needs[k] / n * 100) : 0]), '#199e70', 100, '%');
    }
    // Thin lines, one y axis, direct end labels, recessive grid.
    lineChart(canvas, H, series) {
      const ctx = canvas.getContext('2d'); const W = canvas.width, Hh = canvas.height; ctx.clearRect(0, 0, W, Hh);
      const L = 34, R = 46, T = 8, B = 18;
      if (H.length < 2) { ctx.fillStyle = '#c3c2b7'; ctx.font = '11px Nunito, sans-serif'; ctx.fillText('Collecting data…', L, Hh / 2); return; }
      let max = 1; for (const s of H) for (const [k] of series) max = Math.max(max, s[k] || 0);
      const nice = Math.pow(10, Math.floor(Math.log10(max))); max = Math.ceil(max / nice) * nice;
      const t0 = H[0].t, t1 = H[H.length - 1].t, span = Math.max(60, t1 - t0);
      const x = (t) => L + (t - t0) / span * (W - L - R), y = (v) => T + (1 - v / max) * (Hh - T - B);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.fillStyle = '#c3c2b7'; ctx.font = '10px Nunito, sans-serif'; ctx.textAlign = 'right';
      for (let i = 0; i <= 2; i++) { const v = max * i / 2; ctx.beginPath(); ctx.moveTo(L, y(v)); ctx.lineTo(W - R, y(v)); ctx.stroke(); ctx.fillText(BW.fmt(v), L - 4, y(v) + 3); }
      ctx.textAlign = 'center'; ctx.fillText(Math.round(span / 60) + ' min ago', L + 30, Hh - 4); ctx.fillText('now', W - R, Hh - 4);
      ctx.lineWidth = 2; ctx.lineJoin = 'round';
      const last = H[H.length - 1];
      for (const [k, col] of series) {
        ctx.strokeStyle = col; ctx.beginPath();
        H.forEach((s, i) => { const px = x(s.t), py = y(s[k] || 0); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
        ctx.stroke();
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x(last.t), y(last[k] || 0), 3, 0, 6.28); ctx.fill();
      }
      // End labels, pushed apart so they never overlap.
      const labels = series.map(([k]) => ({ v: last[k] || 0, y: y(last[k] || 0) })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 11) labels[i].y = labels[i - 1].y + 11;
      ctx.fillStyle = '#f0e6d2'; ctx.textAlign = 'left';
      for (const l of labels) ctx.fillText(BW.fmt(l.v), x(last.t) + 6, l.y + 3);
    }
    barChart(canvas, rows, col, max, suffix = '') {
      const ctx = canvas.getContext('2d'); const W = canvas.width, Hh = canvas.height; ctx.clearRect(0, 0, W, Hh);
      const L = 78, R = 40; const n = rows.length; const rh = Math.min(14, (Hh - 6) / n); const gap = 3;
      const m = max || Math.max(1, ...rows.map((r) => r[1]));
      ctx.font = '10px Nunito, sans-serif';
      rows.forEach(([name, v], i) => {
        const yy = 4 + i * rh; const w = (W - L - R) * (v / m);
        ctx.fillStyle = '#c3c2b7'; ctx.textAlign = 'right'; ctx.fillText(name, L - 6, yy + rh - gap - 1);
        ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(L, yy, W - L - R, rh - gap);
        ctx.fillStyle = col; ctx.fillRect(L, yy, Math.max(w, v > 0 ? 2 : 0), rh - gap);
        ctx.fillStyle = '#f0e6d2'; ctx.textAlign = 'left'; ctx.fillText(v + suffix, L + w + 4, yy + rh - gap - 1);
      });
    }

    selectMiracle(k) {
      const G = this.G, mode = this.hand.mode;
      if (!G.hasUnlock(BW.MIRACLES[k].unlock)) { G.say('Unlock this miracle in the Tribute tab first.', 'warn'); return; }
      this.hand.setMode(mode && mode.type === 'miracle' && mode.kind === k ? null : { type: 'miracle', kind: k });
    }

    // The build menu, grouped into categories so the panel never outgrows the
    // screen. The chosen category survives re-renders; a gold dot marks a
    // category holding something this age just opened that the town lacks.
    buildCategories() {
      const cats = BW.BUILD_CATEGORIES.map((c) => ({ id: c.id, name: c.name, kinds: c.kinds.filter((k) => BW.BUILDINGS[k]) }));
      const seen = new Set(cats.flatMap((c) => c.kinds));
      const rest = BW.BUILD_ORDER.filter((k) => !seen.has(k));
      if (rest.length) cats.push({ id: 'other', name: 'Other', kinds: rest });
      return cats;
    }
    // A kind the current age opened and the player has not built yet.
    isFresh(k) {
      const G = this.G, d = BW.BUILDINGS[k];
      if ((d.era || 0) !== (G.god.era || 0) || !(d.era || 0)) return false;
      if (!G.hasUnlock(d.unlock)) return false;
      return !G.buildings.some((b) => b.owner === 0 && b.kind === k);
    }
    renderBuild() {
      const G = this.G, p = this.subpanel, mode = this.hand.mode, town = G.playerTown();
      this.buildEra = G.god.era || 0;
      const cats = this.buildCategories();
      if (!cats.some((c) => c.id === this.buildCat)) this.buildCat = cats[0].id;
      const cat = cats.find((c) => c.id === this.buildCat);
      const chips = cats.map((c) => {
        const open = c.kinds.filter((k) => { const d = BW.BUILDINGS[k]; return (d.era || 0) <= (G.god.era || 0) && G.hasUnlock(d.unlock); }).length;
        const fresh = c.kinds.some((k) => this.isFresh(k));
        return `<button class="chip ${c.id === this.buildCat ? 'active' : ''} ${open ? '' : 'locked'}" data-cat="${c.id}">${esc(c.name)}<span class="n">${open}/${c.kinds.length}</span>${fresh ? '<i class="dot"></i>' : ''}</button>`;
      }).join('');
      p.innerHTML = `<h3>Build <small>— pick a category, then an item, then click the ground. R rotates, Shift keeps placing.</small></h3>
        <div class="chips" id="buildcats">${chips}</div>
        <div class="items" id="builditems">${cat.kinds.map((k) => this.buildCard(k, town, mode)).join('')}</div>
        <div class="desc" id="tabdesc">Hover an item for details.</div>`;
      $('buildcats').querySelectorAll('[data-cat]').forEach((el) => {
        el.onclick = () => { this.buildCat = el.dataset.cat; this.renderBuild(); BW.audio.play('ui'); };
      });
      this.bindBuildItems();
    }
    buildCard(k, town, mode) {
      const G = this.G, d = BW.BUILDINGS[k];
      const eraLocked = (d.era || 0) > (G.god.era || 0);
      const locked = !G.hasUnlock(d.unlock) || eraLocked;
      const can = town && G.canAfford(town, d.cost);
      const img = this.icon('b_' + k, () => { const mm = BW.buildingMesh({ id: -1, kind: k, owner: 0 }, 0, 0); const sc = mm.getObjectByName('scaffold'); if (sc) sc.visible = false; return mm; });
      return `<div class="item ${locked ? 'locked' : ''} ${mode && mode.type === 'build' && mode.kind === k ? 'active' : ''}" data-kind="${k}" title="${esc(d.desc)}">${this.isFresh(k) ? '<i class="dot"></i>' : ''}${img ? `<img src="${img}" alt="">` : ''}<b>${d.name}</b><span class="cost" style="${can ? '' : 'color:#ff8a70'}">${Object.entries(d.cost).map(([r, v]) => `${v} ${r}`).join(', ') || 'free'}</span>${eraLocked ? `<br><small>Needs the ${BW.ERAS[d.era].name}</small>` : locked ? '<br><small>Needs Tribute unlock</small>' : ''}</div>`;
    }
    bindBuildItems() {
      const G = this.G;
      this.subpanel.querySelectorAll('.item[data-kind]').forEach((el) => {
        el.addEventListener('mouseenter', () => { const t = $('tabdesc'); if (t) t.textContent = BW.BUILDINGS[el.dataset.kind].desc; });
        el.addEventListener('click', () => {
          const k = el.dataset.kind, d = BW.BUILDINGS[k], mode = this.hand.mode;
          if ((d.era || 0) > (G.god.era || 0)) { G.say(`${d.name} needs the ${BW.ERAS[d.era].name}. Scholars at a Library bring it closer.`, 'warn'); return; }
          if (!G.hasUnlock(d.unlock)) { G.say('Unlock this in the Tribute tab first.', 'warn'); return; }
          this.hand.setMode(mode && mode.type === 'build' && mode.kind === k ? null : { type: 'build', kind: k });
        });
      });
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
          <button id="cr-attack" class="${this.hand.mode && this.hand.mode.type === 'creatureAttack' ? 'active' : ''}" title="Then click an enemy building, soldier or creature">⚔ Attack…</button>
          <button id="cr-guard" class="${this.hand.mode && this.hand.mode.type === 'creatureGuard' ? 'active' : ''}" title="Then click a spot to hold">🛡 Guard…</button>
          ${c.command ? '<button id="cr-cancel">Cancel order</button>' : ''}
          <button id="cr-find">Find (F)</button>
        </div>
        <div class="learned">${learned.map((k) => `<div title="${esc(BW.CREATURE_ACTION_NAMES[k] || k)}"><span>${esc(BW.CREATURE_ACTION_NAMES[k] || k)}</span>${bar(c.learned[k], 'cr-l-' + k)}</div>`).join('')}</div>
        <div class="desc">Stroke it (hold and move the hand over it) to reward, tap it to punish. Reward what you want more of. <b>Attack…</b> then click an enemy; <b>Guard…</b> then click a spot (it fights anything hostile that comes near). Hotkeys: K attack, G guard. It learns miracles by watching you cast them nearby once you unlock Creature miracles.</div></div>`;
      $('cr-reward').onclick = () => BW.creatureFeedback(G, c, +1);
      $('cr-punish').onclick = () => BW.creatureFeedback(G, c, -1);
      $('cr-follow').onclick = () => { c.leash = 'follow'; c.sendGoal = null; c.command = null; this.renderTab(); };
      $('cr-free').onclick = () => { c.leash = 'free'; c.command = null; this.renderTab(); };
      $('cr-stay').onclick = () => { c.leash = 'stay'; c.sendGoal = null; c.command = null; c.state = 'idle'; this.renderTab(); };
      $('cr-send').onclick = () => this.hand.setMode(this.hand.mode && this.hand.mode.type === 'send' ? null : { type: 'send' });
      $('cr-attack').onclick = () => this.hand.setMode(this.hand.mode && this.hand.mode.type === 'creatureAttack' ? null : { type: 'creatureAttack' });
      $('cr-guard').onclick = () => this.hand.setMode(this.hand.mode && this.hand.mode.type === 'creatureGuard' ? null : { type: 'creatureGuard' });
      const cc = $('cr-cancel'); if (cc) cc.onclick = () => { c.command = null; c.state = 'idle'; this.renderTab(); };
      $('cr-find').onclick = () => this.game.camera.lookAt(c.x, c.z);
    }

    // In-place refresh of the open tab: never rebuilds DOM the user may be clicking.
    refreshTab() {
      const G = this.G, p = this.subpanel, mode = this.hand.mode;
      if (this.tab === 'build') {
        const town = G.playerTown();
        if (this.buildEra !== (G.god.era || 0)) { this.renderBuild(); return; }
        p.querySelectorAll('.item[data-kind]').forEach((el) => {
          const k = el.dataset.kind, d = BW.BUILDINGS[k], can = town && G.canAfford(town, d.cost);
          el.querySelector('.cost').style.color = can ? '' : '#ff8a70';
          el.classList.toggle('active', !!(mode && mode.type === 'build' && mode.kind === k));
          const dot = el.querySelector('.dot'); if (dot && !this.isFresh(k)) dot.remove();
        });
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
      } else if (this.tab === 'stats') {
        if (!this.statsT || performance.now() - this.statsT > 1000) { this.statsT = performance.now(); this.refreshStats(); }
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
      p.innerHTML = `<h3>Tribute <small>— you have <b style="color:#fff">${G.god.tribute}</b>.</small></h3><div class="desc" style="margin:0 0 6px">Renown flows in at <b style="color:#fff">${G.god.renownRate.toFixed(0)}/min</b> from population (${Math.round((G.god.pop || 0) * 1.2)}), impressiveness (${Math.round((G.god.impress || 0) * 0.6)}) and happiness. Every 450 renown is 1 Tribute (${Math.round(G.god.renown)}/450 now). Entering a new age is worth 2. Bonus Tribute: every 15 villagers, first miracle, first steps, wonders, towns won, lands won.</div>` +
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
      const A = BW.audio;
      p.innerHTML = `<h3>Menu</h3><div class="actions" style="display:flex;gap:6px;flex-wrap:wrap">
        <button id="m-save">Quick save (F5)</button><button id="m-load" ${g.hasSave() ? '' : 'disabled'}>Quick load (F9)</button>
        <button id="m-slots-save">Save to slot…</button><button id="m-slots-load">Load from slot…</button>
        <button id="m-pause">${g.paused ? 'Resume' : 'Pause'} (P)</button>
        <button id="m-speed">Speed: ${g.speed}x</button>
        <button id="m-shadows">Shadows: ${g.shadows ? 'on' : 'off'}</button>
        <button id="m-edge">Edge scroll: ${g.camera.edgeScroll ? 'on' : 'off'}</button>
        <button id="m-mute">Sound: ${BW.audio.muted ? 'off' : 'on'}</button>
        <button id="m-help">Controls</button>
        <button id="m-restart" class="danger">Restart land</button>
        <button id="m-main" class="danger">Main menu</button></div>
        <div class="sliders">${['master', 'music', 'sfx', 'ambience'].map((k) => `<label>${k.charAt(0).toUpperCase() + k.slice(1)} <input type="range" min="0" max="100" value="${Math.round(A.vol[k] * 100)}" data-vol="${k}" id="vol-${k}"></label>`).join('')}</div>
        <div id="slotlist"></div>
        <div class="desc">Progress is saved in your browser (localStorage). Autosave writes every two minutes to its own slot.</div>`;
      p.querySelectorAll('[data-vol]').forEach((el) => el.addEventListener('input', () => { BW.audio.init(); BW.audio.setVolume(el.dataset.vol, el.value / 100); }));
      $('m-slots-save').onclick = () => this.renderSlots('save');
      $('m-slots-load').onclick = () => this.renderSlots('load');
      $('m-save').onclick = () => g.save();
      $('m-load').onclick = () => g.load('quick');
      $('m-pause').onclick = () => { g.togglePause(); this.renderTab(); };
      $('m-speed').onclick = () => { g.speed = g.speed === 1 ? 2 : g.speed === 2 ? 3 : 1; this.renderTab(); };
      $('m-shadows').onclick = () => { g.shadows = !g.shadows; g.gfx.setShadows(g.shadows); this.renderTab(); };
      $('m-edge').onclick = () => { g.camera.edgeScroll = !g.camera.edgeScroll; try { localStorage.setItem('dominion_edge', g.camera.edgeScroll ? '1' : '0'); } catch (e) { /* ignore */ } this.renderTab(); };
      $('m-mute').onclick = () => { BW.audio.init(); BW.audio.setMuted(!BW.audio.muted); this.renderTab(); };
      $('m-help').onclick = () => this.toggleHelp();
      // Browser dialogs are blocked in some embeds, so confirmation is a second click.
      const arm = (btn, label, fn) => { btn.onclick = () => { if (btn.dataset.armed) { btn.dataset.armed = ''; fn(); return; } btn.dataset.armed = '1'; const old = btn.textContent; btn.textContent = label; setTimeout(() => { if (btn.isConnected) { btn.dataset.armed = ''; btn.textContent = old; } }, 8000); }; };
      arm($('m-restart'), 'Click again to restart', () => g.startLand(g.profile.landIndex));
      arm($('m-main'), 'Click again to quit (unsaved progress is lost)', () => g.showMainMenu());
    }

    // Slot picker for saving or loading. Autosave and quick save are listed too.
    renderSlots(mode, container) {
      const g = this.game; const box = container || $('slotlist'); if (!box) return;
      const rows = g.listSaves().filter((s) => mode === 'save' ? !['quick', 'auto'].includes(s.slot) : true);
      const label = (s) => s.slot === 'quick' ? 'Quick save' : s.slot === 'auto' ? 'Autosave' : 'Slot ' + s.slot;
      const when = (m) => m && m.savedAt ? new Date(m.savedAt).toLocaleString() : '';
      box.innerHTML = `<div class="slots"><small>${mode === 'save' ? 'Save to which slot?' : 'Load which save?'}</small>` + rows.map((s) => `<button class="slot ${s.meta ? '' : 'empty'}" data-slot="${s.slot}" ${mode === 'load' && !s.meta ? 'disabled' : ''}><b>${label(s)}</b><span>${s.meta ? `${esc(s.meta.name || '')} · day ${s.meta.day || '?'} · ${s.meta.pop || 0} villagers${s.meta.species ? ' · ' + s.meta.species : ''}<br><small>${when(s.meta)}</small>` : 'Empty'}</span></button>`).join('') + '</div>';
      box.querySelectorAll('[data-slot]').forEach((b) => b.onclick = () => { if (mode === 'save') { g.save(false, b.dataset.slot); this.renderSlots('save', container); } else g.load(b.dataset.slot); });
    }

    showBuilding(b) {
      const G = this.G, el = $('buildinginfo'); const d = BW.BUILDINGS[b.kind]; const town = G.ents.get(b.town);
      const workers = G.people.filter((p) => p.workId === b.id && !p.inside).length;
      el.classList.add('open');
      el.innerHTML = `<h3>${d.name} <small>— ${town ? esc(town.name) : ''}</small></h3>
        <div>HP ${Math.ceil(b.hp)} / ${b.maxHp}${b.fire > 0 ? ' · <span style="color:#ff8a70">ON FIRE</span>' : ''}</div>
        ${b.built ? '' : `<div>Construction ${Math.round(b.progress * 100)}% · ${workers} builders</div>`}
        ${b.kind === 'field' ? `<div>Crop ${Math.round(b.crop * 100)}% · ${workers} farmers${b.rain > 0 ? ' · watered' : ''}${b.biome ? ' · ' + BW.BIOME_NAMES[b.biome] + ' soil ×' + (BW.BIOME_GROWTH[b.biome] || 1) : ''}</div>` : ''}
        ${b.kind === 'house' ? `<div>${b.garrison} sleeping inside</div>` : ''}
        ${b.kind === 'altar' ? `<div>${workers} worshippers</div>` : ''}
        ${b.kind === 'library' && b.built ? `<div>Insight ${Math.round(G.god.insight || 0)}${BW.ERAS[(G.god.era || 0) + 1] ? ' / ' + BW.ERAS[(G.god.era || 0) + 1].insight + ' for the ' + BW.ERAS[(G.god.era || 0) + 1].name : ' · final age'}</div>` : ''}
        ${b.built && town && BW.ADJACENCY[b.kind] ? (() => { const a = BW.adjacency(G, b); return `<div class="adj">${a.notes.length ? 'Adjacency +' + Math.round(a.bonus * 100) + '%: ' + esc(a.notes.join(', ')) : 'No adjacency bonus yet (' + Object.keys(BW.ADJACENCY[b.kind]).filter((k) => k !== 'cap').map((k) => k === 'water' ? 'water' : k === 'highGround' ? 'high ground' : k.endsWith('Town') ? BW.BUILDINGS[k.slice(0, -4)].name.toLowerCase() + ' in town' : (BW.BUILDINGS[k] || { name: k }).name.toLowerCase()).join(', ') + ')'}</div>`; })() : ''}
        <div class="muted" style="margin-top:4px">${esc(d.desc)}</div>
        ${b.owner === 0 && (BW.WORKER_JOB[b.kind] || !b.built || b.upgrading) ? (() => { const job = (!b.built || b.upgrading) ? 'builder' : BW.WORKER_JOB[b.kind]; const crew = G.people.filter((p) => p.town === b.town && p.job === job && (job === 'forester' ? p.baseId === b.id : p.workId === b.id)); const n = crew.length; const max = job === 'builder' ? 6 : (BW.WORKER_SLOTS[b.kind] || [3, 3, 3])[(b.level || 1) - 1]; const avail = BW.assignable(G, town, job, b.id).length; return `<div class="assign"><span>${BW.JOB_NAMES[job]}s</span><button id="bi-minus" ${n ? '' : 'disabled'}>−</button><b>${n} / ${max}</b><button id="bi-plus" ${n >= max || !avail ? 'disabled' : ''}>+</button><small title="Idle adults and breeders, sleepers included. Children, soldiers and villagers away on missions are not counted.">${avail} available</small></div>` + (crew.length ? `<div class="roster">${crew.map((p) => { const lv = BW.skillLevel(p, job); return `<span class="${lv >= 5 ? 'legend' : ''}" title="${esc(p.name)} · ${Math.round(BW.skillXp(p, job))} xp">${esc(p.name)} · ${BW.SKILL_NAMES[lv]}</span>`; }).join('')}</div>` : ''); })() : ''}
        ${b.owner === 0 && b.kind === 'monastery' && b.built ? (() => { const rivals = G.enemyTowns(); const sel = rivals.length ? `<select id="bi-target">${rivals.map((t) => `<option value="${t.id}" ${this.holyTarget === t.id ? 'selected' : ''}>${esc(t.name)} · loyalty ${Math.round(t.loyalty)} · favour ${t.favor || 0}/9</option>`).join('')}</select>` : '<span class="muted">No rival towns left.</span>'; return `<div class="holy"><span>Send to</span>${sel}</div><div class="holy">${Object.entries(BW.HOLY_UNITS).map(([k, u]) => `<button data-holy="${k}" title="${esc(u.desc)}" ${rivals.length ? '' : 'disabled'}>${u.name} (${Object.entries(u.cost).map(([r, v]) => v + ' ' + r).join(', ')})</button>`).join('')}<small>${BW.assignable(G, town).length} available</small></div><div class="muted" style="font-size:11px">Missionaries preach for a while: loyalty drops and wavering villagers convert. Emissaries win favour: 3 stops raids, 6 brings gifts, 9 brings the town to you peacefully.</div>`; })() : ''}
        ${b.owner === 0 && BW.canUpgrade(b) ? `<button id="bi-upgrade" style="margin-top:6px" title="${esc(Object.entries(BW.upgradeCost(b)).map(([k, v]) => v + ' ' + k).join(', '))}">Upgrade to level ${(b.level || 1) + 1} (${Object.entries(BW.upgradeCost(b)).map(([k, v]) => v + ' ' + k).join(', ')})</button>` : ''}
        ${b.upgrading ? `<div>Upgrading to level ${b.level + 1}: ${Math.round(b.progress * 100)}%</div>` : b.level > 1 ? `<div>Level ${b.level}</div>` : ''}
        ${b.owner === 0 && b.kind !== 'center' ? '<button id="bi-demolish" class="danger" style="margin-top:6px">Demolish</button>' : ''}
        ${b.owner === 0 && b.kind === 'armory' && b.built ? '<button id="bi-train" style="margin-top:6px">Train swordsmen</button>' : ''}
        ${b.owner === 0 && b.kind === 'altar' && b.built ? '<button id="bi-sac" class="danger" style="margin-top:6px" title="Sacrifice a worshipper for 90 prayer. Evil.">Sacrifice a worshipper</button>' : ''}`;
      const plus = $('bi-plus'); if (plus) plus.onclick = () => { BW.assignWorkers(G, b, +1); this.showBuilding(b); BW.audio.play('ui'); };
      const tsel = $('bi-target'); if (tsel) { if (!this.holyTarget || !G.ents.get(this.holyTarget)) this.holyTarget = +tsel.value; tsel.onchange = () => { this.holyTarget = +tsel.value; }; }
      el.querySelectorAll('[data-holy]').forEach((btn) => { btn.onclick = () => { if (BW.trainHoly(G, b, btn.dataset.holy, this.holyTarget)) this.showBuilding(b); }; });
      const minus = $('bi-minus'); if (minus) minus.onclick = () => { BW.assignWorkers(G, b, -1); this.showBuilding(b); BW.audio.play('ui'); };
      const up = $('bi-upgrade'); if (up) up.onclick = () => { if (BW.startUpgrade(G, b)) this.showBuilding(b); };
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
      if (e.type === 'person') { const t = G.ents.get(e.town); const yrs = Math.floor(e.age / 300); const lv = e.job !== 'idle' && e.job !== 'soldier' ? BW.skillLevel(e, e.job) : 0; const best = Object.entries(e.skills || {}).sort((a, b) => b[1] - a[1])[0]; return `${e.name || 'Villager'} · ${e.age < 300 ? 'child' : yrs >= 5 ? 'elder' : 'adult'}, ${yrs} yrs · ${e.job === 'soldier' ? (BW.UNITS[e.unit] || BW.UNITS.melee).name : (e.job !== 'idle' ? BW.SKILL_NAMES[lv] + ' ' : '') + BW.JOB_NAMES[e.job]}${lv >= 5 ? ' ★' : ''}${t ? ' · ' + t.name : ' · wild'}${e.job === 'idle' && best && best[1] >= 60 ? '\nBest at: ' + BW.JOB_NAMES[best[0]] + ' (' + BW.SKILL_NAMES[Math.min(5, Math.floor(Math.sqrt(best[1] / 60)))] + ')' : ''}${e.mission ? '\nOn a mission to ' + ((G.ents.get(e.mission.town) || {}).name || 'a rival town') : ''}\nHealth ${Math.ceil(e.health)}/${e.maxHealth} · Hunger ${Math.round(e.hunger)}% · Happy ${Math.round((e.happy || 0) * 100)}%${e.trait ? '\n' + BW.TRAITS[e.trait] : ''}${e.desire ? '\n' + BW.NEED_NAMES[e.desire] : ''}${e.carry ? `\nCarrying ${e.carry.amount} ${e.carry.kind}` : ''}${e.state === 'sleep' ? '\nSleeping' : ''}`; }
      if (e.type === 'tree') return `Tree · ${e.wood} wood${e.fire > 0 ? ' · burning!' : ''}`;
      if (e.type === 'rock') return `${e.kind === 'iron' ? 'Iron vein' : e.kind === 'gold' ? 'Gold vein' : 'Rock'} · ${e.ore} ${e.kind || 'stone'}${e.kind !== 'stone' ? '\nBuild a Mine next to it for endless ' + e.kind : ''}`;
      if (e.type === 'item') return `Heap of ${Math.round(e.amount)} ${e.kind}\nDrop it on a temple to store it`;
      if (e.type === 'building' && e.kind === 'mine') { const d = BW.BUILDINGS[e.kind]; const t = G.ents.get(e.town); return `${d.name} (${e.vein || 'stone'})${t ? ' · ' + t.name : ''}\nHP ${Math.ceil(e.hp)}/${e.maxHp}${e.built ? '' : ` · building ${Math.round(e.progress * 100)}%`} · ${G.people.filter((p) => p.workId === e.id).length}/3 miners`; }
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
      this.drawBars(); this.drawSpeech();
      if (this.adviceT > 0) { this.adviceT -= dt; if (this.adviceT <= 0) { $('adv-good').classList.remove('show'); $('adv-evil').classList.remove('show'); } }
      if (this.t < 250) return;
      this.lastRefresh = nowMs;
      this.drawMinimap(); this.drawTutorial();
      const god = G.god;
      $('prayer').textContent = `${Math.floor(god.prayer)} / ${Math.floor(god.maxPrayer)}`;
      $('prayerbar').firstElementChild.style.width = (god.prayer / god.maxPrayer * 100) + '%';
      $('alignbar').firstElementChild.style.left = ((god.alignment + 1) / 2 * 100) + '%';
      $('aligntext').textContent = god.alignment > 0.6 ? 'Benevolent' : god.alignment > 0.2 ? 'Good' : god.alignment < -0.6 ? 'Malevolent' : god.alignment < -0.2 ? 'Evil' : 'Neutral';
      $('tribute').textContent = god.tribute;
      $('renownbar').firstElementChild.style.width = clamp(god.renown / 300 * 100, 0, 100) + '%';
      const mins = god.renownRate > 0 ? (300 - god.renown) / god.renownRate : 0;
      $('renownrate').textContent = god.renownRate > 0 ? `+${god.renownRate.toFixed(0)} renown/min · next in ${mins < 1 ? '<1' : Math.ceil(mins)} min` : '';
      $('influence').textContent = Math.round(god.influence) + ' m';
      { const era = BW.ERAS[god.era || 0], next = BW.ERAS[(god.era || 0) + 1]; $('era').textContent = era.name; const ins = god.insight || 0; const fi = G.flow && G.flow.insight ? G.flow.insight.p : 0;
        $('erabar').firstElementChild.style.width = next ? clamp((ins - era.insight) / (next.insight - era.insight) * 100, 0, 100) + '%' : '100%';
        $('erarate').textContent = next ? `${Math.round(ins)}/${next.insight} insight · ${fi > 0.05 ? '+' + fi.toFixed(1) + '/min · ' + Math.ceil((next.insight - ins) / fi) + ' min' : 'assign scholars to a Library'}` : 'final age';
        if (this.eraFlash > 0) { this.eraFlash -= 0.25; $('erastat').classList.add('flash'); } else $('erastat').classList.remove('flash'); }
      const day = Math.floor(G.time / G.dayLength) + 1; const hour = Math.floor(G.tod * 24);
      const wk = G.weather.kind; $('clock').textContent = `Day ${day} · ${String(hour).padStart(2, '0')}:00 · ${G.season}${wk !== 'clear' ? ' · ' + wk : ''}${this.game.paused ? ' · PAUSED' : this.game.speed > 1 ? ' · ' + this.game.speed + 'x' : ''}`;
      const town = G.playerTown();
      if (town) {
        const people = G.byTown ? G.byTown.get(town.id) || [] : [];
        $('townname').textContent = town.name;
        $('pop').textContent = `${G.playerTowns().reduce((s, t) => s + (t.pop || 0), 0)} / ${G.playerTowns().reduce((s, t) => s + (t.cap || 0), 0)}`;
        const cap = town.cap_ || G.storageCap(town);
        for (const k of BW.RESOURCES) { const el = $(k); if (el) el.textContent = fmt(town[k] || 0) + ' / ' + fmt(cap); const re = $('rate-' + k); const f = G.flow && G.flow[k]; if (re) { if (f && f.n) { const net = f.p - f.c; re.textContent = (net >= 0 ? '+' : '') + net.toFixed(1) + '/min'; re.className = 'rate ' + (net > 0.05 ? 'up' : net < -0.05 ? 'down' : ''); re.title = `Produced ${f.p.toFixed(1)}/min · consumed ${f.c.toFixed(1)}/min`; } else re.textContent = ''; } }
        $('impress').textContent = Math.round(god.impress);
        const hp = Math.round((town.happiness === undefined ? 0.8 : town.happiness) * 100);
        $('happy').textContent = hp + '%'; $('happy').style.color = hp < 45 ? '#ff8a70' : hp > 70 ? '#8fd48f' : '';
        const counts = BW.countJobs(G, town, people);
        const avail = BW.assignable(G, town).length;
        $('jobs').innerHTML = BW.JOBS.filter((j) => j === 'idle' || counts[j]).map((j) => `<div class="row"><span>${BW.JOB_NAMES[j]}</span><span>${counts[j]}${j === 'idle' ? ` <small title="Adults you can assign right now (children are not counted)">· ${avail} available</small>` : ''}</span></div>`).join('');
        $('autojobs').checked = !!town.autoJobs;
      }
      // Objectives
      const land = this.game.landFor(G.landIndex);
      $('objlist').innerHTML = land.objectives.map((o) => `<li class="${this.game.objectiveDone(o) ? 'done' : ''}">${esc(o)}</li>`).join('');
      $('enemytowns').innerHTML = G.enemyTowns().map((t) => `<div class="town"><span style="color:#${BW.TEAM_COLORS[t.color].toString(16).padStart(6, '0')}">${esc(t.name)} <small>(${t.pop || 0})</small></span><span>loyalty <div class="bar"><i style="width:${clamp(t.loyalty, 0, 100)}%"></i></div>${t.favor ? `<small title="Favour won by emissaries: 3 stops raids, 6 brings gifts, 9 a peaceful union">♥ ${t.favor}/9</small>` : ''}</span></div>`).join('');
      if (this.tab) this.refreshTab();
      if (G.selectedBuilding) { const b = G.ents.get(G.selectedBuilding); if (b && !b.dead) this.showBuilding(b); else { G.selectedBuilding = 0; this.hideBuilding(); } }
    }

    // ------------------------------------------------------------ overlays
    overlay(html) { $('overlay').classList.remove('hidden'); $('overlaybox').innerHTML = html; }
    hideOverlay() { $('overlay').classList.add('hidden'); }
    mainMenu() {
      const g = this.game;
      $('ui').classList.add('photo');
      const hasSave = g.hasSave();
      let species = 'ape';
      const opts = { seed: String(Math.floor(Math.random() * 90000) + 10000), size: '500', tribes: '3' };
      const render = () => {
        this.overlay(`<h1>DOMINION</h1><h2>A god game for the browser</h2>
          <p>Rule a tribe from above. Nurture or terrorise your villagers, raise a colossal creature, and win the island by awe or by war.</p>
          <div><small>Choose your creature</small><div class="species">${Object.entries(BW.SPECIES).map(([k, s]) => { const img = this.icon('c_' + k, () => BW.creatureMesh(k, 0)); return `<div class="item ${k === species ? 'active' : ''}" data-sp="${k}">${img ? `<img src="${img}" alt="">` : ''}<b>${s.name}</b><small>${esc(s.desc)}</small></div>`; }).join('')}</div></div>
          <div class="menu"><button id="mm-new">New campaign</button><button id="mm-continue" ${hasSave ? '' : 'disabled'}>Continue</button><button id="mm-load" ${hasSave ? '' : 'disabled'}>Load game…</button><button id="mm-skirmish">Skirmish</button><button id="mm-help">Controls</button></div>
          <div id="mm-slots"></div>
          <div id="skirmish"><label>Seed <input id="sk-seed" value="${esc(opts.seed)}"></label><label>Map <select id="sk-size"><option value="300" ${opts.size === '300' ? 'selected' : ''}>Small</option><option value="500" ${opts.size === '500' ? 'selected' : ''}>Large</option><option value="800" ${opts.size === '800' ? 'selected' : ''}>Vast</option><option value="1000" ${opts.size === '1000' ? 'selected' : ''}>Huge</option><option value="1200" ${opts.size === '1200' ? 'selected' : ''}>Colossal</option></select></label><label>Tribes <select id="sk-tribes">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<option ${String(n) === opts.tribes ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
          <p class="muted" style="font-size:12px">Tip: this runs entirely in your browser. Saves live in localStorage.</p>`);
        $('overlaybox').querySelectorAll('[data-sp]').forEach((el) => el.onclick = () => { species = el.dataset.sp; render(); });
        $('mm-new').onclick = () => { BW.audio.init(); g.newCampaign(species, 0); };
        $('mm-skirmish').onclick = () => { BW.audio.init(); g.newCampaign(species, 0, true, { seed: parseInt($('sk-seed').value, 10) || 12345, size: parseInt($('sk-size').value, 10), tribes: parseInt($('sk-tribes').value, 10) }); };
        ['sk-seed', 'sk-size', 'sk-tribes'].forEach((id) => $(id).addEventListener('change', () => { opts.seed = $('sk-seed').value; opts.size = $('sk-size').value; opts.tribes = $('sk-tribes').value; }));
        $('mm-continue').onclick = () => { BW.audio.init(); g.load(); };
        $('mm-load').onclick = () => { BW.audio.init(); this.renderSlots('load', $('mm-slots')); };
        $('mm-help').onclick = () => this.toggleHelp();
      };
      render();
    }
    landIntro(land, onBegin) {
      this.overlay(`<h1 style="font-size:30px">${esc(land.name)}</h1><h2>${land.custom ? 'Skirmish · seed ' + land.seed : 'Land ' + (this.game.profile.landIndex + 1) + ' of ' + BW.LANDS.length}</h2>
        <p>${esc(land.intro)}</p><p><b>Objectives</b><br>${land.objectives.map(esc).join('<br>')}</p>
        <div class="menu"><button id="li-begin">Begin</button></div>`);
      $('li-begin').onclick = () => { this.hideOverlay(); $('ui').classList.remove('photo'); onBegin(); };
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
