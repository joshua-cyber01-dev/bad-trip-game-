// Ketamine – "K-Hole": hospital walkways over a void. Your body lags behind your will,
// tiles dissolve, and when the Silence listens you must not move.
import * as THREE from 'three';
import { Level } from './base';
import { genMaze, pickSpread, OPEN, VOID, WALL, type Cell } from '../world/grid';
import { buildWorld, makeMotes, tex, Tex } from '../world/build';
import { makeFigure } from '../world/entities';
import type { AudioProfile } from '../core/audio';

interface Crumble { cx: number; cz: number; phase: number; gone: boolean }

export class KetamineLevel extends Level {
  audio: AudioProfile = {
    drone: [36.7, 55.2, 73.6], type: 'sine', droneGain: 0.34, cutoff: 240, lfo: 0.05,
    noise: 0.035, noiseFreq: 180, noiseQ: 0.7, events: ['drip', 'hum', 'drip', 'whisper'], every: [5, 12], step: 'tile',
  };
  private crumbles: Crumble[] = [];
  private tiles!: THREE.InstancedMesh;
  private monitors: { x: number; z: number; done: boolean; beepT: number }[] = [];
  private found = 0;
  private total = 3;
  private trail: Cell[] = [];
  private lag = 12;
  private silence!: THREE.Group;
  private phase: 'idle' | 'warn' | 'listen' = 'idle';
  private phaseT = 14;
  private violated = false;
  private falling = 0;
  private safe = { x: 0, z: 0 };
  private bodyCell!: Cell;
  private motes!: THREE.Points;
  private props: THREE.Mesh[] = [];
  private m4 = new THREE.Matrix4();

  build() {
    this.setup(0x010103, 5, 36, 70);
    const g = this.grid = genMaze(17, 17, 3, this.rng, { loops: 0.1 });
    for (let i = 0; i < g.data.length; i++) if (g.data[i] === WALL) g.data[i] = VOID;
    this.spawn = { x: g.center(1), z: g.center(1), yaw: g.open(1, 2) ? Math.PI : -Math.PI / 2 };
    this.safe = { x: this.spawn.x, z: this.spawn.z };

    const picks = pickSpread(g, [1, 1], this.total + 1, this.rng, 6);
    const f0 = g.flow(1, 1);
    picks.sort((a, b) => f0[g.idx(b[0], b[1])] - f0[g.idx(a[0], a[1])]);
    this.bodyCell = picks[0];
    const monCells = picks.slice(1);
    this.total = monCells.length;

    // dissolving tiles (never at spawn or on objectives)
    const reserved = new Set([g.idx(1, 1), ...picks.map(([x, z]) => g.idx(x, z))]);
    for (const [cx, cz] of g.openCells()) {
      if (reserved.has(g.idx(cx, cz)) || Math.abs(cx - 1) + Math.abs(cz - 1) < 3 || this.rng() > 0.15) continue;
      this.crumbles.push({ cx, cz, phase: this.rng() * 12, gone: false });
      g.set(cx, cz, VOID); // excluded from the static mesh
    }
    const floorMat = new THREE.MeshLambertMaterial({ map: Tex.tile(), vertexColors: true });
    this.root.add(buildWorld(g, { wallH: 0, floorMat, skirt: 0.5 }));
    for (const c of this.crumbles) g.set(c.cx, c.cz, OPEN);
    this.tiles = new THREE.InstancedMesh(
      new THREE.BoxGeometry(g.cell * 0.96, 0.18, g.cell * 0.96),
      new THREE.MeshLambertMaterial({ map: Tex.tile(), color: 0xc8d8ff }),
      Math.max(1, this.crumbles.length),
    );
    this.crumbles.forEach((c, i) => this.tiles.setMatrixAt(i, this.m4.makeTranslation(g.center(c.cx), -0.09, g.center(c.cz))));
    this.root.add(this.tiles);

    this.root.add(new THREE.HemisphereLight(0xa8b8d8, 0x303048, 3.2));
    this.rig.add(new THREE.PointLight(0xc8d8ff, 12, 13, 1.3));

    // hanging strip lights
    const lampCells = g.openCells().filter(([x, z]) => (x * 5 + z * 11) % 7 === 0);
    const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.06, 0.18), new THREE.MeshBasicMaterial({ color: 0xdfeaff }), lampCells.length);
    lampCells.forEach(([x, z], i) => {
      lamps.setMatrixAt(i, this.m4.makeTranslation(g.center(x), 3.1, g.center(z)));
      this.pool.add({ x: g.center(x), y: 2.6, z: g.center(z), color: 0xcfe0ff, intensity: 14, dist: 11, on: 1 });
    });
    this.root.add(lamps);

    // heart monitors
    const screen = tex(64, (c, s) => {
      c.fillStyle = '#021006'; c.fillRect(0, 0, s, s);
      c.strokeStyle = '#3cff7a'; c.lineWidth = 2; c.beginPath();
      c.moveTo(0, 36); c.lineTo(18, 36); c.lineTo(24, 14); c.lineTo(30, 52); c.lineTo(36, 36); c.lineTo(64, 36); c.stroke();
    });
    const caseMat = new THREE.MeshLambertMaterial({ color: 0x8a9498 });
    const scrMat = new THREE.MeshBasicMaterial({ map: screen, fog: false });
    for (const [cx, cz] of monCells) {
      const x = g.center(cx), z = g.center(cz);
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.2, 1.1, 6), caseMat);
      stand.position.set(x, 0.55, z);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.4), [caseMat, caseMat, caseMat, caseMat, scrMat, scrMat]);
      box.position.set(x, 1.3, z);
      this.root.add(stand, box);
      const mon = { x, z, done: false, beepT: this.rng() };
      this.monitors.push(mon);
      const it = this.addItem(x, z, 'Puls suchen', () => {
        it.active = false;
        mon.done = true;
        box.visible = false;
        this.find();
      });
    }

    // floating hospital debris in the void
    const bedMat = new THREE.MeshLambertMaterial({ color: 0x9aa6b0 });
    const voidCells: Cell[] = [];
    for (let z = 0; z < g.h; z++) for (let x = 0; x < g.w; x++) if (g.get(x, z) === VOID && this.rng() < 0.07) voidCells.push([x, z]);
    for (const [x, z] of voidCells.slice(0, 14)) {
      const k = this.rng();
      const geo = k < 0.4 ? new THREE.BoxGeometry(1, 0.25, 2) : k < 0.7 ? new THREE.BoxGeometry(1, 2.1, 0.08) : new THREE.BoxGeometry(0.5, 0.5, 0.5);
      const mesh = new THREE.Mesh(geo, bedMat);
      mesh.position.set(g.center(x), -1 + this.rng() * 5, g.center(z));
      mesh.rotation.set(this.rng() * 6, this.rng() * 6, this.rng() * 6);
      this.root.add(mesh);
      this.props.push(mesh);
    }

    this.silence = makeFigure({ h: 2.9, color: 0xb8bcc4, faceless: true });
    this.silence.visible = false;
    this.root.add(this.silence);

    this.motes = makeMotes(Math.round(200 * this.tier.particles), 14, 0xaac0ff, 0.05, 0.6);
    this.root.add(this.motes);
    this.g.objective('Folge dem Piepen', `0/${this.total}`);
  }

  private find() {
    const g = this.g;
    this.found++;
    g.audio.chime();
    g.flash(0.35);
    g.heal(0.2);
    g.buzz(40);
    if (this.found >= this.total) {
      const [cx, cz] = this.bodyCell, x = this.grid.center(cx), z = this.grid.center(cz);
      const table = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 2.1), new THREE.MeshLambertMaterial({ color: 0xa8b4bc }));
      table.position.set(x, 0.4, z);
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.3, 3, 8), new THREE.MeshLambertMaterial({ color: 0xe8e2d8 }));
      body.rotation.x = Math.PI / 2;
      body.position.set(x, 0.98, z);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 1.4, 12, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }),
      );
      beam.position.set(x, 6, z);
      this.root.add(table, body, beam);
      this.pool.add({ x, y: 2.5, z, color: 0xffffff, intensity: 40, dist: 14, on: 1 });
      this.addItem(x, z, 'In den Körper zurück', () => g.win(), 2.4);
      g.objective('Geh zurück in deinen Körper');
      g.toast('Ein Lichtkegel im Nichts.', 3500);
    } else {
      g.objective('Folge dem Piepen', `${this.found}/${this.total}`);
    }
  }

  protected tick(dt: number) {
    const g = this.g, p = g.player, grid = this.grid, fx = g.fx;
    p.accel = 2.3;
    p.speedMul = 0.88;
    p.roll = Math.sin(this.time * 0.43) * 0.07;

    // --- dissolving tiles: 7s solid, 1.6s flicker, 3.4s gone
    this.crumbles.forEach((c, i) => {
      const t = (this.time + c.phase) % 12;
      const gone = t > 8.6;
      const flick = t > 7 && !gone;
      const vis = !gone && (!flick || Math.sin(this.time * 38 + i) > -0.2);
      if (gone !== c.gone) { c.gone = gone; grid.set(c.cx, c.cz, gone ? VOID : OPEN); }
      this.m4.makeTranslation(grid.center(c.cx), vis ? -0.09 : -400, grid.center(c.cz));
      this.tiles.setMatrixAt(i, this.m4);
    });
    this.tiles.instanceMatrix.needsUpdate = true;
    for (const m of this.props) { m.rotation.x += dt * 0.05; m.rotation.y += dt * 0.08; m.position.y += Math.sin(this.time * 0.3 + m.position.x) * dt * 0.1; }

    // --- falling
    const cx = grid.toCell(p.x), cz = grid.toCell(p.z);
    if (this.falling > 0) {
      this.falling += dt;
      p.yOffset = -this.falling * this.falling * 7;
      fx.fade = Math.min(1, this.falling / 1.1);
      if (this.falling > 1.3) {
        this.falling = 0;
        p.yOffset = 0;
        p.x = this.safe.x; p.z = this.safe.z; p.vx = p.vz = 0;
        p.frozen = false;
        g.flash(0.6);
        g.toast('Du fällst nie wirklich. Du fängst nur neu an.', 2800);
      }
    } else if (grid.get(cx, cz) !== OPEN) {
      this.falling = 0.01;
      p.frozen = true;
      g.hurt(0.16);
      g.audio.tone(300, 1.2, 'sine', 0.2, 0, 40);
      g.buzz(120);
    } else {
      const last = this.trail[this.trail.length - 1];
      if (!last || last[0] !== cx || last[1] !== cz) {
        this.trail.push([cx, cz]);
        if (this.trail.length > 60) this.trail.shift();
      }
      if (!this.crumbles.some((c) => c.cx === cx && c.cz === cz)) { this.safe.x = grid.center(cx); this.safe.z = grid.center(cz); }
    }

    // --- monitors beep in stereo so they can be found by ear
    for (const m of this.monitors) {
      if (m.done) continue;
      m.beepT -= dt;
      if (m.beepT <= 0) {
        m.beepT = 1.05;
        const d = Math.hypot(m.x - p.x, m.z - p.z);
        const vol = 0.2 / (1 + d * d * 0.012);
        if (this.phase !== 'listen') g.audio.tone(988, 0.09, 'square', vol * 0.35, this.panOf(m.x, m.z));
      }
    }

    // --- the Silence
    this.phaseT -= dt;
    if (this.phase === 'idle' && this.phaseT <= 0) {
      this.phase = 'warn'; this.phaseT = 1.7;
      g.audio.ring(1.7);
    } else if (this.phase === 'warn' && this.phaseT <= 0) {
      this.phase = 'listen'; this.phaseT = 3.2; this.violated = false;
      g.audio.muffle(1);
    } else if (this.phase === 'listen') {
      if (!this.violated && p.speed > 0.45 && this.falling === 0) {
        this.violated = true;
        this.lag -= 4;
        g.hurt(0.14);
        g.flash(0.35);
        g.audio.stinger(false);
        g.buzz([60, 40, 60]);
        g.toast('Es hat dich gehört.', 1800);
      }
      if (this.phaseT <= 0) {
        this.phase = 'idle'; this.phaseT = 11 + this.rng() * 9;
        if (!this.violated) { this.lag = Math.min(12, this.lag + 1); g.heal(0.04); }
        g.audio.muffle(0.25);
      }
    }
    g.status(this.phase === 'warn' ? '. . .' : this.phase === 'listen' ? 'NICHT BEWEGEN' : null);

    const ti = this.trail.length - 1 - this.lag;
    if (this.lag <= 1) {
      g.caught(this.silence.position.x, this.silence.position.z, 'Die Stille hat dich gefunden.');
      return;
    }
    if (ti >= 0) {
      const [sx, sz] = this.trail[ti];
      this.silence.visible = true;
      this.silence.position.set(grid.center(sx), 0, grid.center(sz));
      this.silence.rotation.y = Math.atan2(p.x - this.silence.position.x, p.z - this.silence.position.z);
    } else this.silence.visible = false;
    const sd = this.silence.visible ? Math.hypot(this.silence.position.x - p.x, this.silence.position.z - p.z) : 99;
    g.audio.threat(Math.max(0, 1 - sd / 18) * (this.phase === 'listen' ? 0 : 1), this.panOf(this.silence.position.x, this.silence.position.z));
    if (this.phase === 'idle') g.heal(dt * 0.008);

    this.motes.position.set(p.x, 0, p.z);
    this.motes.rotation.y -= dt * 0.02;
    const listen = this.phase === 'listen' ? 1 : this.phase === 'warn' ? 1 - this.phaseT / 1.7 : 0;
    fx.dbl = 0.75 + Math.sin(this.time * 0.5) * 0.25;
    fx.sat = 0.4 - listen * 0.4;
    fx.swirl = 0.7;
    fx.wobble = 0.35;
    fx.tint.setRGB(0.8, 0.9, 1.15);
    fx.tintAmt = 0.6;
    fx.vig = 0.95 + listen * 0.6;
    fx.grain = 0.07 + listen * 0.12;
    fx.chroma = 0.4;
  }
}
