// Nooks Capture background service worker. Centralizes the one cross-origin
// call this extension makes, mirroring apps/li-agent/extension/background.js's
// pattern: token travels as a body field (no Authorization header), the
// backend action validates it via resolveOwner/requireRole.
const APP_URL = "https://xdr-hub.netlify.app/booking";

async function getSettings() {
  const result = await chrome.storage.local.get(["apiToken"]);
  return { appUrl: APP_URL, apiToken: result.apiToken || "" };
}

async function captureTranscript({ nooksCallId, transcript, truncated }) {
  const { appUrl, apiToken } = await getSettings();
  const res = await fetch(`${appUrl}/_agent-native/actions/capture-nooks-transcript`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nooksCallId,
      transcript,
      truncated,
      ...(apiToken ? { apiToken } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Send failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "CAPTURE_TRANSCRIPT") {
    captureTranscript(msg.data)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (chrome.sidePanel) {
    chrome.sidePanel.open({ tabId: tab.id });
  } else {
    chrome.tabs.create({ url: chrome.runtime.getURL("panel.html") });
  }
});
