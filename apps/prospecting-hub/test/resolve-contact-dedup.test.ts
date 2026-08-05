import { describe, expect, it } from "vitest";
import { findCrossSourceMatch } from "../server/helpers/resolve-contact-dedup.js";

// findCrossSourceMatch's own SQL WHERE clause is just a coarse candidate
// filter (LOWER(email) = ... OR LOWER(linkedin_url) LIKE ...) — the real
// match decision happens in the JS `.find()` below it, comparing exact email
// and normalized-LinkedIn-slug equality. A minimal fake `db` that always
// returns a canned candidate list (regardless of the query built against it)
// is enough to exercise that decision logic without a real database.
function fakeDb(candidates: Array<{ id: string; email: string | null; linkedinUrl: string | null }>) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => candidates,
        }),
      }),
    }),
  } as never;
}

describe("findCrossSourceMatch", () => {
  it("returns null when neither email nor linkedinUrl is given", async () => {
    const db = fakeDb([{ id: "c1", email: "a@example.com", linkedinUrl: null }]);
    const match = await findCrossSourceMatch(db, { email: null, linkedinUrl: null });
    expect(match).toBeNull();
  });

  it("matches by exact email, case-insensitively", async () => {
    const db = fakeDb([{ id: "c1", email: "Jane@Example.com", linkedinUrl: null }]);
    const match = await findCrossSourceMatch(db, { email: "jane@example.com", linkedinUrl: null });
    expect(match).toEqual({ id: "c1" });
  });

  it("matches by normalized LinkedIn vanity slug regardless of URL formatting", async () => {
    const db = fakeDb([{ id: "c2", email: null, linkedinUrl: "https://linkedin.com/in/jane-doe/" }]);
    const match = await findCrossSourceMatch(db, {
      email: null,
      linkedinUrl: "https://www.linkedin.com/in/jane-doe",
    });
    expect(match).toEqual({ id: "c2" });
  });

  it("returns null when no candidate actually matches (coarse SQL filter over-fetched)", async () => {
    const db = fakeDb([{ id: "c3", email: "someone-else@example.com", linkedinUrl: null }]);
    const match = await findCrossSourceMatch(db, { email: "jane@example.com", linkedinUrl: null });
    expect(match).toBeNull();
  });
});
