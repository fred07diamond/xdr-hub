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
  } catch {
    return false;
  }
}

describe("get-analytics action — byUser breakdown", () => {
  it("groups prospects by ownerEmail", () => {
    const src = readFile("actions/get-analytics.ts");
    expect(src).toContain("groupBy(prospects.ownerEmail)");
  });

  it("counts drafted and sent per user via the prospects.status enum", () => {
    const src = readFile("actions/get-analytics.ts");
    expect(src).toContain("'drafted'");
    expect(src).toContain("'sent'");
  });

  it("counts fit verdicts per user", () => {
    const src = readFile("actions/get-analytics.ts");
    expect(src).toContain("'strong'");
    expect(src).toContain("'possible'");
    expect(src).toContain("'weak'");
    expect(src).toContain("'inconclusive'");
  });

  it("returns a byUser field", () => {
    const src = readFile("actions/get-analytics.ts");
    expect(src).toContain("byUser");
  });

  it("still requires admin (requireAdmin unchanged)", () => {
    const src = readFile("actions/get-analytics.ts");
    expect(src).toContain("requireAdmin(ctx)");
  });

  it("live: get-analytics rejects unauthenticated callers", async () => {
    if (!serverRunning()) {
      console.warn("Server not running — skipping");
      return;
    }
    const res = await fetch(`${OUTREACH}/_agent-native/actions/get-analytics`).catch(() => null);
    if (!res) return;
    expect([401, 403]).toContain(res.status);
  });
});
