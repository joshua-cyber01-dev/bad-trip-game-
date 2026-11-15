// Datura – "Delirium": a pitch-black house, a failing flashlight, things that are not there –
// and the Hat Man, who very much is. Crouch under tables to hide.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Level } from './base';
import { genMaze, pickSpread, type Cell } from '../world/grid';
import { buildWorld, makeMotes, Tex } from '../world/build';
import { makeFigure, Stalker } from '../world/entities';
import type { AudioProfile } from '../core/audio';

interface KeyObj { mesh: THREE.Group; fake: boolean; flickT: number }
interface Phantom { mesh: THREE.Group; seenT: number; life: number; cool: number }

export class DaturaLevel extends Level {
  audio: AudioProfile = {
    drone: [32.7, 34.6, 49], type: 'sawtooth', droneGain: 0.12, cutoff: 160, lfo: 0.09,
    noise: 0.03, noiseFreq: 2400, noiseQ: 6, events: ['whisper', 'knock', 'creak', 'whisper', 'drip'], every: [5, 13], step: 'wood',
  };
  private keys: KeyObj[] = [];
  private got = 0;
  private need = 3;
  private tables: { x: number; z: number }[] = [];
  private hat!: Stalker;
  private mode: 'patrol' | 'chase' | 'search' = 'patrol';
  private flowP!: Int16Array; // to player
  private flowT!: Int16Array; // to patrol/search target
  private target: Cell = [1, 1];
  private lastCell = -1;
  private lostT = 0;
  private lamp!: THREE.SpotLight;
  private lampBase = 24;
  private failT = 22;
  private fail = 0;
  private phantoms: Phantom[] = [];
  private door!: THREE.Mesh;
  private doorMat!: THREE.MeshBasicMaterial;
  private motes!: THREE.Points;
  private chaseStung = 0;

  build() {
    this.setup(0x020203, 1, 21, 70);
    const g = this.grid = genMaze(17, 17, 3, this.rng, { loops: 0.2, rooms: 5 });
    this.spawn = { x: g.center(1), z: g.center(1), yaw: g.open(1, 2) ? Math.PI : -Math.PI / 2 };
    const sh = this.tier.shadows;
    this.root.add(buildWorld(g, {
      wallH: 2.8, shadows: sh,
      wallMat: new THREE.MeshLambertMaterial({ map: Tex.plaster(), vertexColors: true }),
      floorMat: new THREE.MeshLambertMaterial({ map: Tex.wood(), vertexColors: true }),
      ceilMat: new THREE.MeshLambertMaterial({ map: Tex.ceiling(), color: 0x777777, vertexColors: true }),
      floorRepeat: 2,
    }));
    this.root.add(new THREE.HemisphereLight(0x394560, 0x100c08, 0.5));

    // flashlight: the only real light. It casts the game's single shadow map on the high tier.
    const lamp = this.lamp = new THREE.SpotLight(0xfff0d8, this.lampBase, 22, 0.55, 0.7, 1.25);
    lamp.position.set(0.22, -0.18, 0.1);
    lamp.target.position.set(0, -0.05, -4);
    if (sh) {
      lamp.castShadow = true;
      lamp.shadow.mapSize.set(512, 512);
      lamp.shadow.camera.near = 0.3;
      lamp.shadow.camera.far = 19;
      lamp.shadow.bias = -0.004;
    }
    this.rig.add(lamp, lamp.target);

    const picks = pickSpread(g, [1, 1], 13, this.rng, 5);
    const f0 = g.flow(1, 1);
    const byDist = [...picks].sort((a, b) => f0[g.idx(b[0], b[1])] - f0[g.idx(a[0], a[1])]);
    const exitCell = byDist[0], hatCell = byDist[1];
    const rest = picks.filter((c) => c !== exitCell && c !== hatCell);
    const keyCells = rest.slice(0, 6), extraTables = rest.slice(6);

    // tables (hiding spots) – one merged geometry, instanced
    const leg = (x: number, z: number) => new THREE.BoxGeometry(0.07, 0.95, 0.07).translate(x, 0.475, z);
    const tableGeo = mergeGeometries([new THREE.BoxGeometry(1.5, 0.07, 0.9).translate(0, 0.98, 0), leg(-0.68, -0.38), leg(0.68, -0.38), leg(-0.68, 0.38), leg(0.68, 0.38)])!;
    const all = [...keyCells, ...extraTables];
    const tables = new THREE.InstancedMesh(tableGeo, new THREE.MeshLambertMaterial({ color: 0x4a3524 }), all.length);
    tables.castShadow = sh;
    const m = new THREE.Matrix4();
    all.forEach(([cx, cz], i) => {
      const x = g.center(cx), z = g.center(cz);
      m.makeRotationY(this.rng() < 0.5 ? 0 : Math.PI / 2).setPosition(x, 0, z);
      tables.setMatrixAt(i, m);
      this.tables.push({ x, z });
    });
    this.root.add(tables);

    // keys – half of them are hallucinations (they flicker, real things don't)
    const keyMat = new THREE.MeshBasicMaterial({ color: 0xffd878 });
    const keyGeo = mergeGeometries([
      new THREE.TorusGeometry(0.07, 0.022, 5, 10).translate(0, 0.1, 0),
      new THREE.BoxGeometry(0.03, 0.2, 0.03).translate(0, -0.07, 0),
      new THREE.BoxGeometry(0.08, 0.03, 0.03).translate(0.04, -0.14, 0),
    ])!;
    const fakeIdx = new Set<number>();
    while (fakeIdx.size < keyCells.length - this.need) fakeIdx.add((this.rng() * keyCells.length) | 0);
    keyCells.forEach(([cx, cz], i) => {
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(keyGeo, keyMat));
      grp.position.set(g.center(cx), 1.3, g.center(cz));
      this.root.add(grp);
      const k: KeyObj = { mesh: grp, fake: fakeIdx.has(i), flickT: 1 + this.rng() * 2 };
      this.keys.push(k);
      const it = this.addItem(grp.position.x, grp.position.z, 'Schlüssel nehmen', () => {
        it.active = false;
        grp.visible = false;
        this.take(k);
      }, 1.9);
    });

    // exit door
    this.doorMat = new THREE.MeshBasicMaterial({ color: 0x2a1c12 });
    this.door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.3, 0.12), this.doorMat);
    this.door.position.set(g.center(exitCell[0]), 1.15, g.center(exitCell[1]));
    this.root.add(this.door);
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.3, 2.4, 0.16)), new THREE.LineBasicMaterial({ color: 0x8a1010 }));
    frame.position.copy(this.door.position);
    this.root.add(frame);
    this.addItem(this.door.position.x, this.door.position.z, 'Tür öffnen', () => {
      if (this.got >= this.need) this.g.win();
      else { this.g.toast(`Verschlossen. ${this.got}/${this.need} Schlüssel.`, 2200); this.g.audio.event('knock'); }
    }, 2.2);

    // Hat Man
    const fig = makeFigure({ h: 2.35, color: 0x000000, eye: 0xff1010, hat: true, shadows: sh });
    this.root.add(fig);
    this.hat = new Stalker(fig, g.center(hatCell[0]), g.center(hatCell[1]));
    this.flowP = g.flow(1, 1);
    this.flowT = g.flow(1, 1);
    this.newPatrol();

    // harmless shadow people
    for (let i = 0; i < 3; i++) {
      const mesh = makeFigure({ h: 1.9 + this.rng() * 0.5, color: 0x000000, faceless: i > 0, eye: 0xffffff });
      mesh.visible = false;
      this.root.add(mesh);
      this.phantoms.push({ mesh, seenT: 0, life: 0, cool: 6 + i * 9 });
    }

    this.motes = makeMotes(Math.round(120 * this.tier.particles), 6, 0xfff0d0, 0.025, 0.5);
    this.root.add(this.motes);
    this.g.objective('Finde 3 echte Schlüssel', `0/${this.need}`);
  }

  private newPatrol() {
    const cells = this.grid.openCells();
    this.target = cells[(this.rng() * cells.length) | 0];
    this.grid.flow(this.target[0], this.target[1], this.flowT);
  }

  private take(k: KeyObj) {
    const g = this.g, p = g.player;
    if (!k.fake) {
      this.got++;
      g.audio.chime();
      g.heal(0.1);
      g.buzz(40);
      if (this.got >= this.need) {
        this.doorMat.color.setHex(0xffe8c0);
        g.objective('Finde die rote Tür');
        g.toast('Drei Schlüssel. Irgendwo ist eine Tür.', 3200);
      } else g.objective('Finde 3 echte Schlüssel', `${this.got}/${this.need}`);
      return;
    }
    // it was never there
    g.hurt(0.13);
    g.flash(0.25);
    g.audio.whisper(0, 1.8, 0.45);
    g.audio.stinger(false);
    g.buzz([50, 30, 50]);
    g.toast('Deine Hand ist leer. Da war nie etwas.', 2600);
    this.fail = 1.2;
    // something stands right behind you now
    const ph = this.phantoms[0];
    const bx = p.x - p.fx * 2.4, bz = p.z - p.fz * 2.4;
    if (!this.grid.solid(this.grid.toCell(bx), this.grid.toCell(bz))) {
      ph.mesh.position.set(bx, 0, bz);
      ph.mesh.visible = true;
      ph.life = 7; ph.seenT = 0; ph.cool = 25;
    }
    // and the noise attracts the real one
    if (this.mode === 'patrol') {
      this.target = [this.grid.toCell(p.x), this.grid.toCell(p.z)];
      this.grid.flow(this.target[0], this.target[1], this.flowT);
      this.mode = 'search';
    }
  }

  protected tick(dt: number) {
    const g = this.g, p = g.player, grid = this.grid, fx = g.fx;
    const pcx = grid.toCell(p.x), pcz = grid.toCell(p.z), ci = grid.idx(pcx, pcz);
    if (ci !== this.lastCell) { this.lastCell = ci; grid.flow(pcx, pcz, this.flowP); }

    for (const k of this.keys) {
      k.mesh.rotation.y += dt * 1.5;
      if (!k.fake || !k.mesh.parent) continue;
      k.flickT -= dt;
      if (k.flickT <= 0) k.flickT = 1.2 + this.rng() * 2.4;
      k.mesh.scale.setScalar(k.flickT < 0.09 ? 0.001 : 1);
    }

    const hidden = p.crouched && this.tables.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < 1.35);

    // --- Hat Man
    const h = this.hat, d = h.dist(p.x, p.z);
    const sees = !(hidden && (this.mode !== 'chase' || d > 3.2)) && d < (p.crouched ? 6 : 14) && grid.los(h.x, h.z, p.x, p.z);
    if (sees) {
      if (this.mode !== 'chase') {
        this.mode = 'chase';
        if (this.time - this.chaseStung > 8) { g.audio.stinger(false); g.buzz(80); this.chaseStung = this.time; }
      }
      this.lostT = 0;
    }
    if (this.mode === 'chase') {
      h.follow(grid, this.flowP, dt, 3.5, p.x, p.z);
      this.lostT += sees ? 0 : dt;
      if (this.lostT > 3.5) {
        this.mode = 'search';
        this.target = [pcx, pcz];
        grid.flow(pcx, pcz, this.flowT);
      }
    } else {
      const tx = grid.center(this.target[0]), tz = grid.center(this.target[1]);
      h.follow(grid, this.flowT, dt, this.mode === 'search' ? 2.4 : 1.5, tx, tz);
      if (Math.hypot(tx - h.x, tz - h.z) < 0.6) { this.mode = 'patrol'; this.newPatrol(); }
    }
    h.sync(p.x, p.z);
    if (this.mode !== 'chase') h.mesh.rotation.y = Math.atan2(h.vx, h.vz);
    if (d < 1.0 && !(hidden && this.mode !== 'chase')) { g.caught(h.x, h.z, 'Er hat die ganze Zeit zugesehen.'); return; }
    if (d < 9 && grid.los(h.x, h.z, p.x, p.z)) g.hurt(dt * 0.05 * (1 - d / 9));
    else g.heal(dt * 0.01);
    g.audio.threat(Math.max(0, 1 - d / 15), this.panOf(h.x, h.z));
    g.status(hidden ? 'VERSTECKT' : this.mode === 'chase' ? 'ER SIEHT DICH' : null);

    // --- phantoms: shadow people that dissolve when you look at them
    for (const ph of this.phantoms) {
      if (!ph.mesh.visible) {
        ph.cool -= dt;
        if (ph.cool <= 0) {
          const opts = grid.openCells().filter(([x, z]) => {
            const dd = Math.hypot(grid.center(x) - p.x, grid.center(z) - p.z);
            return dd > 7 && dd < 15 && !this.inView(grid.center(x), grid.center(z));
          });
          ph.cool = 18 + this.rng() * 20;
          if (opts.length) {
            const c = opts[(this.rng() * opts.length) | 0];
            ph.mesh.position.set(grid.center(c[0]), 0, grid.center(c[1]));
            ph.mesh.visible = true;
            ph.life = 40; ph.seenT = 0;
          }
        }
        continue;
      }
      const px = ph.mesh.position.x, pz = ph.mesh.position.z, pd = Math.hypot(px - p.x, pz - p.z);
      ph.mesh.rotation.y = Math.atan2(p.x - px, p.z - pz);
      ph.life -= dt;
      if (pd < 10 && this.inView(px, pz, -0.25)) ph.seenT += dt;
      if (ph.seenT > 0.45 || ph.life <= 0 || pd < 1.6) {
        ph.mesh.visible = false;
        if (ph.life > 0) { g.audio.whisper(this.panOf(px, pz), 0.9, 0.3); g.hurt(0.03); }
      }
    }

    // --- flashlight: jitter, failures, panic near the Hat Man
    this.failT -= dt;
    if (this.failT <= 0) { this.failT = 20 + this.rng() * 22; this.fail = 1 + this.rng() * 1.3; }
    let k = 1;
    if (this.fail > 0) { this.fail -= dt; k = this.rng() < 0.55 ? 0.04 : 0.7; }
    else if (d < 7 && this.rng() < 0.12) k = 0.3;
    else if (this.rng() < 0.01) k = 0.6;
    this.lamp.intensity = this.lampBase * k * (0.5 + 0.5 * g.sanity);

    this.motes.position.set(p.x, 0, p.z);
    const fear = 1 - g.sanity;
    fx.sat = 0.55;
    fx.grain = 0.12 + fear * 0.1;
    fx.vig = 1.25;
    fx.wobble = 0.15 + fear * 0.9;
    fx.chroma = 0.25 + fear * 0.6 + (this.mode === 'chase' ? 0.5 : 0);
    fx.tint.setRGB(1.05, 0.95, 0.8);
    fx.tintAmt = 0.5;
    fx.dbl = fear > 0.5 ? (fear - 0.5) * 1.2 : 0;
  }
}
