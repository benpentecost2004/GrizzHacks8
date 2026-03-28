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
    id: "verity-analyze",
    title: "Analyze with Verity",
    contexts: ["selection"],
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
  if (info.menuItemId !== "verity-analyze" || !tab?.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "analyze-selection" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["styles/content.css"],
    });
    await chrome.tabs.sendMessage(tab.id, { type: "analyze-selection" });
  }
});
