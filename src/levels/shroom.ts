// Psilocybin – "Myzel": a night forest. Darkness eats your mind; glowing mushrooms are the only shelter.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Level } from './base';
import { genCave, pickSpread, WALL, type Cell } from '../world/grid';
import { buildWorld, makeMotes, Tex, type LightSrc } from '../world/build';
import { makeFigure, Stalker } from '../world/entities';
import type { AudioProfile } from '../core/audio';

interface Zone { x: number; z: number; r: number; phase: number; on: number; fixed: boolean; src: LightSrc }

function colored(geo: THREE.BufferGeometry, color: number, y = 0): THREE.BufferGeometry {
  const g = geo.toNonIndexed();
  g.translate(0, y, 0);
  const c = new THREE.Color(color), n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

export class ShroomLevel extends Level {
  audio: AudioProfile = {
    drone: [41.2, 61.7, 92.5], type: 'sine', droneGain: 0.3, cutoff: 320, lfo: 0.07,
    noise: 0.07, noiseFreq: 500, noiseQ: 0.4, events: ['wind', 'creak', 'whisper', 'knock', 'wind'], every: [6, 14], step: 'leaf',
  };
  private zones: Zone[] = [];
  private shrooms!: THREE.InstancedMesh;
  private discs!: THREE.InstancedMesh;
  private mothers: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; awake: boolean }[] = [];
  private awake = 0;
  private total = 5;
  private stalker!: Stalker;
  private flow!: Int16Array;
  private lastCell = -1;
  private idle = 0;
  private darkT = 0;
  private motes!: THREE.Points;
  private portal?: THREE.Mesh;
  private col = new THREE.Color();

  build() {
    this.setup(0x0a161b, 2, 25, 72);
    const g = this.grid = genCave(34, 34, 2.6, this.rng);
    const open = g.openCells();
    const mid = open.reduce((b, c) => (Math.hypot(c[0] - 17, c[1] - 17) < Math.hypot(b[0] - 17, b[1] - 17) ? c : b));
    this.spawn = { x: g.center(mid[0]), z: g.center(mid[1]), yaw: 0 };

    this.root.add(buildWorld(g, {
      wallH: 0, floorEverywhere: true, floorRepeat: 0.5,
      floorMat: new THREE.MeshLambertMaterial({ map: Tex.forest(), vertexColors: true }),
    }));
    this.root.add(new THREE.HemisphereLight(0x6f9fc8, 0x1a2a1c, 1.5));
    this.rig.add(new THREE.PointLight(0x9ab8c8, 5, 8, 1.4));

    this.buildTrees();

    // --- light zones
    const picks = pickSpread(g, mid, 26 + this.total, this.rng, 3);
    const f0 = g.flow(mid[0], mid[1]);
    const far = [...picks].sort((a, b) => f0[g.idx(b[0], b[1])] - f0[g.idx(a[0], a[1])]);
    const motherCells = new Set<Cell>();
    // spread the mother mushrooms: take every ~5th of the distance-sorted list
    for (let i = 0; i < this.total; i++) motherCells.add(far[Math.min(far.length - 1, i * 4)]);
    const small = picks.filter((c) => !motherCells.has(c));

    const stem = colored(new THREE.CylinderGeometry(0.035, 0.05, 0.3, 5), 0xbfdccf, 0.15);
    const cap = colored(new THREE.SphereGeometry(0.15, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0xffffff, 0.28);
    const shroomGeo = mergeGeometries([stem, cap])!;
    const per = 4;
    this.shrooms = new THREE.InstancedMesh(shroomGeo, new THREE.MeshBasicMaterial({ vertexColors: true }), small.length * per);
    this.discs = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 20),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }),
      small.length,
    );
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    small.forEach(([cx, cz], i) => {
      const x = g.center(cx), z = g.center(cz), r = 4.6;
      for (let k = 0; k < per; k++) {
        const a = this.rng() * 6.28, d = this.rng() * 0.6, s = 0.8 + this.rng() * 1.4;
        m.compose(pos.set(x + Math.cos(a) * d, 0, z + Math.sin(a) * d), q.identity(), sc.set(s, s, s));
        this.shrooms.setMatrixAt(i * per + k, m);
        this.shrooms.setColorAt(i * per + k, this.col.setRGB(0.25, 1, 0.72));
      }
      this.discs.setColorAt(i, this.col);
      m.compose(pos.set(x, 0.03, z), flat, sc.set(r, r, 1));
      this.discs.setMatrixAt(i, m);
      this.zones.push({
        x, z, r, phase: this.rng() * 17, on: 1, fixed: false,
        src: this.pool.add({ x, y: 0.8, z, color: 0x58ffc8, intensity: 9, dist: 9, on: 1 }),
      });
    });
    this.root.add(this.shrooms, this.discs);

    // --- clearing with a fire at the spawn: always safe
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 5), new THREE.MeshBasicMaterial({ color: 0xffa040, fog: false }));
    fire.position.set(this.spawn.x + 1.2, 0.35, this.spawn.z - 1.2);
    this.root.add(fire);
    this.fixedZone(fire.position.x, fire.position.z, 6.5, 0xff9a50, 14);

    // --- mother mushrooms
    const bigGeo = shroomGeo.clone();
    bigGeo.scale(6, 6, 6);
    for (const [cx, cz] of motherCells) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x3a2a55, vertexColors: true });
      const mesh = new THREE.Mesh(bigGeo, mat);
      mesh.position.set(g.center(cx), 0, g.center(cz));
      this.root.add(mesh);
      const mo = { mesh, mat, awake: false };
      this.mothers.push(mo);
      const it = this.addItem(mesh.position.x, mesh.position.z, 'Myzel erwecken', () => {
        it.active = false;
        mo.awake = true;
        mat.color.setHex(0x8affd8);
        this.fixedZone(mesh.position.x, mesh.position.z, 7.5, 0x70ffd0, 16);
        this.wake();
      }, 2.4);
    }

    // --- the Horned One
    const fig = makeFigure({ h: 2.7, color: 0x020403, eye: 0xff5020, horns: true });
    this.root.add(fig);
    const startS = far[1] ?? far[0];
    this.stalker = new Stalker(fig, g.center(startS[0]), g.center(startS[1]));
    this.flow = g.flow(mid[0], mid[1]);

    this.motes = makeMotes(Math.round(260 * this.tier.particles), 11, 0x9affd0, 0.07, 0.8);
    this.root.add(this.motes);
    this.g.objective('Erwecke das Myzel', `0/${this.total}`);
  }

  private fixedZone(x: number, z: number, r: number, color: number, intensity: number) {
    this.zones.push({ x, z, r, phase: 0, on: 1, fixed: true, src: this.pool.add({ x, y: 1.4, z, color, intensity, dist: r * 1.7, on: 1 }) });
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(r, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(x, 0.04, z);
    this.root.add(disc);
  }

  /** Trees in chunked LOD groups: detailed instanced mesh up close, 14-triangle impostor further out, nothing beyond the fog. */
  private buildTrees() {
    const g = this.grid, CH = 6;
    const hi = mergeGeometries([
      colored(new THREE.CylinderGeometry(0.2, 0.32, 3.4, 6), 0x4a3524, 1.7),
      colored(new THREE.ConeGeometry(1.7, 3.4, 7), 0x1c3a24, 4.4),
      colored(new THREE.ConeGeometry(1.25, 2.8, 7), 0x22452c, 6.2),
      colored(new THREE.ConeGeometry(0.8, 2.2, 6), 0x285034, 7.8),
    ])!;
    const lo = mergeGeometries([
      colored(new THREE.CylinderGeometry(0.22, 0.3, 3.4, 3), 0x4a3524, 1.7),
      colored(new THREE.ConeGeometry(1.6, 6, 4), 0x20402a, 6),
    ])!;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const far = (this.scene.fog as THREE.Fog).far;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (let z0 = 0; z0 < g.h; z0 += CH) {
      for (let x0 = 0; x0 < g.w; x0 += CH) {
        const ox = (x0 + CH / 2) * g.cell, oz = (z0 + CH / 2) * g.cell;
        const mats: THREE.Matrix4[] = [];
        for (let cz = z0; cz < Math.min(g.h, z0 + CH); cz++) {
          for (let cx = x0; cx < Math.min(g.w, x0 + CH); cx++) {
            if (g.get(cx, cz) !== WALL) continue;
            // skip trees deep inside the thicket – nobody can ever see them
            let edge = false;
            for (let a = -2; a <= 2 && !edge; a++) for (let b = -2; b <= 2; b++) if (g.open(cx + a, cz + b)) { edge = true; break; }
            if (!edge) continue;
            const n = this.rng() < 0.45 ? 2 : 1;
            for (let k = 0; k < n; k++) {
              const sc = 0.8 + this.rng() * 0.7;
              p.set(g.center(cx) + (this.rng() - 0.5) * g.cell * 0.55 - ox, 0, g.center(cz) + (this.rng() - 0.5) * g.cell * 0.55 - oz);
              q.setFromAxisAngle(up, this.rng() * 6.28);
              mats.push(new THREE.Matrix4().compose(p, q, s.set(sc, sc * (0.9 + this.rng() * 0.4), sc)));
            }
          }
        }
        if (!mats.length) continue;
        const mk = (geo: THREE.BufferGeometry) => {
          const im = new THREE.InstancedMesh(geo, mat, mats.length);
          mats.forEach((mm, i) => im.setMatrixAt(i, mm));
          return im;
        };
        const lod = new THREE.LOD();
        lod.position.set(ox, 0, oz);
        lod.addLevel(mk(hi), 0);
        lod.addLevel(mk(lo), 15);
        lod.addLevel(new THREE.Object3D(), far + CH * g.cell * 0.75);
        this.root.add(lod);
      }
    }
    void m;
  }

  private wake() {
    const g = this.g;
    this.awake++;
    g.audio.chime();
    g.flash(0.4);
    g.heal(0.25);
    g.buzz(40);
    if (this.awake >= this.total) {
      g.objective('Zurück zum Feuer');
      g.toast('Der Wald lässt dich gehen. Vielleicht.', 3500);
      this.portal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.9, 14, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }),
      );
      this.portal.position.set(this.spawn.x, 7, this.spawn.z);
      this.root.add(this.portal);
      this.addItem(this.spawn.x, this.spawn.z, 'Aufwachen', () => g.win(), 2.6);
    } else {
      g.objective('Erwecke das Myzel', `${this.awake}/${this.total}`);
    }
  }

  protected tick(dt: number) {
    const g = this.g, p = g.player, grid = this.grid, fx = g.fx;

    // pulsing mushroom rings: 9s lit, 2s fading, 4.5s dark, 1.5s returning
    let lit = false, si = 0;
    for (const zn of this.zones) {
      if (!zn.fixed) {
        const t = (this.time + zn.phase) % 17;
        zn.on = t < 9 ? 1 : t < 11 ? 1 - (t - 9) / 2 : t < 15.5 ? 0 : (t - 15.5) / 1.5;
        zn.src.on = zn.on;
        const flick = zn.on * (0.85 + 0.15 * Math.sin(this.time * 3 + zn.phase));
        this.col.setRGB(0.25 * flick, flick, 0.72 * flick);
        for (let k = 0; k < 4; k++) this.shrooms.setColorAt(si * 4 + k, this.col);
        this.discs.setColorAt(si, this.col);
        si++;
      }
      if (zn.on > 0.35 && Math.hypot(zn.x - p.x, zn.z - p.z) < zn.r) lit = true;
    }
    this.shrooms.instanceColor!.needsUpdate = true;
    this.discs.instanceColor!.needsUpdate = true;
    for (const mo of this.mothers) mo.mesh.scale.y = 1 + Math.sin(this.time * 1.4 + mo.mesh.position.x) * (mo.awake ? 0.05 : 0.02);
    if (this.portal) this.portal.rotation.y += dt;

    this.darkT = lit ? Math.max(0, this.darkT - dt * 2) : this.darkT + dt;
    if (lit) g.heal(dt * 0.07);
    else g.hurt(dt * (0.03 + Math.min(0.03, this.darkT * 0.004)));
    g.status(lit ? null : 'DUNKELHEIT');

    const ci = grid.idx(grid.toCell(p.x), grid.toCell(p.z));
    if (ci !== this.lastCell && grid.open(grid.toCell(p.x), grid.toCell(p.z))) { this.lastCell = ci; grid.flow(grid.toCell(p.x), grid.toCell(p.z), this.flow); }

    const s = this.stalker, d = s.dist(p.x, p.z);
    if (!lit && this.darkT > 0.7) {
      s.follow(grid, this.flow, dt, 3.0 + this.awake * 0.22, p.x, p.z);
      this.idle = 0;
    } else {
      s.vx = s.vz = 0;
      this.idle += dt;
      // lurk: after a while reappear somewhere unseen, closer
      if (this.idle > 12) {
        this.idle = 0;
        const opts = grid.openCells().filter(([x, z]) => {
          const dd = Math.hypot(grid.center(x) - p.x, grid.center(z) - p.z);
          return dd > 13 && dd < 20 && !this.inView(grid.center(x), grid.center(z));
        });
        if (opts.length) { const c = opts[(this.rng() * opts.length) | 0]; s.x = grid.center(c[0]); s.z = grid.center(c[1]); }
      }
    }
    s.sync(p.x, p.z);
    if (d < 1.05 && !lit) { g.caught(s.x, s.z, 'Der Wald hat dich behalten.'); return; }
    g.audio.threat(Math.max(0, 1 - d / 16), this.panOf(s.x, s.z));

    this.motes.position.set(p.x, 0, p.z);
    this.motes.rotation.y += dt * 0.03;
    const dk = Math.min(1, this.darkT / 6);
    fx.wobble = 0.5 + dk * 1.1;
    fx.swirl = 0.5 + dk * 0.8;
    fx.sat = 1.25;
    fx.chroma = 0.3 + dk * 0.5;
    fx.tint.setRGB(0.75, 1, 0.9);
    fx.tintAmt = 0.35;
    fx.vig = 0.9 + dk * 0.5;
    fx.hue = Math.sin(this.time * 0.2) * 0.25;
  }
}
