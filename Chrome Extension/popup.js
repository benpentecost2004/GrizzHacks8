/**
 * popup.js — Verity AI Content Detector (badge popup)
 *
 * Reads scan history from chrome.storage.local and renders the
 * most recent result with overall score + expandable span cards.
 * Past scans are listed in a collapsible history section.
 */

const emptyEl     = document.getElementById("verity-empty");
const detailEl    = document.getElementById("verity-detail");
const scoreNum    = document.getElementById("score-num");
const scoreLabel  = document.getElementById("score-label");
const scoreUrl    = document.getElementById("score-url");
const cardsEl     = document.getElementById("verity-cards");
const historyWrap = document.getElementById("verity-history");
const historyList = document.getElementById("history-list");

/**
 * Returns the confidence tier for color-coding.
 */
function levelFor(c) {
  return c >= 70 ? "high" : c >= 20 ? "medium" : "low";
}

/**
 * Formats a timestamp into a short readable string.
 */
function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  return Math.floor(hrs / 24) + "d ago";
}

/**
 * Renders the detail view for a single scan result.
 * Handles both text results (span cards) and image results (thumbnail + score).
 */
function renderDetail(entry) {
  emptyEl.hidden = true;
  detailEl.hidden = false;

  const score = entry.overallScore ?? entry.score ?? 0;
  const level = levelFor(score);
  scoreNum.textContent = score;
  scoreNum.className = "verity-score-num " + level;

  const label = score >= 70
    ? "Likely AI-generated"
    : score >= 20
      ? "Possibly AI-generated"
      : "Likely human-written";
  scoreLabel.textContent = label;
  scoreUrl.textContent = entry.title || entry.url || "";

  cardsEl.innerHTML = "";

  if (entry.type === "image-result") {
    renderImageDetail(entry, level);
    return;
  }

  if (entry.type === "video-result") {
    renderVideoDetail(entry, level);
    return;
  }

  if (!entry.spans || !entry.spans.length) {
    cardsEl.innerHTML = '<div style="padding:8px;color:#6c7086;font-size:12px;">No spans</div>';
    return;
  }

  entry.spans.forEach((span) => {
    const card = document.createElement("div");
    card.className = "verity-card";

    const slevel = levelFor(span.confidence);
    const truncated = span.text.length > 60
      ? span.text.slice(0, 60) + "..."
      : span.text;

    card.innerHTML =
      '<div class="verity-card-top">' +
        '<span class="verity-card-conf ' + slevel + '">' + span.confidence + '%</span>' +
        '<span class="verity-card-text">' + escapeHtml(truncated) + '</span>' +
      '</div>' +
      '<div class="verity-card-reason">' + escapeHtml(span.reason || "") + '</div>';

    card.addEventListener("click", () => {
      card.classList.toggle("expanded");
    });

    cardsEl.appendChild(card);
  });
}

/**
 * Renders the detail view for an image analysis result:
 * thumbnail, large score, and reason text.
 */
function renderImageDetail(entry, level) {
  const card = document.createElement("div");
  card.className = "verity-image-card";

  const score = entry.overallScore ?? entry.score ?? 0;

  card.innerHTML =
    '<img class="verity-image-thumb" src="' + escapeHtml(entry.srcUrl || "") + '" alt="Analyzed image">' +
    '<div class="verity-image-info">' +
      '<span class="verity-card-conf ' + level + '" style="font-size:14px;padding:4px 10px;">' + score + '%</span>' +
      '<span style="font-size:12px;color:#a6adc8;margin-left:8px;">' +
        (score >= 70 ? "Likely AI-generated" : score >= 20 ? "Possibly AI-generated" : "Likely real") +
      '</span>' +
    '</div>' +
    '<div class="verity-image-reason">' + escapeHtml(entry.reason || entry.fullReason || "") + '</div>';

  cardsEl.appendChild(card);
}

/**
 * Renders the detail view for a video analysis result:
 * video thumbnail (via <video> element), aggregated score,
 * number of frames analyzed, and combined reasoning.
 */
function renderVideoDetail(entry, level) {
  const card = document.createElement("div");
  card.className = "verity-image-card verity-video-card";

  const score = entry.overallScore ?? entry.score ?? 0;
  const framesText = entry.framesAnalyzed
    ? entry.framesAnalyzed + " frames analyzed"
    : "";

  card.innerHTML =
    '<div class="verity-video-thumb-wrap">' +
      '<video class="verity-video-thumb" src="' + escapeHtml(entry.srcUrl || "") + '" muted preload="metadata"></video>' +
      '<div class="verity-video-icon">&#9654;</div>' +
    '</div>' +
    '<div class="verity-image-info">' +
      '<span class="verity-card-conf ' + level + '" style="font-size:14px;padding:4px 10px;">' + score + '%</span>' +
      '<span style="font-size:12px;color:#a6adc8;margin-left:8px;">' +
        (score >= 70 ? "Likely AI-generated" : score >= 20 ? "Possibly AI-generated" : "Likely real") +
      '</span>' +
    '</div>' +
    (framesText ? '<div style="font-size:11px;color:#6c7086;padding:0 12px;">' + framesText + '</div>' : '') +
    '<div class="verity-image-reason">' + escapeHtml(entry.reason || entry.fullReason || "") + '</div>';

  cardsEl.appendChild(card);
}

/**
 * Renders the history list from stored entries.
 */
function renderHistory(history) {
  historyList.innerHTML = "";

  if (!history.length) {
    historyWrap.hidden = true;
    return;
  }

  historyWrap.hidden = false;

  history.forEach((entry, idx) => {
    const li = document.createElement("li");
    li.className = "verity-history-item";
    const score = entry.overallScore ?? entry.score ?? 0;
    const level = levelFor(score);
    const isImage = entry.type === "image-result";
    const isVideo = entry.type === "video-result";
    const title = entry.title || new URL(entry.url || "about:blank").hostname;
    const prefix = isVideo ? "[VID] " : isImage ? "[IMG] " : "";

    li.innerHTML =
      '<span class="hi-score ' + level + '">' + score + '</span>' +
      '<span class="hi-title">' + prefix + escapeHtml(title) + '</span>' +
      '<span class="hi-time">' + timeAgo(entry.timestamp) + '</span>';

    li.addEventListener("click", () => renderDetail(entry));
    historyList.appendChild(li);
  });
}

/**
 * Escapes HTML special characters to prevent XSS in rendered text.
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Toggle history section open/closed
document.getElementById("history-toggle").addEventListener("click", () => {
  historyWrap.classList.toggle("open");
});

// Clear all history
document.getElementById("btn-clear").addEventListener("click", () => {
  chrome.storage.local.set({ "aidet-history": [] }, () => {
    emptyEl.hidden = false;
    detailEl.hidden = true;
    renderHistory([]);
  });
});

// Load and display on popup open
chrome.storage.local.get({ "aidet-history": [], "aidet-active-span": null }, (data) => {
  const history = data["aidet-history"];
  const activeSpan = data["aidet-active-span"];

  if (history.length === 0) {
    emptyEl.hidden = false;
    detailEl.hidden = true;
  } else {
    renderDetail(history[0]);
  }

  renderHistory(history);

  if (activeSpan) {
    chrome.storage.local.remove("aidet-active-span");

    if (activeSpan.type === "image" || activeSpan.type === "video") {
      const match = history.find((h) =>
        h.srcUrl === activeSpan.srcUrl && (h.type === "image-result" || h.type === "video-result")
      );
      if (match) renderDetail(match);
    } else {
      const cards = cardsEl.querySelectorAll(".verity-card");
      for (const card of cards) {
        const cardText = card.querySelector(".verity-card-text");
        if (cardText && activeSpan.text &&
            cardText.textContent.startsWith(activeSpan.text.slice(0, 30))) {
          card.classList.add("expanded");
          card.scrollIntoView({ behavior: "smooth", block: "center" });
          break;
        }
      }
    }
  }
});
