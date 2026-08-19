const APP_URL = "https://xdr-hub.netlify.app/booking";
const POLL_INTERVAL_MS = 2000;

const views = {
  loading: document.getElementById("view-loading"),
  notNooks: document.getElementById("view-not-nooks"),
  noToken: document.getElementById("view-no-token"),
  inCall: document.getElementById("view-in-call"),
  ready: document.getElementById("view-ready"),
  sending: document.getElementById("view-sending"),
  done: document.getElementById("view-done"),
  error: document.getElementById("view-error"),
};

function showView(name) {
  for (const key of Object.keys(views)) {
    views[key].style.display = key === name ? "block" : "none";
  }
}

let currentTabId = null;
let currentCallId = null;
let currentTranscript = null;
let currentTruncated = false;
let pollTimer = null;
// Which action to re-run when the rep clicks Retry -- a scrape failure
// (during refresh()) needs a fresh refresh(), not a re-send of a transcript
// that was never successfully captured in the first place.
let retryAction = refresh;

async function getApiToken() {
  const { apiToken } = await chrome.storage.local.get(["apiToken"]);
  return apiToken || "";
}

// Same retry-once-after-injecting pattern as apps/li-agent/extension/panel.js's
// scrapeTab(): the content script may not be loaded yet on a freshly-opened
// tab, so a first failed message is treated as "not injected" and retried
// once after chrome.scripting.executeScript.
async function sendToContentScript(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      return await chrome.tabs.sendMessage(tabId, message);
    } catch {
      return null;
    }
  }
}

async function refresh() {
  const token = await getApiToken();
  if (!token) {
    showView("noToken");
    return;
  }

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    return;
  }
  if (!tab) return;
  currentTabId = tab.id;

  const state = await sendToContentScript(tab.id, { type: "SCRAPE_CALL_STATE" });
  if (!state || !state.onCallPage) {
    showView("notNooks");
    return;
  }

  if (!state.callEnded) {
    showView("inCall");
    return;
  }

  currentCallId = state.callId;
  if (!currentCallId) {
    showError("Couldn't find a call ID on this page. Try refreshing the Nooks tab.", refresh);
    return;
  }

  const transcriptResult = await sendToContentScript(tab.id, { type: "SCRAPE_TRANSCRIPT" });
  if (!transcriptResult || !transcriptResult.text) {
    showError("Couldn't read the transcript from this page.", refresh);
    return;
  }

  currentTranscript = transcriptResult.text;
  currentTruncated = !!transcriptResult.truncated;

  document.getElementById("truncated-warning").style.display = currentTruncated ? "block" : "none";
  document.getElementById("transcript-preview").textContent = currentTranscript.slice(0, 500) + (currentTranscript.length > 500 ? "…" : "");
  document.getElementById("char-count").textContent = `${currentTranscript.length} characters captured`;
  showView("ready");
}

function showError(message, onRetry = handleSend) {
  document.getElementById("error-message").textContent = message;
  retryAction = onRetry;
  showView("error");
}

async function handleSend() {
  if (!currentCallId || !currentTranscript) return;
  showView("sending");

  chrome.runtime.sendMessage(
    {
      type: "CAPTURE_TRANSCRIPT",
      data: { nooksCallId: currentCallId, transcript: currentTranscript, truncated: currentTruncated },
    },
    (response) => {
      if (!response || !response.ok) {
        showError(response?.error || "Something went wrong sending the transcript.");
        return;
      }
      document.getElementById("done-message").textContent = response.selfHealed
        ? "Notes generated — matching to your Nooks record now."
        : "Notes generated and ready to review.";
      document.getElementById("open-meeting-link").href = `${APP_URL}/meetings`;
      showView("done");
    },
  );
}

document.getElementById("send-btn").addEventListener("click", handleSend);
document.getElementById("retry-btn").addEventListener("click", () => retryAction());
document.getElementById("open-options-btn").addEventListener("click", () => chrome.runtime.openOptionsPage());

showView("loading");
refresh();
pollTimer = setInterval(() => {
  // Don't yank the rep out of the sending/done/error/ready states with a
  // background re-poll -- only refresh while we're waiting to see if a call
  // just ended, or after Send completes and the tab moves on.
  const activeView = Object.keys(views).find((k) => views[k].style.display === "block");
  if (activeView === "notNooks" || activeView === "inCall" || activeView === "loading") {
    refresh();
  }
}, POLL_INTERVAL_MS);
