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

  function findNextMatch(needle) {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest(".aidet-highlight, [data-aidet-ignore]")) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      const idx = node.nodeValue.indexOf(needle);
      if (idx !== -1) return { node, idx };
    }
    return null;
  }

  function findAndWrapAll(span) {
    const needle = span.text;
    if (!needle) return;

    let match;
    while ((match = findNextMatch(needle))) {
      wrapTextNode(match.node, match.idx, needle, span.confidence, span.reason);
    }
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
  }

  /* ── Handle incoming text results ── */

  function handleTextResult(msg) {
    if (!msg.spans || !msg.spans.length) return;
    msg.spans.forEach((span) => findAndWrapAll(span));
  }

  /* ── Clear highlights on click outside ── */

  function clearAllHighlights() {
    document.querySelectorAll(".aidet-highlight").forEach((mark) => {
      const parent = mark.parentNode;
      const text = document.createTextNode(mark.textContent);
      parent.replaceChild(text, mark);
      parent.normalize();
    });
  }

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".aidet-highlight")) {
      clearAllHighlights();
    }
  });

  /* ── Message listener ── */

  chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
    if (msg.type === "text-result") {
      handleTextResult(msg);
    }
  });
})();
