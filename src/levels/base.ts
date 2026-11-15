// Shared level scaffolding + the context interface the game exposes to levels.
import * as THREE from 'three';
import type { Engine, Fx } from '../core/engine';
import type { Player } from '../core/player';
import type { AudioSys, AudioProfile } from '../core/audio';
import { Grid, mulberry32, type RNG } from '../world/grid';
import { LightPool } from '../world/build';

export interface Ctx {
  engine: Engine;
  player: Player;
  audio: AudioSys;
  fx: Fx;
  sanity: number;
  objective(text: string, count?: string): void;
  toast(text: string, ms?: number): void;
  timer(sec: number | null): void;
  status(text: string | null): void;
  win(): void;
  lose(reason: string): void;
  /** jump-scare death: camera snaps to (x,z) */
  caught(x: number, z: number, reason: string): void;
  hurt(amount: number): void;
  heal(amount: number): void;
  buzz(ms: number | number[]): void;
  flash(a: number): void;
}

export interface Interactable {
  x: number; z: number; r: number; label: string; active: boolean; use: () => void;
}

export interface LevelMeta {
  id: string;
  name: string;
  title: string;
  tagline: string;
  desc: string;
  hints: string[];
  tags: string[];
  color: string;
  color2: string;
  intensity: number;
  create: (g: Ctx) => Level;
}

export abstract class Level {
  root = new THREE.Group();
  /** lights etc. that ride on the camera */
  rig = new THREE.Group();
  grid!: Grid;
  time = 0;
  items: Interactable[] = [];
  current: Interactable | null = null;
  pool!: LightPool;
  rng: RNG;
  spawn = { x: 0, z: 0, yaw: 0 };
  abstract audio: AudioProfile;

  constructor(public g: Ctx, seed = (Math.random() * 1e9) | 0) {
    this.rng = mulberry32(seed);
  }

  abstract build(): void;
  protected abstract tick(dt: number): void;

  get scene() { return this.g.engine.scene; }
  get tier() { return this.g.engine.tier; }

  /** call at the start of build() */
  protected setup(fog: number, near: number, far: number, fov = 72) {
    const e = this.g.engine;
    e.scene.background = new THREE.Color(fog);
    e.scene.fog = new THREE.Fog(fog, near, far);
    e.camera.fov = fov;
    e.camera.far = far + 6;
    e.camera.updateProjectionMatrix();
    e.scene.add(this.root);
    e.camera.add(this.rig);
    this.pool = new LightPool(this.root, this.tier.lights);
  }

  addItem(x: number, z: number, label: string, use: () => void, r = 2.1): Interactable {
    const it = { x, z, r, label, active: true, use };
    this.items.push(it);
    return it;
  }

  update(dt: number) {
    this.time += dt;
    const p = this.g.player;
    let best: Interactable | null = null, bd = 1e9;
    for (const it of this.items) {
      if (!it.active) continue;
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      if (d < it.r && d < bd) { bd = d; best = it; }
    }
    this.current = best;
    this.pool.update(dt, p.x, p.z);
    this.tick(dt);
  }

  interact() { this.current?.use(); }

  /** Is world point (x,z) inside the camera's horizontal field of view with a clear line of sight? */
  inView(x: number, z: number, margin = 0.06): boolean {
    const p = this.g.player, cam = this.g.engine.camera;
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz) || 1;
    const dot = (dx / d) * p.fx + (dz / d) * p.fz;
    const half = Math.atan(Math.tan((cam.fov * Math.PI) / 360) * cam.aspect) + margin;
    return dot > Math.cos(Math.min(half, 1.5)) && this.grid.los(p.x, p.z, x, z);
  }

  /** stereo pan (-1..1) of a world point relative to the view direction */
  panOf(x: number, z: number): number {
    const p = this.g.player;
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz) || 1;
    return (dx / d) * Math.cos(p.yaw) + (dz / d) * -Math.sin(p.yaw);
  }

  dispose() {
    const e = this.g.engine;
    e.scene.remove(this.root);
    e.camera.remove(this.rig);
    e.scene.fog = null;
    const seen = new Set<THREE.Material>();
    const kill = (o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        if (seen.has(mat)) continue;
        seen.add(mat);
        for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
        mat.dispose();
      }
      (o as THREE.SpotLight).shadow?.dispose?.();
    };
    this.root.traverse(kill);
    this.rig.traverse(kill);
  }
}

/** small glowing pick-up: solid core + wire cage */
export function makeGlowItem(color: number, size = 0.2): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), new THREE.MeshBasicMaterial({ color, fog: false })));
  const cage = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(size * 2.6, size * 2.6, size * 2.6)),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 }),
  );
  g.add(cage);
  return g;
}
