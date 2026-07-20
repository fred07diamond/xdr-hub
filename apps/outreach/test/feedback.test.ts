/**
 * Feedback system tests — Build 2 feedback redesign.
 *
 * Covers:
 *  1. DB schema    — sentiment column on feedback table
 *  2. Actions      — submit-feedback accepts sentiment; list-feedback returns sentiment
 *  3. UI — feedback.tsx has sentiment buttons, submit button, confirmation state
 *  4. Analytics — analytics.tsx shows FeedbackSection with list-feedback data
 *  5. Live smoke tests (server must be running on :8101)
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

async function callAction(name: string, body: Record<string, unknown>) {
  const res = await fetch(`${OUTREACH}/_agent-native/actions/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { ok: false, status: -1, body: null };
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body: json };
}

// ─── 1. DB schema ─────────────────────────────────────────────────────────────

describe("DB schema — sentiment column", () => {
  it("server/db/schema.ts feedback table has sentiment field", () => {
    const src = readFile("server/db/schema.ts");
    expect(src).toContain("sentiment");
    expect(src).toContain("feedback");
  });

  it("DB: feedback table has sentiment column (local SQLite only)", () => {
    if (!fs.existsSync(DB_PATH)) { console.warn("No local DB — skipping"); return; }
    const cols = sql("PRAGMA table_info(feedback)");
    expect(cols).toContain("sentiment");
  });

  it("migration 16 adds sentiment column with IF NOT EXISTS guard", () => {
    const src = readFile("server/plugins/db.ts");
    expect(src).toMatch(/version: 16/);
    expect(src).toContain("IF NOT EXISTS");
    expect(src).toContain("sentiment");
  });
});

// ─── 2. Actions ───────────────────────────────────────────────────────────────

describe("submit-feedback action", () => {
  it("accepts sentiment field in schema", () => {
    const src = readFile("actions/submit-feedback.ts");
    expect(src).toContain("sentiment");
    expect(src).toContain("positive");
    expect(src).toContain("negative");
  });

  it("message field is still required", () => {
    const src = readFile("actions/submit-feedback.ts");
    expect(src).toContain("message");
    expect(src).toContain("min(1)");
  });
});

describe("list-feedback action", () => {
  it("selects sentiment column", () => {
    const src = readFile("actions/list-feedback.ts");
    expect(src).toContain("sentiment");
  });

  it("is admin-only (calls requireAdmin)", () => {
    const src = readFile("actions/list-feedback.ts");
    expect(src).toContain("requireAdmin");
  });
});

// ─── 3. Feedback UI (feedback.tsx) ───────────────────────────────────────────

describe("feedback.tsx — sentiment + submit + confirmation", () => {
  it("has sentiment state (positive/negative)", () => {
    const src = readFile("app/routes/feedback.tsx");
    expect(src).toContain('"positive"');
    expect(src).toContain('"negative"');
  });

  it("renders two sentiment toggle buttons (thumbs up / thumbs down)", () => {
    const src = readFile("app/routes/feedback.tsx");
    expect(src).toContain("IconThumbUp");
    expect(src).toContain("IconThumbDown");
  });

  it("has a Submit Feedback button that requires sentiment and message", () => {
    const src = readFile("app/routes/feedback.tsx");
    expect(src).toContain("Submit Feedback");
    expect(src).toContain("!sentiment");
    expect(src).toContain("!message.trim()");
  });

  it("shows confirmation state after submit", () => {
    const src = readFile("app/routes/feedback.tsx");
    expect(src).toContain("submitted");
    expect(src).toContain("Thank you for your feedback");
  });

  it("has a reset / submit more link", () => {
    const src = readFile("app/routes/feedback.tsx");
    expect(src).toContain("Submit more feedback");
    expect(src).toContain("handleReset");
  });

  it("does NOT contain the admin feedback list (moved to analytics)", () => {
    const src = readFile("app/routes/feedback.tsx");
    expect(src).not.toContain("list-feedback");
    expect(src).not.toContain("All submissions");
  });
});

// ─── 4. Analytics dashboard — FeedbackSection ────────────────────────────────

describe("analytics.tsx — FeedbackSection", () => {
  it("imports list-feedback query", () => {
    const src = readFile("app/routes/analytics.tsx");
    expect(src).toContain("list-feedback");
  });

  it("renders FeedbackSection component", () => {
    const src = readFile("app/routes/analytics.tsx");
    expect(src).toContain("FeedbackSection");
  });

  it("shows sentiment icons in feedback list", () => {
    const src = readFile("app/routes/analytics.tsx");
    expect(src).toContain("IconThumbUp");
    expect(src).toContain("IconThumbDown");
  });

  it("shows positive/negative counts summary", () => {
    const src = readFile("app/routes/analytics.tsx");
    expect(src).toContain("positiveCount");
    expect(src).toContain("negativeCount");
  });
});

// ─── 5. Live smoke tests ──────────────────────────────────────────────────────

describe("live: submit-feedback", () => {
  it("accepts a submission with sentiment and message", async () => {
    if (!serverRunning()) { console.warn("Server not running — skipping"); return; }
    const result = await callAction("submit-feedback", {
      sentiment: "positive",
      message: "Test feedback from automated test suite",
    });
    expect(result.ok).toBe(true);
    expect(result.body?.ok).toBe(true);
  });

  it("rejects empty message", async () => {
    if (!serverRunning()) { console.warn("Server not running — skipping"); return; }
    const result = await callAction("submit-feedback", { sentiment: "positive", message: "" });
    expect(result.ok).toBe(false);
  });

  it("list-feedback requires admin (returns 403 without auth)", async () => {
    if (!serverRunning()) { console.warn("Server not running — skipping"); return; }
    const res = await fetch(`${OUTREACH}/_agent-native/actions/list-feedback`).catch(() => null);
    if (!res) return;
    expect([401, 403]).toContain(res.status);
  });
});
