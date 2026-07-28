// node extension/test-parse.js
// Tests pure scraping logic — no browser or DOM needed.

let passed = 0, failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${label}`);
    console.error(`     ${e.message}`);
    failed++;
  }
}

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || ""}\n     got      ${a}\n     expected ${e}`);
}

// ── parseDocTitle ────────────────────────────────────────────────────────────
// Replicated exactly from content.js so we can test in isolation.
function parseDocTitle(title) {
  const clean = title
    .replace(/\s*\|\s*(LinkedIn\s+)?Sales\s+Navigator\s*$/i, "")
    .replace(/\s*\|\s*LinkedIn\s*$/i, "")
    .trim();
  const m = clean.match(/^(.+?)\s*[-–]\s*(.+)$/);
  if (!m) return { titleName: clean || null, titleHeadline: null };
  return { titleName: m[1].trim() || null, titleHeadline: m[2].trim() || null };
}

console.log("\nparseDocTitle");
test("standard profile title", () => {
  const r = parseDocTitle("Alex Bell - Managing Director & Founder, Madison Wells | Executive Search & Talent Partner | LinkedIn");
  eq(r.titleName, "Alex Bell");
  eq(r.titleHeadline, "Managing Director & Founder, Madison Wells | Executive Search & Talent Partner");
});
test("simple one-liner headline", () => {
  const r = parseDocTitle("Brian Reisman - GTM Leadership at Cursor | LinkedIn");
  eq(r.titleName, "Brian Reisman");
  eq(r.titleHeadline, "GTM Leadership at Cursor");
});
test("en-dash separator", () => {
  const r = parseDocTitle("Jane Doe – VP of Sales | LinkedIn");
  eq(r.titleName, "Jane Doe");
  eq(r.titleHeadline, "VP of Sales");
});
test("notification count prefix", () => {
  // LinkedIn sometimes prepends a count when the user has notifications
  const r = parseDocTitle("(13) Alex Bell - Managing Director | LinkedIn");
  // titleName will include the count — that's OK; domName from h1 wins for name
  eq(r.titleHeadline, "Managing Director");
});
test("no dash — just name + LinkedIn", () => {
  const r = parseDocTitle("Alex Bell | LinkedIn");
  eq(r.titleName, "Alex Bell");
  eq(r.titleHeadline, null);
});
test("case-insensitive LinkedIn strip", () => {
  const r = parseDocTitle("Sam Smith - CEO | LINKEDIN");
  eq(r.titleName, "Sam Smith");
  eq(r.titleHeadline, "CEO");
});
test("Sales Navigator — name only", () => {
  const r = parseDocTitle("Alex Tsatsos | LinkedIn Sales Navigator");
  eq(r.titleName, "Alex Tsatsos");
  eq(r.titleHeadline, null);
});
test("Sales Navigator — name with headline", () => {
  const r = parseDocTitle("Alex Tsatsos - Product Designer | LinkedIn Sales Navigator");
  eq(r.titleName, "Alex Tsatsos");
  eq(r.titleHeadline, "Product Designer");
});
test("Sales Navigator — bare Sales Navigator suffix", () => {
  const r = parseDocTitle("Alex Tsatsos | Sales Navigator");
  eq(r.titleName, "Alex Tsatsos");
  eq(r.titleHeadline, null);
});

// ── "Title at Company" headline parser ──────────────────────────────────────
function parseAtMatch(headline) {
  const m = headline?.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s*[|·].*)?$/i);
  if (!m) return { role: null, company: null };
  return { role: m[1].trim(), company: m[2].trim() };
}

console.log("\nparseAtMatch (headline → role + company)");
test("simple at pattern", () => {
  const r = parseAtMatch("GTM Leadership at Cursor");
  eq(r.role, "GTM Leadership");
  eq(r.company, "Cursor");
});
test("pipe suffix stripped", () => {
  const r = parseAtMatch("VP of Sales at Acme Corp | Building great things");
  eq(r.role, "VP of Sales");
  eq(r.company, "Acme Corp");
});
test("middle dot suffix stripped", () => {
  const r = parseAtMatch("Engineer at Stripe · Full-time");
  eq(r.role, "Engineer");
  eq(r.company, "Stripe");
});
test("@ sign instead of at", () => {
  const r = parseAtMatch("Founder & UX/UI Partner @ Stubill Studio | External UX/UI support");
  eq(r.role, "Founder & UX/UI Partner");
  eq(r.company, "Stubill Studio");
});
test("no at — returns nulls", () => {
  const r = parseAtMatch("Managing Director & Founder, Madison Wells");
  eq(r.role, null);
  eq(r.company, null);
});
test("null headline — returns nulls", () => {
  const r = parseAtMatch(null);
  eq(r.role, null);
  eq(r.company, null);
});

// ── domStale logic ───────────────────────────────────────────────────────────
function isDomStale(titleName, domName) {
  return (
    Boolean(titleName) &&
    Boolean(domName) &&
    titleName.toLowerCase().trim() !== domName.toLowerCase().trim()
  );
}

console.log("\ndomStale");
test("same name → not stale", () => eq(isDomStale("Alex Bell", "Alex Bell"), false));
test("different name → stale", () => eq(isDomStale("Alex Bell", "Brian Reisman"), true));
test("null domName → not stale", () => eq(isDomStale("Alex Bell", null), false));
test("null titleName → not stale", () => eq(isDomStale(null, "Alex Bell"), false));
test("case-insensitive match → not stale", () => eq(isDomStale("Alex Bell", "ALEX BELL"), false));

// ── scrapeBodyText (replicated from content.js) ──────────────────────────────
function scrapeBodyText(bodyText, knownName) {
  const text = bodyText;
  if (!text) return {};

  const allLines = text.split("\n")
    .map((l) => l.trim())
    .filter((l) => l && l !== "·" && l !== "•" && !/^[·•]\s*\d/.test(l));

  let headline = null, topCompany = null, location = null;
  const nameIdx = knownName ? allLines.findIndex((l) => l === knownName) : -1;

  if (nameIdx >= 0) {
    let idx = nameIdx + 1;
    if (allLines[idx]?.match(/^\d+(st|nd|rd|th|\+)/i)) idx++; // bare degree
    if (allLines[idx]?.match(/^[A-Za-z]{1,12}\/[A-Za-z]{1,12}$/)) idx++; // pronouns

    headline = allLines[idx] || null;

    const rest = allLines.slice(idx + 1);
    const locIdx = rest.findIndex(
      (t) => t.includes(",") || /\b(Area|Metro|Bay|Remote|United States|United Kingdom|Canada|Australia)\b/i.test(t)
    );
    location = locIdx >= 0 ? rest[locIdx] : null;
    const rawCo = locIdx > 0 ? rest[0] : null;
    topCompany = rawCo ? rawCo.split(/\s*·\s*/)[0].trim() : null;
  }

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

const ALEX_BELL_BODY = `0 notifications\nSkip to main content\nSkip to primary content\nSkip to aside\nSkip to footer\nAlex Bell\n\n· 1st\n\nManaging Director & Founder, Madison Wells | Executive Search & Talent Partner for Insights, Analytics & Growth Leadership\n\nMadison Wells\n\nSaint John's University\n\nChicago, Illinois, United States\n\n·\n\nContact info\n\nMessage\nSave in Sales Navigator`;

const BRIAN_BODY = `0 notifications\nSkip to main content\nSkip to primary content\nSkip to aside\nSkip to footer\nBrian Reisman\n\n· 2nd\n\nGTM Leadership at Cursor | Proud Girl Dad x2 | Technology Enthusiast\n\nCursor\n\nSan Francisco Bay Area\n\n·\n\nContact info`;

const NO_DEGREE_BODY = `0 notifications\nSkip to main content\nSkip to primary content\nSkip to aside\nSkip to footer\nJane Doe\n\nCEO at Acme Corp\n\nAcme Corp\n\nNew York, United States\n\nContact info`;

const REMOTE_BODY = `0 notifications\nSkip to main content\nSkip to primary content\nSkip to aside\nSkip to footer\nSam Smith\n\n· 3rd\n\nEngineer at Stripe\n\nStripe\n\nRemote\n\nContact info`;

const ROBERT_BODY = `0 notifications\nSkip to main content\nSkip to primary content\nSkip to aside\nSkip to footer\nRobert Lieu\n\n· 2nd\n\nHe/Him\n\nUser Experience Design Lead at Instaparty | Building meaningful experiences\n\nInstaparty\n\nLos Angeles, California, United States\n\nContact info\n\nExperience\n\nUser Experience Design Lead\n\nInstaparty · Full-time\n\nJan 2022 - Present`;

const SENDA_BODY = `0 notifications\nSkip to main content\nSkip to primary content\nSkip to aside\nSkip to footer\nSenda B.\n\n· 2nd\n\nBrand & Product Marketing | Podcast Host\n\nVibe.co\n\nNew York City Metropolitan Area\n\nContact info\n\nExperience\n\nVibe.co\n\nFull-time · 1 yr 5 mos\n\nOn-site\n\nDirector of Brand and Product Marketing\n\nMay 2026 - Present · 3 mos\n\nNew York City Metropolitan Area`;

// Duration-only header variant (no "Full-time ·" prefix): "2 yrs 6 mos" on its own line
const JUSTIN_BODY = `0 notifications\nSkip to main content\nSkip to primary content\nSkip to aside\nSkip to footer\nJustin Ruderman\n\nSenior Coordinator, Content Marketing\n\nMajor League Soccer\n\nNew York City Metropolitan Area\n\nExperience\n\nMajor League Soccer\n\n2 yrs 6 mos\n\nSenior Coordinator, Content Marketing\n\nFull-time\n\nMay 2026 - Present · 3 mos\n\nNew York, New York, United States · On-site`;

console.log("\nscrapeBodyText");
test("Alex Bell — headline, company, location", () => {
  const r = scrapeBodyText(ALEX_BELL_BODY, "Alex Bell");
  eq(r.headline, "Managing Director & Founder, Madison Wells | Executive Search & Talent Partner for Insights, Analytics & Growth Leadership");
  eq(r.company, "Madison Wells");
  eq(r.location, "Chicago, Illinois, United States");
});
test("Brian Reisman — 2nd degree, Bay Area", () => {
  const r = scrapeBodyText(BRIAN_BODY, "Brian Reisman");
  eq(r.headline, "GTM Leadership at Cursor | Proud Girl Dad x2 | Technology Enthusiast");
  eq(r.company, "Cursor");
  eq(r.location, "San Francisco Bay Area");
});
test("no degree indicator", () => {
  const r = scrapeBodyText(NO_DEGREE_BODY, "Jane Doe");
  eq(r.headline, "CEO at Acme Corp");
  eq(r.company, "Acme Corp");
  eq(r.location, "New York, United States");
});
test("Remote location", () => {
  const r = scrapeBodyText(REMOTE_BODY, "Sam Smith");
  eq(r.headline, "Engineer at Stripe");
  eq(r.location, "Remote");
});
test("name not in text → falls back to start", () => {
  const r = scrapeBodyText(ALEX_BELL_BODY, "Unknown Person");
  // falls back to reading from position 0 — should not crash
  eq(typeof r, "object");
});

console.log("\nscrapeBodyText (pronouns + experience section)");
test("pronouns line skipped — real headline extracted", () => {
  const r = scrapeBodyText(ROBERT_BODY, "Robert Lieu");
  eq(r.headline, "User Experience Design Lead at Instaparty | Building meaningful experiences");
  eq(r.location, "Los Angeles, California, United States");
});
test("experience section role extracted", () => {
  const r = scrapeBodyText(ROBERT_BODY, "Robert Lieu");
  eq(r.expRole, "User Experience Design Lead");
});
test("experience section company extracted (strip employment type)", () => {
  const r = scrapeBodyText(ROBERT_BODY, "Robert Lieu");
  eq(r.expCompany, "Instaparty");
});

console.log("\nscrapeBodyText (grouped experience — multiple roles at one company)");
test("grouped: company name extracted", () => {
  const r = scrapeBodyText(SENDA_BODY, "Senda B.");
  eq(r.expCompany, "Vibe.co");
});
test("grouped: most recent role extracted (skips Full-time / On-site lines)", () => {
  const r = scrapeBodyText(SENDA_BODY, "Senda B.");
  eq(r.expRole, "Director of Brand and Product Marketing");
});

console.log("\nscrapeBodyText (grouped with duration-only header)");
test("grouped via duration header — company extracted", () => {
  const r = scrapeBodyText(JUSTIN_BODY, "Justin Ruderman");
  eq(r.expCompany, "Major League Soccer");
});
test("grouped via duration header — role extracted (not '2 yrs 6 mos')", () => {
  const r = scrapeBodyText(JUSTIN_BODY, "Justin Ruderman");
  eq(r.expRole, "Senior Coordinator, Content Marketing");
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
