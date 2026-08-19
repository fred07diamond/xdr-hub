// Nooks Capture background service worker. Centralizes cross-origin calls,
// mirroring apps/li-agent/extension/background.js's pattern: token travels
// as a body field (no Authorization header), the backend action validates
// it via resolveOwner/requireRole.
const APP_URL = "https://xdr-hub.netlify.app/booking";

async function getSettings() {
  const result = await chrome.storage.local.get(["apiToken"]);
  return { appUrl: APP_URL, apiToken: result.apiToken || "" };
}

async function callAction(name, args) {
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

async function captureTranscript({ nooksCallId, transcript, disposition, truncated, aeEmail, meetingDatetime }) {
  return callAction("capture-nooks-transcript", {
    nooksCallId,
    transcript,
    disposition,
    truncated,
    aeEmail: aeEmail || undefined,
    meetingDatetime: meetingDatetime || undefined,
  });
}

async function listAccountExecutives() {
  return callAction("list-account-executives", {});
}

async function getAeAvailability({ aeEmail, date, timezone }) {
  return callAction("get-ae-availability", { aeEmail, date, timezone });
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
