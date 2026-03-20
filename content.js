console.log("[IK] Extension loaded on:", window.location.href);

function parseVocab() {
  const url = window.location.href;

  // vocabulary page — word is in the URL itself, easiest case
  // e.g. /vocabulary/1289480/食#a
  if (url.includes("/vocabulary/")) {
    const match = url.match(/\/vocabulary\/\d+\/([^#/?]*)/);
    if (match) return decodeURIComponent(match[1]);
  }

  // kanji page — same idea, word is in the URL
  // ex /kanji/1234/食#a
  if (url.includes("/kanji/")) {
    const match = url.match(/\/kanji\/\d+\/([^#/?]*)/);
    if (match) return decodeURIComponent(match[1]).split("/")[0];
  }

  // search page — word is in the query string
  // ex /search?q=食べる
  if (url.includes("/search?q=")) {
    const match = url.match(/\/search\?q=([^&]*)/);
    if (match) return decodeURIComponent(match[1]);
  }

  // review page — word is NOT in the URL, it's in the DOM
  // e.g. /review?c=vf%2C1588410%2C2751011542&r=6#a
  //
  // JPDB renders kanji like this:
  //    <ruby>食べる<rt>たべる</rt></ruby>
  //
  // The problem: element.textContent gives "食べるたべる" (kanji + furigana mashed together)
  // The fix: clone the element, remove all <rt> tags, THEN read textContent
  if (/\/review/.test(url) || url.includes("c=")) {
    // Option 1 (most reliable): the vocab anchor link always has the clean word in its href
    const links = document.querySelectorAll(
      'a[href*="/vocabulary/"], a[href*="/kanji/"]',
    );
    for (const link of links) {
      const href = link.getAttribute("href");
      const match = href.match(/\/(vocabulary|kanji)\/\d+\/([^#?]*)/);
      if (match?.[2]) return decodeURIComponent(match[2]);
    }

    // Option 2 (fallback): read .plain element but strip furigana first
    const plainEl = document.querySelector(".plain");
    if (plainEl) {
      const clone = plainEl.cloneNode(true); // copy, don't touch the real page
      clone.querySelectorAll("rt, rp").forEach((n) => n.remove()); // remove furigana
      const text = clone.textContent.trim();
      if (text) return text;
    }
  }

  return ""; // nothing found on this page type
}

// run it and log the result so we can verify
const vocab = parseVocab(); // the actual highlighted vocab
console.log("[IK] Parsed vocab:", vocab); // making sure if it really exists

async function fetchExamples(vocab) {
  const url = `https://apiv2.immersionkit.com/search?q=${encodeURIComponent(vocab)}&sort=sentence_length:asc&limit=50`;
  console.log("[IK] Fetching:", url);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);

  const json = await res.json();

  //use json.data.[0] instead
  const examples = json.data?.[0]?.examples || [];

  if (examples.length > 0) {
    console.log("[IK] Found examples:", examples.length);
    console.log("[IK] Raw first example:", examples[0]);
  } else {
    console.log("[IK] No examples found in the data array.");
  }

  return examples;
}

const MEDIA_BASE =
  "https://us-southeast-1.linodeobjects.com/immersionkit/media";

let titleMap = null; // here we init title map which gonna hold meta data about titles to fetch data by anime etc {"hunter_hunter": "Hunter x Hunter}

async function loadTitleMap() {
  if (titleMap) return; //if we got titlemap before reuse
  const res = await fetch("https://apiv2.immersionkit.com/index_meta"); // here we fetch the meta data

  const json = await res.json();

  titleMap = {};
  for (const [slug, entry] of Object.entries(json.data)) {
    titleMap[slug] = entry.title || slug; // we iterate over map and make url slug = actual entry name else use slug = slug
  }
  console.log("[IK] Title map loaded", Object.keys(titleMap).length, "entries"); // we can use length of titlemap to shwo how many examples we have later (maybe)
}

function buildMediaUrl(category, titleSlug, filename) {
  // the browser auto encode underscores and and spaces so we dont have to use encoding
  if (!filename) return null;
  const displayTitle = titleMap?.[titleSlug] || titleSlug;
  // the pattern is https://us-southeast-1.linodeobjects.com/immersionkit/media/anime/Your%20Name/media/Anime_-_YourName_1_0.31.52.115.jpg .../title/media/
  return `${MEDIA_BASE}/${category}/${encodeURIComponent(displayTitle)}/media/${filename}`;
}

function getImageUrl(ex) {
  const category = ex.media || ex.id?.split("_")[0] || "anime";
  return buildMediaUrl(category, ex.deck_name || ex.title, ex.image);
}

function getSoundUrl(ex) {
  const category = ex.media || ex.id?.split("_")[0] || "anime";
  return buildMediaUrl(category, ex.deck_name || ex.title, ex.sound);
}

function buildWidget(ex, index, total) {
  const widget = document.createElement("div");
  widget.id = "ik-widget";
  widget.style.cssText =
    "text-align:center; margin:20px; padding:10px; background:#222; border-radius:8px; color:white;";

  const imageUrl = getImageUrl(ex);
  if (imageUrl) {
    const img = document.createElement("img");
    img.src = imageUrl;
    img.style.cssText = "max-width:100%; border-radius:4px; cursor:pointer;";
    img.onerror = () => img.remove();
    widget.appendChild(img);
  }

  const text = document.createElement("div");
  text.textContent = ex.sentence;
  text.style.cssText = "margin-top:10px; font-size:1.1em;";
  widget.appendChild(text);

  const translation = document.createElement("div");
  translation.textContent = ex.translation || "";
  translation.style.cssText = "margin-top:5px; font-size:0.9em; color:#aaa;";
  widget.appendChild(translation);

  return widget;
}

function injectWidget(examples) {
  let index = 0;

  const render = () => {
    document.getElementById("ik-widget")?.remove();

    const anchor =
      document.querySelector(".subsection-meanings") ||
      document.querySelector(".result.vocabulary") ||
      document.querySelector(".hbox.wrap") ||
      document.querySelectorAll("h6.subsection-label")[2];

    if (!anchor) {
      console.warn("[IK] No injection point found");
      return;
    }

    const widget = buildWidget(examples[index], index, examples.length);

    const nav = document.createElement("div");
    nav.style.marginTop = "10px";

    const prevBtn = document.createElement("button");
    prevBtn.textContent = "← Prev";
    prevBtn.onclick = () => {
      index = (index - 1 + examples.length) % examples.length;
      render();
    };

    const nextBtn = document.createElement("button");
    nextBtn.textContent = "Next →";
    nextBtn.style.marginLeft = "10px";
    nextBtn.onclick = () => {
      index = (index + 1) % examples.length;
      render();
    };

    const counter = document.createElement("span");
    counter.textContent = ` ${index + 1} / ${examples.length} `;
    counter.style.margin = "0 10px";

    nav.append(prevBtn, counter, nextBtn);
    widget.appendChild(nav);

    anchor.parentNode.insertBefore(widget, anchor);
  };

  render();
}

async function main() {
  const vocab = parseVocab();
  if (!vocab) return;

  try {
    const [examples] = await Promise.all([
      fetchExamples(vocab),
      loadTitleMap(),
    ]);

    if (examples.length > 0) {
      const imageUrl = getImageUrl(examples[0]);
      const soundUrl = getSoundUrl(examples[0]);
      console.log("[IK] Image URL:", imageUrl);
      console.log("[IK] Sound URL:", soundUrl);

      injectWidget(examples);
    }
  } catch (e) {
    console.error("[IK] Error in main loop:", e);
  }
}

main();
