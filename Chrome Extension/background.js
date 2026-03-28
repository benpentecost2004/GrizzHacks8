/**
 * background.js — Verity AI Content Detector (service worker)
 *
 * TEMPORARY testing stub. Creates a right-click context menu item
 * "Analyze with Verity" that appears when text is selected. On click,
 * it splits the selected text into random chunks with random confidence
 * scores and sends a "text-result" message to the content script.
 *
 * In production, this file will be owned by the backend team and will
 * call the Gemini API instead of generating random values.
 */

// Register the context menu item on extension install/update
chrome.contextMenus.create({
  id: "verity-analyze",
  title: "Analyze with Verity",
  contexts: ["selection"],
});

/**
 * Handles the context menu click. Grabs the selected text,
 * generates fake analysis spans, and sends them to the content
 * script on the active tab for on-page highlighting.
 */
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "verity-analyze" || !info.selectionText) return;

  const text = info.selectionText;
  const spans = generateTestSpans(text);

  chrome.tabs.sendMessage(tab.id, {
    type: "text-result",
    spans,
    overallScore: Math.round(spans.reduce((s, x) => s + x.confidence, 0) / spans.length),
    fullReason: "Test analysis of selected text.",
  });
});

/**
 * Splits text into random chunks of 2-6 words, each assigned a
 * random confidence score 0-100. Returns an array matching the
 * span format expected by content.js:
 *   [{ text: "chunk of words", confidence: 0-100, reason: "..." }]
 */
function generateTestSpans(text) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const spans = [];
  let i = 0;

  while (i < words.length) {
    const chunkSize = Math.min(
      Math.floor(Math.random() * 5) + 2,
      words.length - i
    );
    const chunk = words.slice(i, i + chunkSize).join(" ");
    const confidence = Math.floor(Math.random() * 100);

    spans.push({
      text: chunk,
      confidence,
      reason: "Test — " + confidence + "% confidence this chunk is AI-generated.",
    });

    i += chunkSize;
  }

  return spans;
}
