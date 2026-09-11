// ---------------------------------------------------------------------------
// camera.js — god-cam: grab-the-land panning, orbit with right mouse, wheel
// zoom, keyboard nudges. Raw mouse input is collected here and shared with
// the hand through BW.input.
// ---------------------------------------------------------------------------
(function (BW) {
  'use strict';
  const { clamp } = BW;

  const input = {
    mx: 0, my: 0, dx: 0, dy: 0, buttons: 0, keys: {}, wheel: 0,
    downAt: null, canvas: null, locked: false,
  };
  BW.input = input;

  class GodCamera {
    constructor(gfx, terrain) {
      this.gfx = gfx; this.cam = gfx.camera; this.terrain = terrain;
      this.tx = 0; this.tz = 0; this.yaw = 0.6; this.pitch = 0.9; this.dist = 90;
      this.targetDist = this.dist;
      this.panAnchor = null;   // world point grabbed with the hand
      this.rotating = false;
      this._ray = new THREE.Raycaster();
      this._ndc = new THREE.Vector2();
      this.shake = 0;
      this.update(0);
    }
    setTerrain(t) { this.terrain = t; }
    lookAt(x, z) { this.tx = x; this.tz = z; }
    state() { return { tx: this.tx, tz: this.tz, yaw: this.yaw, pitch: this.pitch, dist: this.dist }; }
    restore(s) { if (!s) return; Object.assign(this, s); this.targetDist = s.dist; }

    // Unproject the pointer to a world ray.
    pointerRay(mx, my) {
      this._ndc.set((mx / window.innerWidth) * 2 - 1, -(my / window.innerHeight) * 2 + 1);
      this._ray.setFromCamera(this._ndc, this.cam);
      return this._ray.ray;
    }
    groundPoint(mx, my) {
      const ray = this.pointerRay(mx, my);
      return this.terrain.raycast(ray.origin, ray.direction);
    }
    // Intersection with a horizontal plane (used for stable panning).
    planePoint(mx, my, y) {
      const ray = this.pointerRay(mx, my);
      if (Math.abs(ray.direction.y) < 1e-4) return null;
      const t = (y - ray.origin.y) / ray.direction.y;
      if (t < 0) return null;
      return ray.origin.clone().addScaledVector(ray.direction, t);
    }
    beginPan(mx, my) {
      const p = this.groundPoint(mx, my);
      if (!p) return false;
      this.panAnchor = { x: p.x, z: p.z, y: p.y };
      return true;
    }
    endPan() { this.panAnchor = null; }

    update(dt) {
      const k = input.keys;
      const sp = this.dist * 0.9 * dt * (k.ShiftLeft || k.ShiftRight ? 2 : 1);
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      if (k.KeyW || k.ArrowUp) { this.tx += fx * sp; this.tz += fz * sp; }
      if (k.KeyS || k.ArrowDown) { this.tx -= fx * sp; this.tz -= fz * sp; }
      if (k.KeyA || k.ArrowLeft) { this.tx -= rx * sp; this.tz -= rz * sp; }
      if (k.KeyD || k.ArrowRight) { this.tx += rx * sp; this.tz += rz * sp; }
      if (k.KeyQ) this.yaw += 1.5 * dt;
      if (k.KeyE) this.yaw -= 1.5 * dt;
      if (input.wheel) {
        const before = this.targetDist;
        this.targetDist = clamp(this.targetDist * Math.pow(1.0015, input.wheel), 14, 320); input.wheel = 0;
        // Zoom towards the ground under the cursor, like map apps do.
        if (this.targetDist < before) { const p = this.groundPoint(input.mx, input.my); if (p) { const f = 1 - this.targetDist / before; this.tx += (p.x - this.tx) * f; this.tz += (p.z - this.tz) * f; } }
      }
      this.targetDist = clamp(this.targetDist, 14, 320);
      // Edge scrolling (toggle in the menu): pointer within 14 px of the window edge.
      if (this.edgeScroll && !this.panAnchor && !this.rotating && document.hasFocus()) {
        const m = 14, es = this.dist * 0.7 * dt; let ex = 0, ez = 0;
        if (input.mx < m) ex = -1; else if (input.mx > window.innerWidth - m) ex = 1;
        if (input.my < m) ez = 1; else if (input.my > window.innerHeight - m) ez = -1;
        if (ex || ez) { this.tx += (fx * ez + rx * ex) * es; this.tz += (fz * ez + rz * ex) * es; }
      }
      this.dist += (this.targetDist - this.dist) * Math.min(1, dt * 8);
      if (this.rotating) { this.yaw -= input.dx * 0.005; this.pitch = clamp(this.pitch + input.dy * 0.004, 0.25, 1.45); }
      if (input.touchYaw) { this.yaw -= input.touchYaw; input.touchYaw = 0; }
      if (input.touchPanX || input.touchPanY) { const s = this.dist * 0.0025; this.tx -= (input.touchPanX * rx + input.touchPanY * fx) * s; this.tz -= (input.touchPanX * rz + input.touchPanY * fz) * s; input.touchPanX = 0; input.touchPanY = 0; }
      // Grab-the-land panning: keep the anchor under the cursor.
      if (this.panAnchor) {
        const p = this.planePoint(input.mx, input.my, this.panAnchor.y);
        if (p) { this.tx += this.panAnchor.x - p.x; this.tz += this.panAnchor.z - p.z; }
      }
      const half = this.terrain.half + 40;
      this.tx = clamp(this.tx, -half, half); this.tz = clamp(this.tz, -half, half);
      const ty = Math.max(this.terrain.heightAt(this.tx, this.tz), 0);
      const cy = ty + Math.sin(this.pitch) * this.dist;
      const cx = this.tx + Math.cos(this.pitch) * Math.sin(this.yaw) * this.dist;
      const cz = this.tz + Math.cos(this.pitch) * Math.cos(this.yaw) * this.dist;
      // Never clip into hills.
      const minY = Math.max(this.terrain.heightAt(cx, cz), 0) + 4;
      let sx = 0, sy = 0;
      if (this.shake > 0) { sx = (Math.random() - 0.5) * this.shake; sy = (Math.random() - 0.5) * this.shake; this.shake = Math.max(0, this.shake - dt * 3); }
      this.cam.position.set(cx + sx, Math.max(cy, minY) + sy, cz);
      this.cam.lookAt(this.tx, ty + 2, this.tz);
    }
  }

  function bindInput(canvas) {
    input.canvas = canvas;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => { input.dx += e.clientX - input.mx; input.dy += e.clientY - input.my; input.mx = e.clientX; input.my = e.clientY; if (input.onMove) input.onMove(e); });
    canvas.addEventListener('mousedown', (e) => { input.buttons |= (1 << e.button); if (input.onDown) input.onDown(e); });
    window.addEventListener('mouseup', (e) => { input.buttons &= ~(1 << e.button); if (input.onUp) input.onUp(e); });
    canvas.addEventListener('wheel', (e) => { input.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
    window.addEventListener('keydown', (e) => { if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return; input.keys[e.code] = true; if (input.onKey) input.onKey(e); if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault(); });
    window.addEventListener('keyup', (e) => { input.keys[e.code] = false; });
    window.addEventListener('blur', () => { input.keys = {}; input.buttons = 0; });
    // Touch: one finger acts as the left button, two fingers pinch to zoom and twist to rotate.
    let pinch = null;
    const tpos = (t) => ({ x: t.clientX, y: t.clientY });
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) { const p = tpos(e.touches[0]); input.mx = p.x; input.my = p.y; input.dx = 0; input.dy = 0; input.buttons |= 1; if (input.onDown) input.onDown({ button: 0 }); }
      else if (e.touches.length === 2) { if (input.buttons & 1) { input.buttons &= ~1; if (input.onUp) input.onUp({ button: 0 }); } const a = tpos(e.touches[0]), b = tpos(e.touches[1]); pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; }
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) { const p = tpos(e.touches[0]); input.dx += p.x - input.mx; input.dy += p.y - input.my; input.mx = p.x; input.my = p.y; }
      else if (e.touches.length === 2 && pinch) {
        const a = tpos(e.touches[0]), b = tpos(e.touches[1]); const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
        input.wheel += (pinch.d - d) * 4; input.touchYaw = (input.touchYaw || 0) + (ang - pinch.ang);
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2; input.touchPanX = (input.touchPanX || 0) + (cx - pinch.cx); input.touchPanY = (input.touchPanY || 0) + (cy - pinch.cy);
        pinch = { d, ang, cx, cy };
      }
    }, { passive: false });
    const endTouch = (e) => { e.preventDefault(); if (e.touches.length === 0) { if (input.buttons & 1) { input.buttons &= ~1; if (input.onUp) input.onUp({ button: 0 }); } pinch = null; } };
    canvas.addEventListener('touchend', endTouch, { passive: false });
    canvas.addEventListener('touchcancel', endTouch, { passive: false });
  }
  // Called once per frame after everyone has consumed deltas.
  function endInputFrame() { input.dx = 0; input.dy = 0; }

  Object.assign(BW, { GodCamera, bindInput, endInputFrame });
})(window.BW);
