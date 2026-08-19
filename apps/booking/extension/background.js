// Nooks Capture background service worker. Centralizes cross-origin calls,
// mirroring apps/li-agent/extension/background.js's pattern: token travels
// as a body field (no Authorization header), the backend action validates
// it via resolveOwner/requireRole.
const APP_URL = "https://xdr-hub.netlify.app/booking";

async function getSettings() {
  const result = await chrome.storage.local.get(["apiToken"]);
  return { appUrl: APP_URL, apiToken: result.apiToken || "" };
}

// The framework enforces each action's declared http.method strictly (a
// POST to a GET-declared action 405s) -- capture-nooks-transcript is a real
// mutation (POST), but list-account-executives/get-ae-availability are
// declared readOnly GET, so they need query-string args instead of a body.
async function callActionPost(name, args) {
  const { appUrl, apiToken } = await getSettings();
  const res = await fetch(`${appUrl}/_agent-native/actions/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...args, ...(apiToken ? { apiToken } : {}) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${name} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function callActionGet(name, args) {
  const { appUrl, apiToken } = await getSettings();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, value);
  }
  if (apiToken) params.set("apiToken", apiToken);
  const res = await fetch(`${appUrl}/_agent-native/actions/${name}?${params}`, { method: "GET" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${name} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function captureTranscript({ nooksCallId, transcript, disposition, truncated, aeEmail, meetingDatetime }) {
  return callActionPost("capture-nooks-transcript", {
    nooksCallId,
    transcript,
    disposition,
    truncated,
    aeEmail: aeEmail || undefined,
    meetingDatetime: meetingDatetime || undefined,
  });
}

async function listAccountExecutives() {
  return callActionGet("list-account-executives", {});
}

async function getAeAvailability({ aeEmail, date, timezone }) {
  return callActionGet("get-ae-availability", { aeEmail, date, timezone });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "CAPTURE_TRANSCRIPT") {
    captureTranscript(msg.data)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }

  if (msg.type === "LIST_ACCOUNT_EXECUTIVES") {
    listAccountExecutives()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "GET_AE_AVAILABILITY") {
    getAeAvailability(msg.data)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (chrome.sidePanel) {
    chrome.sidePanel.open({ tabId: tab.id });
  } else {
    chrome.tabs.create({ url: chrome.runtime.getURL("panel.html") });
  }
});
