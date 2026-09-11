// ---------------------------------------------------------------------------
// audio.js — everything you hear is synthesized: sound effects, a layered
// ambience (wind, birds, crickets, sea, rain) and a generative score whose
// mode follows your alignment and whose intensity follows danger.
// ---------------------------------------------------------------------------
(function (BW) {
  'use strict';

  const SETTINGS_KEY = 'dominion_audio';

  class Audio {
    constructor() {
      this.ctx = null; this.muted = false;
      this.vol = { master: 0.6, sfx: 0.8, music: 0.5, ambience: 0.7 };
      try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)); if (s) Object.assign(this.vol, s.vol || {}), this.muted = !!s.muted; } catch (e) { /* defaults */ }
      this.alignment = 0; this.tension = 0; this.night = 0; this.rain = 0; this.sea = 0; this.mode = 'neutral';
    }
    persist() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ vol: this.vol, muted: this.muted })); } catch (e) { /* ignore */ } }
    init() {
      if (this.ctx) return;
      try {
        const c = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = c.createGain(); this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4;
        this.master.connect(this.comp); this.comp.connect(c.destination);
        this.bus = {};
        for (const k of ['sfx', 'music', 'ambience']) { const g = c.createGain(); g.connect(this.master); this.bus[k] = g; }
        this.applyVolumes();
        this._startAmbience();
        this._startMusic();
      } catch (e) { this.ctx = null; }
    }
    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
    applyVolumes() {
      if (!this.ctx) return;
      this.master.gain.value = this.muted ? 0 : this.vol.master;
      for (const k in this.bus) this.bus[k].gain.value = this.vol[k];
    }
    setMuted(m) { this.muted = m; this.applyVolumes(); this.persist(); }
    setVolume(k, v) { this.vol[k] = Math.max(0, Math.min(1, v)); this.applyVolumes(); this.persist(); }

    // ------------------------------------------------------------ helpers
    _env(g, t, a, d, peak = 1, sustain = 0) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); if (sustain) g.gain.setValueAtTime(peak, t + a + sustain); g.gain.exponentialRampToValueAtTime(0.0001, t + a + sustain + d); }
    _noiseBuffer(seconds = 2) {
      if (!this._nb) { const n = this.ctx.sampleRate * seconds, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), ch = b.getChannelData(0); for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1; this._nb = b; }
      return this._nb;
    }
    tone(freq, type, a, d, peak = 0.3, slide = 0, bus = 'sfx', when = 0, detune = 0) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime + when, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t); if (detune) o.detune.value = detune; if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + a + d);
      this._env(g, t, a, d, peak); o.connect(g); g.connect(this.bus[bus]); o.start(t); o.stop(t + a + d + 0.05);
    }
    noise(a, d, peak = 0.3, filterHz = 1200, bus = 'sfx', type = 'lowpass', when = 0) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime + when;
      const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuffer(); src.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = filterHz;
      const g = this.ctx.createGain(); this._env(g, t, a, d, peak);
      src.connect(f); f.connect(g); g.connect(this.bus[bus]); src.start(t); src.stop(t + a + d + 0.1);
    }

    // ------------------------------------------------------------ effects
    play(name) {
      if (!this.ctx) return;
      switch (name) {
        case 'ui': this.tone(660, 'square', 0.005, 0.06, 0.06); break;
        case 'pick': this.tone(320, 'triangle', 0.01, 0.12, 0.2, 200); this.noise(0.005, 0.06, 0.05, 4000); break;
        case 'drop': this.tone(180, 'triangle', 0.01, 0.15, 0.2, -80); break;
        case 'throw': this.noise(0.02, 0.3, 0.18, 2500, 'sfx', 'bandpass'); break;
        case 'thud': this.noise(0.01, 0.2, 0.3, 300); this.tone(60, 'sine', 0.01, 0.2, 0.3); break;
        case 'build': this.tone(440, 'triangle', 0.01, 0.1, 0.15); this.tone(660, 'triangle', 0.08, 0.15, 0.15); this.tone(880, 'triangle', 0.16, 0.25, 0.12); break;
        case 'place': this.tone(240, 'square', 0.01, 0.12, 0.1); this.noise(0.01, 0.08, 0.08, 800); break;
        case 'hammer': this.noise(0.003, 0.05, 0.12, 3000, 'sfx', 'highpass'); this.tone(900, 'square', 0.003, 0.04, 0.05); break;
        case 'chop': this.noise(0.003, 0.08, 0.16, 1200); this.tone(180, 'triangle', 0.003, 0.06, 0.1); break;
        case 'miracle': this.tone(520, 'sine', 0.05, 0.8, 0.25, 500); this.noise(0.1, 0.6, 0.1, 3000); break;
        case 'water': this.noise(0.2, 1.4, 0.18, 1800); this.tone(300, 'sine', 0.3, 1.0, 0.06, 200); break;
        case 'heal': [700, 880, 1050, 1400].forEach((f, i) => this.tone(f, 'sine', 0.05, 0.9, 0.14, 200, 'sfx', i * 0.08)); break;
        case 'fire': this.noise(0.01, 0.9, 0.4, 900); this.tone(90, 'sawtooth', 0.01, 0.6, 0.25, -60); break;
        case 'lightning': this.noise(0.005, 0.5, 0.5, 6000); this.tone(50, 'sawtooth', 0.01, 0.9, 0.3, -30); this.noise(0.3, 2.5, 0.35, 220, 'sfx', 'lowpass', 0.15); break;
        case 'meteor': this.noise(0.4, 2.0, 0.6, 500); this.tone(40, 'sawtooth', 0.3, 1.8, 0.4, -20); break;
        case 'shield': this.tone(300, 'sine', 0.3, 1.2, 0.2, 200); this.tone(450, 'sine', 0.5, 1.2, 0.12, 150); break;
        case 'siren': this.tone(880, 'sine', 0.2, 1.5, 0.2, -300); this.tone(1320, 'sine', 0.5, 1.2, 0.15, -400); this.tone(660, 'sine', 0.9, 1.4, 0.12, 200); break;
        case 'growl': this.tone(80, 'sawtooth', 0.05, 0.4, 0.3, -30); this.noise(0.05, 0.3, 0.1, 400); break;
        case 'roar': this.tone(70, 'sawtooth', 0.1, 1.0, 0.35, 40); this.noise(0.1, 0.9, 0.2, 600); break;
        case 'happy': this.tone(400, 'sine', 0.03, 0.2, 0.2, 300); this.tone(600, 'sine', 0.15, 0.25, 0.2, 200); break;
        case 'sad': this.tone(300, 'sine', 0.03, 0.4, 0.2, -150); break;
        case 'chime': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 'sine', 0.02, 0.5, 0.2, 0, 'sfx', i * 0.09)); break;
        case 'hurt': this.tone(200, 'square', 0.005, 0.1, 0.1, -100); break;
        case 'death': this.tone(150, 'sawtooth', 0.01, 0.4, 0.12, -100); break;
        case 'sword': this.noise(0.005, 0.08, 0.15, 5000, 'sfx', 'highpass'); this.tone(1200, 'square', 0.005, 0.05, 0.05); break;
        case 'arrow': this.noise(0.005, 0.12, 0.1, 3000, 'sfx', 'bandpass'); break;
        case 'win': this.stinger('win'); break;
        case 'lose': this.stinger('lose'); break;
        case 'convert': this.stinger('convert'); break;
        case 'birth': this.tone(900, 'sine', 0.01, 0.15, 0.1); this.tone(1200, 'sine', 0.1, 0.15, 0.1); break;
        case 'thunder': this.noise(0.2, 3.0, 0.4, 180); break;
      }
    }
    // Short musical phrases for big moments, in the current key.
    stinger(kind) {
      const root = 220;
      const maj = [0, 4, 7, 12, 16], min = [0, 3, 7, 10, 12];
      if (kind === 'win') [0, 4, 7, 12, 16, 19].forEach((s, i) => this.tone(root * Math.pow(2, s / 12), 'triangle', 0.02, 1.2, 0.22, 0, 'music', i * 0.14));
      else if (kind === 'lose') [7, 6, 3, 0].forEach((s, i) => this.tone(root * Math.pow(2, (s - 12) / 12), 'sawtooth', 0.05, 1.4, 0.18, 0, 'music', i * 0.32));
      else if (kind === 'convert') (this.alignment < -0.3 ? min : maj).forEach((s, i) => this.tone(root * 2 * Math.pow(2, s / 12), 'sine', 0.02, 1.0, 0.16, 0, 'music', i * 0.1));
    }

    // ------------------------------------------------------------ ambience
    _startAmbience() {
      const c = this.ctx, bus = this.bus.ambience;
      const loopNoise = (filterType, hz, q, gain) => { const src = c.createBufferSource(); src.buffer = this._noiseBuffer(4); src.loop = true; const f = c.createBiquadFilter(); f.type = filterType; f.frequency.value = hz; f.Q.value = q; const g = c.createGain(); g.gain.value = gain; src.connect(f); f.connect(g); g.connect(bus); src.start(); return { src, f, g }; };
      this.amb = {
        wind: loopNoise('bandpass', 380, 0.5, 0.05),
        sea: loopNoise('lowpass', 500, 0.7, 0.0),
        rain: loopNoise('highpass', 1800, 0.4, 0.0),
      };
      // Slow swells on the wind and sea.
      const lfo = c.createOscillator(); lfo.frequency.value = 0.08; const lg = c.createGain(); lg.gain.value = 0.025; lfo.connect(lg); lg.connect(this.amb.wind.g.gain); lfo.start();
      const lfo2 = c.createOscillator(); lfo2.frequency.value = 0.11; const lg2 = c.createGain(); lg2.gain.value = 0.03; lfo2.connect(lg2); lg2.connect(this.amb.sea.g.gain); lfo2.start();
      this._nextBird = 0; this._nextCricket = 0; this._nextOwl = 0;
    }
    // Called every frame with what the camera can see.
    setScene({ night, rain, sea, tension, alignment, inGame }) {
      this.night = night; this.rain = rain; this.sea = sea; this.tension = tension; this.alignment = alignment; this.inGame = inGame;
      if (!this.ctx || !this.amb) return;
      const t = this.ctx.currentTime;
      this.amb.sea.g.gain.setTargetAtTime(0.08 * sea, t, 0.5);
      this.amb.rain.g.gain.setTargetAtTime(0.16 * rain, t, 0.8);
      this.amb.wind.g.gain.setTargetAtTime(0.04 + 0.05 * rain, t, 0.8);
      const now = performance.now() / 1000;
      if (!this.muted && night < 0.5 && rain < 0.5 && now > this._nextBird) { this._nextBird = now + 2 + Math.random() * 6; this._bird(); }
      if (!this.muted && night > 0.5 && now > this._nextCricket) { this._nextCricket = now + 0.6 + Math.random() * 1.2; this._cricket(); }
      if (!this.muted && night > 0.5 && now > this._nextOwl) { this._nextOwl = now + 8 + Math.random() * 20; this._owl(); }
    }
    _bird() {
      const n = 2 + Math.floor(Math.random() * 4), base = 2200 + Math.random() * 1600;
      for (let i = 0; i < n; i++) this.tone(base * (1 + (Math.random() - 0.5) * 0.2), 'sine', 0.01, 0.08, 0.05, 600 * (Math.random() > 0.5 ? 1 : -1), 'ambience', i * (0.09 + Math.random() * 0.06));
    }
    _cricket() { for (let i = 0; i < 6; i++) this.tone(4300 + Math.random() * 300, 'sine', 0.004, 0.02, 0.025, 0, 'ambience', i * 0.045); }
    _owl() { this.tone(430, 'sine', 0.08, 0.35, 0.06, -60, 'ambience'); this.tone(400, 'sine', 0.08, 0.5, 0.06, -80, 'ambience', 0.45); }

    // ------------------------------------------------------------ music
    // A small generative score: pad chords, a plucked arpeggio, a sparse
    // melody, bass, and drums that only enter when there is danger nearby.
    _startMusic() {
      const c = this.ctx;
      this.mus = { bpm: 72, beat: 0, next: c.currentTime + 0.5, chord: 0, prog: [0, 5, 3, 4], bar: 0, melodyNote: 7, silence: 0 };
      this._padFilter = c.createBiquadFilter(); this._padFilter.type = 'lowpass'; this._padFilter.frequency.value = 900; this._padFilter.connect(this.bus.music);
      this._musicTimer = setInterval(() => this._schedule(), 120);
    }
    _scale() {
      // Modes by alignment: bright lydian-ish when good, aeolian when evil, mixolydian in between.
      const a = this.alignment;
      if (a > 0.3) return [0, 2, 4, 6, 7, 9, 11];
      if (a < -0.3) return [0, 2, 3, 5, 7, 8, 10];
      return [0, 2, 4, 5, 7, 9, 10];
    }
    _chordNotes(degree) { const sc = this._scale(); return [0, 2, 4].map((k) => sc[(degree + k) % 7] + 12 * Math.floor((degree + k) / 7)); }
    _freq(semi, base = 110) { return base * Math.pow(2, semi / 12); }
    _pluck(freq, t, dur, gain, type = 'triangle') {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.bus.music); o.start(t); o.stop(t + dur + 0.05);
    }
    _pad(freqs, t, dur, gain) {
      const c = this.ctx;
      for (const f of freqs) for (const det of [-6, 6]) {
        const o = c.createOscillator(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + dur * 0.4); g.gain.setValueAtTime(gain, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
        o.connect(g); g.connect(this._padFilter); o.start(t); o.stop(t + dur + 0.7);
      }
    }
    _drum(kind, t) {
      const c = this.ctx;
      if (kind === 'kick') { const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); o.connect(g); g.connect(this.bus.music); o.start(t); o.stop(t + 0.35); }
      else { const src = c.createBufferSource(); src.buffer = this._noiseBuffer(); const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000; const g = c.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06); src.connect(f); f.connect(g); g.connect(this.bus.music); src.start(t); src.stop(t + 0.1); }
    }
    _schedule() {
      const c = this.ctx, m = this.mus; if (!c || this.muted || this.vol.music <= 0) { m.next = c ? c.currentTime + 0.2 : 0; return; }
      const tension = this.tension, night = this.night;
      const bpm = 64 + tension * 36 - night * 8; const spb = 60 / bpm;
      while (m.next < c.currentTime + 0.35) {
        const t = m.next, beat = m.beat % 4, bar = Math.floor(m.beat / 4);
        if (beat === 0) {
          // New bar: step the progression, occasionally pick a new one.
          if (bar % 4 === 0 && Math.random() < 0.5) m.prog = [[0, 5, 3, 4], [0, 3, 4, 3], [5, 3, 0, 4], [0, 4, 5, 3], [2, 5, 0, 3]][Math.floor(Math.random() * 5)];
          m.chord = m.prog[bar % 4];
          const notes = this._chordNotes(m.chord).map((s) => this._freq(s, 110 * (this.inGame ? 1 : 0.75)));
          if (!this.inGame || tension < 0.9) this._pad(notes, t, spb * 4, 0.05 * (night ? 0.7 : 1));
        }
        // Bass on 1 and 3
        if (beat === 0 || beat === 2) this._pluck(this._freq(this._scale()[m.chord] - 12, 110), t, spb * 1.6, 0.18, 'sine');
        // Arpeggio: chord tones, denser with tension, sparser at night
        const arpChance = 0.35 + tension * 0.5 - night * 0.2;
        const chord = this._chordNotes(m.chord);
        for (let sub = 0; sub < 2; sub++) if (Math.random() < arpChance) { const s = chord[Math.floor(Math.random() * 3)] + 12 * (1 + Math.floor(Math.random() * 2)); this._pluck(this._freq(s, 110), t + sub * spb * 0.5, spb * 0.9, 0.09, 'triangle'); }
        // Melody: a slow random walk on the scale, phrases with rests
        if (Math.random() < 0.28 + tension * 0.2) {
          const sc = this._scale(); m.melodyNote += Math.round((Math.random() - 0.5) * 4); m.melodyNote = Math.max(7, Math.min(20, m.melodyNote));
          const semi = sc[m.melodyNote % 7] + 12 * Math.floor(m.melodyNote / 7) + 12;
          this._pluck(this._freq(semi, 110), t, spb * (1.2 + Math.random()), 0.11, 'sine');
        }
        // Drums only under threat
        if (tension > 0.35) { if (beat === 0 || (beat === 2 && tension > 0.6)) this._drum('kick', t); if (Math.random() < tension) this._drum('hat', t + spb * 0.5); }
        m.next += spb; m.beat++;
      }
    }
    setAlignment(a) { this.alignment = a; }
  }
  BW.audio = new Audio();
})(window.BW);
