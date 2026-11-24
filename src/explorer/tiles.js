// Streaming terrain: a quadtree of Web Mercator tiles draped with high-resolution
// aerial imagery, refined near the camera. Heights come from the same survey as
// everything else (ground), so the trail and the walker sit on what you see.
import {
  BufferGeometry, BufferAttribute, Mesh, ShaderMaterial, Texture, SRGBColorSpace, LinearMipmapLinearFilter,
  LinearFilter, DoubleSide, Box3, Vector3, Frustum, Matrix4, Group, Color,
} from "three";
import { ground, toXZ, imageUV, bounds, toLonLat, heightField } from "./terrain.js";
import { DataTexture, RedFormat, HalfFloatType, DataUtils, Vector4, Vector2, ClampToEdgeWrapping } from "three";

// Shared cloud field: the sky draws it, the terrain catches its shadow.
export const CLOUD_GLSL = /* glsl */ `
uniform float cloudTime;
uniform float cloudCover;
float cHash(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
float cNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cHash(i), cHash(i + vec2(1, 0)), f.x), mix(cHash(i + vec2(0, 1)), cHash(i + 1.0), f.x), f.y);
}
float cFbm(vec2 p, int n) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { if (i >= n) break; v += cNoise(p) * a; p = p * 2.07 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
// Cumulus-like cells: a warped base shape eroded by fine detail at the edges.
float cloudDensity(vec2 km) {
  vec2 p = km * 0.05 + vec2(cloudTime * 0.0012, cloudTime * 0.00045);
  vec2 warp = vec2(cFbm(p * 0.7 + 3.1, 3), cFbm(p * 0.7 + 7.7, 3));
  float base = cFbm(p + warp * 0.9, 4);
  float detail = cFbm(p * 5.3 + warp * 2.0, 4);
  float v = base - (1.0 - base) * detail * 0.35;
  return smoothstep(cloudCover, cloudCover + 0.16, v);
}
// The same field at low detail, for shadows on the ground (cheap, and soft anyway).
float cloudShadowDensity(vec2 km) {
  vec2 p = km * 0.05 + vec2(cloudTime * 0.0012, cloudTime * 0.00045);
  return smoothstep(cloudCover - 0.04, cloudCover + 0.2, cFbm(p, 3));
}
const float CLOUD_Y = 9.6;
`;

const IMAGERY = (z, x, y) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
export const IMAGERY_CREDIT = "Imagery: Esri, Maxar, Earthstar Geographics and the GIS User Community";

const ROOT_Z = 11;
export const FOREST_Z = 16;
const SEG = 32; // base resolution; near tiles refine further in buildMesh

const x2lon = (x, z) => (x / 2 ** z) * 360 - 180;
const y2lat = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

const vert = /* glsl */ `
attribute vec2 uvBase;
varying vec2 vUv;
varying vec2 vUvBase;
varying vec3 vWorld;
varying vec3 vNormal;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vUv = uv;
  vUvBase = uvBase;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;

const frag = /* glsl */ `
uniform sampler2D map;
uniform sampler2D baseMap;
uniform float useBase;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 ambientColor;
uniform vec3 fogColor;
uniform vec3 fogSun;
uniform float fogDensity;
uniform float relief;
uniform vec3 grade;
uniform sampler2D heightMap;
uniform vec4 xb;
uniform vec4 zb;
uniform vec4 seg;
uniform vec2 hmSize;
varying vec2 vUv;
varying vec2 vUvBase;
varying vec3 vWorld;
varying vec3 vNormal;
#include <common>
#include <logdepthbuf_pars_fragment>

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + 1.0), f.x), f.y);
}

${CLOUD_GLSL}

float pw(float v, vec4 a, vec4 s) {
  if (v < a.y) return mix(s.x, s.y, clamp((v - a.x) / (a.y - a.x), 0.0, 1.0));
  if (v < a.z) return mix(s.y, s.z, (v - a.y) / (a.z - a.y));
  return mix(s.z, s.w, clamp((v - a.z) / (a.w - a.z), 0.0, 1.0));
}
float hAt(vec2 xz) {
  vec2 uv = vec2(pw(xz.x, xb, seg), pw(xz.y, zb, seg));
  return texture2D(heightMap, uv * hmSize.x + hmSize.y).r;
}
// March toward the sun through the elevation survey: ridges cast real shadows.
float terrainShadow(vec3 p, vec3 L) {
  float res = 1.0, t = 0.025;
  for (int i = 0; i < SHADOW_STEPS; i++) {
    vec3 q = p + L * t;
    if (q.y > 8.3) break;
    float d = q.y - hAt(q.xz);
    if (d < 0.0) return 0.0;
    res = min(res, 9.0 * d / t);
    t = t * 1.22 + 0.018;
  }
  return clamp(res, 0.0, 1.0);
}

// Integer-lattice value noise in metres, anchored to a 1 km block near the camera,
// so it stays crisp kilometres from the origin and never shifts as you move.
float hashI(ivec2 c) {
  uvec2 q = uvec2(c) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y) * 1597334673u;
  return float(n) * (1.0 / 4294967295.0);
}
float vnM(vec2 local, vec2 block, float f) {
  vec2 p = local * f;
  vec2 i = floor(p);
  vec2 u = p - i;
  u = u * u * (3.0 - 2.0 * u);
  ivec2 c = ivec2(i) + ivec2(block * f);
  return mix(mix(hashI(c), hashI(c + ivec2(1, 0)), u.x), mix(hashI(c + ivec2(0, 1)), hashI(c + ivec2(1, 1)), u.x), u.y);
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 albedo = useBase > 0.5 ? texture2D(baseMap, vUvBase).rgb : texture2D(map, vUv).rgb;
  // The aerial photographs carry their own blue haze; take it out before adding ours.
  albedo = max(albedo - vec3(0.012, 0.018, 0.032), 0.0) * 1.06;
  float grey = dot(albedo, vec3(0.299, 0.587, 0.114));
  albedo = mix(vec3(grey), albedo, 1.07);
  // Snow, from the photograph: bright and colourless, or blue-grey shade high up.
  vec3 maskTex = useBase > 0.5 ? albedo : texture2D(map, vUv, 1.5).rgb;
  float mLum = dot(maskTex, vec3(0.299, 0.587, 0.114));
  float mSat = max(max(maskTex.r, maskTex.g), maskTex.b) - min(min(maskTex.r, maskTex.g), maskTex.b);
  float snowLit = smoothstep(0.36, 0.6, mLum) * (1.0 - smoothstep(0.07, 0.2, mSat));
  float snowShade = smoothstep(0.17, 0.32, mLum) * step(maskTex.r, maskTex.b * 1.03)
                  * (1.0 - smoothstep(0.09, 0.2, mSat)) * smoothstep(3.4, 4.2, vWorld.y);
  float snowMask = max(snowLit, snowShade);
  vec3 N = normalize(vNormal);
  vec3 V = vWorld - cameraPosition;
  float d = length(V);
  vec3 viewDir = V / max(d, 1e-5);

  // A metre-scale block anchored near the camera keeps all fine detail crisp kilometres
  // from the origin and free of sliding as the view moves.
  vec3 block = floor(cameraPosition * 1000.0 / 1024.0) * 1024.0;
  vec3 L = vWorld * 1000.0 - block; // metres, small

  // Ground cover within a couple of hundred metres, where even 1 m imagery runs out:
  // triplanar noise so it never stretches on slopes, tinted by the photograph's own colour.
  float near = (1.0 - smoothstep(0.03, 0.35, d)) * (1.0 - snowMask);
  if (near > 0.0) {
    vec3 w = abs(N); w /= (w.x + w.y + w.z);
    float tuft = 0.0;
    tuft += (vnM(L.xz, block.xz, 2.0) * w.y + vnM(L.zy, block.zy, 2.0) * w.x + vnM(L.xy, block.xy, 2.0) * w.z) * 0.4;
    tuft += (vnM(L.xz, block.xz, 7.0) * w.y + vnM(L.zy, block.zy, 7.0) * w.x + vnM(L.xy, block.xy, 7.0) * w.z) * 0.35;
    tuft += (vnM(L.xz, block.xz, 25.0) * w.y + vnM(L.zy, block.zy, 25.0) * w.x + vnM(L.xy, block.xy, 25.0) * w.z) * 0.25;
    vec3 tone = useBase > 0.5 ? albedo : texture2D(map, vUv, 2.5).rgb;
    vec3 cover = tone * (0.55 + tuft * 0.95);
    albedo = mix(albedo, cover, near * 0.7);
  }

  // Sub-metre relief on the ground: a few noise samples perturb the normal so even the
  // sharpest aerial tile stops looking flat underfoot. Fades out before it can shimmer.
#if LITE == 0
  float micro = (1.0 - smoothstep(0.06, 0.28, d)) * (1.0 - snowMask);
  if (micro > 0.0) {
    float eM = 0.6;
    float h0 = vnM(L.xz, block.xz, 3.0);
    float hx = vnM(L.xz + vec2(eM, 0.0), block.xz, 3.0);
    float hz = vnM(L.xz + vec2(0.0, eM), block.xz, 3.0);
    N = normalize(N + vec3(-(hx - h0), 0.0, -(hz - h0)) * 0.45 * micro);
  }
#endif

  // Top-down photographs smear on cliffs: blend in a blurred tone with rock strata there.
  float steep = smoothstep(0.42, 0.78, 1.0 - N.y);
  steep *= 1.0 - snowMask * 0.7;
  if (steep > 0.0 && useBase < 0.5) {
    vec3 tone = texture2D(map, vUv, 4.0).rgb;
    float strata = vnoise(vec2(vWorld.y * 260.0, (vWorld.x + vWorld.z) * 18.0)) * 0.6
                 + vnoise(vec2(vWorld.y * 900.0, (vWorld.x - vWorld.z) * 60.0)) * 0.4;
    vec3 rock = mix(tone, vec3(dot(tone, vec3(0.33))) * vec3(1.0, 0.97, 0.94), 0.65) * (0.7 + strata * 0.5);
    albedo = mix(albedo, rock, steep * 0.7);
  }
  // Sunlight: ridge shadows from the survey, moving cloud shadows, slope relief on top
  // of the light already in the photograph.
  float ndl = max(dot(N, sunDir), 0.0);
  float sh = sunDir.y > 0.0 ? terrainShadow(vWorld + N * 0.006, sunDir) : 0.0;
  if (sunDir.y > 0.02) {
    vec2 cp = vWorld.xz + sunDir.xz * ((CLOUD_Y - vWorld.y) / sunDir.y);
    sh *= 1.0 - cloudShadowDensity(cp) * 0.6;
  }
  float direct = sh * mix(1.0, ndl * 1.5, relief);
  vec3 light = ambientColor * 0.62 + sunColor * direct * 0.72;
  vec3 col = albedo * grade * light * 1.08;

  // Contact darkening in gullies and folds, read from the same elevation survey that
  // casts the shadows. Adds depth where a top-down photograph has none.
#if LITE == 0
  float aoNear = 1.0 - smoothstep(0.15, 0.9, d);
  if (aoNear > 0.0) {
    vec2 a = vWorld.xz;
    float hc = hAt(a);
    float hs = (hAt(a + vec2(0.035, 0.0)) + hAt(a - vec2(0.035, 0.0))
              + hAt(a + vec2(0.0, 0.035)) + hAt(a - vec2(0.0, 0.035))) * 0.25;
    col *= mix(1.0, clamp(0.92 + (hc - hs) * 7.0, 0.78, 1.04), aoNear);
  }
#endif

  // Snow is lit by the real sun on the real slope, not by the photograph's own light:
  // wind-carved drifts and ripples, blue in shade, a soft sheen, sparkle up close.
  if (snowMask > 0.0) {
    vec3 Ns = N;
    float detail = 1.0 - smoothstep(0.3, 2.5, d);
    if (detail > 0.0) {
      vec3 block = floor(cameraPosition * 1000.0 / 1024.0) * 1024.0;
      vec2 Lm = vWorld.xz * 1000.0 - block.xz;
      // Ripples run across the prevailing wind; drifts are broad and soft.
      vec2 wind = vec2(0.8, 0.6);
      vec2 rip = vec2(dot(Lm, wind), dot(Lm, vec2(-wind.y, wind.x)) * 0.25);
      float e = 0.35;
      #define SNOWH(P, R) (vnM(P, block.xz, 0.044921875) * 2.2 + vnM(P, block.xz, 0.2099609375) * 0.6 + vnM(R, vec2(0.0), 1.1) * 0.22 + vnM(P, block.xz, 3.0) * 0.05)
      float h0 = SNOWH(Lm, rip);
      float hx = SNOWH(Lm + vec2(e, 0.0), rip + vec2(e * wind.x, -e * wind.y * 0.25));
      float hz = SNOWH(Lm + vec2(0.0, e), rip + vec2(e * wind.y, e * wind.x * 0.25));
      Ns = normalize(N + vec3(-(hx - h0) / e, 0.0, -(hz - h0) / e) * 0.9 * detail);
    }
    float ndlS = dot(Ns, sunDir);
    float wrap = max((ndlS + 0.15) / 1.15, 0.0);
    vec3 snowAlb = mix(vec3(0.84, 0.87, 0.91), albedo, 0.2 * (1.0 - smoothstep(0.3, 0.7, 1.0 - N.y)));
    vec3 skyFill = ambientColor * vec3(0.78, 0.9, 1.18) * (0.5 + 0.35 * Ns.y);
    vec3 snowCol = snowAlb * (skyFill + sunColor * wrap * sh * 1.02);
    // Light scattered inside the snowpack keeps shade from going grey.
    snowCol += vec3(0.02, 0.045, 0.08) * (1.0 - sh);
    vec3 H = normalize(sunDir - viewDir);
    float nv = max(dot(Ns, -viewDir), 0.0);
    snowCol += sunColor * sh * (pow(max(dot(Ns, H), 0.0), 90.0) * 0.35 + pow(1.0 - nv, 5.0) * 0.18);
    // Sparkle: tiny facets catching the sun, changing as you move.
    float near2 = 1.0 - smoothstep(0.02, 0.18, d);
    if (near2 > 0.0 && sh > 0.2) {
      vec3 blockS = floor(cameraPosition * 1000.0 / 1024.0) * 1024.0;
      vec2 Ls = vWorld.xz * 1000.0 - blockS.xz;
      ivec2 cell = ivec2(floor(Ls * 14.0)) + ivec2(blockS.xz * 14.0) + ivec2(floor(viewDir.xz * 30.0));
      float g = step(0.9965, hashI(cell)) * near2 * sh * wrap;
      snowCol += sunColor * g * 3.0;
    }
    col = mix(col, snowCol * grade * 0.8, snowMask);
  }

  // Aerial perspective: thinner air higher up, blue-shifted with distance.
  float hAvg = max(0.0, 0.5 * (vWorld.y + cameraPosition.y) - 0.8);
  float dens = fogDensity * exp(-hAvg * 0.32);
  vec3 ext = exp(-d * dens * vec3(0.62, 0.86, 1.32));
  float sunAmt = pow(max(dot(viewDir, sunDir), 0.0), 6.0);
  vec3 inscatter = mix(fogColor, fogSun, sunAmt);
  col = col * ext + inscatter * (1.0 - ext);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createTiles({ renderer, camera, baseTexture, lite, onDispose }) {
  const group = new Group();
  const shared = {
    sunDir: { value: new Vector3(0.4, 0.7, 0.5).normalize() },
    sunColor: { value: new Color("#fff3e0") },
    ambientColor: { value: new Color("#c9d6e6") },
    fogColor: { value: new Color("#c4d5e3") },
    fogSun: { value: new Color("#f3e6cf") },
    fogDensity: { value: 0.022 },
    relief: { value: 0.45 },
    grade: { value: new Color(1, 1, 1) },
    baseMap: { value: baseTexture },
    heightMap: { value: null },
    xb: { value: new Vector4() }, zb: { value: new Vector4() }, seg: { value: new Vector4() },
    hmSize: { value: new Vector2() },
    cloudTime: { value: 0 },
    cloudCover: { value: 0.44 },
  };
  {
    const hf = heightField();
    const half = new Uint16Array(hf.data.length);
    for (let i = 0; i < half.length; i++) half[i] = DataUtils.toHalfFloat(hf.data[i]);
    const tex = new DataTexture(half, hf.size, hf.size, RedFormat, HalfFloatType);
    tex.minFilter = tex.magFilter = LinearFilter;
    tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
    tex.needsUpdate = true;
    shared.heightMap.value = tex;
    shared.xb.value.set(...hf.xb);
    shared.zb.value.set(...hf.zb);
    shared.seg.value.set(...hf.seg);
    shared.hmSize.value.set(1 - 1 / hf.size, 0.5 / hf.size);
  }
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  const MAX_Z = lite ? 17 : 18;
  const SPLIT = lite ? 1.6 : 2.1;
  const MAX_LOADS = 8;

  function makeNode(z, x, y, parent) {
    const west = x2lon(x, z), east = x2lon(x + 1, z), north = y2lat(y, z), south = y2lat(y + 1, z);
    const [x0, z0] = toXZ([west, north]);
    const [x1, z1] = toXZ([east, south]);
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i <= 6; i++)
      for (let j = 0; j <= 6; j++) {
        const h = ground(x0 + ((x1 - x0) * i) / 6, z0 + ((z1 - z0) * j) / 6);
        minY = Math.min(minY, h);
        maxY = Math.max(maxY, h);
      }
    const pad = (x1 - x0) * 0.08;
    return {
      z, x, y, parent, children: null, mesh: null, tex: null, state: "none", used: 0,
      size: x1 - x0,
      box: new Box3(new Vector3(x0, minY - pad, z0), new Vector3(x1, maxY + pad, z1)),
    };
  }

  function buildMesh(node) {
    const { z, x, y } = node;
    // Finer mesh where the camera actually walks; coarse levels stay cheap.
    const seg = !lite && z >= 16 ? 48 : SEG;
    const n = seg + 1;
    const total = n * n + 4 * n;
    const pos = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    const uvBase = new Float32Array(total * 2);
    const nor = new Float32Array(total * 3);
    const px = [], pz = [];
    for (let i = 0; i < n; i++) {
      px.push(toXZ([x2lon(x + i / seg, z), 0])[0]);
      pz.push(toXZ([0, y2lat(y + i / seg, z)])[1]);
    }
    const ex = px[1] - px[0], ez = pz[1] - pz[0];
    // Sample each height once and derive normals from the grid, instead of five terrain
    // lookups per vertex. This is what makes the finer near-camera mesh affordable.
    const H = new Float32Array(n * n);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) H[j * n + i] = ground(px[i], pz[j]);
    const put = (k, wx, wy, wz, u, v, gi, gj) => {
      pos[k * 3] = wx; pos[k * 3 + 1] = wy; pos[k * 3 + 2] = wz;
      uv[k * 2] = u; uv[k * 2 + 1] = v;
      const [bu, bv] = imageUV(wx, wz);
      uvBase[k * 2] = bu; uvBase[k * 2 + 1] = 1 - bv;
      const sx = (H[gj * n + Math.min(n - 1, gi + 1)] - H[gj * n + Math.max(0, gi - 1)]) / (2 * ex);
      const sz = (H[Math.min(n - 1, gj + 1) * n + gi] - H[Math.max(0, gj - 1) * n + gi]) / (2 * ez);
      const l = Math.hypot(sx, 1, sz);
      nor[k * 3] = -sx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = -sz / l;
    };
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) put(j * n + i, px[i], H[j * n + i], pz[j], i / seg, 1 - j / seg, i, j);
    // Skirts hang below each edge so neighbouring detail levels never show a gap.
    const drop = node.size * 0.06 + 0.01;
    const edges = [
      (t) => [t, 0], (t) => [seg, t], (t) => [seg - t, seg], (t) => [0, seg - t],
    ];
    const index = [];
    for (let j = 0; j < seg; j++)
      for (let i = 0; i < seg; i++) {
        const a = j * n + i, b = a + n, c = b + 1, d = a + 1;
        index.push(a, b, d, b, c, d);
      }
    let k = n * n;
    edges.forEach((edge) => {
      const start = k;
      for (let t = 0; t < n; t++) {
        const [i, j] = edge(t);
        const src = j * n + i;
        put(k, pos[src * 3], pos[src * 3 + 1] - drop, pos[src * 3 + 2], uv[src * 2], uv[src * 2 + 1], 0, 0);
        nor.set(nor.subarray(src * 3, src * 3 + 3), k * 3);
        k++;
      }
      for (let t = 0; t < seg; t++) {
        const [i0, j0] = edge(t), [i1, j1] = edge(t + 1);
        const a = j0 * n + i0, b = j1 * n + i1, sa = start + t, sb = start + t + 1;
        index.push(a, sa, b, b, sa, sb);
      }
    });
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("uv", new BufferAttribute(uv, 2));
    g.setAttribute("uvBase", new BufferAttribute(uvBase, 2));
    g.setAttribute("normal", new BufferAttribute(nor, 3));
    g.setIndex(index);
    g.boundingBox = node.box.clone();
    g.computeBoundingSphere();
    const m = new ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, side: DoubleSide,
      defines: { SHADOW_STEPS: lite ? 12 : 22, LITE: lite ? 1 : 0 },
      uniforms: { ...shared, map: { value: node.tex }, useBase: { value: node.tex ? 0 : 1 } },
    });
    node.mesh = new Mesh(g, m);
    node.mesh.matrixAutoUpdate = false;
    node.mesh.visible = false;
    group.add(node.mesh);
  }

  const pixelTiles = new Map();
  // Photograph colour (0..1 sRGB) at a point, when a detailed tile covers it.
  function sampleColor(wx, wz) {
    const [lon, lat] = toLonLat(wx, wz);
    const fx = lon2x(lon, FOREST_Z), fy = lat2y(lat, FOREST_Z);
    const node = pixelTiles.get(Math.floor(fx) + "," + Math.floor(fy));
    if (!node) return null;
    const { data, width, height } = node.pixels;
    const px = Math.min(width - 1, Math.floor((fx - node.x) * width));
    const py = Math.min(height - 1, Math.floor((1 - (fy - node.y)) * height)); // stored bottom-up
    const i = (py * width + px) * 4;
    return [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
  }

  // ----- loading -----
  const queue = new Set();
  let loading = 0;
  function request(node) {
    if (node.state !== "none") return;
    node.state = "queued";
    queue.add(node);
  }
  async function load(node) {
    loading++;
    node.state = "loading";
    try {
      const res = await fetch(IMAGERY(node.z, node.x, node.y), { mode: "cors" });
      if (!res.ok) throw new Error(res.status);
      const bmp = await createImageBitmap(await res.blob(), { imageOrientation: "flipY" });
      if (node.state !== "loading") { bmp.close?.(); return; }
      if (node.z === FOREST_Z && typeof OffscreenCanvas !== "undefined") {
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const cx = c.getContext("2d", { willReadFrequently: true });
        cx.drawImage(bmp, 0, 0);
        node.pixels = cx.getImageData(0, 0, bmp.width, bmp.height);
        pixelTiles.set(node.x + "," + node.y, node);
      }
      const tex = new Texture(bmp);
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = anisotropy;
      tex.minFilter = LinearMipmapLinearFilter;
      tex.magFilter = LinearFilter;
      tex.flipY = false;
      tex.needsUpdate = true;
      node.tex = tex;
      node.state = "ready";
      if (node.mesh) {
        node.mesh.material.uniforms.map.value = tex;
        node.mesh.material.uniforms.useBase.value = 0;
      }
      stats.loaded++;
    } catch {
      if (node.state === "loading") node.state = "failed";
      stats.failed++;
    } finally {
      loading--;
    }
  }
  const camPos = new Vector3();
  function pump() {
    if (!queue.size || loading >= MAX_LOADS) return;
    const list = [...queue].sort((a, b) => a.box.distanceToPoint(camPos) / a.size - b.box.distanceToPoint(camPos) / b.size);
    for (const node of list) {
      if (loading >= MAX_LOADS) break;
      queue.delete(node);
      load(node);
    }
  }

  // ----- roots over the survey -----
  const roots = [];
  {
    const [lw, ls] = toLonLat(bounds.x0, bounds.z1);
    const [le, ln] = toLonLat(bounds.x1, bounds.z0);
    for (let x = Math.floor(lon2x(lw, ROOT_Z)); x <= Math.floor(lon2x(le, ROOT_Z)); x++)
      for (let y = Math.floor(lat2y(ln, ROOT_Z)); y <= Math.floor(lat2y(ls, ROOT_Z)); y++) roots.push(makeNode(ROOT_Z, x, y, null));
  }
  roots.forEach(request);

  // ----- per-frame selection -----
  const frustum = new Frustum();
  const pv = new Matrix4();
  let frame = 0;
  const shown = new Set();
  let next = new Set();
  const ready = (n) => n.state === "ready" || n.state === "failed";
  let budgetEnd = 0;
  function visit(node) {
    if (!frustum.intersectsBox(node.box)) return;
    node.used = frame;
    const dist = node.box.distanceToPoint(camPos);
    if (node.z < MAX_Z && dist < node.size * SPLIT) {
      if (!node.children) {
        const { z, x, y } = node;
        node.children = [
          makeNode(z + 1, 2 * x, 2 * y, node), makeNode(z + 1, 2 * x + 1, 2 * y, node),
          makeNode(z + 1, 2 * x, 2 * y + 1, node), makeNode(z + 1, 2 * x + 1, 2 * y + 1, node),
        ];
      }
      for (const c of node.children) { c.used = frame; request(c); }
      if (node.children.every(ready)) {
        // Build the children's meshes within this frame's budget; until all four exist,
        // the parent keeps standing in for them, so there is never a hole.
        for (const c of node.children) if (!c.mesh && performance.now() < budgetEnd) buildMesh(c);
        if (node.children.every((c) => c.mesh)) { node.children.forEach(visit); return; }
      }
    }
    if (!node.mesh) buildMesh(node);
    next.add(node);
  }
  function dispose(node) {
    if (node.children) node.children.forEach(dispose);
    node.children = null;
    queue.delete(node);
    if (node.mesh) { group.remove(node.mesh); node.mesh.geometry.dispose(); node.mesh.material.dispose(); node.mesh = null; }
    if (node.tex) { node.tex.image?.close?.(); node.tex.dispose(); node.tex = null; }
    node.state = "gone";
    if (node.pixels) pixelTiles.delete(node.x + "," + node.y);
    node.pixels = null;
    onDispose?.(node);
  }
  function prune(node) {
    if (!node.children) return;
    if (frame - node.used > 240) {
      node.children.forEach(dispose);
      node.children = null;
      return;
    }
    node.children.forEach(prune);
  }

  const stats = { loaded: 0, failed: 0, get pending() { return queue.size + loading; } };
  function update() {
    frame++;
    camPos.copy(camera.position);
    camera.updateMatrixWorld();
    pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    next = new Set();
    budgetEnd = performance.now() + 4;
    roots.forEach(visit);
    for (const n of shown) if (!next.has(n) && n.mesh) n.mesh.visible = false;
    for (const n of next) n.mesh.visible = true;
    shown.clear();
    next.forEach((n) => shown.add(n));
    pump();
    if (frame % 60 === 0) roots.forEach(prune);
  }

  // Ready tiles at the forest level near a point.
  function forestTiles(p, radius) {
    const out = [];
    const walk = (n) => {
      if (n.box.distanceToPoint(p) > radius) return;
      if (n.z === FOREST_Z) { if (n.pixels) out.push(n); return; }
      n.children?.forEach(walk);
    };
    roots.forEach(walk);
    return out;
  }

  return { group, uniforms: shared, update, stats, forestTiles, sampleColor };
}
