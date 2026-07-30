// Service worker — all cross-origin fetch calls live here to avoid CORS.
// The panel sends messages here; we call the outreach app and reply.

const APP_URL = "https://xdr-hub.netlify.app/li-agent";
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

async function checkHubspot(profileUrl, name, company) {
  const { appUrl, apiToken } = await getSettings();
  if (!appUrl) return { found: false };
  try {
    const params = new URLSearchParams({ profileUrl });
    if (name) params.set("name", name);
    if (company) params.set("company", company);
    if (apiToken) params.set("apiToken", apiToken);
    const url = `${appUrl}/_agent-native/actions/check-hubspot-contact?${params.toString()}`;
    console.log("[BLI] HubSpot lookup →", { profileUrl, name, company });
    const res = await fetch(url);
    if (!res.ok) {
      console.warn("[BLI] HubSpot lookup failed", res.status, await res.text().catch(() => ""));
      return { found: false };
    }
    const json = await res.json();
    console.log("[BLI] HubSpot result ←", json);
    return json;
  } catch (err) {
    console.error("[BLI] HubSpot lookup error", err);
    return { found: false };
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

async function ingestPostEngager(engager, apiToken) {
  const { appUrl } = await getSettings();
  const res = await fetch(`${appUrl}/_agent-native/actions/ingest-post-engager`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      postUrl: engager.postUrl,
      postTitle: engager.postTitle ?? null,
      engagerName: engager.name,
      engagerCompany: engager.company ?? null,
      engagerProfileUrl: engager.profileUrl,
      commentText: engager.commentText ?? null,
      ...(apiToken ? { apiToken } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ingest-post-engager failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return await res.json(); // { ok, id, status }
}

async function enrichPostEngager(id, profileData, apiToken) {
  const { appUrl } = await getSettings();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(`${appUrl}/_agent-native/actions/enrich-post-engager`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...profileData, ...(apiToken ? { apiToken } : {}) }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`enrich-post-engager failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

async function getPostEngager(id, apiToken) {
  const { appUrl } = await getSettings();
  const tokenParam = apiToken ? `&apiToken=${encodeURIComponent(apiToken)}` : "";
  const res = await fetch(`${appUrl}/_agent-native/actions/get-post-engager?id=${encodeURIComponent(id)}${tokenParam}`);
  if (!res.ok) return null;
  return await res.json();
}

// Scrapes the LinkedIn profile at profileUrl in a background tab, returns the
// profile data. Opens a non-active tab, waits for load, injects the content
// script, reads the profile, closes the tab.
async function scrapeProfileInBackground(profileUrl) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url: profileUrl, active: false }, (tab) => {
      const tabId = tab.id;
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.remove(tabId).catch(() => {});
        resolve(null);
      }, 20000); // 20s hard timeout per profile

      let scraped = false;
      function doScrape() {
        if (scraped) return;
        scraped = true;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        clearTimeout(timeout);
        chrome.scripting.executeScript(
          { target: { tabId }, files: ["content.js"] },
          () => {
            chrome.tabs.sendMessage(tabId, { type: "SCRAPE_PROFILE" }, (result) => {
              chrome.tabs.remove(tabId).catch(() => {});
              resolve(result?.ok ? result.data : null);
            });
          }
        );
      }

      function onUpdated(updatedTabId, changeInfo) {
        if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
        doScrape();
      }

      chrome.tabs.onUpdated.addListener(onUpdated);
      // Race guard: if the tab already reached "complete" before the listener
      // was registered (e.g., served from cache), scrape immediately.
      chrome.tabs.get(tabId, (tab) => {
        if (tab?.status === "complete") doScrape();
      });
    });
  });
}

// Loads an array of selected engager objects: ingests all at once (to create
// DB rows and return ids quickly), then enriches each sequentially (to avoid
// LinkedIn rate-limiting on background tab opens).
async function loadPostEngagers(engagers, sendProgress) {
  const { apiToken } = await chrome.storage.local.get(["apiToken"]);
  const token = apiToken || "";

  // Phase 1: ingest all to get ids. Fire in parallel — this is just DB inserts.
  const ingested = await Promise.all(
    engagers.map(async (engager) => {
      try {
        const result = await ingestPostEngager(engager, token);
        sendProgress({ id: result.id, name: engager.name, status: "pending", profileUrl: engager.profileUrl });
        return { id: result.id, engager };
      } catch (err) {
        console.error("[BLI] ingest failed for", engager.name, err);
        return null;
      }
    })
  );

  const valid = ingested.filter(Boolean);

  // Phase 2: enrich each sequentially to avoid LinkedIn rate limits.
  for (const { id, engager } of valid) {
    sendProgress({ id, name: engager.name, status: "enriching", profileUrl: engager.profileUrl });
    try {
      const profileData = await scrapeProfileInBackground(engager.profileUrl);
      const enrichPayload = profileData ? {
        headline: profileData.headline ?? null,
        role: profileData.role ?? null,
        about: profileData.about ?? null,
        recentActivity: profileData.recentActivity ?? null,
      } : {};
      const enrichResult = await enrichPostEngager(id, enrichPayload, token);
      sendProgress({
        id,
        name: engager.name,
        status: "done",
        profileUrl: engager.profileUrl,
        enriched: {
          headline: profileData?.headline ?? null,
          role: profileData?.role ?? null,
          fitVerdict: enrichResult?.fitVerdict ?? null,
          fitReason: enrichResult?.fitReason ?? null,
        },
      });
    } catch (err) {
      console.error("[BLI] enrich failed for", engager.name, err);
      sendProgress({ id, name: engager.name, status: "done", profileUrl: engager.profileUrl });
    }
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

  if (msg.type === "CHECK_HUBSPOT") {
    checkHubspot(msg.profileUrl, msg.name, msg.company)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch(() => sendResponse({ ok: true, found: false }));
    return true;
  }

  if (msg.type === "GET_POST_ENGAGER") {
    chrome.storage.local.get(["apiToken"], (r) => {
      getPostEngager(msg.id, r.apiToken || "")
        .then((result) => sendResponse(result ?? { status: "not_found" }))
        .catch(() => sendResponse({ status: "not_found" }));
    });
    return true;
  }
});

// Port-based channel for post-engager loading.
// An open port keeps the service worker alive and guarantees message
// delivery — more reliable than sendMessage for side-panel↔SW communication.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "bli-engager") return;
  console.log("[BLI BG] port connected");

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== "LOAD_POST_ENGAGERS") return;
    console.log("[BLI BG] LOAD_POST_ENGAGERS received", msg.engagers?.length, "engagers");

    const writeProgress = (progress) => {
      console.log("[BLI BG] progress", progress.status, progress.name);
      try { port.postMessage({ type: "POST_ENGAGER_PROGRESS", progress }); } catch { /* port closed */ }
    };

    try {
      await loadPostEngagers(msg.engagers, writeProgress);
      console.log("[BLI BG] loadPostEngagers complete");
      try { port.postMessage({ type: "LOAD_COMPLETE", ok: true }); } catch {}
    } catch (err) {
      console.error("[BLI BG] loadPostEngagers error", err);
      try { port.postMessage({ type: "LOAD_COMPLETE", ok: false, error: err.message }); } catch {}
    }
  });
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
