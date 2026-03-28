(function () {
  "use strict";

  const PROCESSED_ATTR = "data-aidet-processed";

  /* ── Confidence level helper ── */

  function confidenceLevel(confidence) {
    if (confidence >= 70) return "high";
    if (confidence >= 20) return "medium";
    return "low";
  }

  /* ── TreeWalker text-node search & wrap ── */

  function findAndWrapAll(span) {
    const needle = span.text;
    if (!needle) return;

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node.parentElement && node.parentElement.closest(".aidet-highlight")) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const matchedNodes = [];

    let node;
    while ((node = walker.nextNode())) {
      const idx = node.nodeValue.indexOf(needle);
      if (idx === -1) continue;
      matchedNodes.push({ node, idx });
    }

    matchedNodes.forEach(({ node, idx }) => {
      wrapTextNode(node, idx, needle, span.confidence, span.reason);
    });
  }

  function wrapTextNode(textNode, startIdx, text, confidence, reason) {
    const level = confidenceLevel(confidence);

    // Split: [before | match | after]
    const before = textNode.splitText(startIdx);
    const after = before.splitText(text.length);

    const mark = document.createElement("mark");
    mark.className = "aidet-highlight";
    mark.setAttribute("data-confidence", confidence);
    mark.setAttribute("data-confidence-level", level);
    mark.setAttribute("data-reason", reason || "");
    mark.setAttribute(PROCESSED_ATTR, "true");
    mark.textContent = before.nodeValue;

    before.parentNode.replaceChild(mark, before);

    const badge = document.createElement("span");
    badge.className = "aidet-badge";
    badge.setAttribute("data-confidence-level", level);
    badge.textContent = confidence + "%";

    mark.after(badge);
  }

  /* ── Handle incoming text results ── */

  function handleTextResult(msg) {
    if (!msg.spans || !msg.spans.length) return;
    msg.spans.forEach((span) => findAndWrapAll(span));
  }

  /* ── Message listener ── */

  chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
    if (msg.type === "text-result") {
      handleTextResult(msg);
    }
    // image-result and other types will be handled in future layers
  });
})();
