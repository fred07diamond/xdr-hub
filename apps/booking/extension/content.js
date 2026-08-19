// Nooks Capture content script.
//
// UNVERIFIED AGAINST A REAL NOOKS SESSION -- every selector/heuristic below
// is a best-effort placeholder written from general SPA conventions, not
// from a captured real page. Before relying on this, load a real Nooks call
// page, inspect it, and correct:
//   1. isOnNooksCallPage() / isCallEnded() -- the actual URL/DOM shape of an
//      active call vs. the post-call/disposition screen.
//   2. getCallId() -- where the real call ID actually lives.
//   3. getTranscriptContainer() -- the real transcript panel's selector, and
//      whether it lazy-loads on scroll or is fully rendered up front.
// Never auto-click Nooks' own UI controls (buttons, disposition pickers,
// etc.) -- scrolling the read-only transcript panel to load more text is
// the one automated interaction this script performs, since it doesn't
// mutate anything Nooks-side.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isOnNooksCallPage() {
  return /\/calls?\//i.test(location.pathname);
}

function isCallEnded() {
  // Placeholder heuristics -- refine against a real post-call screen.
  if (/summary|disposition|ended|wrap-?up/i.test(location.pathname)) return true;
  const text = document.body?.innerText ?? "";
  return /call ended|disposition|wrap[\s-]?up/i.test(text.slice(0, 2000));
}

function getCallId() {
  // 1. URL path segment: /calls/<id> or /call/<id>
  const pathMatch = location.pathname.match(/\/calls?\/([a-z0-9-]+)/i);
  if (pathMatch && UUID_RE.test(pathMatch[1])) return pathMatch[1];

  // 2. Query param
  const qsId = new URLSearchParams(location.search).get("callId");
  if (qsId && UUID_RE.test(qsId)) return qsId;

  // 3. A data-call-id attribute anywhere on the page
  const el = document.querySelector("[data-call-id]");
  const attrId = el?.getAttribute("data-call-id");
  if (attrId && UUID_RE.test(attrId)) return attrId;

  // 4. SPA hydration state -- walk common globals for a UUID-shaped callId.
  const globals = [window.__NEXT_DATA__, window.__INITIAL_STATE__, window.__NUXT__];
  for (const g of globals) {
    const found = findUuidField(g, "callId", 0);
    if (found) return found;
  }

  return null;
}

function findUuidField(obj, key, depth) {
  if (!obj || typeof obj !== "object" || depth > 6) return null;
  if (typeof obj[key] === "string" && UUID_RE.test(obj[key])) return obj[key];
  for (const k of Object.keys(obj)) {
    try {
      const found = findUuidField(obj[k], key, depth + 1);
      if (found) return found;
    } catch {
      // Cross-origin/getter-throwing properties -- skip.
    }
  }
  return null;
}

function getTranscriptContainer() {
  // Placeholder candidate selectors, tried in order.
  const candidates = [
    '[data-testid*="transcript" i]',
    '[aria-label*="transcript" i]',
    ".transcript",
    "#transcript",
  ];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el) return el;
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
