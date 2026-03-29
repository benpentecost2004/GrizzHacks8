/**
 * background.js — Verity AI Content Detector (service worker)
 *
 * TEMPORARY testing stub. Creates a right-click context menu item
 * "Analyze with Verity" that appears when text is selected. On click,
 * it tells the content script to capture the selection and run a
 * test analysis with random confidence scores.
 *
 * In production, this file will be owned by the backend team and will
 * call the Gemini API instead of generating random values.
 */

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
        files: ["content.js"],
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["styles/content.css"],
      });
    }
  }

  if (info.menuItemId === "verity-analyze-text") {
    await ensureContentScript();
    await chrome.tabs.sendMessage(tab.id, { type: "analyze-selection" });
  } else if (info.menuItemId === "verity-analyze-image") {
    await ensureContentScript();
    await chrome.tabs.sendMessage(tab.id, {
      type: "image-loading",
      srcUrl: info.srcUrl,
    });

    setTimeout(async () => {
      const score = Math.floor(Math.random() * 100);
      await chrome.tabs.sendMessage(tab.id, {
        type: "image-result",
        srcUrl: info.srcUrl,
        score,
        reason: "Test — " + score + "% confidence this image is AI-generated.",
      });
    }, 1500);
  }
});
