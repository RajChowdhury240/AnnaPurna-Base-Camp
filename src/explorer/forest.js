// Tree silhouettes and branch sprays share one mipmapped atlas in both detail levels.
import {
  BufferGeometry, Color, DoubleSide, Float32BufferAttribute, InstancedMesh,
  MeshLambertMaterial, Object3D, RepeatWrapping, SRGBColorSpace, TextureLoader,
} from "three";
import barkUrl from "./materials/bark.webp?inline";
import foliageUrl from "./materials/foliage.webp?inline";
import { ground, sunlight, benchAt } from "./terrain.js";

function treeGeometry(fir, close) {
  const positions = [], normals = [], uvs = [], indices = [], surfaces = [];
  const card = (angle, y, radius, width, height, reach, branch) => {
    const offset = positions.length / 3;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const u0 = fir ? 0.502 : 0.002, v0 = branch ? 0.002 : 0.502;
    // A folded card gives each spray depth when seen from above or from the side.
    for (let row = 0; row <= 1; row++) {
      for (let column = -1; column <= 1; column++) {
        const t = row;
        surfaces.push(branch ? 2 : Number(close));
        const along = radius + t * reach + (1 - Math.abs(column)) * width * 0.12;
        const side = column * width * 0.5;
        positions.push(dx * along - dz * side, y + t * height, dz * along + dx * side);
        normals.push(dx * 0.45 - dz * column * 0.55, 0.8, dz * 0.45 + dx * column * 0.55);
        uvs.push(u0 + (column + 1) * 0.248, v0 + t * 0.496);
      }
    }
    for (let i = offset; i < offset + 2; i++) indices.push(i, i + 3, i + 1, i + 1, i + 3, i + 4);
  };
  const width = fir ? 0.74 : 0.91;
  card(0, 0, 0, width, 1, 0, false);
  card(Math.PI / 2, 0, 0, width, 1, 0, false);
  if (close) {
    // Model the flared base and forks where the walker can see around the trunk.
    const limb = (start, end, base, tip) => {
      const first = positions.length / 3, sides = 7;
      for (let ring = 0; ring < 3; ring++) {
        const t = ring === 1 ? 0.24 : ring / 2;
        const r = (base + (tip - base) * t) * (ring === 0 ? 1.28 : 1);
        for (let j = 0; j <= sides; j++) {
          const az = j * Math.PI * 2 / sides, dx = Math.cos(az), dz = Math.sin(az);
          positions.push(start[0] + (end[0] - start[0]) * t + dx * r,
            start[1] + (end[1] - start[1]) * t, start[2] + (end[2] - start[2]) * t + dz * r);
          normals.push(dx, 0.07, dz);
          uvs.push(j / sides, (start[1] + (end[1] - start[1]) * t) * 5.0);
          surfaces.push(3);
        }
      }
      for (let ring = 0; ring < 2; ring++) for (let j = 0; j < sides; j++) {
        const a = first + ring * (sides + 1) + j, b = a + sides + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    };
    limb([0, 0, 0], [fir ? 0 : -0.022, 0.72, 0.009], fir ? 0.018 : 0.031, 0.008);
    if (!fir) {
      limb([-0.008, 0.27, 0], [0.13, 0.57, 0.09], 0.022, 0.006);
      limb([-0.009, 0.31, 0], [-0.16, 0.60, -0.07], 0.018, 0.005);
    }
    const count = fir ? 22 : 14;
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const y = fir ? 0.19 + t * 0.73 : 0.36 + t * 0.42;
      const reach = fir ? 0.28 * (1 - t) + 0.035 : 0.21 * Math.sin(t * 2.7 + 0.38);
      card(i * 2.39996, y, reach * 0.35, reach * 1.45, fir ? 0.055 + t * 0.025 : 0.15, reach, true);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geo.setAttribute("surfaceKind", new Float32BufferAttribute(surfaces, 1));
  geo.setIndex(indices);
  return geo;
}

function randomCell(i, j) {
  let seed = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) >>> 0;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function createForest({ scene, tiles, lite, sun }) {
  const atlas = new TextureLoader().load(foliageUrl);
  atlas.colorSpace = SRGBColorSpace;
  const bark = new TextureLoader().load(barkUrl);
  bark.colorSpace = SRGBColorSpace;
  bark.wrapS = bark.wrapT = RepeatWrapping;
  const material = new MeshLambertMaterial({ map: atlas, side: DoubleSide, alphaTest: 0.29 });
  // Crown normals point out of the tree on either side of thin foliage.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.barkMap = { value: bark };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float surfaceKind; varying float vSurface;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSurface = surfaceKind;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D barkMap; varying float vSurface;")
      .replace("#include <map_fragment>", `
        if (vSurface > 2.5) {
          diffuseColor.rgb *= texture2D(barkMap, vMapUv).rgb;
        } else {
          vec4 leaf = texture2D(map, vMapUv);
          if (vSurface > 0.5 && vSurface < 1.5) {
            vec2 treeUV = fract(vMapUv * 2.0);
            float trunk = 1.0 - smoothstep(0.035, 0.10, abs(treeUV.x - 0.49));
            leaf.a *= 1.0 - trunk * (1.0 - smoothstep(0.24, 0.43, treeUV.y));
          }
          diffuseColor *= leaf;
        }`)
      .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal *= faceDirection;");
  };
  const models = [false, true].map(fir => [treeGeometry(fir, false), treeGeometry(fir, true)]);
  const cell = 0.064, radius = lite ? 0.18 : 0.27;
  const cells = new Map(), dummy = new Object3D(), tint = new Color();

  function plant(i, j) {
    const random = randomCell(i, j);
    const trees = [[], []];
    const side = lite ? 5 : 7;
    const cx = (i + 0.5) * cell, cz = (j + 0.5) * cell;
    const ridgeLight = sunlight(cx, ground(cx, cz) + 0.009, cz, sun, 18);
    for (let a = 0; a < side; a++) for (let b = 0; b < side; b++) {
      const x = (i + (a + random()) / side) * cell;
      const z = (j + (b + random()) / side) * cell;
      const [r, g, blue] = tiles.landColor(x, z);
      const green = g - blue, luminance = 0.3 * r + 0.6 * g + 0.1 * blue;
      if (luminance > 0.54 || green < 0.012 || r > g * 1.2 || random() > Math.min(0.92, green * 4.5 + 0.18)) continue;
      const y = ground(x, z);
      if (y > 3.38 + random() * 0.15 || (benchAt(x, z)?.d ?? 1) < 0.005) continue;
      const kind = Number(y > 2.78 + (random() - 0.5) * 0.45);
      const height = (kind ? 0.012 : 0.008) + random() * 0.012;
      trees[kind].push({ x, y, z, height, width: 0.83 + random() * 0.32, yaw: random() * 6.283,
        tone: 0.86 + random() * 0.32, warm: random() });
    }
    const meshes = [];
    trees.forEach((list, kind) => {
      if (!list.length) return;
      const mesh = new InstancedMesh(models[kind][0], material, list.length);
      mesh.userData.kind = kind;
      list.forEach((t, n) => {
        dummy.position.set(t.x, t.y - t.height * 0.025, t.z);
        dummy.rotation.y = t.yaw;
        dummy.scale.set(t.width * t.height, t.height, t.height * t.width);
        dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
        tint.setRGB(0.87 + t.warm * 0.13, 1.08, 0.90 - t.warm * 0.08)
          .multiplyScalar(t.tone * (0.65 + ridgeLight * 0.55));
        mesh.setColorAt(n, tint);
      });
      mesh.computeBoundingSphere();
      mesh.boundingSphere.radius += 0.007;
      scene.add(mesh);
      meshes.push(mesh);
    });
    return { cx, cz, meshes };
  }

  function drop(key, c) {
    for (const mesh of c.meshes) { scene.remove(mesh); mesh.dispose(); }
    cells.delete(key);
  }
  function relight() { for (const [key, c] of cells) drop(key, c); }
  function update(camera, active) {
    if (!active) { if (cells.size) relight(); return; }
    if (!tiles.landColorReady()) return;
    const { x, z } = camera.position;
    const ci = Math.floor(x / cell), cj = Math.floor(z / cell), n = Math.ceil(radius / cell);
    let best = Infinity, candidate;
    for (let i = ci - n; i <= ci + n; i++) for (let j = cj - n; j <= cj + n; j++) {
      const key = i * 65536 + j;
      const d = Math.hypot((i + 0.5) * cell - x, (j + 0.5) * cell - z);
      if (d < radius && d < best && !cells.has(key)) { best = d; candidate = { key, i, j }; }
    }
    if (candidate) cells.set(candidate.key, plant(candidate.i, candidate.j));
    for (const [key, c] of cells) {
      const d = Math.hypot(c.cx - x, c.cz - z);
      if (d > radius + cell) { drop(key, c); continue; }
      for (const mesh of c.meshes) mesh.geometry = models[mesh.userData.kind][Number(d < (lite ? 0.055 : 0.085))];
    }
  }
  return { update, relight, get count() { let n = 0; for (const c of cells.values()) for (const m of c.meshes) n += m.count; return n; } };
}
