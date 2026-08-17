const draftBtn = document.getElementById("draft-btn");
const statusEl = document.getElementById("status");
const verdictSection = document.getElementById("verdict-section");
const verdictBadge = document.getElementById("verdict-badge");
const fitReason = document.getElementById("fit-reason");
const noteText = document.getElementById("note-text");
const charCount = document.getElementById("char-count");
const followupSection = document.getElementById("followup-section");
const followupText = document.getElementById("followup-text");
const sentSection = document.getElementById("sent-section");
const markSentBtn = document.getElementById("mark-sent-btn");
const autoConnectBtn = document.getElementById("auto-connect-btn");
const personaChip = document.getElementById("persona-chip");
const personaIndicator = document.getElementById("persona-indicator");
const personaNameLabel = document.getElementById("persona-name-label");
const alreadyContacted = document.getElementById("already-contacted");
const hubspotLink = document.getElementById("hubspot-link");
const hubspotOwner = document.getElementById("hubspot-owner");
const hubspotSequenceWarn = document.getElementById("hubspot-sequence-warn");
const dailyMeter = document.getElementById("daily-meter");
const dailyMeterText = document.getElementById("daily-meter-text");
const dailyMeterBar = document.getElementById("daily-meter-bar");
const notLinkedin = document.getElementById("not-linkedin");
const mainContent = document.getElementById("main-content");
const profileLoading = document.getElementById("profile-loading");
const profileData = document.getElementById("profile-data");
const profileFullName = document.getElementById("profile-full-name");
const profileHeadlineText = document.getElementById("profile-headline-text");
const profileMeta = document.getElementById("profile-meta");
const profileLocation = document.getElementById("profile-location");
const settingsBtn = document.getElementById("settings-btn");
const settingsView = document.getElementById("settings-view");
const tokenInput = document.getElementById("token-input");
const saveTokenBtn = document.getElementById("save-token-btn");
const clearTokenBtn = document.getElementById("clear-token-btn");
const tokenSaveStatus = document.getElementById("token-save-status");
const tokenStatusBadge = document.getElementById("token-status-badge");
const autoModeToggle = document.getElementById("auto-mode-toggle");
const feedbackSection = document.getElementById("feedback-section");
const canvasPickerSection = document.getElementById("canvas-picker-section");
const canvasSelect = document.getElementById("canvas-select");
const thumbUpBtn = document.getElementById("thumb-up-btn");
const thumbDownBtn = document.getElementById("thumb-down-btn");
const feedbackForm = document.getElementById("feedback-form");
const feedbackMessage = document.getElementById("feedback-message");
const feedbackSkipBtn = document.getElementById("feedback-skip-btn");
const feedbackSubmitBtn = document.getElementById("feedback-submit-btn");
const feedbackThanks = document.getElementById("feedback-thanks");

let currentProfileUrl = null; // canonical identity for API calls (public /in/ URL when known)
let currentTabUrl = null; // raw tab URL — used only to detect SPA navigation
let feedbackSentiment = null;
let cachedScrape = null; // reuse in draftBtn click
let activeTabId = null;
let lastRenderedName = null; // name last shown; used to detect stale DOM after SPA nav

// Returns true for both regular LinkedIn profiles and Sales Navigator lead pages.
function isProfileUrl(url) {
  return (
    url.includes("linkedin.com/in/") ||
    url.includes("linkedin.com/sales/lead/") ||
    url.includes("linkedin.com/sales/people/")
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function setStatus(msg) { statusEl.textContent = msg; }

function updateCharCount() {
  const len = noteText.value.length;
  charCount.textContent = `${len} / 300 chars`;
  charCount.classList.toggle("over", len > 300);
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = "Copied!";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = btn.id === "copy-note-btn" ? "Copy note" : "Copy follow-up";
      btn.classList.remove("copied");
    }, 2000);
  });
}

function resetFeedbackSection() {
  feedbackSentiment = null;
  feedbackForm.style.display = "none";
  feedbackMessage.value = "";
  feedbackThanks.style.display = "none";
  thumbUpBtn.className = "thumb-btn";
  thumbDownBtn.className = "thumb-btn";
  thumbUpBtn.style.display = "";
  thumbDownBtn.style.display = "";
  if (feedbackSubmitBtn) {
    feedbackSubmitBtn.disabled = false;
    feedbackSubmitBtn.textContent = "Send feedback";
    feedbackSubmitBtn.style.background = "";
  }
  const errEl = document.getElementById("feedback-error");
  if (errEl) errEl.textContent = "";
}

function showVerdict(draft, { triggerAuto = false } = {}) {
  resetFeedbackSection();
  const v = draft.fitVerdict || "possible";
  verdictBadge.className = `verdict-${v}`;
  verdictBadge.textContent = { strong: "Strong", possible: "Possible", weak: "Weak", inconclusive: "Inconclusive" }[v] ?? v;
  fitReason.textContent = draft.fitReason || "";
  noteText.value = draft.draftNote || "";
  updateCharCount();

  if (draft.personaColor && draft.personaName) {
    personaIndicator.style.background = draft.personaColor;
    personaNameLabel.textContent = draft.personaName;
    personaChip.style.display = "inline-flex";
  } else {
    personaChip.style.display = "none";
  }

  if (draft.draftFollowUp) {
    followupText.value = draft.draftFollowUp;
    followupSection.style.display = "block";
  }

  verdictSection.style.display = "block";
  sentSection.style.display = "block";
  feedbackSection.style.display = "block";

  if (triggerAuto && autoModeToggle.checked && !autoConnectBtn.classList.contains("success")) {
    setTimeout(() => {
      if (autoModeToggle.checked && !autoConnectBtn.classList.contains("success")) {
        autoConnectBtn.click();
      }
    }, 600);
  }
}

function renderProfileCard(data) {
  lastRenderedName = data.name || null;
  profileLoading.style.display = "none";

  profileFullName.textContent = data.name || "Unknown";
  profileHeadlineText.textContent = data.headline || "";

  profileMeta.innerHTML = "";
  function addMetaChip(text, className) {
    const chip = document.createElement("span");
    chip.className = `meta-chip ${className}`;
    chip.textContent = text;
    profileMeta.appendChild(chip);
  }
  if (data.role && data.company && data.role !== data.company) {
    addMetaChip(data.role, "role-chip");
    addMetaChip(data.company, "company-chip");
  } else if (data.company) {
    addMetaChip(data.company, "company-chip");
  } else if (data.role) {
    addMetaChip(data.role, "role-chip");
  }

  if (data.location) {
    profileLocation.textContent = data.location;
    profileLocation.style.display = "block";
  } else {
    profileLocation.style.display = "none";
  }

  profileData.style.display = "block";
}

// ── Scrape helper: injects content.js if not yet present, retries once ──────

async function scrapeTab(tabId, { retryMs = 0, maxRetries = 1, prevName = null, initialDelayMs = 0 } = {}) {
  const attempt = async () => {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: "SCRAPE_PROFILE" });
    } catch {
      // Content script not running — inject then retry.
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
        return await chrome.tabs.sendMessage(tabId, { type: "SCRAPE_PROFILE" });
      } catch {
        return null;
      }
    }
  };

  // When called after a SPA navigation, LinkedIn briefly renders a cached copy of
  // a previously-viewed profile before loading the real one. Both document.title
  // and the DOM h1 update to the cached name simultaneously, so domStale=false
  // and a prevName check only catches the immediately-prior profile. Waiting
  // 800 ms gives LinkedIn time to finish rendering the actual new profile.
  if (initialDelayMs > 0) await new Promise((r) => setTimeout(r, initialDelayMs));

  let result = await attempt();
  // Retry while: content script not ready, name missing, domStale (title≠h1),
  // name matches previous profile, OR name is present but LinkedIn hasn't finished
  // rendering the rest of the profile card (headline + company both null).
  for (let i = 0; i < maxRetries; i++) {
    const sameName = prevName && result?.data?.name &&
      result.data.name.toLowerCase().trim() === prevName.toLowerCase().trim();
    const cardEmpty = Boolean(result?.data?.name) && !result?.data?.headline && !result?.data?.company;
    const needsRetry = !result?.ok || !result?.data?.name || result?.data?.domStale || sameName || cardEmpty;
    if (!needsRetry) break;
    await new Promise((r) => setTimeout(r, retryMs));
    result = await attempt() ?? result;
  }
  return result;
}

// ── Daily meter ──────────────────────────────────────────────────────────────

function renderDailyMeter(stats) {
  if (!stats || stats.limit == null) {
    dailyMeter.style.display = "none";
    return;
  }
  const { capturedToday = 0, limit } = stats;
  const pct = Math.min(100, Math.round((capturedToday / limit) * 100));
  dailyMeterText.textContent = `${capturedToday} / ${limit}`;
  dailyMeterBar.style.width = `${pct}%`;
  if (pct >= 100) {
    dailyMeterBar.style.background = "#c0392b";
    dailyMeterText.style.color = "#c0392b";
  } else if (pct >= 80) {
    dailyMeterBar.style.background = "#f59e0b";
    dailyMeterText.style.color = "#b45309";
  } else {
    dailyMeterBar.style.background = "#0a66c2";
    dailyMeterText.style.color = "#666";
  }
  dailyMeter.style.display = "block";
}

// ── Background enrichment ────────────────────────────────────────────────────
// LinkedIn lazy-loads the Experience section. We poll after the initial scrape
// and silently update the card as soon as the section appears in the DOM.
async function startEnrichment() {
  const profileUrl = currentProfileUrl;
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 400));
    if (currentProfileUrl !== profileUrl || !activeTabId) return;
    const result = await scrapeTab(activeTabId);
    if (!result?.ok || !result.data) continue;
    if (result.data.role && !cachedScrape?.role) {
      cachedScrape = result.data;
      renderProfileCard(result.data);
      return;
    }
  }
}

// ── Reset panel state for a new profile ─────────────────────────────────────

function resetPanel() {
  currentProfileUrl = null;
  currentTabUrl = null;
  cachedScrape = null;

  // Restore the on-LinkedIn view (may have been hidden when navigating away).
  notLinkedin.style.display = "none";
  mainContent.style.display = "block";

  profileLoading.textContent = "Reading profile…";
  profileLoading.style.display = "block";
  profileData.style.display = "none";
  profileFullName.textContent = "";
  profileHeadlineText.textContent = "";
  profileMeta.innerHTML = "";
  profileLocation.style.display = "none";

  alreadyContacted.style.display = "none";
  hubspotLink.style.display = "none";
  hubspotLink.href = "#";
  hubspotOwner.style.display = "none";
  hubspotOwner.textContent = "";
  hubspotSequenceWarn.style.display = "none";
  dailyMeter.style.display = "none";
  draftBtn.disabled = true;
  draftBtn.textContent = "Draft note";
  setStatus("");
  verdictSection.style.display = "none";
  personaChip.style.display = "none";
  autoConnectBtn.disabled = false;
  autoConnectBtn.textContent = "Connect & send";
  autoConnectBtn.classList.remove("success");
  markSentBtn.disabled = false;
  markSentBtn.textContent = "Mark as sent manually";
  markSentBtn.classList.remove("sent");

  resetFeedbackSection();
  feedbackSection.style.display = "none";
}

// ── Canvas picker ────────────────────────────────────────────────────────────

async function loadCanvases() {
  const { apiToken: token } = await chrome.storage.local.get(["apiToken"]);
  const { lastCanvasId } = await chrome.storage.local.get(["lastCanvasId"]);
  const result = await chrome.runtime.sendMessage({ type: "LIST_CANVASES", apiToken: token });
  const canvases = result?.canvases ?? [];

  if (canvases.length === 0) {
    canvasPickerSection.style.display = "none";
    return;
  }

  // Build options with textContent (not innerHTML) to avoid XSS from canvas names
  canvasSelect.innerHTML = "";
  canvases.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    if (String(c.id) === String(lastCanvasId)) opt.selected = true;
    canvasSelect.appendChild(opt);
  });

  canvasPickerSection.style.display = "block";
}

canvasSelect.addEventListener("change", () => {
  chrome.storage.local.set({ lastCanvasId: canvasSelect.value });
});

// ── Init: scrape immediately on open ────────────────────────────────────────

async function init({ navTriggered = false } = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || "";

  if (!isProfileUrl(url)) {
    notLinkedin.style.display = "block";
    mainContent.style.display = "none";
    return;
  }

  currentTabUrl = url.split("?")[0];
  currentProfileUrl = currentTabUrl;
  activeTabId = tab.id;

  // navTriggered: wait 800 ms before the first scrape so LinkedIn finishes loading
  // the real profile (it briefly renders a cached copy after pushState).
  const scrapeResult = await scrapeTab(tab.id, {
    retryMs: 600,
    maxRetries: 3,
    prevName: lastRenderedName,
    initialDelayMs: navTriggered ? 800 : 0,
  });
  if (scrapeResult?.ok && scrapeResult.data) {
    cachedScrape = scrapeResult.data;
    // Adopt the scraper's canonical URL (on Sales Nav this is the public /in/
    // URL when the page exposes one) so drafts, mark-sent, and HubSpot checks
    // share one identity with captures from regular LinkedIn.
    if (scrapeResult.data.profileUrl) currentProfileUrl = scrapeResult.data.profileUrl;
    renderProfileCard(scrapeResult.data);
    if (!scrapeResult.data.role) startEnrichment();
  } else {
    profileLoading.textContent = "Could not read profile data.";
  }

  draftBtn.disabled = false;

  // Check for an existing draft on this profile (fire-and-forget).
  const urlForDraftCheck = currentProfileUrl;
  chrome.runtime.sendMessage({ type: "GET_EXISTING_DRAFT", profileUrl: urlForDraftCheck })
    .then((existing) => {
      if (currentProfileUrl === urlForDraftCheck && existing?.draft) {
        showVerdict(existing.draft);
        draftBtn.textContent = "Re-draft";
      }
    })
    .catch(() => {});

  // Load daily meter (fire-and-forget).
  chrome.runtime.sendMessage({ type: "GET_DAILY_STATS" })
    .then((stats) => { if (currentProfileUrl) renderDailyMeter(stats); })
    .catch(() => {});

  // Load canvas picker (fire-and-forget).
  loadCanvases().catch(() => {});

  // HubSpot lookup — fire-and-forget, shows icon link, owner, and sequence warning.
  const urlForHubspot = currentProfileUrl;
  Promise.race([
    chrome.runtime.sendMessage({
      type: "CHECK_HUBSPOT",
      profileUrl: urlForHubspot,
      name: cachedScrape?.name ?? "",
      company: cachedScrape?.company ?? "",
    }),
    new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
  ]).then((hsRes) => {
    if (currentProfileUrl !== urlForHubspot || !hsRes?.found) return;
    hubspotLink.href = hsRes.hubspotUrl || "https://app.hubspot.com/contacts/";
    hubspotLink.style.display = "inline-flex";
    const ownerParts = [];
    if (hsRes.ownerName) ownerParts.push(hsRes.ownerName);
    if (hsRes.xdrOwner && hsRes.xdrOwner !== hsRes.ownerName) ownerParts.push(`xDR: ${hsRes.xdrOwner}`);
    if (ownerParts.length) {
      hubspotOwner.textContent = `Owner: ${ownerParts.join(" · ")}`;
      hubspotOwner.style.display = "block";
    }
    if (hsRes.isInSequence) {
      hubspotSequenceWarn.style.display = "block";
    }
  }).catch(() => {});

  // Non-critical cosmetic check — fire-and-forget so isInitializing drops now,
  // not after the 3 s timeout. Guard against showing a banner for the wrong profile.
  const urlForCheck = currentProfileUrl;
  Promise.race([
    chrome.runtime.sendMessage({ type: "CHECK_CONTACTED", profileUrl: urlForCheck }),
    new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
  ]).then((contactedRes) => {
    if (currentProfileUrl === urlForCheck && contactedRes?.contacted) {
      alreadyContacted.style.display = "block";
    }
  }).catch(() => {});
}

// ── Settings view ────────────────────────────────────────────────────────────

function updateTokenStatusBadge(hasToken) {
  if (hasToken) {
    tokenStatusBadge.className = "token-status configured";
    tokenStatusBadge.textContent = "✓ API token saved";
  } else {
    tokenStatusBadge.className = "token-status missing";
    tokenStatusBadge.textContent = "⚠ No API token — paste yours below";
  }
}

function showSettings() {
  settingsView.style.display = "block";
  mainContent.style.display = "none";
  notLinkedin.style.display = "none";
  settingsBtn.classList.add("active");
  chrome.storage.local.get(["apiToken"], (r) => {
    updateTokenStatusBadge(!!r.apiToken);
    tokenInput.value = "";
    tokenInput.placeholder = r.apiToken ? "Enter new token to replace" : "Paste your Personal API Token";
  });
}

function hideSettings() {
  settingsView.style.display = "none";
  settingsBtn.classList.remove("active");
}

settingsBtn.addEventListener("click", () => {
  if (settingsView.style.display === "block") {
    hideSettings();
    // Restore the right view
    chrome.storage.local.get(["apiToken"], (r) => {
      if (r.apiToken) {
        mainContent.style.display = "block";
      }
      // If no token, stay on settings
      if (!r.apiToken) showSettings();
    });
  } else {
    showSettings();
  }
});

saveTokenBtn.addEventListener("click", () => {
  const token = tokenInput.value.trim();
  if (!token) {
    tokenSaveStatus.style.color = "#c0392b";
    tokenSaveStatus.textContent = "Please paste your token first.";
    return;
  }
  chrome.storage.local.set({ apiToken: token }, () => {
    tokenSaveStatus.style.color = "#1e7e34";
    tokenSaveStatus.textContent = "Saved!";
    updateTokenStatusBadge(true);
    tokenInput.value = "";
    tokenInput.placeholder = "Enter new token to replace";
    setTimeout(() => {
      tokenSaveStatus.textContent = "";
      hideSettings();
      mainContent.style.display = "block";
      init().finally(() => startUrlPolling());
    }, 800);
  });
});

clearTokenBtn.addEventListener("click", () => {
  chrome.storage.local.remove("apiToken", () => {
    tokenInput.value = "";
    updateTokenStatusBadge(false);
    tokenInput.placeholder = "Paste your Personal API Token";
    tokenSaveStatus.style.color = "#888";
    tokenSaveStatus.textContent = "Token cleared.";
    setTimeout(() => { tokenSaveStatus.textContent = ""; }, 1500);
  });
});

// ── Boot ─────────────────────────────────────────────────────────────────────

chrome.storage.local.get(["apiToken", "autoMode"], (result) => {
  autoModeToggle.checked = result.autoMode === true; // default OFF
  if (!result.apiToken) {
    showSettings();
  } else {
    init().finally(() => startUrlPolling());
  }
});

autoModeToggle.addEventListener("change", () => {
  chrome.storage.local.set({ autoMode: autoModeToggle.checked });
});

// ── Draft button ─────────────────────────────────────────────────────────────

draftBtn.addEventListener("click", async () => {
  draftBtn.disabled = true;
  verdictSection.style.display = "none";
  setStatus("Reading profile…");

  try {
    let scrapeData = cachedScrape;

    // Re-scrape only if initial scrape failed on open
    if (!scrapeData) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const scrapeResult = await scrapeTab(tab.id, { retryMs: 600, maxRetries: 4 });
      if (!scrapeResult?.ok) throw new Error("Could not read the profile. Make sure you're on a LinkedIn profile page.");
      scrapeData = scrapeResult.data;
      if (scrapeData.profileUrl) currentProfileUrl = scrapeData.profileUrl;
      renderProfileCard(scrapeData);
    }

    // Already a 1st-degree connection — no invite to send, so skip the agent
    // call entirely rather than drafting a note (and burning outreach quota)
    // for someone who's already connected.
    if (scrapeData.connectionDegree === "1st") {
      setStatus("Already connected — no outreach needed.");
      draftBtn.disabled = false;
      return;
    }

    setStatus("Sending to Builder.LI… (the agent is drafting, this takes ~30s)");

    const selectedCanvasId = canvasSelect.value || null;
    if (selectedCanvasId) {
      chrome.storage.local.set({ lastCanvasId: selectedCanvasId });
    }

    const result = await chrome.runtime.sendMessage({
      type: "DRAFT_REQUEST",
      data: { ...scrapeData, canvasId: selectedCanvasId },
    });

    if (!result?.ok) throw new Error(result?.error || "Unknown error");

    setStatus("");
    showVerdict(result.draft, { triggerAuto: true });
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    draftBtn.disabled = false;
  }
});

// ── Copy buttons ─────────────────────────────────────────────────────────────

noteText.addEventListener("input", updateCharCount);

document.getElementById("copy-note-btn").addEventListener("click", (e) => {
  copyText(noteText.value, e.currentTarget);
});

document.getElementById("copy-followup-btn").addEventListener("click", (e) => {
  copyText(followupText.value, e.currentTarget);
});

// ── Poll for URL changes (LinkedIn SPA navigations don't reliably fire onUpdated)
let urlPollTimer = null;
let isInitializing = false; // guards against re-entrant init during SPA nav

function startUrlPolling() {
  if (urlPollTimer) clearInterval(urlPollTimer);
  urlPollTimer = setInterval(async () => {
    if (isInitializing) return;
    let tab;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch {
      return; // Tab query failed transiently — try again next tick
    }
    if (!tab) return;
    const url = tab.url || "";
    // Compare against the raw tab URL — currentProfileUrl may hold the
    // canonical /in/ identity for a Sales Nav page, which never equals the
    // tab's /sales/lead/ URL and would otherwise re-init forever.
    const newTabUrl = url.split("?")[0];
    if (isProfileUrl(url) && newTabUrl !== currentTabUrl) {
      isInitializing = true;
      resetPanel();
      init({ navTriggered: true }).finally(() => { isInitializing = false; });
    } else if (!isProfileUrl(url) && currentProfileUrl) {
      currentProfileUrl = null;
      currentTabUrl = null;
      notLinkedin.style.display = "block";
      mainContent.style.display = "none";
    }
  }, 750);
}

// ── Feedback ─────────────────────────────────────────────────────────────────

function selectThumb(sentiment) {
  feedbackSentiment = sentiment;
  thumbUpBtn.className = sentiment === "positive" ? "thumb-btn selected-up" : "thumb-btn";
  thumbDownBtn.className = sentiment === "negative" ? "thumb-btn selected-down" : "thumb-btn";
  feedbackMessage.placeholder = sentiment === "positive"
    ? "What worked well? (optional)"
    : "What went wrong? How could it be better?";
  feedbackForm.style.display = "block";
}

function hideFeedbackAfterSubmit() {
  feedbackForm.style.display = "none";
  thumbUpBtn.style.display = "none";
  thumbDownBtn.style.display = "none";
  feedbackThanks.style.display = "block";
}

async function doSubmitFeedback(skipMessage) {
  feedbackSubmitBtn.disabled = true;
  const message = skipMessage ? "" : feedbackMessage.value;
  const result = await chrome.runtime.sendMessage({
    type: "SUBMIT_FEEDBACK",
    sentiment: feedbackSentiment,
    message,
    draftNote: noteText.value,
  }).catch(() => null);

  if (result?.ok) {
    hideFeedbackAfterSubmit();
  } else {
    feedbackSubmitBtn.disabled = false;
    feedbackSubmitBtn.textContent = "Retry";
    feedbackSubmitBtn.style.background = "#c0392b";
    const errEl = document.getElementById("feedback-error");
    if (errEl) errEl.textContent = result?.error || "Failed — check service worker console";
  }
}

thumbUpBtn.addEventListener("click", () => selectThumb("positive"));
thumbDownBtn.addEventListener("click", () => selectThumb("negative"));
feedbackSkipBtn.addEventListener("click", () => doSubmitFeedback(true));
feedbackSubmitBtn.addEventListener("click", () => doSubmitFeedback(false));

// ── Auto-connect & send ───────────────────────────────────────────────────────

autoConnectBtn.addEventListener("click", async () => {
  if (!activeTabId || !currentProfileUrl || autoConnectBtn.classList.contains("success")) return;

  autoConnectBtn.disabled = true;
  markSentBtn.disabled = true;
  setStatus("Connecting…");

  try {
    let result;
    try {
      result = await chrome.tabs.sendMessage(activeTabId, {
        type: "SEND_CONNECTION_REQUEST",
        note: noteText.value,
      });
    } catch {
      // Content script not running — inject then retry
      await chrome.scripting.executeScript({ target: { tabId: activeTabId }, files: ["content.js"] });
      result = await chrome.tabs.sendMessage(activeTabId, {
        type: "SEND_CONNECTION_REQUEST",
        note: noteText.value,
      });
    }

    if (!result?.ok) throw new Error(result?.error || "Auto-connect failed.");

    await chrome.runtime.sendMessage({ type: "MARK_SENT", profileUrl: currentProfileUrl });

    setStatus("");
    autoConnectBtn.textContent = "✓ Connected & sent";
    autoConnectBtn.classList.add("success");
    markSentBtn.textContent = "✓ Sent";
    markSentBtn.classList.add("sent");
    markSentBtn.disabled = true;
    alreadyContacted.style.display = "block";
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    autoConnectBtn.disabled = false;
    markSentBtn.disabled = false;
  }
});

// ── Mark sent ────────────────────────────────────────────────────────────────

markSentBtn.addEventListener("click", async () => {
  if (!currentProfileUrl || markSentBtn.classList.contains("sent")) return;

  markSentBtn.disabled = true;
  const result = await chrome.runtime.sendMessage({
    type: "MARK_SENT",
    profileUrl: currentProfileUrl,
  });

  if (result?.ok) {
    markSentBtn.textContent = "✓ Sent";
    markSentBtn.classList.add("sent");
    alreadyContacted.style.display = "block";
  } else {
    markSentBtn.disabled = false;
    setStatus("Failed to mark as sent. Try again.");
  }
});

// ── Engagers tab ─────────────────────────────────────────────────────────────

const tabSwitcher = document.getElementById("tab-switcher");
const tabProfileBtn = document.getElementById("tab-profile-btn");
const tabEngagersBtn = document.getElementById("tab-engagers-btn");
const engagersTab = document.getElementById("engagers-tab");
const engagersList = document.getElementById("engagers-list");
const engagersEmpty = document.getElementById("engagers-empty");
const selectAllBtn = document.getElementById("select-all-btn");
const loadSelectedBtn = document.getElementById("load-selected-btn");
const refreshEngagersBtn = document.getElementById("refresh-engagers-btn");

let engagerData = []; // { name, company, profileUrl, commentText, postUrl, postTitle }
let loadedIds = {};   // profileUrl → { id, status, enriched }
let currentPostUrl = null; // tracks the post URL independently of currentProfileUrl

// Port-based channel to the background service worker.
// Keeps the SW alive and guarantees progress message delivery.
let bgEngagerPort = null;
function connectEngagerPort() {
  try {
    bgEngagerPort = chrome.runtime.connect({ name: "bli-engager" });
    console.log("[BLI panel] port connected");
    bgEngagerPort.onMessage.addListener((msg) => {
      if (msg.type === "POST_ENGAGER_PROGRESS") {
        applyEngagerProgress(msg.progress);
      }
    });
    bgEngagerPort.onDisconnect.addListener(() => {
      console.log("[BLI panel] port disconnected, reconnecting…");
      bgEngagerPort = null;
      setTimeout(connectEngagerPort, 500);
    });
  } catch (err) {
    console.warn("[BLI panel] port connect failed:", err);
    bgEngagerPort = null;
  }
}
connectEngagerPort();

function isPostUrl(url) {
  return url.includes("linkedin.com/posts/") || url.includes("linkedin.com/feed/update/");
}

// LIVE-VERIFY: best guess based on Sales Nav's known URL taxonomy for a
// saved lead list or live search results page, not confirmed against a
// real account — matches the same pattern content.js's isSalesNavListUrl()
// uses (the two can't share code across the content-script/panel boundary
// without a build step, so this is deliberately duplicated, same as
// isProfileUrl/isPostUrl already are).
function isSalesNavListUrl(url) {
  return /linkedin\.com\/sales\/(lists\/people\/|search\/people)/i.test(url);
}

// Distinguishes the two URL shapes isSalesNavListUrl() matches, so the
// caller can decide how to name the capture -- a saved list's tab title
// literally contains the list's name, but a search-results page's title
// doesn't, so it needs a different (timestamp-based) naming path below.
function isSalesNavSearchUrl(url) {
  return /linkedin\.com\/sales\/search\/people/i.test(url);
}

// The "Export a saved list to Apollo" section doesn't read anything off
// the current page -- it only needs the tab switcher to stay visible and
// the Lists tab to stay open while the rep is actually on Apollo, since
// that's the tab they're dragging the generated CSV into.
function isApolloUrl(url) {
  return /(^|\.)apollo\.io(\/|$)/i.test(url.replace(/^https?:\/\//i, ""));
}

function switchTab(tab) {
  tabProfileBtn.classList.toggle("active", tab === "profile");
  tabEngagersBtn.classList.toggle("active", tab === "engagers");
  if (tabListsBtn) tabListsBtn.classList.toggle("active", tab === "lists");
  mainContent.style.display = tab === "profile" ? "block" : "none";
  engagersTab.style.display = tab === "engagers" ? "block" : "none";
  if (listsTab) listsTab.style.display = tab === "lists" ? "block" : "none";
}

tabProfileBtn.addEventListener("click", () => switchTab("profile"));
tabEngagersBtn.addEventListener("click", () => switchTab("engagers"));

refreshEngagersBtn.addEventListener("click", async () => {
  refreshEngagersBtn.textContent = "↻ Scanning…";
  refreshEngagersBtn.disabled = true;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) await loadEngagersTab(tab.id);
  refreshEngagersBtn.textContent = "↻ Refresh comments";
  refreshEngagersBtn.disabled = false;
});

function updateLoadSelectedBtn() {
  const checked = document.querySelectorAll(".engager-check:checked");
  const count = checked.length;
  loadSelectedBtn.disabled = count === 0;
  loadSelectedBtn.textContent = `Send to LinkedIn Agent (${count})`;
}

function renderEngagerRow(engager, idx) {
  const loaded = loadedIds[engager.profileUrl];
  const row = document.createElement("div");
  row.className = `engager-row${loaded ? " loaded" : ""}`;
  row.dataset.idx = idx;

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "engager-check";
  cb.disabled = !!loaded;
  cb.addEventListener("change", updateLoadSelectedBtn);

  const info = document.createElement("div");
  info.className = "engager-info";

  const nameEl = document.createElement("div");
  nameEl.className = "engager-name";
  nameEl.textContent = engager.name;

  const headlineEl = document.createElement("div");
  headlineEl.className = "engager-headline";
  headlineEl.textContent = engager.company || "";

  info.append(nameEl, headlineEl);

  if (engager.commentText) {
    const commentEl = document.createElement("div");
    commentEl.className = "engager-comment";
    commentEl.textContent = engager.commentText;
    info.appendChild(commentEl);
  }

  const statusEl = document.createElement("div");
  let statusText = "";
  let statusExtra = "";
  if (loaded) {
    const v = loaded.fitVerdict;
    if (v === "strong")       { statusText = "● Strong";   statusExtra = " verdict-strong"; }
    else if (v === "possible"){ statusText = "● Possible"; statusExtra = " verdict-possible"; }
    else if (v === "weak")    { statusText = "● Weak";     statusExtra = " verdict-weak"; }
    else if (loaded.status === "done")      { statusText = "✓ Done"; }
    else if (loaded.status === "enriching") { statusText = "Enriching…"; }
    else                                    { statusText = "Pending…"; }
  }
  statusEl.className = `engager-status${loaded ? " " + loaded.status : ""}${statusExtra}`;
  statusEl.textContent = statusText;

  row.append(cb, info, statusEl);
  return row;
}

function renderEngagersList() {
  engagersList.innerHTML = "";
  if (!engagerData.length) {
    engagersList.appendChild(engagersEmpty);
    return;
  }
  engagerData.forEach((e, i) => engagersList.appendChild(renderEngagerRow(e, i)));
  updateLoadSelectedBtn();
}

selectAllBtn.addEventListener("click", () => {
  const checkboxes = document.querySelectorAll(".engager-check:not(:disabled)");
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);
  checkboxes.forEach(cb => { cb.checked = !allChecked; });
  selectAllBtn.textContent = allChecked ? "Select all" : "Deselect all";
  updateLoadSelectedBtn();
});

loadSelectedBtn.addEventListener("click", async () => {
  const checkboxes = Array.from(document.querySelectorAll(".engager-check:checked"));
  const selected = checkboxes.map(cb => {
    const idx = parseInt(cb.closest(".engager-row").dataset.idx, 10);
    return engagerData[idx];
  }).filter(Boolean);

  if (!selected.length) return;

  loadSelectedBtn.disabled = true;
  loadSelectedBtn.textContent = "Sending…";

  // Reset button after 3s — progress messages handle card UI from here.
  setTimeout(() => {
    loadSelectedBtn.disabled = false;
    updateLoadSelectedBtn();
  }, 3000);

  // Send via port (reliable) with sendMessage as fallback.
  console.log("[BLI panel] sending LOAD_POST_ENGAGERS via port:", bgEngagerPort ? "yes" : "no (fallback)");
  if (bgEngagerPort) {
    bgEngagerPort.postMessage({ type: "LOAD_POST_ENGAGERS", engagers: selected });
  } else {
    chrome.runtime.sendMessage({ type: "LOAD_POST_ENGAGERS", engagers: selected }).catch(() => {});
  }
});

function applyEngagerProgress(progress) {
  if (!progress) return;
  const { id, status, profileUrl, enriched } = progress;
  if (!profileUrl) return;
  const prev = loadedIds[profileUrl] || {};
  loadedIds[profileUrl] = {
    id,
    status,
    fitVerdict: enriched?.fitVerdict ?? prev.fitVerdict ?? null,
    enriched: enriched ?? prev.enriched ?? null,
  };
  if (status === "done" && enriched) {
    const entry = engagerData.find((e) => e.profileUrl === profileUrl);
    if (entry) {
      entry.company = enriched.headline || enriched.role || entry.company;
    }
  }
  renderEngagersList();
}

// Fallback: catch any broadcast from older SW versions or if port isn't up yet.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "POST_ENGAGER_PROGRESS" && msg.progress) {
    applyEngagerProgress(msg.progress);
  }
});

async function loadEngagersTab(tabId) {
  engagerData = [];
  // Don't reset loadedIds — progress messages arrive asynchronously and URL
  // polling can trigger a rescan while enrichment is in flight. Preserving
  // loadedIds means cards keep their status and headline across rescans.
  // loadedIds is only cleared in startUrlPollingWithEngagers when the post
  // URL genuinely changes to a different post.
  engagersEmpty.textContent = "Navigate to a LinkedIn post to see commenters here.";
  renderEngagersList();

  try {
    let result;
    try {
      result = await chrome.tabs.sendMessage(tabId, { type: "SCRAPE_COMMENTERS" });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      result = await chrome.tabs.sendMessage(tabId, { type: "SCRAPE_COMMENTERS" });
    }
    if (result?.ok && result.commenters?.length) {
      engagerData = result.commenters;
      // Restore enriched headline for any engagers already in loadedIds.
      for (const e of engagerData) {
        const loaded = loadedIds[e.profileUrl];
        if (loaded?.enriched) {
          e.company = loaded.enriched.headline || loaded.enriched.role || e.company;
        }
      }
      renderEngagersList();
    } else {
      engagersEmpty.textContent = "No commenters found. Try scrolling to load more comments, then switch back.";
      engagersList.appendChild(engagersEmpty);
    }
  } catch {
    engagersEmpty.textContent = "Could not read comments. Make sure you're on a LinkedIn post page.";
    engagersList.appendChild(engagersEmpty);
  }
}

// ── Lists tab (Sales Nav lead list import) ──────────────────────────────────
// Pagination is always user-driven — the xDR clicks "Next" in Sales Nav
// themselves; this only accumulates whatever each page's scrape returns.
// Never auto-clicks pagination controls (account-safety decision).

const tabListsBtn = document.getElementById("tab-lists-btn");
const listsTab = document.getElementById("lists-tab");
const listsCount = document.getElementById("lists-count");
const listsLeadsEl = document.getElementById("lists-leads");
const listsEmpty = document.getElementById("lists-empty");
const listsStatus = document.getElementById("lists-status");
const startNewImportBtn = document.getElementById("start-new-import-btn");
const listsNameInput = document.getElementById("lists-name");
const listsDescriptionInput = document.getElementById("lists-description");
const listsSelectAllBtn = document.getElementById("lists-select-all-btn");
const createListBtn = document.getElementById("create-list-btn");
const addExistingListBtn = document.getElementById("add-existing-list-btn");
const existingListPicker = document.getElementById("existing-list-picker");
const existingListSelect = document.getElementById("existing-list-select");
const cancelAddExistingBtn = document.getElementById("cancel-add-existing-btn");
const confirmAddExistingBtn = document.getElementById("confirm-add-existing-btn");
const apolloExportListSelect = document.getElementById("apollo-export-list-select");
const apolloExportSummary = document.getElementById("apollo-export-summary");
const apolloExportGenerateBtn = document.getElementById("apollo-export-generate-btn");
const apolloExportFileRow = document.getElementById("apollo-export-file-row");
const apolloExportFileChip = document.getElementById("apollo-export-file-chip");
const apolloExportFileName = document.getElementById("apollo-export-file-name");
const apolloExportDownloadLink = document.getElementById("apollo-export-download-link");

const LIST_SESSION_STORAGE_KEY = "bliListImportSession";
// leadsByUrl is a plain object (not a Map) — chrome.storage.session values
// are JSON-serialized, so a Map wouldn't survive a save/reload round trip.
// excludedUrls tracks leads the xDR unchecked before sending -- a plain
// array (not a Set) for the same JSON-serialization reason leadsByUrl is a
// plain object. Everything captured defaults to included; unchecking a row
// adds its salesNavLeadUrl here rather than removing it from leadsByUrl, so
// re-checking it later doesn't need to re-scrape anything.
let listImportSession = { listUrl: null, listName: null, listDescription: null, pages: 1, leadsByUrl: {}, excludedUrls: [] };
let currentListUrl = null; // tracks the list URL independently of currentProfileUrl/currentPostUrl

// Live-confirmed a Sales Nav list page's tab title looks like
// "{List Name} | Lead Lists | Sales Navigator" -- taking just the first
// "|"-delimited segment is more robust than trying to strip every possible
// suffix LinkedIn might append (the previous suffix-stripping version left
// "| Lead Lists" in the name since it only stripped the trailing
// "| Sales Navigator" part).
function deriveSalesNavListName(rawTitle) {
  if (!rawTitle) return "Sales Navigator List";
  const firstSegment = rawTitle.split("|")[0].trim();
  return firstSegment || "Sales Navigator List";
}

// Search-results pages have no name to read off the page the way a saved
// list's tab title contains the list's actual name -- generate a
// deterministic, human-readable name from the current date/time instead.
function deriveSalesNavSearchName() {
  const now = new Date();
  const date = now.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Sales Nav Search — ${date}, ${time}`;
}

async function loadListImportSession() {
  try {
    const stored = await chrome.storage.session.get([LIST_SESSION_STORAGE_KEY]);
    if (stored?.[LIST_SESSION_STORAGE_KEY]) {
      listImportSession = stored[LIST_SESSION_STORAGE_KEY];
      // A session saved before excludedUrls existed won't have it -- default
      // it in rather than let every `.includes(...)` call below throw.
      if (!Array.isArray(listImportSession.excludedUrls)) listImportSession.excludedUrls = [];
      if (listImportSession.listDescription === undefined) listImportSession.listDescription = null;
    }
  } catch {
    // chrome.storage.session may be unavailable in some contexts — fall
    // back to the in-memory default; a closed/reopened panel just starts
    // a fresh session in that case instead of resuming one.
  }
  renderListsTab();
}
loadListImportSession();

function saveListImportSession() {
  try {
    chrome.storage.session.set({ [LIST_SESSION_STORAGE_KEY]: listImportSession });
  } catch {
    // best-effort
  }
}

function resetListImportSession(listUrl, listName, listDescription) {
  listImportSession = { listUrl, listName, listDescription: listDescription ?? null, pages: 1, leadsByUrl: {}, excludedUrls: [] };
  saveListImportSession();
  renderListsTab();
}

// Merges newly-scraped rows into the accumulator, deduped by salesNavLeadUrl
// (a lead already captured on an earlier page is simply overwritten with
// the same data, not duplicated). Returns true if any genuinely new lead
// was added, so the caller can decide whether to bump the page counter.
function mergeLeadRows(rows) {
  let addedAny = false;
  for (const row of rows) {
    if (!row.salesNavLeadUrl) continue;
    if (!listImportSession.leadsByUrl[row.salesNavLeadUrl]) addedAny = true;
    listImportSession.leadsByUrl[row.salesNavLeadUrl] = row;
  }
  saveListImportSession();
  renderListsTab();
  return addedAny;
}

function isLeadExcluded(lead) {
  return listImportSession.excludedUrls.includes(lead.salesNavLeadUrl);
}

function toggleLeadExcluded(salesNavLeadUrl) {
  const idx = listImportSession.excludedUrls.indexOf(salesNavLeadUrl);
  if (idx === -1) listImportSession.excludedUrls.push(salesNavLeadUrl);
  else listImportSession.excludedUrls.splice(idx, 1);
  saveListImportSession();
  renderListsTab();
}

function renderListsTab() {
  if (!listsCount) return;

  // Don't stomp the field while the xDR is actively typing in it -- this
  // fires on every scrape/merge, which would otherwise reset the cursor
  // position (or the draft text itself) mid-keystroke.
  if (listsNameInput && document.activeElement !== listsNameInput) {
    listsNameInput.value = listImportSession.listName || "";
  }
  if (listsDescriptionInput && document.activeElement !== listsDescriptionInput) {
    listsDescriptionInput.value = listImportSession.listDescription || "";
  }

  const leads = Object.values(listImportSession.leadsByUrl);
  const includedCount = leads.filter((l) => !isLeadExcluded(l)).length;
  const selectedNote = includedCount === leads.length ? "" : ` (${includedCount} selected)`;
  listsCount.textContent = `${leads.length} lead${leads.length === 1 ? "" : "s"} captured across ${listImportSession.pages} page${listImportSession.pages === 1 ? "" : "s"}${selectedNote}`;

  if (listsSelectAllBtn) {
    listsSelectAllBtn.style.display = leads.length === 0 ? "none" : "";
    listsSelectAllBtn.textContent = includedCount === leads.length ? "Deselect all" : "Select all";
  }

  listsLeadsEl.innerHTML = "";
  if (leads.length === 0) {
    listsLeadsEl.appendChild(listsEmpty);
  } else {
    for (const lead of leads) {
      const excluded = isLeadExcluded(lead);
      const row = document.createElement("div");
      row.className = `list-lead-row${excluded ? " excluded" : ""}`;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "list-lead-check";
      checkbox.checked = !excluded;
      checkbox.addEventListener("change", () => toggleLeadExcluded(lead.salesNavLeadUrl));
      row.appendChild(checkbox);

      const info = document.createElement("div");
      info.className = "list-lead-info";

      const nameEl = document.createElement("div");
      nameEl.className = "list-lead-name";
      nameEl.textContent = lead.name || "—";
      info.appendChild(nameEl);

      if (lead.headline || lead.company) {
        const chips = document.createElement("div");
        chips.className = "list-lead-chips";

        if (lead.headline) {
          const titleChip = document.createElement("span");
          titleChip.className = "list-lead-title-chip";
          titleChip.textContent = lead.headline;
          chips.appendChild(titleChip);
        }

        if (lead.company) {
          const companyChip = document.createElement("span");
          companyChip.className = "list-lead-company-chip";
          companyChip.textContent = lead.company;
          chips.appendChild(companyChip);
        }

        info.appendChild(chips);
      }

      row.appendChild(info);
      listsLeadsEl.appendChild(row);
    }
  }
  if (createListBtn) createListBtn.disabled = includedCount === 0;
  if (addExistingListBtn) addExistingListBtn.disabled = includedCount === 0;
}

// Scrapes whatever page is currently loaded (one page, no pagination of its
// own) and starts content.js's MutationObserver so subsequent manual page
// turns get picked up without the panel needing to poll.
async function scrapeCurrentListPage(tabId) {
  try {
    let result;
    try {
      result = await chrome.tabs.sendMessage(tabId, { type: "SCRAPE_SALES_NAV_LIST_ROWS" });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      result = await chrome.tabs.sendMessage(tabId, { type: "SCRAPE_SALES_NAV_LIST_ROWS" });
    }
    if (result?.ok && result.rows?.length) {
      mergeLeadRows(result.rows);
    }
    await chrome.tabs.sendMessage(tabId, { type: "START_WATCHING_SALES_NAV_LIST" }).catch(() => {});

    // Temporary troubleshooting aid while the search-results row selectors
    // are still being confirmed live -- logs to THIS panel's own devtools
    // console (right-click the panel -> Inspect), not the LinkedIn tab's,
    // so there's no isolated-world context to hunt for. Safe to remove once
    // the selectors are confirmed stable.
    chrome.tabs.sendMessage(tabId, { type: "DIAGNOSE_SALES_NAV_LIST" })
      .then((diag) => { if (diag?.ok) console.log("[BLI panel] Sales Nav list diagnostic:", diag); })
      .catch(() => {});
  } catch {
    listsStatus.textContent = "Could not read this list. Make sure you're on a Sales Navigator saved lead list.";
  }
}

// content.js pushes here whenever its MutationObserver sees the DOM change
// after the xDR clicks "Next" themselves in Sales Nav.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SALES_NAV_LIST_ROWS_UPDATED" && msg.rows) {
    const addedAny = mergeLeadRows(msg.rows);
    if (addedAny) {
      listImportSession.pages += 1;
      saveListImportSession();
      renderListsTab();
    }
  }
});

function includedLeadsCount() {
  return Object.values(listImportSession.leadsByUrl).filter((l) => !isLeadExcluded(l)).length;
}

// Shared send path for both "Create List" and "Add to Existing List" --
// existingListId set means append (server skips creating a new lead_lists
// row and ignores listDescription); omitted means create a new list.
async function sendImport({ existingListId } = {}) {
  const leads = Object.values(listImportSession.leadsByUrl).filter((l) => !isLeadExcluded(l));
  if (leads.length === 0) return false;
  listsStatus.textContent = "";

  const listName = (listsNameInput?.value || listImportSession.listName || "").trim() || "Sales Navigator List";
  const listDescription = (listsDescriptionInput?.value || "").trim() || null;

  const result = await chrome.runtime.sendMessage({
    type: "IMPORT_SALES_NAV_LIST",
    listName,
    listDescription: existingListId ? null : listDescription,
    listUrl: listImportSession.listUrl,
    existingListId: existingListId || null,
    leads,
  }).catch((err) => ({ ok: false, error: err.message }));

  // result.ok only reflects the HTTP call succeeding — the action itself can
  // return a normal 200 response with an `error` field set (e.g. rate
  // limited) and listId empty, so a successful import needs both ok AND a
  // real listId, not just ok.
  if (result?.ok && result.listId && !result.error) {
    const dupeNote = result.duplicatesSkipped
      ? ` (${result.duplicatesSkipped} already in your lists, skipped)`
      : "";
    const skippedNote = listImportSession.excludedUrls.length
      ? ` (${listImportSession.excludedUrls.length} deselected, not sent)`
      : "";
    const destNote = existingListId ? "Added to your list." : "Find it in the Lead Lists tab.";
    listsStatus.textContent = `Imported ${result.totalCount} lead${result.totalCount === 1 ? "" : "s"}${dupeNote}${skippedNote}${result.truncated ? " (list was capped at 500)" : ""}. ${destNote}`;
    resetListImportSession(listImportSession.listUrl, listImportSession.listName);
    return true;
  }

  listsStatus.textContent = result?.error || "Import failed.";
  return false;
}

createListBtn?.addEventListener("click", async () => {
  if (includedLeadsCount() === 0) return;
  createListBtn.disabled = true;
  if (addExistingListBtn) addExistingListBtn.disabled = true;
  createListBtn.textContent = "Creating…";
  await sendImport();
  createListBtn.textContent = "＋ Create List";
  renderListsTab();
});

addExistingListBtn?.addEventListener("click", async () => {
  if (includedLeadsCount() === 0 || !existingListPicker || !existingListSelect) return;
  existingListPicker.style.display = "flex";
  existingListSelect.innerHTML = "";
  const loadingOpt = document.createElement("option");
  loadingOpt.textContent = "Loading your lists…";
  existingListSelect.appendChild(loadingOpt);
  if (confirmAddExistingBtn) confirmAddExistingBtn.disabled = true;

  const result = await chrome.runtime
    .sendMessage({ type: "LIST_LEAD_LISTS" })
    .catch((err) => ({ ok: false, error: err.message, lists: [] }));
  const lists = result?.lists || [];

  existingListSelect.innerHTML = "";
  if (!result?.ok || lists.length === 0) {
    const emptyOpt = document.createElement("option");
    emptyOpt.textContent = result?.ok ? "No existing lists yet" : "Could not load lists";
    existingListSelect.appendChild(emptyOpt);
    return;
  }
  // Build options with textContent (not innerHTML) to avoid XSS from list names.
  lists.forEach((l) => {
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = `${l.name} (${l.totalCount} lead${l.totalCount === 1 ? "" : "s"})`;
    existingListSelect.appendChild(opt);
  });
  if (confirmAddExistingBtn) confirmAddExistingBtn.disabled = false;
});

cancelAddExistingBtn?.addEventListener("click", () => {
  if (existingListPicker) existingListPicker.style.display = "none";
});

confirmAddExistingBtn?.addEventListener("click", async () => {
  const existingListId = existingListSelect?.value;
  if (!existingListId) return;
  confirmAddExistingBtn.disabled = true;
  confirmAddExistingBtn.textContent = "Adding…";
  await sendImport({ existingListId });
  confirmAddExistingBtn.textContent = "Add to List";
  if (existingListPicker) existingListPicker.style.display = "none";
  renderListsTab();
});

startNewImportBtn.addEventListener("click", () => {
  resetListImportSession(currentListUrl, listImportSession.listName);
  listsStatus.textContent = "";
});

listsNameInput?.addEventListener("input", () => {
  listImportSession.listName = listsNameInput.value;
  saveListImportSession();
});

listsDescriptionInput?.addEventListener("input", () => {
  listImportSession.listDescription = listsDescriptionInput.value;
  saveListImportSession();
});

listsSelectAllBtn?.addEventListener("click", () => {
  const leads = Object.values(listImportSession.leadsByUrl);
  const allSelected = leads.every((l) => !isLeadExcluded(l));
  listImportSession.excludedUrls = allSelected ? leads.map((l) => l.salesNavLeadUrl) : [];
  saveListImportSession();
  renderListsTab();
});

tabListsBtn?.addEventListener("click", () => switchTab("lists"));

// ── Export a saved list to Apollo (CSV) ──────────────────────────────
// This workspace's Apollo API key has no write scope (contacts/create,
// contacts/search, and list-write all live-confirmed 403 API_INACCESSIBLE)
// -- so instead of pushing through Apollo's API, this builds a CSV
// client-side and lets the rep drag it straight onto Apollo's own
// "Import by CSV" drop zone, a normal Apollo product feature that needs
// no API scope at all, only a logged-in Apollo session.

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function splitLeadName(name) {
  if (!name) return { first: "", last: "" };
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function buildApolloCsv(items) {
  const header = ["First Name", "Last Name", "Company", "Title", "Email", "Phone", "LinkedIn Url", "Location"];
  const rows = items.map((item) => {
    const { first, last } = splitLeadName(item.name);
    return [
      first,
      last,
      item.company || "",
      item.enrichedTitle || item.headline || "",
      item.enrichedEmail || "",
      item.enrichedPhone || "",
      item.enrichedLinkedinUrl || item.salesNavLeadUrl || "",
      item.location || "",
    ].map(csvEscape).join(",");
  });
  return [header.join(","), ...rows].join("\r\n");
}

async function loadApolloExportListOptions() {
  if (!apolloExportListSelect) return;
  const result = await chrome.runtime
    .sendMessage({ type: "LIST_LEAD_LISTS" })
    .catch((err) => ({ ok: false, error: err.message, lists: [] }));
  const lists = result?.lists || [];
  apolloExportListSelect.innerHTML = "";

  if (!result?.ok || lists.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = result?.ok ? "No saved lists yet" : "Could not load lists";
    apolloExportListSelect.appendChild(opt);
    if (apolloExportGenerateBtn) apolloExportGenerateBtn.disabled = true;
    return;
  }

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a list…";
  apolloExportListSelect.appendChild(placeholder);
  // Build options with textContent (not innerHTML) to avoid XSS from list names.
  lists.forEach((l) => {
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = `${l.name} (${l.totalCount} lead${l.totalCount === 1 ? "" : "s"})`;
    apolloExportListSelect.appendChild(opt);
  });
}
loadApolloExportListOptions();

let apolloExportBlobUrl = null;

apolloExportListSelect?.addEventListener("change", async () => {
  const listId = apolloExportListSelect.value;
  if (apolloExportFileRow) apolloExportFileRow.style.display = "none";
  if (!listId) {
    if (apolloExportSummary) { apolloExportSummary.textContent = ""; apolloExportSummary.className = ""; }
    if (apolloExportGenerateBtn) apolloExportGenerateBtn.disabled = true;
    return;
  }
  if (apolloExportGenerateBtn) apolloExportGenerateBtn.disabled = false;
  if (apolloExportSummary) {
    apolloExportSummary.textContent = "Summarizing…";
    apolloExportSummary.className = "loading";
  }
  const result = await chrome.runtime.sendMessage({ type: "SUMMARIZE_LEAD_LIST", listId }).catch(() => null);
  if (apolloExportSummary) {
    apolloExportSummary.className = "";
    apolloExportSummary.textContent = result?.summary || "";
  }
});

apolloExportGenerateBtn?.addEventListener("click", async () => {
  const listId = apolloExportListSelect?.value;
  if (!listId) return;
  apolloExportGenerateBtn.disabled = true;
  apolloExportGenerateBtn.textContent = "Generating…";

  const result = await chrome.runtime
    .sendMessage({ type: "GET_LEAD_LIST_ITEMS", listId })
    .catch((err) => ({ ok: false, error: err.message }));

  apolloExportGenerateBtn.textContent = "Generate CSV";
  apolloExportGenerateBtn.disabled = false;

  if (!result?.ok || !result.list || !result.items?.length) {
    if (apolloExportSummary) {
      apolloExportSummary.className = "";
      apolloExportSummary.textContent = result?.error || "Could not load this list's leads.";
    }
    return;
  }

  const csv = buildApolloCsv(result.items);
  const safeName = result.list.name.replace(/[^a-z0-9 _-]/gi, "").trim() || "leads";
  const filename = `${safeName}.csv`;

  if (apolloExportBlobUrl) URL.revokeObjectURL(apolloExportBlobUrl);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  apolloExportBlobUrl = URL.createObjectURL(blob);

  if (apolloExportDownloadLink) {
    apolloExportDownloadLink.href = apolloExportBlobUrl;
    apolloExportDownloadLink.download = filename;
  }
  if (apolloExportFileName) apolloExportFileName.textContent = filename;
  if (apolloExportFileRow) apolloExportFileRow.style.display = "flex";

  // Lets the file chip be dragged directly out of this panel onto another
  // tab's native file-drop zone -- the same "DownloadURL" trick Gmail uses
  // to let you drag an attachment onto the desktop or into another app.
  // Must be computed synchronously (not via FileReader) since dataTransfer
  // can only be written inside the dragstart event, not in an async
  // callback that fires after it. Untested from a Chrome side panel
  // specifically -- the Download link above is a guaranteed-to-work
  // fallback if this doesn't carry over from this surface.
  const base64Csv = btoa(unescape(encodeURIComponent(csv)));
  const dataUrl = `data:text/csv;charset=utf-8;base64,${base64Csv}`;
  if (apolloExportFileChip) {
    apolloExportFileChip.ondragstart = (e) => {
      e.dataTransfer.setData("DownloadURL", `text/csv:${filename}:${dataUrl}`);
      e.dataTransfer.effectAllowed = "copy";
    };
  }
});

// Extend the existing init and URL polling to handle post pages.
// Patch: after the URL polling loop detects a new URL, also handle post pages.
// We do this by overriding the urlPollTimer logic to check isPostUrl.
const _origStartUrlPolling = startUrlPolling;

function startUrlPollingWithEngagers() {
  if (urlPollTimer) clearInterval(urlPollTimer);
  urlPollTimer = setInterval(async () => {
    if (isInitializing) return;
    let tab;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch { return; }
    if (!tab) return;
    const url = tab.url || "";
    const cleanUrl = url.split("?")[0];

    if (isProfileUrl(url)) {
      // Show Profile tab; hide Engagers tab from switcher focus but keep switcher visible
      tabSwitcher.style.display = "flex";
      // Raw-tab-URL comparison — see startUrlPolling for why.
      if (cleanUrl !== currentTabUrl) {
        isInitializing = true;
        resetPanel();
        switchTab("profile");
        init({ navTriggered: true }).finally(() => { isInitializing = false; });
      }
    } else if (isPostUrl(url)) {
      // Keep tab switcher visible on every tick; only switch tab and load on URL change.
      // Use currentPostUrl (not currentProfileUrl) so a resetPanel() triggered by a
      // background LinkedIn profile tab doesn't cause a spurious rescan.
      tabSwitcher.style.display = "flex";
      if (cleanUrl !== currentPostUrl) {
        if (currentPostUrl && currentPostUrl !== cleanUrl) {
          // Moving to a genuinely different post — clear previous enrichment state.
          loadedIds = {};
        }
        currentPostUrl = cleanUrl;
        currentProfileUrl = cleanUrl;
        currentTabUrl = cleanUrl;
        notLinkedin.style.display = "none";
        mainContent.style.display = "none";
        switchTab("engagers");
        loadEngagersTab(tab.id);
      } else {
        // Same post — user may have just switched back from another tab.
        // Restore UI without reloading or re-scraping.
        notLinkedin.style.display = "none";
        switchTab("engagers");
      }
    } else if (isSalesNavListUrl(url)) {
      // Keep tab switcher visible; only reset the accumulator and rescan on
      // a genuinely different list URL. Use currentListUrl (not
      // currentProfileUrl) for the same reason the post branch uses
      // currentPostUrl — a background profile tab shouldn't spuriously
      // reset an in-progress list import.
      tabSwitcher.style.display = "flex";
      if (cleanUrl !== currentListUrl) {
        currentListUrl = cleanUrl;
        currentProfileUrl = cleanUrl;
        currentTabUrl = cleanUrl;
        notLinkedin.style.display = "none";
        mainContent.style.display = "none";
        switchTab("lists");
        // Compare against the SESSION's tracked list URL (persisted via
        // chrome.storage.session, so it survives a closed/reopened panel),
        // not just the in-memory currentListUrl above -- that variable
        // always starts null on a fresh panel load, so comparing only
        // against it can't tell "this is genuinely a new list" from
        // "resuming the same list I was just on," and was silently keeping
        // a previous list's already-captured leads around when the xDR
        // opened a different Sales Nav list in a fresh panel.
        if (!listImportSession.listUrl || listImportSession.listUrl !== cleanUrl) {
          const derivedName = isSalesNavSearchUrl(cleanUrl)
            ? deriveSalesNavSearchName()
            : deriveSalesNavListName(tab.title);
          resetListImportSession(cleanUrl, derivedName);
        }
        listsStatus.textContent = "";
        scrapeCurrentListPage(tab.id);
      } else {
        // Same list — user may have switched tabs and come back, or the
        // content script instance may have been torn down (e.g. a full page
        // reload between pagination pages, not an SPA route swap). Rescan
        // and re-arm the observer either way; mergeLeadRows is additive-only
        // so this is safe to call repeatedly.
        notLinkedin.style.display = "none";
        switchTab("lists");
        scrapeCurrentListPage(tab.id);
      }
    } else if (isApolloUrl(url)) {
      // On Apollo: keep the tab switcher visible and stay on/switch to the
      // Lists tab so the "Export a saved list to Apollo" section (and the
      // file the rep is about to drag in) is reachable. Nothing here reads
      // the Apollo page itself, so no scraping/session state to touch.
      tabSwitcher.style.display = "flex";
      notLinkedin.style.display = "none";
      mainContent.style.display = "none";
      switchTab("lists");
    } else {
      // Non-LinkedIn page: hide tab switcher, show not-LinkedIn message.
      // currentPostUrl/currentListUrl are intentionally NOT cleared here so
      // returning to the same post/list tab won't trigger a redundant reset.
      tabSwitcher.style.display = "none";
      switchTab("profile");
      if (currentProfileUrl) {
        currentProfileUrl = null;
        currentTabUrl = null;
        notLinkedin.style.display = "block";
        mainContent.style.display = "none";
      }
    }
  }, 750);
}

// Replace the polling start call in the boot sequence.
// Note: panel.js calls `startUrlPolling()` in two places (after init() and after token save).
// We shadow the function name so those calls use the new version.
startUrlPolling = startUrlPollingWithEngagers;
