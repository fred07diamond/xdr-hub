// ─── BLI DOM DIAGNOSTIC ──────────────────────────────────────────────────────
// Paste this entire file into DevTools console on the LinkedIn PROFILE TAB
// (not the extension panel). Press Enter and share the output.
// ─────────────────────────────────────────────────────────────────────────────

(function bliDiagnose() {
  const out = {};

  // ── 1. Page title & parsing ────────────────────────────────────────────────
  out.pageTitle = document.title;
  const cleanTitle = document.title.replace(/\s*\|\s*LinkedIn\s*$/i, "").trim();
  const titleMatch = cleanTitle.match(/^(.+?)\s*[-–]\s*(.+)$/);
  out.titleParsed = {
    clean: cleanTitle,
    titleName: titleMatch ? titleMatch[1].trim() : null,
    titleHeadline: titleMatch ? titleMatch[2].trim() : null,
  };

  // ── 2. h1 element ─────────────────────────────────────────────────────────
  const h1 = document.querySelector("h1");
  out.h1 = h1 ? {
    text: h1.innerText.trim(),
    className: h1.className || "(no class)",
    parentTag: h1.parentElement?.tagName,
    parentClass: h1.parentElement?.className?.slice(0, 80) || "(no class)",
    nextSiblingTag: h1.nextElementSibling?.tagName || null,
    nextSiblingText: h1.nextElementSibling?.innerText?.trim()?.slice(0, 80) || null,
  } : "NOT FOUND";

  // ── 3. Name selectors ─────────────────────────────────────────────────────
  out.nameSelectors = [
    "h1.text-heading-xlarge",
    "h1.break-words",
    "h1.t-24",
    "h1",
  ].map((sel) => ({
    selector: sel,
    count: document.querySelectorAll(sel).length,
    text: document.querySelector(sel)?.innerText?.trim() || null,
  }));

  // ── 4. Headline selectors ─────────────────────────────────────────────────
  out.headlineSelectors = [
    ".text-body-medium.break-words",
    ".pv-text-details__left-panel .text-body-medium",
    ".ph5 .text-body-medium",
  ].map((sel) => ({
    selector: sel,
    count: document.querySelectorAll(sel).length,
    firstText: document.querySelector(sel)?.innerText?.trim()?.slice(0, 100) || null,
  }));

  // ── 5. Location selectors ─────────────────────────────────────────────────
  out.locationSelectors = [
    ".text-body-small.inline.t-black--light.break-words",
    ".pv-text-details__left-panel .t-black--light",
    ".ph5 .t-black--light",
  ].map((sel) => ({
    selector: sel,
    count: document.querySelectorAll(sel).length,
    firstText: document.querySelector(sel)?.innerText?.trim()?.slice(0, 80) || null,
  }));

  // ── 6. Top-card detection ─────────────────────────────────────────────────
  const topCardCandidates = [
    { label: 'h1.closest([class*="pv-top-card"])', el: h1?.closest('[class*="pv-top-card"]') },
    { label: "h1.closest(section.artdeco-card)",   el: h1?.closest("section.artdeco-card") },
    { label: "h1.closest(section)",                el: h1?.closest("section") },
    { label: "h1.closest(.artdeco-card)",          el: h1?.closest(".artdeco-card") },
  ];
  out.topCardDetection = topCardCandidates.map(({ label, el }) => ({
    label,
    found: !!el,
    tag: el?.tagName || null,
    classSnippet: el?.className?.slice(0, 80) || null,
  }));

  // ── 7. Leaf texts inside top card ─────────────────────────────────────────
  const topCard =
    h1?.closest('[class*="pv-top-card"]') ||
    h1?.closest("section.artdeco-card") ||
    h1?.closest("section") ||
    h1?.closest(".artdeco-card") ||
    h1?.parentElement?.parentElement?.parentElement?.parentElement;

  if (topCard) {
    const walker = document.createTreeWalker(topCard, NodeFilter.SHOW_TEXT);
    const texts = [];
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim();
      if (t.length >= 3) texts.push(t);
    }
    out.topCardLeafTexts = texts.slice(0, 25);
  } else {
    out.topCardLeafTexts = "TOP CARD NOT FOUND — cannot do leaf-text scan";
  }

  // ── 8. Experience section ─────────────────────────────────────────────────
  const expAnchor = document.querySelector("#experience");
  const expSection =
    expAnchor?.closest("section") ||
    expAnchor?.closest('[class*="pv-profile-card"]') ||
    expAnchor?.parentElement?.parentElement;
  const firstExpLi = expSection?.querySelector("li");
  out.experience = {
    anchorFound: !!expAnchor,
    sectionFound: !!expSection,
    firstLiText: firstExpLi?.innerText?.trim()?.slice(0, 150) || null,
    roleEl: firstExpLi?.querySelector('.t-bold span[aria-hidden="true"]')?.innerText?.trim() || null,
    companyEl: firstExpLi?.querySelector('.t-14.t-normal:not(.t-black--light) span[aria-hidden="true"]')?.innerText?.trim() || null,
  };

  // ── 9. About section ──────────────────────────────────────────────────────
  const aboutEls = document.querySelectorAll("#about ~ div span[aria-hidden='true']");
  out.about = {
    count: aboutEls.length,
    firstText: aboutEls[0]?.innerText?.trim()?.slice(0, 100) || null,
  };

  // ── Print ──────────────────────────────────────────────────────────────────
  console.group("━━━ BLI Diagnostic ━━━");
  console.log("1. Page title:", out.pageTitle);
  console.log("2. Title parsed:", out.titleParsed);
  console.log("3. h1:", out.h1);
  console.log("\n4. Name selectors:");      console.table(out.nameSelectors);
  console.log("\n5. Headline selectors:");  console.table(out.headlineSelectors);
  console.log("\n6. Location selectors:");  console.table(out.locationSelectors);
  console.log("\n7. Top-card detection:");  console.table(out.topCardDetection);
  console.log("\n8. Top-card leaf texts (first 25):", out.topCardLeafTexts);
  console.log("\n9. Experience section:", out.experience);
  console.log("10. About section:", out.about);
  console.groupEnd();

  return out;
})();
