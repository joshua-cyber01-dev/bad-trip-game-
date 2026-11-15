// Tile grid: collision, line of sight, flow-field path finding and generators.
export type RNG = () => number;

export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const OPEN = 0;
export const WALL = 1;
export const VOID = 2;

export type Cell = [number, number];
const DIRS: Cell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class Grid {
  data: Uint8Array;
  constructor(public w: number, public h: number, public cell: number) {
    this.data = new Uint8Array(w * h).fill(WALL);
  }
  idx(cx: number, cz: number) { return cz * this.w + cx; }
  inside(cx: number, cz: number) { return cx >= 0 && cz >= 0 && cx < this.w && cz < this.h; }
  get(cx: number, cz: number) { return this.inside(cx, cz) ? this.data[cz * this.w + cx] : WALL; }
  set(cx: number, cz: number, v: number) { if (this.inside(cx, cz)) this.data[cz * this.w + cx] = v; }
  open(cx: number, cz: number) { return this.inside(cx, cz) && this.data[cz * this.w + cx] === OPEN; }
  solid(cx: number, cz: number) { return !this.inside(cx, cz) || this.data[cz * this.w + cx] === WALL; }
  toCell(v: number) { return Math.floor(v / this.cell); }
  center(c: number) { return (c + 0.5) * this.cell; }

  /** Circle vs. solid cells. */
  collides(x: number, z: number, r: number): boolean {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (!this.solid(cx, cz)) continue;
        const nx = Math.max(cx * c, Math.min(x, (cx + 1) * c));
        const nz = Math.max(cz * c, Math.min(z, (cz + 1) * c));
        const dx = x - nx, dz = z - nz;
        if (dx * dx + dz * dz < r * r) return true;
      }
    }
    return false;
  }

  /** Line of sight between two world points (blocked by solid cells only). */
  los(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax, dz = bz - az;
    const d = Math.hypot(dx, dz);
    const n = Math.ceil(d / (this.cell * 0.2));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.solid(this.toCell(ax + dx * t), this.toCell(az + dz * t))) return false;
    }
    return true;
  }

  /** BFS distance field over OPEN cells towards a target cell (-1 = unreachable). */
  flow(tx: number, tz: number, out?: Int16Array): Int16Array {
    const f = out ?? new Int16Array(this.w * this.h);
    f.fill(-1);
    if (!this.open(tx, tz)) return f;
    const q = new Int32Array(this.w * this.h);
    let head = 0, tail = 0;
    q[tail++] = this.idx(tx, tz);
    f[this.idx(tx, tz)] = 0;
    while (head < tail) {
      const i = q[head++];
      const cx = i % this.w, cz = (i / this.w) | 0;
      for (const [dx, dz] of DIRS) {
        const nx = cx + dx, nz = cz + dz;
        if (!this.open(nx, nz)) continue;
        const ni = this.idx(nx, nz);
        if (f[ni] >= 0) continue;
        f[ni] = f[i] + 1;
        q[tail++] = ni;
      }
    }
    return f;
  }

  openCells(): Cell[] {
    const r: Cell[] = [];
    for (let z = 0; z < this.h; z++) for (let x = 0; x < this.w; x++) if (this.data[z * this.w + x] === OPEN) r.push([x, z]);
    return r;
  }
}

/** Perfect maze (odd dimensions) with optional loops and rooms. */
export function genMaze(w: number, h: number, cell: number, rng: RNG, o: { loops?: number; rooms?: number } = {}): Grid {
  const g = new Grid(w, h, cell);
  const stack: Cell[] = [[1, 1]];
  g.set(1, 1, OPEN);
  while (stack.length) {
    const [cx, cz] = stack[stack.length - 1];
    const opts: Cell[] = [];
    for (const [dx, dz] of DIRS) {
      const nx = cx + dx * 2, nz = cz + dz * 2;
      if (nx > 0 && nz > 0 && nx < w - 1 && nz < h - 1 && g.get(nx, nz) === WALL) opts.push([dx, dz]);
    }
    if (!opts.length) { stack.pop(); continue; }
    const [dx, dz] = opts[(rng() * opts.length) | 0];
    g.set(cx + dx, cz + dz, OPEN);
    g.set(cx + dx * 2, cz + dz * 2, OPEN);
    stack.push([cx + dx * 2, cz + dz * 2]);
  }
  for (let i = 0; i < (o.rooms ?? 0); i++) {
    const rw = rng() < 0.5 ? 3 : 5, rh = rng() < 0.5 ? 3 : 5;
    const rx = 1 + 2 * ((rng() * ((w - rw - 1) / 2)) | 0);
    const rz = 1 + 2 * ((rng() * ((h - rh - 1) / 2)) | 0);
    for (let z = rz; z < rz + rh; z++) for (let x = rx; x < rx + rw; x++) g.set(x, z, OPEN);
  }
  const loops = o.loops ?? 0;
  for (let z = 1; z < h - 1; z++) {
    for (let x = 1; x < w - 1; x++) {
      if (g.get(x, z) !== WALL || rng() > loops) continue;
      const hor = g.open(x - 1, z) && g.open(x + 1, z) && !g.open(x, z - 1) && !g.open(x, z + 1);
      const ver = g.open(x, z - 1) && g.open(x, z + 1) && !g.open(x - 1, z) && !g.open(x + 1, z);
      if (hor || ver) g.set(x, z, OPEN);
    }
  }
  return g;
}

/** Organic cave / forest-path layout via cellular automata; keeps the largest region. */
export function genCave(w: number, h: number, cell: number, rng: RNG): Grid {
  const g = new Grid(w, h, cell);
  let d = g.data;
  for (let z = 1; z < h - 1; z++) for (let x = 1; x < w - 1; x++) d[z * w + x] = rng() < 0.42 ? WALL : OPEN;
  for (let it = 0; it < 4; it++) {
    const n = new Uint8Array(d);
    for (let z = 1; z < h - 1; z++) {
      for (let x = 1; x < w - 1; x++) {
        let c = 0;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if ((a || b) && d[(z + a) * w + x + b] === WALL) c++;
        n[z * w + x] = c >= 5 ? WALL : c <= 3 ? OPEN : d[z * w + x];
      }
    }
    d = n;
  }
  g.data = d;
  // keep largest connected region
  const seen = new Int32Array(w * h).fill(-1);
  let best = -1, bestN = 0, id = 0;
  for (let i = 0; i < w * h; i++) {
    if (d[i] !== OPEN || seen[i] >= 0) continue;
    let n = 0;
    const st = [i];
    seen[i] = id;
    while (st.length) {
      const k = st.pop()!;
      n++;
      const cx = k % w, cz = (k / w) | 0;
      for (const [dx, dz] of DIRS) {
        const ni = (cz + dz) * w + cx + dx;
        if (g.open(cx + dx, cz + dz) && seen[ni] < 0) { seen[ni] = id; st.push(ni); }
      }
    }
    if (n > bestN) { bestN = n; best = id; }
    id++;
  }
  for (let i = 0; i < w * h; i++) if (d[i] === OPEN && seen[i] !== best) d[i] = WALL;
  return g;
}

/** Farthest-point sampling of open cells – spreads objectives evenly over the map. */
export function pickSpread(g: Grid, from: Cell, n: number, rng: RNG, minSteps = 4, avoid: Cell[] = []): Cell[] {
  const f = g.flow(from[0], from[1]);
  const cands = g.openCells().filter(([x, z]) => f[g.idx(x, z)] >= minSteps);
  const chosen: Cell[] = [from, ...avoid];
  const out: Cell[] = [];
  for (let i = 0; i < n && cands.length; i++) {
    let bi = 0, bs = -1;
    for (let k = 0; k < cands.length; k++) {
      let m = 1e9;
      for (const c of chosen) m = Math.min(m, Math.abs(c[0] - cands[k][0]) + Math.abs(c[1] - cands[k][1]));
      const s = m + rng() * 2;
      if (s > bs) { bs = s; bi = k; }
    }
    out.push(cands[bi]);
    chosen.push(cands[bi]);
    cands.splice(bi, 1);
  }
  return out;
}
