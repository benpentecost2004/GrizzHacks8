/**
 * content.js — Verity AI Content Detector (content script)
 *
 * Injected into every page. Listens for analysis results from
 * background.js and highlights matched text spans directly in the
 * page DOM using TreeWalker. Highlights are color-coded by
 * confidence level (green / yellow / red) and show a % overlay
 * on hover. Clicking anywhere outside a highlight dismisses them.
 *
 * Data contract (received via chrome.runtime.onMessage):
 *   { type: "text-result",
 *     spans: [{ text, confidence: 0-100, reason }],
 *     overallScore: 0-100,
 *     fullReason: "..." }
 */
(function () {
  "use strict";

  const PROCESSED_ATTR = "data-aidet-processed";

  /**
   * Maps a numeric confidence (0-100) to a tier string used by
   * CSS attribute selectors to apply the correct color scheme.
   *   "low"    → green  (< 20, likely human)
   *   "medium" → yellow (20-69, uncertain)
   *   "high"   → red    (>= 70, likely AI)
   */
  function confidenceLevel(confidence) {
    if (confidence >= 70) return "high";
    if (confidence >= 20) return "medium";
    return "low";
  }

  /**
   * Walks all text nodes in document.body via TreeWalker and returns
   * the first one containing `needle`. Skips text inside existing
   * highlights (.aidet-highlight) and any element marked with
   * [data-aidet-ignore] (e.g. our own UI elements).
   *
   * Returns { node, idx } or null if no match is found.
   */
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

  /**
   * Finds and wraps ALL occurrences of span.text in the page DOM.
   * Re-walks the DOM after each wrap to avoid stale node references
   * (wrapping splits text nodes, invalidating earlier pointers).
   */
  function findAndWrapAll(span) {
    const needle = span.text;
    if (!needle) return;

    let match;
    while ((match = findNextMatch(needle))) {
      wrapTextNode(match.node, match.idx, needle, span.confidence, span.reason);
    }
  }

  /**
   * Wraps a substring of a text node in a <mark> element.
   * Splits the text node into [before | match | after] using
   * splitText(), then replaces the match portion with a styled
   * <mark class="aidet-highlight"> carrying data attributes for
   * confidence, confidence level, and the AI-generated reason.
   */
  function wrapTextNode(textNode, startIdx, text, confidence, reason) {
    const level = confidenceLevel(confidence);

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

  /**
   * Processes a "text-result" message from background.js.
   * Iterates over each span in the results and highlights all
   * matching occurrences on the page.
   */
  function handleTextResult(msg) {
    if (!msg.spans || !msg.spans.length) return;
    msg.spans.forEach((span) => findAndWrapAll(span));
  }

  /**
   * Removes all highlights from the page, restoring the original
   * text. Replaces each <mark> with a plain text node and calls
   * normalize() to merge adjacent text nodes back together.
   */
  function clearAllHighlights() {
    document.querySelectorAll(".aidet-highlight").forEach((mark) => {
      const parent = mark.parentNode;
      const text = document.createTextNode(mark.textContent);
      parent.replaceChild(text, mark);
      parent.normalize();
    });
  }

  // Dismiss highlights when clicking anywhere outside them
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".aidet-highlight")) {
      clearAllHighlights();
    }
  });

  // Route incoming messages from background.js to the appropriate handler
  chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
    if (msg.type === "text-result") {
      handleTextResult(msg);
    }
  });
})();
