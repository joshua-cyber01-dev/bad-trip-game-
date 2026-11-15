// Fully procedural WebAudio: drones, noise beds, footsteps, heartbeat, stingers.
// No audio files -> zero download, works offline.

export type AmbEvent = 'drip' | 'creak' | 'whisper' | 'knock' | 'giggle' | 'blip' | 'wind' | 'hum';
export type StepKind = 'carpet' | 'leaf' | 'tile' | 'stone' | 'wood';

export interface AudioProfile {
  drone: number[];
  type: OscillatorType;
  droneGain: number;
  cutoff: number;
  lfo: number;
  noise: number;
  noiseFreq: number;
  noiseQ: number;
  events: AmbEvent[];
  every: [number, number];
  step: StepKind;
}

export class AudioSys {
  ctx?: AudioContext;
  private master!: GainNode;
  private bus!: GainNode;
  private muffleF!: BiquadFilterNode;
  private noiseBuf!: AudioBuffer;
  private levelNodes: AudioNode[] = [];
  private levelSrc: AudioScheduledSourceNode[] = [];
  private threatG?: GainNode;
  private threatP?: StereoPannerNode;
  private profile?: AudioProfile;
  private evT = 5;
  private beatT = 0;
  private volume = 0.8;

  /** Must be called from a user gesture (iOS). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try {
        // iOS 16.4+: play even when the ring/silent switch is on silent.
        const nav = navigator as Navigator & { audioSession?: { type: string } };
        if (nav.audioSession) nav.audioSession.type = 'playback';
      } catch { /* ignore */ }
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(ctx.destination);
      this.muffleF = ctx.createBiquadFilter();
      this.muffleF.type = 'lowpass';
      this.muffleF.frequency.value = 18000;
      this.bus = ctx.createGain();
      this.bus.connect(this.muffleF).connect(this.master);
      const len = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }
  suspend() { void this.ctx?.suspend(); }
  resume() { void this.ctx?.resume(); }

  /** 0 = clear, 1 = heavily muffled (under water / dissociated). */
  muffle(a: number) {
    if (!this.ctx) return;
    this.muffleF.frequency.setTargetAtTime(18000 * Math.pow(0.02, a), this.ctx.currentTime, 0.15);
  }

  private noise(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }

  private pan(p: number): AudioNode {
    const ctx = this.ctx!;
    if (!ctx.createStereoPanner) return this.bus;
    const n = ctx.createStereoPanner();
    n.pan.value = Math.max(-1, Math.min(1, p));
    n.connect(this.bus);
    return n;
  }

  startLevel(p: AudioProfile) {
    this.stopLevel();
    const ctx = this.ctx;
    if (!ctx) return;
    this.profile = p;
    this.evT = 6;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + 3);
    out.connect(this.bus);
    this.levelNodes.push(out);

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = p.cutoff;
    filt.Q.value = 2;
    const dg = ctx.createGain();
    dg.gain.value = p.droneGain;
    filt.connect(dg).connect(out);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = p.lfo;
    const lg = ctx.createGain();
    lg.gain.value = p.cutoff * 0.5;
    lfo.connect(lg).connect(filt.frequency);
    lfo.start();
    this.levelSrc.push(lfo);
    for (const f of p.drone) {
      for (const det of [-6, 7]) {
        const o = ctx.createOscillator();
        o.type = p.type;
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(filt);
        o.start();
        this.levelSrc.push(o);
      }
    }
    const n = this.noise();
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = p.noiseFreq;
    nf.Q.value = p.noiseQ;
    const ng = ctx.createGain();
    ng.gain.value = p.noise;
    n.connect(nf).connect(ng).connect(out);
    n.start();
    this.levelSrc.push(n);

    // continuous "something is near" tone, driven by threat()
    const to = ctx.createOscillator();
    to.type = 'sawtooth';
    to.frequency.value = 46;
    const to2 = ctx.createOscillator();
    to2.type = 'sine';
    to2.frequency.value = 48.7;
    const tf = ctx.createBiquadFilter();
    tf.type = 'lowpass';
    tf.frequency.value = 260;
    this.threatG = ctx.createGain();
    this.threatG.gain.value = 0;
    to.connect(tf); to2.connect(tf);
    tf.connect(this.threatG);
    if (ctx.createStereoPanner) {
      this.threatP = ctx.createStereoPanner();
      this.threatG.connect(this.threatP).connect(out);
    } else this.threatG.connect(out);
    to.start(); to2.start();
    this.levelSrc.push(to, to2);
  }

  stopLevel() {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const s of this.levelSrc) { try { s.stop(ctx.currentTime + 0.3); } catch { /* already stopped */ } }
    const nodes = this.levelNodes;
    setTimeout(() => nodes.forEach((n) => n.disconnect()), 500);
    this.levelSrc = []; this.levelNodes = [];
    this.threatG = undefined; this.threatP = undefined; this.profile = undefined;
    this.muffle(0);
  }

  /** closeness 0..1, pan -1..1 */
  threat(closeness: number, pan: number) {
    if (!this.ctx || !this.threatG) return;
    this.threatG.gain.setTargetAtTime(closeness * closeness * 0.5, this.ctx.currentTime, 0.2);
    this.threatP?.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), this.ctx.currentTime, 0.1);
  }

  /** per-frame: heartbeat by fear (0..1) and random ambience */
  update(dt: number, fear: number) {
    if (!this.ctx || !this.profile) return;
    if (fear > 0.2) {
      this.beatT -= dt;
      if (this.beatT <= 0) {
        this.beatT = 1.15 - fear * 0.75;
        this.thump(0, 0.5 * fear + 0.15);
        this.thump(0.15, 0.35 * fear + 0.1);
      }
    }
    this.evT -= dt;
    if (this.evT <= 0) {
      const [a, b] = this.profile.every;
      this.evT = a + Math.random() * (b - a);
      const ev = this.profile.events[(Math.random() * this.profile.events.length) | 0];
      this.event(ev, Math.random() * 2 - 1);
    }
  }

  private thump(delay: number, gain: number) {
    const ctx = this.ctx!, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(36, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.25);
  }

  tone(freq: number, dur = 0.3, type: OscillatorType = 'sine', gain = 0.2, pan = 0, glideTo?: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.pan(pan));
    o.start(t); o.stop(t + dur + 0.05);
  }

  burst(freq: number, q: number, dur: number, gain: number, pan = 0, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    n.connect(f).connect(g).connect(this.pan(pan));
    n.start(t); n.stop(t + dur + 0.05);
  }

  step(run: boolean) {
    const k = this.profile?.step ?? 'stone';
    const g = run ? 0.22 : 0.13;
    const j = 0.85 + Math.random() * 0.3;
    if (k === 'carpet') this.burst(220 * j, 0.8, 0.12, g * 0.9, 0, 'lowpass');
    else if (k === 'leaf') { this.burst(2600 * j, 0.7, 0.16, g * 0.5); this.burst(300 * j, 1, 0.1, g * 0.6, 0, 'lowpass'); }
    else if (k === 'tile') { this.burst(1400 * j, 3, 0.07, g); this.tone(160 * j, 0.06, 'sine', g * 0.4); }
    else if (k === 'wood') { this.burst(500 * j, 2, 0.1, g); this.tone(95 * j, 0.09, 'sine', g * 0.7); }
    else this.burst(700 * j, 1.5, 0.1, g);
  }

  stinger(big = true) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime, dur = big ? 1.6 : 0.7;
    for (const f of big ? [98, 104, 147, 311, 329, 622] : [220, 233, 466]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * (big ? 0.7 : 0.9), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(big ? 0.16 : 0.06, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + dur + 0.1);
    }
    this.burst(900, 0.4, dur * 0.8, big ? 0.5 : 0.15);
  }

  chime(up = true) {
    const base = up ? [523, 659, 784, 1046] : [440, 415, 311];
    base.forEach((f, i) => setTimeout(() => this.tone(f, 0.5, 'sine', 0.14), i * 90));
  }

  ui() { this.tone(520, 0.07, 'triangle', 0.08); }

  whisper(pan = 0, dur = 1.4, gain = 0.25) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1500 + Math.random() * 1500; f.Q.value = 2.5;
    const g = ctx.createGain();
    const curve = new Float32Array(24);
    for (let i = 1; i < 23; i++) curve[i] = Math.random() < 0.3 ? 0 : Math.random() * gain;
    g.gain.setValueCurveAtTime(curve, t, dur);
    n.connect(f).connect(g).connect(this.pan(pan));
    n.start(t); n.stop(t + dur + 0.05);
  }

  /** rising tinnitus tone (ketamine "listening" warning) */
  ring(dur: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(2900, t);
    o.frequency.linearRampToValueAtTime(3300, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.11, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  event(ev: AmbEvent, pan = 0) {
    if (!this.ctx) return;
    switch (ev) {
      case 'drip': this.tone(1300 + Math.random() * 500, 0.12, 'sine', 0.07, pan, 500); break;
      case 'creak': this.tone(170 + Math.random() * 60, 0.7, 'sawtooth', 0.035, pan, 80); break;
      case 'whisper': this.whisper(pan); break;
      case 'knock': [0, 220, 440].forEach((d) => setTimeout(() => { this.tone(85, 0.12, 'sine', 0.3, pan, 50); this.burst(300, 1, 0.06, 0.12, pan); }, d)); break;
      case 'giggle': [0, 110, 210, 300, 380, 520].forEach((d, i) => setTimeout(() => this.tone(700 + (i % 3) * 140 + Math.random() * 60, 0.09, 'triangle', 0.05, pan), d)); break;
      case 'blip': [0, 80, 160, 240, 320].forEach((d) => setTimeout(() => this.tone(300 * Math.pow(2, ((Math.random() * 14) | 0) / 7), 0.25, 'sine', 0.05, Math.random() * 2 - 1), d)); break;
      case 'wind': this.burst(400 + Math.random() * 300, 0.6, 3.5, 0.12, pan); break;
      case 'hum': this.tone(100, 2.5, 'square', 0.02, pan, 98); break;
    }
  }
}
