/**
 * test-popup.js — Verity AI Content Detector (extension popup)
 *
 * Controls the test popup that opens when clicking the extension
 * badge icon. Lets you manually queue up text spans with custom
 * confidence values and send them to the content script for
 * on-page highlighting. This is a dev/test tool — not end-user UI.
 */

const spanText   = document.getElementById("span-text");
const confSlider = document.getElementById("conf");
const confVal    = document.getElementById("conf-val");
const queueEl    = document.getElementById("queue");
const btnSend    = document.getElementById("btn-send");

const spans = [];

// Keep the displayed confidence value in sync with the slider
confSlider.addEventListener("input", () => {
  confVal.textContent = confSlider.value;
});

/**
 * Maps a confidence score to a CSS class for color-coding
 * the queued span items in the popup UI.
 */
function levelFor(c) {
  return c >= 70 ? "high" : c >= 20 ? "medium" : "low";
}

/**
 * Re-renders the visual queue of pending spans. Each item shows
 * the text, color-coded confidence %, and a remove button.
 * Disables the send button when the queue is empty.
 */
function renderQueue() {
  queueEl.innerHTML = "";
  spans.forEach((s, i) => {
    const div = document.createElement("div");
    div.className = "qi";
    div.innerHTML =
      '<span class="qt">"' + s.text.replace(/</g, "&lt;") + '"</span>' +
      '<span class="qc ' + levelFor(s.confidence) + '">' + s.confidence + "%</span>" +
      '<button data-i="' + i + '">&times;</button>';
    queueEl.appendChild(div);
  });
  btnSend.disabled = spans.length === 0;
}

// Add a new span to the queue from the input fields
document.getElementById("btn-add").addEventListener("click", () => {
  const text = spanText.value.trim();
  if (!text) return;
  spans.push({
    text,
    confidence: parseInt(confSlider.value, 10),
    reason: "Test — " + confSlider.value + "% confidence that this text is AI-generated.",
  });
  spanText.value = "";
  renderQueue();
});

// Remove a span from the queue when its × button is clicked
queueEl.addEventListener("click", (e) => {
  if (e.target.dataset.i != null) {
    spans.splice(parseInt(e.target.dataset.i, 10), 1);
    renderQueue();
  }
});

/**
 * Sends all queued spans to the content script on the active tab
 * as a "text-result" message (same format background.js will use
 * in production). Clears the queue after sending.
 */
btnSend.addEventListener("click", () => {
  if (!spans.length) return;
  const avg = Math.round(spans.reduce((s, x) => s + x.confidence, 0) / spans.length);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, {
      type: "text-result",
      spans: spans.slice(),
      overallScore: avg,
      fullReason: "Test scan.",
    });
    spans.length = 0;
    renderQueue();
  });
});
