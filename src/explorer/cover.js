// Ground cover around the walker: grass tufts and loose rock, coloured from the aerial
// photograph beneath them. Built in fixed 16 m chunks, a few per frame within a time
// budget, so walking never stalls while new ground fills in.
import {
  InstancedMesh, MeshLambertMaterial, BufferGeometry, Float32BufferAttribute, Object3D, Color, DoubleSide,
  IcosahedronGeometry, Vector3,
} from "three";
import { ground, sunlight } from "./terrain.js";

function clumpGeometry(lite) {
  const pos = [], nor = [], col = [], index = [];
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let blade = 0; blade < (lite ? 6 : 9); blade++) {
    const yaw = blade * 2.39996 + random() * 0.5;
    const dx = Math.cos(yaw), dz = Math.sin(yaw), radius = 0.05 + random() * 0.24;
    const h = 0.38 + random() * 0.65, bend = 0.13 + random() * 0.56;
    const width = 0.018 + random() * 0.031, straw = random() > 0.73;
    const first = pos.length / 3;
    const point = (t, side) => {
      const across = side * width * (1 - t);
      const along = radius + bend * t * t + (side === 0 ? width * 0.38 : 0);
      pos.push(dx * along - dz * across, h * t * (1 - 0.28 * t), dz * along + dx * across);
      nor.push(dx * 0.40 - dz * side * 0.42, 0.88, dz * 0.40 + dx * side * 0.42);
      const shade = (0.31 + t * 0.78) * (side < 0 ? 0.81 : 1);
      col.push(shade * (straw ? 1.55 : 0.85 + t * 0.25), shade * (straw ? 1.02 : 1.15), shade * (straw ? 0.68 : 0.75));
    };
    for (const t of [0, 0.52]) for (const side of [-1, 0, 1]) point(t, side);
    point(1, 0);
    for (const n of [0,3,1, 1,3,4, 1,4,2, 2,4,5, 3,6,4, 4,6,5]) index.push(first + n);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setIndex(index);
  return g;
}

function rockGeometry() {
  // A weathered boulder: a lumpy, flattened icosahedron, 1 m across, a third buried.
  const g = new IcosahedronGeometry(0.5, 1);
  const p = g.attributes.position, v = new Vector3();
  const seen = new Map();
  let seed = 11;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = v.x.toFixed(3) + v.y.toFixed(3) + v.z.toFixed(3);
    if (!seen.has(key)) seen.set(key, 0.78 + r() * 0.36);
    v.multiplyScalar(seen.get(key));
    v.y *= 0.62;
    // Flat facets, as fractured rock has.
    if (v.y > 0.16) v.y = 0.16 + (v.y - 0.16) * 0.35;
    p.setXYZ(i, v.x, v.y - 0.06, v.z);
  }
  g.computeVertexNormals();
  const c = [];
  for (let i = 0; i < p.count; i++) {
    const k = 0.72 + Math.max(0, p.getY(i)) * 1.1;
    c.push(k, k, k);
  }
  g.setAttribute("color", new Float32BufferAttribute(c, 3));
  return g;
}

export function createCover({ scene, tiles, trail, lite, sun }) {
  const CH = 0.014; // chunk size, km
  const GRASS_R = lite ? 0.019 : 0.028, ROCK_R = lite ? 0.030 : 0.040;
  const GRASS_CELL = lite ? 0.001 : 0.00072;
  const ROCK_CELL = 0.0031;
  const time = { value: 0 };

  const fadeShader = (radius) => (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying float vFade;")
      .replace("#include <project_vertex>", `#include <project_vertex>
vec3 rootW = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
vFade = 1.0 - smoothstep(${(radius * 0.62).toFixed(4)}, ${(radius * 0.97).toFixed(4)}, distance(rootW, cameraPosition));`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vFade;")
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
if (dither > vFade) discard;`);
  };
  const grassMat = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  grassMat.onBeforeCompile = (shader) => {
    fadeShader(GRASS_R)(shader);
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal *= faceDirection;");
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
// Wind: the tip moves most, gusts roll across the slope.
vec3 root = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
float gust = sin(uTime * 1.3 + root.x * 900.0 + root.z * 700.0) * 0.5 + sin(uTime * 2.7 + root.x * 2100.0) * 0.25;
float k = position.y * position.y;
transformed.x += gust * k * 0.22;
transformed.z += gust * k * 0.12;`);
  };
  const rockMat = new MeshLambertMaterial({ vertexColors: true });
  rockMat.onBeforeCompile = fadeShader(ROCK_R);
  const grassGeo = clumpGeometry(lite), rockGeo = rockGeometry();

  // Trail points on a coarse integer grid, to keep the walked path bare.
  const cells = new Map();
  const key = (i, j) => i * 1048576 + j;
  for (const s of trail) {
    const k = key(Math.floor(s.x / 0.02), Math.floor(s.z / 0.02));
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(s);
  }
  const pathDist = (x, z) => {
    const kx = Math.floor(x / 0.02), kz = Math.floor(z / 0.02);
    let best = 1;
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const s of cells.get(key(kx + a, kz + b)) || []) best = Math.min(best, (s.x - x) ** 2 + (s.z - z) ** 2);
    return Math.sqrt(best);
  };
  // Sun or shade on an 8 m grid, shared by all cover.
  const shade = new Map();
  const shadeAt = (x, y, z) => {
    if (shade.size > 60000) shade.clear(); // a long walk must not grow this without bound
    const k = key(Math.round(x / 0.008), Math.round(z / 0.008));
    let v = shade.get(k);
    if (v === undefined) { v = sun.y > 0 ? sunlight(x, y + 0.002, z, sun, 18) : 0; shade.set(k, v); }
    return v;
  };

  function hash(i, j) {
    let h = (i * 374761393 + j * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  const dummy = new Object3D();
  const col = new Color();
  const chunks = new Map(); // key -> { grass, rock, missing }

  function build(ci, cj) {
    const x0 = ci * CH, z0 = cj * CH;
    const g = [], r = [];
    // Seed and moisture vary over several metres, producing tussocks and bare gaps.
    const biome = (x, z) => 0.5 + 0.25 * Math.sin(x * 730 + z * 240) + 0.25 * Math.sin(z * 890 - x * 318);
    // Grass.
    const gn = Math.ceil(CH / GRASS_CELL);
    for (let a = 0; a < gn; a++)
      for (let b = 0; b < gn; b++) {
        const i = Math.floor(x0 / GRASS_CELL) + a, j = Math.floor(z0 / GRASS_CELL) + b;
        const h1 = hash(i, j), h2 = hash(j, i + 7), h3 = hash(i + 13, j - 5);
        const x = x0 + (a + h1) / gn * CH, z = z0 + (b + h2) / gn * CH;
        const [R, G, B] = tiles.landColor(x, z);
        const lum = 0.3 * R + 0.59 * G + 0.11 * B;
        const sat = Math.max(R, G, B) - Math.min(R, G, B);
        if (lum > 0.5 || sat < 0.035 || B > G * 1.08) continue; // snow, rock, water
        const patch = biome(x, z);
        if (h3 < 0.13 + patch * 0.48) continue;
        const pd = pathDist(x, z);
        if (pd < 0.0019) continue;
        const y = ground(x, z);
        if (y > 4.3) continue;
        const s = (0.00025 + h1 * 0.00055 + patch * 0.00028) * (pd < 0.0035 ? 0.55 : 1);
        const dry = Math.min(1, Math.max(0, (y - 2.9) / 0.8));
        const gr = Math.min(0.58, 0.21 + G * 0.57 + patch * 0.06);
        const rr = gr * (0.78 + 0.32 * dry + h3 * 0.12);
        const bb = gr * (0.40 + dry * 0.18);
        g.push({ x, y, z, s, rot: h2 * 6.283, sy: 0.8 + h3 * 0.6, c: [rr, gr, bb], lit: shadeAt(x, y, z) });
      }
    // Loose rock: scree and boulders where the ground is bare, and above the grass line.
    const rn = Math.ceil(CH / ROCK_CELL);
    for (let a = 0; a < rn; a++)
      for (let b = 0; b < rn; b++) {
        const i = Math.round(x0 / ROCK_CELL) + a, j = Math.round(z0 / ROCK_CELL) + b;
        const h1 = hash(i + 101, j), h2 = hash(j + 3, i + 211), h3 = hash(i - 77, j + 19);
        const x = x0 + (a + h1) / rn * CH, z = z0 + (b + h2) / rn * CH;
        const [R, G, B] = tiles.landColor(x, z);
        const lum = 0.3 * R + 0.59 * G + 0.11 * B;
        const sat = Math.max(R, G, B) - Math.min(R, G, B);
        const y = ground(x, z);
        const bare = sat < 0.06 && lum < 0.55;
        const snowy = lum >= 0.55;
        const chance = bare ? 0.45 : snowy ? (y > 3.4 ? 0.12 : 0.04) : y > 3.0 ? 0.08 : 0.02;
        if (h3 > chance) continue;
        if (pathDist(x, z) < 0.0022) continue;
        // Mostly small stones, now and then a boulder.
        const big = h1 > 0.93;
        const s = big ? 0.0012 + h2 * 0.0018 : 0.00025 + h2 * 0.0006;
        const tone = snowy ? [0.38, 0.37, 0.36] : [Math.min(1, R * 0.9 + 0.08), Math.min(1, G * 0.88 + 0.08), Math.min(1, B * 0.86 + 0.08)];
        r.push({ x, y, z, s, rot: h1 * 6.283, sy: 0.7 + h3 * 0.8, c: tone, lit: shadeAt(x, y, z) });
      }
    const make = (items, geo, mat) => {
      if (!items.length) return null;
      const m = new InstancedMesh(geo, mat, items.length);
      items.forEach((t, k) => {
        dummy.position.set(t.x, t.y - 0.00004, t.z);
        dummy.rotation.set(0, t.rot, 0);
        dummy.scale.set(t.s, t.s * t.sy, t.s);
        dummy.updateMatrix();
        m.setMatrixAt(k, dummy.matrix);
        col.setRGB(t.c[0], t.c[1], t.c[2], "srgb").multiplyScalar(0.45 + 0.55 * t.lit);
        m.setColorAt(k, col);
      });
      m.computeBoundingSphere();
      m.boundingSphere.radius += 0.0004;
      scene.add(m);
      return m;
    };
    return { grass: make(g, grassGeo, grassMat), rock: make(r, rockGeo, rockMat) };
  }
  function drop(k) {
    const c = chunks.get(k);
    for (const m of [c.grass, c.rock]) if (m) { scene.remove(m); m.dispose(); }
    chunks.delete(k);
  }


  function update(camera, dt, onFoot) {
    time.value += dt;
    if (!onFoot) { if (chunks.size) for (const k of [...chunks.keys()]) drop(k); return; }
    if (!tiles.landColorReady()) return;
    const { x, z } = camera.position;
    const R = Math.max(GRASS_R, ROCK_R) + CH;
    const ci0 = Math.floor((x - R) / CH), ci1 = Math.floor((x + R) / CH);
    const cj0 = Math.floor((z - R) / CH), cj1 = Math.floor((z + R) / CH);
    // Drop chunks that fell behind.
    for (const [k, c] of chunks) {
      const d = Math.hypot(c.cx - x, c.cz - z);
      if (d > R + CH) { drop(k); continue; }
      if (c.grass) c.grass.visible = d < GRASS_R + CH * 0.72;
      if (c.rock) c.rock.visible = d < ROCK_R + CH * 0.72;
    }
    // Fill the nearest missing chunks first, within about 3 ms.
    const todo = [];
    for (let i = ci0; i <= ci1; i++)
      for (let j = cj0; j <= cj1; j++) {
        const cx = (i + 0.5) * CH, cz = (j + 0.5) * CH;
        const d = Math.hypot(cx - x, cz - z);
        if (d > R) continue;
        const k = key(i, j);
        if (chunks.has(k)) continue;
        todo.push({ i, j, d, k });
      }
    todo.sort((a, b) => a.d - b.d);
    const end = performance.now() + 1.5;
    for (const t of todo) {
      if (performance.now() > end) break;

      const c = build(t.i, t.j);
      c.cx = (t.i + 0.5) * CH; c.cz = (t.j + 0.5) * CH;
      chunks.set(t.k, c);
    }
  }
  function relight() {
    shade.clear();
    for (const k of [...chunks.keys()]) drop(k);
  }

  return {
    update, relight,
    get count() { let n = 0; for (const c of chunks.values()) n += (c.grass?.count || 0) + (c.rock?.count || 0); return n; },
  };
}
