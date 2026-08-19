// Nooks Capture content script.
//
// Detection here is grounded in a real captured call screen (2026-08-19):
// a persistent parallel-dialer view (not a page-per-call route -- the URL
// doesn't reliably change between calls), with a Dashboard/Activity/
// Battlecards/Transcript tab bar, a small "Ended" pill badge once a call
// finishes, and a Transcript tab showing speaker-turn blocks above an
// <audio> player. Nooks uses Twilio's Voice SDK under the hood -- the call's
// real ID is a Twilio Call SID (`CA` + 32 hex chars), visible directly in
// the recording URL the <audio> element's src points at
// (https://recording.nooks.in/<CallSid>...wav), NOT a UUID.
//
// Still not fully verified: whether a longer real call's transcript lazily
// loads more turns on scroll (only tested against a short 4-turn call so
// far), and the exact call-page URL shape (kept out of the page-detection
// signal entirely below, in favor of the tab bar + Ended badge, since the
// URL didn't reliably reflect call state in testing).
//
// Never auto-click Nooks' own UI controls (buttons, disposition pickers,
// etc.) -- scrolling the read-only transcript panel to load more text is
// the one automated interaction this script performs, since it doesn't
// mutate anything Nooks-side.

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CALL_SID_RE = /\bCA[0-9a-f]{32}\b/i;

function findTabBar() {
  const labels = ["Dashboard", "Activity", "Battlecards", "Transcript"];
  return [...document.querySelectorAll("*")].find((el) => {
    if (el.children.length < 3 || el.children.length > 8) return false;
    const childTexts = [...el.children].map((c) => c.textContent.trim());
    return labels.every((l) => childTexts.includes(l));
  }) ?? null;
}

function findEndedBadge() {
  return [...document.querySelectorAll("*")].find(
    (el) => el.children.length === 0 && /^ended$/i.test(el.textContent.trim()),
  ) ?? null;
}

function isOnNooksCallPage() {
  return !!findTabBar();
}

function isCallEnded() {
  return !!findEndedBadge();
}

function getCallId() {
  // 1. The <audio> player's src is the real recording URL and embeds the
  // Twilio Call SID directly -- the most reliable source found so far.
  for (const audio of document.querySelectorAll("audio")) {
    const match = (audio.currentSrc || audio.src || "").match(CALL_SID_RE);
    if (match) return match[0];
  }

  // 2. Any element/attribute containing a bare Call SID.
  const bodyMatch = (document.body?.innerHTML ?? "").match(CALL_SID_RE);
  if (bodyMatch) return bodyMatch[0];

  // 3. A data-call-id attribute anywhere on the page.
  const el = document.querySelector("[data-call-id]");
  const attrId = el?.getAttribute("data-call-id");
  if (attrId && (CALL_SID_RE.test(attrId) || UUID_RE.test(attrId))) return attrId;

  // 4. SPA hydration state -- walk common globals for a callId-shaped field.
  // Kept as a fallback: Nooks' dialer state looked Firestore-driven in
  // testing, so static hydration globals may not carry live call data.
  const globals = [window.__NEXT_DATA__, window.__INITIAL_STATE__, window.__NUXT__];
  for (const g of globals) {
    const found = findIdField(g, 0);
    if (found) return found;
  }

  return null;
}

function findIdField(obj, depth, seen = new Set()) {
  if (!obj || typeof obj !== "object" || depth > 6 || seen.has(obj)) return null;
  seen.add(obj);
  for (const k of Object.keys(obj)) {
    let v;
    try {
      v = obj[k];
    } catch {
      continue; // Cross-origin/getter-throwing properties -- skip.
    }
    if (typeof v === "string" && /call.?sid|call.?id/i.test(k) && (CALL_SID_RE.test(v) || UUID_RE.test(v))) {
      return v.match(CALL_SID_RE)?.[0] ?? v.match(UUID_RE)?.[0];
    }
    if (v && typeof v === "object") {
      const found = findIdField(v, depth + 1, seen);
      if (found) return found;
    }
  }
  return null;
}

const MIN_TRANSCRIPT_TEXT_LENGTH = 40;

function getTranscriptContainer() {
  // Explicit selector candidates first, in case a future Nooks redesign
  // adds one of these -- but only accept a match with real text. Live
  // testing found `[aria-label*="transcript" i]`/`[data-testid*="transcript" i]`
  // matches the Transcript TAB button itself (empty/near-empty innerText),
  // which was winning over the actual content below and always returning "".
  const candidates = [
    '[data-testid*="transcript" i]',
    '[aria-label*="transcript" i]',
    ".transcript",
    "#transcript",
  ];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el && el.innerText && el.innerText.trim().length > MIN_TRANSCRIPT_TEXT_LENGTH) return el;
  }

  // Observed real layout: speaker-turn blocks sit as siblings directly
  // above the <audio> player, both under one shared ancestor -- walk up
  // from the audio element until we find an ancestor whose text is
  // meaningfully longer than the audio row alone (i.e. it also contains
  // the turn text), capped at a few levels.
  const audio = document.querySelector("audio");
  if (audio) {
    let node = audio.parentElement;
    for (let i = 0; i < 5 && node; i++) {
      if (node.innerText && node.innerText.trim().length > MIN_TRANSCRIPT_TEXT_LENGTH) return node;
      node = node.parentElement;
    }
  }

  return null;
}

const MAX_SCROLL_ITERATIONS = 40;
const SCROLL_SETTLE_MS = 1500;

async function scrapeTranscript() {
  const container = getTranscriptContainer();
  if (!container) {
    // No known transcript container -- fall back to the full page's
    // visible text as a last resort, flagged as truncated since it's
    // almost certainly noisier/incomplete relative to a real container read.
    return { text: (document.body?.innerText ?? "").trim(), truncated: true };
  }

  let lastLength = container.innerText.length;
  let stableRounds = 0;
  let iterations = 0;

  while (iterations < MAX_SCROLL_ITERATIONS && stableRounds < 2) {
    container.scrollTop = container.scrollHeight;
    await new Promise((r) => setTimeout(r, SCROLL_SETTLE_MS));
    const newLength = container.innerText.length;
    if (newLength === lastLength) {
      stableRounds++;
    } else {
      stableRounds = 0;
      lastLength = newLength;
    }
    iterations++;
  }

  const truncated = iterations >= MAX_SCROLL_ITERATIONS;
  return { text: container.innerText.trim(), truncated };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "SCRAPE_CALL_STATE") {
    const onCallPage = isOnNooksCallPage();
    const callEnded = onCallPage && isCallEnded();
    sendResponse({
      onCallPage,
      callEnded,
      callId: onCallPage ? getCallId() : null,
      transcriptAvailable: !!getTranscriptContainer() || callEnded,
    });
    return; // synchronous
  }

  if (msg.type === "SCRAPE_TRANSCRIPT") {
    scrapeTranscript()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ text: "", truncated: true, error: err.message }));
    return true; // keep channel open for async response
  }
});
