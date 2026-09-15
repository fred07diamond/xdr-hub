import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every action the EXTENSION calls must be in `publicPaths`.
 *
 * This has now shipped broken four times, twice by me.
 * `requiresAuth: false` plus `publicAgent: { requiresAuth: false }` on the
 * action looks sufficient and is not: the GLOBAL auth guard rejects an
 * unlisted path with {"error":"Unauthorized"} BEFORE the action is dispatched,
 * so the action's own flag never runs and its own error message never appears.
 * The failure therefore looks like a dead button rather than an auth error.
 *
 * Confirmed against production, all returning Unauthorized: my
 * check-leads-in-lists (so a deleted list never freed its leads) and
 * extension-get-contact (so the contact buttons did nothing), plus
 * list-icp-personas, add-persona-documents, delete-persona-document and
 * check-sales-nav-leads-captured, which had been dead far longer -- the
 * extension's ICP Personas panel and its Sales Nav capture check.
 *
 * The invariant is derived from what extension/*.js actually FETCHES, not from
 * what the actions declare. An action can legitimately declare publicAgent and
 * be called only from the dashboard, where a session exists and the guard
 * passes; being unlisted only breaks the cross-origin, no-cookie case. Keying
 * on the extension's real call sites is what makes this precise instead of
 * noisy.
 */

const ROOT = new URL("../", import.meta.url);

function read(rel: string): string {
  return readFileSync(new URL(rel, ROOT), "utf8");
}

/** Action names the extension fetches, from its own source. */
function actionsCalledByExtension(): string[] {
  const dir = new URL("extension/", ROOT);
  const names = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(new URL(file, dir), "utf8");
    for (const m of src.matchAll(/_agent-native\/actions\/([a-z][a-z0-9-]{2,})/g)) {
      names.add(m[1]);
    }
  }
  return [...names].sort();
}

function listedIn(file: string): Set<string> {
  const found = new Set<string>();
  for (const m of read(file).matchAll(/"\/_agent-native\/actions\/([a-z0-9-]+)"/g)) {
    found.add(m[1]);
  }
  return found;
}

const CALLED = actionsCalledByExtension();

describe("actions the extension calls are reachable without a session", () => {
  it("found the extension's call sites", () => {
    // A guard on the guard: if the scan breaks, every case below would
    // vacuously pass and the bug it exists to catch would return.
    expect(CALLED.length).toBeGreaterThan(10);
    expect(CALLED).toContain("capture-profile");
    expect(CALLED).toContain("extension-get-contact");
  });

  it.each(CALLED)("%s is in publicPaths (server/plugins/auth.ts)", (action) => {
    // The list that actually gates the request.
    expect(listedIn("server/plugins/auth.ts").has(action)).toBe(true);
  });

  it.each(CALLED)("%s is in PUBLIC_ACTION_PATHS (org-membership)", (action) => {
    // Kept in sync so the two lists cannot disagree about what is public.
    expect(listedIn("server/middleware/org-membership.ts").has(action)).toBe(true);
  });

  it.each(CALLED)("%s sets top-level requiresAuth: false too", (action) => {
    // TWO layers gate this, and both must be opened. publicPaths gets the
    // request past the global auth guard ("Unauthorized"); the action's own
    // top-level `requiresAuth` -- which defaults to TRUE -- gets it past
    // dispatch ("Unauthenticated"). check-leads-in-lists had the publicAgent
    // flag but not the top-level one, so it swapped one error for the other.
    const src = readFileSync(new URL(`actions/${action}.ts`, ROOT), "utf8");
    expect(src).toMatch(/^\s*requiresAuth: false,/m);
  });

  it.each(CALLED)("%s exists as an action file", (action) => {
    // A typo in an extension URL is the other way this fails silently.
    const files = new Set(
      readdirSync(new URL("actions/", ROOT))
        .filter((f) => f.endsWith(".ts"))
        .map((f) => f.replace(/\.ts$/, "")),
    );
    expect(files.has(action)).toBe(true);
  });

  it("publicPaths lists no action that does not exist", () => {
    // A stale entry is a smaller problem than a missing one, but it still
    // misrepresents what is exposed.
    const files = new Set(
      readdirSync(new URL("actions/", ROOT))
        .filter((f) => f.endsWith(".ts"))
        .map((f) => f.replace(/\.ts$/, "")),
    );
    for (const listed of listedIn("server/plugins/auth.ts")) {
      expect(files.has(listed), `publicPaths lists "${listed}" with no such action`).toBe(true);
    }
  });
});

describe("the misleading comment is gone", () => {
  it("org-membership no longer says omission is harmless", () => {
    // It called the list "documentation only" and said a missing action was
    // not a gap. That claim is what let four actions ship dead.
    //
    // Asserted on the old claim's own phrase, NOT on a fragment the new
    // comment legitimately quotes while explaining the mistake -- checking
    // for "isn't a gap" failed against the correction itself, which is the
    // second time this suite has caught me asserting against prose.
    const SRC = read("server/middleware/org-membership.ts");
    expect(SRC).not.toContain("This list is documentation only");
    expect(SRC).toContain("must stay in sync");
  });
});
