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

function makeMaterial() {
  const m = new MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
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
  float far = smoothstep(25.0 * 0.001, 90.0 * 0.001, vDistP);
  float high = smoothstep(3.25, 3.55, vAlt);  // gravel above the tree line
  vec3 soil = vec3(0.36, 0.29, 0.21);
  vec3 col;
  if (kind > 1.5) {
    // Verge: rubble and earth, a retaining edge of piled stone.
    vec3 r = vor(vec2(s, u * 1.6) * 3.2);
    float stone = smoothstep(0.06, 0.16, r.y - r.x) * step(0.35, r.z);
    vec3 rc = mix(vec3(0.42, 0.40, 0.37), vec3(0.55, 0.52, 0.48), r.z);
    col = mix(soil * (0.8 + r.z * 0.3), rc * (0.75 + 0.35 * (1.0 - r.x)), stone);
  } else if (kind > 0.5) {
    // Riser: stacked dry-stone face.
    vec3 r = vor(vec2(s * 2.2, vAlt * 1000.0 * 5.5));
    float joint = smoothstep(0.03, 0.1, r.y - r.x);
    col = mix(vec3(0.12, 0.1, 0.08), mix(vec3(0.38, 0.36, 0.33), vec3(0.5, 0.47, 0.43), r.z) * (0.8 + 0.3 * (1.0 - r.x)), joint);
  } else {
    // Tread: irregular flagstones set in earth, worn smoother along the middle.
    vec3 r = vor(vec2(s, u) * 2.3);
    float joint = smoothstep(0.03, 0.11, r.y - r.x);
    vec3 stone = mix(vec3(0.44, 0.42, 0.39), vec3(0.6, 0.56, 0.5), r.z);
    stone = mix(stone, stone * vec3(1.05, 0.98, 0.9), ph(vec2(r.z, 3.0)));
    float wear = 1.0 - smoothstep(0.2, 0.8, abs(u));
    stone *= 0.82 + 0.28 * (1.0 - r.x) + wear * 0.06;
    vec3 flag = mix(soil * 0.7, stone, joint);
    // Gravel: packed grit with scattered pebbles.
    vec3 g = vor(vec2(s, u) * 14.0);
    vec3 grav = mix(vec3(0.46, 0.42, 0.37), vec3(0.58, 0.54, 0.48), g.z) * (0.85 + 0.2 * (1.0 - g.x));
    grav = mix(grav * 0.75, grav, smoothstep(0.02, 0.08, g.y - g.x));
    col = mix(flag, grav, high);
    // The path's edge softens into the verge.
    col = mix(col, soil, smoothstep(0.55, 1.0, abs(u) / 0.8) * 0.5);
  }
  col = mix(col, vec3(0.45, 0.41, 0.36), far * 0.7);
  diffuseColor.rgb *= col * 2.2; // matte lighting in three.js divides by pi
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

export function createPathway({ scene, path, sun, lite }) {
  const { x: PX, z: PZ, d: PD, steps: PS, count } = path;
  const CHUNK = 400; // samples per chunk (~200 m)
  const material = makeMaterial();
  const rockMat = new MeshLambertMaterial({ color: "#8e8a83" });
  const rockGeo = edgeRock();
  const chunks = new Map();
  const dummy = new Object3D();
  const RISE = 0.17 * M, BUILD_R = lite ? 0.22 : 0.32, DROP_R = BUILD_R + 0.15;

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
    const i0 = Math.max(0, c * CHUNK - 1), i1 = Math.min(count - 1, (c + 1) * CHUNK);
    const pos = [], uv = [], col = [];
    const rocks = [];
    let level = null;
    let prev = null;
    const section = (i, y, kind) => {
      const x = PX[i], z = PZ[i];
      const a = PX[Math.min(count - 1, i + 1)] - PX[Math.max(0, i - 1)];
      const b = PZ[Math.min(count - 1, i + 1)] - PZ[Math.max(0, i - 1)];
      const l = Math.hypot(a, b) || 1;
      const nx = -b / l, nz = a / l; // across the path
      const sM = (PD[i] / M) % 997; // metres along, wrapped to keep the pattern precise
      const w = (1.35 + hash(Math.floor(sM / 7)) * 0.5) * M * (PS[i] ? 0.95 : 1);
      const lit = shadeAt(x, y, z);
      const k = 0.5 + 0.5 * lit;
      // Five points across: verge, edge, centre, edge, verge.
      const verge = 0.55 * M;
      const pts = [
        [-(w / 2 + verge), "v"], [-w / 2, "e"], [0, "c"], [w / 2, "e"], [w / 2 + verge, "v"],
      ].map(([o, t]) => {
        const px = x + nx * o, pz = z + nz * o;
        const gy = ground(px, pz);
        // A slight crown sheds water off the tread; the verge is tucked into the slope.
        const py = t === "v" ? Math.min(y - 0.03 * M, gy - 0.03 * M) : y + (t === "c" ? 0.02 * M : 0);
        return [px, py, pz, o / M, t === "v" ? 2 : kind];
      });
      return { pts, k, sM };
    };
    const quad = (A, B) => {
      for (let j = 0; j < 4; j++) {
        const a0 = A.pts[j], a1 = A.pts[j + 1], b0 = B.pts[j], b1 = B.pts[j + 1];
        const tri = [[a0, A], [a1, A], [b0, B], [a1, A], [b1, B], [b0, B]]; // counter-clockwise from above
        const kindQ = Math.max(a0[4], a1[4]) === 2 ? 2 : B.riser ? 1 : 0;
        for (const [p, S] of tri) {
          pos.push(p[0], p[1], p[2]);
          uv.push(S.sM, p[3], kindQ);
          col.push(S.k, S.k, S.k * 1.02);
        }
      }
    };
    for (let i = i0; i <= i1; i++) {
      const x = PX[i], z = PZ[i];
      // Highest ground under the path's width: the path is cut level across the slope,
      // and its downhill side is held up by the verge.
      const a = PX[Math.min(count - 1, i + 1)] - PX[Math.max(0, i - 1)];
      const b = PZ[Math.min(count - 1, i + 1)] - PZ[Math.max(0, i - 1)];
      const l = Math.hypot(a, b) || 1;
      const nx = -b / l, nz = a / l;
      // The ground is carved level along the line, so the path simply lies on its shelf.
      const top = ground(x, z) + 0.05 * M;
      // Grade over a few metres: staircases where mapped as steps or steeper than ~1 in 5.
      const ia = Math.max(0, i - 4), ib = Math.min(count - 1, i + 4);
      const grade = Math.abs(ground(PX[ib], PZ[ib]) - ground(PX[ia], PZ[ia])) / Math.max(1e-6, PD[ib] - PD[ia]);
      const stair = PS[i] || grade > 0.2;
      let y = top;
      if (stair) {
        if (level === null) {
          level = Math.ceil(top / RISE) * RISE;
          const S = section(i, level, 0);
          if (prev) quad(prev, S);
          prev = S;
          continue;
        }
        if (Math.abs(top - level) > RISE * 0.7) {
          const next = level + Math.sign(top - level) * RISE;
          const S = section(i, level, 0);
          quad(prev, S);
          // The riser: same place, new height.
          const R = section(i, next, 0);
          R.riser = true;
          quad(S, R);
          level = next;
          prev = R;
          continue;
        }
        y = level;
      } else level = null;
      const S = section(i, y, 0);
      if (prev) quad(prev, S);
      prev = S;
      // Stones along the verges.
      if (i % 3 === 0) {
        const h = hash(i * 1.37);
        if (h > 0.45) {
          const side = h > 0.72 ? 1 : -1;
          const off = (0.85 + hash(i * 2.1) * 0.5) * M * side;
          const rx = x + nx * off, rz = z + nz * off;
          rocks.push({ x: rx, y: Math.min(y, ground(rx, rz)), z: rz, s: (0.18 + hash(i * 3.3) * 0.32) * M, rot: h * 9, lit: shadeAt(rx, y, rz) });
        }
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("pathUV", new Float32BufferAttribute(uv, 3));
    g.setAttribute("color", new Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mesh = new Mesh(g, material);
    mesh.frustumCulled = false;
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
      rockMesh.frustumCulled = false;
      scene.add(rockMesh);
    }
    // Centre of the chunk, for distance checks.
    const mid = Math.floor((i0 + i1) / 2);
    return { mesh, rockMesh, x: PX[mid], z: PZ[mid], span: (PD[i1] - PD[i0]) / 2 };
  }
  function drop(c) {
    const ch = chunks.get(c);
    scene.remove(ch.mesh); ch.mesh.geometry.dispose();
    if (ch.rockMesh) { scene.remove(ch.rockMesh); ch.rockMesh.dispose(); }
    chunks.delete(c);
  }

  const nChunks = Math.ceil(count / CHUNK);
  // Rough chunk centres for quick distance tests.
  const centres = [];
  for (let c = 0; c < nChunks; c++) {
    const i0 = c * CHUNK, i1 = Math.min(count - 1, (c + 1) * CHUNK);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = i0; i <= i1; i += 20) { minX = Math.min(minX, PX[i]); maxX = Math.max(maxX, PX[i]); minZ = Math.min(minZ, PZ[i]); maxZ = Math.max(maxZ, PZ[i]); }
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
    const end = performance.now() + 3;
    for (const [, c] of want) {
      if (performance.now() > end) break;
      chunks.set(c, build(c));
    }
  }
  function relight() {
    shade.clear();
    for (const c of [...chunks.keys()]) drop(c);
  }
  // Height of the path surface under a point near the line (for the walker's feet).
  return { update, relight, get chunks() { return chunks.size; } };
}
