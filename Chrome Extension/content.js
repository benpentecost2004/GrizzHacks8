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
   * Saves a scan result to chrome.storage.local under "aidet-history".
   * Each entry includes timestamp, page URL, and the full message data.
   * Capped at 50 entries (oldest dropped).
   */
  function saveResult(msg) {
    const entry = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      timestamp: Date.now(),
      url: location.href,
      title: document.title,
      type: msg.type,
      spans: msg.spans,
      overallScore: msg.overallScore ?? msg.score,
      fullReason: msg.fullReason,
      srcUrl: msg.srcUrl,
      score: msg.score,
      reason: msg.reason,
    };

    chrome.storage.local.get({ "aidet-history": [] }, (data) => {
      const history = data["aidet-history"];
      history.unshift(entry);
      if (history.length > 50) history.length = 50;
      chrome.storage.local.set({ "aidet-history": history });
    });
  }

  /**
   * Processes a "text-result" message from background.js.
   * Iterates over each span in the results and highlights all
   * matching occurrences on the page, then persists the result.
   */
  function handleTextResult(msg) {
    if (!msg.spans || !msg.spans.length) return;
    msg.spans.forEach((span) => findAndWrapAll(span));
    saveResult(msg);
  }

  /**
   * Shows a loading pill over an image while analysis is in progress.
   * The pill gets replaced when the real image-result arrives.
   */
  function handleImageLoading(msg) {
    if (!msg.srcUrl) return;

    const img = findImageBySrc(msg.srcUrl);
    if (!img) return;

    const pill = document.createElement("div");
    pill.className = "aidet-image-pill aidet-loading";
    pill.setAttribute("data-src-url", msg.srcUrl);
    pill.textContent = "\u00A0";
    document.body.appendChild(pill);

    function positionPill() {
      const rect = img.getBoundingClientRect();
      pill.style.top = (window.scrollY + rect.top + 8) + "px";
      pill.style.left = (window.scrollX + rect.right - pill.offsetWidth - 8) + "px";
    }

    positionPill();
    pill._repositionHandler = () => positionPill();
    window.addEventListener("scroll", pill._repositionHandler, { passive: true });
    window.addEventListener("resize", pill._repositionHandler, { passive: true });
  }

  /**
   * Handles an "image-result" message. Finds the <img> on the page
   * matching srcUrl and overlays a floating % pill on top of it.
   * Does NOT modify the image's DOM tree — the pill is appended to
   * document.body and positioned via getBoundingClientRect, so it
   * works on sites with complex DOM structures (e.g. Twitter).
   */
  function handleImageResult(msg) {
    if (!msg.srcUrl) return;

    // Remove loading pill for this image if present
    document.querySelectorAll('.aidet-image-pill.aidet-loading').forEach((p) => {
      if (p.getAttribute("data-src-url") === msg.srcUrl) {
        window.removeEventListener("scroll", p._repositionHandler);
        window.removeEventListener("resize", p._repositionHandler);
        p.remove();
      }
    });

    const img = findImageBySrc(msg.srcUrl);
    if (!img) return;

    const level = confidenceLevel(msg.score);
    const score = msg.score;
    const reason = msg.reason || "";

    const pill = document.createElement("div");
    pill.className = "aidet-image-pill";
    pill.setAttribute("data-confidence-level", level);
    pill.setAttribute("data-src-url", msg.srcUrl);
    pill.setAttribute("data-confidence", score);
    pill.setAttribute("data-reason", reason);
    pill.textContent = score + "%";
    document.body.appendChild(pill);

    function positionPill() {
      const rect = img.getBoundingClientRect();
      pill.style.top = (window.scrollY + rect.top + 8) + "px";
      pill.style.left = (window.scrollX + rect.right - pill.offsetWidth - 8) + "px";
    }

    positionPill();
    pill._repositionHandler = () => positionPill();
    window.addEventListener("scroll", pill._repositionHandler, { passive: true });
    window.addEventListener("resize", pill._repositionHandler, { passive: true });

    img.setAttribute("data-aidet-analyzed", "true");

    saveResult({
      type: "image-result",
      srcUrl: msg.srcUrl,
      score,
      reason,
      overallScore: score,
    });
  }

  /**
   * Extracts the pathname from a URL, stripping query params and
   * hash so CDN URLs with rotating tokens can still match.
   */
  function urlPathname(url) {
    try { return new URL(url).pathname; }
    catch { return url; }
  }

  /**
   * Finds an <img> element by src URL. Matching strategy:
   *   1. Exact src attribute match via CSS selector
   *   2. Exact src or currentSrc property match
   *   3. Fuzzy: compare URL pathnames (ignoring query params)
   *      — handles Instagram/CDN URLs with rotating tokens
   *   4. srcset scan: check if the URL pathname appears in srcset
   */
  function findImageBySrc(srcUrl) {
    const needle = urlPathname(srcUrl);
    const allImgs = document.querySelectorAll("img");

    // Pass 1: exact match
    for (const el of allImgs) {
      if (el.hasAttribute("data-aidet-analyzed")) continue;
      if (el.src === srcUrl || el.currentSrc === srcUrl) return el;
    }

    // Pass 2: pathname match (ignores query params)
    for (const el of allImgs) {
      if (el.hasAttribute("data-aidet-analyzed")) continue;
      if (urlPathname(el.src) === needle || urlPathname(el.currentSrc) === needle) return el;
    }

    // Pass 3: check srcset entries
    for (const el of allImgs) {
      if (el.hasAttribute("data-aidet-analyzed")) continue;
      const srcset = el.getAttribute("srcset") || "";
      const entries = srcset.split(",").map((s) => s.trim().split(/\s+/)[0]);
      for (const entry of entries) {
        if (entry === srcUrl || urlPathname(entry) === needle) return el;
      }
    }

    return null;
  }

  /**
   * Removes all highlights from the page, restoring the original
   * text. Replaces each <mark> with a plain text node and calls
   * normalize() to merge adjacent text nodes back together.
   * Also removes any image analysis pill overlays.
   */
  function clearAllHighlights() {
    document.querySelectorAll(".aidet-highlight").forEach((mark) => {
      const parent = mark.parentNode;
      const text = document.createTextNode(mark.textContent);
      parent.replaceChild(text, mark);
      parent.normalize();
    });

    document.querySelectorAll(".aidet-image-pill").forEach((pill) => {
      window.removeEventListener("scroll", pill._repositionHandler);
      window.removeEventListener("resize", pill._repositionHandler);
      pill.remove();
    });

    document.querySelectorAll("[data-aidet-analyzed]").forEach((img) => {
      img.removeAttribute("data-aidet-analyzed");
    });
  }

  /**
   * When a highlight or image wrap is clicked, store which item was
   * clicked and ask the background to open the badge popup.
   * Clicking anywhere else dismisses all highlights.
   */
  document.addEventListener("click", (e) => {
    const highlight = e.target.closest(".aidet-highlight");
    const imagePill = e.target.closest(".aidet-image-pill");

    if (highlight) {
      const spanData = {
        type: "text",
        text: highlight.textContent,
        confidence: parseInt(highlight.getAttribute("data-confidence"), 10),
        reason: highlight.getAttribute("data-reason") || "",
      };
      chrome.storage.local.set({ "aidet-active-span": spanData }, () => {
        chrome.runtime.sendMessage({ type: "open-popup" });
      });
    } else if (imagePill) {
      const imgData = {
        type: "image",
        srcUrl: imagePill.getAttribute("data-src-url"),
        score: parseInt(imagePill.getAttribute("data-confidence"), 10),
        reason: imagePill.getAttribute("data-reason") || "",
      };
      chrome.storage.local.set({ "aidet-active-span": imgData }, () => {
        chrome.runtime.sendMessage({ type: "open-popup" });
      });
    } else {
      clearAllHighlights();
    }
  });

  /**
   * Captures the current text selection from the DOM and splits it
   * into random chunks with random confidence scores for testing.
   * Uses the exact substring positions from the selection so the
   * text matches the DOM precisely (no whitespace normalization).
   */
  function analyzeSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    const text = sel.toString();
    if (!text.trim()) return;

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    sel.removeAllRanges();

    const loader = document.createElement("div");
    loader.className = "aidet-loading-pill";
    loader.style.top = (window.scrollY + rect.top) + "px";
    loader.style.left = (window.scrollX + rect.left) + "px";
    loader.style.width = rect.width + "px";
    loader.style.height = rect.height + "px";
    loader.style.borderRadius = Math.min(rect.height / 2, 14) + "px";
    document.body.appendChild(loader);

    setTimeout(() => {
      loader.remove();

      const spans = generateTestSpans(text);
      if (!spans.length) return;

      const avg = Math.round(spans.reduce((s, x) => s + x.confidence, 0) / spans.length);

      handleTextResult({
        type: "text-result",
        spans,
        overallScore: avg,
        fullReason: "Test analysis of selected text.",
      });
    }, 1500);
  }

  /**
   * Splits text into random chunks of 2-6 words using exact
   * substrings from the original text (preserving whitespace).
   */
  function generateTestSpans(text) {
    const wordPattern = /\S+/g;
    const words = [];
    let m;
    while ((m = wordPattern.exec(text))) {
      words.push({ word: m[0], start: m.index, end: m.index + m[0].length });
    }
    if (words.length === 0) return [];

    const spans = [];
    let i = 0;

    while (i < words.length) {
      const chunkSize = Math.min(
        Math.floor(Math.random() * 5) + 2,
        words.length - i
      );
      const start = words[i].start;
      const end = words[i + chunkSize - 1].end;
      const chunk = text.substring(start, end);
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

  // Route incoming messages from background.js to the appropriate handler
  chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
    if (msg.type === "text-result") {
      handleTextResult(msg);
    } else if (msg.type === "image-loading") {
      handleImageLoading(msg);
    } else if (msg.type === "image-result") {
      handleImageResult(msg);
    } else if (msg.type === "analyze-selection") {
      analyzeSelection();
    }
  });
})();
