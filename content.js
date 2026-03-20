function parseVocab() {
  const currentPageUrl = window.location.href;
  console.log("[IK] Scanning page:", currentPageUrl);

  if (currentPageUrl.includes("/vocabulary/")) {
    const vocabUrlPattern = /\/vocabulary\/\d+\/([^#/?]*)/;
    const urlMatchResult = currentPageUrl.match(vocabUrlPattern);

    if (urlMatchResult) {
      const encodedWordFromUrl = urlMatchResult[1];
      const cleanJapaneseWord = decodeURIComponent(encodedWordFromUrl);

      console.log(
        "[IK] Vocabulary page match:",
        encodedWordFromUrl,
        "->",
        cleanJapaneseWord,
      );
      return cleanJapaneseWord;
    }
  }

  if (currentPageUrl.includes("/kanji/")) {
    const kanjiUrlPattern = /\/kanji\/\d+\/([^#/?]*)/;
    const urlMatchResult = currentPageUrl.match(kanjiUrlPattern);

    if (urlMatchResult) {
      const rawKanjiString = urlMatchResult[1];
      const cleanKanji = decodeURIComponent(rawKanjiString).split("/")[0];

      console.log("[IK] Kanji page match:", rawKanjiString, "->", cleanKanji);
      return cleanKanji;
    }
  }

  if (currentPageUrl.includes("/review") || currentPageUrl.includes("c=")) {
    console.log("[IK] Review/Exercise session detected. Searching DOM...");

    const mainWordElement = document.querySelector(".plain");
    if (mainWordElement) {
      const offlineElementClone = mainWordElement.cloneNode(true);
      const furiganaTags = offlineElementClone.querySelectorAll("rt, rp");

      console.log(
        "[IK] Found",
        furiganaTags.length,
        "furigana tags to remove.",
      );

      furiganaTags.forEach((tag) => tag.remove());
      const extractedText = offlineElementClone.textContent.trim();

      console.log("[IK] DOM Extraction Result:", extractedText);
      return extractedText;
    }

    const navigationLinks = document.querySelectorAll(
      'a[href*="/vocabulary/"], a[href*="/kanji/"]',
    );
    console.log(
      "[IK] No .plain element. Checking",
      navigationLinks.length,
      "links as fallback.",
    );

    for (const link of navigationLinks) {
      const linkHref = link.getAttribute("href");
      const linkPattern = /\/(vocabulary|kanji)\/\d+\/([^#?]*)/;
      const linkMatchResult = linkHref.match(linkPattern);

      if (linkMatchResult && linkMatchResult[2]) {
        const decodedWordFromLink = decodeURIComponent(linkMatchResult[2]);
        console.log("[IK] Word recovered from link:", decodedWordFromLink);
        return decodedWordFromLink;
      }
    }
  }

  console.warn("[IK] Scraper could not identify a Japanese word on this page.");
  return "";
}

const MEDIA_REPOSITORY_BASE =
  "https://us-southeast-1.linodeobjects.com/immersionkit/media";

let globalTitleMetadataMap = null;

async function loadTitleMetadataMap() {
  if (globalTitleMetadataMap) return globalTitleMetadataMap;

  try {
    const metadataResponse = await fetch(
      "https://apiv2.immersionkit.com/index_meta",
    );
    const metadataJson = await metadataResponse.json();

    const freshlyBuiltMap = {};
    for (const [slugKey, entryData] of Object.entries(metadataJson.data)) {
      freshlyBuiltMap[slugKey] = entryData.title || slugKey;
    }

    globalTitleMetadataMap = freshlyBuiltMap;
    console.log(
      "[IK] Metadata Map built. Example Entry:",
      Object.entries(globalTitleMetadataMap)[0],
    );
    return globalTitleMetadataMap;
  } catch (error) {
    console.error("[IK] Metadata fetch failed:", error);
    return {};
  }
}

async function fetchImmersionData(targetJapaneseWord) {
  const searchApiUrl = `https://apiv2.immersionkit.com/search?q=${encodeURIComponent(targetJapaneseWord)}&sort=sentence_length:asc&limit=50`;
  console.log("[IK] Fetching from API:", searchApiUrl);

  try {
    const apiResponse = await fetch(searchApiUrl);
    if (!apiResponse.ok) {
      throw new Error(
        `ImmersionKit API responded with status: ${apiResponse.status}`,
      );
    }

    const rootJsonResponse = await apiResponse.json();
    console.log("[IK] Raw API Response:", rootJsonResponse);

    const sentenceExamplesList = rootJsonResponse.data?.[0]?.examples || [];
    console.log("[IK] Extracted Examples Array:", sentenceExamplesList);

    return sentenceExamplesList;
  } catch (error) {
    console.error("[IK] Fetch failed:", error);
    return [];
  }
}
function getSoundUrl(exampleObject) {
  const shortSlug = exampleObject.title;
  const fullTitle = globalTitleMetadataMap[shortSlug] || shortSlug;
  const filename = exampleObject.sound;

  console.log("[IK] Debugging Audio Data:", {
    slug: shortSlug,
    mappedTitle: fullTitle,
    filename: filename,
    fullObject: exampleObject,
  });

  if (!filename) {
    console.warn("[IK] No sound file found in this example object.");
    return "";
  }

  const finalUrl = `${MEDIA_REPOSITORY_BASE}/anime/${encodeURIComponent(fullTitle)}/${encodeURIComponent(filename)}`;
  return finalUrl;
}

async function main() {
  const targetWord = parseVocab();

  if (!targetWord) {
    console.log("[IK] No word found, stopping execution.");
    return;
  }

  try {
    const [sentenceExamplesList, metadata] = await Promise.all([
      fetchImmersionData(targetWord),
      loadTitleMetadataMap(),
    ]);

    // check if null or empty instead
    if (
      !sentenceExamplesList ||
      sentenceExamplesList.length === 0 ||
      !sentenceExamplesList[0]
    ) {
      console.warn("[IK] No valid examples found for:", targetWord);
      return;
    }

    console.log(
      "[IK] Valid data received. Example count:",
      sentenceExamplesList.length,
    );
    const firstExample = sentenceExamplesList[0];

    const testImageUrl = getImageUrl(firstExample);
    const testSoundUrl = getSoundUrl(firstExample);
    console.log("[IK] Test Image URL:", testImageUrl);
  } catch (parallelError) {
    console.error("[IK] Error during parallel data loading:", parallelError);
  }
}

main();
