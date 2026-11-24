import { stops, elevation, number } from "./data.js";
import { icon } from "./icons.js";
import { createRelief } from "./relief.js";

const $ = (s) => document.querySelector(s);
const points = [
  stops[0].point,
  [255, 489],
  [277, 470],
  [306, 467],
  [292, 450],
  [327, 450],
  [338, 431],
  [362, 433],
  stops[1].point,
  [363, 399],
  [390, 392],
  [410, 395],
  [424, 380],
  stops[2].point,
  [451, 361],
  stops[3].point,
  [496, 368],
  [488, 352],
  [513, 348],
  stops[4].point,
  [526, 325],
  [552, 321],
  stops[5].point,
  [599, 304],
  [592, 293],
  [623, 294],
  stops[6].point,
  [628, 270],
  [659, 268],
  [672, 253],
  stops[7].point,
  [682, 239],
  [713, 238],
  [710, 228],
  [735, 223],
  stops[8].point,
];
function smoothPath(points) {
  let path = "M " + points[0].join(" ");
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      before = points[Math.max(0, i - 2)],
      next = points[Math.min(i + 1, points.length - 1)];
    path +=
      " C " +
      [
        a[0] + (b[0] - before[0]) * 0.14,
        a[1] + (b[1] - before[1]) * 0.14,
        b[0] - (next[0] - a[0]) * 0.14,
        b[1] - (next[1] - a[1]) * 0.14,
        ...b,
      ]
        .map((v) => v.toFixed(1))
        .join(" ");
  }
  return path;
}
function staircase() {
  // A tread represents each stop. Front-face height is proportional to elevation.
  const base = 374,
    x0 = 46,
    width = 74,
    dx = 23,
    dy = -18;
  let svg =
    '<svg viewBox="0 0 790 420" class="stair-graphic" role="group" aria-label="Staircase elevation profile. Choose a stop to see its details.">';
  for (const h of [2000, 3000, 4000]) {
    const y = base - (h - 1500) * 0.104;
    svg += `<path d="M30 ${y}H762" fill="none" stroke="#b8cecc" stroke-dasharray="3 6"/><text x="15" y="${y - 5}" class="step-height">${h.toLocaleString()} m</text>`;
  }
  stops.forEach((s, i) => {
    const x = x0 + i * width,
      y = base - (s.height - 1500) * 0.104,
      w = width - 1;
    const front = `M${x} ${y}h${w}v${base - y}h-${w}z`;
    const top = `M${x} ${y}l${dx} ${dy}h${w}l-${dx} ${-dy}z`;
    const side = `M${x + w} ${y}l${dx} ${dy}v${base - y}l-${dx} ${-dy}z`;
    const color = 157 + i * 4.2;
    const name = s.short || s.name;
    const levels = [2, 7].includes(i) ? 37 : 18;
    svg += `<g class="step-stop" tabindex="0" role="button" aria-label="${s.name}, ${elevation(s)}" data-stop="${i}">
      <path d="${side}" fill="hsl(${color} 17% ${35 + i * 1.5}%)"/>
      <path d="${front}" fill="hsl(${color} 19% ${44 + i * 2}%)"/>
      <path class="step-top" d="${top}" fill="hsl(${color} 25% ${75 + i * 1.9}%)"/>
      <text x="${x + w / 2}" y="${y + 22}" text-anchor="middle" class="step-number">${number(i)}</text>
      <path d="M${x + w / 2 + dx / 2} ${y + dy / 2}v-${levels}" stroke="#789697" stroke-width="1"/>
      <circle cx="${x + w / 2 + dx / 2}" cy="${y + dy / 2}" r="3.5" fill="#f2fbf7" stroke="#38746b"/>
      <text x="${x + w / 2 + dx / 2}" y="${y + dy / 2 - levels - 16}" text-anchor="middle" class="step-label">${name}</text>
      <text x="${x + w / 2 + dx / 2}" y="${y + dy / 2 - levels - 3}" text-anchor="middle" class="step-height">${elevation(s)}</text></g>`;
  });
  return svg + "</svg>";
}

export function initMap(showStop) {
  const hero = $(".hero"),
    map = $("#map"),
    scene = $("#scene"),
    markers = $("#markers"),
    line = $(".trail-line");
  let mode = "terrain",
    zoom = 1,
    expanded = false,
    tour = -1,
    timer = null,
    paused = false,
    drag = null;
  markers.innerHTML = stops
    .map(
      (
        s,
        i,
      ) => `<button class="marker marker-${s.label || "plain"}" data-stop="${i}" aria-label="Explore ${s.name}, ${elevation(s)}">
    <span class="marker-dot"></span><span class="marker-label ${s.label === "summit" ? "elevated" : ""} ${s.label ? "" : "optional"}">${s.label === "summit" ? '<span class="summit-icon">' + icon("flag", 12) + "</span>" : ""}${s.name}${s.label === "summit" ? "<small>" + elevation(s) + "</small>" : ""}</span></button>`,
    )
    .join("");
  line.innerHTML =
    '<path class="trail-shadow"/><path class="trail-base"/><path class="trail-light"/>';
  const paths = [...line.children],
    buttons = [...markers.children];
  function projectMarkers(project) {
    const d = smoothPath(
      points.map(([x, y]) => {
        const [u, v] = project(x / 1000, y / 600);
        return [u * 1000, v * 600];
      }),
    );
    paths.forEach((el) => el.setAttribute("d", d));
    stops.forEach((s, i) => {
      const [u, v] = project(s.point[0] / 1000, s.point[1] / 600);
      buttons[i].style.left = u * 100 + "%";
      buttons[i].style.top = v * 100 + "%";
    });
  }
  projectMarkers((u, v) => [u, v]);
  const relief = createRelief($("#relief"), $(".scenery"), projectMarkers);
  $("#stairs").innerHTML = staircase();
  function changeZoom(delta) {
    zoom = Math.max(1, Math.min(2, Math.round((zoom + delta) * 10) / 10));
    const el = mode === "terrain" ? scene : $(".stair-graphic");
    let offsetX = 0;
    let offsetY = 0;
    if (tour >= 0) {
      const [x, y] = stops[tour].point;
      const limit = (zoom - 1) / 2;
      // Keep the active stop in view without moving an edge of the texture on screen.
      const offset = (position, target) =>
        Math.max(
          -limit,
          Math.min(limit, target - 0.5 - (position - 0.5) * zoom),
        );
      offsetX = 100 * offset(x / 1000, 0.57);
      offsetY = 100 * offset(y / 600, 0.57);
    }
    el.style.transform = `translate(${offsetX}%, ${offsetY}%) scale(${zoom})`;
    $("#zoom-in").disabled = zoom >= 2;
    $("#zoom-out").disabled = zoom <= 1;
  }
  function stopTour() {
    clearTimeout(timer);
    timer = null;
    tour = -1;
    paused = false;
    $("#tour-bar").hidden = true;
    hero.classList.remove("tour-active");
    buttons.forEach((b) => b.classList.remove("touring"));
    scene.style.transformOrigin = "62% 56%";
    zoom = 1;
    changeZoom(0);
    $("#fly").innerHTML =
      '<span class="play-ring">' + icon("play", 12) + "</span>Route flyover";
  }
  function setMode(value) {
    stopTour();
    mode = value;
    const stairs = mode === "stairs";
    scene.hidden = stairs;
    $("#stairs").hidden = !stairs;
    hero.classList.toggle("stair-mode", stairs);
    $("#terrain-btn").setAttribute("aria-pressed", String(!stairs));
    $("#stairs-btn").setAttribute("aria-pressed", String(stairs));
    $("#map-caption").textContent = stairs
      ? matchMedia("(max-width:700px)").matches
        ? "Swipe to explore"
        : "Stop elevations"
      : "Interactive terrain";
    relief.setCamera(0, 0);
    zoom = 1;
    changeZoom(0);
  }
  function setExpanded(value) {
    expanded = value;
    hero.classList.toggle("expanded", value);
    document.body.classList.toggle("locked", value);
    $("#expand").innerHTML = icon(value ? "close" : "expand", 16);
    $("#expand").setAttribute(
      "aria-label",
      value ? "Close expanded map" : "Expand map",
    );
    document
      .querySelectorAll("body > header, .directory, .site-foot")
      .forEach((el) => (el.inert = value));
    if (value) {
      $("#terrain-btn").focus();
    } else {
      stopTour();
      relief.setCamera(0, 0);
      $("#expand").focus({ preventScroll: true });
    }
  }
  function drawTour() {
    clearTimeout(timer);
    const s = stops[tour];
    const bar = $("#tour-bar");
    hero.classList.add("tour-active");
    bar.hidden = false;
    buttons.forEach((b, i) => b.classList.toggle("touring", i === tour));
    scene.style.transformOrigin = "50% 50%";
    zoom = matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 1.5;
    changeZoom(0);
    $("#fly").innerHTML =
      '<span class="play-ring">' + icon("close", 12) + "</span>End flyover";
    bar.innerHTML = `<button data-tour="pause" aria-label="${paused ? "Resume" : "Pause"} flyover">${icon(paused ? "play" : "pause", 14)}</button><button class="tour-info" data-tour="details"><small>Stop ${number(tour)} / 09</small>${s.name} · ${elevation(s)}</button><button data-tour="next" aria-label="Next flyover stop">${icon("right", 14)}</button><button data-tour="end" aria-label="End flyover">${icon("close", 14)}</button>`;
    if (!paused) timer = setTimeout(nextTour, 4500);
  }
  function nextTour() {
    if (tour >= stops.length - 1) {
      stopTour();
      return;
    }
    tour++;
    drawTour();
  }
  $("#fly").onclick = () => {
    if (tour >= 0) {
      stopTour();
      return;
    }
    setMode("terrain");
    tour = 0;
    drawTour();
  };
  $("#tour-bar").onclick = (e) => {
    const action = e.target.closest("[data-tour]")?.dataset.tour;
    if (action === "end") stopTour();
    if (action === "next") nextTour();
    if (action === "pause") {
      paused = !paused;
      drawTour();
    }
    if (action === "details") {
      const i = tour;
      stopTour();
      showStop(i);
    }
  };
  $("#terrain-btn").onclick = () => setMode("terrain");
  $("#stairs-btn").onclick = () => setMode("stairs");
  $("#expand").onclick = () => setExpanded(!expanded);
  $("#zoom-in").onclick = () => changeZoom(0.2);
  $("#zoom-out").onclick = () => changeZoom(-0.2);
  map.addEventListener("click", (e) => {
    const element = e.target.closest("[data-stop]");
    if (element) {
      if (tour >= 0) stopTour();
      showStop(+element.dataset.stop);
    }
  });
  map.addEventListener("keydown", (e) => {
    if (e.target.closest(".step-stop") && ["Enter", " "].includes(e.key)) {
      e.preventDefault();
      showStop(+e.target.closest(".step-stop").dataset.stop);
      return;
    }
    if (mode !== "terrain" || !e.key.startsWith("Arrow")) return;
    e.preventDefault();
    const [x, y] = relief.getCamera();
    relief.setCamera(
      x + (e.key === "ArrowRight" ? 0.05 : e.key === "ArrowLeft" ? -0.05 : 0),
      y + (e.key === "ArrowDown" ? 0.04 : e.key === "ArrowUp" ? -0.04 : 0),
    );
  });
  map.tabIndex = 0;
  map.setAttribute(
    "aria-description",
    "Drag the terrain or use the arrow keys to change perspective. Select a stop to open its guide.",
  );
  map.addEventListener("pointerdown", (e) => {
    if (e.target.closest("[data-stop]") || mode !== "terrain" || e.button !== 0)
      return;
    if (tour >= 0) stopTour();
    drag = { x: e.clientX, y: e.clientY, camera: relief.getCamera() };
    map.setPointerCapture(e.pointerId);
  });
  map.addEventListener("pointermove", (e) => {
    if (!drag) return;
    relief.setCamera(
      drag.camera[0] + (e.clientX - drag.x) / 520,
      drag.camera[1] + (e.clientY - drag.y) / 600,
    );
  });
  const release = () => {
    drag = null;
  };
  map.addEventListener("pointerup", release);
  map.addEventListener("pointercancel", release);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("dialog").open) {
      if (expanded) setExpanded(false);
      else if (tour >= 0) stopTour();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && tour >= 0) {
      paused = true;
      drawTour();
    }
  });
  changeZoom(0);
  return { stopTour };
}
