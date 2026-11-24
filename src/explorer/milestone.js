// Landmarks on the ground: a carved wooden welcome board with a stone cairn and strings of
// prayer flags at Annapurna Base Camp, and a small signpost at every other trail stop.
import {
  Group, Mesh, BoxGeometry, PlaneGeometry, CylinderGeometry, IcosahedronGeometry, MeshLambertMaterial,
  CanvasTexture, SRGBColorSpace, DoubleSide, Vector3, BufferGeometry, Float32BufferAttribute,
} from "three";
import { ground } from "./terrain.js";

// Weathered pine with grain, knots and carved, painted letters.
function boardTexture(lines, w = 1024, h = 512) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  const base = g.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, "#7a5532"); base.addColorStop(0.5, "#6a4629"); base.addColorStop(1, "#5a3a22");
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  let seed = 3;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Planks.
  const planks = 4;
  for (let p = 0; p < planks; p++) {
    const y0 = (p * h) / planks;
    g.fillStyle = `rgba(${40 + r() * 30},${25 + r() * 15},${10},${0.12 + r() * 0.12})`;
    g.fillRect(0, y0, w, h / planks);
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = `rgba(30,18,8,${0.05 + r() * 0.12})`;
      g.lineWidth = 0.6 + r() * 1.6;
      g.beginPath();
      const y = y0 + r() * (h / planks);
      g.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.01 + i) * (2 + r() * 3));
      g.stroke();
    }
    g.fillStyle = "rgba(20,10,4,0.55)";
    g.fillRect(0, y0, w, 3);
  }
  for (let k = 0; k < 4; k++) {
    g.fillStyle = "rgba(40,22,10,0.45)";
    g.beginPath();
    g.ellipse(r() * w, r() * h, 8 + r() * 10, 4 + r() * 5, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Carved, painted lettering.
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const L of lines) {
    g.font = `${L.weight || 700} ${L.size}px Georgia, "Times New Roman", serif`;
    g.fillStyle = "rgba(20,10,4,0.7)";
    g.fillText(L.text, w / 2 + 2, L.y + 3);
    g.fillStyle = L.color || "#f4e7c6";
    g.fillText(L.text, w / 2, L.y);
  }
  // Sun-bleaching and wear.
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = `rgba(${r() > 0.5 ? "255,240,210" : "20,12,6"},${r() * 0.06})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 2);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const wood = new MeshLambertMaterial({ color: "#5b3f26" });
const stoneMat = new MeshLambertMaterial({ color: "#b3aea6" });

function rock(size, seed) {
  const g = new IcosahedronGeometry(size, 2);
  const p = g.attributes.position;
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.85 + r() * 0.3), p.getY(i) * (0.55 + r() * 0.2), p.getZ(i) * (0.85 + r() * 0.3));
  g.computeVertexNormals();
  return new Mesh(g, stoneMat);
}

// Strings of Lungta prayer flags, blue-white-red-green-yellow, rippling in the wind.
const FLAG_COLOURS = ["#2b62b8", "#f2f0e8", "#c8322b", "#2e8b4a", "#e8b923"];
function flagString(from, to, count, time) {
  const group = new Group();
  const sag = from.distanceTo(to) * 0.08;
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const p = from.clone().lerp(to, t);
    p.y -= Math.sin(Math.PI * t) * sag;
    pts.push(p);
  }
  const lineGeo = new BufferGeometry().setFromPoints(pts);
  const cord = new Mesh(
    new CylinderGeometry(0.006, 0.006, from.distanceTo(to), 4).rotateZ(Math.PI / 2),
    new MeshLambertMaterial({ color: "#d8d2c4" }),
  );
  void lineGeo;
  const flagGeo = new PlaneGeometry(0.22, 0.28, 4, 1).translate(0, -0.15, 0);
  const mats = FLAG_COLOURS.map((c) => {
    const m = new MeshLambertMaterial({ color: c, side: DoubleSide });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = time;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
float sway = -position.y / 0.3;
vec3 root = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
transformed.z += sin(uTime * 4.0 + root.x * 3000.0 + root.z * 2000.0) * 0.07 * sway;
transformed.x += sin(uTime * 6.0 + root.x * 4000.0) * 0.02 * sway;`);
    };
    return m;
  });
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const p = from.clone().lerp(to, t);
    p.y -= Math.sin(Math.PI * t) * sag;
    const f = new Mesh(flagGeo, mats[i % 5]);
    f.position.copy(p);
    f.lookAt(p.clone().add(new Vector3(-(to.z - from.z), 0, to.x - from.x)));
    group.add(f);
  }
  // A plain cord between the end posts.
  cord.position.copy(from.clone().lerp(to, 0.5));
  cord.position.y -= sag * 0.66;
  cord.lookAt(to.x, cord.position.y, to.z);
  cord.rotateY(Math.PI / 2);
  group.add(cord);
  return group;
}

export function createMilestones({ scene, spots }) {
  // spots: [{ name, height, x, z, yaw (direction the walker approaches from), main }]
  const time = { value: 0 };
  const objects = [];
  for (const spot of spots) {
    // Built in metres, placed in kilometres.
    const root = new Group();
    root.scale.setScalar(0.001);
    const side = new Vector3(Math.cos(spot.yaw), 0, -Math.sin(spot.yaw));
    const ahead = new Vector3(-Math.sin(spot.yaw), 0, -Math.cos(spot.yaw));
    const off = spot.main ? [0.0035, 0.007] : [0.0028, 0.001];
    const px = spot.x + side.x * off[0] + ahead.x * off[1];
    const pz = spot.z + side.z * off[0] + ahead.z * off[1];
    root.position.set(px, ground(px, pz) - 0.00005, pz);
    // Face the walker coming up the trail, turned slightly toward the path.
    root.rotation.y = spot.yaw - 0.35;
    if (spot.main) {
      const tex = boardTexture([
        { text: "NAMASTE", size: 46, y: 70, color: "#f0c66a" },
        { text: "WELCOME TO", size: 40, y: 135, weight: 600 },
        { text: "ANNAPURNA BASE CAMP", size: 64, y: 232 },
        { text: "4,130 m", size: 92, y: 345, color: "#f0c66a" },
        { text: "ANNAPURNA SANCTUARY · NEPAL", size: 30, y: 440, weight: 600 },
      ]);
      const board = new Mesh(new BoxGeometry(3.0, 1.5, 0.08), [wood, wood, wood, wood, new MeshLambertMaterial({ map: tex }), wood]);
      board.position.set(0, 2.15, 0);
      root.add(board);
      for (const x of [-1.35, 1.35]) {
        const post = new Mesh(new BoxGeometry(0.14, 3.2, 0.14), wood);
        post.position.set(x, 1.5, -0.08);
        root.add(post);
      }
      const roof = new Mesh(new BoxGeometry(3.4, 0.08, 0.5), wood);
      roof.position.set(0, 3.0, -0.02);
      root.add(roof);
      // A stone cairn beside the board, as trekkers build them.
      let y = 0;
      [0.55, 0.45, 0.38, 0.3, 0.24, 0.18].forEach((s, i) => {
        const st = rock(s, 9 + i * 7);
        y += s * (i ? 0.55 : 0.4);
        st.position.set(2.6 + (i % 2) * 0.04, y, 0.5);
        st.rotation.y = i * 1.3;
        root.add(st);
        y += s * 0.45;
      });
      const top = y;
      // Poles and flag strings fanning out from the board and the cairn.
      const poles = [new Vector3(-6.5, 0, 3.5), new Vector3(7.5, 0, 4), new Vector3(1, 0, 9)];
      for (const p of poles) {
        p.y = 0;
        const pole = new Mesh(new CylinderGeometry(0.04, 0.05, 3.4, 6), wood);
        pole.position.set(p.x, 1.7, p.z);
        root.add(pole);
        p.y = 3.3;
      }
      root.add(flagString(new Vector3(-1.35, 3.1, -0.08), poles[0], 22, time));
      root.add(flagString(new Vector3(1.35, 3.1, -0.08), poles[1], 24, time));
      root.add(flagString(new Vector3(2.6, top, 0.5), poles[2], 26, time));
      root.add(flagString(poles[0], poles[2], 30, time));
    } else {
      const tex = boardTexture([
        { text: spot.name.toUpperCase(), size: spot.name.length > 16 ? 64 : 96, y: 190 },
        { text: `${spot.height.toLocaleString("en-US")} m`, size: 84, y: 330, color: "#f0c66a" },
      ], 1024, 512);
      const board = new Mesh(new BoxGeometry(1.4, 0.7, 0.05), [wood, wood, wood, wood, new MeshLambertMaterial({ map: tex }), wood]);
      board.position.set(0, 1.35, 0);
      root.add(board);
      const post = new Mesh(new BoxGeometry(0.1, 1.8, 0.1), wood);
      post.position.set(0, 0.85, -0.05);
      root.add(post);
      const base = rock(0.3, 17);
      base.position.set(0, 0.08, 0);
      root.add(base);
    }
    scene.add(root);
    objects.push(root);
  }
  const main = objects[spots.findIndex((s) => s.main)];
  return {
    board: main ? main.position.clone() : null,
    update(dt, camera) {
      time.value += dt;
      // Only worth drawing within a kilometre or so.
      for (const o of objects) o.visible = o.position.distanceTo(camera.position) < 1.2;
    },
  };
}
