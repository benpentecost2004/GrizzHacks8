const spanText  = document.getElementById("span-text");
const confSlider = document.getElementById("conf");
const confVal   = document.getElementById("conf-val");
const queueEl   = document.getElementById("queue");
const btnSend   = document.getElementById("btn-send");

const spans = [];

confSlider.addEventListener("input", () => {
  confVal.textContent = confSlider.value;
});

function levelFor(c) {
  return c >= 70 ? "high" : c >= 20 ? "medium" : "low";
}

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

queueEl.addEventListener("click", (e) => {
  if (e.target.dataset.i != null) {
    spans.splice(parseInt(e.target.dataset.i, 10), 1);
    renderQueue();
  }
});

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
