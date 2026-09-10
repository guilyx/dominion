// ---------------------------------------------------------------------------
// audio.js — tiny WebAudio synthesizer. No samples, everything is generated:
// UI clicks, pick/drop, miracles, creature grunts and an alignment-aware drone.
// ---------------------------------------------------------------------------
(function (BW) {
  'use strict';
  class Audio {
    constructor() { this.ctx = null; this.master = null; this.muted = false; this.drone = null; this.volume = 0.5; }
    init() {
      if (this.ctx) return;
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(this.ctx.destination);
        this._startDrone();
      } catch (e) { this.ctx = null; }
    }
    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
    setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.volume; }
    _env(g, t, a, d, peak = 1) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.001, t + a + d); }
    tone(freq, type, a, d, peak = 0.3, slide = 0) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + a + d);
      this._env(g, t, a, d, peak); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + a + d + 0.05);
    }
    noise(a, d, peak = 0.3, filterHz = 1200) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime, n = this.ctx.sampleRate * (a + d + 0.1);
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), ch = buf.getChannelData(0);
      for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterHz;
      const g = this.ctx.createGain(); this._env(g, t, a, d, peak);
      src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
    }
    play(name) {
      if (!this.ctx) return;
      switch (name) {
        case 'ui': this.tone(660, 'square', 0.005, 0.06, 0.08); break;
        case 'pick': this.tone(320, 'triangle', 0.01, 0.12, 0.2, 200); break;
        case 'drop': this.tone(180, 'triangle', 0.01, 0.15, 0.2, -80); break;
        case 'throw': this.noise(0.02, 0.25, 0.15, 2500); break;
        case 'thud': this.noise(0.01, 0.2, 0.3, 300); this.tone(60, 'sine', 0.01, 0.2, 0.3); break;
        case 'build': this.tone(440, 'triangle', 0.01, 0.1, 0.15); this.tone(660, 'triangle', 0.08, 0.15, 0.15); break;
        case 'place': this.tone(240, 'square', 0.01, 0.12, 0.1); break;
        case 'miracle': this.tone(520, 'sine', 0.05, 0.8, 0.25, 500); this.noise(0.1, 0.6, 0.1, 3000); break;
        case 'water': this.noise(0.2, 1.4, 0.18, 1800); break;
        case 'heal': this.tone(700, 'sine', 0.05, 0.6, 0.2, 400); this.tone(1050, 'sine', 0.2, 0.6, 0.15, 300); break;
        case 'fire': this.noise(0.01, 0.9, 0.4, 900); this.tone(90, 'sawtooth', 0.01, 0.6, 0.25, -60); break;
        case 'lightning': this.noise(0.005, 0.5, 0.5, 6000); this.tone(50, 'sawtooth', 0.01, 0.9, 0.3, -30); break;
        case 'meteor': this.noise(0.4, 2.0, 0.6, 500); this.tone(40, 'sawtooth', 0.3, 1.8, 0.4, -20); break;
        case 'shield': this.tone(300, 'sine', 0.3, 1.2, 0.2, 200); break;
        case 'siren': this.tone(880, 'sine', 0.2, 1.5, 0.2, -300); this.tone(1320, 'sine', 0.5, 1.2, 0.15, -400); break;
        case 'growl': this.tone(80, 'sawtooth', 0.05, 0.4, 0.3, -30); this.noise(0.05, 0.3, 0.1, 400); break;
        case 'happy': this.tone(400, 'sine', 0.03, 0.2, 0.2, 300); this.tone(600, 'sine', 0.15, 0.25, 0.2, 200); break;
        case 'sad': this.tone(300, 'sine', 0.03, 0.4, 0.2, -150); break;
        case 'chime': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 'sine', 0.02, 0.5, 0.2), i * 90)); break;
        case 'hurt': this.tone(200, 'square', 0.005, 0.1, 0.1, -100); break;
        case 'death': this.tone(150, 'sawtooth', 0.01, 0.4, 0.12, -100); break;
        case 'sword': this.noise(0.005, 0.08, 0.15, 5000); this.tone(1200, 'square', 0.005, 0.05, 0.05); break;
        case 'win': [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => this.tone(f, 'triangle', 0.02, 0.9, 0.25), i * 160)); break;
        case 'lose': [400, 350, 300, 200].forEach((f, i) => setTimeout(() => this.tone(f, 'sawtooth', 0.05, 0.8, 0.2), i * 250)); break;
        case 'birth': this.tone(900, 'sine', 0.01, 0.15, 0.1); this.tone(1200, 'sine', 0.1, 0.15, 0.1); break;
      }
    }
    _startDrone() {
      const c = this.ctx;
      const g = c.createGain(); g.gain.value = 0.05; g.connect(this.master);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; f.connect(g);
      const oscs = [];
      for (const ratio of [1, 1.5, 2, 2.5]) { const o = c.createOscillator(); o.type = ratio > 2 ? 'sine' : 'triangle'; o.frequency.value = 110 * ratio; o.connect(f); o.start(); oscs.push(o); }
      // Slow wind
      const n = c.sampleRate * 4, buf = c.createBuffer(1, n, c.sampleRate), ch = buf.getChannelData(0);
      for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * 0.5;
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      const wf = c.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 400; wf.Q.value = 0.6;
      const wg = c.createGain(); wg.gain.value = 0.03; src.connect(wf); wf.connect(wg); wg.connect(this.master); src.start();
      this.drone = { oscs, g, wg };
    }
    // Retune the drone: major-ish when good, minor/diminished when evil.
    setAlignment(a) {
      if (!this.drone) return;
      const third = a < -0.3 ? 1.189 : 1.26;   // minor / major third
      const fifth = a < -0.6 ? 1.414 : 1.5;    // tritone when very evil
      const ratios = [1, third, fifth, 2];
      this.drone.oscs.forEach((o, i) => o.frequency.setTargetAtTime(110 * ratios[i], this.ctx.currentTime, 1.5));
    }
  }
  BW.audio = new Audio();
})(window.BW);
