import "@fontsource-variable/dm-sans/wght.css";
import "@fontsource/baskervville/latin-400.css";
import "@fontsource/baskervville/latin-400-italic.css";
import "./style.css";
import { Vector3, Quaternion, Euler, MathUtils } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { stops, sources, elevation } from "../data.js";
import { icon, logo } from "../icons.js";
import { createWorld, satelliteUrl, IMAGERY_CREDIT } from "./world.js";
import { createForest } from "./forest.js";
import { createCover } from "./cover.js";
import { createMilestones } from "./milestone.js";
import { ground, bounds, trailSamples, stopXZ, peaks, toXZ, imageUV, densePath } from "./terrain.js";
import { createPathway } from "./pathway.js";

const $ = (s) => document.querySelector(s);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = matchMedia("(pointer: coarse)").matches;
const lite = matchMedia("(max-width: 800px)").matches || coarse;
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const km = (d) => (d < 1 ? Math.round(d * 1000) + " m" : d.toFixed(1) + " km");
const short = (s) => s.short || s.name;

document.querySelectorAll("[data-icon]").forEach((el) => (el.innerHTML = icon(el.dataset.icon, 18)));
document.querySelectorAll("[data-logo]").forEach((el) => (el.innerHTML = logo));

// ---------- world ----------
const canvas = $("#scene");
let world;
try {
  world = createWorld(canvas, { lite });
} catch (e) {
  $("#loader").hidden = true;
  $("#fallback").hidden = false;
  throw e;
}
const { camera } = world;
$("#loader-bar").style.width = "55%";

const trail = trailSamples();
const total = trail.at(-1).d;
// The ground ribbon uses the same smooth 2 m line as the stone path, so it stays
// centred on the paving around switchbacks; the aerial overlay keeps the light line.
world.setTrail(trail, densePath(0.002));
const forest = createForest({ scene: world.scene, tiles: world.tiles, lite, sun: world.sunDir });
// The path as built stone, and a 2 m copy of the line to keep grass and trees off it.
const path = densePath();
const fine = [];
for (let i = 0; i < path.count; i += 4) fine.push({ x: path.x[i], z: path.z[i] });
const pathway = createPathway({ scene: world.scene, path, sun: world.sunDir, stoneTexture: world.tiles.stoneTexture, lite });
const grass = createCover({ scene: world.scene, tiles: world.tiles, trail: fine, lite, sun: world.sunDir });
const stopPos = stopXZ().map(([x, z]) => new Vector3(x, ground(x, z), z));
const stopD = stopPos.map((p) => nearestOnTrail(p.x, p.z).d);
const peakPos = peaks.map((p) => {
  const [x, z] = toXZ(p.at);
  return new Vector3(x, ground(x, z), z);
});
const goal = stopPos.at(-1);

function nearestOnTrail(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < trail.length; i += 3) {
    const d = (trail[i].x - x) ** 2 + (trail[i].z - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  for (let i = Math.max(0, best - 3); i < Math.min(trail.length, best + 4); i++) {
    const d = (trail[i].x - x) ** 2 + (trail[i].z - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return { ...trail[best], i: best, off: Math.sqrt(bd) };
}
function atDistance(d) {
  d = MathUtils.clamp(d, 0, total);
  let lo = 0, hi = trail.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (trail[m].d < d) lo = m; else hi = m;
  }
  const a = trail[lo], b = trail[hi];
  const t = b.d === a.d ? 0 : (d - a.d) / (b.d - a.d);
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}
const yawToward = (dx, dz) => Math.atan2(-dx, -dz);
// Signposts at every stop and the welcome board at base camp, facing the way you arrive.
const milestones = createMilestones({
  scene: world.scene,
  spots: stops.map((s, i) => {
    const d = i === stops.length - 1 ? total : stopD[i];
    const p = atDistance(d), b = atDistance(d - 0.04);
    return { name: short(s), height: s.height, x: p.x, z: p.z, yaw: yawToward(p.x - b.x, p.z - b.z), main: i === stops.length - 1 };
  }),
});

// ---------- state ----------
const state = {
  mode: "aerial",
  light: "day",
  tween: null,
  walker: { x: stopPos[0].x, z: stopPos[0].z, y: stopPos[0].y + 0.002, eye: 0.0022, yaw: 0, pitch: 0.04 },
  auto: { on: false, d: 0, speed: 1, lastLook: -1e9 },
  panel: -1,
  visited: new Set(),
};
{
  const a = atDistance(0.25);
  state.walker.yaw = yawToward(a.x - state.walker.x, a.z - state.walker.z);
}

// ---------- aerial orbit ----------
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.dampingFactor = 0.09;
orbit.minDistance = 1.2;
orbit.maxDistance = 60;
orbit.maxPolarAngle = Math.PI * 0.47;
orbit.rotateSpeed = 0.6;
orbit.zoomSpeed = 0.9;
orbit.screenSpacePanning = false;
orbit.keys = {};

function homeView() {
  const narrow = innerWidth < 720;
  const target = new Vector3(-1.3, 3.3, 4.6);
  const position = new Vector3(narrow ? 16 : 11.5, narrow ? 20 : 14.5, narrow ? 30 : 22);
  return { target, position };
}
{
  const h = homeView();
  orbit.target.copy(h.target);
  camera.position.copy(h.position);
  orbit.update();
}

// ---------- camera tween ----------
const qa = new Quaternion(), qb = new Quaternion(), pa = new Vector3(), pb = new Vector3();
const euler = new Euler(0, 0, 0, "YXZ");
const ease = (t) => 1 - Math.pow(1 - t, 3.2);
function tweenTo(position, quat, duration, done) {
  if (reduced) duration = 0;
  pa.copy(camera.position);
  qa.copy(camera.quaternion);
  state.tween = { from: pa.clone(), to: position.clone(), qFrom: qa.clone(), qTo: quat.clone(), t: 0, duration, done };
}
function lookQuat(from, to) {
  const m = camera.clone();
  m.position.copy(from);
  m.lookAt(to);
  return m.quaternion.clone();
}
function walkerQuat() {
  euler.set(state.walker.pitch, state.walker.yaw, 0, "YXZ");
  return new Quaternion().setFromEuler(euler);
}
function walkerCamPos() {
  const w = state.walker;
  return new Vector3(w.x, ground(w.x, w.z) + w.eye, w.z);
}

// ---------- modes ----------
function setMode(mode, opts = {}) {
  if (mode === state.mode && !opts.force) return;
  state.mode = mode;
  $("#mode-aerial").setAttribute("aria-pressed", String(mode === "aerial"));
  $("#mode-walk").setAttribute("aria-pressed", String(mode === "walk"));
  document.body.dataset.mode = mode;
  $("#hint").hidden = mode !== "walk" || coarse;
  $("#touch-pad").hidden = mode !== "walk" || !coarse;
  world.scene.fog.density = mode === "walk" ? 0.0125 : 0.0095;
  if (mode === "walk") {
    if (!state.walkStart) state.walkStart = performance.now();
    orbit.enabled = false;
    if (!opts.keepWalker) {
      // Drop in at the point on the ground the aerial view was looking at.
      const t = orbit.target;
      const near = nearestOnTrail(t.x, t.z);
      const spot = near.off < 2.5 ? near : { x: t.x, z: t.z };
      const ahead = atDistance((near.d ?? 0) + 0.25);
      Object.assign(state.walker, {
        x: spot.x, z: spot.z, eye: 0.003, pitch: 0.05,
        yaw: near.off < 2.5 ? yawToward(ahead.x - spot.x, ahead.z - spot.z) : state.walker.yaw,
      });
    }
    state.walker.y = ground(state.walker.x, state.walker.z) + state.walker.eye;
    tweenTo(walkerCamPos(), walkerQuat(), opts.instant ? 0 : 1.9);
    canvas.focus({ preventScroll: true });
  } else {
    stopAuto();
    const w = state.walker;
    const target = new Vector3(w.x, ground(w.x, w.z), w.z);
    const back = new Vector3(Math.sin(w.yaw), 0, Math.cos(w.yaw)).multiplyScalar(5.5);
    const pos = target.clone().add(back).add(new Vector3(0, 4.2, 0));
    tweenTo(pos, lookQuat(pos, target), opts.instant ? 0 : 1.6, () => {
      orbit.target.copy(target);
      orbit.enabled = true;
      orbit.update();
    });
    orbit.enabled = false;
  }
}

function flyAerialTo(target, dist = 6) {
  if (state.mode !== "aerial") setMode("aerial");
  const dir = camera.position.clone().sub(orbit.target).setY(0).normalize();
  if (!isFinite(dir.x)) dir.set(0.6, 0, 0.8);
  const pos = target.clone().add(dir.multiplyScalar(dist * 0.8)).add(new Vector3(0, dist * 0.62, 0));
  orbit.enabled = false;
  tweenTo(pos, lookQuat(pos, target), 1.5, () => {
    orbit.target.copy(target);
    orbit.enabled = true;
    orbit.update();
  });
}

function placeWalker(x, z, yaw, eye = 0.0021, pitch = 0.04) {
  Object.assign(state.walker, { x, z, yaw, pitch, eye });
  if (state.mode !== "walk") setMode("walk", { keepWalker: true });
  else tweenTo(walkerCamPos(), walkerQuat(), 1.1);
}
function walkFromStop(i) {
  // Stand on the walked line itself, at the point closest to the stop.
  const p = glideAt(stopD[i]);
  const heading = trailHeading(stopD[i], p);
  stopAuto();
  state.auto.d = stopD[i];
  placeWalker(p.x, p.z, heading.yaw, 0.0021, heading.pitch);
}

// ---------- auto walk along the trail ----------
function startAuto() {
  if (state.mode !== "walk") {
    const near = nearestOnTrail(state.walker.x, state.walker.z);
    state.auto.d = near.off < 0.4 ? near.d : 0;
    const p = glideAt(state.auto.d), heading = trailHeading(state.auto.d, p);
    Object.assign(state.walker, { x: p.x, z: p.z, ...heading, eye: 0.0021 });
    setMode("walk", { keepWalker: true });
  } else {
    const near = nearestOnTrail(state.walker.x, state.walker.z);
    state.auto.d = near.d >= total - 0.05 ? 0 : near.d;
    if (near.off > 0.05) {
      const p = glideAt(state.auto.d);
      tweenTo(new Vector3(p.x, ground(p.x, p.z) + state.walker.eye, p.z), walkerQuat(), 0.9);
      Object.assign(state.walker, { x: p.x, z: p.z });
    }
  }
  state.auto.on = true;
  syncPlay();
}
function stopAuto() {
  if (!state.auto.on) return;
  state.auto.on = false;
  syncPlay();
}
function syncPlay() {
  const b = $("#play");
  b.setAttribute("aria-pressed", String(state.auto.on));
  b.querySelector("[data-icon]").innerHTML = icon(state.auto.on ? "pause" : "play", 18);
  $("#play-label").textContent = state.auto.on ? "Pause" : "Walk the trail";
}

// ---------- input ----------
const keys = new Set();
const typing = (e) => /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
addEventListener("keydown", (e) => {
  if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "escape") {
    if (!$("#milestone").hidden) closeMilestone();
    else if (!$("#help").hidden) toggleHelp(false);
    else if (state.panel >= 0) closePanel();
    return;
  }
  if (e.target.closest?.(".panel, .help, .dock button, .top button") && (k === " " || k === "enter")) return;
  if (k === "v") return setMode(state.mode === "walk" ? "aerial" : "walk");
  if (k === " ") { e.preventDefault(); return state.auto.on ? stopAuto() : startAuto(); }
  if (k === "]" || k === "[") return stepStop(k === "]" ? 1 : -1);
  if (state.mode !== "walk") return;
  if (["w", "a", "s", "d", "q", "e", "shift", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
    if (k.startsWith("arrow")) e.preventDefault();
    if (k !== "shift" && k !== "q" && k !== "e") stopAuto();
    keys.add(k);
  }
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
addEventListener("blur", () => keys.clear());

// Drag to look in walk mode (the orbit handles aerial).
let drag = null;
canvas.addEventListener("pointerdown", (e) => {
  if (state.mode !== "walk" || state.tween) return;
  drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add("grabbing");
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const s = (coarse ? 0.0058 : 0.0042) * (camera.fov / 55);
  state.walker.yaw += (e.clientX - drag.x) * s;
  state.walker.pitch = MathUtils.clamp(state.walker.pitch + (e.clientY - drag.y) * s, -1.25, 1.25);
  drag.x = e.clientX;
  drag.y = e.clientY;
  state.auto.lastLook = performance.now();
});
const endDrag = () => { drag = null; canvas.classList.remove("grabbing"); };
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener("wheel", (e) => {
  if (state.mode !== "walk") return;
  e.preventDefault();
  camera.fov = MathUtils.clamp(camera.fov + e.deltaY * 0.03, 22, 80);
  camera.updateProjectionMatrix();
}, { passive: false });
orbit.addEventListener("start", () => { state.tween = null; });

// Touch: a stick for walking, two buttons for height.
const stick = { x: 0, y: 0, id: null };
{
  const el = $("#stick"), knob = $("#stick-knob");
  const move = (e) => {
    const r = el.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    stick.x = dx; stick.y = dy;
    knob.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
  };
  el.addEventListener("pointerdown", (e) => { stick.id = e.pointerId; el.setPointerCapture(e.pointerId); stopAuto(); move(e); });
  el.addEventListener("pointermove", (e) => e.pointerId === stick.id && move(e));
  const end = () => { stick.id = null; stick.x = stick.y = 0; knob.style.transform = ""; };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  const hold = (btn, k) => {
    btn.addEventListener("pointerdown", () => keys.add(k));
    ["pointerup", "pointerleave", "pointercancel"].forEach((t) => btn.addEventListener(t, () => keys.delete(k)));
  };
  hold($("#rise"), "e");
  hold($("#lower"), "q");
}

// ---------- labels ----------
const labelHost = $("#labels");
const labels = [];
stops.forEach((s, i) => {
  const b = document.createElement("button");
  b.className = "label stop" + (i === 0 ? " start" : "") + (i === stops.length - 1 ? " end" : "");
  b.innerHTML = `<i></i><span><b>${short(s)}</b><small>${elevation(s)}</small></span>`;
  b.setAttribute("aria-label", `${s.name}, ${elevation(s)}. Open stop details`);
  b.onclick = () => openPanel(i);
  labelHost.append(b);
  labels.push({ el: b, pos: stopPos[i], lift: 0.012, kind: "stop", phase: i % 4 });
});
peaks.forEach((p, i) => {
  const el = document.createElement("div");
  el.className = "label peak";
  el.innerHTML = `<span><b>${p.name}</b><small>${fmt(p.height)} m</small></span><i></i>`;
  labelHost.append(el);
  labels.push({ el, pos: peakPos[i], lift: 0.02, kind: "peak", phase: i % 4 });
});
const proj = new Vector3();
let labelFrame = 0;
function updateLabels() {
  labelFrame++;
  const cam = camera.position;
  const w = innerWidth, h = innerHeight;
  for (const L of labels) {
    proj.copy(L.pos);
    proj.y += L.lift;
    const dist = proj.distanceTo(cam);
    proj.project(camera);
    let visible = proj.z < 1 && Math.abs(proj.x) < 1.05 && Math.abs(proj.y) < 1.05;
    const far = L.kind === "stop" ? (state.mode === "walk" ? 9 : 70) : 120;
    if (dist > far) visible = false;
    const sy = ((1 - proj.y) / 2) * h;
    if (sy < (L.kind === "peak" ? 140 : 84) || sy > h - 120) visible = false;
    // Line of sight is re-checked every few frames, staggered across labels.
    if (visible && (labelFrame + L.phase) % 4 !== 0 && L.los !== undefined) visible = L.los;
    else if (visible) {
      // Line of sight across the survey.
      const n = Math.min(60, 12 + Math.floor(dist * 3));
      for (let s = 1; s < n; s++) {
        const t = s / n;
        const x = L.pos.x + (cam.x - L.pos.x) * t, z = L.pos.z + (cam.z - L.pos.z) * t;
        const y = L.pos.y + L.lift + (cam.y - L.pos.y - L.lift) * t;
        if (ground(x, z) > y + 0.004) { visible = false; break; }
      }
      L.los = visible;
    }
    if (L.el.hidden === visible) L.el.hidden = !visible;
    if (visible) {
      L.el.style.transform = `translate3d(${((proj.x + 1) / 2) * w}px, ${((1 - proj.y) / 2) * h}px, 0)`;
      L.el.style.opacity = state.mode === "walk" && L.kind === "stop" ? String(MathUtils.clamp(1.4 - dist / 8, 0.35, 1)) : "";
    }
  }
}

// ---------- compass ----------
const tape = $("#compass-tape");
{
  const names = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
  let html = "";
  for (let rep = -1; rep <= 1; rep++)
    for (let d = 0; d < 360; d += 15) {
      const deg = d + rep * 360;
      html += names[d] !== undefined
        ? `<span class="c-name${d % 90 ? "" : " major"}" style="left:${deg * 2}px">${names[d]}</span>`
        : `<span class="c-tick" style="left:${deg * 2}px"></span>`;
    }
  tape.innerHTML = html;
}
const bearingOf = () => {
  const dir = new Vector3();
  camera.getWorldDirection(dir);
  return (MathUtils.radToDeg(Math.atan2(dir.x, -dir.z)) + 360) % 360;
};
const cardinal = (b) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(b / 45) % 8];

// ---------- elevation profile ----------
const elevs = trail.map((t) => t.y);
const eMin = Math.min(...elevs), eMax = Math.max(...elevs);
const px = (d) => (d / total) * 1000;
const py = (y) => 92 - ((y - eMin) / (eMax - eMin)) * 80;
{
  let line = "";
  for (let i = 0; i < trail.length; i += 4) line += (i ? "L" : "M") + px(trail[i].d).toFixed(1) + " " + py(trail[i].y).toFixed(1);
  line += "L" + px(total) + " " + py(trail.at(-1).y);
  $("#profile-svg").innerHTML = `
    <defs><linearGradient id="pf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3a53b" stop-opacity=".34"/><stop offset="1" stop-color="#f3a53b" stop-opacity="0"/></linearGradient></defs>
    <path d="${line}L1000 100L0 100Z" fill="url(#pf)"/>
    <path d="${line}" fill="none" stroke="#f3a53b" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
    <path id="profile-done" d="${line}" fill="none" stroke="#fff" stroke-width="2.4" vector-effect="non-scaling-stroke" />`;
  $("#profile-stops").innerHTML = stops
    .map((s, i) => `<button class="pstop" style="left:${(stopD[i] / total) * 100}%;top:${py(trail[nearestOnTrail(stopPos[i].x, stopPos[i].z).i].y)}%" data-i="${i}" aria-label="${s.name}, ${elevation(s)}"><i></i><span>${short(s)}</span></button>`)
    .join("");
  $("#profile-dist").textContent = `${total.toFixed(1)} km of trail · ${fmt(eMin * 1000)}–${fmt(eMax * 1000)} m`;
}
const done = $("#profile-done");
const doneLen = done.getTotalLength?.() || 0;
const chart = $("#profile-chart");
const tip = $("#profile-tip");
function chartD(e) {
  const r = chart.getBoundingClientRect();
  return MathUtils.clamp((e.clientX - r.left) / r.width, 0, 1) * total;
}
chart.addEventListener("pointermove", (e) => {
  if (e.target.closest(".pstop")) { tip.hidden = true; return; }
  const d = chartD(e);
  const p = atDistance(d);
  tip.hidden = false;
  tip.style.left = (d / total) * 100 + "%";
  tip.textContent = `${fmt(ground(p.x, p.z) * 1000)} m · ${d.toFixed(1)} km`;
});
chart.addEventListener("pointerleave", () => (tip.hidden = true));
chart.addEventListener("click", (e) => {
  const b = e.target.closest(".pstop");
  if (b) return openPanel(+b.dataset.i);
  goToDistance(chartD(e));
});
chart.addEventListener("keydown", (e) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  e.preventDefault();
  e.stopPropagation();
  const cur = nearestOnTrail(state.walker.x, state.walker.z).d;
  const d = e.key === "Home" ? 0 : e.key === "End" ? total : cur + (e.key === "ArrowRight" ? 0.5 : -0.5);
  goToDistance(d);
});
function goToDistance(d) {
  stopAuto();
  const p = atDistance(d), a = atDistance(d + 0.25);
  state.auto.d = d;
  if (state.mode === "walk") placeWalker(p.x, p.z, yawToward(a.x - p.x, a.z - p.z), state.walker.eye);
  else {
    Object.assign(state.walker, { x: p.x, z: p.z, yaw: yawToward(a.x - p.x, a.z - p.z) });
    flyAerialTo(new Vector3(p.x, ground(p.x, p.z), p.z), 5);
  }
}

// ---------- minimap ----------
const mini = $("#minimap");
const mctx = mini.getContext("2d");
const mimg = new Image();
mimg.src = satelliteUrl;
const MW = 200;
let miniSpan = 9;
function miniDraw(cx, cz, bearing) {
  if (!mimg.complete || !mimg.naturalWidth) return;
  const dpr = Math.min(2, devicePixelRatio);
  if (mini.width !== MW * dpr) { mini.width = mini.height = MW * dpr; }
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const span = miniSpan;
  const [u0, v0] = imageUV(cx - span / 2, cz - span / 2);
  const [u1, v1] = imageUV(cx + span / 2, cz + span / 2);
  const W = mimg.naturalWidth, H = mimg.naturalHeight;
  mctx.fillStyle = "#33433a";
  mctx.fillRect(0, 0, MW, MW);
  mctx.drawImage(mimg, u0 * W, v0 * H, (u1 - u0) * W, (v1 - v0) * H, 0, 0, MW, MW);
  const toPx = (x, z) => [((x - cx) / span + 0.5) * MW, ((z - cz) / span + 0.5) * MW];
  mctx.lineJoin = mctx.lineCap = "round";
  mctx.beginPath();
  for (let i = 0; i < trail.length; i += 2) {
    const [x, y] = toPx(trail[i].x, trail[i].z);
    i ? mctx.lineTo(x, y) : mctx.moveTo(x, y);
  }
  mctx.strokeStyle = "rgba(30,16,2,.55)";
  mctx.lineWidth = 4.5;
  mctx.stroke();
  mctx.strokeStyle = "#f3a53b";
  mctx.lineWidth = 2.2;
  mctx.stroke();
  stopPos.forEach((p, i) => {
    const [x, y] = toPx(p.x, p.z);
    mctx.beginPath();
    mctx.arc(x, y, i === stopPos.length - 1 ? 4.5 : 3.2, 0, Math.PI * 2);
    mctx.fillStyle = state.visited.has(i) ? "#f3a53b" : "#fff";
    mctx.fill();
    mctx.strokeStyle = "#1a120a";
    mctx.lineWidth = 1.4;
    mctx.stroke();
  });
  // You
  mctx.save();
  mctx.translate(MW / 2, MW / 2);
  mctx.rotate(MathUtils.degToRad(bearing));
  const g = mctx.createRadialGradient(0, 0, 0, 0, 0, 30);
  g.addColorStop(0, "rgba(255,255,255,.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  mctx.fillStyle = g;
  mctx.beginPath();
  mctx.moveTo(0, 0);
  mctx.arc(0, 0, 30, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
  mctx.closePath();
  mctx.fill();
  mctx.beginPath();
  mctx.moveTo(0, -8);
  mctx.lineTo(5.5, 6);
  mctx.lineTo(0, 3);
  mctx.lineTo(-5.5, 6);
  mctx.closePath();
  mctx.fillStyle = "#fff";
  mctx.strokeStyle = "#0d1a20";
  mctx.lineWidth = 1.6;
  mctx.fill();
  mctx.stroke();
  mctx.restore();
  // North
  mctx.font = "600 11px 'DM Sans Variable', sans-serif";
  mctx.fillStyle = "#fff";
  mctx.textAlign = "center";
  mctx.fillText("N", MW / 2, 14);
  mini.dataset.cx = cx;
  mini.dataset.cz = cz;
}
mini.addEventListener("click", (e) => {
  const r = mini.getBoundingClientRect();
  const x = +mini.dataset.cx + ((e.clientX - r.left) / r.width - 0.5) * miniSpan;
  const z = +mini.dataset.cz + ((e.clientY - r.top) / r.height - 0.5) * miniSpan;
  stopAuto();
  if (state.mode === "walk") placeWalker(x, z, state.walker.yaw, state.walker.eye);
  else flyAerialTo(new Vector3(x, ground(x, z), z), orbit.getDistance());
});

// ---------- stop panel ----------
const panel = $("#panel"), panelBody = $("#panel-body");
const linkFor = (key) => sources[key] ? `<a href="${sources[key][1]}" target="_blank" rel="noopener">${sources[key][0]}${icon("external", 13)}</a>` : "";
function openPanel(i) {
  const s = stops[i];
  state.panel = i;
  const prev = i > 0 ? stops[i - 1] : null, next = i < stops.length - 1 ? stops[i + 1] : null;
  const gain = prev ? s.height - prev.height : 0;
  const leg = prev ? stopD[i] - stopD[i - 1] : 0;
  panelBody.innerHTML = `
    <figure class="p-photo"><img src="./images/${s.id}.webp" alt="${s.terrain} near ${s.name}" width="506" height="334"></figure>
    <button class="tool p-close" id="p-close" aria-label="Close ${s.name}">${icon("close", 18)}</button>
    <div class="p-pad">
      <p class="p-where">${s.terrain}</p>
      <h2 id="panel-title">${s.name}</h2>
      <dl class="p-facts">
        <div><dt>Elevation</dt><dd>${elevation(s)}</dd></div>
        <div><dt>${prev ? "From " + short(prev) : "Trail"}</dt><dd>${prev ? km(leg) : "Start"}</dd></div>
        <div><dt>Climb</dt><dd>${prev ? (gain >= 0 ? "+" : "−") + fmt(Math.abs(gain)) + " m" : "–"}</dd></div>
      </dl>
      <p class="p-desc">${s.description}</p>
      <h3>${s.challenge}</h3>
      <p class="p-detail">${s.detail}</p>
      <h3>Places to stay</h3>
      <ul class="p-stays">${s.stays.map(([n, t, src]) => `<li><span>${n}</span><small>${t} · ${linkFor(src)}</small></li>`).join("")}</ul>
      <div class="p-actions">
        <button class="btn primary" id="p-walk">${icon("walk", 18)}Walk from here</button>
        <button class="btn ghost" id="p-fly">${icon("aerial", 18)}See from above</button>
      </div>
      <nav class="p-nav" aria-label="Trail stops">
        ${prev ? `<button id="p-prev">${icon("prev", 16)}<span><small>Previous</small>${short(prev)}</span></button>` : "<span></span>"}
        ${next ? `<button id="p-next"><span><small>Next</small>${short(next)}</span>${icon("next", 16)}</button>` : ""}
      </nav>
    </div>`;
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add("open"));
  document.body.classList.add("has-panel");
  $("#p-close").onclick = closePanel;
  $("#p-walk").onclick = () => { closePanel(); walkFromStop(i); };
  $("#p-fly").onclick = () => flyAerialTo(stopPos[i].clone(), 3.2);
  if (prev) $("#p-prev").onclick = () => openPanel(i - 1);
  if (next) $("#p-next").onclick = () => openPanel(i + 1);
  labels.forEach((L, k) => L.el.classList.toggle("active", k === i));
  if (state.mode === "aerial") flyAerialTo(stopPos[i].clone(), 3.6);
  $("#p-close").focus({ preventScroll: true });
}
function closePanel() {
  if (state.panel < 0) return;
  const was = state.panel;
  state.panel = -1;
  panel.classList.remove("open");
  document.body.classList.remove("has-panel");
  labels.forEach((L) => L.el.classList.remove("active"));
  setTimeout(() => { if (state.panel < 0) panel.hidden = true; }, reduced ? 0 : 320);
  labels[was]?.el.focus({ preventScroll: true });
}
function stepStop(dir) {
  const cur = state.panel >= 0 ? state.panel : nearestStopIndex();
  const i = MathUtils.clamp(cur + dir, 0, stops.length - 1);
  openPanel(i);
}
function nearestStopIndex() {
  const w = state.mode === "walk" ? state.walker : orbit.target;
  let best = 0, bd = Infinity;
  stopPos.forEach((p, i) => {
    const d = Math.hypot(p.x - w.x, p.z - w.z);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

// ---------- help, light, toast ----------
$("#sources").innerHTML =
  `<li>Terrain: a digital elevation model of the Annapurna massif with a Sentinel-2 satellite mosaic.</li>` +
  Object.values(sources).map(([label, url]) => `<li><a href="${url}" target="_blank" rel="noopener">${label}${icon("external", 13)}</a></li>`).join("");
function toggleHelp(open = $("#help").hidden) {
  $("#help").hidden = !open;
  $("#help-btn").setAttribute("aria-expanded", String(open));
  if (open) $("#help-close").focus();
  else $("#help-btn").focus({ preventScroll: true });
}
$("#help-btn").onclick = () => toggleHelp();
$("#help-close").onclick = () => toggleHelp(false);
// Time of day: the sun moves, ridge shadows sweep the valley, the light warms toward dusk.
{
  const input = $("#sun"), out = $("#sun-out");
  const label = (h) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60) % 60).padStart(2, "0")}`;
  const apply = (relight) => {
    const h = +input.value;
    out.textContent = label(h);
    input.setAttribute("aria-valuetext", label(h));
    const k = world.setSun(h);
    document.body.dataset.light = k < 0.5 ? "golden" : "day";
    if (relight) { forest.relight(); grass.relight(); pathway.relight(); }
  };
  input.addEventListener("input", () => apply(false));
  input.addEventListener("change", () => apply(true));
  apply(false);
}
let toastTimer;
function toast(html) {
  const t = $("#toast");
  t.innerHTML = html;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}

$("#credit").textContent = IMAGERY_CREDIT + " · Elevation and Sentinel-2 mosaic";
$("#trail-btn").onclick = () => {
  const b = $("#trail-btn");
  const on = b.getAttribute("aria-pressed") !== "true";
  b.setAttribute("aria-pressed", String(on));
  b.setAttribute("aria-label", on ? "Hide the trail line" : "Show the trail line");
  world.showTrail(on);
};
$("#mode-aerial").onclick = () => setMode("aerial");
$("#mode-walk").onclick = () => setMode("walk");
$("#play").onclick = () => (state.auto.on ? stopAuto() : startAuto());
$("#speed").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.auto.speed = +b.dataset.speed;
  $("#speed").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
});

// ---------- frame loop ----------
const fwd = new Vector3(), right = new Vector3();
let last = performance.now();
let lastNear = -1;
// The auto-walk follows the mapped line exactly, along its smoothly curved dense copy.
function glideAt(d) {
  d = MathUtils.clamp(d * (path.d[path.count - 1] / total), 0, path.d[path.count - 1]);
  let lo = 0, hi = path.count - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (path.d[m] < d) lo = m; else hi = m; }
  const t = path.d[hi] === path.d[lo] ? 0 : (d - path.d[lo]) / (path.d[hi] - path.d[lo]);
  return { x: path.x[lo] + (path.x[hi] - path.x[lo]) * t, z: path.z[lo] + (path.z[hi] - path.z[lo]) * t };
}
function trailHeading(d, p) {
  const ahead = d < total - 0.001, sample = glideAt(d + (ahead ? 0.012 : -0.012));
  const dx = (sample.x - p.x) * (ahead ? 1 : -1), dz = (sample.z - p.z) * (ahead ? 1 : -1);
  const rise = (ground(sample.x, sample.z) - ground(p.x, p.z)) * (ahead ? 1 : -1);
  return { yaw: yawToward(dx, dz), pitch: MathUtils.clamp(Math.atan2(rise, Math.hypot(dx, dz)) * 0.62 - 0.10, -0.38, 0.19) };
}
const angle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// What the camera shows trails the controls slightly: drag and turns ease in and out.
const view = { yaw: 0, pitch: 0, snap: true };
function walkStep(dt) {
  const w = state.walker;
  w.vx ??= 0; w.vz ??= 0;
  if (view.snap) { view.yaw = w.yaw; view.pitch = w.pitch; view.snap = false; }
  // Height above the ground: Q lowers, E rises (a drone view up to 1.5 km).
  if (keys.has("e")) w.eye = Math.min(1.5, w.eye * (1 + dt * 1.9) + dt * 0.002);
  if (keys.has("q")) w.eye = Math.max(0.0018, w.eye * (1 - dt * 1.9));
  if (state.auto.on) {
    // A walking pace that eases in, then holds steady.
    const target = 0.025 * state.auto.speed * (w.eye > 0.05 ? 3 : 1);
    state.auto.v = (state.auto.v ?? 0) + (target - (state.auto.v ?? 0)) * Math.min(1, dt * 1.5);
    state.auto.d += state.auto.v * dt;
    state.walked = (state.walked || 0) + state.auto.v * dt;
    if (state.auto.d >= total) {
      state.auto.d = total;
      stopAuto();
      arriveAtBaseCamp();
    }
    const p = glideAt(state.auto.d);
    w.x = p.x; w.z = p.z;
    w.vx = w.vz = 0;
    if (performance.now() - state.auto.lastLook > 2600) {
      const heading = trailHeading(state.auto.d, p);
      w.yaw += angle(heading.yaw - w.yaw) * Math.min(1, dt * 2.8);
      w.pitch += (heading.pitch - w.pitch) * Math.min(1, dt * 1.8);
    }
  } else {
    state.auto.v = 0;
    let mx = 0, mz = 0, turn = 0;
    if (keys.has("w") || keys.has("arrowup")) mz += 1;
    if (keys.has("s") || keys.has("arrowdown")) mz -= 1;
    if (keys.has("a")) mx -= 1;
    if (keys.has("d")) mx += 1;
    if (keys.has("arrowleft")) turn += 1;
    if (keys.has("arrowright")) turn -= 1;
    if (stick.id !== null) { mz -= stick.y; mx += stick.x * 0.8; }
    w.yaw += turn * dt * 1.2;
    const run = keys.has("shift") ? 4 : 1;
    // About 30 m/s on foot so the valley is walkable in minutes, faster higher up.
    const speed = (0.03 + w.eye * 0.9) * run;
    fwd.set(-Math.sin(w.yaw), 0, -Math.cos(w.yaw));
    right.set(Math.cos(w.yaw), 0, -Math.sin(w.yaw));
    const len = Math.hypot(mx, mz);
    const k = len ? Math.min(1, len) / len : 0;
    const tvx = (fwd.x * mz + right.x * mx) * k * speed, tvz = (fwd.z * mz + right.z * mx) * k * speed;
    // Momentum: speed builds and fades over about a third of a second.
    const ease = Math.min(1, dt * (len ? 4.5 : 6));
    w.vx += (tvx - w.vx) * ease;
    w.vz += (tvz - w.vz) * ease;
    state.walked = (state.walked || 0) + Math.hypot(w.vx, w.vz) * dt;
    w.x = MathUtils.clamp(w.x + w.vx * dt, bounds.x0 + 1, bounds.x1 - 1);
    w.z = MathUtils.clamp(w.z + w.vz * dt, bounds.z0 + 1, bounds.z1 - 1);
  }
  view.yaw += angle(w.yaw - view.yaw) * Math.min(1, dt * 11);
  view.pitch += (w.pitch - view.pitch) * Math.min(1, dt * 11);
  // Follow the ground with a soft spring so slopes feel like walking, not snapping.
  const gy = ground(w.x, w.z);
  w.y += (gy + w.eye - w.y) * Math.min(1, dt * 6);
  w.y = Math.max(w.y, gy + 0.0015);
  camera.position.set(w.x, w.y, w.z);
  euler.set(view.pitch, view.yaw, 0, "YXZ");
  camera.quaternion.setFromEuler(euler);
}

// ---------- the base camp milestone ----------
state.walkStart = 0;
function arriveAtBaseCamp() {
  const el = $("#milestone");
  if (!el.hidden) return;
  stopAuto();
  const mins = state.walkStart ? Math.round((performance.now() - state.walkStart) / 60000) : 0;
  $("#ms-walked").textContent = km(state.walked || 0);
  $("#ms-stops").textContent = `${state.visited.size} of ${stops.length}`;
  $("#ms-time").textContent = mins < 1 ? "under a minute" : mins === 1 ? "1 minute" : `${mins} minutes`;
  el.hidden = false;
  // Turn to the board, then let the view settle on it.
  const board = milestones.board || stopPos.at(-1);
  state.walker.yaw = yawToward(board.x - state.walker.x, board.z - state.walker.z) || state.walker.yaw;
  state.walker.pitch = 0.02;
  state.auto.lastLook = performance.now();
  $("#ms-face").focus({ preventScroll: true });
}
function closeMilestone() {
  $("#milestone").hidden = true;
  canvas.focus({ preventScroll: true });
}
$("#ms-close").onclick = closeMilestone;
$("#ms-face").onclick = () => {
  const p = peakPos[0];
  state.walker.yaw = yawToward(p.x - state.walker.x, p.z - state.walker.z);
  state.walker.pitch = 0.22;
  state.auto.lastLook = performance.now();
  closeMilestone();
};

let miniTick = 0;
function updateHud() {
  const here = state.mode === "walk" ? state.walker : orbit.target;
  const g = ground(here.x, here.z);
  const bearing = bearingOf();
  $("#r-elev").textContent = fmt(g * 1000) + " m";
  $("#r-head").textContent = `${Math.round(bearing)}° ${cardinal(bearing)}`;
  tape.style.transform = `translateX(${-bearing * 2}px)`;
  const gb = (MathUtils.radToDeg(Math.atan2(goal.x - here.x, -(goal.z - here.z))) + 360) % 360;
  let rel = gb - bearing;
  rel = ((rel + 540) % 360) - 180;
  const ge = $("#compass-goal");
  ge.style.transform = `translateX(${rel * 2}px)`;
  ge.style.opacity = Math.abs(rel) < 95 ? "1" : "0";

  const near = nearestOnTrail(here.x, here.z);
  // Next stop ahead along the trail.
  let ni = stopD.findIndex((d) => d > near.d + 0.03);
  if (ni < 0) ni = stops.length - 1;
  const ahead = Math.max(0, stopD[ni] - near.d);
  if (near.off > 0.35) {
    $("#r-next-label").textContent = "Trail";
    $("#r-next").textContent = `${km(near.off)} away`;
  } else {
    $("#r-next-label").textContent = ahead < 0.05 ? "You are at" : "Next stop";
    $("#r-next").textContent = ahead < 0.05 ? short(stops[ni]) : `${short(stops[ni])} · ${km(ahead)}`;
  }
  // Arrivals while walking.
  if (state.mode === "walk") {
    stopPos.forEach((p, i) => {
      if (Math.hypot(p.x - here.x, p.z - here.z) < 0.06 && lastNear !== i) {
        lastNear = i;
        state.visited.add(i);
        if (i === stops.length - 1) arriveAtBaseCamp();
        else toast(`<b>${stops[i].name}</b> ${elevation(stops[i])} · ${stops[i].terrain}`);
      }
    });
  }
  const onTrail = near.off < 0.35;
  const you = $("#profile-you");
  you.classList.toggle("off", !onTrail);
  you.style.left = (near.d / total) * 100 + "%";
  you.style.top = py(near.y) + "%";
  chart.setAttribute("aria-valuenow", String(Math.round((near.d / total) * 100)));
  chart.setAttribute("aria-valuetext", `${near.d.toFixed(1)} of ${total.toFixed(1)} km, ${fmt(near.y * 1000)} m`);
  if (doneLen) {
    done.style.strokeDasharray = `${doneLen}`;
    done.style.strokeDashoffset = `${doneLen * (1 - near.d / total)}`;
  }
  miniSpan = state.mode === "walk" ? (state.walker.eye > 0.1 ? 14 : 6) : MathUtils.clamp(orbit.getDistance() * 0.9, 5, 30);
  if (++miniTick % 2 === 0) miniDraw(here.x, here.z, bearing);
}

let nextHud = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const tw = state.tween;
  if (tw) {
    tw.t += dt;
    const k = tw.duration ? ease(Math.min(1, tw.t / tw.duration)) : 1;
    // Arc upward a little on long moves.
    const lift = Math.sin(Math.PI * k) * Math.min(3, tw.from.distanceTo(tw.to) * 0.18);
    camera.position.lerpVectors(tw.from, tw.to, k);
    camera.position.y += lift;
    camera.quaternion.slerpQuaternions(tw.qFrom, tw.qTo, k);
    if (state.mode === "walk") {
      tw.to.copy(walkerCamPos());
      tw.qTo.copy(walkerQuat());
    }
    if (k >= 1) {
      state.tween = null;
      if (state.mode === "walk") { state.walker.y = camera.position.y; view.snap = true; state.walker.vx = state.walker.vz = 0; }
      tw.done?.();
    }
  } else if (state.mode === "walk") {
    walkStep(dt);
  } else if (orbit.enabled) {
    orbit.update(dt);
    orbit.target.x = MathUtils.clamp(orbit.target.x, bounds.x0 + 4, bounds.x1 - 4);
    orbit.target.z = MathUtils.clamp(orbit.target.z, bounds.z0 + 4, bounds.z1 - 4);
    orbit.target.y = ground(orbit.target.x, orbit.target.z);
    const floor = ground(camera.position.x, camera.position.z) + 0.15;
    if (camera.position.y < floor) camera.position.y = floor;
  }
  // The draped path when close to the ground, the screen line from higher up.
  const above = camera.position.y - ground(camera.position.x, camera.position.z);
  world.setTrailMode(above < 0.09, above > 1.2);
  forest.update(camera, above < 0.6);
  grass.update(camera, dt, state.mode === "walk" && above < 0.02);
  milestones.update(dt, camera);
  pathway.update(camera, state.mode === "walk" && above < 0.06);
  world.render(dt * 1000);
  updateLabels();
  if (now >= nextHud) { updateHud(); nextHud = now + 100; }
  requestAnimationFrame(frame);
}

function resize() {
  world.resize();
}
addEventListener("resize", resize);
resize();

// ---------- start ----------
world.ready.then(() => {
  $("#loader-bar").style.width = "100%";
  const h = homeView();
  // One authored entrance: descend from high above the massif to the trail view.
  if (!reduced) {
    camera.position.set(h.position.x * 1.9, h.position.y * 3.2, h.position.z * 1.7);
    camera.lookAt(h.target);
    orbit.enabled = false;
    tweenTo(h.position, lookQuat(h.position, h.target), 3.4, () => {
      orbit.target.copy(h.target);
      orbit.enabled = true;
      orbit.update();
    });
  }
  document.body.dataset.mode = "aerial";
  requestAnimationFrame((t) => { last = t; frame(t); });
  setTimeout(() => {
    $("#loader").classList.add("gone");
    $("#intro").hidden = false;
    document.body.classList.add("ready");
    setTimeout(() => ($("#loader").hidden = true), 900);
  }, 120);
}).catch(() => {
  $("#loader").hidden = true;
  $("#fallback").hidden = false;
});

const dismissIntro = () => {
  const el = $("#intro");
  el.classList.add("leaving");
  setTimeout(() => (el.hidden = true), reduced ? 0 : 380);
};
$("#start-walk").onclick = () => { dismissIntro(); walkFromStop(0); };
$("#start-look").onclick = () => { dismissIntro(); canvas.focus({ preventScroll: true }); };
canvas.addEventListener("pointerdown", () => { if (!$("#intro").hidden) dismissIntro(); }, { once: true });

if (new URLSearchParams(location.search).has("debug")) window.__explorer = { state, walkFromStop, openPanel, setMode, camera, world, forest, grass, pathway, arriveAtBaseCamp };

canvas.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  $("#fallback").hidden = false;
});
