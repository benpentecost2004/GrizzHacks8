/**
 * background.js — Verity AI Content Detector (service worker)
 *
 * Registers right-click context menu actions for selected text and
 * images. Text analysis still uses local test flow, while image
 * analysis sends the selected image URL to the local Python backend
 * and returns Gemini confidence + reasoning to the content script.
 */

const IMAGE_API_URL = "http://127.0.0.1:8000/analyze-image";
const IMAGE_API_TIMEOUT_MS = 15000;

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
});

/**
 * Open the badge popup when a highlight is clicked on the page.
 */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "open-popup") {
    chrome.action.openPopup().catch(() => {});
  }
});

/**
 * When the context menu item is clicked, send a trigger to the
 * content script to capture the selection and run analysis.
 * Silently injects the content script if it isn't loaded yet
 * (e.g. tabs open before the extension was installed/reloaded).
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  async function ensureContentScript() {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "ping" });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["Chrome Extension/content.js"],
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["Chrome Extension/styles/content.css"],
      });
    }
  }

  if (info.menuItemId === "verity-analyze-text") {
    await ensureContentScript();
    await chrome.tabs.sendMessage(tab.id, { type: "analyze-selection" });
  } else if (info.menuItemId === "verity-analyze-image") {
    console.log("[Verity] Context menu clicked: image", {
      tabId: tab.id,
      srcUrl: info.srcUrl,
    });

    await ensureContentScript();
    await chrome.tabs.sendMessage(tab.id, {
      type: "image-loading",
      srcUrl: info.srcUrl,
    });

    try {
      const backendResult = await analyzeImageWithBackend(info.srcUrl);
      const score = backendResult.confidence ?? 0;
      await chrome.tabs.sendMessage(tab.id, {
        type: "image-result",
        srcUrl: info.srcUrl,
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
        tabId: tab.id,
        srcUrl: info.srcUrl,
        details,
        rawError: error,
      });

      await chrome.tabs.sendMessage(tab.id, {
        type: "image-result",
        srcUrl: info.srcUrl,
        score: 0,
        reason: formatImageErrorMessage(details),
      });
    }
  }
});
