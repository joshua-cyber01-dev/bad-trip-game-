// World construction: procedural textures, chunked level geometry, light pooling.
import * as THREE from 'three';
import { Grid, OPEN, VOID, mulberry32, type RNG } from './grid';

// ---------------------------------------------------------------- textures
// Small (<=256px) canvas textures generated at load time: no downloads, tiny GPU footprint.
type Draw = (c: CanvasRenderingContext2D, s: number, r: RNG) => void;

export function tex(size: number, draw: Draw, seed = 1): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  draw(c, size, mulberry32(seed));
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  return t;
}

function speckle(c: CanvasRenderingContext2D, s: number, r: RNG, n: number, cols: string[], max = 3, alpha = 0.5) {
  c.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    c.fillStyle = cols[(r() * cols.length) | 0];
    const w = 1 + r() * max;
    c.fillRect(r() * s, r() * s, w, 1 + r() * max);
  }
  c.globalAlpha = 1;
}

function blotch(c: CanvasRenderingContext2D, s: number, r: RNG, n: number, col: string, rad: number) {
  for (let i = 0; i < n; i++) {
    const x = r() * s, y = r() * s, R = rad * (0.4 + r());
    const g = c.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - R, y - R, R * 2, R * 2);
  }
}

export const Tex = {
  wallpaper: () => tex(256, (c, s, r) => {
    c.fillStyle = '#8a3f6a'; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#7a3460' : '#96487a'; c.fillRect(i * s / 8, 0, s / 8, s); }
    c.strokeStyle = '#e8c05a'; c.lineWidth = 2;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const px = (x + 0.5 + (y % 2) * 0.5) * s / 4, py = (y + 0.5) * s / 4;
      c.beginPath(); c.ellipse(px % s, py, 16, 24, 0, 0, 7); c.stroke();
      c.beginPath(); c.ellipse(px % s, py, 6, 10, 0, 0, 7); c.stroke();
      c.fillStyle = '#2a0f24'; c.beginPath(); c.arc(px % s, py, 3, 0, 7); c.fill();
    }
    c.fillStyle = '#3a1830'; c.fillRect(0, s - 26, s, 26);
    c.fillStyle = '#e8c05a'; c.fillRect(0, s - 28, s, 3);
    speckle(c, s, r, 500, ['#5a2548', '#a85a8c'], 2, 0.25);
  }),
  carpet: () => tex(128, (c, s, r) => {
    c.fillStyle = '#4a1c3e'; c.fillRect(0, 0, s, s);
    c.strokeStyle = '#c0842f'; c.lineWidth = 3;
    for (let i = -1; i < 3; i++) { c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64 + 64, 64); c.lineTo(i * 64, 128); c.stroke(); }
    c.fillStyle = '#1f6a6a';
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { c.beginPath(); c.arc(x * 64 + 32, y * 64 + 32, 9, 0, 7); c.fill(); }
    speckle(c, s, r, 900, ['#2e1026', '#6a2c58'], 2, 0.35);
  }),
  ceiling: () => tex(64, (c, s, r) => {
    c.fillStyle = '#cfc4b4'; c.fillRect(0, 0, s, s);
    speckle(c, s, r, 300, ['#b5a998', '#e2d9cb'], 2, 0.5);
  }),
  forest: () => tex(256, (c, s, r) => {
    c.fillStyle = '#34432a'; c.fillRect(0, 0, s, s);
    blotch(c, s, r, 14, 'rgba(14,20,12,0.7)', 50);
    blotch(c, s, r, 8, 'rgba(52,70,36,0.5)', 40);
    speckle(c, s, r, 2600, ['#44562e', '#57432a', '#1c2416', '#62743c'], 4, 0.6);
    speckle(c, s, r, 80, ['#7a6a3a', '#5c7a3c'], 3, 0.6);
  }),
  tile: () => tex(128, (c, s, r) => {
    c.fillStyle = '#b4c4be'; c.fillRect(0, 0, s, s);
    blotch(c, s, r, 5, 'rgba(90,110,100,0.35)', 40);
    c.strokeStyle = '#66756f'; c.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * 32, 0); c.lineTo(i * 32, s); c.moveTo(0, i * 32); c.lineTo(s, i * 32); c.stroke(); }
    speckle(c, s, r, 200, ['#8fa19a', '#d2dedb'], 2, 0.4);
  }),
  glyph: (seed: number) => tex(256, (c, s, r) => {
    c.fillStyle = '#12052a'; c.fillRect(0, 0, s, s);
    const cols = ['#00f0ff', '#ff2bd6', '#ffe14a', '#6dff6a', '#ff5a2b'];
    c.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      c.strokeStyle = cols[(r() * cols.length) | 0];
      c.globalAlpha = 0.5 + r() * 0.5;
      const x = ((r() * 8) | 0) * 32, y = ((r() * 8) | 0) * 32, k = (r() * 4) | 0;
      c.beginPath();
      if (k === 0) { c.moveTo(x, y + 32); c.lineTo(x + 16, y); c.lineTo(x + 32, y + 32); c.closePath(); }
      else if (k === 1) c.arc(x + 16, y + 16, 12, 0, 7);
      else if (k === 2) c.rect(x + 4, y + 4, 24, 24);
      else { c.moveTo(x, y); c.lineTo(x + 32, y + 32); c.moveTo(x + 32, y); c.lineTo(x, y + 32); }
      c.stroke();
    }
    c.globalAlpha = 0.35; c.strokeStyle = '#7a3cff'; c.lineWidth = 1;
    for (let i = 0; i <= 8; i++) { c.beginPath(); c.moveTo(i * 32, 0); c.lineTo(i * 32, s); c.moveTo(0, i * 32); c.lineTo(s, i * 32); c.stroke(); }
    c.globalAlpha = 1;
  }, seed),
  plaster: () => tex(256, (c, s, r) => {
    c.fillStyle = '#8a8272'; c.fillRect(0, 0, s, s);
    blotch(c, s, r, 12, 'rgba(50,44,34,0.5)', 60);
    blotch(c, s, r, 5, 'rgba(30,40,20,0.35)', 40);
    speckle(c, s, r, 900, ['#6f6859', '#9c9484'], 3, 0.35);
    c.fillStyle = '#4a3a2a'; c.fillRect(0, s * 0.68, s, s * 0.32);
    c.fillStyle = '#2c2218'; c.fillRect(0, s * 0.68, s, 4);
    for (let i = 0; i < 4; i++) c.fillRect(i * 64, s * 0.68, 2, s * 0.32);
    c.strokeStyle = 'rgba(20,15,10,0.5)'; c.lineWidth = 1;
    for (let i = 0; i < 5; i++) { c.beginPath(); let x = r() * s, y = 0; c.moveTo(x, y); while (y < s * 0.6) { x += (r() - 0.5) * 14; y += 6 + r() * 10; c.lineTo(x, y); } c.stroke(); }
  }),
  wood: () => tex(128, (c, s, r) => {
    for (let i = 0; i < 4; i++) { c.fillStyle = ['#5a4028', '#4c341f', '#63472d', '#523a24'][i]; c.fillRect(0, i * 32, s, 32); }
    c.fillStyle = '#1e140b';
    for (let i = 0; i < 4; i++) { c.fillRect(0, i * 32, s, 2); c.fillRect((r() * s) | 0, i * 32, 2, 32); }
    speckle(c, s, r, 500, ['#3c2a18', '#6e5236'], 6, 0.3);
  }),
};

// ---------------------------------------------------------------- geometry
class GeoB {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; idx: number[] = [];
  /** corners a,b,c,d (a→b = u axis, a→d = v axis); winding is fixed up to match the normal */
  quad(a: number[], b: number[], c: number[], d: number[], n: number[], u0: number, v0: number, u1: number, v1: number, shade: number) {
    const i = this.pos.length / 3;
    this.pos.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) { this.nor.push(n[0], n[1], n[2]); this.col.push(shade, shade, shade); }
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    else this.idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
  }
  mesh(mat: THREE.Material): THREE.Mesh | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    const m = new THREE.Mesh(g, mat);
    m.matrixAutoUpdate = false;
    return m;
  }
}

export interface WorldOpts {
  wallH: number;
  floorMat: THREE.Material;
  wallMat?: THREE.Material;
  ceilMat?: THREE.Material;
  /** cells per chunk edge – each chunk is frustum-culled as a unit */
  chunk?: number;
  /** draw ground under solid cells too (forest) */
  floorEverywhere?: boolean;
  /** platform edge height towards VOID cells */
  skirt?: number;
  shadows?: boolean;
  floorRepeat?: number;
}

/**
 * Turns the tile grid into a handful of merged, chunked meshes (hidden faces are never generated).
 * Result: ~3 draw calls per visible chunk instead of one per wall.
 */
export function buildWorld(g: Grid, o: WorldOpts): THREE.Group {
  const root = new THREE.Group();
  const C = o.chunk ?? 8, s = g.cell, H = o.wallH, fr = o.floorRepeat ?? 1;
  const r = mulberry32(g.w * 7919 + g.h);
  for (let z0 = 0; z0 < g.h; z0 += C) {
    for (let x0 = 0; x0 < g.w; x0 += C) {
      const walls = new GeoB(), floor = new GeoB(), ceil = new GeoB();
      for (let cz = z0; cz < Math.min(g.h, z0 + C); cz++) {
        for (let cx = x0; cx < Math.min(g.w, x0 + C); cx++) {
          const v = g.get(cx, cz);
          const xa = cx * s, xb = xa + s, za = cz * s, zb = za + s;
          if (v === OPEN || (o.floorEverywhere && v !== VOID)) {
            floor.quad([xa, 0, zb], [xb, 0, zb], [xb, 0, za], [xa, 0, za], [0, 1, 0], cx * fr, cz * fr, (cx + 1) * fr, (cz + 1) * fr, 0.86 + r() * 0.14);
          }
          if (v !== OPEN) continue;
          if (o.ceilMat) ceil.quad([xa, H, za], [xb, H, za], [xb, H, zb], [xa, H, zb], [0, -1, 0], cx, cz, cx + 1, cz + 1, 0.9 + r() * 0.1);
          const sides: [number, number, number[], number[], number[]][] = [
            [-1, 0, [xa, 0, zb], [xa, 0, za], [1, 0, 0]],
            [1, 0, [xb, 0, za], [xb, 0, zb], [-1, 0, 0]],
            [0, -1, [xa, 0, za], [xb, 0, za], [0, 0, 1]],
            [0, 1, [xb, 0, zb], [xa, 0, zb], [0, 0, -1]],
          ];
          for (const [dx, dz, a, b, n] of sides) {
            const nb = g.get(cx + dx, cz + dz);
            const sh = 0.88 + r() * 0.12;
            if (o.wallMat && g.solid(cx + dx, cz + dz)) {
              walls.quad(a, b, [b[0], H, b[2]], [a[0], H, a[2]], n, 0, 0, 1, 1, sh);
            } else if (o.skirt && (nb === VOID || !g.inside(cx + dx, cz + dz))) {
              floor.quad(b, a, [a[0], -o.skirt, a[2]], [b[0], -o.skirt, b[2]], [-n[0], 0, -n[2]], 0, 0, 1, o.skirt / s, 0.45);
            }
          }
        }
      }
      const wm = o.wallMat ? walls.mesh(o.wallMat) : null;
      const fm = floor.mesh(o.floorMat);
      const cm = o.ceilMat ? ceil.mesh(o.ceilMat) : null;
      if (wm) { wm.castShadow = !!o.shadows; wm.receiveShadow = !!o.shadows; root.add(wm); }
      if (fm) { fm.receiveShadow = !!o.shadows; root.add(fm); }
      if (cm) root.add(cm);
    }
  }
  return root;
}

// ---------------------------------------------------------------- lights
export interface LightSrc { x: number; y: number; z: number; color: number; intensity: number; dist: number; on: number }

/**
 * A fixed, tiny pool of real point lights that hop to the nearest light sources.
 * Lamps themselves are unlit emissive meshes, so a level can have dozens of "lights"
 * while the shaders only ever pay for `size` of them.
 */
export class LightPool {
  sources: LightSrc[] = [];
  private lights: THREE.PointLight[] = [];
  private assigned: (LightSrc | null)[] = [];
  private t = 0;
  constructor(parent: THREE.Object3D, size: number) {
    for (let i = 0; i < size; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 1.6);
      parent.add(l);
      this.lights.push(l);
      this.assigned.push(null);
    }
  }
  add(s: LightSrc) { this.sources.push(s); return s; }
  update(dt: number, px: number, pz: number) {
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.25;
      const near = this.sources
        .filter((s) => s.on > 0.01)
        .map((s) => ({ s, d: (s.x - px) ** 2 + (s.z - pz) ** 2 }))
        .sort((a, b) => a.d - b.d);
      // keep already-assigned sources on their light to avoid popping
      const want = near.slice(0, this.lights.length).map((n) => n.s);
      for (let i = 0; i < this.lights.length; i++) if (this.assigned[i] && !want.includes(this.assigned[i]!)) this.assigned[i] = null;
      for (const s of want) {
        if (this.assigned.includes(s)) continue;
        const free = this.assigned.indexOf(null);
        if (free >= 0) this.assigned[free] = s;
      }
    }
    for (let i = 0; i < this.lights.length; i++) {
      const s = this.assigned[i], l = this.lights[i];
      if (!s) { l.intensity += (0 - l.intensity) * Math.min(1, dt * 6); continue; }
      l.position.set(s.x, s.y, s.z);
      l.color.setHex(s.color);
      l.distance = s.dist;
      l.intensity += (s.intensity * s.on - l.intensity) * Math.min(1, dt * 6);
    }
  }
}

/** Ambient dust / spores: one draw call, follows the camera, animated on the GPU by slow rotation. */
export function makeMotes(count: number, radius: number, color: number, size: number, opacity = 0.7): THREE.Points {
  const p = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    p[i * 3] = (Math.random() * 2 - 1) * radius;
    p[i * 3 + 1] = Math.random() * 4.5 - 0.5;
    p[i * 3 + 2] = (Math.random() * 2 - 1) * radius;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.PointsMaterial({ color, size, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}
