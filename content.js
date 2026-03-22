console.log("[IK] Extension loaded on:", window.location.href);

function parseVocab() {
  const url = window.location.href;
  console.log("[IK] Scanning page:", url);

  // vocabulary page — word is in the URL
  if (url.includes("/vocabulary/")) {
    const match = url.match(/\/vocabulary\/\d+\/([^#/?]*)/);
    if (match) {
      const word = decodeURIComponent(match[1]);
      console.log("[IK] Vocabulary page, word:", word);
      return word;
    }
  }

  // kanji page — word is in the URL
  if (url.includes("/kanji/")) {
    const match = url.match(/\/kanji\/\d+\/([^#/?]*)/);
    if (match) {
      const word = decodeURIComponent(match[1]).split("/")[0];
      console.log("[IK] Kanji page, word:", word);
      return word;
    }
  }

  // search page  word is in the query string
  if (url.includes("/search?q=")) {
    const match = url.match(/\/search\?q=([^&]*)/);
    if (match) {
      const word = decodeURIComponent(match[1]);
      console.log("[IK] Search page, word:", word);
      return word;
    }
  }

  //https://jpdb.io/review?c=vf%2C1994460%2C3995039005&r=1#a
  // review page  word is in the DOM, not the URL
  if (url.includes("/review") || url.includes("c=")) {
    console.log("[IK] Review page, scanning DOM...");

    // anchor links always have the clean word in the href
    const links = document.querySelectorAll(
      'a[href*="/vocabulary/"], a[href*="/kanji/"]',
    );
    for (const link of links) {
      const href = link.getAttribute("href");
      const match = href.match(/\/(vocabulary|kanji)\/\d+\/([^#?]*)/);
      if (match?.[2]) {
        const word = decodeURIComponent(match[2]);
        console.log("[IK] Word from link:", word);
        return word;
      }
    }

    //strip furigana from word
    // without stripping: "食べる" becomes "食べるたべる" (kanji + reading mashed)
    const plainEl = document.querySelector(".plain");
    if (plainEl) {
      const clone = plainEl.cloneNode(true);
      clone.querySelectorAll("rt, rp").forEach((n) => n.remove());
      const word = clone.textContent.trim();
      if (word) {
        console.log("[IK] Word from .plain:", word);
        return word;
      }
    }
  }

  console.warn("[IK] Could not find word on this page");
  return "";
}

const MEDIA_BASE =
  "https://us-southeast-1.linodeobjects.com/immersionkit/media";

let titleMap = null;

async function loadTitleMap() {
  if (titleMap) return;

  try {
    const res = await fetch("https://apiv2.immersionkit.com/index_meta");
    const json = await res.json();

    titleMap = {};
    // map slug hunter_x_hunter to Hunter X Hunter Name in hashmap
    for (const [slug, entry] of Object.entries(json.data)) {
      titleMap[slug] = entry.title || slug; // incase slug is as same as the title.
    }

    console.log(
      "[IK] Title map loaded,",
      Object.keys(titleMap).length,
      "entries",
    );
  } catch (err) {
    console.error("[IK] Title map fetch failed:", err);
    titleMap = {}; // empty map — fall back to slug as-is
  }
}

// example fetch from console logs is as following
// media: "anime" => media type or category
// title: "hunter_x_hunter" => actual slug
// image: "HUNTERxHUNTER_22.JPG" filename
// sound: ...........mp3 filename

function getImageUrl(ex) {
  const category = ex.media || ex.id?.split("_")[0] || "";
  const displayTitle = titleMap?.[ex.title] || ex.title || "";
  const filename = ex.image || "";

  if (!filename) return null;

  // browser encodes automatically when setting img.src , didnt fetch correctly for example Hunter_x_Hunter is Hunter%20%20 something after using encodeURIComponent
  return `${MEDIA_BASE}/${category}/${displayTitle}/media/${filename}`;
}

function getSoundUrl(ex) {
  const category = ex.media || ex.id?.split("_")[0] || "";
  const displayTitle = titleMap?.[ex.title] || ex.title || "";
  const filename = ex.sound || "";

  if (!filename) return null;

  return `${MEDIA_BASE}/${category}/${displayTitle}/media/${filename}`;
}

// v2 response shape: { examples: [...], category_count: {...} }
// not rootJsonResponse.data?.[0]?.examples ,,that was the old dead v1 api

async function fetchExamples(vocab) {
  const url = `https://apiv2.immersionkit.com/search?q=${encodeURIComponent(vocab)}&sort=sentence_length:asc&limit=50`;
  console.log("[IK] Fetching from API:", url);

  try {
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`ImmersionKit API responded with status: ${res.status}`);
    }

    const json = await res.json();
    console.log("[IK] Raw API Response:", json);

    const examples = json.examples || [];
    console.log("[IK] Extracted Examples Array:", examples);

    return examples;
  } catch (err) {
    console.error("[IK] Fetch failed:", err);
    return [];
  }
}

let currentAudio = null;
let pendingUrl = null;
let unlockAttached = false;

function stopAudio() {
  if (!currentAudio) return;
  currentAudio.pause();
  currentAudio.src = "";
  currentAudio = null;
  pendingUrl = null;
}

function unlockAndPlay() {
  if (!pendingUrl) return;
  const url = pendingUrl;
  pendingUrl = null;
  playAudio(url);
}

function ensureUnlockListener() {
  if (unlockAttached) return;
  unlockAttached = true;
  document.addEventListener("click", unlockAndPlay, { passive: true });
  document.addEventListener("keydown", unlockAndPlay, { passive: true });
}

async function playAudio(soundUrl) {
  if (!soundUrl) return;
  ensureUnlockListener();

  stopAudio();

  const res = await fetch(soundUrl);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);

  const audio = new Audio(blobUrl);
  audio.volume = 0.8;

  try {
    await audio.play();
    currentAudio = audio;
    audio.onended = () => {
      URL.revokeObjectURL(blobUrl);
      currentAudio = null;
    };
  } catch (err) {
    console.log("[IK] Autoplay blocked, queued for first interaction");
    URL.revokeObjectURL(blobUrl);
    pendingUrl = soundUrl;
  }
}

// widget UI
function injectWidget(examples) {
  document.getElementById("ik-widget")?.remove();
  if (!examples.length) return;

  let index = 0;

  function makeArrow(label, onClick) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.cssText =
      "width:45px;height:35px;font-size:14px;cursor:pointer;border-radius:4px;";
    btn.addEventListener("click", onClick);
    return btn;
  }

  const widget = document.createElement("div");
  widget.id = "ik-widget";
  widget.style.cssText = "text-align:center;margin:8px 0;font-family:inherit;";

  const content = document.createElement("div");

  function renderContent() {
    content.innerHTML = "";
    const ex = examples[index];
    const imageUrl = getImageUrl(ex);
    const soundUrl = getSoundUrl(ex);

    if (imageUrl) {
      const img = document.createElement("img");
      img.src = imageUrl;
      img.style.cssText =
        "max-width:400px;border-radius:4px;display:block;margin:0 auto;cursor:pointer;margin-top:6px;";
      img.onerror = () => (img.style.display = "none");
      img.addEventListener("click", () => playAudio(soundUrl));
      content.appendChild(img);
    }

    if (soundUrl) {
      const speaker = document.createElement("button");
      speaker.textContent = "🔊";
      speaker.style.cssText =
        "margin-top:8px;font-size:1.2rem;background:none;border:none;cursor:pointer;";
      speaker.addEventListener("click", () => playAudio(soundUrl));
      content.appendChild(speaker);
    }

    if (ex.sentence) {
      const sent = document.createElement("div");
      sent.textContent = ex.sentence;
      sent.style.cssText = "margin-top:8px;font-size:120%;color:#ddd;";
      content.appendChild(sent);
    }

    if (ex.translation) {
      const trans = document.createElement("div");
      trans.textContent = ex.translation;
      trans.style.cssText = "margin-top:4px;font-size:85%;color:#888;";
      content.appendChild(trans);
    }

    const counter = document.createElement("div");
    counter.textContent = `${index + 1} / ${examples.length}`;
    counter.style.cssText = "margin-top:6px;font-size:75%;color:#666;";
    content.appendChild(counter);

    leftBtn.disabled = index === 0;
    rightBtn.disabled = index === examples.length - 1;
    leftBtn.style.opacity = leftBtn.disabled ? "0.3" : "1";
    rightBtn.style.opacity = rightBtn.disabled ? "0.3" : "1";

    playAudio(soundUrl);
  }

  const leftBtn = makeArrow("←", () => {
    if (index > 0) {
      stopAudio();
      index--;
      renderContent();
    }
  });
  const rightBtn = makeArrow("→", () => {
    if (index < examples.length - 1) {
      stopAudio();
      index++;
      renderContent();
    }
  });

  const row = document.createElement("div");
  row.style.cssText =
    "display:flex;align-items:center;justify-content:center;gap:8px;";
  row.append(leftBtn, content, rightBtn);
  widget.appendChild(row);

  renderContent();

  const anchor =
    document.querySelector(".subsection-meanings") ||
    document.querySelector(".result.vocabulary") ||
    document.querySelector(".hbox.wrap") ||
    document.querySelectorAll("h6.subsection-label")[2];

  if (anchor) anchor.parentNode.insertBefore(widget, anchor);
  else console.warn("[IK] No injection point found");
}

let lastUrl = window.location.href;

const navObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    console.log("[IK] URL changed, re-running");
    stopAudio();
    setTimeout(main, 300);
  }
});

navObserver.observe(document.body, { childList: true, subtree: true });

window.addEventListener("popstate", () => {
  stopAudio();
  setTimeout(main, 300);
});
window.addEventListener("hashchange", () => {
  stopAudio();
  setTimeout(main, 300);
});

async function main() {
  document.getElementById("ik-widget")?.remove();

  const targetWord = parseVocab();

  if (!targetWord) {
    console.log("[IK] No word found, stopping execution.");
    return;
  }

  try {
    const [examples] = await Promise.all([
      fetchExamples(targetWord),
      loadTitleMap(),
    ]);

    if (!examples || examples.length === 0) {
      console.warn("[IK] No valid examples found for:", targetWord);
      return;
    }

    console.log("[IK] Valid data received. Example count:", examples.length);

    injectWidget(examples);
  } catch (err) {
    console.error("[IK] Error during parallel data loading:", err);
  }
}

main();
