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
  let activeHighlightOverlay = null;

  /**
   * Maps a numeric confidence (0-100) to a tier string used by
   * CSS attribute selectors to apply the correct color scheme.
   *   "low"    → green  (< 50, not AI)
   *   "medium" → yellow (50-79, possibly AI)
   *   "high"   → red    (>= 80, likely AI)
   */
  function confidenceLevel(confidence) {
    if (confidence >= 80) return "high";
    if (confidence >= 50) return "medium";
    return "low";
  }

  function confidenceLabel(confidence) {
    if (confidence >= 80) return "Likely AI";
    if (confidence >= 50) return "Possibly AI";
    return "Not AI";
  }

  /**
   * Longer subtitle for the selection hover overlay (matches popup tiers).
   */
  function confidenceSubtitle(confidence) {
    if (confidence >= 80) return "Likely AI-generated";
    if (confidence >= 50) return "Possibly AI-generated";
    return "Not AI-generated";
  }

  /**
   * Returns eligible text nodes for text highlighting.
   * Skips text inside existing highlights and extension UI.
   */
  function collectTextNodes() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest(".aidet-highlight, [data-aidet-ignore]")) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }

  /**
   * Finds and wraps all occurrences of span.text in the DOM.
   * First tries exact single-node matches. If none are found,
   * falls back to normalized whitespace matching across the
   * concatenated text of the page body.
   */
  function findAndWrapAll(span) {
    const needle = span.text;
    if (!needle) return;

    let found = false;
    const textNodes = collectTextNodes();

    for (const textNode of textNodes) {
      const haystack = textNode.nodeValue;
      if (!haystack || haystack.indexOf(needle) === -1) continue;

      const indices = [];
      let from = 0;
      while (from < haystack.length) {
        const idx = haystack.indexOf(needle, from);
        if (idx === -1) break;
        indices.push(idx);
        from = idx + needle.length;
      }

      for (let i = indices.length - 1; i >= 0; i--) {
        wrapTextNode(
          textNode,
          indices[i],
          needle,
          span.confidence,
          span.reason,
        );
        found = true;
      }
    }

    if (found) return;

    // Fallback: normalize whitespace and try matching a trimmed
    // version against each text node. Selections that cross element
    // boundaries produce text with newlines/extra spaces that don't
    // exist in individual text nodes.
    const trimmed = needle.replace(/\s+/g, " ").trim();
    if (!trimmed || trimmed === needle) return;

    const refreshed = collectTextNodes();
    for (const textNode of refreshed) {
      const haystack = textNode.nodeValue;
      if (!haystack) continue;
      const idx = haystack.indexOf(trimmed);
      if (idx !== -1) {
        wrapTextNode(textNode, idx, trimmed, span.confidence, span.reason);
        return;
      }
    }

    // Last resort: try to find the longest leading substring of the
    // selection that exists in a text node (handles cross-element selections).
    for (const textNode of refreshed) {
      const haystack = textNode.nodeValue;
      if (!haystack) continue;

      const words = trimmed.split(" ");
      for (let len = words.length; len >= 3; len--) {
        const partial = words.slice(0, len).join(" ");
        const idx = haystack.indexOf(partial);
        if (idx !== -1) {
          wrapTextNode(textNode, idx, partial, span.confidence, span.reason);
          return;
        }
      }
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
    before.splitText(text.length);

    const mark = document.createElement("mark");
    mark.className = "aidet-highlight";
    mark.setAttribute("data-confidence", confidence);
    mark.setAttribute("data-confidence-level", level);
    mark.setAttribute("data-reason", reason || "");
    mark.setAttribute(PROCESSED_ATTR, "true");
    mark.textContent = before.nodeValue;

    before.parentNode.replaceChild(mark, before);
  }

  function removeHighlightOverlay() {
    if (!activeHighlightOverlay) return;
    window.removeEventListener(
      "scroll",
      activeHighlightOverlay._repositionHandler,
    );
    window.removeEventListener(
      "resize",
      activeHighlightOverlay._repositionHandler,
    );
    activeHighlightOverlay.remove();
    activeHighlightOverlay = null;
  }

  function showHighlightOverlay(mark) {
    if (!mark || !document.body.contains(mark)) return;

    removeHighlightOverlay();

    const overlay = document.createElement("div");
    overlay.className = "aidet-highlight-overlay";
    overlay.setAttribute(
      "data-confidence-level",
      mark.getAttribute("data-confidence-level") || "low",
    );
    const confidence = parseInt(
      mark.getAttribute("data-confidence") || "0",
      10,
    );
    overlay.textContent = confidence + "% " + confidenceLabel(confidence);
    document.body.appendChild(overlay);

    function positionOverlay() {
      if (!document.body.contains(mark)) {
        removeHighlightOverlay();
        return;
      }

      const rect = mark.getBoundingClientRect();
      overlay.style.top = window.scrollY + rect.top + "px";
      overlay.style.left = window.scrollX + rect.left + "px";
      overlay.style.width = rect.width + "px";
      overlay.style.height = rect.height + "px";
    }

    positionOverlay();
    overlay._repositionHandler = () => positionOverlay();
    window.addEventListener("scroll", overlay._repositionHandler, {
      passive: true,
    });
    window.addEventListener("resize", overlay._repositionHandler, {
      passive: true,
    });
    activeHighlightOverlay = overlay;
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
    if (activeTextLoader) {
      activeTextLoader.remove();
      activeTextLoader = null;
    }
    if (!msg.spans || !msg.spans.length) return;

    clearTextHighlights();

    const span = msg.spans[0];
    const savedRange = pendingSelectionRange;
    pendingSelectionRange = null;

    if (savedRange) {
      createTextPill(savedRange, span.text, span.confidence, span.reason);
    } else {
      document.body.normalize();
      msg.spans.forEach((s) => findAndWrapAll(s));
    }

    saveResult(msg);
  }

  /**
   * Merges adjacent client rects from a Range so inline links, list markers,
   * and formatted runs produce one box per line instead of many fragmented slivers.
   */
  function mergeSelectionRects(rawRects) {
    const items = [];
    for (let i = 0; i < rawRects.length; i++) {
      const r = rawRects[i];
      if (r.width < 2 || r.height < 2) continue;
      items.push({
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        h: r.height,
      });
    }
    if (!items.length) return [];

    items.sort((a, b) => a.top - b.top || a.left - b.left);

    const yTol = Math.max(3, Math.min(items[0].h * 0.35, 12));
    const xGap = 12;
    const merged = [];

    for (const r of items) {
      const last = merged[merged.length - 1];
      const verticalOverlap =
        last &&
        !(r.bottom < last.top - yTol || r.top > last.bottom + yTol);
      if (last && verticalOverlap && r.left <= last.right + xGap) {
        last.right = Math.max(last.right, r.right);
        last.top = Math.min(last.top, r.top);
        last.bottom = Math.max(last.bottom, r.bottom);
      } else {
        merged.push({
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
        });
      }
    }

    return merged.map((m) => ({
      left: m.left,
      top: m.top,
      width: m.right - m.left,
      height: m.bottom - m.top,
    }));
  }

  /**
   * Positions highlight rects, the union hit area, and the hover layer
   * from a saved Range (scroll/resize safe).
   */
  function layoutTextPill(group) {
    const liveRange = group._syncRange;
    if (!liveRange) return;

    let rects;
    try {
      rects = liveRange.getClientRects();
    } catch {
      return;
    }
    if (!rects.length) return;

    const list = mergeSelectionRects(rects);
    if (!list.length) return;

    let minL = Infinity;
    let minT = Infinity;
    let maxR = -Infinity;
    let maxB = -Infinity;
    for (const r of list) {
      minL = Math.min(minL, r.left);
      minT = Math.min(minT, r.top);
      maxR = Math.max(maxR, r.right);
      maxB = Math.max(maxB, r.bottom);
    }

    const sy = window.scrollY;
    const sx = window.scrollX;

    let bgs = group.querySelectorAll(".aidet-text-pill-bg");
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      let bg = bgs[i];
      if (!bg) {
        bg = document.createElement("div");
        bg.className = "aidet-text-pill-bg";
        bg.setAttribute(
          "data-confidence-level",
          group.getAttribute("data-confidence-level") || "low",
        );
        group.insertBefore(bg, group.querySelector(".aidet-text-pill-hover"));
      }
      bg.style.top = sy + r.top + "px";
      bg.style.left = sx + r.left + "px";
      bg.style.width = r.width + "px";
      bg.style.height = r.height + "px";
    }
    bgs = group.querySelectorAll(".aidet-text-pill-bg");
    for (let j = list.length; j < bgs.length; j++) {
      bgs[j].remove();
    }

    const hover = group.querySelector(".aidet-text-pill-hover");
    if (hover) {
      hover.style.top = sy + minT + "px";
      hover.style.left = sx + minL + "px";
      hover.style.width = maxR - minL + "px";
      hover.style.height = maxB - minT + "px";
    }

    const chip = group.querySelector(".aidet-text-pill-chip");
    if (chip) {
      const chipW = 56;
      chip.style.width = chipW + "px";
      chip.style.top = sy + maxB + 4 + "px";
      chip.style.left = sx + Math.max(minL, maxR - chipW) + "px";
    }
  }

  /**
   * Full-color highlight over the selection (one tint per line).
   * On hover: frosted blur over the whole selection with % + subtitle.
   */
  function createTextPill(range, text, confidence, reason) {
    const level = confidenceLevel(confidence);
    let rects;
    try {
      rects = range.getClientRects();
    } catch {
      return;
    }
    if (!rects.length) return;

    const group = document.createElement("div");
    group.className = "aidet-text-pill-group";
    group.setAttribute("data-confidence", confidence);
    group.setAttribute("data-confidence-level", level);
    group.setAttribute("data-reason", reason || "");
    group.setAttribute("data-text", text || "");
    try {
      group._syncRange = range.cloneRange();
    } catch {
      group._syncRange = null;
    }

    const hover = document.createElement("div");
    hover.className = "aidet-text-pill-hover";
    hover.setAttribute("data-confidence-level", level);
    hover.innerHTML =
      '<span class="aidet-text-hover-pct"></span>' +
      '<span class="aidet-text-hover-sub"></span>';
    hover.querySelector(".aidet-text-hover-pct").textContent = confidence + "%";
    hover.querySelector(".aidet-text-hover-sub").textContent =
      confidenceSubtitle(confidence);
    group.appendChild(hover);

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "aidet-text-pill-chip";
    chip.setAttribute("data-confidence-level", level);
    chip.setAttribute(
      "title",
      confidence + "% — " + confidenceSubtitle(confidence),
    );
    chip.textContent = confidence + "%";
    group.appendChild(chip);

    document.body.appendChild(group);

    layoutTextPill(group);

    const reposition = () => layoutTextPill(group);
    group._repositionHandler = reposition;
    window.addEventListener("scroll", reposition, { passive: true });
    window.addEventListener("resize", reposition, { passive: true });

    chip.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const spanData = {
        type: "text",
        text: text || "",
        confidence,
        reason: reason || "",
      };
      chrome.storage.local.set({ "aidet-active-span": spanData }, () => {
        chrome.runtime.sendMessage({ type: "open-popup" });
      });
    });
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
      pill.style.top = window.scrollY + rect.top + 8 + "px";
      pill.style.left =
        window.scrollX + rect.right - pill.offsetWidth - 8 + "px";
    }

    positionPill();
    pill._repositionHandler = () => positionPill();
    window.addEventListener("scroll", pill._repositionHandler, {
      passive: true,
    });
    window.addEventListener("resize", pill._repositionHandler, {
      passive: true,
    });
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
    document
      .querySelectorAll(".aidet-image-pill.aidet-loading")
      .forEach((p) => {
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
      pill.style.top = window.scrollY + rect.top + 8 + "px";
      pill.style.left =
        window.scrollX + rect.right - pill.offsetWidth - 8 + "px";
    }

    positionPill();
    pill._repositionHandler = () => positionPill();
    window.addEventListener("scroll", pill._repositionHandler, {
      passive: true,
    });
    window.addEventListener("resize", pill._repositionHandler, {
      passive: true,
    });

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
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
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
      if (
        urlPathname(el.src) === needle ||
        urlPathname(el.currentSrc) === needle
      )
        return el;
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
  /**
   * Removes only text highlights, restoring original text nodes.
   * Does not touch image/video pills.
   */
  function clearTextHighlights() {
    removeHighlightOverlay();
    document.querySelectorAll(".aidet-highlight").forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      const text = document.createTextNode(mark.textContent);
      parent.replaceChild(text, mark);
      parent.normalize();
    });
    document.querySelectorAll(".aidet-text-pill-group").forEach((g) => {
      if (g._repositionHandler) {
        window.removeEventListener("scroll", g._repositionHandler);
        window.removeEventListener("resize", g._repositionHandler);
      }
      g.remove();
    });
  }

  function clearAllHighlights() {
    clearTextHighlights();

    document.querySelectorAll(".aidet-image-pill").forEach((pill) => {
      window.removeEventListener("scroll", pill._repositionHandler);
      window.removeEventListener("resize", pill._repositionHandler);
      pill.remove();
    });

    document.querySelectorAll(".aidet-video-overlay").forEach((overlay) => {
      window.removeEventListener("scroll", overlay._repositionHandler);
      window.removeEventListener("resize", overlay._repositionHandler);
      if (overlay._badge) overlay._badge.remove();
      overlay.remove();
    });

    document.querySelectorAll(".aidet-video-badge").forEach((b) => b.remove());

    document.querySelectorAll("[data-aidet-analyzed]").forEach((img) => {
      img.removeAttribute("data-aidet-analyzed");
    });
  }

  document.addEventListener("click", (e) => {
    const highlight = e.target.closest(".aidet-highlight");
    const textPill = e.target.closest(".aidet-text-pill-group");
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
    } else if (textPill) {
      return;
    } else if (imagePill) {
      const mediaType = imagePill.getAttribute("data-media-type") || "image";
      const pillData = {
        type: mediaType,
        srcUrl: imagePill.getAttribute("data-src-url"),
        score: parseInt(imagePill.getAttribute("data-confidence"), 10),
        reason: imagePill.getAttribute("data-reason") || "",
      };
      chrome.storage.local.set({ "aidet-active-span": pillData }, () => {
        chrome.runtime.sendMessage({ type: "open-popup" });
      });
    } else {
      clearAllHighlights();
    }
  });

  let activeTextLoader = null;
  let pendingSelectionRange = null;

  /**
   * Captures the current text selection, shows a loading pill
   * over the selection, and sends the text to the background
   * script for Gemini analysis via the backend API. Saves the
   * Range so handleTextResult can highlight across inline elements.
   */
  function analyzeSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    const text = sel.toString();
    if (!text.trim()) return;

    pendingSelectionRange = sel.getRangeAt(0).cloneRange();
    const rect = pendingSelectionRange.getBoundingClientRect();

    sel.removeAllRanges();

    if (activeTextLoader) activeTextLoader.remove();

    const loader = document.createElement("div");
    loader.className = "aidet-loading-pill";
    loader.style.top = window.scrollY + rect.top + "px";
    loader.style.left = window.scrollX + rect.left + "px";
    loader.style.width = rect.width + "px";
    loader.style.height = rect.height + "px";
    loader.style.borderRadius = Math.min(rect.height / 2, 14) + "px";
    document.body.appendChild(loader);
    activeTextLoader = loader;

    chrome.runtime.sendMessage({
      type: "analyze-text",
      text,
    });
  }

  /**
   * Track the last right-clicked element so we can find images
   * even when invisible overlays prevent Chrome from detecting them.
   */
  let lastContextTarget = null;
  document.addEventListener("contextmenu", (e) => {
    lastContextTarget = e.target;
  });

  /**
   * Finds the nearest <img> to the right-clicked element by checking
   * the element itself, its descendants, its parent, and siblings.
   * Handles sites like Instagram that put div overlays on top of images.
   */
  function findNearestImage(el) {
    if (!el) return null;

    if (el.tagName === "IMG") return el;

    let img = el.querySelector("img");
    if (img) return img;

    let parent = el.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      img = parent.querySelector("img");
      if (img) return img;
      parent = parent.parentElement;
    }

    return null;
  }

  /**
   * Handles "find-image" requests from background.js.
   * Uses the last right-click target to locate a nearby <img>,
   * then sends its src back to background for analysis.
   */
  function handleFindImage() {
    const img = findNearestImage(lastContextTarget);
    if (!img) return;

    const src = img.currentSrc || img.src;
    if (!src) return;

    chrome.runtime.sendMessage({
      type: "found-image",
      srcUrl: src,
    });
  }

  /* ── Video analysis ── */

  const videoOverlays = {};

  /**
   * Finds a <video> element near the right-click target,
   * same DOM traversal strategy as findNearestImage.
   */
  function findNearestVideo(el) {
    if (!el) return null;
    if (el.tagName === "VIDEO") return el;

    let vid = el.querySelector("video");
    if (vid) return vid;

    let parent = el.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      vid = parent.querySelector("video");
      if (vid) return vid;
      parent = parent.parentElement;
    }
    return null;
  }

  /**
   * Handles "find-video" — locates a video near the right-click
   * target. For blob: URLs (Instagram, Twitter, etc.) captures the
   * current frame via canvas and sends it as a data URL. For real
   * HTTP URLs, sends the URL to the backend to download & analyze.
   */
  function handleFindVideo() {
    const video = findNearestVideo(lastContextTarget);
    if (!video) return;
    const src = video.currentSrc || video.src;
    if (!src) return;

    if (src.startsWith("blob:")) {
      captureFrameAndSend(video, src);
    } else {
      chrome.runtime.sendMessage({ type: "found-video", videoUrl: src });
    }
  }

  /**
   * Captures the current visible frame of a <video> via canvas,
   * converts to a JPEG data URL, and sends it to background as
   * a single-frame image analysis. Used for blob: URLs that the
   * backend can't download.
   */
  function captureFrameAndSend(video, videoUrl) {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 360;
    const ctx = canvas.getContext("2d");

    let dataUrl = null;
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    } catch (_) {
      // tainted canvas
    }

    if (!dataUrl) return;

    showVideoLoadingOverlay(video, videoUrl);

    chrome.runtime.sendMessage({
      type: "analyze-video-frame",
      frameDataUrl: dataUrl,
      videoUrl,
    });
  }

  /**
   * Creates the border overlay + loading badge on a video element.
   * Shared by handleVideoLoading (backend flow) and
   * captureFrameAndSend (blob: URL flow).
   */
  function showVideoLoadingOverlay(video, videoUrl) {
    const overlay = document.createElement("div");
    overlay.className = "aidet-video-overlay aidet-loading";
    overlay.setAttribute("data-src-url", videoUrl);
    document.body.appendChild(overlay);

    const badge = document.createElement("div");
    badge.className = "aidet-video-badge aidet-loading";
    badge.innerHTML =
      '<span class="aidet-video-badge-icon">&#9654;</span> Analyzing\u2026';
    document.body.appendChild(badge);

    function positionOverlay() {
      const rect = video.getBoundingClientRect();
      overlay.style.top = window.scrollY + rect.top + "px";
      overlay.style.left = window.scrollX + rect.left + "px";
      overlay.style.width = rect.width + "px";
      overlay.style.height = rect.height + "px";

      badge.style.top = window.scrollY + rect.top + 8 + "px";
      badge.style.left = window.scrollX + rect.right + 8 + "px";
    }
    positionOverlay();
    const reposition = () => positionOverlay();
    window.addEventListener("scroll", reposition, { passive: true });
    window.addEventListener("resize", reposition, { passive: true });

    overlay._repositionHandler = reposition;
    overlay._badge = badge;
    overlay._video = video;
    badge._repositionHandler = reposition;

    videoOverlays[videoUrl] = overlay;
  }

  /**
   * Handles "video-loading" — finds the video element and
   * creates the loading overlay.
   */
  function handleVideoLoading(msg) {
    const videoUrl = msg.videoUrl;
    if (!videoUrl) return;

    let video = document.querySelector(
      'video[src="' + CSS.escape(videoUrl) + '"]',
    );
    if (!video) video = document.querySelector("video");
    if (!video) return;

    showVideoLoadingOverlay(video, videoUrl);
  }

  /**
   * Handles "video-result" — replaces the loading state with the
   * final colored border + score badge once the backend returns.
   */
  function handleVideoResult(msg) {
    const videoUrl = msg.videoUrl;
    const overlay = videoOverlays[videoUrl];

    // If no loading overlay was created (e.g. direct context menu on <video>
    // where we have the srcUrl), find the video and build the overlay now.
    let video, badge, reposition;
    if (overlay) {
      video = overlay._video;
      badge = overlay._badge;
      reposition = overlay._repositionHandler;
    } else {
      video =
        document.querySelector('video[src="' + CSS.escape(videoUrl) + '"]') ||
        document.querySelector("video");
      if (!video) return;
    }

    const score = msg.score ?? 0;
    const reason = msg.reason || "";
    const level = confidenceLevel(score);

    if (overlay) {
      overlay.classList.remove("aidet-loading");
      overlay.setAttribute("data-confidence-level", level);
    } else {
      const ov = document.createElement("div");
      ov.className = "aidet-video-overlay";
      ov.setAttribute("data-src-url", videoUrl);
      ov.setAttribute("data-confidence-level", level);
      document.body.appendChild(ov);

      badge = document.createElement("div");
      badge.className = "aidet-video-badge";
      document.body.appendChild(badge);

      function positionOverlay() {
        const rect = video.getBoundingClientRect();
        ov.style.top = window.scrollY + rect.top + "px";
        ov.style.left = window.scrollX + rect.left + "px";
        ov.style.width = rect.width + "px";
        ov.style.height = rect.height + "px";
        badge.style.top = window.scrollY + rect.top + 8 + "px";
        badge.style.left = window.scrollX + rect.right + 8 + "px";
      }
      positionOverlay();
      reposition = () => positionOverlay();
      window.addEventListener("scroll", reposition, { passive: true });
      window.addEventListener("resize", reposition, { passive: true });
      ov._repositionHandler = reposition;
      ov._badge = badge;
      ov._video = video;
      badge._repositionHandler = reposition;
      videoOverlays[videoUrl] = ov;
    }

    badge.classList.remove("aidet-loading");
    badge.setAttribute("data-confidence-level", level);
    badge.setAttribute("data-media-type", "video");
    badge.setAttribute("data-src-url", videoUrl);
    badge.setAttribute("data-confidence", score);
    badge.setAttribute("data-reason", reason);
    badge.innerHTML =
      '<span class="aidet-video-badge-icon">&#9654;</span> ' +
      '<span class="aidet-video-badge-score">' +
      score +
      "%</span>" +
      '<span class="aidet-video-badge-label">' +
      confidenceLabel(score) +
      "</span>";

    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      const pillData = {
        type: "video",
        srcUrl: videoUrl,
        score,
        reason,
      };
      chrome.storage.local.set({ "aidet-active-span": pillData }, () => {
        chrome.runtime.sendMessage({ type: "open-popup" });
      });
    });

    saveResult({
      type: "video-result",
      srcUrl: videoUrl,
      score,
      reason,
      overallScore: score,
    });

    delete videoOverlays[videoUrl];
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
    } else if (msg.type === "find-image") {
      handleFindImage();
    } else if (msg.type === "find-video") {
      handleFindVideo();
    } else if (msg.type === "video-loading") {
      handleVideoLoading(msg);
    } else if (msg.type === "video-result") {
      handleVideoResult(msg);
    }
  });
})();
