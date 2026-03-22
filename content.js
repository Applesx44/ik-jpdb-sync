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

const CACHE_EXPIRY = 30 * 24 * 60 * 60 * 1000;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("IKCache", 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore("examples", { keyPath: "keyword" });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.errorCode);
  });
}

async function cacheGet(keyword) {
  const db = await openDB();
  return new Promise((resolve) => {
    const req = db
      .transaction("examples", "readonly")
      .objectStore("examples")
      .get(keyword);
    req.onsuccess = (e) => {
      const record = e.target.result;
      if (!record) return resolve(null);
      if (Date.now() - record.timestamp > CACHE_EXPIRY) return resolve(null);
      resolve(record.data);
    };
    req.onerror = () => resolve(null);
  });
}

async function cacheSet(keyword, data) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction("examples", "readwrite");
    tx.objectStore("examples").put({ keyword, data, timestamp: Date.now() });
    tx.oncomplete = resolve;
  });
}

// v2 response shape: { examples: [...], category_count: {...} }
// not rootJsonResponse.data?.[0]?.examples ,,that was the old dead v1 api

async function fetchExamples(vocab) {
  const url = `https://apiv2.immersionkit.com/search?q=${encodeURIComponent(vocab)}&sort=sentence_length:asc&limit=50`;

  const cached = await cacheGet(vocab);
  if (cached) {
    console.log("[IK] Cache hit for:", vocab);
    return cached;
  }

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

    cacheSet(vocab, examples).catch((e) =>
      console.warn("[IK] Cache write failed:", e),
    );

    return examples;
  } catch (err) {
    console.error("[IK] Fetch failed:", err);
    return [];
  }
}

// priority decks examples from these slugs float to the top in order
// if none match, all examples are shown sorted by sentence length
const PRIORITY_DECKS = [
  "hunter_x_hunter",
  "yakusoku_no_neverland",
  "fullmetal_alchemist_brotherhood",
  "steins_gate",
];

function sortByPriority(examples) {
  const buckets = {};
  for (const deck of PRIORITY_DECKS) {
    buckets[deck] = [];
  }
  const rest = [];

  for (const ex of examples) {
    if (buckets[ex.title] !== undefined) {
      buckets[ex.title].push(ex);
    } else {
      rest.push(ex);
    }
  }

  const priority = PRIORITY_DECKS.flatMap((deck) => buckets[deck]);

  if (priority.length === 0) {
    return [...rest].sort(
      (a, b) => (a.sentence || "").length - (b.sentence || "").length,
    );
  }

  return [...priority, ...rest];
}

// settings page

const SETTINGS_KEY = "ik-settings";

const DEFAULT_SETTINGS = {
  imageWidth: 400,
  volume: 0.8,
  autoplay: true,
  showTranslation: true,
};

let settings = { ...DEFAULT_SETTINGS };

function loadSettings() {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
  } catch (_) {}
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function openSettingsMenu() {
  document.getElementById("ik-settings-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "ik-settings-overlay";
  overlay.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    background:rgba(0,0,0,0.75);z-index:9999;
    display:flex;justify-content:center;align-items:center;
  `;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const panel = document.createElement("div");
  panel.style.cssText = `
    background:#1a1a2e;color:#eee;padding:24px;
    border-radius:8px;width:360px;
    box-shadow:0 4px 32px rgba(0,0,0,0.5);
  `;

  panel.innerHTML = `<h3 style="margin:0 0 16px;font-size:1rem;">⚙ ImmersionKit Settings</h3>`;

  function makeRow(label, inputEl) {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;font-size:90%;";
    const lbl = document.createElement("span");
    lbl.textContent = label;
    row.append(lbl, inputEl);
    return row;
  }

  const widthInput = document.createElement("input");
  widthInput.type = "number";
  widthInput.value = settings.imageWidth;
  widthInput.min = "200";
  widthInput.max = "800";
  widthInput.style.cssText =
    "width:70px;background:#111;color:#eee;border:1px solid #555;border-radius:4px;padding:4px;";
  panel.appendChild(makeRow("Image width (px)", widthInput));

  const volInput = document.createElement("input");
  volInput.type = "range";
  volInput.min = "0";
  volInput.max = "1";
  volInput.step = "0.05";
  volInput.value = settings.volume;
  panel.appendChild(makeRow("Volume", volInput));

  const autoplayInput = document.createElement("input");
  autoplayInput.type = "checkbox";
  autoplayInput.checked = settings.autoplay;
  panel.appendChild(makeRow("Autoplay audio", autoplayInput));

  const transInput = document.createElement("input");
  transInput.type = "checkbox";
  transInput.checked = settings.showTranslation;
  panel.appendChild(makeRow("Show translation", transInput));

  const priorityLabel = document.createElement("div");
  priorityLabel.style.cssText =
    "font-size:85%;color:#aaa;margin-bottom:4px;margin-top:12px;";
  priorityLabel.textContent = "Priority decks (one slug per line, shown first)";

  const priorityTA = document.createElement("textarea");
  priorityTA.value = PRIORITY_DECKS.join("\n");
  priorityTA.style.cssText = `
    width:100%;height:80px;box-sizing:border-box;margin-bottom:12px;
    background:#111;color:#eee;border:1px solid #555;
    border-radius:4px;padding:6px;font-size:82%;font-family:monospace;resize:vertical;
  `;
  panel.appendChild(priorityLabel);
  panel.appendChild(priorityTA);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:8px;margin-top:8px;";

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  saveBtn.style.cssText =
    "flex:1;padding:8px;border-radius:4px;background:#3d81ff;color:#fff;";
  saveBtn.addEventListener("click", () => {
    settings.imageWidth = parseInt(widthInput.value) || 400;
    settings.volume = parseFloat(volInput.value);
    settings.autoplay = autoplayInput.checked;
    settings.showTranslation = transInput.checked;

    const newDecks = priorityTA.value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    PRIORITY_DECKS.length = 0;
    PRIORITY_DECKS.push(...newDecks);

    saveSettings();
    overlay.remove();
    main();
  });

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.style.cssText =
    "flex:1;padding:8px;border-radius:4px;background:#333;color:#fff;";
  closeBtn.addEventListener("click", () => overlay.remove());

  const clearBtn = document.createElement("button");
  clearBtn.textContent = "Clear cache";
  clearBtn.style.cssText =
    "flex:1;padding:8px;border-radius:4px;background:#555;color:#fff;";
  clearBtn.addEventListener("click", async () => {
    const req = indexedDB.deleteDatabase("IKCache");
    req.onsuccess = () => {
      clearBtn.textContent = "✓ Cleared";
      setTimeout(() => {
        clearBtn.textContent = "Clear cache";
      }, 2000);
    };
  });

  btnRow.append(saveBtn, closeBtn, clearBtn);
  panel.appendChild(btnRow);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
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
  audio.volume = settings.volume;

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

function injectWidget(examples) {
  document.getElementById("ik-container")?.remove();
  if (!examples.length) return;

  let index = 0;

  const widget = document.createElement("div");
  widget.id = "ik-container";
  widget.style.cssText = "margin:8px 0;font-family:inherit;";

  const content = document.createElement("div");
  content.style.cssText = `width:${settings.imageWidth}px;text-align:center;`;

  function renderContent() {
    content.innerHTML = "";
    const ex = examples[index];
    const imageUrl = getImageUrl(ex);
    const soundUrl = getSoundUrl(ex);

    if (imageUrl) {
      const img = document.createElement("img");
      img.src = imageUrl;
      img.style.cssText = `width:${settings.imageWidth}px;max-width:100%;`;
      img.onerror = () => (img.style.display = "none");
      img.addEventListener("click", () => playAudio(soundUrl));
      content.appendChild(img);
    }

    // bottom meta bar: speaker · counter · gear
    const metaBar = document.createElement("div");
    metaBar.style.cssText =
      "display:flex;align-items:center;justify-content:center;gap:6px;margin-top:4px;";

    if (soundUrl) {
      const speaker = document.createElement("button");
      speaker.className = "ik-speaker";
      speaker.textContent = "🔊";
      speaker.addEventListener("click", () => playAudio(soundUrl));
      metaBar.appendChild(speaker);
    }

    const counter = document.createElement("span");
    counter.textContent = `${index + 1} / ${examples.length}`;
    counter.style.cssText =
      "font-size:72%;color:var(--subsection-label-color,#666);";
    metaBar.appendChild(counter);

    const settingsBtn = document.createElement("button");
    settingsBtn.className = "ik-gear";
    settingsBtn.textContent = "⚙";
    settingsBtn.addEventListener("click", openSettingsMenu);
    metaBar.appendChild(settingsBtn);

    content.appendChild(metaBar);

    if (ex.sentence) {
      const sent = document.createElement("div");
      sent.textContent = ex.sentence;
      sent.style.cssText =
        "margin-top:6px;font-size:110%;color:var(--text-color,#ddd);line-height:1.4;";
      content.appendChild(sent);
    }

    if (settings.showTranslation && ex.translation) {
      const trans = document.createElement("div");
      trans.textContent = ex.translation;
      trans.style.cssText =
        "margin-top:3px;font-size:82%;color:var(--subsection-label-color,#888);";
      content.appendChild(trans);
    }

    leftBtn.disabled = index === 0;
    rightBtn.disabled = index === examples.length - 1;

    if (settings.autoplay) playAudio(soundUrl);
  }

  const leftBtn = document.createElement("button");
  leftBtn.className = "ik-arrow";
  leftBtn.textContent = "←";
  leftBtn.addEventListener("click", () => {
    if (index > 0) {
      stopAudio();
      index--;
      renderContent();
    }
  });

  const rightBtn = document.createElement("button");
  rightBtn.className = "ik-arrow";
  rightBtn.textContent = "→";
  rightBtn.addEventListener("click", () => {
    if (index < examples.length - 1) {
      stopAudio();
      index++;
      renderContent();
    }
  });

  // arrows sit beside the content, vertically centered
  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:8px;";
  row.append(leftBtn, content, rightBtn);
  widget.appendChild(row);

  renderContent();

  const meanings = document.querySelector(".subsection-meanings");
  const vboxGap = document.querySelector(".vbox.gap");

  if (meanings && vboxGap) {
    document.getElementById("ik-dynamic")?.remove();

    const sideWrapper = document.createElement("div");
    sideWrapper.style.cssText = "display:flex;align-items:flex-start;gap:24px;";

    const leftCol = document.createElement("div");
    leftCol.style.flex = "1";
    leftCol.appendChild(meanings);

    const pitchAccent = document.querySelector(".subsection-pitch-accent");
    const composedOf = document.querySelector(".subsection-composed-of-kanji");
    if (composedOf) leftCol.appendChild(composedOf);
    if (pitchAccent) leftCol.appendChild(pitchAccent);

    sideWrapper.appendChild(leftCol); // meanings LEFT
    sideWrapper.appendChild(widget); // widget RIGHT

    const dynDiv = document.createElement("div");
    dynDiv.id = "ik-dynamic";
    dynDiv.appendChild(sideWrapper);

    const insertAfter = window.location.href.includes("/vocabulary/")
      ? vboxGap.children[1]
      : vboxGap.firstChild;

    vboxGap.insertBefore(dynDiv, insertAfter || vboxGap.firstChild);
    return;
  }

  const anchor =
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
  document.getElementById("ik-container")?.remove();
  document.getElementById("ik-dynamic")?.remove();

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

    const sorted = sortByPriority(examples);
    console.log(
      "[IK] Priority examples:",
      sorted.filter((e) => PRIORITY_DECKS.includes(e.title)).length,
    );

    injectWidget(sorted);
  } catch (err) {
    console.error("[IK] Error during parallel data loading:", err);
  }
}

loadSettings();
main();
