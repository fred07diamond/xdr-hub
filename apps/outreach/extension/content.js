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
function scrapeSalesNavTopCard() {
  return {
    name:     document.querySelector('[data-anonymize="person-name"]')?.innerText?.trim()    || null,
    headline: document.querySelector('[data-anonymize="person-tagline"]')?.innerText?.trim() || null,
    location: document.querySelector('[data-anonymize="location"]')?.innerText?.trim()       || null,
    role:     document.querySelector('[data-anonymize="job-title"]')?.innerText?.trim()      || null,
    company:  document.querySelector('[data-anonymize="company-name"]')?.innerText?.trim()   || null,
    about:    document.querySelector('[data-anonymize="summary"]')?.innerText?.trim()        || null,
  };
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

    return {
      profileUrl: window.location.href.split("?")[0],
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
      if (el.offsetParent === null) return false;
      // Exclude <a> tags whose href would hard-navigate away from the profile.
      // Feed/post links navigate; LinkedIn profile overlay URLs (/in/...) are
      // handled by the SPA and open a modal — allow those through.
      if (el.tagName === "A") {
        const href = (el.getAttribute("href") || "").trim();
        if (href && href !== "#" && !href.startsWith("javascript:") && !href.startsWith("/in/")) return false;
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
  return (document.querySelector("main, [role='main']") || document.body).querySelector("h1, h2");
}

function findMoreActionsButton() {
  const nameEl = getProfileNameEl();
  const cardEl = nameEl?.closest("section") ?? nameEl?.parentElement ?? document;
  return Array.from(cardEl.querySelectorAll("button, [role='button']")).find((el) => {
    const label = (el.getAttribute("aria-label") || "").trim();
    return /^more(\s+actions?)?$/i.test(label) && el.offsetParent !== null;
  });
}

async function sendConnectionRequest(note) {
  // Get profile name from the page. Sidebar cards ("People also viewed",
  // "More profiles for you") have their own Connect buttons for OTHER
  // people — those are decoys, not something to let the agent guess among.
  // Only trust a candidate whose accessible name actually references the
  // profile being viewed.
  const profileName =
    getProfileNameEl()?.innerText?.trim() ||
    document.title.replace(/\s*[-–|].*$/, "").trim() ||
    "Unknown";

  const forThisProfile = (list) =>
    profileName === "Unknown"
      ? list
      : list.filter((c) => `${c.ariaLabel || ""} ${c.contextText || ""}`.toLowerCase().includes(profileName.toLowerCase()));

  let candidates = forThisProfile(gatherConnectCandidates());

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

      // --- Approach 2: elementFromPoint grid ---
      if (candidates.length === 0) {
        const btnRect = moreBtn.getBoundingClientRect();
        // Sweep below and to the left where the dropdown typically opens.
        outer: for (let dy = 30; dy < 450; dy += 15) {
          for (let dx = -220; dx <= 60; dx += 25) {
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

  // Safety check: don't click a link that would hard-navigate away from the
  // profile page. LinkedIn's "..." dropdown "Connect" item may be an <a> with
  // href="/in/.../overlay/connect/" — the SPA intercepts that and opens the
  // modal without a full navigation. Block only hrefs that clearly point to
  // content (post feeds) or external sites.
  if (connectBtn.tagName === "A") {
    const href = (connectBtn.getAttribute("href") || "").trim();
    if (href && href !== "#" && !href.startsWith("javascript:") && !href.startsWith("/in/")) {
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
  const findTextarea = () => deepQueryAll('textarea[name="message"]')[0] ?? null;

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

  // 4. Send — scoped to the dialog
  const dialog = textarea.closest('[role="dialog"]') ?? document;
  const sendBtn = await waitForEl(() =>
    deepQueryAll("button", dialog).find(
      (b) => b.innerText.trim() === "Send" && !b.disabled
    )
  );
  if (!sendBtn) return { ok: false, error: "Send button not found in modal." };

  sendBtn.click();
  return { ok: true };
}

// Diagnostic helper — call window.__bliDiagnose() in the LinkedIn tab console
window.__bliDiagnose = function () {
  const mainEl = document.querySelector("main, [role='main']");
  const nameEl = mainEl?.querySelector("h1");
  const profileName = nameEl?.innerText?.trim() ?? "";
  const firstName = profileName.split(/\s+/)[0].toLowerCase();
  console.log("[BLI] Profile name:", profileName, "| firstName:", firstName);

  const byLabel = Array.from(document.querySelectorAll("button")).filter((b) => {
    const label = (b.getAttribute("aria-label") ?? "").toLowerCase();
    return label.includes("connect");
  });
  console.log("[BLI] Buttons with 'connect' in aria-label:", byLabel.map(b => `"${b.getAttribute("aria-label")}"`));

  const byText = Array.from(document.querySelectorAll("button")).filter(b => /connect/i.test(b.innerText.trim()));
  console.log("[BLI] Buttons with 'Connect' in text:", byText.map(b => `"${b.innerText.trim()}" (aria="${b.getAttribute("aria-label")}") visible=${b.offsetParent !== null}`));
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "SCRAPE_PROFILE") {
    sendResponse({ ok: true, data: scrapeProfile() });
  }

  if (msg.type === "SEND_CONNECTION_REQUEST") {
    sendConnectionRequest(msg.note)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
