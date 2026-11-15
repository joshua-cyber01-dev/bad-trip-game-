// LSD – "Die Tapete atmet": an endless, breathing hallway. The Smiling Ones only move while unobserved.
import * as THREE from 'three';
import { Level } from './base';
import { makeGlowItem } from './base';
import { genMaze, pickSpread, type Cell } from '../world/grid';
import { buildWorld, Tex } from '../world/build';
import { makeFigure, Stalker } from '../world/entities';
import type { AudioProfile } from '../core/audio';

export class LsdLevel extends Level {
  audio: AudioProfile = {
    drone: [55, 82.4, 110.6], type: 'triangle', droneGain: 0.16, cutoff: 500, lfo: 0.13,
    noise: 0.02, noiseFreq: 900, noiseQ: 0.5, events: ['giggle', 'creak', 'whisper', 'hum'], every: [7, 16], step: 'carpet',
  };
  private total = 4;
  private got = 0;
  private anchors: THREE.Group[] = [];
  private smilers: Stalker[] = [];
  private flow!: Int16Array;
  private lastCell = -1;
  private blinkT = 16;
  private blink = 0;
  private hue = 0;
  private exit!: THREE.Group;
  private exitCell!: Cell;
  private spare!: Cell;
  private hemi!: THREE.HemisphereLight;

  build() {
    this.setup(0x1c0a22, 3, 27, 74);
    const g = this.grid = genMaze(19, 19, 3, this.rng, { loops: 0.16, rooms: 3 });
    this.spawn = { x: g.center(1), z: g.center(1), yaw: g.open(1, 2) ? Math.PI : -Math.PI / 2 };
    const H = 3.2;
    this.root.add(buildWorld(g, {
      wallH: H,
      wallMat: new THREE.MeshLambertMaterial({ map: Tex.wallpaper(), vertexColors: true }),
      floorMat: new THREE.MeshLambertMaterial({ map: Tex.carpet(), vertexColors: true }),
      ceilMat: new THREE.MeshLambertMaterial({ map: Tex.ceiling(), vertexColors: true }),
      floorRepeat: 2,
    }));
    this.hemi = new THREE.HemisphereLight(0xffd0f0, 0x503070, 2.0);
    this.root.add(this.hemi);
    this.rig.add(new THREE.PointLight(0xffe2c4, 4, 10, 1.5));

    // ceiling lamps: one instanced draw call, real light only from the pool
    const cells = g.openCells().filter(([x, z]) => (x * 7 + z * 13) % 6 === 0);
    const lamps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.2, 0.12, 8), new THREE.MeshBasicMaterial({ color: 0xfff0c8 }), cells.length);
    const m = new THREE.Matrix4();
    cells.forEach(([x, z], i) => {
      lamps.setMatrixAt(i, m.makeTranslation(g.center(x), H - 0.06, g.center(z)));
      this.pool.add({ x: g.center(x), y: H - 0.5, z: g.center(z), color: 0xffdcb0, intensity: 10, dist: 10, on: 1 });
    });
    this.root.add(lamps);

    const picks = pickSpread(g, [1, 1], this.total + 3, this.rng, 6);
    const f0 = g.flow(1, 1);
    // farthest pick becomes the first Smiler's start, next farthest the exit
    picks.sort((a, b) => f0[g.idx(b[0], b[1])] - f0[g.idx(a[0], a[1])]);
    const [s0, ex, spare, ...anch] = picks;
    this.exitCell = ex;
    this.spare = spare;
    anch.slice(0, this.total).forEach(([x, z]) => {
      const a = makeGlowItem(0xffffff, 0.17);
      a.position.set(g.center(x), 1.25, g.center(z));
      this.root.add(a);
      this.anchors.push(a);
      const it = this.addItem(a.position.x, a.position.z, 'Anker nehmen', () => {
        it.active = false;
        a.visible = false;
        this.collect();
      });
    });
    this.total = this.anchors.length;

    this.exit = new THREE.Group();
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.4, 0.12), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
    door.position.y = 1.2;
    this.exit.add(door);
    this.exit.position.set(g.center(ex[0]), 0, g.center(ex[1]));
    this.exit.visible = false;
    this.root.add(this.exit);

    this.spawnSmiler(s0);
    this.flow = g.flow(1, 1);
    this.g.objective('Finde die Realitätsanker', `0/${this.total}`);
  }

  private spawnSmiler([x, z]: Cell) {
    const fig = makeFigure({ h: 2.25, color: 0x0a0308, eye: 0xffffff, smile: true });
    this.root.add(fig);
    this.smilers.push(new Stalker(fig, this.grid.center(x), this.grid.center(z)));
  }

  private collect() {
    this.got++;
    const g = this.g;
    g.audio.chime();
    g.flash(0.5);
    g.heal(0.15);
    g.buzz(40);
    if (this.got === 2) {
      this.spawnSmiler(this.spare);
      g.toast('Etwas Zweites lächelt jetzt.', 3500);
    }
    if (this.got >= this.total) {
      this.exit.visible = true;
      const e = this.exit.position;
      this.pool.add({ x: e.x, y: 1.6, z: e.z, color: 0xffffff, intensity: 30, dist: 12, on: 1 });
      this.addItem(e.x, e.z, 'Durch die Tür gehen', () => g.win(), 2.3);
      g.objective('Finde die weiße Tür');
      g.toast('Eine Tür, die vorher nicht da war …', 3500);
    } else {
      g.objective('Finde die Realitätsanker', `${this.got}/${this.total}`);
    }
  }

  protected tick(dt: number) {
    const g = this.g, p = g.player, grid = this.grid, fx = g.fx;
    const calm = this.got / this.total;
    for (const a of this.anchors) {
      a.rotation.y += dt * 1.2;
      a.rotation.x += dt * 0.7;
      a.position.y = 1.25 + Math.sin(this.time * 2 + a.position.x) * 0.08;
    }
    if (this.exit.visible) this.exit.rotation.y = Math.sin(this.time * 0.6) * 0.15;

    const ci = grid.idx(grid.toCell(p.x), grid.toCell(p.z));
    if (ci !== this.lastCell) { this.lastCell = ci; grid.flow(grid.toCell(p.x), grid.toCell(p.z), this.flow); }

    // forced blink: the screen goes dark for a moment – and they move
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blinkT = 11 + this.rng() * 12 - calm * 3;
      this.blink = 0.55;
    }
    let dark = 0;
    if (this.blink > 0) {
      this.blink -= dt;
      dark = Math.sin(Math.max(0, this.blink / 0.55) * Math.PI);
    }

    let near = 99, nx = 0, nz = 0;
    const speed = 2.3 + this.got * 0.45;
    for (const s of this.smilers) {
      const d = s.dist(p.x, p.z);
      const seen = dark < 0.6 && this.inView(s.x, s.z);
      if (!seen) s.follow(grid, this.flow, dt, dark > 0.6 ? speed * 2.2 : speed, p.x, p.z);
      else { s.vx = 0; s.vz = 0; }
      s.sync(p.x, p.z);
      if (d < near) { near = d; nx = s.x; nz = s.z; }
      if (d < 1.0) { g.caught(s.x, s.z, 'Es hat aufgehört zu lächeln.'); return; }
    }
    if (near < 7) g.hurt(dt * 0.07 * (1 - near / 7));
    else g.heal(dt * 0.012);
    g.audio.threat(Math.max(0, 1 - near / 14), this.panOf(nx, nz));

    this.hue += dt * (0.5 - 0.38 * calm);
    this.hemi.intensity = 2.0 + Math.sin(this.time * 0.8) * 0.5 * (1 - calm);
    fx.hue = this.hue;
    fx.wobble = 1.1 - 0.9 * calm + Math.sin(this.time * 0.37) * 0.3 * (1 - calm);
    fx.swirl = 0.9 * (1 - calm);
    fx.sat = 1.55 - 0.45 * calm;
    fx.chroma = 0.7 - 0.4 * calm;
    fx.vig = 0.8;
    fx.fade = dark;
  }
}
