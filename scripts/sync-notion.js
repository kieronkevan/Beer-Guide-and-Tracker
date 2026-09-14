// Pulls beer data from Notion and writes docs/data.json for the static site.
// Run via GitHub Action on a schedule (see .github/workflows/sync-and-deploy.yml).
//
// Required environment variable: NOTION_TOKEN (an internal integration secret
// that has been shared with all four databases: Beers, Countries, Breweries, Styles)
//
// Required environment variables (data source IDs — see README for how to find these):
//   NOTION_BEERS_DS, NOTION_COUNTRIES_DS, NOTION_BREWERIES_DS, NOTION_STYLES_DS

import fs from "node:fs/promises";

const NOTION_VERSION = "2025-09-03";
const TOKEN = process.env.NOTION_TOKEN;

async function notionFetch(path, options = {}) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion API error ${res.status} for ${path}: ${body}`);
  }
  return res.json();
}

async function queryAll(dataSourceId) {
  const cleanId = (dataSourceId || "").trim().toLowerCase();
  let results = [];
  let cursor = undefined;
  do {
    const body = cursor ? { start_cursor: cursor } : {};
    const page = await notionFetch(`/data_sources/${cleanId}/query`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    results = results.concat(page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return results;
}

// Downloads a Notion file (temporary URL) and saves it under docs/images/,
// since Notion's file URLs expire after ~1 hour and can't be linked directly.
async function downloadImage(url, filename) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir("docs/images", { recursive: true });
  await fs.writeFile(`docs/images/${filename}`, buf);
  return `images/${filename}`;
}

function getTitle(prop) {
  return prop?.title?.map(t => t.plain_text).join("") || "";
}
function getRichText(prop) {
  return prop?.rich_text?.map(t => t.plain_text).join("") || "";
}
function getNumber(prop) {
  return prop?.number ?? null;
}
function getSelect(prop) {
  return prop?.select?.name ?? null;
}
function getMultiSelect(prop) {
  return prop?.multi_select?.map(o => o.name) ?? [];
}
function getCheckbox(prop) {
  return !!prop?.checkbox;
}
function getDate(prop) {
  return prop?.date?.start ?? null;
}
function getRelationIds(prop) {
  return prop?.relation?.map(r => r.id) ?? [];
}

// Fetches the page body (write-up) as plain text with paragraph breaks.
async function getPageWriteup(pageId) {
  const blocks = await notionFetch(`/blocks/${pageId}/children?page_size=100`);
  const lines = [];
  for (const block of blocks.results) {
    const rich = block[block.type]?.rich_text;
    if (rich && rich.length) {
      lines.push(rich.map(t => t.plain_text).join(""));
    }
  }
  return lines.join("\n\n");
}

async function main() {
  if (!TOKEN) throw new Error("NOTION_TOKEN is not set");

  const [beerPages, countryPages, breweryPages, stylePages] = await Promise.all([
    queryAll(process.env.NOTION_BEERS_DS),
    queryAll(process.env.NOTION_COUNTRIES_DS),
    queryAll(process.env.NOTION_BREWERIES_DS),
    queryAll(process.env.NOTION_STYLES_DS)
  ]);

  const countryById = {};
  for (const p of countryPages) {
    countryById[p.id] = {
      name: getTitle(p.properties.Name),
      flag: getRichText(p.properties.Flag)
    };
  }

  const breweryById = {};
  for (const p of breweryPages) {
    breweryById[p.id] = { name: getTitle(p.properties.Name) };
  }

  const styleById = {};
  for (const p of stylePages) {
    styleById[p.id] = { name: getTitle(p.properties.Name) };
  }

  const beers = [];
  for (const p of beerPages) {
    const props = p.properties;
    const countryIds = getRelationIds(props.Country);
    const breweryIds = getRelationIds(props.Brewery);
    const styleIds = getRelationIds(props.Style);
    const country = countryById[countryIds[0]] || { name: null, flag: "" };
    const brewery = breweryById[breweryIds[0]] || { name: null };
    const style = styleById[styleIds[0]] || { name: null };

    let writeup = "";
    let photoUrl = null;

    // Only hit these extra endpoints for beers likely to have them, to keep sync fast.
    if (props["Would try again"] || props.Status?.select?.name === "Tried") {
      writeup = await getPageWriteup(p.id);
    }
    const files = props.Photo?.files;
    if (files && files.length) {
      const file = files[0];
      const url = file.type === "file" ? file.file.url : file.external.url;
      photoUrl = await downloadImage(url, `${p.id}.jpg`);
    }

    beers.push({
      name: getTitle(props.Name),
      status: getSelect(props.Status),
      rating: getNumber(props["Overall rating"]),
      abv: getNumber(props.ABV),
      style: style.name,
      country: country.name,
      flag: country.flag,
      brewery: brewery.name,
      servingType: getSelect(props["Serving type"]),
      containerSize: getSelect(props["Container size"]),
      flavourTags: getMultiSelect(props["Flavour tags"]),
      wouldTryAgain: getCheckbox(props["Would try again"]),
      dateTried: getDate(props["Date tried"]),
      whereTried: getRichText(props["Where tried"]),
      tastingNote: getRichText(props["Tasting note"]),
      currentFavourite: getCheckbox(props["Current favourite"]),
      writeup,
      photoUrl
    });
  }

  await fs.mkdir("docs", { recursive: true });
  await fs.writeFile(
    "docs/data.json",
    JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), beers }, null, 2)
  );

  console.log(`Synced ${beers.length} beers to docs/data.json`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
