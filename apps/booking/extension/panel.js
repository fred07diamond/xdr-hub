const APP_URL = "https://xdr-hub.netlify.app/booking";
const POLL_INTERVAL_MS = 2000;

const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

const views = {
  loading: document.getElementById("view-loading"),
  notNooks: document.getElementById("view-not-nooks"),
  noToken: document.getElementById("view-no-token"),
  inCall: document.getElementById("view-in-call"),
  notConnected: document.getElementById("view-not-connected"),
  ready: document.getElementById("view-ready"),
  sending: document.getElementById("view-sending"),
  done: document.getElementById("view-done"),
  error: document.getElementById("view-error"),
};

const aeSelect = document.getElementById("ae-select");
const findTimeBtn = document.getElementById("find-time-btn");
const timePickerBox = document.getElementById("time-picker-box");
const pickerDateInput = document.getElementById("picker-date");
const pickerTimezoneSelect = document.getElementById("picker-timezone");
const showTimesBtn = document.getElementById("show-times-btn");
const availabilityMessage = document.getElementById("availability-message");
const slotSelect = document.getElementById("slot-select");
const slotSummary = document.getElementById("slot-summary");

function showView(name) {
  for (const key of Object.keys(views)) {
    views[key].style.display = key === name ? "block" : "none";
  }
}

let currentTabId = null;
let currentCallId = null;
let currentTranscript = null;
let currentTruncated = false;
let currentDisposition = null;
let pickedMeetingDatetimeISO = null;
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
  } catch (firstErr) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (secondErr) {
      // Surface the actual failure instead of a bare null -- this is what
      // showed up as an opaque "couldn't read the transcript" with no way
      // to tell a messaging failure apart from an empty scrape result.
      return { __messagingError: `${firstErr?.message ?? firstErr} / ${secondErr?.message ?? secondErr}` };
    }
  }
}

function sendToBackground(type, data) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, data }, (response) => resolve(response));
  });
}

function resetTimePicker() {
  pickedMeetingDatetimeISO = null;
  timePickerBox.style.display = "none";
  slotSummary.style.display = "none";
  availabilityMessage.style.display = "none";
  slotSelect.style.display = "none";
  slotSelect.innerHTML = '<option value="">Pick a time…</option>';
  pickerDateInput.value = new Date().toISOString().slice(0, 10);
}

async function loadAccountExecutives() {
  const response = await sendToBackground("LIST_ACCOUNT_EXECUTIVES", {});
  aeSelect.innerHTML = '<option value="">-- Select AE --</option>';
  if (!response || !response.ok || !response.aes) return;
  for (const email of response.aes) {
    const opt = document.createElement("option");
    opt.value = email;
    opt.textContent = email;
    aeSelect.appendChild(opt);
  }
}

async function handleShowTimes() {
  availabilityMessage.style.display = "none";
  slotSelect.style.display = "none";
  if (!aeSelect.value) {
    availabilityMessage.textContent = "Select an AE first.";
    availabilityMessage.style.display = "block";
    return;
  }
  showTimesBtn.disabled = true;
  showTimesBtn.textContent = "Loading…";
  const response = await sendToBackground("GET_AE_AVAILABILITY", {
    aeEmail: aeSelect.value,
    date: pickerDateInput.value,
    timezone: pickerTimezoneSelect.value,
  });
  showTimesBtn.disabled = false;
  showTimesBtn.textContent = "Show available times";

  if (!response || !response.ok) {
    availabilityMessage.textContent = response?.error || "Couldn't load availability.";
    availabilityMessage.style.display = "block";
    return;
  }
  if (!response.connected) {
    availabilityMessage.textContent = response.reason === "no_calendar_scope"
      ? "Can't view this AE's calendar (not shared with you). Pick a time manually with them instead."
      : `Couldn't load this AE's calendar (${response.reason ?? "unknown reason"}).`;
    availabilityMessage.style.display = "block";
    return;
  }
  if (!response.slots || response.slots.length === 0) {
    availabilityMessage.textContent = "No open slots that day -- try another date.";
    availabilityMessage.style.display = "block";
    return;
  }

  slotSelect.innerHTML = '<option value="">Pick a time…</option>';
  for (const iso of response.slots) {
    const opt = document.createElement("option");
    opt.value = iso;
    opt.textContent = new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: pickerTimezoneSelect.value,
    });
    slotSelect.appendChild(opt);
  }
  slotSelect.style.display = "block";
}

function handleSlotPicked() {
  if (!slotSelect.value) return;
  pickedMeetingDatetimeISO = slotSelect.value;
  const label = new Date(pickedMeetingDatetimeISO).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: pickerTimezoneSelect.value,
  });
  slotSummary.textContent = `Will book: ${label} (${pickerTimezoneSelect.value.replace(/_/g, " ")})`;
  slotSummary.style.display = "block";
  timePickerBox.style.display = "none";
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
  if (state && state.__messagingError) {
    showError("Couldn't talk to the Nooks page.", refresh, state);
    return;
  }
  if (!state || !state.onCallPage) {
    showView("notNooks");
    return;
  }

  if (!state.callEnded) {
    showView("inCall");
    return;
  }

  currentDisposition = state.disposition;
  if (!state.isConnectedMeeting) {
    document.getElementById("not-connected-disposition").textContent = state.disposition || "unknown";
    showView("notConnected");
    return;
  }

  currentCallId = state.callId;
  if (!currentCallId) {
    showError("Couldn't find a call ID on this page. Try refreshing the Nooks tab.", refresh, state);
    return;
  }

  const transcriptResult = await sendToContentScript(tab.id, { type: "SCRAPE_TRANSCRIPT" });
  if (!transcriptResult || transcriptResult.__messagingError || !transcriptResult.text) {
    showError("Couldn't read the transcript from this page.", refresh, { state, transcriptResult });
    return;
  }

  currentTranscript = transcriptResult.text;
  currentTruncated = !!transcriptResult.truncated;

  document.getElementById("truncated-warning").style.display = currentTruncated ? "block" : "none";
  document.getElementById("transcript-preview").textContent = currentTranscript.slice(0, 500) + (currentTranscript.length > 500 ? "…" : "");
  document.getElementById("char-count").textContent = `${currentTranscript.length} characters captured`;
  showView("ready");
}

function showError(message, onRetry = handleSend, debugData = null) {
  document.getElementById("error-message").textContent = message;
  retryAction = onRetry;
  const debugEl = document.getElementById("debug-details");
  if (debugData) {
    debugEl.textContent = JSON.stringify(debugData, null, 2);
    debugEl.style.display = "block";
  } else {
    debugEl.style.display = "none";
  }
  showView("error");
}

async function handleSend() {
  if (!currentCallId || !currentTranscript) return;
  showView("sending");

  const response = await sendToBackground("CAPTURE_TRANSCRIPT", {
    nooksCallId: currentCallId,
    transcript: currentTranscript,
    disposition: currentDisposition,
    truncated: currentTruncated,
    aeEmail: aeSelect.value || undefined,
    meetingDatetime: pickedMeetingDatetimeISO || undefined,
  });

  if (!response || !response.ok) {
    showError(response?.error || "Something went wrong sending the transcript.");
    return;
  }
  const bits = ["Notes generated"];
  if (response.booking) bits.push("meeting booked on the calendar");
  else if (response.calendarBookingError) bits.push(`calendar booking failed (${response.calendarBookingError})`);
  document.getElementById("done-message").textContent = response.selfHealed
    ? `${bits.join(", ")} — matching to your Nooks record now.`
    : `${bits.join(", ")} and ready to review.`;
  document.getElementById("open-meeting-link").href = `${APP_URL}/meetings`;
  showView("done");
}

document.getElementById("send-btn").addEventListener("click", handleSend);
document.getElementById("retry-btn").addEventListener("click", () => retryAction());
document.getElementById("open-options-btn").addEventListener("click", () => chrome.runtime.openOptionsPage());
findTimeBtn.addEventListener("click", () => {
  timePickerBox.style.display = timePickerBox.style.display === "none" ? "block" : "none";
});
showTimesBtn.addEventListener("click", handleShowTimes);
slotSelect.addEventListener("change", handleSlotPicked);
aeSelect.addEventListener("change", () => {
  findTimeBtn.style.display = aeSelect.value ? "inline" : "none";
  if (!aeSelect.value) {
    timePickerBox.style.display = "none";
    slotSummary.style.display = "none";
    pickedMeetingDatetimeISO = null;
  }
});

// Timezone select setup
const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
for (const tz of Array.from(new Set([defaultTimezone, ...COMMON_TIMEZONES]))) {
  const opt = document.createElement("option");
  opt.value = tz;
  opt.textContent = tz.replace(/_/g, " ");
  pickerTimezoneSelect.appendChild(opt);
}
pickerTimezoneSelect.value = defaultTimezone;

resetTimePicker();
loadAccountExecutives();

showView("loading");
refresh();
pollTimer = setInterval(() => {
  // Don't yank the rep out of the sending/done/error/ready/notConnected
  // states with a background re-poll -- only refresh while we're waiting
  // to see if a call just ended, or after Send completes and the tab moves on.
  const activeView = Object.keys(views).find((k) => views[k].style.display === "block");
  if (activeView === "notNooks" || activeView === "inCall" || activeView === "loading") {
    refresh();
  }
}, POLL_INTERVAL_MS);
