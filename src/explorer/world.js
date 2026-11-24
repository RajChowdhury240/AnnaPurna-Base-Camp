// Renderer, streamed terrain, sky and the walked line.
import {
  WebGLRenderer, Scene, BufferGeometry, BufferAttribute, Group, PerspectiveCamera, Mesh, TextureLoader,
  SRGBColorSpace, Color, SphereGeometry, ShaderMaterial, BackSide, Vector3, PlaneGeometry, MeshBasicMaterial,
  NeutralToneMapping, DoubleSide, FogExp2, HemisphereLight, DirectionalLight, WebGLRenderTarget, HalfFloatType,
  Vector2, MathUtils,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import satelliteUrl from "../terrain/sentinel.webp?inline";
import { ground, bounds } from "./terrain.js";
import { createTiles, IMAGERY_CREDIT, CLOUD_GLSL } from "./tiles.js";

export { satelliteUrl, IMAGERY_CREDIT };

export const LIGHTS = {
  day: {
    zenith: "#1d5596", mid: "#5f93c9", horizon: "#c9dcea", below: "#b5c8d6",
    fog: "#b9cfe2", fogSun: "#efe6d6", density: 0.026,
    sun: [0.42, 0.72, 0.55], sunColor: "#fff2de", ambient: "#bfcfe3", relief: 0.42,
    grade: [1.02, 1.0, 0.97], glow: "#fff6e6",
  },
  golden: {
    zenith: "#1f3f6e", mid: "#6f8fb7", horizon: "#f2c28e", below: "#c9a88e",
    fog: "#d8bc9e", fogSun: "#ffc98a", density: 0.03,
    sun: [-0.88, 0.16, 0.22], sunColor: "#ffbe7a", ambient: "#8fa3c4", relief: 0.72,
    grade: [1.1, 0.95, 0.82], glow: "#ffcf8a",
  },
};

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w;
}`;
const skyFrag = /* glsl */ `
uniform vec3 zenith; uniform vec3 mid; uniform vec3 horizon; uniform vec3 below; uniform vec3 sunDir; uniform vec3 glow;
uniform vec3 cloudLit; uniform vec3 cloudShade;
varying vec3 vDir;
${CLOUD_GLSL}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float hh = clamp(h, 0.0, 1.0);
  // Rayleigh-like falloff: pale at the horizon, deep blue overhead (thin Himalayan air).
  vec3 col = mix(horizon, mid, 1.0 - exp(-hh * 9.0));
  col = mix(col, zenith, smoothstep(0.08, 0.9, hh));
  col = mix(col, below, smoothstep(0.0, -0.06, h));
  float s = max(dot(d, normalize(sunDir)), 0.0);
  vec3 sun = glow * (smoothstep(0.99965, 0.9999, s) * 14.0 + pow(s, 256.0) * 0.7 + pow(s, 64.0) * 0.45 + pow(s, 6.0) * 0.14);
  // A layer of cloud high above the peaks, lit from the sun's side.
  if (h > 0.0) {
    float t = (CLOUD_Y - cameraPosition.y) / max(h, 0.015);
    vec2 p = cameraPosition.xz + d.xz * t;
    float dens = cloudDensity(p);
    if (dens > 0.0) {
      float toward = cloudDensity(p + normalize(sunDir.xz + 1e-4) * 1.6);
      float lit = clamp(0.62 + (dens - toward) * 2.2, 0.2, 1.2);
      vec3 cc = mix(cloudShade, cloudLit, lit);
      cc += glow * pow(s, 10.0) * 0.6 * (1.0 - dens); // silver lining toward the sun
      float a = dens * smoothstep(0.0, 0.09, h) * 0.92;
      col = mix(col, cc, a);
      sun *= 1.0 - a * 0.85;
    }
  }
  gl_FragColor = vec4(col + sun, 1.0);
  #include <colorspace_fragment>
}`;

// The sun over the Sanctuary on the day of the visit: latitude 28.5 N, late November.
export function sunAt(hour) {
  const lat = MathUtils.degToRad(28.5), dec = MathUtils.degToRad(-20.3);
  const H = MathUtils.degToRad(15 * (hour - 12));
  const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) + Math.PI;
  return { el, dir: new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)) };
}

export function createWorld(canvas, { lite }) {
  const renderer = new WebGLRenderer({
    canvas, antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer: true,
  });
  // Render scale adapts to the machine (see render); start a notch below the screen's density.
  const maxRatio = Math.min(devicePixelRatio, lite ? 1.5 : 2);
  let ratio = Math.min(maxRatio, lite ? 1 : 1.25);
  renderer.setPixelRatio(ratio);
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  const camera = new PerspectiveCamera(55, 1, 0.0006, 400);
  // Only the trail lines and the apron use scene fog; the terrain shades its own haze.
  scene.fog = new FogExp2("#b9cfe2", 0.012);

  // Lights for the trees; the terrain shades itself.
  const hemi = new HemisphereLight("#cfe0f2", "#4b5a3c", 0.95);
  const sunLight = new DirectionalLight("#fff2de", 1.5);
  scene.add(hemi, sunLight);

  const sky = new Mesh(
    new SphereGeometry(300, 48, 24),
    new ShaderMaterial({
      vertexShader: skyVert, fragmentShader: skyFrag, side: BackSide, depthWrite: false,
      uniforms: {
        zenith: { value: new Color() }, mid: { value: new Color() }, horizon: { value: new Color() },
        below: { value: new Color() }, sunDir: { value: new Vector3() }, glow: { value: new Color() },
        cloudLit: { value: new Color() }, cloudShade: { value: new Color() },
        cloudTime: null, cloudCover: null,
      },
    }),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);

  // The 20 m survey mosaic stands in for each tile until its aerial photograph arrives.
  let baseLoaded, baseFailed;
  const ready = new Promise((resolve, reject) => { baseLoaded = resolve; baseFailed = reject; });
  const baseTexture = new TextureLoader().load(satelliteUrl, baseLoaded, undefined, baseFailed);
  baseTexture.colorSpace = SRGBColorSpace;
  baseTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const tiles = createTiles({ renderer, camera, baseTexture, lite });
  scene.add(tiles.group);
  sky.material.uniforms.cloudTime = tiles.uniforms.cloudTime;
  sky.material.uniforms.cloudCover = tiles.uniforms.cloudCover;

  // Camera finish: a soft bloom on the sun and sunlit snow, filmic highlight roll-off.
  let composer, bloom;
  if (!lite && renderer.extensions.has("EXT_color_buffer_float")) {
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new Vector2(1, 1), 0.22, 0.45, 0.98);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }
  let composerRatio = renderer.getPixelRatio();

  // A low apron beyond the survey so its edge dissolves into haze.
  const apron = new Mesh(
    new PlaneGeometry(800, 800).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ color: "#56664f" }),
  );
  apron.position.set((bounds.x0 + bounds.x1) / 2, 0.2, (bounds.z0 + bounds.z1) / 2);
  scene.add(apron);

  // ----- the walked line -----
  const aerialTrail = new Group(), groundTrail = new Group();
  scene.add(aerialTrail, groundTrail);
  function ribbon(samples, width, lift, sub = 4) {
    // A faint strip on the ground at your feet; brighter and a little wider further off,
    // so the route can be followed up the valley without painting over the photograph.
    // `samples` may be an array of points or a densePath (typed x/z arrays + count).
    const n = samples.count ?? samples.length;
    const arrays = samples.x !== undefined;
    const point = (i) => arrays ? [samples.x[i], samples.z[i]] : [samples[i].x, samples[i].z];
    const dense = [];
    for (let i = 0; i < n; i++) {
      const a = point(i);
      dense.push(a);
      if (i < n - 1) {
        const b = point(i + 1);
        for (let k = 1; k < sub; k++) dense.push([a[0] + ((b[0] - a[0]) * k) / sub, a[1] + ((b[1] - a[1]) * k) / sub]);
      }
    }
    const pos = new Float32Array(dense.length * 6);
    const spread = new Float32Array(dense.length * 6);
    const idx = [];
    for (let i = 0; i < dense.length; i++) {
      const p = dense[Math.max(0, i - 1)], n = dense[Math.min(dense.length - 1, i + 1)];
      const dx = n[0] - p[0], dz = n[1] - p[1];
      const l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l;
      const ox = (nx * width) / 2, oz = (nz * width) / 2;
      const [x, z] = dense[i];
      pos.set([x + ox, ground(x + ox, z + oz) + lift, z + oz, x - ox, ground(x - ox, z - oz) + lift, z - oz], i * 6);
      spread.set([nx, nz, 1, nx, nz, -1], i * 6);
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("spread", new BufferAttribute(spread, 3));
    g.setIndex(idx);
    const m = new MeshBasicMaterial({ color: "#ffd18c", side: DoubleSide, transparent: true, depthWrite: false, fog: false });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.halfWidth = { value: width / 2 };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec3 spread;\nuniform float halfWidth;\nvarying float vDist;\nvarying float vEdge;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
float camDist = distance(position, cameraPosition);
float extra = halfWidth * clamp(camDist * 5.0 - 0.1, 0.0, 4.0);
transformed.xz += spread.xy * spread.z * extra;
transformed.y += extra * 0.7;
vDist = camDist;
vEdge = spread.z;`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vDist;\nvarying float vEdge;")
        .replace("#include <color_fragment>", `#include <color_fragment>
float far = smoothstep(0.02, 0.25, vDist);
float soft = 1.0 - smoothstep(0.45, 1.0, abs(vEdge));
diffuseColor.rgb = mix(vec3(1.0, 0.95, 0.86), diffuseColor.rgb, far);
// The built stone path takes over within a few hundred metres.
diffuseColor.a = 0.62 * soft * smoothstep(0.26, 0.4, vDist) * (1.0 - smoothstep(4.0, 9.0, vDist));`);
    };
    const mesh = new Mesh(g, m);
    mesh.renderOrder = 6;
    mesh.frustumCulled = false;
    groundTrail.add(mesh);
  }

  const lines = [];
  let xrayLines = [];
  function setTrail(samples, groundSamples) {
    // The draped ribbon follows the same smoothed line as the stone path (2 m samples),
    // while the aerial line stays a light 20 m polyline.
    ribbon(groundSamples || samples, 0.0018, 0.0007, groundSamples ? 1 : 4);
    const pts = [];
    for (const s of samples) pts.push(s.x, ground(s.x, s.z) + 0.004, s.z);
    const make = (opts, order) => {
      const g = new LineGeometry();
      g.setPositions(pts);
      const m = new LineMaterial({ worldUnits: false, transparent: true, ...opts });
      const l = new Line2(g, m);
      l.computeLineDistances();
      l.renderOrder = order;
      l.frustumCulled = false;
      aerialTrail.add(l);
      lines.push(l);
      return l;
    };
    xrayLines = [
      make({ color: 0xffe2b0, linewidth: 1.5, opacity: 0.4, depthTest: false, depthWrite: false, dashed: true, dashSize: 0.08, gapSize: 0.08, fog: false }, 3),
    ];
    make({ color: 0x1a1206, linewidth: 5, opacity: 0.35, fog: false }, 4);
    make({ color: 0xffc46a, linewidth: 2.4, opacity: 0.95, fog: false }, 5);
  }

  let trailOn = true, trailGround = false, trailHigh = true;
  function applyTrail() {
    groundTrail.visible = trailOn && trailGround;
    aerialTrail.visible = trailOn && !trailGround;
    for (const l of xrayLines) l.visible = trailHigh;
  }
  // On foot the draped strip reads best; from above, the screen-space line.
  function setTrailMode(onGround, high = !onGround) {
    trailGround = onGround;
    trailHigh = high;
    applyTrail();
  }
  function showTrail(on) {
    trailOn = on;
    applyTrail();
  }

  const mixC = (a, b, k) => new Color(a).lerp(new Color(b), k);
  const sunDir = new Vector3();
  let sunEl = 0.6;
  function setSun(hour) {
    const { el, dir } = sunAt(hour);
    sunEl = el;
    sunDir.copy(dir);
    // Golden near the horizon, clear daylight once the sun is above about 22 degrees.
    const k = MathUtils.smoothstep(MathUtils.radToDeg(el), 2, 24);
    const D = LIGHTS.day, G = LIGHTS.golden;
    const c = (key) => mixC(G[key], D[key], k);
    const u = sky.material.uniforms;
    u.zenith.value.copy(c("zenith"));
    u.mid.value.copy(c("mid"));
    u.horizon.value.copy(c("horizon"));
    u.below.value.copy(c("below"));
    u.glow.value.copy(c("glow"));
    u.sunDir.value.copy(dir);
    u.cloudLit.value.copy(mixC("#ffd2a0", "#ffffff", k));
    u.cloudShade.value.copy(mixC("#6f6f86", "#a9b5c4", k));
    const t = tiles.uniforms;
    t.sunDir.value.copy(dir);
    t.sunColor.value.copy(c("sunColor"));
    t.ambientColor.value.copy(c("ambient"));
    t.fogColor.value.copy(c("fog"));
    t.fogSun.value.copy(c("fogSun"));
    t.fogDensity.value = MathUtils.lerp(G.density, D.density, k);
    t.relief.value = MathUtils.lerp(G.relief, D.relief, k);
    t.grade.value.setRGB(...G.grade.map((g, i) => MathUtils.lerp(g, D.grade[i], k)));
    // Hold a touch more highlight detail in the golden light; keep bloom subtle by day.
    renderer.toneMappingExposure = MathUtils.lerp(1.06, 1.0, k);
    if (bloom) bloom.strength = MathUtils.lerp(0.33, 0.26, k);
    scene.fog.color.copy(c("fog"));
    scene.fog.density = t.fogDensity.value * 0.55;
    sunLight.position.copy(dir).multiplyScalar(50);
    sunLight.color.copy(c("sunColor"));
    sunLight.intensity = MathUtils.lerp(1.7, 1.5, k);
    hemi.color.copy(mixC("#9fb0cf", "#cfe0f2", k));
    hemi.groundColor.copy(mixC("#5a4636", "#4b5a3c", k));
    hemi.intensity = MathUtils.lerp(0.6, 0.95, k);
    apron.material.color.copy(mixC("#6b5a48", "#56664f", k));
    return k;
  }
  setSun(10.5);

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const l of lines) l.material.resolution.set(w, h);
    const pr = renderer.getPixelRatio();
    if (pr !== composerRatio) { composer?.setPixelRatio(pr); composerRatio = pr; }
    composer?.setSize(w, h);
  }

  // Adaptive resolution. A single slow frame must not soften the image: require a run of
  // sustained slow (or fast) frames, then a long cooldown, so the scale settles instead of
  // pumping between steps while the camera moves.
  let avg = 16, cooldown = 45, slow = 0, fast = 0;
  function adapt(dtMs) {
    avg += (Math.min(dtMs, 100) - avg) * 0.05;
    if (cooldown > 0) { cooldown--; return; }
    slow = avg > 20 ? slow + 1 : 0;
    fast = avg < 14.5 ? fast + 1 : 0;
    let next = ratio;
    if (slow > 24 && ratio > 0.7) {
      next = Math.max(0.7, ratio - 0.12);
      slow = fast = 0;
      cooldown = 90;
    } else if (fast > 90 && ratio < maxRatio) {
      next = Math.min(maxRatio, ratio + 0.08);
      slow = fast = 0;
      cooldown = 120;
    }
    if (next !== ratio) {
      ratio = next;
      renderer.setPixelRatio(ratio);
      resize();
    }
  }

  function render(dtMs) {
    if (dtMs) adapt(dtMs);
    sky.position.copy(camera.position);
    tiles.update();
    tiles.uniforms.cloudTime.value = performance.now() / 1000;
    if (composer && ratio > 0.95) composer.render();
    else renderer.render(scene, camera);
  }

  return { renderer, scene, camera, ready, tiles, setTrail, setTrailMode, showTrail, setSun, sunDir, resize, render };
}
