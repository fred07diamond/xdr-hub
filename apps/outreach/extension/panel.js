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
const thumbUpBtn = document.getElementById("thumb-up-btn");
const thumbDownBtn = document.getElementById("thumb-down-btn");
const feedbackForm = document.getElementById("feedback-form");
const feedbackMessage = document.getElementById("feedback-message");
const feedbackSkipBtn = document.getElementById("feedback-skip-btn");
const feedbackSubmitBtn = document.getElementById("feedback-submit-btn");
const feedbackThanks = document.getElementById("feedback-thanks");

let currentProfileUrl = null;
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
  if (data.role && data.company && data.role !== data.company) {
    profileMeta.innerHTML = `<span class="meta-chip role-chip">${data.role}</span><span class="meta-chip company-chip">${data.company}</span>`;
  } else if (data.company) {
    profileMeta.innerHTML = `<span class="meta-chip company-chip">${data.company}</span>`;
  } else if (data.role) {
    profileMeta.innerHTML = `<span class="meta-chip role-chip">${data.role}</span>`;
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
  dailyMeter.style.display = "none";
  draftBtn.disabled = true;
  draftBtn.textContent = "Draft note";
  setStatus("");
  verdictSection.style.display = "none";
  personaChip.style.display = "none";
  autoConnectBtn.disabled = false;
  autoConnectBtn.textContent = "Connect & send";
  autoConnectBtn.classList.remove("success");

  resetFeedbackSection();
  feedbackSection.style.display = "none";
}

// ── Init: scrape immediately on open ────────────────────────────────────────

async function init({ navTriggered = false } = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || "";

  if (!isProfileUrl(url)) {
    notLinkedin.style.display = "block";
    mainContent.style.display = "none";
    return;
  }

  currentProfileUrl = url.split("?")[0];
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
  autoModeToggle.checked = result.autoMode !== false; // default ON
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
      renderProfileCard(scrapeData);
    }

    setStatus("Sending to Builder.LI… (the agent is drafting, this takes ~30s)");

    const result = await chrome.runtime.sendMessage({
      type: "DRAFT_REQUEST",
      data: scrapeData,
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
    const newProfileUrl = url.split("?")[0];
    if (isProfileUrl(url) && newProfileUrl !== currentProfileUrl) {
      isInitializing = true;
      resetPanel();
      init({ navTriggered: true }).finally(() => { isInitializing = false; });
    } else if (!isProfileUrl(url) && currentProfileUrl) {
      currentProfileUrl = null;
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
