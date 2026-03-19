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
  //   <ruby>食べる<rt>たべる</rt></ruby>
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

  console.log("[IK] Raw first example:", json.examples?.[0]);
  return json.examples || [];
}
