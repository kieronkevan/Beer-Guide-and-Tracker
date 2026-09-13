const STYLE_COLORS = {
  "Lager": "#c68a2e",
  "IPA": "#8a6b1f",
  "Stout": "#3a2416",
  "Wheat beer": "#6b7a3a"
};

let ALL_BEERS = [];
let activeCountry = null;

const stampStrip = document.getElementById("stamp-strip");
const beerList = document.getElementById("beer-list");
const statsLine = document.getElementById("stats-line");
const searchInput = document.getElementById("search");
const styleSelect = document.getElementById("filter-style");
const statusSelect = document.getElementById("filter-status");
const clearBtn = document.getElementById("clear-filters");
const favChip = document.getElementById("favourite-chip");
const favName = document.getElementById("favourite-name");

fetch("data.json")
  .then(r => r.json())
  .then(data => {
    ALL_BEERS = data.beers || [];
    init();
  })
  .catch(() => {
    statsLine.textContent = "Couldn't load the beer list. Try refreshing.";
  });

function init() {
  buildStats();
  buildFavourite();
  buildStamps();
  buildStyleOptions();
  render();

  searchInput.addEventListener("input", render);
  styleSelect.addEventListener("change", render);
  statusSelect.addEventListener("change", render);
  clearBtn.addEventListener("click", () => {
    activeCountry = null;
    searchInput.value = "";
    styleSelect.value = "";
    statusSelect.value = "";
    buildStamps();
    render();
  });
}

function buildStats() {
  const tried = ALL_BEERS.filter(b => b.status === "Tried").length;
  const countries = new Set(ALL_BEERS.map(b => b.country)).size;
  const wantToTry = ALL_BEERS.filter(b => b.status === "Want to try").length;
  statsLine.textContent = `${countries} countries stamped · ${tried} beers tried` + (wantToTry ? ` · ${wantToTry} on the list to try` : "");
}

function buildFavourite() {
  const fave = ALL_BEERS.find(b => b.currentFavourite);
  if (fave) {
    favChip.hidden = false;
    favName.textContent = fave.name;
  }
}

function buildStamps() {
  const byCountry = {};
  ALL_BEERS.forEach(b => {
    if (!byCountry[b.country]) byCountry[b.country] = { flag: b.flag, count: 0 };
    byCountry[b.country].count++;
  });

  stampStrip.innerHTML = "";
  Object.keys(byCountry).sort((a, b) => byCountry[b].count - byCountry[a].count).forEach((country, i) => {
    const el = document.createElement("button");
    el.className = "stamp" + (activeCountry === country ? " active" : "");
    el.style.setProperty("--tilt", `${(i % 5 - 2) * 1.1}deg`);
    el.innerHTML = `<span class="flag">${byCountry[country].flag}</span> ${country} <span class="count">${byCountry[country].count}</span>`;
    el.addEventListener("click", () => {
      activeCountry = activeCountry === country ? null : country;
      buildStamps();
      render();
    });
    stampStrip.appendChild(el);
  });
}

function buildStyleOptions() {
  const styles = [...new Set(ALL_BEERS.map(b => b.style).filter(Boolean))].sort();
  styles.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    styleSelect.appendChild(opt);
  });
}

function render() {
  const q = searchInput.value.trim().toLowerCase();
  const style = styleSelect.value;
  const status = statusSelect.value;

  const filtered = ALL_BEERS.filter(b => {
    if (activeCountry && b.country !== activeCountry) return false;
    if (style && b.style !== style) return false;
    if (status && b.status !== status) return false;
    if (q) {
      const hay = [b.name, b.brewery, b.tastingNote, b.country].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (a.status !== b.status) return a.status === "Tried" ? -1 : 1;
    return (b.rating || 0) - (a.rating || 0);
  });

  beerList.innerHTML = "";

  if (filtered.length === 0) {
    beerList.innerHTML = `<div class="empty-state">No beers match those filters.</div>`;
    return;
  }

  filtered.forEach(b => beerList.appendChild(renderRow(b)));
}

function renderRow(b) {
  const row = document.createElement("details");
  row.className = "beer-row";
  row.style.setProperty("--style-color", STYLE_COLORS[b.style] || "#c68a2e");

  const ratingHtml = b.status === "Tried" && b.rating != null
    ? `<span class="beer-rating">${b.rating.toFixed(1)}</span>`
    : `<span class="beer-rating pending">Want to try</span>`;

  const summary = document.createElement("summary");
  summary.innerHTML = `
    <span class="beer-name">${b.currentFavourite ? '<span class="fave">★</span>' : ""}${b.name}</span>
    <span class="beer-meta">${b.flag || ""} ${b.country}</span>
    <span class="beer-meta">${b.style || ""}</span>
    ${ratingHtml}
  `;
  row.appendChild(summary);

  const details = document.createElement("div");
  details.className = "beer-details";

  details.appendChild(field("Brewery", b.brewery || "—"));
  if (b.abv != null) details.appendChild(field("ABV", `${b.abv}%`));
  if (b.servingType) details.appendChild(field("Served", b.servingType));
  if (b.containerSize) details.appendChild(field("Container", b.containerSize));
  if (b.whereTried) details.appendChild(field("Where tried", b.whereTried));
  if (b.dateTried) details.appendChild(field("Date tried", b.dateTried));
  if (b.wouldTryAgain) details.appendChild(field("Would try again", "Yes"));

  if (b.flavourTags && b.flavourTags.length) {
    const tagWrap = document.createElement("div");
    tagWrap.innerHTML = `<div class="field-label">Flavour</div>`;
    const tagList = document.createElement("div");
    tagList.className = "tag-list";
    b.flavourTags.forEach(t => {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = t;
      tagList.appendChild(tag);
    });
    tagWrap.appendChild(tagList);
    details.appendChild(tagWrap);
  }

  if (b.tastingNote) {
    const note = document.createElement("div");
    note.style.gridColumn = "1 / -1";
    note.innerHTML = `<div class="field-label">Tasting note</div>${escapeHtml(b.tastingNote)}`;
    details.appendChild(note);
  }

  if (b.writeup) {
    const w = document.createElement("div");
    w.className = "writeup";
    w.innerHTML = escapeHtml(b.writeup).replace(/\n/g, "<br>");
    details.appendChild(w);
  }

  row.appendChild(details);
  return row;
}

function field(label, value) {
  const el = document.createElement("div");
  el.innerHTML = `<div class="field-label">${label}</div>${value}`;
  return el;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
