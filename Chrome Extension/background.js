chrome.contextMenus.create({
  id: "verity-analyze",
  title: "Analyze with Verity",
  contexts: ["selection"],
});

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
