/**
 * Resend invite tests
 * 1. Source — OrgMembersSection exists in settings.tsx with inline Resend button
 * 2. Source — resend-invite action exists with correct schema
 * 3. Source — resend-invite action calls requireAdmin (server enforces, UI should not gate)
 * 4. Live — action returns 4xx without auth
 */
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const OUTREACH = "http://127.0.0.1:8101/outreach";

function readFile(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), "utf8");
}

function serverRunning(): boolean {
  try {
    const { execSync } = require("child_process");
    execSync(`curl -s --max-time 2 "${OUTREACH}/_agent-native/actions/get-draft?profileUrl=x" -o /dev/null`, { stdio: "pipe" });
    return true;
  } catch { return false; }
}

async function callAction(name: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`${OUTREACH}/_agent-native/actions/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { ok: false, status: -1, body: null };
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body: json };
}

// ─── 1. Settings UI ──────────────────────────────────────────────────────────

describe("settings.tsx — OrgMembersSection", () => {
  it("renders OrgMembersSection in the settings file", () => {
    const src = readFile("app/routes/settings.tsx");
    expect(src).toContain("OrgMembersSection");
  });

  it("is injected via enhancedTabs on the organization tab (not team prop)", () => {
    const src = readFile("app/routes/settings.tsx");
    expect(src).toContain("enhancedTabs");
    expect(src).toContain('tab.id === "organization"');
    expect(src).toContain("extraTabs={enhancedTabs}");
    // Must reconstruct content directly, not wrap tab.content in Fragment
    expect(src).not.toContain("{tab.content}");
    expect(src).toContain("<OrgMembersSection />");
  });

  it("does NOT gate resend on canManageOrg (server enforces auth)", () => {
    const src = readFile("app/routes/settings.tsx");
    const sectionFn = src.slice(src.indexOf("function OrgMembersSection"), src.indexOf("export function meta"));
    expect(sectionFn).not.toContain("if (isLoading || !canManageOrg) return null");
    expect(sectionFn).not.toContain("if (!canManageOrg) return null");
  });

  it("has inline Resend button and Invited badge for pending invitations", () => {
    const src = readFile("app/routes/settings.tsx");
    expect(src).toContain("Resend");
    expect(src).toContain("Invited");
    expect(src).toContain("resend-invite");
  });

  it("has an email input for inviting members", () => {
    const src = readFile("app/routes/settings.tsx");
    expect(src).toContain('type="email"');
  });
});

// ─── 2. Action source ────────────────────────────────────────────────────────

describe("resend-invite action", () => {
  it("exists", () => {
    expect(fs.existsSync(path.resolve(ROOT, "actions/resend-invite.ts"))).toBe(true);
  });

  it("validates email field", () => {
    const src = readFile("actions/resend-invite.ts");
    expect(src).toContain("z.string().email()");
  });

  it("calls requireAdmin (server-side auth enforcement)", () => {
    const src = readFile("actions/resend-invite.ts");
    expect(src).toContain("requireAdmin");
  });

  it("calls Resend API directly using RESEND_API_KEY from process.env", () => {
    const src = readFile("actions/resend-invite.ts");
    expect(src).toContain("RESEND_API_KEY");
    expect(src).toContain("api.resend.com/emails");
  });
});

// ─── 3. Live ─────────────────────────────────────────────────────────────────

describe("live: resend-invite", () => {
  it("rejects unauthenticated call", async () => {
    if (!serverRunning()) { console.warn("Server not running — skipping"); return; }
    const result = await callAction("resend-invite", { email: "test@example.com" });
    expect(result.ok).toBe(false);
    expect([401, 403]).toContain(result.status);
  });
});
