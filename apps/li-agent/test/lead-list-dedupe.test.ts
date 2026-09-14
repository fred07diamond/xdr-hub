import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The reported bug: delete a lead list, then re-import those leads, and they
// are silently skipped -- "technically they are already in a list, just the
// list no longer exists."
//
// Two independent places decide whether a lead is a duplicate, and they failed
// differently. The SERVER was already correct. The EXTENSION was not: it
// answered from a chrome.storage.local cache that no server event ever
// invalidated. These tests pin both, because either one regressing
// reintroduces the same user-visible bug.

function src(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("server-side dedupe — import-sales-nav-list", () => {
  const SRC = src("actions/import-sales-nav-list.ts");

  it("joins lead_lists so an orphaned item cannot block a re-import", () => {
    // An INNER JOIN is what makes "already in a list" mean "already in a list
    // THAT EXISTS". Without it, a leadListItems row whose list was deleted
    // would still count as a duplicate forever.
    const joins = SRC.match(/\.innerJoin\(leadLists, eq\(leadListItems\.listId, leadLists\.id\)\)/g) ?? [];
    // One per dedupe query: salesNavLeadUrl and profileUrl.
    expect(joins.length).toBe(2);
    expect(SRC).not.toMatch(/\.leftJoin\(leadLists/);
  });

  it("dedupes on profileUrl as well as salesNavLeadUrl", () => {
    // The single-profile "Add to list" flow sends a real /in/... URL and no
    // salesNavLeadUrl, so checking only the latter would let it create a
    // duplicate row on every click.
    expect(SRC).toContain("existingProfileUrls");
    expect(SRC).toContain("existingSalesNavUrls");
  });
});

describe("check-leads-in-lists", () => {
  const SRC = src("actions/check-leads-in-lists.ts");

  it("counts a lead as in-a-list only when the list still exists", () => {
    expect(SRC).toContain(".innerJoin(leadLists, eq(leadListItems.listId, leadLists.id))");
  });

  it("scopes to the calling owner, via lead_lists", () => {
    // An unauthenticated-but-token-bearing extension endpoint must not be able
    // to probe whether someone else has a given lead.
    //
    // Ownership is on lead_lists, NOT on lead_list_items -- an earlier version
    // of this file asserted `leadListItems.ownerEmail`, which this source-text
    // test happily confirmed even though that column does not exist and the
    // action did not compile. Matching import-sales-nav-list's own filter is
    // the point: the two dedupe answers must agree about whose data they mean.
    expect(SRC).toContain("resolveOwnerStrict");
    expect(SRC).toContain("eq(leadLists.ownerEmail, ownerEmail)");
    expect(SRC).not.toContain("leadListItems.ownerEmail");
    // A null owner must scope to the null-owner rows, not match everyone.
    expect(SRC).toContain("isNull(leadLists.ownerEmail)");
  });

  it("caps the batch so one call cannot build an unbounded IN clause", () => {
    expect(SRC).toMatch(/\.max\(2000\)/);
  });

  it("reports how many urls were checked, so the client can tell a clean result from no result", () => {
    // The distinction that keeps a network blip from clearing real exclusions.
    expect(SRC).toContain("checked");
  });

  it("is declared POST, since the client sends a url batch in the body", () => {
    // A GET with 2,000 urls in the query string would exceed URL limits.
    expect(SRC).toContain('http: { method: "POST" }');
  });
});

describe("extension reconcile — panel.js", () => {
  const SRC = src("extension/panel.js");

  it("lets the server override the local already-sent cache", () => {
    expect(SRC).toContain("async function reconcileAlreadySentWithServer");
    expect(SRC).toContain("CHECK_LEADS_IN_LISTS");
  });

  it("un-excludes a lead whose list is gone", () => {
    // The actual fix. mergeLeadRows auto-excludes anything the cache flags, so
    // clearing the cache alone would not re-check the box.
    expect(SRC).toContain("delete alreadySentByUrl[url]");
    expect(SRC).toMatch(/excludedUrls\.indexOf\(url\)[\s\S]{0,120}splice/);
  });

  it("changes NOTHING when the check fails", () => {
    // Clearing exclusions on a network blip would silently re-import genuine
    // duplicates -- worse than the bug being fixed.
    expect(SRC).toMatch(/if \(!res\?\.ok\) return false;/);
  });

  it("debounces, because mergeLeadRows fires on every scrape tick", () => {
    expect(SRC).toContain("function scheduleAlreadySentReconcile");
    expect(SRC).toMatch(/clearTimeout\(reconcileTimer\)/);
  });

  it("also reconciles when the Lists tab is opened", () => {
    // So deleting a list on the platform frees its leads without needing a
    // fresh scrape first.
    expect(SRC).toMatch(/tab === "lists" && Object\.keys\(listImportSession\.leadsByUrl\)\.length > 0/);
  });
});

describe("extension background handler", () => {
  const SRC = src("extension/background.js");

  it("posts the batch and surfaces failure as ok:false", () => {
    expect(SRC).toContain("async function checkLeadsInLists");
    expect(SRC).toContain('method: "POST"');
    expect(SRC).toMatch(/ok: false, error: err\.message, inLists: \{\}/);
  });
});

describe("CSV export header", () => {
  it('labels the phone column "Mobile Phone" in BOTH generators', () => {
    // Apollo's importer does not map a bare "Phone" to its mobile-phone field,
    // so the number was dropped on import and re-fetched -- paying twice for
    // data we already had.
    for (const path of ["app/lib/prospects-csv.ts", "extension/panel.js"]) {
      expect(src(path), path).toContain('"Mobile Phone"');
      expect(src(path), path).not.toMatch(/"Email", "Phone"/);
    }
  });
});
