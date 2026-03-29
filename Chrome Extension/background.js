/**
 * background.js — Verity AI Content Detector (service worker)
 *
 * Registers right-click context menu actions for selected text and
 * images. Text analysis still uses local test flow, while image
 * analysis sends the selected image URL to the local Python backend
 * and returns Gemini confidence + reasoning to the content script.
 */

const IMAGE_API_URL = "http://127.0.0.1:8000/analyze-image";
const VIDEO_API_URL = "http://127.0.0.1:8000/analyze-video";
const IMAGE_API_TIMEOUT_MS = 15000;
const VIDEO_API_TIMEOUT_MS = 60000;

function toShortText(value, maxLen = 500) {
  const text = String(value ?? "").trim();
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

function formatImageErrorMessage(details) {
  const lines = ["Image analysis failed."];

  if (details.kind === "timeout") {
    lines.push("Request timed out while waiting for backend response.");
  } else if (details.kind === "network") {
    lines.push("Network request failed before receiving an HTTP response.");
  } else if (details.kind === "http") {
    lines.push("Backend returned HTTP " + details.status + ".");
  }

  if (details.message) {
    lines.push("Details: " + details.message);
  }

  lines.push(
    "Checks: backend running on 127.0.0.1:8000, extension reloaded, host_permissions allow localhost.",
  );
  return lines.join(" ");
}

async function analyzeImageWithBackend(srcUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_API_TIMEOUT_MS);
  const requestStartedAt = Date.now();

  console.log("[Verity] Starting image analysis request", {
    endpoint: IMAGE_API_URL,
    srcUrl,
    timeoutMs: IMAGE_API_TIMEOUT_MS,
  });

  let response;
  try {
    response = await fetch(IMAGE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl: srcUrl }),
      signal: controller.signal,
    });
  } catch (error) {
    const elapsedMs = Date.now() - requestStartedAt;
    const isTimeout = error?.name === "AbortError";
    const kind = isTimeout ? "timeout" : "network";
    const message = isTimeout
      ? "Backend request timed out after " + IMAGE_API_TIMEOUT_MS + "ms."
      : toShortText(error?.message || error);

    console.error("[Verity] Image analysis request failed", {
      kind,
      endpoint: IMAGE_API_URL,
      srcUrl,
      elapsedMs,
      message,
      rawError: error,
    });

    throw {
      kind,
      message,
      elapsedMs,
    };
  } finally {
    clearTimeout(timeoutId);
  }

  const elapsedMs = Date.now() - requestStartedAt;

  console.log("[Verity] Image analysis backend responded", {
    endpoint: IMAGE_API_URL,
    srcUrl,
    status: response.status,
    ok: response.ok,
    elapsedMs,
  });

  if (!response.ok) {
    const errorBody = toShortText(await response.text());
    const message = errorBody || "Backend request failed.";
    console.error("[Verity] Backend returned non-OK status", {
      endpoint: IMAGE_API_URL,
      srcUrl,
      status: response.status,
      statusText: response.statusText,
      errorBody,
    });

    throw {
      kind: "http",
      status: response.status,
      message,
      elapsedMs,
    };
  }

  try {
    return await response.json();
  } catch (error) {
    const message =
      "Backend returned invalid JSON: " + toShortText(error?.message || error);
    console.error("[Verity] Failed to parse backend JSON", {
      endpoint: IMAGE_API_URL,
      srcUrl,
      message,
      rawError: error,
    });

    throw {
      kind: "parse",
      message,
      elapsedMs,
    };
  }
}

// Register the context menu item on extension install/update
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: "verity-analyze-text",
    title: "Analyze text with Verity",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: "verity-analyze-image",
    title: "Analyze image with Verity",
    contexts: ["image"],
  });
  chrome.contextMenus.create({
    id: "verity-find-image",
    title: "Analyze nearby image with Verity",
    contexts: ["page", "frame", "link"],
  });
  chrome.contextMenus.create({
    id: "verity-analyze-video",
    title: "Analyze video with Verity",
    contexts: ["video"],
  });
  chrome.contextMenus.create({
    id: "verity-find-video",
    title: "Analyze nearby video with Verity",
    contexts: ["page", "frame", "link"],
  });
});

/**
 * Handle messages from content script:
 * - "open-popup": open the badge popup
 * - "found-image": content script found an image near the right-click
 * - "found-video": content script found a video near the right-click
 */
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "open-popup") {
    chrome.action.openPopup().catch(() => {});
  } else if (msg.type === "found-image" && sender.tab?.id) {
    analyzeImage(sender.tab.id, msg.srcUrl);
  } else if (msg.type === "found-video" && sender.tab?.id) {
    analyzeVideo(sender.tab.id, msg.videoUrl);
  } else if (msg.type === "analyze-video-frame" && sender.tab?.id) {
    analyzeVideoFrame(sender.tab.id, msg);
  }
});

/**
 * When the context menu item is clicked, send a trigger to the
 * content script to capture the selection and run analysis.
 * Silently injects the content script if it isn't loaded yet
 * (e.g. tabs open before the extension was installed/reloaded).
 */
async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "ping" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["Chrome Extension/content.js"],
    });
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["Chrome Extension/styles/content.css"],
    });
  }
}

/**
 * Runs the image analysis pipeline for a given tab and image URL.
 * Shows loading state, calls backend, then sends result or error.
 */
async function analyzeImage(tabId, srcUrl) {
  console.log("[Verity] Starting image analysis", { tabId, srcUrl });

  await ensureContentScript(tabId);
  await chrome.tabs.sendMessage(tabId, {
    type: "image-loading",
    srcUrl,
  });

  try {
    const backendResult = await analyzeImageWithBackend(srcUrl);
    const score = backendResult.confidence ?? 0;
    await chrome.tabs.sendMessage(tabId, {
      type: "image-result",
      srcUrl,
      score,
      reason: backendResult.reasoning || "No reason returned by backend.",
    });
  } catch (error) {
    const details = {
      kind: error?.kind || "unknown",
      status: error?.status,
      message: toShortText(error?.message || error),
    };

    console.error("[Verity] Image analysis pipeline failed", {
      tabId, srcUrl, details, rawError: error,
    });

    await chrome.tabs.sendMessage(tabId, {
      type: "image-result",
      srcUrl,
      score: 0,
      reason: formatImageErrorMessage(details),
    });
  }
}

/**
 * Sends a video URL to the backend /analyze-video endpoint.
 * The backend downloads the video, extracts frames with OpenCV,
 * runs each through Gemini, and returns aggregated results.
 */
async function analyzeVideoWithBackend(videoUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VIDEO_API_TIMEOUT_MS);

  try {
    const response = await fetch(VIDEO_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoUrl }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const body = toShortText(await response.text());
      throw { kind: "http", status: response.status, message: body };
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeout);
    if (error?.kind) throw error;
    throw { kind: "network", message: String(error?.message || error) };
  }
}

/**
 * Full video analysis pipeline: tells the content script to show
 * a loading state, calls the backend, then sends the result back.
 */
async function analyzeVideo(tabId, videoUrl) {
  console.log("[Verity] Starting video analysis", { tabId, videoUrl });

  if (!videoUrl || videoUrl.startsWith("blob:")) {
    await ensureContentScript(tabId);
    await chrome.tabs.sendMessage(tabId, { type: "find-video" });
    return;
  }

  await ensureContentScript(tabId);
  await chrome.tabs.sendMessage(tabId, {
    type: "video-loading",
    videoUrl,
  });

  try {
    const result = await analyzeVideoWithBackend(videoUrl);
    const score = _normalizeConfidence(result.confidence);

    await chrome.tabs.sendMessage(tabId, {
      type: "video-result",
      videoUrl,
      score,
      label: result.label || "",
      reason: result.reasoning || "",
    });
  } catch (error) {
    console.error("[Verity] Video analysis failed", { tabId, videoUrl, error });
    await chrome.tabs.sendMessage(tabId, {
      type: "video-result",
      videoUrl,
      score: 0,
      reason: formatVideoErrorMessage(error),
    });
  }
}

function _normalizeConfidence(value) {
  let c = parseFloat(value) || 0;
  if (c <= 1) c *= 100;
  return Math.max(0, Math.min(100, Math.round(c)));
}

function formatVideoErrorMessage(err) {
  if (err?.kind === "network") {
    return "Video analysis failed. Network error: " + (err.message || "unknown") +
      ". Check: backend running on 127.0.0.1:8000, extension reloaded.";
  }
  if (err?.kind === "http") {
    return "Video analysis failed (HTTP " + err.status + "): " + (err.message || "");
  }
  return "Video analysis failed: " + String(err?.message || err);
}

/**
 * Handles blob: URL videos — the content script captured the current
 * frame and sent it as a data URL. We analyze it as an image and
 * return the result as a video-result so the overlay updates.
 */
async function analyzeVideoFrame(tabId, msg) {
  const { frameDataUrl, videoUrl } = msg;
  try {
    const result = await analyzeImageWithBackend(frameDataUrl);
    const score = _normalizeConfidence(result.confidence);
    await chrome.tabs.sendMessage(tabId, {
      type: "video-result",
      videoUrl,
      score,
      label: result.label || "",
      reason: result.reasoning || "",
    });
  } catch (error) {
    console.error("[Verity] Video frame analysis failed", { tabId, videoUrl, error });
    await chrome.tabs.sendMessage(tabId, {
      type: "video-result",
      videoUrl,
      score: 0,
      reason: formatVideoErrorMessage(error),
    });
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === "verity-analyze-text") {
    await ensureContentScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: "analyze-selection" });
  } else if (info.menuItemId === "verity-analyze-image") {
    await analyzeImage(tab.id, info.srcUrl);
  } else if (info.menuItemId === "verity-find-image") {
    await ensureContentScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: "find-image" });
  } else if (info.menuItemId === "verity-analyze-video") {
    if (info.srcUrl && info.srcUrl.startsWith("blob:")) {
      await ensureContentScript(tab.id);
      await chrome.tabs.sendMessage(tab.id, { type: "find-video" });
    } else {
      await analyzeVideo(tab.id, info.srcUrl);
    }
  } else if (info.menuItemId === "verity-find-video") {
    await ensureContentScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: "find-video" });
  }
});
