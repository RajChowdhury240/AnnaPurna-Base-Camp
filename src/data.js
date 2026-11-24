export const sources = {
  map: [
    "Route and elevations",
    "https://summitexcursions.com/wp-content/uploads/2024/11/Annapurna-Base-Camp-Trek-11-Days-Map.pdf",
  ],
  trail: [
    "Trail descriptions",
    "https://www.taan.org.np/index.php/members/899",
  ],
  municipal: [
    "Municipal lodging directory",
    "https://visit.annapurnamunkaski.org/accomodations/",
  ],
  lodges: [
    "Trekking lodge directory",
    "https://broadadventure.com/blog/hotel-names-and-contact-numbers-abc-trek/",
  ],
  homestay: [
    "Ghandruk accommodation guide",
    "https://events.wordpress.org/nepal/2026/photo-festival/accommodation-guide-for-the-closing-ceremony-at-ghandruk/",
  ],
};

export const stops = [
  {
    name: "Ghandruk",
    id: "ghandruk",
    height: 1940,
    point: [231, 485],
    label: "start",
    terrain: "Terraced foothills",
    description:
      "Stone-roofed Gurung homes and terraced fields look out toward Annapurna South.",
    challenge: "Uneven stone steps",
    detail:
      "The walk through the old village climbs irregular stone stairways. Wet flagstones can be slippery, and the onward trail dips into the Kimrong valley before climbing again.",
    stays: [
      ["Ashish Aama Homestay", "Homestay", "homestay"],
      ["Ghandruk Guest House", "Guesthouse", "lodges"],
    ],
  },
  {
    name: "Chhomrong",
    id: "chhomrong",
    height: 2170,
    point: [381, 414],
    label: "left",
    terrain: "Hillside village",
    description:
      "A hillside village of stone stairways, with the Sanctuary peaks just beyond the rooftops.",
    challenge: "Long stone staircase",
    detail:
      "A long staircase drops steeply to Chhomrong Khola. After the river crossing, the trail climbs back up the opposite slope toward Sinuwa.",
    stays: [
      ["Chhomrong Cottage", "Lodge", "municipal"],
      ["Lucky Guest House", "Guesthouse", "municipal"],
    ],
  },
  {
    name: "Sinuwa",
    id: "sinuwa",
    height: 2340,
    point: [434, 368],
    terrain: "Rhododendron forest",
    description:
      "The last village terraces give way to mossy steps and deep rhododendron forest.",
    challenge: "Sustained uphill steps",
    detail:
      "The climb from the river to Upper Sinuwa follows a long flight of steps. Beyond the village, roots and shaded stones make for uneven footing.",
    stays: [
      ["Hill Top Lodge", "Lodge", "municipal"],
      ["Sinuwa Guest House", "Guesthouse", "lodges"],
    ],
  },
  {
    name: "Bamboo",
    id: "bamboo",
    height: 2310,
    point: [473, 375],
    terrain: "Bamboo forest",
    description:
      "A small cluster of teahouses sits in the cool shade of the Modi Khola gorge.",
    challenge: "Damp forest descent",
    detail:
      "Stone steps descend through dense woodland. The shaded trail dries slowly, so wet rocks and leaf litter can make the descent slippery.",
    stays: [
      ["Bamboo Guest House", "Guesthouse", "lodges"],
      ["Buddha Guest House", "Guesthouse", "lodges"],
    ],
  },
  {
    name: "Dovan",
    id: "dovan",
    height: 2500,
    point: [535, 336],
    terrain: "River gorge",
    description:
      "The route follows the river through a narrow gorge of forest and waterfalls.",
    challenge: "Rocky river trail",
    detail:
      "The gorge confines the trail to narrow, uneven stretches. Water running off the cliffs can leave slippery patches across the path.",
    stays: [
      ["Dovan Guest House", "Guesthouse", "municipal"],
      ["Annapurna Approach Lodge", "Lodge", "municipal"],
    ],
  },
  {
    name: "Himalaya",
    id: "himalaya",
    height: 2950,
    point: [578, 305],
    terrain: "Upper gorge",
    description:
      "A handful of lodges shelter below towering cliffs as the forest begins to thin.",
    challenge: "Steep rocky climbs",
    detail:
      "The gradient steepens above the lodges. Rough steps and boulders break up the climb toward Hinku Cave and the open slopes beyond.",
    stays: [
      ["Hotel Royal Family Himalaya Lodge", "Lodge", "municipal"],
      ["Himalaya Guest House", "Guesthouse", "municipal"],
    ],
  },
  {
    name: "Deurali",
    id: "deurali",
    height: 3140,
    point: [641, 279],
    label: "left",
    terrain: "Alpine river valley",
    description:
      "Trees fall away to reveal a broad, rocky valley at the entrance to the Sanctuary.",
    challenge: "Exposed avalanche terrain",
    detail:
      "The approach to Machhapuchhre Base Camp crosses exposed slopes. Snow, rockfall and seasonal avalanche conditions can change the usable route. Check current local guidance before leaving the lodges.",
    stays: [
      ["Dream Lodge", "Lodge", "municipal"],
      ["Yak Hotel & Lodge", "Lodge", "municipal"],
    ],
  },
  {
    name: "Machhapuchhre Base Camp",
    short: "Machhapuchhre BC",
    id: "machhapuchhre",
    height: 3700,
    point: [695, 251],
    terrain: "Alpine basin",
    description:
      "The valley opens beneath Machhapuchhre, with the snowy amphitheatre of Annapurna ahead.",
    challenge: "Altitude and exposure",
    detail:
      "The climb from Deurali gains roughly 560 metres. Thin air, wind and a lack of shelter between lodges make the final open stretch more demanding.",
    stays: [
      ["Fishtail Guest House", "Guesthouse", "municipal"],
      ["Gurung Co-Operative Guest House", "Guesthouse", "lodges"],
    ],
  },
  {
    name: "Annapurna Base Camp",
    short: "Annapurna BC",
    id: "annapurna",
    height: 4130,
    point: [745, 207],
    label: "summit",
    terrain: "Glacial sanctuary",
    description:
      "The trail ends in a cirque of Himalayan peaks beneath the immense south face of Annapurna I.",
    challenge: "High-altitude ascent",
    detail:
      "The final 430 metres of ascent cross an open alpine basin. Cold winds and snow can obscure the trail, and the altitude makes even gentle slopes feel strenuous.",
    stays: [
      ["Annapurna Guest House", "Guesthouse", "municipal"],
      ["Snowland Lodge", "Lodge", "lodges"],
    ],
  },
];
export const elevation = (s) => s.height.toLocaleString("en-US") + " m";
export const number = (n) => String(n + 1).padStart(2, "0");
