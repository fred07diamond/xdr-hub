import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * EVERY completeText call must set `reasoningEffort` explicitly.
 *
 * Omitting it takes the engine default, which the framework resolves to
 * Medium or High (@agent-native/core's reasoning-effort module: "engine
 * defaults resolve it to High", and a missing selection "now means the Medium
 * default"). Anthropic's manual thinking budgets start at 1024 tokens and
 * reach 8000 for medium.
 *
 * Every call in this app caps maxOutputTokens well BELOW 1024 -- several at 5,
 * 30, 80, 120. With default effort, thinking consumes the whole allowance and
 * the answer comes back empty. It also makes latency independent of input
 * size, which is what turned a 224-lead import into a 504 from the corporate
 * proxy.
 *
 * I fixed three call sites when I first found this and assumed that was the
 * scope. There were fourteen. This test exists because I got that wrong, and
 * the failure mode is silent: an empty completion surfaces as an unscored
 * lead, a missing persona, or a dead button -- never as an error that names
 * the cause.
 */

const ROOT = new URL("../", import.meta.url);

function walk(dir: URL, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const child = new URL(`${entry}${entry.includes(".") ? "" : "/"}`, dir);
    if (statSync(child).isDirectory()) walk(child, out);
    else if (entry.endsWith(".ts")) out.push(child.pathname);
  }
  return out;
}

function sourceFilesWithCompleteText(): string[] {
  const files = [
    ...walk(new URL("server/", ROOT)),
    ...walk(new URL("actions/", ROOT)),
  ];
  return files.filter((f) => readFileSync(f, "utf8").includes("completeText({"));
}

const CALLERS = sourceFilesWithCompleteText();

describe("completeText callers", () => {
  it("finds the call sites", () => {
    // A guard on the guard: if the scan breaks, everything below passes
    // vacuously and the bug returns unnoticed.
    expect(CALLERS.length).toBeGreaterThan(10);
  });

  it.each(CALLERS.map((f) => [f.replace(ROOT.pathname, ""), f]))(
    "%s sets reasoningEffort on every call",
    (_label, file) => {
      const src = readFileSync(file, "utf8");
      const calls = (src.match(/completeText\(\{/g) ?? []).length;
      const efforts = (src.match(/reasoningEffort:/g) ?? []).length;
      // At least one per call. A file may legitimately set it more than once
      // (persona-briefing declares a shared constant and passes it).
      expect(efforts).toBeGreaterThanOrEqual(calls);
    },
  );

  it.each(CALLERS.map((f) => [f.replace(ROOT.pathname, ""), f]))(
    "%s does not cap output below a thinking budget without disabling thinking",
    (_label, file) => {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/maxOutputTokens:\s*(\d+)/g)) {
        const cap = Number(m[1]);
        if (cap < 1024) {
          // Below Anthropic's smallest thinking budget, so thinking MUST be
          // off or the answer is starved.
          expect(src, `${file} caps output at ${cap}`).toMatch(/reasoningEffort:\s*"none"/);
        }
      }
    },
  );
});

describe("the import cannot be taken down by its optional enrichment", () => {
  const SRC = readFileSync(new URL("actions/import-sales-nav-list.ts", ROOT), "utf8");

  it("bounds how many leads are classified inline", () => {
    // A 224-lead import died with a 504 "Inactivity Timeout" from the
    // corporate proxy, because persona classification is one LLM call over
    // every lead in the batch.
    expect(SRC).toContain("PERSONA_CLASSIFY_LIMIT");
    expect(SRC).toContain("deduped.slice(0, PERSONA_CLASSIFY_LIMIT)");
  });

  it("still inserts every lead, persona or not", () => {
    // The insert maps over `deduped`, not the classified subset, and the
    // persona fields are optional-chained -- so a lead past the limit is
    // inserted with no persona and picks one up when the sweep scores it.
    expect(SRC).toContain("deduped.map((lead, i) =>");
    expect(SRC).toContain("persona?.personaId ?? null");
  });

  it("time-boxes the classification call itself", () => {
    // Failure was already non-fatal; SLOWNESS was not, so a slow call took
    // the whole import down with it.
    const SEL = readFileSync(new URL("server/helpers/select-persona.ts", ROOT), "utf8");
    expect(SEL).toMatch(/timeoutMs: 10_000/);
  });
});
