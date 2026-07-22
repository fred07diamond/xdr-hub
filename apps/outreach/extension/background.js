// Service worker — all cross-origin fetch calls live here to avoid CORS.
// The panel sends messages here; we call the outreach app and reply.

const APP_URL = "https://builder-li.netlify.app/outreach";
const POLL_INITIAL_MS = 3000;  // first poll after 3s
const POLL_MAX_MS = 15000;     // cap each interval at 15s
const POLL_TIMEOUT_MS = 60000; // give up after 60s

async function getSettings() {
  const result = await chrome.storage.local.get(["apiToken"]);
  return {
    appUrl: APP_URL,
    apiToken: result.apiToken || "",
  };
}

async function captureThenPoll(profileData) {
  const { appUrl, apiToken } = await getSettings();
  if (!appUrl) throw new Error("App URL not set. Open Options and paste your outreach app URL.");

  // POST to capture-profile — returns status "drafted" directly with the note
  const captureRes = await fetch(
    `${appUrl}/_agent-native/actions/capture-profile`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...profileData, ...(apiToken ? { apiToken } : {}) }),
    },
  );
  if (!captureRes.ok) {
    const text = await captureRes.text();
    throw new Error(`capture-profile failed (${captureRes.status}): ${text}`);
  }

  const result = await captureRes.json();

  // If draft is already in the response (inline drafting), return immediately
  if (result.status === "drafted" && result.draftNote !== undefined) {
    return result;
  }

  // Fallback: poll get-draft if status is still "captured" (agent-async path)
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  const profileUrl = profileData.profileUrl;
  const tokenParam = apiToken ? `&apiToken=${encodeURIComponent(apiToken)}` : "";

  let pollInterval = POLL_INITIAL_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollInterval));
    pollInterval = Math.min(pollInterval * 2, POLL_MAX_MS);

    const draftRes = await fetch(
      `${appUrl}/_agent-native/actions/get-draft?profileUrl=${encodeURIComponent(profileUrl)}${tokenParam}`,
    );
    if (!draftRes.ok) continue;

    const draft = await draftRes.json();
    if (draft.status === "drafted") return draft;
  }

  throw new Error("Timed out waiting for the draft.");
}

async function checkAlreadyContacted(profileUrl) {
  const { appUrl, apiToken } = await getSettings();
  if (!appUrl) return { contacted: false };
  try {
    const tokenParam = apiToken ? `&apiToken=${encodeURIComponent(apiToken)}` : "";
    const res = await fetch(
      `${appUrl}/_agent-native/actions/check-already-contacted?profileUrl=${encodeURIComponent(profileUrl)}${tokenParam}`,
    );
    if (!res.ok) return { contacted: false };
    return await res.json();
  } catch {
    return { contacted: false };
  }
}

async function markSent(profileUrl) {
  const { appUrl, apiToken } = await getSettings();
  if (!appUrl) throw new Error("App URL not set.");
  const res = await fetch(`${appUrl}/_agent-native/actions/mark-sent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileUrl, ...(apiToken ? { apiToken } : {}) }),
  });
  if (!res.ok) throw new Error(`mark-sent failed (${res.status})`);
  return await res.json();
}

async function getExistingDraft(profileUrl) {
  const { appUrl, apiToken } = await getSettings();
  if (!appUrl) return null;
  try {
    const tokenParam = apiToken ? `&apiToken=${encodeURIComponent(apiToken)}` : "";
    const res = await fetch(
      `${appUrl}/_agent-native/actions/get-draft?profileUrl=${encodeURIComponent(profileUrl)}${tokenParam}`,
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json.ok && json.status === "drafted" ? json : null;
  } catch {
    return null;
  }
}

async function submitFeedback({ sentiment, message, draftNote }) {
  const { appUrl, apiToken } = await getSettings();
  if (!appUrl) return { ok: false, error: "App URL not configured" };
  try {
    const body = {
      ...(apiToken ? { apiToken } : {}),
      ...(sentiment ? { sentiment } : {}),
      message: message || "",
      ...(draftNote ? { draftNote } : {}),
    };
    const res = await fetch(`${appUrl}/_agent-native/actions/submit-feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[BLI] submit-feedback error", res.status, text.slice(0, 300));
      return { ok: false, error: `${res.status}: ${text.slice(0, 100)}` };
    }
    return await res.json();
  } catch (err) {
    console.error("[BLI] submit-feedback fetch error", err);
    return { ok: false, error: String(err) };
  }
}

async function resolveConnectButton(profileName, candidates) {
  const { appUrl, apiToken } = await getSettings();
  if (!appUrl) throw new Error("App URL not configured.");
  const res = await fetch(`${appUrl}/_agent-native/actions/resolve-connect-button`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileName, candidates, ...(apiToken ? { apiToken } : {}) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`resolve-connect-button failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return await res.json();
}

async function getDailyStats() {
  const { appUrl, apiToken } = await getSettings();
  if (!appUrl) return null;
  try {
    const tokenParam = apiToken ? `?apiToken=${encodeURIComponent(apiToken)}` : "";
    const res = await fetch(
      `${appUrl}/_agent-native/actions/get-daily-stats${tokenParam}`,
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function listCanvases(apiToken) {
  const { appUrl } = await getSettings();
  if (!appUrl) return { canvases: [] };
  try {
    const tokenParam = apiToken ? `?apiToken=${encodeURIComponent(apiToken)}` : "";
    const res = await fetch(`${appUrl}/_agent-native/actions/list-canvases${tokenParam}`);
    if (!res.ok) return { canvases: [] };
    const json = await res.json();
    // Extension only shows user-owned canvases (isSystem === 0)
    return { canvases: (json.canvases ?? []).filter((c) => c.isSystem === 0) };
  } catch {
    return { canvases: [] };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "DRAFT_REQUEST") {
    captureThenPoll(msg.data)
      .then((draft) => sendResponse({ ok: true, draft }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }

  if (msg.type === "CHECK_CONTACTED") {
    checkAlreadyContacted(msg.profileUrl)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch(() => sendResponse({ ok: true, contacted: false }));
    return true;
  }

  if (msg.type === "MARK_SENT") {
    markSent(msg.profileUrl)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "GET_EXISTING_DRAFT") {
    getExistingDraft(msg.profileUrl)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse(null));
    return true;
  }

  if (msg.type === "GET_DAILY_STATS") {
    getDailyStats()
      .then((result) => sendResponse(result))
      .catch(() => sendResponse(null));
    return true;
  }

  if (msg.type === "RESOLVE_CONNECT_BUTTON") {
    resolveConnectButton(msg.profileName, msg.candidates)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "SUBMIT_FEEDBACK") {
    submitFeedback(msg)
      .then((result) => sendResponse(result ?? { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === "LIST_CANVASES") {
    listCanvases(msg.apiToken)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ canvases: [] }));
    return true;
  }
});

// Open side panel in Chrome; open panel in a new tab in Arc and other
// browsers that don't implement the sidePanel API.
chrome.action.onClicked.addListener((tab) => {
  if (chrome.sidePanel) {
    chrome.sidePanel.open({ tabId: tab.id });
  } else {
    chrome.tabs.create({ url: chrome.runtime.getURL("panel.html") });
  }
});
