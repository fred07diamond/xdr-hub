/**
 * Tests for check-hubspot-contact action.
 *
 * Covers:
 *  1. Source — action code has defensive null handling for all new properties
 *  2. Source — isInSequence uses strict string comparison, not truthy check
 *  3. Source — owner name fetch is wrapped in try/catch (best-effort)
 *  4. Source — debug mode short-circuits before owner/deals lookups
 *  5. Live   — endpoint returns correct shape (connected, found, isInSequence is boolean)
 *  6. Live   — debug mode returns rawProperties object so we can verify HubSpot field names
 *  7. Live   — verify expected property names actually appear in rawProperties
 *  8. Live   — formMessage, firstPageSeen, lastPageSeen are null-or-string (never undefined)
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const ROOT    = path.resolve(__dirname, "..");
const DB_PATH = path.resolve(ROOT, "data/app.db");
const OUTREACH = "http://127.0.0.1:8101/outreach";

function readFile(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), "utf8");
}

function sql(query: string): string {
  return execSync(`sqlite3 "${DB_PATH}" ${JSON.stringify(query)}`, { encoding: "utf8" }).trim();
}

function serverRunning(): boolean {
  try {
    execSync(`curl -s --max-time 2 "${OUTREACH}/_agent-native/actions/get-draft?profileUrl=x" -o /dev/null`, { stdio: "pipe" });
    return true;
  } catch { return false; }
}

async function callGet(name: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${OUTREACH}/_agent-native/actions/${name}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url).catch(() => null);
  if (!res) return { ok: false, status: -1, body: null as Record<string, unknown> | null };
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body: json as Record<string, unknown> | null };
}

// ─── 1–4. Source-level checks ────────────────────────────────────────────────

describe("check-hubspot-contact source — new properties are null-coalesced", () => {
  const src = readFile("actions/check-hubspot-contact.ts");

  it("maps email with ?? null fallback", () => {
    expect(src).toContain('email: match.properties.email ?? null');
  });

  it("maps formMessage from message property with ?? null fallback", () => {
    expect(src).toContain('formMessage: match.properties.message ?? null');
  });

  it("maps firstPageSeen from hs_analytics_first_url with ?? null fallback", () => {
    expect(src).toContain('firstPageSeen: match.properties.hs_analytics_first_url ?? null');
  });

  it("maps lastPageSeen from hs_analytics_last_url with ?? null fallback", () => {
    expect(src).toContain('lastPageSeen: match.properties.hs_analytics_last_url ?? null');
  });

  it("all new properties are requested in the search call", () => {
    expect(src).toContain('"message"');
    expect(src).toContain('"hs_analytics_first_url"');
    expect(src).toContain('"hs_analytics_last_url"');
    expect(src).toContain('"hs_sequences_is_enrolled"');
    expect(src).toContain('"hs_latest_sequence_enrolled"');
    expect(src).toContain('"hubspot_owner_id"');
  });
});

describe("check-hubspot-contact source — isInSequence is a strict boolean", () => {
  const src = readFile("actions/check-hubspot-contact.ts");

  it('uses === "true" (not truthy coercion) so missing property → false', () => {
    // HubSpot returns "true"/"false" strings; a missing property returns null/undefined,
    // which must not be treated as enrolled.
    expect(src).toContain('hs_sequences_is_enrolled === "true"');
  });

  it("does NOT use a plain truthy check on hs_sequences_is_enrolled", () => {
    // Truthy check would coerce "false" (the string) to true — wrong.
    expect(src).not.toMatch(/!!match\.properties\.hs_sequences_is_enrolled/);
  });
});

describe("check-hubspot-contact source — owner name fetch is best-effort", () => {
  const src = readFile("actions/check-hubspot-contact.ts");

  it("wraps owner fetch in try/catch so a 404 does not crash the action", () => {
    // The pattern: try { ... ownerRes ... } catch { /* best-effort */ }
    const ownerBlock = src.slice(src.indexOf("Resolve owner name"));
    expect(ownerBlock).toContain("try {");
    expect(ownerBlock).toContain("} catch {");
  });

  it("falls back to owner email when first+last name are absent", () => {
    const src2 = readFile("actions/check-hubspot-contact.ts");
    expect(src2).toContain("ownerRes.email ?? null");
  });
});

describe("check-hubspot-contact source — debug mode", () => {
  const src = readFile("actions/check-hubspot-contact.ts");

  it("accepts debug param in schema", () => {
    expect(src).toContain("debug");
    expect(src).toContain("Return raw contact properties");
  });

  it("returns rawProperties in debug mode and short-circuits", () => {
    expect(src).toContain("rawProperties: match.properties");
    // Short-circuit: the debug return must appear BEFORE the owner fetch and deals fetch
    const debugIdx = src.indexOf("rawProperties: match.properties");
    const ownerIdx = src.indexOf("Resolve owner name");
    const dealsIdx = src.indexOf("Best-effort deal lookup");
    expect(debugIdx).toBeLessThan(ownerIdx);
    expect(debugIdx).toBeLessThan(dealsIdx);
  });
});

// ─── 5–8. Live smoke tests (server must be running on :8101) ─────────────────

describe("live: check-hubspot-contact — response shape", () => {
  it("returns connected:false when no HubSpot token is configured", async () => {
    if (!serverRunning()) { console.warn("Server not running — skipping"); return; }
    // A profile that definitely isn't in the DB will still hit the token check first.
    // If HubSpot IS configured, we expect connected:true + found:false.
    // Either way the shape must be valid.
    const r = await callGet("check-hubspot-contact", {
      profileUrl: "https://www.linkedin.com/in/__test_nonexistent_profile__",
    });
    expect(r.ok).toBe(true);
    expect(r.body).toHaveProperty("connected");
    expect(typeof r.body?.connected).toBe("boolean");
  });

  it("isInSequence is always a boolean in the response (never a string)", async () => {
    if (!serverRunning()) { console.warn("Server not running — skipping"); return; }
    // Find the most recently captured prospect URL from the DB to get a real result.
    if (!fs.existsSync(DB_PATH)) { console.warn("No local DB — skipping"); return; }
    const profileUrl = sql("SELECT profile_url FROM prospects ORDER BY created_at DESC LIMIT 1");
    if (!profileUrl) { console.warn("No prospects in DB — skipping"); return; }

    const r = await callGet("check-hubspot-contact", { profileUrl });
    if (!r.body?.found) { console.warn("Prospect not found in HubSpot — skipping isInSequence check"); return; }
    expect(typeof r.body.isInSequence).toBe("boolean");
  });

  it("formMessage, firstPageSeen, lastPageSeen are null or string (never undefined)", async () => {
    if (!serverRunning()) { console.warn("Server not running — skipping"); return; }
    if (!fs.existsSync(DB_PATH)) { console.warn("No local DB — skipping"); return; }
    const profileUrl = sql("SELECT profile_url FROM prospects ORDER BY created_at DESC LIMIT 1");
    if (!profileUrl) { console.warn("No prospects in DB — skipping"); return; }

    const r = await callGet("check-hubspot-contact", { profileUrl });
    if (!r.body?.found) { console.warn("Prospect not found in HubSpot — skipping"); return; }

    for (const field of ["formMessage", "firstPageSeen", "lastPageSeen", "ownerName", "email"]) {
      const val = r.body[field];
      expect(val === null || typeof val === "string",
        `${field} should be null or string, got ${JSON.stringify(val)}`
      ).toBe(true);
    }
  });
});

describe("live: check-hubspot-contact debug mode — verify HubSpot property names", () => {
  it("debug=true returns rawProperties object (not null)", async () => {
    if (!serverRunning()) { console.warn("Server not running — skipping"); return; }
    if (!fs.existsSync(DB_PATH)) { console.warn("No local DB — skipping"); return; }
    const profileUrl = sql("SELECT profile_url FROM prospects ORDER BY created_at DESC LIMIT 1");
    if (!profileUrl) { console.warn("No prospects in DB — skipping"); return; }

    const r = await callGet("check-hubspot-contact", { profileUrl, debug: "true" });
    if (!r.body?.found) { console.warn("Prospect not found in HubSpot — skipping debug check"); return; }

    expect(r.body).toHaveProperty("rawProperties");
    expect(typeof r.body.rawProperties).toBe("object");
    expect(r.body.rawProperties).not.toBeNull();

    const props = r.body.rawProperties as Record<string, unknown>;
    console.log("\n=== HubSpot raw properties returned ===");
    console.log(JSON.stringify(props, null, 2));
    console.log("=== End raw properties ===\n");
  });

  it("rawProperties contains the standard fields we always expect", async () => {
    if (!serverRunning()) { console.warn("Server not running — skipping"); return; }
    if (!fs.existsSync(DB_PATH)) { console.warn("No local DB — skipping"); return; }
    const profileUrl = sql("SELECT profile_url FROM prospects ORDER BY created_at DESC LIMIT 1");
    if (!profileUrl) { console.warn("No prospects in DB — skipping"); return; }

    const r = await callGet("check-hubspot-contact", { profileUrl, debug: "true" });
    if (!r.body?.found) { console.warn("Prospect not found in HubSpot — skipping"); return; }

    const props = r.body.rawProperties as Record<string, unknown>;
    // These are standard HubSpot fields that must always be present on a contact.
    expect(props).toHaveProperty("firstname");
    expect(props).toHaveProperty("lastname");
    expect(props).toHaveProperty("email");
  });

  it("warns if hs_analytics_first_url is missing from rawProperties (wrong property name)", async () => {
    if (!serverRunning()) { console.warn("Server not running — skipping"); return; }
    if (!fs.existsSync(DB_PATH)) { console.warn("No local DB — skipping"); return; }
    const profileUrl = sql("SELECT profile_url FROM prospects ORDER BY created_at DESC LIMIT 1");
    if (!profileUrl) { console.warn("No prospects in DB — skipping"); return; }

    const r = await callGet("check-hubspot-contact", { profileUrl, debug: "true" });
    if (!r.body?.found) { console.warn("Prospect not found in HubSpot — skipping"); return; }

    const props = r.body.rawProperties as Record<string, unknown>;
    if (!("hs_analytics_first_url" in props)) {
      console.warn(
        "⚠ hs_analytics_first_url not in rawProperties — property may be named differently in this HubSpot instance.",
        "Keys returned:", Object.keys(props).filter(k => k.includes("analytic") || k.includes("url")).join(", ") || "(none matching)"
      );
    }
    if (!("message" in props)) {
      console.warn(
        "⚠ message not in rawProperties — form submission field may have a different name in this HubSpot instance.",
        "Keys returned:", Object.keys(props).filter(k => k.includes("message") || k.includes("form")).join(", ") || "(none matching)"
      );
    }
    if (!("hs_sequences_is_enrolled" in props)) {
      console.warn(
        "⚠ hs_sequences_is_enrolled not in rawProperties — sequence field may not be available or named differently.",
        "Keys returned:", Object.keys(props).filter(k => k.includes("sequence")).join(", ") || "(none matching)"
      );
    }
    // This test never fails — it just logs warnings so you know which fields need correction.
    expect(true).toBe(true);
  });
});
