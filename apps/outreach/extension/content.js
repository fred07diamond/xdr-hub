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
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "SCRAPE_PROFILE") {
    sendResponse({ ok: true, data: scrapeProfile() });
  }
});
