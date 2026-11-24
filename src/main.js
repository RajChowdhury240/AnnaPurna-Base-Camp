import "@fontsource-variable/dm-sans/wght.css";
import "@fontsource/baskervville/latin-400.css";
import "@fontsource/baskervville/latin-400-italic.css";
import "./style.css";
import { stops, sources, elevation, number } from "./data.js";
import { icon, logo } from "./icons.js";
import { initMap } from "./map.js";

const $ = (selector) => document.querySelector(selector);
document
  .querySelectorAll("[data-icon]")
  .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
document.querySelectorAll(".brand-mark").forEach((el) => (el.innerHTML = logo));
const dialog = $("#dialog"),
  dialogBody = $("#dialog-body");
const closeButton =
  '<button class="close-dialog" data-close aria-label="Close guide">' +
  icon("close", 17) +
  "</button>";
let lastFocus = null,
  detailIndex = 0,
  page = 0,
  showAll = false;
const narrow = matchMedia("(max-width:700px)"),
  medium = matchMedia("(max-width:850px)");
const pageSize = () => (narrow.matches ? 1 : medium.matches ? 2 : 3);
const numPages = () => Math.ceil(stops.length / pageSize());
const link = (label, href) =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer">${label} ${icon("external", 13)}</a>`;
const stayList = (s) =>
  `<ul class="lodgings">${s.stays.map(([name, type, source]) => `<li>${link(name, sources[source][1])}<span class="type">${type}</span></li>`).join("")}</ul>`;

function renderCards() {
  const size = pageSize(),
    start = showAll ? 0 : page * size,
    end = showAll ? stops.length : Math.min(start + size, stops.length);
  $("#cards").innerHTML = stops
    .slice(start, end)
    .map((s, offset) => {
      const i = start + offset;
      return `<article class="card">
      <button class="card-hit" data-card="${i}" aria-label="Explore ${s.name}, ${elevation(s)}, lodging and trail challenges"></button>
      <div class="card-img"><img src="./images/${s.id}.webp" width="506" height="334" alt="${s.terrain} along the trail near ${s.name}" loading="${i < 3 ? "eager" : "lazy"}">
      <span class="stop-badge"><i></i>STOP ${number(i)}</span><span class="img-terrain">${icon("pin", 12)}${s.terrain}</span></div>
      <div class="card-content"><div class="card-title"><h3>${s.name}</h3><span class="height">${icon("mountain", 14)}${elevation(s)}</span></div>
      <p>${s.description}</p><div class="card-bottom"><span>${icon("steps", 15)}${s.challenge}</span>${icon("external", 17)}</div></div></article>`;
    })
    .join("");
  $("#counter").innerHTML = `<b>${number(start)}–${number(end - 1)}</b> / 09`;
  $("#prev-page").disabled = showAll || page === 0;
  $("#next-page").disabled = showAll || page === numPages() - 1;
  $("#all").innerHTML = showAll
    ? "Show fewer stops " + icon("chevron", 14)
    : "View all 9 stops " + icon("down", 14);
  $("#all").setAttribute("aria-expanded", String(showAll));
  $("#pages").hidden = showAll;
  $("#pages").innerHTML = Array.from(
    { length: numPages() },
    (_, i) =>
      `<button data-page="${i}" aria-label="Show trail stops starting at ${stops[i * size].name}" aria-current="${i === page}"></button>`,
  ).join("");
}
function changePage(value) {
  page = Math.max(0, Math.min(numPages() - 1, value));
  renderCards();
}
$("#prev-page").onclick = () => changePage(page - 1);
$("#next-page").onclick = () => changePage(page + 1);
$("#pages").onclick = (e) => {
  const item = e.target.closest("[data-page]");
  if (item) {
    changePage(+item.dataset.page);
    $("#pages").children[page].focus({ preventScroll: true });
  }
};
$("#all").onclick = () => {
  showAll = !showAll;
  page = 0;
  renderCards();
  if (!showAll) $("#trail-stops").scrollIntoView();
};
$("#cards").onclick = (e) => {
  const item = e.target.closest("[data-card]");
  if (item) showStop(+item.dataset.card);
};
for (const query of [narrow, medium])
  query.addEventListener("change", () => {
    page = 0;
    renderCards();
  });
renderCards();

function showDialog(content) {
  if (!dialog.open) {
    lastFocus = document.activeElement;
    dialogBody.innerHTML = content;
    dialog.showModal();
  } else dialogBody.innerHTML = content;
  dialog.scrollTop = 0;
  document.body.classList.add("locked");
  dialogBody.querySelector("[data-close]")?.focus({ preventScroll: true });
}
dialog.addEventListener("close", () => {
  if (!$(".hero.expanded")) document.body.classList.remove("locked");
  if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
});
dialog.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) {
    dialog.close();
    return;
  }
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      dialog.close();
  }
  const step = e.target.closest("[data-detail-step]");
  if (step) showStop(detailIndex + Number(step.dataset.detailStep));
});
function showStop(i) {
  const s = stops[i];
  if (!s) return;
  detailIndex = i;
  showDialog(`<div class="dialog-image"><img src="./images/${s.id}.webp" alt="${s.terrain} at ${s.name}">${closeButton}<span class="stop-badge"><i></i>STOP ${number(i)}</span></div>
  <div class="dialog-pad"><div class="eyebrow">${icon("pin", 13)}${s.terrain}</div><div class="dialog-title-line"><h2 id="dialog-title">${s.name}</h2><span class="height">${icon("mountain", 14)}${elevation(s)}</span></div>
  <p class="dialog-intro">${s.description}</p>
  <div class="detail-block"><h3>${icon("steps", 17)}${s.challenge}</h3><p>${s.detail}</p></div>
  <div class="detail-block"><h3>${icon("home", 17)}Places to stay</h3>${stayList(s)}</div>
  <div class="dialog-foot"><button data-detail-step="-1" ${i === 0 ? "disabled" : ""}>${icon("prev", 15)} Previous stop</button><small>${number(i)} / 09</small><button data-detail-step="1" ${i === 8 ? "disabled" : ""}>Next stop ${icon("next", 15)}</button></div></div>`);
}
const map = initMap(showStop);
function showGuide() {
  map.stopTour();
  showDialog(`<div class="guide-head">${closeButton}<div class="eyebrow">${icon("home", 14)} Trail accommodation</div><h2 id="dialog-title">Stay guide</h2>
    <p class="muted">Find village homestays, guesthouses, and mountain lodges along the route.</p><label class="guide-filter">Trail stop <select id="stay-filter"><option value="all">All 9 stops</option>${stops.map((s, i) => `<option value="${i}">${s.name}</option>`).join("")}</select></label></div><div class="guide-content" id="guide-content"></div>`);
  const list = () => {
    const val = $("#stay-filter").value;
    $("#guide-content").innerHTML =
      stops
        .filter((_, i) => val === "all" || +val === i)
        .map(
          (s) =>
            `<section class="stay-group"><h3>${s.name}<small>${elevation(s)}</small></h3>${stayList(s)}</section>`,
        )
        .join("") +
      '<p class="notice">Each listing links to its source. Contact the host to confirm availability for your dates.</p>';
    dialog.scrollTop = 0;
  };
  $("#stay-filter").onchange = list;
  list();
}
$("#stay-nav").onclick = () => {
  closeMenu();
  showGuide();
};
$("#sources").onclick = () => {
  map.stopTour();
  showDialog(`<div class="dialog-pad">${closeButton}<div class="eyebrow">${icon("book", 14)}Field notes</div><h2 id="dialog-title">Route notes &amp; sources</h2>
  <p class="dialog-intro">This guide follows the approach from Ghandruk to Annapurna Base Camp. The nine stops are waypoints, and several may fall within a single walking day.</p>
  <p class="notice">Elevations are approximate and vary within each settlement. The generated landscapes and relief mesh illustrate the trek. Marker positions are schematic. Use a current trail map for navigation.</p>
  <ul class="notes-list">${Object.values(sources)
    .map(([name, href]) => "<li>" + link(name, href) + "</li>")
    .join(
      "",
    )}<li>${link("Upper valley trail conditions", "https://www.havenholidaysnepal.com/blogs/avalanche-risk-zone-between-deurali-to-mbc")}</li></ul></div>`);
};

let saved = false,
  toastTimer;
try {
  saved = localStorage.getItem("himalaya-atlas:abc:saved") === "true";
} catch {}
function renderSave() {
  $("#save").innerHTML =
    icon(saved ? "check" : "bookmark", 15) +
    (saved ? "Route saved" : "Save route");
  $("#save").classList.toggle("saved", saved);
  $("#save").setAttribute("aria-pressed", String(saved));
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("on"), 2400);
}
$("#save").onclick = () => {
  saved = !saved;
  let persistent = true;
  try {
    localStorage.setItem("himalaya-atlas:abc:saved", String(saved));
  } catch {
    persistent = false;
  }
  renderSave();
  toast(
    saved
      ? persistent
        ? "Route saved on this device"
        : "Route saved for this visit"
      : "Route removed from saved routes",
  );
};
renderSave();
const nav = $(".nav");
function closeMenu() {
  nav.classList.remove("open");
  $("#menu").setAttribute("aria-expanded", "false");
  $("#menu").setAttribute("aria-label", "Open navigation");
}
$("#menu").onclick = () => {
  const open = nav.classList.toggle("open");
  $("#menu").setAttribute("aria-expanded", String(open));
  $("#menu").setAttribute(
    "aria-label",
    open ? "Close navigation" : "Open navigation",
  );
};
nav.querySelectorAll("a").forEach((a) => (a.onclick = closeMenu));
document.addEventListener("click", (e) => {
  if (!e.target.closest(".header")) closeMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && nav.classList.contains("open")) {
    closeMenu();
    $("#menu").focus();
  }
});
new IntersectionObserver(
  ([entry]) => {
    $("#route-nav").classList.toggle("active", entry.isIntersecting);
    $("#stops-nav").classList.toggle("active", !entry.isIntersecting);
  },
  { rootMargin: "0px 0px -20% 0px", threshold: 0 },
).observe($("#route"));
