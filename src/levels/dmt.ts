// DMT – "Durchbruch": a short, overwhelming trip. Repeat the totem's colour sequences
// before the clock runs out, while geometric Watchers close in.
import * as THREE from 'three';
import { Level } from './base';
import { Grid, OPEN, WALL, type Cell } from '../world/grid';
import { buildWorld, makeMotes, Tex } from '../world/build';
import { makeWatcher, Stalker } from '../world/entities';
import type { AudioProfile } from '../core/audio';

const COLS = [0xff3040, 0xffd21e, 0x30ff6a, 0x20d8ff, 0xd040ff];
const TONES = [261.6, 329.6, 392, 493.9, 587.3];

export class DmtLevel extends Level {
  audio: AudioProfile = {
    drone: [65.4, 98, 130.8, 196], type: 'sawtooth', droneGain: 0.07, cutoff: 900, lfo: 0.31,
    noise: 0.015, noiseFreq: 3000, noiseQ: 4, events: ['blip', 'blip', 'whisper', 'giggle'], every: [3, 8], step: 'stone',
  };
  private obelisks: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; x: number; z: number; glow: number }[] = [];
  private totem!: THREE.Group;
  private totemMat!: THREE.MeshBasicMaterial;
  private watchers: Stalker[] = [];
  private flow!: Int16Array;
  private lastCell = -1;
  private round = 0;
  private rounds = 3;
  private seq: number[] = [];
  private pos = 0;
  private mode: 'wait' | 'show' | 'input' | 'done' = 'wait';
  private showT = 2.5;
  private showI = 0;
  private left = 240;
  private kal = 0;
  private hue = 0;
  private sky!: THREE.Mesh;
  private motes!: THREE.Points;
  private corners: Cell[] = [];

  build() {
    this.setup(0x0a0018, 12, 62, 84);
    const N = 21, g = this.grid = new Grid(N, N, 3);
    for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) {
      const pillar = x % 4 === 2 && z % 4 === 2 && Math.hypot(x - 10, z - 10) > 3;
      g.set(x, z, pillar ? WALL : OPEN);
    }
    const c = g.center(10);
    this.spawn = { x: c, z: c + 9, yaw: 0 };
    this.corners = [[1, 1], [N - 2, 1], [1, N - 2], [N - 2, N - 2]];

    const wt = Tex.glyph(3), ft = Tex.glyph(8);
    this.root.add(buildWorld(g, {
      wallH: 8, chunk: 7,
      wallMat: new THREE.MeshLambertMaterial({ map: wt, emissiveMap: wt, emissive: 0xffffff, emissiveIntensity: 1.6, vertexColors: true }),
      floorMat: new THREE.MeshLambertMaterial({ map: ft, emissiveMap: ft, emissive: 0xffffff, emissiveIntensity: 1.1, vertexColors: true }),
    }));
    this.root.add(new THREE.HemisphereLight(0xa080ff, 0x402080, 2.6));

    const st = Tex.glyph(21);
    st.repeat.set(6, 3);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(58, 16, 10), new THREE.MeshBasicMaterial({ map: st, side: THREE.BackSide, fog: false }));
    this.sky.position.set(c, 0, c);
    this.root.add(this.sky);

    // totem
    this.totem = new THREE.Group();
    this.totemMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    const wire = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, fog: false });
    for (let i = 0; i < 3; i++) {
      const o = new THREE.Mesh(new THREE.OctahedronGeometry(0.8 - i * 0.18, 0), i === 1 ? wire : this.totemMat);
      o.position.y = 1.4 + i * 1.3;
      this.totem.add(o);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.05, 4, 24), wire);
    ring.position.y = 2.7;
    this.totem.add(ring);
    this.totem.position.set(c, 0, c);
    this.root.add(this.totem);
    this.addItem(c, c, 'Folge zeigen −5s', () => {
      if (this.mode !== 'input') return;
      this.left -= 5;
      this.startShow();
    }, 2.8);

    // five colour obelisks on a ring
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
      let cx = Math.round(10 + Math.cos(a) * 6.4), cz = Math.round(10 + Math.sin(a) * 6.4);
      if (!g.open(cx, cz)) cx += 1;
      if (!g.open(cx, cz)) cz += 1;
      const x = g.center(cx), z = g.center(cz);
      const mat = new THREE.MeshBasicMaterial({ color: COLS[k], fog: false });
      const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3.6, 4), mat);
      mesh.position.set(x, 1.8, z);
      this.root.add(mesh);
      const ob = { mesh, mat, x, z, glow: 0 };
      this.obelisks.push(ob);
      this.pool.add({ x, y: 2, z, color: COLS[k], intensity: 22, dist: 11, on: 1 });
      this.addItem(x, z, 'Berühren', () => this.touch(k), 2.5);
    }

    this.spawnWatcher();
    this.flow = g.flow(10, 13);
    this.motes = makeMotes(Math.round(320 * this.tier.particles), 16, 0xffffff, 0.09, 0.9);
    this.root.add(this.motes);
    this.g.objective('Merke dir die Folge', `Runde 1/${this.rounds}`);
    this.g.timer(this.left);
  }

  private spawnWatcher() {
    if (this.watchers.length >= 4) return;
    const p = this.g.player, g = this.grid;
    const far = [...this.corners].sort((a, b) => Math.hypot(g.center(b[0]) - p.x, g.center(b[1]) - p.z) - Math.hypot(g.center(a[0]) - p.x, g.center(a[1]) - p.z))[this.watchers.length % 2];
    const mesh = makeWatcher(COLS[(this.watchers.length * 2 + 1) % 5]);
    this.root.add(mesh);
    this.watchers.push(new Stalker(mesh, g.center(far[0]), g.center(far[1])));
  }

  private newSeq() {
    const n = 3 + this.round;
    this.seq = [];
    while (this.seq.length < n) {
      const k = (this.rng() * 5) | 0;
      if (k !== this.seq[this.seq.length - 1]) this.seq.push(k);
    }
  }

  private startShow() {
    this.mode = 'show';
    this.showI = 0;
    this.showT = 0.9;
    this.pos = 0;
    this.kal = Math.max(this.kal, 0.35);
    this.g.objective('Merke dir die Folge', `Runde ${this.round + 1}/${this.rounds}`);
  }

  private touch(k: number) {
    const g = this.g, ob = this.obelisks[k];
    if (this.mode !== 'input') { g.toast('Noch nicht.', 1200); return; }
    ob.glow = 1;
    if (k === this.seq[this.pos]) {
      this.pos++;
      g.audio.tone(TONES[k], 0.5, 'triangle', 0.22);
      g.buzz(25);
      if (this.pos >= this.seq.length) {
        this.round++;
        g.flash(0.6);
        g.heal(0.2);
        g.audio.chime();
        this.kal = 0.9;
        if (this.round >= this.rounds) {
          this.mode = 'done';
          this.totemMat.color.setHex(0xffffff);
          g.objective('Das Tor ist offen. Zurück zum Totem');
          g.toast('Sie lassen dich gehen.', 3000);
          this.items[0].label = 'Zurückkehren';
          this.items[0].use = () => g.win();
        } else {
          this.newSeq();
          this.mode = 'wait';
          this.showT = 2.2;
          g.objective('Merke dir die Folge', `Runde ${this.round + 1}/${this.rounds}`);
        }
      } else g.objective('Wiederhole die Folge', `${this.pos}/${this.seq.length}`);
    } else {
      this.pos = 0;
      this.left -= 10;
      this.kal = 1;
      g.hurt(0.14);
      g.audio.stinger(false);
      g.buzz([80, 40, 80]);
      g.toast('FALSCH. Sie haben es bemerkt.', 2200);
      this.spawnWatcher();
      g.objective('Wiederhole die Folge', `0/${this.seq.length}`);
    }
  }

  protected tick(dt: number) {
    const g = this.g, p = g.player, grid = this.grid, fx = g.fx;

    if (this.mode !== 'done') {
      this.left -= dt;
      g.timer(Math.max(0, this.left));
      if (this.left <= 0) { g.lose('Die Zeit ist abgelaufen. Du bist nicht zurückgekommen.'); return; }
    } else g.timer(null);

    // sequence presentation
    if (this.mode === 'wait') {
      this.showT -= dt;
      if (this.showT <= 0) { if (!this.seq.length) this.newSeq(); this.startShow(); }
    } else if (this.mode === 'show') {
      this.showT -= dt;
      if (this.showT <= 0) {
        if (this.showI < this.seq.length) {
          const k = this.seq[this.showI++];
          this.totemMat.color.setHex(COLS[k]);
          this.obelisks[k].glow = 1;
          g.audio.tone(TONES[k], 0.55, 'triangle', 0.25);
          this.showT = 0.8;
        } else {
          this.totemMat.color.setHex(0x222222);
          this.mode = 'input';
          g.objective('Wiederhole die Folge', `0/${this.seq.length}`);
        }
      } else if (this.showT < 0.2 && this.showI > 0) this.totemMat.color.setHex(0x222222);
    }

    for (const ob of this.obelisks) {
      ob.glow = Math.max(0, ob.glow - dt * 1.6);
      const s = 1 + ob.glow * 0.6;
      ob.mesh.scale.set(s, s, s);
      ob.mesh.rotation.y += dt * (0.4 + ob.glow * 6);
    }
    this.totem.children.forEach((c, i) => { c.rotation.y += dt * (i % 2 ? -1.1 : 0.8); c.rotation.x += dt * 0.3; });
    this.sky.rotation.y += dt * 0.03;
    this.sky.rotation.z += dt * 0.011;

    const cx = grid.toCell(p.x), cz = grid.toCell(p.z), ci = grid.idx(cx, cz);
    if (ci !== this.lastCell && grid.open(cx, cz)) { this.lastCell = ci; grid.flow(cx, cz, this.flow); }
    let near = 99, nx = 0, nz = 0;
    for (const w of this.watchers) {
      w.follow(grid, this.flow, dt, 1.55 + this.round * 0.4, p.x, p.z);
      w.mesh.position.set(w.x, 1.5 + Math.sin(this.time * 1.7 + w.x) * 0.25, w.z);
      (w.mesh.userData.spin as THREE.Mesh[]).forEach((m, i) => { m.rotation.x += dt * (1 + i); m.rotation.y += dt * (1.6 - i * 0.5); });
      const d = w.dist(p.x, p.z);
      if (d < near) { near = d; nx = w.x; nz = w.z; }
    }
    if (near < 1.9) {
      g.hurt(dt * 0.32);
      this.kal = Math.max(this.kal, 0.75);
      g.buzz(15);
    } else g.heal(dt * 0.01);
    g.audio.threat(Math.max(0, 1 - near / 12), this.panOf(nx, nz));

    this.kal *= Math.exp(-dt * 0.9);
    this.hue += dt * 0.6;
    this.motes.position.set(p.x, 0, p.z);
    this.motes.rotation.y += dt * 0.12;
    const urgency = this.mode === 'done' ? 0 : Math.max(0, 1 - this.left / 60);
    fx.hue = this.hue;
    fx.kal = Math.min(0.92, this.kal + Math.max(0, 0.25 - near * 0.05));
    fx.seg = 8;
    fx.sat = 1.5;
    fx.chroma = 0.8 + urgency;
    fx.wobble = 0.5 + urgency * 1.2;
    fx.swirl = 0.6;
    fx.vig = 0.6;
  }
}
