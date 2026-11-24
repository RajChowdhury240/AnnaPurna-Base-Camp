// The trail itself as built stone: flagstone paving and stone staircases where the path is
// mapped as steps or climbs steeply, a dry-stone retaining edge on the downhill side, loose
// rocks along the verges, and packed gravel above the tree line. Built in 200 m chunks near
// the walker, a little at a time, from the mapped line (OpenStreetMap).
import {
  BufferGeometry, Float32BufferAttribute, Mesh, MeshLambertMaterial, InstancedMesh, Object3D, Color,
  IcosahedronGeometry, Vector3,
} from "three";
import { ground, sunlight } from "./terrain.js";

const M = 0.001; // one metre in world units

const pathFrag = /* glsl */ `
uniform sampler2D stoneMap;
varying vec3 vPath;   // x: metres along, y: metres across, z: 0 tread, 1 riser, 2 verge
varying float vAlt;
float ph(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
vec2 ph2(vec2 p) { return vec2(ph(p), ph(p + 17.3)); }
// Voronoi: distance to the nearest and second-nearest cell centre, and the cell's id.
vec3 vor(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0; vec2 id = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = ph2(i + g) * 0.8 + 0.1;
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; id = i + g; } else if (d < d2) d2 = d;
  }
  return vec3(d1, d2, ph(id));
}
`;

function makeMaterial(stoneTexture) {
  const m = new MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.stoneMap = { value: stoneTexture };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 pathUV;\nvarying vec3 vPath;\nvarying float vAlt;\nvarying float vDistP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPath = pathUV;\nvAlt = position.y;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvDistP = -mvPosition.z;")
      // The path lies on the true surface; the drawn terrain between its vertices can sit a
      // little higher. Win the depth test against the ground beneath, not against ridges.
      .replace("#include <logdepthbuf_vertex>", "#include <logdepthbuf_vertex>\n#ifdef USE_LOGARITHMIC_DEPTH_BUFFER\nvFragDepth = 1.0 + gl_Position.w * 0.965;\n#endif");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + pathFrag + "\nvarying float vDistP;")
      .replace("#include <color_fragment>", `#include <color_fragment>
{
  float s = vPath.x, u = vPath.y, kind = vPath.z;
  bool wall = kind > 0.5 && kind < 1.5;
  bool verge = kind > 1.5 && kind < 2.5;
  vec2 face = wall ? vec2(u, vAlt * 1000.0) : vec2(s, u);
  // The vertical face uses width and height, so the strata continue across the riser.
  vec3 slab = vor(wall ? face * vec2(1.35, 3.4) :
                  verge ? face * vec2(3.5, 5.4) : face * vec2(1.56, 1.15));
  float lip = slab.y - slab.x;
  float aa = min(0.16, fwidth(lip));
  float joints = smoothstep(0.012, 0.075 + aa, lip);
  vec2 grainUV = face * (wall ? vec2(0.87, 1.28) : vec2(0.81, 1.09));
  vec3 grain = texture2D(stoneMap, grainUV + vec2(slab.z * 3.7, slab.z)).rgb;
  vec3 stone = grain * mix(vec3(0.69, 0.79, 0.88), vec3(1.22, 1.10, 0.94), slab.z);
  float wear = (1.0 - smoothstep(0.18, 0.79, abs(u))) * float(!wall && !verge);
  stone = mix(stone, vec3(dot(stone, vec3(0.3,0.58,0.12))) * 1.16, wear * 0.28);
  float moss = (1.0 - smoothstep(2.85, 3.65, vAlt)) * smoothstep(0.52, 0.96, abs(u));
  vec3 earth = mix(vec3(0.073, 0.058, 0.041), vec3(0.059, 0.084, 0.040), moss);
  stone *= mix(vec3(1.0), vec3(0.68, 0.83, 0.55), moss * (1.0 - smoothstep(0.03, 0.35, lip)));
  vec3 surface = mix(earth, stone, joints);
  if (verge) surface = mix(earth, surface, smoothstep(0.22, 0.57, slab.z));
  if (kind < 0.5 && vAlt > 3.25) {
    float grit = texture2D(stoneMap, face * 4.2).g;
    surface = mix(surface, vec3(0.83, 0.74, 0.63) * (0.10 + grit * 0.65), smoothstep(3.25, 3.65, vAlt));
  }
  diffuseColor.rgb *= mix(surface, vec3(0.195, 0.185, 0.16), smoothstep(0.04, 0.16, vDistP) * 0.55) * 1.72;
}`);
  };
  return m;
}

function edgeRock() {
  const g = new IcosahedronGeometry(0.5, 1);
  const p = g.attributes.position;
  let seed = 23;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const v = new Vector3();
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = v.x.toFixed(3) + v.y.toFixed(3) + v.z.toFixed(3);
    if (!seen.has(k)) seen.set(k, 0.8 + r() * 0.35);
    v.multiplyScalar(seen.get(k));
    v.y = v.y * 0.6 - 0.08;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function createPathway({ scene, path, sun, lite, stoneTexture }) {
  const { x: PX, z: PZ, d: PD, steps: PS, count } = path;
  const CHUNK = 96; // about 48 metres of trail per build
  const material = makeMaterial(stoneTexture);
  const rockMat = new MeshLambertMaterial({ color: "#8e8a83" });
  const rockGeo = edgeRock();
  const chunks = new Map();
  const dummy = new Object3D();
  const RISE = 0.17 * M, BUILD_R = lite ? 0.14 : 0.21, DROP_R = BUILD_R + 0.15;

  // Sun or shade on a 6 m grid.
  const shade = new Map();
  const shadeAt = (x, y, z) => {
    const k = Math.round(x / 0.006) * 1048576 + Math.round(z / 0.006);
    let v = shade.get(k);
    if (v === undefined) { v = sun.y > 0 ? sunlight(x, y + 0.002, z, sun, 16) : 0; shade.set(k, v); }
    return v;
  };
  const hash = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };

  function build(c) {
    const i0 = c * CHUNK, i1 = Math.min(count - 1, (c + 1) * CHUNK);
    const pos = [], uv = [], col = [], rocks = [];
    function profile(i) {
      const x = PX[i], z = PZ[i];
      const lo = Math.max(0, i - 1), hi = Math.min(count - 1, i + 1);
      const dx = PX[hi] - PX[lo], dz = PZ[hi] - PZ[lo], len = Math.hypot(dx, dz) || 1;
      const ia = Math.max(0, i - 4), ib = Math.min(count - 1, i + 4);
      const grade = Math.abs(ground(PX[ib], PZ[ib]) - ground(PX[ia], PZ[ia])) / Math.max(1e-6, PD[ib] - PD[ia]);
      const stair = Boolean(PS[i]) || grade > 0.2;
      const top = ground(x, z) + 0.07 * M;
      return { x, z, nx: -dz / len, nz: dx / len, s: PD[i] / M,
        y: stair ? Math.ceil(top / RISE) * RISE : top, stair };
    }
    function section(a, b, t, y, chip = 0) {
      const lerp = (v, w) => v + (w - v) * t;
      const x = lerp(a.x, b.x), z = lerp(a.z, b.z), s = lerp(a.s, b.s);
      const nx = lerp(a.nx, b.nx), nz = lerp(a.nz, b.nz);
      const width = 0.81 + 0.095 * Math.sin(s * 0.43) + 0.055 * Math.sin(s * 1.63);
      const k = 0.62 + 0.38 * shadeAt(x, y, z);
      const pts = [-width - 0.43, -width, 0.035, width, width + 0.43].map((u, j) => {
        const edge = j === 0 || j === 4;
        const nick = chip * (hash(j + Math.round(chip * 7800)) - 0.5) * 0.065;
        const px = x + (nx * u + nz * nick) * M, pz = z + (nz * u - nx * nick) * M;
        const py = edge ? Math.min(y - 0.10 * M, ground(px, pz) - 0.015 * M) : y + (j === 2 ? 0.012 * M : 0);
        return [px, py, pz, s + nick, u];
      });
      return { pts, k };
    }
    function quad(a, b, kind, low = 1, high = 1) {
      for (let j = 0; j < 4; j++) {
        const face = j === 0 || j === 3 ? 2 : kind;
        for (const [row, index, tone] of [[a,j,low],[a,j+1,low],[b,j,high],[a,j+1,low],[b,j+1,high],[b,j,high]]) {
          const [x, y, z, s, u] = row.pts[index];
          pos.push(x, y, z); uv.push(s, u, face);
          const shade = row.k * tone;
          col.push(shade, shade, shade * 1.02);
        }
      }
    }
    let a = profile(i0), prev = section(a, a, 0, a.y);
    for (let i = i0 + 1; i <= i1; i++) {
      const b = profile(i), run = Math.max(0.001, b.s - a.s);
      const steps = a.stair && b.stair ? Math.round(Math.abs(b.y - a.y) / RISE) : 0;
      const treadKind = a.stair && b.stair ? 3 : 0;
      // Multiple risers can fall within one survey sample on a steep flight.
      for (let j = 0; j < steps; j++) {
        const t = (j + 0.5) / steps, bevel = Math.min(0.026 / run, 0.16 / steps);
        const dy = (b.y - a.y) / steps, bottom = a.y + j * dy, top = bottom + dy;
        const chip = 0.4 + 0.6 * hash(i * 17 + j);
        const lip = Math.sign(dy) * 0.022 * M;
        const entry = section(a, b, t - bevel, bottom, chip);
        const faceA = dy > 0 ? entry : section(a, b, t, bottom + lip, chip);
        const faceB = section(a, b, t, dy > 0 ? top - lip : top, chip);
        const exit = dy > 0 ? section(a, b, t + bevel, top, chip) : faceB;
        quad(prev, entry, 3);
        if (dy < 0) quad(entry, faceA, 1, 1.06, 1);
        quad(faceA, faceB, 1, dy > 0 ? 0.62 : 1, dy > 0 ? 1 : 0.62);
        if (dy > 0) quad(faceB, exit, 1, 1, 1.06);
        prev = exit;
      }
      const end = section(b, b, 0, b.y);
      quad(prev, end, treadKind);
      prev = end;
      a = b;
      if (i % 3 === 0 && hash(i * 1.37) > 0.45) {
        const off = (0.87 + hash(i * 2.1) * 0.43) * M * (hash(i) > 0.5 ? 1 : -1);
        const x = b.x + b.nx * off, z = b.z + b.nz * off, y = ground(x, z);
        rocks.push({ x, y, z, s: (0.18 + hash(i * 3.3) * 0.32) * M, rot: hash(i) * 9, lit: shadeAt(x, y, z) });
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("pathUV", new Float32BufferAttribute(uv, 3));
    g.setAttribute("color", new Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mesh = new Mesh(g, material);
    g.computeBoundingSphere();
    mesh.renderOrder = 2;
    scene.add(mesh);
    let rockMesh = null;
    if (rocks.length) {
      rockMesh = new InstancedMesh(rockGeo, rockMat, rocks.length);
      const cc = new Color();
      rocks.forEach((r, k) => {
        dummy.position.set(r.x, r.y, r.z);
        dummy.rotation.set(0, r.rot, 0);
        dummy.scale.set(r.s * 1.3, r.s, r.s);
        dummy.updateMatrix();
        rockMesh.setMatrixAt(k, dummy.matrix);
        rockMesh.setColorAt(k, cc.setScalar(0.5 + 0.5 * r.lit));
      });
      rockMesh.computeBoundingSphere();
      scene.add(rockMesh);
    }
    return { mesh, rockMesh };
  }
  function drop(c) {
    const ch = chunks.get(c);
    scene.remove(ch.mesh); ch.mesh.geometry.dispose();
    if (ch.rockMesh) { scene.remove(ch.rockMesh); ch.rockMesh.dispose(); }
    chunks.delete(c);
  }

  const nChunks = Math.ceil((count - 1) / CHUNK);
  // Rough chunk centres for quick distance tests.
  const centres = [];
  for (let c = 0; c < nChunks; c++) {
    const i0 = c * CHUNK, i1 = Math.min(count - 1, (c + 1) * CHUNK);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = i0; i <= i1; i++) { minX = Math.min(minX, PX[i]); maxX = Math.max(maxX, PX[i]); minZ = Math.min(minZ, PZ[i]); maxZ = Math.max(maxZ, PZ[i]); }
    centres.push({ minX, maxX, minZ, maxZ });
  }
  const distTo = (c, x, z) => {
    const b = centres[c];
    const dx = Math.max(b.minX - x, 0, x - b.maxX), dz = Math.max(b.minZ - z, 0, z - b.maxZ);
    return Math.hypot(dx, dz);
  };

  function update(camera, onGround) {
    const { x, z } = camera.position;
    if (!onGround) { for (const c of [...chunks.keys()]) drop(c); return; }
    for (const c of [...chunks.keys()]) if (distTo(c, x, z) > DROP_R) drop(c);
    const want = [];
    for (let c = 0; c < nChunks; c++) {
      if (chunks.has(c)) continue;
      const d = distTo(c, x, z);
      if (d < BUILD_R) want.push([d, c]);
    }
    want.sort((a, b) => a[0] - b[0]);
    const end = performance.now() + 1.5;
    for (const [, c] of want) {
      if (performance.now() > end) break;
      chunks.set(c, build(c));
    }
  }
  function relight() {
    shade.clear();
    for (const c of [...chunks.keys()]) drop(c);
  }
  return { update, relight, get chunks() { return chunks.size; } };
}
