// Service worker — all cross-origin fetch calls live here to avoid CORS.
// The panel sends messages here; we call the outreach app and reply.

const APP_URL = "https://builder-li.netlify.app/outreach";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120000; // 2 minutes max

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

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

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
});

// Open the side panel when the extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});
