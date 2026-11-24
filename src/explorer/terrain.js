// Elevation survey, projection and route geometry for the explorer.
// World units are kilometres: +x east, +z south, +y up.
import { BufferAttribute, BufferGeometry } from "three";
import { gunzipSync } from "three/addons/libs/fflate.module.js";
import packedUrl from "../terrain/heights.gz?inline";
import grid from "../terrain/grid.json";
import route from "../terrain/route.json";
import osm from "../terrain/trail-osm.json";

const last = grid.segments.at(-1);
const size = last + 1;
export const origin = [83.862, 28.47];
const kx = 111.195 * Math.cos((origin[1] * Math.PI) / 180);
const kz = 111.195;

let heights;
function survey() {
  if (heights) return heights;
  const b64 = packedUrl.slice(packedUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const raw = gunzipSync(bytes);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  heights = new Float32Array(size * size);
  for (let r = 0; r < size; r++) {
    let h = 0;
    for (let c = 0; c < size; c++) {
      const i = r * size + c;
      h += dv.getInt16(i * 2, true);
      heights[i] = h / 1000;
    }
  }
  return heights;
}

function piecewise(value, from, to) {
  const asc = from[0] < from[3];
  const within = (i) => (asc ? value <= from[i] : value >= from[i]);
  const k = within(1) ? 0 : within(2) ? 1 : 2;
  const f = Math.max(0, Math.min(1, (value - from[k]) / (from[k + 1] - from[k])));
  return to[k] + f * (to[k + 1] - to[k]);
}

export const toLonLat = (x, z) => [origin[0] + x / kx, origin[1] - z / kz];
export const toXZ = ([lon, lat]) => [(lon - origin[0]) * kx, (origin[1] - lat) * kz];

export { survey };
export const bounds = (() => {
  const [x0] = toXZ([grid.longitude[0], 0]);
  const [x1] = toXZ([grid.longitude[3], 0]);
  const [, z0] = toXZ([0, grid.latitude[0]]);
  const [, z1] = toXZ([0, grid.latitude[3]]);
  return { x0, x1, z0, z1 };
})();

// Texture coordinates, 0..1 with v=0 at the north edge (image top).
export function imageUV(x, z) {
  const [lon, lat] = toLonLat(x, z);
  return [
    (lon - grid.longitude[0]) / (grid.longitude[3] - grid.longitude[0]),
    (grid.latitude[0] - lat) / (grid.latitude[0] - grid.latitude[3]),
  ];
}

let meshStep = 1;
// Catmull-Rom weights, for a smooth surface instead of 50 m facets.
function cr(p0, p1, p2, p3, t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}
// Elevation (km) at (x, z), smooth across the whole survey.
function rawGround(x, z) {
  const h = survey();
  const [lon, lat] = toLonLat(x, z);
  const u = piecewise(lon, grid.longitude, grid.segments);
  const v = piecewise(lat, grid.latitude, grid.segments);
  const i = Math.min(last - 1, Math.max(0, Math.floor(u)));
  const j = Math.min(last - 1, Math.max(0, Math.floor(v)));
  const tx = Math.min(1, Math.max(0, u - i));
  const ty = Math.min(1, Math.max(0, v - j));
  const at = (c, r) => h[Math.min(last, Math.max(0, r)) * size + Math.min(last, Math.max(0, c))];
  const row = (r) => cr(at(i - 1, r), at(i, r), at(i + 1, r), at(i + 2, r), tx);
  return cr(row(j - 1), row(j), row(j + 1), row(j + 2), ty);
}

export function terrainGeometry(step) {
  meshStep = step;
  const h = survey();
  const n = last / step;
  const verts = (n + 1) * (n + 1);
  const pos = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  for (let r = 0; r <= n; r++) {
    const lat = piecewise(r * step, grid.segments, grid.latitude);
    const z = (origin[1] - lat) * kz;
    const vv = (lat - grid.latitude[3]) / (grid.latitude[0] - grid.latitude[3]);
    for (let c = 0; c <= n; c++) {
      const lon = piecewise(c * step, grid.segments, grid.longitude);
      const k = r * (n + 1) + c;
      pos[k * 3] = (lon - origin[0]) * kx;
      pos[k * 3 + 1] = h[r * step * size + c * step];
      pos[k * 3 + 2] = z;
      uv[k * 2] = (lon - grid.longitude[0]) / (grid.longitude[3] - grid.longitude[0]);
      uv[k * 2 + 1] = vv;
    }
  }
  const index = new Uint32Array(n * n * 6);
  let p = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const a = r * (n + 1) + c, b = a + n + 1, cc = b + 1, d = a + 1;
      index[p++] = a; index[p++] = b; index[p++] = d;
      index[p++] = b; index[p++] = cc; index[p++] = d;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("uv", new BufferAttribute(uv, 2));
  g.setIndex(new BufferAttribute(index, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// The walked line, resampled every ~20 m with distance along the trail.
// ----- the trail's bench -----
// The survey (about 50 m between samples) cannot hold a path cut into a hillside, so the
// ground is carved along the mapped line: a level shelf about 2.6 m wide that blends back
// into the natural slope within 7 m. Everything that stands on the ground uses this.
const BENCH_IN = 0.0013, BENCH_OUT = 0.007, CELL = 0.01;
let bench = null;
function buildBench() {
  const P = osm.track.map(toXZ);
  const bx = [], bz = [], bh = [];
  for (let i = 0; i < P.length - 1; i++) {
    const [x0, z0] = P[i], [x1, z1] = P[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.001));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      bx.push(x0 + (x1 - x0) * t);
      bz.push(z0 + (z1 - z0) * t);
    }
  }
  bx.push(P.at(-1)[0]); bz.push(P.at(-1)[1]);
  const raw = bx.map((x, i) => rawGround(x, bz[i]));
  // Smooth the shelf's height along the path (about 16 m at 1 m spacing), so it climbs
  // evenly without following every 50 m survey step of the raw elevation model.
  for (let i = 0; i < raw.length; i++) {
    let sum = 0, n = 0;
    for (let k = -8; k <= 8; k++) { const j = i + k; if (j >= 0 && j < raw.length) { sum += raw[j]; n++; } }
    bh.push(sum / n);
  }
  const cells = new Map();
  for (let i = 0; i < bx.length - 1; i++) {
    const k = Math.floor(bx[i] / CELL) * 65536 + Math.floor(bz[i] / CELL);
    let a = cells.get(k);
    if (!a) cells.set(k, (a = []));
    a.push(i);
  }
  bench = { bx: Float64Array.from(bx), bz: Float64Array.from(bz), bh: Float64Array.from(bh), cells };
}
// Distance to the mapped line and the shelf height there (or null when far from it).
export function benchAt(x, z) {
  if (!bench) buildBench();
  const { bx, bz, bh, cells } = bench;
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  let best = BENCH_OUT * BENCH_OUT, h = 0, found = false;
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++) {
      const list = cells.get((cx + a) * 65536 + (cz + b));
      if (!list) continue;
      for (const i of list) {
        const ax = bx[i], az = bz[i], ex = bx[i + 1] - ax, ez = bz[i + 1] - az;
        const L = ex * ex + ez * ez || 1e-12;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L));
        const dx = ax + ex * t - x, dz = az + ez * t - z;
        const d = dx * dx + dz * dz;
        if (d < best) { best = d; h = bh[i] + (bh[i + 1] - bh[i]) * t; found = true; }
      }
    }
  return found ? { d: Math.sqrt(best), h } : null;
}
export function ground(x, z) {
  const g = rawGround(x, z);
  const b = benchAt(x, z);
  if (!b) return g;
  const t = Math.min(1, Math.max(0, (BENCH_OUT - b.d) / (BENCH_OUT - BENCH_IN)));
  const w = t * t * (3 - 2 * t);
  return g + (b.h - g) * w;
}

// The trail as mapped in OpenStreetMap (traced over aerial imagery), unsmoothed.
export const trailLine = osm.track.map(toXZ);
export const trailSteps = osm.steps;

// The walked line, resampled every ~20 m with distance along the trail.
export function trailSamples() {
  const pts = trailLine;
  const out = [];
  let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    if (i > 0) {
      const [px, pz] = pts[i - 1];
      const seg = Math.hypot(x - px, z - pz);
      const steps = Math.max(1, Math.ceil(seg / 0.02));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const sx = px + (x - px) * t, sz = pz + (z - pz) * t;
        dist += seg / steps;
        out.push({ x: sx, z: sz, d: dist, y: ground(sx, sz) });
      }
    } else out.push({ x, z, d: 0, y: ground(x, z) });
  }
  return out;
}

// A dense, smoothly curved copy of the trail every ~0.5 m, for the 3D path and the walker:
// Catmull-Rom through the mapped points, so corners round off without leaving the line.
export function densePath(step = 0.0005) {
  const P = trailLine;
  const xs = [], zs = [], ds = [], st = [];
  let d = 0, px = P[0][0], pz = P[0][1];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = i ? 1 : 0; k <= n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, e) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - e) * t2 + (-a + 3 * b - 3 * c + e) * t3);
      const x = f(p0[0], p1[0], p2[0], p3[0]), z = f(p0[1], p1[1], p2[1], p3[1]);
      d += Math.hypot(x - px, z - pz);
      px = x; pz = z;
      xs.push(x); zs.push(z); ds.push(d); st.push(trailSteps[i + 1] || 0);
    }
  }
  return { x: Float32Array.from(xs), z: Float32Array.from(zs), d: Float64Array.from(ds), steps: Uint8Array.from(st), count: xs.length };
}

export const stopXZ = () => route.stops.map(toXZ);

// Summits, positioned on the survey's local high point.
export const peaks = [
  { name: "Annapurna I", height: 8091, at: [83.8273, 28.5958] },
  { name: "Annapurna South", height: 7219, at: [83.8064, 28.518] },
  { name: "Machhapuchhre", height: 6993, at: [83.9454, 28.498] },
  { name: "Gangapurna", height: 7455, at: [83.964, 28.6056] },
  { name: "Annapurna III", height: 7555, at: [83.988, 28.585] },
  { name: "Dhaulagiri I", height: 8167, at: [83.4879, 28.6992] },
];

// The survey as a GPU texture plus the breakpoints that map world x/z onto it,
// for ray-marched terrain shadows.
export function heightField() {
  const h = survey();
  const xb = grid.longitude.map((lon) => (lon - origin[0]) * kx);
  const zb = grid.latitude.map((lat) => (origin[1] - lat) * kz);
  return { data: h, size, xb, zb, seg: grid.segments.map((s) => s / last) };
}

// Is the point lit by a sun in direction L? 0 = in a ridge's shadow, 1 = full sun.
export function sunlight(x, y, z, L, steps = 26) {
  let res = 1, t = 0.02;
  for (let i = 0; i < steps; i++) {
    const qx = x + L.x * t, qy = y + L.y * t, qz = z + L.z * t;
    if (qy > 8.3) break;
    const d = qy - ground(qx, qz);
    if (d < 0) return 0;
    res = Math.min(res, (10 * d) / t);
    t = t * 1.24 + 0.015;
  }
  return Math.max(0, Math.min(1, res));
}
