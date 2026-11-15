// Procedural low-poly creatures and the shared pursuer logic.
import * as THREE from 'three';
import type { Grid } from './grid';

export interface FigureOpts {
  h?: number; color?: number; eye?: number; hat?: boolean; smile?: boolean; horns?: boolean; faceless?: boolean; shadows?: boolean;
}

/** Tall, thin humanoid silhouette. Front faces +Z. ~9 tiny meshes sharing 2 materials. */
export function makeFigure(o: FigureOpts = {}): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: o.color ?? 0x050505 });
  const glow = new THREE.MeshBasicMaterial({ color: o.eye ?? 0xffffff, fog: false });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.z = rz;
    m.castShadow = !!o.shadows;
    g.add(m);
    return m;
  };
  const leg = new THREE.CylinderGeometry(0.06, 0.05, 0.95, 5);
  add(leg, body, -0.1, 0.475, 0);
  add(leg, body, 0.1, 0.475, 0);
  add(new THREE.CylinderGeometry(0.21, 0.13, 0.75, 6), body, 0, 1.3, 0);
  const arm = new THREE.CylinderGeometry(0.04, 0.03, 1.05, 5);
  add(arm, body, -0.27, 1.12, 0, -0.1);
  add(arm, body, 0.27, 1.12, 0, 0.1);
  const head = add(new THREE.SphereGeometry(0.16, 8, 6), body, 0, 1.88, 0);
  head.scale.y = 1.25;
  if (!o.faceless) {
    const eye = new THREE.SphereGeometry(0.022, 5, 4);
    add(eye, glow, -0.06, 1.92, 0.145);
    add(eye, glow, 0.06, 1.92, 0.145);
  }
  if (o.smile) {
    const s = add(new THREE.TorusGeometry(0.085, 0.012, 4, 10, Math.PI), glow, 0, 1.86, 0.14, Math.PI);
    s.scale.y = 0.8;
  }
  if (o.hat) {
    add(new THREE.CylinderGeometry(0.15, 0.17, 0.24, 8), body, 0, 2.16, 0);
    add(new THREE.CylinderGeometry(0.33, 0.33, 0.025, 10), body, 0, 2.05, 0);
  }
  if (o.horns) {
    const horn = new THREE.ConeGeometry(0.03, 0.6, 4);
    for (const sx of [-1, 1]) {
      add(horn, body, sx * 0.16, 2.3, 0, -sx * 0.5);
      add(horn, body, sx * 0.34, 2.45, 0, -sx * 1.0).scale.setScalar(0.7);
      add(horn, body, sx * 0.24, 2.62, 0, -sx * 0.15).scale.setScalar(0.8);
    }
  }
  // cheap blob shadow instead of a real shadow-casting light
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 12),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  g.add(blob);
  g.scale.setScalar((o.h ?? 2.1) / 2.1);
  return g;
}

/** Abstract geometric "machine" for the DMT level. */
export function makeWatcher(color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, wireframe: true, fog: false });
  const core = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const a = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), mat);
  const b = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.03, 4, 16), mat);
  const c = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.03, 4, 16), mat);
  const e = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), core);
  c.rotation.x = Math.PI / 2;
  g.add(a, b, c, e);
  g.userData.spin = [a, b, c];
  return g;
}

export class Stalker {
  active = true;
  vx = 0;
  vz = 0;
  constructor(public mesh: THREE.Object3D, public x: number, public z: number) {
    mesh.position.set(x, 0, z);
  }

  dist(px: number, pz: number) { return Math.hypot(px - this.x, pz - this.z); }

  /** Follow a BFS flow field downhill; walk straight at (tx,tz) once in the target's cell. */
  follow(grid: Grid, flow: Int16Array, dt: number, speed: number, tx: number, tz: number) {
    const cx = grid.toCell(this.x), cz = grid.toCell(this.z);
    const here = grid.inside(cx, cz) ? flow[grid.idx(cx, cz)] : -1;
    let gx = tx, gz = tz;
    if (here > 0) {
      let best = here;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, nz = cz + dz;
        if (!grid.inside(nx, nz)) continue;
        const f = flow[grid.idx(nx, nz)];
        if (f >= 0 && f < best) { best = f; gx = grid.center(nx); gz = grid.center(nz); }
      }
      if (best === 0) { gx = tx; gz = tz; }
    } else if (here < 0) return;
    this.toward(gx, gz, dt, speed);
  }

  toward(gx: number, gz: number, dt: number, speed: number) {
    const dx = gx - this.x, dz = gz - this.z, d = Math.hypot(dx, dz);
    if (d < 0.02) return;
    const k = Math.min(1, dt * 8);
    this.vx += ((dx / d) * speed - this.vx) * k;
    this.vz += ((dz / d) * speed - this.vz) * k;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
  }

  sync(px: number, pz: number, y = 0) {
    this.mesh.position.set(this.x, y, this.z);
    this.mesh.rotation.y = Math.atan2(px - this.x, pz - this.z);
  }
}
