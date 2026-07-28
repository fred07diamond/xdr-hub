// Selectors for fields not covered by the DOM top-card or Experience scrapers.
// Class-based selectors for name are kept as last-resort fallbacks only —
// LinkedIn rotates these hashes, so they fail silently; the main h1/h2 approach
// in scrapeProfile() is the primary name source.
const SELECTORS = {
  name: ["h1.text-heading-xlarge", "h1.break-words", "h1.t-24", "h1"],
  about: "#about ~ div span[aria-hidden='true']",
  recentActivity:
    ".artdeco-card .feed-shared-update-v2__description span[aria-hidden='true']",
};

// ── DOM experience scraper ───────────────────────────────────────────────────
// LinkedIn obfuscates and rotates class names with every deploy, so class-based
// selectors break silently. Two handles that are stable:
//   • #experience  — the URL-fragment anchor LinkedIn uses for direct linking
//   • span[aria-hidden="true"]  — accessibility attribute on all visible text nodes
// We collect the leaf spans from the first experience <li>, classify each string
// by its content (duration, date range, employment type, work setting, location),
// and infer role + company from what remains.
function scrapeExperienceFromDOM() {
  const anchor = document.querySelector("#experience");
  if (!anchor) return {};

  const section =
    anchor.closest("section") ||
    anchor.closest('[class*="pv-profile-card"]') ||
    anchor.parentElement?.parentElement;
  if (!section) return {};

  const firstLi = section.querySelector("li");
  if (!firstLi) return {};

  // Leaf spans only — skip container spans that wrap inner ones (avoids duplicates)
  const texts = Array.from(firstLi.querySelectorAll('span[aria-hidden="true"]'))
    .filter((s) => !s.querySelector('span[aria-hidden="true"]'))
    .map((s) => s.innerText.trim())
    .filter(Boolean);
  if (!texts.length) return {};

  const isDur  = (s) => /^\d+\s+(yr|mo|year|month)/i.test(s);
  const isDate = (s) => /\b\d{4}\b/.test(s) || /\bPresent\b/.test(s);
  const isType = (s) => /^(Full-time|Part-time|Contract|Internship|Freelance|Self-employed|Temporary|Seasonal|Apprenticeship)\b/i.test(s);
  const isSet  = (s) => /^(On-site|Remote|Hybrid)$/i.test(s);
  const isLoc  = (s) => s.includes(",") || /\b(United States|United Kingdom|Area|Metro)\b/i.test(s);
  const isMeta = (s) => isDur(s) || isDate(s) || isType(s) || isSet(s) || isLoc(s);

  // Grouped layout: pure duration ("2 yrs 6 mos") or "Type · duration" ("Full-time · 1 yr 5 mos")
  // appears within the first 3 texts — company was listed before the roles.
  const groupIdx = texts.findIndex(
    (s, i) => i < 3 && (isDur(s) || (isType(s) && s.includes("·")))
  );

  if (groupIdx >= 0) {
    const company = texts.slice(0, groupIdx).find((s) => !isMeta(s)) ?? texts[0];
    const role    = texts.slice(groupIdx + 1).find((s) => !isMeta(s)) ?? null;
    return {
      role,
      company: company?.split(/\s*·\s*/)[0].trim() ?? null,
      tenure: texts[groupIdx],
    };
  }

  // Single-role layout: first meaningful text = role, second = "Company · type"
  const meaningful = texts.filter((s) => !isMeta(s));
  return {
    role:    meaningful[0] ?? null,
    company: meaningful[1]?.split(/\s*·\s*/)[0].trim() ?? null,
    tenure:  texts.find(isDur) ?? null,
  };
}

// Reading order after the profile name is: degree marker ("1st"/"2nd"/"3rd")
// → optional pronouns → headline. Anchoring on the known name (same technique
// as scrapeBodyText) survives LinkedIn's class-name rotation.
function getConnectionDegree(name) {
  if (!name) return null;
  const root = document.querySelector("main, [role='main']") || document.body;
  const allLines = (root?.innerText || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const nameIdx = allLines.indexOf(name);
  if (nameIdx < 0) return null;
  const m = allLines[nameIdx + 1]?.match(/^(1st|2nd|3rd)\b/i);
  return m ? m[1].toLowerCase() : null;
}

function getFirst(selectors, exclude = null) {
  for (const sel of selectors) {
    const text = document.querySelector(sel)?.innerText?.trim();
    if (text && text !== exclude) return text;
  }
  return null;
}

// Parse "Name - Headline | LinkedIn" from the page title.
// Works for LinkedIn versions that include the headline in the title.
function parseDocTitle() {
  const clean = document.title
    .replace(/\s*\|\s*(LinkedIn\s+)?Sales\s+Navigator\s*$/i, "")
    .replace(/\s*\|\s*LinkedIn\s*$/i, "")
    .trim();
  const m = clean.match(/^(.+?)\s*[-–]\s*(.+)$/);
  if (!m) return { titleName: clean || null, titleHeadline: null };
  return { titleName: m[1].trim() || null, titleHeadline: m[2].trim() || null };
}

// ── Body-text scraper ────────────────────────────────────────────────────────
// LinkedIn's DOM class names change often; the reading order of body text is
// stable. After the profile name the text reads:
//   (degree "· 1st") → Headline → Company links → Location → …
// Further down the page: Experience → Job Title → Company · Type → Dates → …
//
// We anchor on the known profile name to skip nav items, then separately scan
// for the Experience section heading to extract the current job title.
function scrapeBodyText(knownName) {
  const root = document.querySelector("main, [role='main']") || document.body;
  const text = root?.innerText;
  if (!text) return {};

  // All non-empty lines; strip lone bullets and "· 1st" / "· 2nd" degree markers
  const allLines = text.split("\n")
    .map((l) => l.trim())
    .filter((l) => l && l !== "·" && l !== "•" && !/^[·•]\s*\d/.test(l));

  // ── Top card: headline, company, location ──────────────────────────────────
  let headline = null, topCompany = null, location = null;
  const nameIdx = knownName
    ? allLines.findIndex((l) => l === knownName)
    : -1;

  if (nameIdx >= 0) {
    let idx = nameIdx + 1;
    if (allLines[idx]?.match(/^\d+(st|nd|rd|th|\+)/i)) idx++; // bare degree
    if (allLines[idx]?.match(/^[A-Za-z]{1,12}\/[A-Za-z]{1,12}$/)) idx++; // pronouns

    headline = allLines[idx] || null;

    const rest = allLines.slice(idx + 1);
    const locIdx = rest.findIndex(
      (t) =>
        t.includes(",") ||
        /\b(Area|Metro|Bay|Remote|United States|United Kingdom|Canada|Australia)\b/i.test(t)
    );
    location = locIdx >= 0 ? rest[locIdx] : null;
    const rawCo = locIdx > 0 ? rest[0] : null;
    // LinkedIn joins company + school on one line: "Acme Corp · State U" — take first
    topCompany = rawCo ? rawCo.split(/\s*·\s*/)[0].trim() : null;
  }

  // ── Experience section: first job title + company ──────────────────────────
  // Two LinkedIn layouts:
  //   Single role:  Experience → Role title → "Company · Full-time"
  //   Grouped:      Experience → Company → "Full-time · duration" → "On-site" → Role title
  let expRole = null, expCompany = null;
  const expIdx = allLines.indexOf("Experience");
  if (expIdx >= 0) {
    const line1 = allLines[expIdx + 1] || null;
    const line2 = allLines[expIdx + 2] || null;
    const isGrouped = Boolean(
      line2?.match(/^(Full-time|Part-time|Contract|Internship|Temporary|Seasonal|Freelance|Apprenticeship)\b/i) ||
      line2?.match(/^\d+\s+(yr|mo|year|month)/i)
    );
    if (isGrouped) {
      expCompany = line1;
      for (let i = expIdx + 3; i < Math.min(allLines.length, expIdx + 12); i++) {
        const l = allLines[i];
        if (/^(On-site|Remote|Hybrid)$/i.test(l)) continue;
        if (/\b(Present|\d{4})\b/.test(l)) continue;
        if (/^\d+\s+(yr|mo|year|month)/i.test(l)) continue;
        if (/^(Full-time|Part-time|Contract|Internship|Temporary|Seasonal|Freelance|Apprenticeship)\b/i.test(l)) continue;
        expRole = l;
        break;
      }
    } else {
      expRole = line1;
      expCompany = line2 ? line2.split(/\s*·\s*/)[0].trim() : null;
    }
  }

  return { headline, company: topCompany, location, expRole, expCompany };
}

// ── Sales Navigator top-card scraper ─────────────────────────────────────────
// data-anonymize attributes are stable across Sales Nav deploys — LinkedIn's own
// GDPR anonymisation pipeline keeps them consistent regardless of class rotation.
// LinkedIn has used several attribute values over time (e.g. "headline" vs
// "person-tagline", "summary" vs "person-blurb"), so each field tries the known
// variants. Matches inside the lead top card (the section containing the
// person-name element) win over document-wide matches, because the experience
// list further down the page carries job-title/company-name attributes too.
function snField(names, scope) {
  for (const n of names) {
    const el = (scope || document).querySelector(`[data-anonymize="${n}"]`);
    const t = el?.innerText?.trim();
    if (t) return t;
  }
  return null;
}

function scrapeSalesNavTopCard() {
  const nameEl = document.querySelector('[data-anonymize="person-name"]');
  const topCard =
    nameEl?.closest("section") ||
    nameEl?.parentElement?.parentElement?.parentElement ||
    null;
  const scoped = (names) =>
    (topCard ? snField(names, topCard) : null) || snField(names);

  return {
    name:     nameEl?.innerText?.trim() || null,
    headline: scoped(["headline", "person-tagline", "person-headline"]),
    location: scoped(["location", "person-location"]),
    role:     scoped(["job-title", "person-title", "title"]),
    company:  scoped(["company-name", "person-company", "company"]),
    about:    snField(["person-blurb", "summary", "person-summary"]),
  };
}

// Sales Nav lead pages usually link to the person's public LinkedIn profile
// somewhere on the page (top-card links, overflow menu, embedded cards).
// Capturing it lets the platform key the prospect by the same /in/ URL as
// captures from regular LinkedIn — no duplicate rows, shared draft history.
function findPublicProfileUrl() {
  const anchors = Array.from(document.querySelectorAll("a[href]"));
  for (const a of anchors) {
    const href = a.getAttribute("href") || "";
    const m = href.match(/^(?:https?:\/\/(?:www\.)?linkedin\.com)?(\/in\/[^/?#]+)/i);
    if (m) return `https://www.linkedin.com${m[1]}`;
  }
  return null;
}

function scrapeProfile() {
  const getAll = (sel, limit = 3) =>
    Array.from(document.querySelectorAll(sel))
      .slice(0, limit)
      .map((el) => el.innerText.trim())
      .filter(Boolean)
      .join(" | ");

  // ── Sales Navigator: completely different DOM structure ───────────────────
  if (window.location.href.includes("linkedin.com/sales/")) {
    const { titleName, titleHeadline } = parseDocTitle();
    const sn = scrapeSalesNavTopCard();
    const name = sn.name || titleName || null;
    let { role, company, about } = sn;

    // data-anonymize="person-tagline" may not exist — fall back to page title
    // headline, then body text (body text is anchored on the known name so it
    // survives Sales Nav UI chrome above the fold).
    const bodyData = name ? scrapeBodyText(name) : {};
    let headline = sn.headline || titleHeadline || bodyData.headline || null;
    let location = sn.location || bodyData.location || null;

    if (!role || !company) {
      const atMatch = headline?.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s*[|·].*)?$/i);
      if (atMatch) {
        role    = role    || atMatch[1].trim();
        company = company || atMatch[2].trim();
      }
    }
    // Experience-list fallback: the first job-title/company-name pair in the
    // Sales Nav experience section is the current position.
    if (!role)    role    = snField(["job-title"]) || bodyData.expRole || null;
    if (!company) company = snField(["company-name"]) || bodyData.expCompany || null;
    // Fallback about for Sales Nav: body text scan (same strategy as regular path)
    if (!about) {
      const NOISE = /^(About|Show more|Show less|Show all|See more|See less|\d+\s*(connections?|followers?|reactions?))$/i;
      const SECTION_HEADINGS = new Set(["Experience", "Education", "Skills", "Activity"]);
      const root = document.querySelector("main, [role='main']") || document.body;
      const allLines = (root?.innerText || "").split("\n").map((l) => l.trim()).filter(Boolean);
      let best = "";
      for (let idx = 0; idx < allLines.length; idx++) {
        if (allLines[idx] !== "About") continue;
        const chunk = [];
        for (let i = idx + 1; i < Math.min(allLines.length, idx + 30); i++) {
          if (SECTION_HEADINGS.has(allLines[i])) break;
          if (NOISE.test(allLines[i])) continue;
          chunk.push(allLines[i]);
        }
        const candidate = chunk.join(" ").slice(0, 2000);
        if (candidate.length > best.length) best = candidate;
      }
      if (best.length > 0) about = best;
    }

    // Prefer the public /in/ URL when the page exposes one — keys the prospect
    // identically to captures from regular LinkedIn (dedupe, shared drafts).
    const publicUrl = findPublicProfileUrl();
    const salesNavUrl = window.location.href.split("?")[0];
    return {
      profileUrl: publicUrl || salesNavUrl,
      salesNavUrl,
      name, headline, location, role, company,
      tenure: null, about,
      recentActivity: getAll(SELECTORS.recentActivity, 4) || null,
      domStale: false,
    };
  }

  // ── Top-card: name, headline, location via DOM ────────────────────────────
  // LinkedIn's class names are build-time hashes that change with every deploy.
  // Instead we use two stable handles:
  //   • The first h1/h2 inside <main> is always the profile name.  Scoping to
  //     <main> excludes nav-bar h2s (notification counts, section headings).
  //   • span[aria-hidden="true"] leaf nodes carry all visible top-card text in
  //     predictable reading order: name → headline → company link(s) → location.
  const mainEl = document.querySelector("main, [role='main']");
  const nameEl = mainEl?.querySelector("h1, h2") ?? null;
  const domName = nameEl?.innerText?.trim() || getFirst(SELECTORS.name) || null;

  const { titleName, titleHeadline } = parseDocTitle();
  const name = domName || titleName || null;

  const domStale =
    Boolean(titleName) &&
    Boolean(domName) &&
    titleName.toLowerCase().trim() !== domName.toLowerCase().trim();

  // Collect leaf aria-hidden spans from the profile top card (the section that
  // contains the name element) — these hold headline, company link, location.
  const cardEl = nameEl?.closest("section") ?? nameEl?.parentElement ?? null;
  const cardSpans = cardEl
    ? Array.from(cardEl.querySelectorAll('span[aria-hidden="true"]'))
        .filter((s) => !s.querySelector('span[aria-hidden="true"]'))
        .map((s) => s.innerText.trim())
        .filter((t) => t && t !== name)
    : [];

  // cardSpans[0] = headline, then company links, then location
  const isLocLike = (t) =>
    t.includes(",") ||
    /\b(Area|Metro|Bay|Remote|United States|United Kingdom|Canada|Australia)\b/i.test(t);
  const cardHeadline = cardSpans[0] || null;
  const cardLocIdx   = cardSpans.findIndex(isLocLike);
  const cardLocation = cardLocIdx >= 0 ? cardSpans[cardLocIdx] : null;

  // ── Body-text fallback ────────────────────────────────────────────────────
  const bodyData = scrapeBodyText(name);

  // ── Headline ──────────────────────────────────────────────────────────────
  let headline =
    cardHeadline ||
    titleHeadline ||
    bodyData.headline ||
    null;

  // ── Location ──────────────────────────────────────────────────────────────
  let location =
    cardLocation ||
    bodyData.location ||
    null;

  // ── Role + Company + Tenure ───────────────────────────────────────────────
  // Primary: DOM scraper using stable selectors (#experience + aria-hidden spans)
  const domExp = scrapeExperienceFromDOM();
  let role    = domExp.role    || null;
  let company = domExp.company || null;
  let tenure  = domExp.tenure  || null;

  // Fallback: body text Experience section (when section isn't rendered yet)
  if (!role)    role    = bodyData.expRole    || null;
  if (!company) company = bodyData.expCompany || null;

  // Fallback 1: parse "Title at/@ Company" from headline
  if (!role || !company) {
    const atMatch = headline?.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s*[|·].*)?$/i);
    if (atMatch) {
      role    = role    || atMatch[1].trim();
      company = company || atMatch[2].trim();
    }
  }

  // Fallback 2: body text company (top-card experience link)
  if (!company) company = bodyData.company || null;

  // Fallback 3: if we know the company, find the role before it in the headline.
  // Handles "Role, Company | Extra info" format (e.g. "Managing Director, Acme Corp | …").
  if (!role && company && headline) {
    const marker = headline.indexOf(", " + company);
    if (marker > 0) role = headline.slice(0, marker).trim();
  }

  // Fallback 3: top-card hero experience items
  if (!role || !company) {
    const heroItems = document.querySelectorAll(
      ".pv-top-card--experience-list-item, .pv-top-card-v2-ctas__custom-btn"
    );
    if (heroItems.length > 0) {
      const heroText = Array.from(heroItems)
        .slice(0, 2)
        .map((el) => el.innerText.trim())
        .filter(Boolean)
        .join(", ");
      role    = role    || heroText;
      company = company || heroText;
    }
  }

  // ── About ─────────────────────────────────────────────────────────────────
  let about = null;
  {
    const NOISE = /^(About|Show more|Show less|Show all|See more|See less|\d+\s*(connections?|followers?|reactions?))$/i;

    // Strategy 1: #about anchor → closest section → innerText (most reliable)
    const anchor = document.getElementById("about");
    if (anchor) {
      const section = anchor.closest("section");
      if (section) {
        const lines = (section.innerText || "")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !NOISE.test(l));
        if (lines.length > 0) about = lines.join(" ").slice(0, 2000);
      }
    }

    // Strategy 2: body innerText — scan ALL "About" headings, keep longest chunk
    if (!about) {
      const root = document.querySelector("main, [role='main']") || document.body;
      const allLines = (root?.innerText || "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const SECTION_HEADINGS = new Set([
        "Experience", "Education", "Skills", "Activity", "Licenses",
        "Certifications", "Projects", "Volunteer", "Honors", "Publications",
      ]);
      let best = "";
      for (let idx = 0; idx < allLines.length; idx++) {
        if (allLines[idx] !== "About") continue;
        const chunk = [];
        for (let i = idx + 1; i < Math.min(allLines.length, idx + 30); i++) {
          if (SECTION_HEADINGS.has(allLines[i])) break;
          if (NOISE.test(allLines[i])) continue;
          chunk.push(allLines[i]);
        }
        const candidate = chunk.join(" ").slice(0, 2000);
        if (candidate.length > best.length) best = candidate;
      }
      if (best.length > 0) about = best;
    }
  }

  // ── Recent activity ───────────────────────────────────────────────────────
  const recentActivity = getAll(SELECTORS.recentActivity, 4) || null;

  return {
    profileUrl: window.location.href.split("?")[0],
    name,
    headline,
    location,
    role,
    company,
    tenure,
    about,
    recentActivity,
    domStale,
    connectionDegree: getConnectionDegree(name),
  };
}

// ── LinkedIn auto-connect ─────────────────────────────────────────────────────

// LinkedIn's "Add a note" invite modal renders inside an open Shadow DOM
// root (an Ember "interop" component mounted under #interop-outlet), which
// document.querySelectorAll never traverses into. Walk shadow roots
// recursively so modal elements are still found.
function deepQueryAll(selector, root = document) {
  let results = Array.from(root.querySelectorAll(selector));
  for (const el of root.querySelectorAll("*")) {
    if (el.shadowRoot) results = results.concat(deepQueryAll(selector, el.shadowRoot));
  }
  return results;
}

function waitForEl(fn, { timeout = 4000, interval = 150 } = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const el = fn();
      if (el) return resolve(el);
      if (Date.now() - start >= timeout) return resolve(null);
      setTimeout(tick, interval);
    };
    tick();
  });
}

// React holds internal state inside the textarea node. Setting .value directly
// skips React's change tracking; calling the native setter + dispatching input
// forces React to sync its vDOM state with the DOM value.
function fillReactTextarea(el, text) {
  const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  desc.set.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

// Gather every Connect-related interactive element on the page with context.
// No guessing — just collect data and let the agent decide which one to click.
// Word-boundary match: "connect" alone (or as part of "Invite ... to connect"),
// NOT "connections" — a plain substring match wrongly matched "482 connections"
// / "2 mutual connections" links on already-connected profiles, causing the
// automation to click those instead of an actual Connect button.
function gatherConnectCandidates() {
  const allEls = Array.from(document.querySelectorAll("button, a, [role='button']"));
  return allEls
    .filter((el) => {
      const text = (el.innerText || el.textContent || "").trim();
      const label = el.getAttribute("aria-label") || "";
      if (!(/\bconnect\b/i.test(text) || /\bconnect\b/i.test(label))) return false;
      const _r = el.getBoundingClientRect();
      if (_r.width === 0 && _r.height === 0) return false;
      // Exclude <a> tags that hard-navigate away (external or LinkedIn content pages).
      // Allow /in/, /sales/, /uas/, and any relative LinkedIn path — all handled by SPA.
      if (el.tagName === "A") {
        const href = (el.getAttribute("href") || "").trim();
        if (/^https?:\/\//i.test(href) || /^\/(feed|jobs|learning|search|pulse|mynetwork)\//.test(href)) return false;
      }
      return true;
    })
    .map((el, index) => ({
      index,
      tag: el.tagName,
      text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
      ariaLabel: el.getAttribute("aria-label"),
      // Surrounding text gives the agent context about which card this button lives in
      contextText: (el.closest("div, section, li, article")?.innerText || "")
        .replace(/\s+/g, " ").trim().slice(0, 200),
      _el: el, // not serialized — used locally after agent returns
    }));
}

// Some profiles (e.g. public figures, or accounts with "Follow" as the
// primary CTA) collapse "Connect" into the "..." overflow menu instead of
// showing it directly on the top card. Confirmed via DevTools inspection
// that LinkedIn's actual accessible name for this control is just "More"
// (aria-expanded="false" when collapsed) — not "More actions".
//
// LinkedIn's global nav ALSO has its own "More" control (it collapses
// Home/My Network/Jobs/etc. into one at narrow widths) that lives earlier
// in the DOM — an unscoped whole-document search matches that one first.
// Scope to the profile's own top card, same anchor pattern scrapeProfile()
// already uses (nameEl.closest("section")), so the nav's "More" is never
// even considered.
// The first h1/h2 inside <main> is always the profile name (same anchor
// scrapeProfile() uses). An unscoped document.querySelector("h1, h2") can
// instead match a nav-bar h2 (e.g. a notification-count badge) that
// happens to render earlier in the DOM — confirmed live: this silently
// broke the profile-name filter for a profile that had a perfectly normal,
// directly-visible Connect button.
function getProfileNameEl() {
  // Sales Nav marks the lead name with a stable data-anonymize attribute; the
  // h1/h2 heuristic below is for regular LinkedIn profile pages.
  return (
    document.querySelector('[data-anonymize="person-name"]') ||
    (document.querySelector("main, [role='main']") || document.body).querySelector("h1, h2")
  );
}

function findMoreActionsButton() {
  const nameEl = getProfileNameEl();
  const cardEl = nameEl?.closest("section") ?? nameEl?.parentElement ?? document;
  // Regular LinkedIn: aria-label "More" / "More actions".
  // Sales Nav: aria-label like "Open actions overflow menu" (wording drifts,
  // so match on "overflow" too), or an unlabeled "…" button next to Message.
  const search = (root, labelTest) =>
    Array.from(root.querySelectorAll("button, [role='button']")).find((el) => {
      const label = (el.getAttribute("aria-label") || "").trim();
      return labelTest(label) && el.offsetParent !== null;
    });
  const anyOverflow = (label) =>
    /^more(\s+actions?)?$/i.test(label) || /overflow/i.test(label) || /open actions/i.test(label);
  // Document-wide fallback matches ONLY explicit overflow labels — a bare
  // "More" outside the top card is LinkedIn's global-nav collapse button.
  const strictOverflow = (label) => /overflow/i.test(label) || /open actions/i.test(label);
  return (
    search(cardEl, anyOverflow) ||
    (cardEl !== document ? search(document, strictOverflow) : undefined)
  );
}

async function sendConnectionRequest(note) {
  // Get profile name from the page. Sidebar cards ("People also viewed",
  // "More profiles for you") have their own Connect buttons for OTHER
  // people — those are decoys, not something to let the agent guess among.
  // Only trust a candidate whose accessible name actually references the
  // profile being viewed.
  // Strip LinkedIn's degree badge ("• 2nd", "· 2nd degree connection", etc.)
  // that appears inside the h1 as a child span. Without stripping, profileName
  // becomes "Becca Z. • 2nd" and the aria-label lookup "invite becca z. to connect"
  // never matches it.
  const rawName = getProfileNameEl()?.innerText?.trim() || "";
  const profileName =
    rawName.replace(/\s*[•·]\s*.*/s, "").trim() ||
    document.title.replace(/\s*[-–|].*$/, "").trim() ||
    "Unknown";

  const forThisProfile = (list) =>
    profileName === "Unknown"
      ? list
      : list.filter((c) => `${c.ariaLabel || ""} ${c.contextText || ""}`.toLowerCase().includes(profileName.toLowerCase()));

  const nameEl = getProfileNameEl();
  const mainEl = document.querySelector("main, [role='main']") || document.body;

  const isConnectEl = (el) => {
    const text = (el.innerText || el.textContent || "").trim();
    const label = el.getAttribute("aria-label") || "";
    if (!(/\bconnect\b/i.test(text) || /\bconnect\b/i.test(label))) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    if (el.tagName === "A") {
      const href = (el.getAttribute("href") || "").trim();
      // Block external links and LinkedIn content pages that would hard-navigate
      // away. Allow /in/, /sales/, /uas/, and any other LinkedIn-relative path.
      if (/^https?:\/\//i.test(href) || /^\/(feed|jobs|learning|search|pulse|mynetwork)\//.test(href)) return false;
    }
    return true;
  };

  const toCandidate = (el, index) => ({
    index, tag: el.tagName,
    text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
    ariaLabel: el.getAttribute("aria-label"),
    contextText: "",
    _el: el,
  });

  // Strategy 1 (most reliable, screen-size independent): aria-label match.
  // LinkedIn stamps the profile's own Connect button with an aria-label that
  // contains the profile name — e.g. "Invite Becca Z. to connect" or
  // "Connect with Gary Gwin". Buttons for OTHER people (People similar,
  // activity cards) contain THEIR names, so they never match here.
  const dedup = (list) =>
    list.filter((el) => !list.some((other) => other !== el && el.contains(other)));

  const byAriaLabel = profileName !== "Unknown"
    ? dedup(
        Array.from(mainEl.querySelectorAll("button, a, [role='button']"))
          .filter(isConnectEl)
          .filter((el) =>
            (el.getAttribute("aria-label") || "").toLowerCase().includes(profileName.toLowerCase()),
          ),
      ).map(toCandidate)
    : [];

  // Strategy 2 (spatial fallback for buttons with no name in aria-label):
  // The profile action bar always sits within ~220px below the name element.
  // Using the name element's viewport rect keeps this relative to layout, not
  // screen resolution (getBoundingClientRect returns CSS pixels, unaffected by
  // device pixel ratio). The threshold could fail at very high browser zoom
  // levels, but that is covered by Strategy 1 above for named aria-labels.
  const nameRect = nameEl?.getBoundingClientRect();
  const vw = window.innerWidth || 1280;
  const bySpatial =
    nameRect && nameRect.width > 0
      ? dedup(
          Array.from(mainEl.querySelectorAll("button, a, [role='button']"))
            .filter(isConnectEl)
            .filter((el) => {
              const r = el.getBoundingClientRect();
              const dy = r.top - nameRect.top;
              return dy >= -20 && dy <= 220 && r.left < vw * 0.72;
            }),
        ).map(toCandidate)
      : [];

  const cardCandidates = byAriaLabel.length > 0 ? byAriaLabel : bySpatial;

  let candidates = cardCandidates.length > 0
    ? cardCandidates
    : forThisProfile(gatherConnectCandidates());

  console.log("[BLI] profileName:", profileName);
  console.log("[BLI] nameRect:", nameRect?.top?.toFixed(0), nameRect?.left?.toFixed(0));
  console.log("[BLI] byAriaLabel:", byAriaLabel.map(c => c.ariaLabel || c.text));
  console.log("[BLI] bySpatial:", bySpatial.map(c => c.ariaLabel || c.text));
  console.log("[BLI] candidates:", candidates.length, candidates.map(c => c.ariaLabel || c.text));

  if (candidates.length === 0) {
    // Connect may be collapsed into the "More actions" ("...") overflow menu.
    // LinkedIn hides the dropdown button via z-index / layering — not via
    // display:none, visibility:hidden, or opacity:0 — so every CSS-visibility
    // check (offsetParent, checkVisibility) returns "visible" for it even when
    // the dropdown is closed. DOM diffing cannot isolate it.
    //
    // Instead: after the menu opens that button IS the topmost element at its
    // screen position. We find it two ways, in order:
    //   1. aria-controls: if LinkedIn stamps the control ID on the "..." button
    //      we get the dropdown container directly and search within it.
    //   2. elementFromPoint grid: probe a grid of points below/left of the "..."
    //      button and walk up from whatever element is on top looking for a
    //      short "Connect" label.
    const moreBtn = findMoreActionsButton();
    if (moreBtn) {
      moreBtn.click();
      await new Promise((r) => setTimeout(r, 500));

      const connectRe = /\bconnect\b/i;

      // --- Approach 1: aria-controls ---
      const ctrlId = moreBtn.getAttribute("aria-controls");
      const dropdownEl = ctrlId ? document.getElementById(ctrlId) : null;
      console.log("[BLI] aria-controls:", ctrlId, "found:", !!dropdownEl);
      if (dropdownEl) {
        const connectEl = Array.from(
          dropdownEl.querySelectorAll("button, a, [role='button'], [role='menuitem'], li, div"),
        ).find((el) => {
          const text = (el.innerText || el.textContent || "").trim();
          return connectRe.test(text) && text.length < 40;
        });
        if (connectEl) {
          candidates = [{
            index: 0, tag: connectEl.tagName,
            text: (connectEl.innerText || connectEl.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
            ariaLabel: connectEl.getAttribute("aria-label"), contextText: "", _el: connectEl,
          }];
        }
      }

      // --- Approach 1.5: open dropdown containers ---
      // Sales Nav (and some regular-LinkedIn variants) render the open menu in
      // a recognizable container. Scoping to it avoids the decoy Connect
      // buttons in "People similar to" cards elsewhere on the page.
      if (candidates.length === 0) {
        const menus = deepQueryAll(
          "[role='menu'], .artdeco-dropdown__content, ul[class*='dropdown'], div[class*='dropdown-options']",
        );
        for (const menu of menus) {
          if (menu.offsetParent === null) continue;
          const connectEl = Array.from(
            menu.querySelectorAll("button, a, [role='button'], [role='menuitem'], li, div"),
          ).find((el) => {
            const text = (el.innerText || el.textContent || "").trim();
            return connectRe.test(text) && text.length < 40;
          });
          if (connectEl) {
            candidates = [{
              index: 0, tag: connectEl.tagName,
              text: (connectEl.innerText || connectEl.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
              ariaLabel: connectEl.getAttribute("aria-label"), contextText: "", _el: connectEl,
            }];
            break;
          }
        }
        console.log("[BLI] dropdown-container candidates:", candidates.length);
      }

      // --- Approach 2: elementFromPoint grid ---
      if (candidates.length === 0) {
        const btnRect = moreBtn.getBoundingClientRect();
        // Probe within the dropdown's own visual footprint (roughly ±140px
        // horizontally from the button). The open dropdown has higher z-index
        // than page content, so elementFromPoint returns dropdown elements at
        // any point inside the overlay — even if a "People similar to" card
        // sits underneath. The previous wide dx=-220 sweep escaped the
        // overlay and landed on embedded Connect buttons for OTHER people.
        outer: for (let dy = 10; dy < 400; dy += 10) {
          for (let dx = -60; dx <= 140; dx += 20) {
            const probed = document.elementFromPoint(btnRect.left + dx, btnRect.bottom + dy);
            if (!probed || probed === moreBtn || probed === document.body) continue;
            let check = probed;
            for (let depth = 0; depth < 5; depth++) {
              if (!check || check === document.body) break;
              const text = (check.innerText || check.textContent || "").trim().replace(/\s+/g, " ");
              if (connectRe.test(text) && text.length < 35) {
                candidates = [{
                  index: 0, tag: check.tagName,
                  text: text.slice(0, 60),
                  ariaLabel: check.getAttribute("aria-label"), contextText: "", _el: check,
                }];
                break outer;
              }
              check = check.parentElement;
            }
          }
        }
        console.log("[BLI] elementFromPoint candidates:", candidates.length, candidates.map((c) => c.text));
      }
    }
  }

  if (candidates.length === 0) {
    return { ok: false, error: "No Connect button found for this profile." };
  }

  // Ask the agent to identify which candidate is the main profile Connect button.
  // Only reached now when multiple candidates both survived the name filter
  // (or both newly appeared from the overflow menu) — a much narrower,
  // lower-risk disambiguation than picking among unrelated people.
  let targetIndex = 0;
  if (candidates.length > 1) {
    const resolution = await chrome.runtime.sendMessage({
      type: "RESOLVE_CONNECT_BUTTON",
      profileName,
      candidates: candidates.map(({ _el, ...c }) => c),
    });
    if (!resolution?.ok) return { ok: false, error: resolution?.error || "Agent could not identify the Connect button." };
    targetIndex = resolution.index;
  }

  const connectBtn = candidates[targetIndex]?._el;
  if (!connectBtn) return { ok: false, error: "Agent returned invalid element index." };

  // Safety check: don't click a link that hard-navigates away from the profile.
  // LinkedIn's SPA intercepts all relative paths (/in/, /sales/, /uas/, etc.)
  // and opens a modal — only block truly external URLs.
  if (connectBtn.tagName === "A") {
    const href = (connectBtn.getAttribute("href") || "").trim();
    if (/^https?:\/\//i.test(href) || href.startsWith("//")) {
      return { ok: false, error: "No Connect button found for this profile. LinkedIn may not show a direct Connect option here." };
    }
  }

  connectBtn.click();
  await new Promise((r) => setTimeout(r, 1000));

  // 2. Modal — either goes straight to the note textarea, or asks
  // "Add a note?" first. Race both so we don't waste time waiting on a
  // step LinkedIn may skip, and so a slow-to-render "Add a note" button
  // doesn't time us out when the textarea was reachable all along.
  const findAddNoteBtn = () => {
    const btns = deepQueryAll("button, [role='button']");
    return (
      btns.find((b) => /^add a note$/i.test((b.getAttribute("aria-label") || "").trim())) ??
      btns.find((b) => /^add a note$/i.test(b.innerText.trim())) ??
      btns.find((b) => /personali[sz]e invite/i.test(b.innerText)) ??
      btns.find((b) => /add.*note|include.*note/i.test(b.innerText))
    );
  };
  // Regular LinkedIn uses textarea[name="message"]; Sales Nav's connect modal
  // uses a different name/id, so fall back to any textarea inside an open
  // dialog/modal.
  const findTextarea = () =>
    deepQueryAll('textarea[name="message"]')[0] ??
    deepQueryAll('textarea[id*="invitation" i]')[0] ??
    deepQueryAll("[role='dialog'] textarea, .artdeco-modal textarea")[0] ??
    null;

  let textarea = null;
  const waitResult = await waitForEl(() => findAddNoteBtn() ?? findTextarea(), { timeout: 10000 });

  if (!waitResult) {
    return { ok: false, error: '"Add a note" button did not appear. LinkedIn may have sent the request directly without a note option.' };
  }

  if (waitResult.tagName === "TEXTAREA") {
    textarea = waitResult;
  } else {
    waitResult.click();
    await new Promise((r) => setTimeout(r, 400));
    textarea = await waitForEl(findTextarea, { timeout: 6000 });
  }

  // 3. Fill the note textarea
  if (!textarea) return { ok: false, error: "Note textarea not found." };

  textarea.focus();
  fillReactTextarea(textarea, note.slice(0, 300));
  await new Promise((r) => setTimeout(r, 200));

  // 4. Send — scoped to the dialog. Regular LinkedIn: "Send"; Sales Nav:
  // "Send invitation". Never match "Send without a note" — that would drop
  // the note we just filled in.
  const dialog =
    textarea.closest('[role="dialog"]') ??
    textarea.closest(".artdeco-modal") ??
    document;
  const sendBtn = await waitForEl(() =>
    deepQueryAll("button", dialog).find((b) => {
      const t = b.innerText.trim();
      return /^send(\s+invitation|\s+now)?$/i.test(t) && !b.disabled;
    })
  );
  if (!sendBtn) return { ok: false, error: "Send button not found in modal." };

  sendBtn.click();
  return { ok: true };
}

// Sales Nav diagnostic — call window.__bliDiagnoseSalesNav() in the tab console
// on a lead page and paste the output when scraping misses fields.
window.__bliDiagnoseSalesNav = function () {
  const inventory = Array.from(document.querySelectorAll("[data-anonymize]"))
    .slice(0, 80)
    .map((el) => `${el.getAttribute("data-anonymize")} → "${(el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 70)}"`);
  console.log("[BLI SN] data-anonymize inventory:\n" + inventory.join("\n"));
  console.log("[BLI SN] scrape result:", scrapeProfile());
  const buttons = Array.from(document.querySelectorAll("button, [role='button']"))
    .filter((b) => b.offsetParent !== null)
    .slice(0, 60)
    .map((b) => `"${(b.innerText || "").trim().replace(/\s+/g, " ").slice(0, 30)}" aria="${b.getAttribute("aria-label") || ""}"`);
  console.log("[BLI SN] visible buttons:\n" + buttons.join("\n"));
};

// Diagnostic helper — call window.__bliDiagnose() in the LinkedIn tab console
window.__bliDiagnose = function () {
  const mainEl = document.querySelector("main, [role='main']");
  const nameEl = mainEl?.querySelector("h1");
  const rawName = nameEl?.innerText?.trim() ?? "";
  const profileName = rawName.replace(/\s*[•·]\s*.*/s, "").trim();
  console.log("[BLI] Raw h1 text:", JSON.stringify(rawName));
  console.log("[BLI] Cleaned profileName:", JSON.stringify(profileName));

  const byLabel = Array.from(document.querySelectorAll("button, a, [role='button']")).filter((b) => {
    const label = (b.getAttribute("aria-label") ?? "").toLowerCase();
    return label.includes("connect");
  });
  console.log("[BLI] Elements with 'connect' in aria-label:", byLabel.map(b =>
    `tag=${b.tagName} label="${b.getAttribute("aria-label")}" href="${b.getAttribute("href") ?? ""}" rect=${JSON.stringify(b.getBoundingClientRect().toJSON()).slice(0,60)}`
  ));

  const byText = Array.from(document.querySelectorAll("button, a, [role='button']")).filter(b => /connect/i.test(b.innerText.trim()) && b.innerText.trim().length < 35);
  console.log("[BLI] Short elements with 'Connect' text:", byText.map(b => {
    const r = b.getBoundingClientRect();
    return `tag=${b.tagName} text="${b.innerText.trim()}" aria="${b.getAttribute("aria-label")}" href="${b.getAttribute("href") ?? ""}" x=${r.left.toFixed(0)} y=${r.top.toFixed(0)} w=${r.width.toFixed(0)} h=${r.height.toFixed(0)}`;
  }));
};

// ── Post page commenter scraper ───────────────────────────────────────────────
// LinkedIn's DOM is unstable; selectors use aria-hidden="true" spans and
// stable /in/ profile link hrefs as anchors, same approach as profile scraping.
function scrapeCommenters() {
  const results = [];
  const seen = new Set();

  // Anchor the comments section using stable UI elements instead of class names.
  // LinkedIn rotates CSS classes on every deploy; placeholder text is stable.
  let commentsRoot = null;
  const addCommentInput =
    document.querySelector('[placeholder*="comment" i]') ||
    document.querySelector('[contenteditable][aria-label*="comment" i]') ||
    document.querySelector('[data-placeholder*="comment" i]');

  if (addCommentInput) {
    let el = addCommentInput;
    for (let i = 0; i < 12; i++) {
      el = el.parentElement;
      if (!el) break;
      // Stop at the first ancestor that already contains commenter links.
      if (el.querySelectorAll('a[href*="/in/"]').length >= 2) {
        commentsRoot = el;
        break;
      }
    }
  }

  // Pre-exclude the post author: their profile link is OUTSIDE commentsRoot
  // (it's in the post header above the comment section).
  if (commentsRoot) {
    const pageLinks = Array.from(document.querySelectorAll('a[href*="/in/"]')).filter(
      (l) => !commentsRoot.contains(l) && !l.closest('header, nav, aside, [role="navigation"]')
    );
    if (pageLinks.length > 0) {
      seen.add(pageLinks[0].href.split("?")[0].replace(/\/$/, ""));
    }
  }

  // Search within the comments section when found; otherwise search the full page
  // minus obvious chrome (header, nav, aside).
  const searchLinks = commentsRoot
    ? Array.from(commentsRoot.querySelectorAll('a[href*="/in/"]'))
    : Array.from(document.querySelectorAll('a[href*="/in/"]')).filter(
        (l) => !l.closest('header, nav, aside, [role="navigation"]')
      );

  // UI action words that appear in comment controls — never a headline or comment body.
  const UI_WORDS = new Set([
    "like", "reply", "view", "more", "comment", "repost", "send",
    "connect", "follow", "message", "report", "share", "load", "save",
  ]);

  for (const link of searchLinks) {
    const raw = link.href || "";
    // Normalize: strip query string and trailing slash so /in/foo and /in/foo/ deduplicate.
    const profileUrl = raw.split("?")[0].replace(/\/$/, "");
    if (!profileUrl.includes("/in/") || seen.has(profileUrl)) continue;

    // Secondary author guard: LinkedIn adds an "Author" badge span to the post
    // author's comment. Skip any commenter whose nearby spans contain exactly "Author".
    const nearSpanTexts = Array.from(
      (link.parentElement?.parentElement || link).querySelectorAll("span")
    ).map((s) => (s.innerText || s.textContent || "").trim());
    if (nearSpanTexts.some((t) => t === "Author")) continue;

    // Name: find the first span inside the link that isn't a degree badge ("• 2nd" etc.).
    const nameSpans = Array.from(link.querySelectorAll('span[aria-hidden="true"]'))
      .map((s) => s.innerText?.trim())
      .filter((s) => s && !s.startsWith("•") && s.length > 1);
    const name = nameSpans[0] || (link.innerText || "").split("\n")[0].trim();
    if (!name || name.length < 2) continue;

    seen.add(profileUrl);

    // Headline: LinkedIn's element structure varies (aria-hidden is not consistently
    // applied, nesting depth differs between comment types). Use innerText-based
    // extraction instead: split the actor block by newlines, drop the name/badge/
    // timestamps/edit indicators, and take the first meaningful line.
    const linkParent = link.parentElement;
    let company = "";
    const nameLower = name.toLowerCase();
    const linkRawText = (link.innerText || "").toLowerCase().trim();

    for (const block of [linkParent, linkParent?.parentElement].filter(Boolean)) {
      const candidate = (block.innerText || "")
        .split(/[\n\r•]+/)
        .map((l) => l.trim())
        .find(
          (l) =>
            l.length > 10 &&
            l.length < 120 &&
            l.toLowerCase() !== nameLower &&
            !l.toLowerCase().split(/\s+/).every((w) => linkRawText.includes(w)) &&
            !l.startsWith("•") &&
            !/^\d/.test(l) &&       // "1 reply", "2h", "4h"
            !/^\(/.test(l) &&       // "(edited)", "(edited) 4h"
            !UI_WORDS.has(l.toLowerCase())
        );
      if (candidate) { company = candidate; break; }
    }

    // Comment body: walk up 6 levels to the full comment item and pick the longest
    // span that isn't the name, headline, or a UI action word.
    let commentEl = link;
    for (let i = 0; i < 6; i++) commentEl = commentEl.parentElement || commentEl;
    const bodySpans = Array.from(commentEl.querySelectorAll('span[aria-hidden="true"]'))
      .map((s) => s.innerText?.trim() || "")
      .filter((s) => s.length > 15 &&
        s.toLowerCase() !== name.toLowerCase() &&
        s !== company &&
        !UI_WORDS.has(s.toLowerCase())
      );
    const commentText = bodySpans.reduce((a, b) => (b.length > a.length ? b : a), "").slice(0, 500);

    const postUrl = window.location.href.split("?")[0];
    // Post title: find the first span with dir="ltr" that has meaningful text.
    // dir="ltr" is a stable attribute LinkedIn puts on post body text;
    // class names rotate on every deploy.
    const postTextSpan = Array.from(document.querySelectorAll('span[dir="ltr"]')).find((el) => {
      const t = (el.innerText || "").trim();
      return t.length > 20 && !el.closest("header, nav, aside, [role='navigation']");
    });
    const postTitle = (postTextSpan?.innerText || "").trim().slice(0, 200);

    results.push({ name, company, profileUrl, commentText, postUrl, postTitle });
  }

  console.log("[BLI scrape] found", results.length, "engagers:", results.map(r => `${r.name} | ${r.company || "(no headline)"}`));
  return results;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "SCRAPE_PROFILE") {
    sendResponse({ ok: true, data: scrapeProfile() });
  }

  if (msg.type === "SCRAPE_COMMENTERS") {
    const commenters = scrapeCommenters();
    sendResponse({ ok: true, commenters });
    return true;
  }

  if (msg.type === "SEND_CONNECTION_REQUEST") {
    sendConnectionRequest(msg.note)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
