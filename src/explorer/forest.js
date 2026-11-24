// 3D trees near the camera, planted where the aerial photograph shows canopy and
// tinted from it, so the forest you walk through is the forest in the picture.
import {
  InstancedMesh, MeshLambertMaterial, IcosahedronGeometry, ConeGeometry, CylinderGeometry, Object3D,
  Color, Vector3, BufferGeometry, Float32BufferAttribute,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ground, toXZ, sunlight } from "./terrain.js";

const x2lon = (x, z) => (x / 2 ** z) * 360 - 180;
const y2lat = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

// Deterministic jitter so the same tile always grows the same trees.
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function tint(geo, top, bottom) {
  // Darker towards the base of the crown, for self-shadowing without lights.
  if (geo.index) geo = geo.toNonIndexed();
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox;
  const p = geo.attributes.position;
  const c = [];
  const a = new Color(bottom), b = new Color(top), t = new Color();
  for (let i = 0; i < p.count; i++) {
    const k = (p.getY(i) - min.y) / (max.y - min.y || 1);
    t.copy(a).lerp(b, k);
    c.push(t.r, t.g, t.b);
  }
  geo.setAttribute("color", new Float32BufferAttribute(c, 3));
  return geo;
}

function lumpy(geo, amount, seed, keepNormals) {
  const r = rng(seed);
  const p = geo.attributes.position;
  const v = new Vector3();
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = v.toArray().map((n) => n.toFixed(3)).join();
    if (!seen.has(key)) seen.set(key, 1 + (r() - 0.5) * amount);
    v.multiplyScalar(seen.get(key));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  if (!keepNormals) geo.computeVertexNormals();
  return geo;
}

function broadleaf() {
  // A clumped crown of three lobes on a short trunk; unit height.
  const lobe = (x, y, z, s, seed) => {
    const g = lumpy(new IcosahedronGeometry(s, 1), 0.28, seed);
    // Normals point out from the lobe centre: soft, foliage-like shading instead of facets.
    const p = g.attributes.position, n = g.attributes.normal, v = new Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); n.setXYZ(i, v.x, v.y, v.z); }
    return g.translate(x, y, z);
  };
  const r = rng(99);
  const lobes = [lobe(0, 0.68, 0, 0.26, 1)];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + r();
    lobes.push(lobe(Math.cos(a) * 0.17, 0.52 + r() * 0.24, Math.sin(a) * 0.17, 0.15 + r() * 0.07, 2 + i));
  }
  const crown = mergeGeometries(lobes);
  tint(crown, "#ffffff", "#7d8576");
  const trunk = tint(new CylinderGeometry(0.03, 0.05, 0.42, 5).translate(0, 0.21, 0), "#e8d7c2", "#9c8a76");
  return mergeGeometries([crown, trunk]);
}
function broadleafFar() {
  const g = lumpy(new IcosahedronGeometry(0.3, 1), 0.3, 5);
  const p = g.attributes.position, n = g.attributes.normal, v = new Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); n.setXYZ(i, v.x, v.y, v.z); }
  g.scale(1.15, 0.95, 1.15).translate(0, 0.64, 0);
  const crown = tint(g, "#ffffff", "#7d8576");
  const trunk = tint(new CylinderGeometry(0.03, 0.05, 0.42, 4).translate(0, 0.21, 0), "#e8d7c2", "#9c8a76");
  return mergeGeometries([crown, trunk]);
}
function conifer() {
  const tiers = [];
  for (let i = 0; i < 4; i++) {
    const r = 0.27 - i * 0.055, h = 0.36 - i * 0.04, y = 0.2 + i * 0.17;
    tiers.push(lumpy(new ConeGeometry(r, h, 7, 1, true), 0.18, 10 + i).translate(0, y + h / 2, 0));
  }
  const crown = tint(mergeGeometries(tiers), "#ffffff", "#5d665a");
  const trunk = tint(new CylinderGeometry(0.02, 0.035, 0.3, 5).translate(0, 0.15, 0), "#d6c4ae", "#8d7b68");
  return mergeGeometries([crown, trunk]);
}

const CROWN_MAX = 1200;

export function createForest({ scene, tiles, trail, lite, sun }) {
  const geos = [broadleaf(), conifer()];
  const farGeos = [broadleafFar(), conifer()];
  const NEAR_TILE = 0.6;
  const material = new MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vNear;\nvarying vec3 vLeaf;")
      .replace("#include <project_vertex>", `#include <project_vertex>
vec3 rootW = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
vNear = distance(rootW, cameraPosition);
vLeaf = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying float vNear;
varying vec3 vLeaf;
float lh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`)
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
// Dissolve trees close to the eye rather than filling the screen with one crown.
if (vNear < 0.016) discard;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
// Leaf clumps: break up each crown into lit and shaded tufts.
vec3 q = floor(vLeaf * 3200.0);
float leaf = lh(q) * 0.55 + lh(floor(vLeaf * 1100.0)) * 0.45;
diffuseColor.rgb *= 0.6 + leaf * 0.75;`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
// Ragged, leafy silhouettes instead of smooth balls.
float rim = 1.0 - abs(dot(normal, normalize(vViewPosition)));
if (leaf < rim * rim * 0.95) discard;`);
  };
  const grown = new Map(); // tile -> meshes
  const lod = new Map();
  const dummy = new Object3D();
  const col = new Color();
  const RADIUS = lite ? 1.0 : 1.6;
  const STEP = lite ? 8 : 5; // finer sampling of the aerial tile where we walk among trees

  // A coarse grid of trail points, to keep the path itself clear.
  const near = new Map();
  const pts = trail.count ? Array.from({ length: trail.count }, (_, i) => ({ x: trail.x[i], z: trail.z[i] })) : trail;
  for (const s of pts) {
    const k = Math.floor(s.x / 0.05) + "," + Math.floor(s.z / 0.05);
    if (!near.has(k)) near.set(k, []);
    near.get(k).push(s);
  }
  const onTrail = (x, z) => {
    const kx = Math.floor(x / 0.05), kz = Math.floor(z / 0.05);
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const s of near.get(kx + a + "," + (kz + b)) || []) if ((s.x - x) ** 2 + (s.z - z) ** 2 < 0.008 ** 2) return true;
    return false;
  };

  // Sun or shade on a 20 m grid, so planting a tile stays quick.
  const shade = new Map();
  function shadeAt(x, y, z, far) {
    const k = Math.round(x / 0.02) * 1048576 + Math.round(z / 0.02);
    let v = shade.get(k);
    if (v === undefined) { v = sun.y > 0 ? sunlight(x, y, z, sun, far ? 12 : 18) : 0; shade.set(k, v); }
    return v;
  }

  function plant(node, far) {
    const { data, width, height } = node.pixels;
    const r = rng(node.x * 73856093 ^ node.y * 19349663);
    const lists = [[], []];
    const west = x2lon(node.x, node.z), east = x2lon(node.x + 1, node.z);
    const north = y2lat(node.y, node.z), south = y2lat(node.y + 1, node.z);
    for (let py = 0; py < height; py += STEP)
      for (let px = 0; px < width; px += STEP) {
        const sx = Math.min(width - 1, px + Math.floor(r() * STEP));
        const sy = Math.min(height - 1, py + Math.floor(r() * STEP));
        const i = (sy * width + sx) * 4;
        const R = data[i] / 255, G = data[i + 1] / 255, B = data[i + 2] / 255;
        const lum = 0.3 * R + 0.59 * G + 0.11 * B;
        // Canopy: green-dominant, darker than meadow, not water or snow.
        const green = G - Math.max(R, B);
        if (green < 0.012 || lum > 0.4 || lum < 0.04) continue;
        if (r() > Math.min(1, green * 14 + (0.4 - lum) * 1.6)) continue;
        // The bitmap is stored bottom-up (flipped for the GPU).
        const fx = (sx + 0.5) / width, fy = 1 - (sy + 0.5) / height;
        const lon = west + (east - west) * fx;
        const lat = north + (south - north) * fy;
        const [x, z] = toXZ([lon, lat]);
        if (onTrail(x, z)) continue;
        const y = ground(x, z);
        // Tree line: scrub and meadow above about 3,500 m, nothing taller.
        if (y > 3.35 + r() * 0.2) continue;
        // Fir and pine take over above about 2,800 m, broadleaf forest below.
        const kind = y > 2.8 + (r() - 0.5) * 0.3 ? 1 : 0;
        const hgt = (kind ? 0.013 : 0.009) + r() * 0.01;
        lists[kind].push({ x, y, z, hgt, R, G, B, rot: r() * 6.28, lean: (r() - 0.5) * 0.12, w: 0.85 + r() * 0.4 });
      }
    const meshes = [];
    lists.forEach((items, kind) => {
      if (!items.length) return;
      const list = items.slice(0, CROWN_MAX * 4);
      const m = new InstancedMesh((far ? farGeos : geos)[kind], material, list.length);
      list.forEach((t, i) => {
        dummy.position.set(t.x, t.y - t.hgt * 0.06, t.z);
        dummy.rotation.set(t.lean, t.rot, t.lean * 0.5);
        dummy.scale.set(t.hgt * t.w, t.hgt, t.hgt * t.w);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
        // Crown colour from the photograph, a touch deeper so it reads against the ground.
        col.setRGB(Math.min(1, t.R * 1.55), Math.min(1, t.G * 1.6), Math.min(1, t.B * 1.35), "srgb");
        // Trees standing in a ridge's shadow take only skylight.
        const lit = shadeAt(t.x, t.y + t.hgt * 0.6, t.z, far);
        col.multiplyScalar(0.42 + 0.58 * lit);
        m.setColorAt(i, col);
      });
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      scene.add(m);
      meshes.push(m);
    });
    grown.set(node, meshes);
    lod.set(node, far);
  }
  function fell(node) {
    const meshes = grown.get(node);
    if (!meshes) return;
    meshes.forEach((m) => { scene.remove(m); m.dispose(); });
    grown.delete(node);
    lod.delete(node);
  }

  let tick = 0;
  const pos = new Vector3();
  function update(camera, onGround) {
    if (++tick % 6) return;
    if (shade.size > 60000) shade.clear();
    pos.copy(camera.position);
    const want = new Set(onGround ? tiles.forestTiles(pos, RADIUS) : []);
    for (const node of grown.keys()) if (!want.has(node)) fell(node);
    let budget = 1; // one tile per update, to keep frames smooth
    for (const node of want) {
      const far = node.box.distanceToPoint(pos) > NEAR_TILE;
      if (grown.has(node) && lod.get(node) === far) continue;
      fell(node);
      plant(node, far);
      if (--budget <= 0) break;
    }
  }
  // Re-light every planted tile after the sun moves.
  function relight() { shade.clear(); for (const node of [...grown.keys()]) lod.set(node, null); }

  return { update, fell, relight, get count() { let n = 0; for (const ms of grown.values()) ms.forEach((m) => (n += m.count)); return n; } };
}
