import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  RELEASE_ARTIFACT,
  readCompileInputs,
} from "../../scripts/_playbook-sources.js";
import {
  compilePlaybook,
  PlaybookCompileError,
  serializeRelease,
  type CompileInput,
} from "../../server/core/playbook/compile.js";
import { seedRelease } from "../../server/core/playbook/release.js";
import {
  PlaybookEntryError,
  rule,
} from "../../server/core/playbook/resolve.js";
import { releaseWith } from "../helpers.js";

function withPlaybook(input: CompileInput, text: string): CompileInput {
  return { ...input, playbooks: [{ path: "playbook/test.yaml", text }] };
}

describe("playbook compile", () => {
  const inputs = readCompileInputs();

  it("matches the committed release artifact (run pnpm playbook:compile when this fails)", () => {
    const committed = readFileSync(RELEASE_ARTIFACT, "utf8");
    expect(serializeRelease(compilePlaybook(inputs))).toBe(committed);
  });

  it("uses a stable content hash as the release id", () => {
    const again = compilePlaybook(readCompileInputs());
    expect(again.id).toBe(seedRelease.id);
    expect(again.id).toMatch(/^[0-9a-f]{64}$/);
    expect(again.short_id).toBe(again.id.slice(0, 8));
  });

  it("changes the release id when any entry changes", () => {
    const edited = inputs.playbooks[0].text.replace("days: 90", "days: 60");
    expect(compilePlaybook(withPlaybook(inputs, edited)).id).not.toBe(
      seedRelease.id,
    );
  });

  it("records every TODO as a pending confirmation", () => {
    const pending = seedRelease.pending_confirmation.map(
      (item) => `${item.entry_id ?? item.source}:${item.path}`,
    );
    expect(pending).toEqual(
      expect.arrayContaining([
        "rule.precheck.restricted_countries:params.countries",
        "rule.routing.order:params.agency_partner_rep",
        "rule.routing.sal_stale_days:params.days",
        "kb.trial_path_partner_led:status",
        "config/routing-pool.yaml:pool",
        "config/hubspot-mapping.yaml:lifecycle_values.sal",
      ]),
    );
  });

  it("keeps keys outside the entry schema visible instead of dropping them", () => {
    expect(seedRelease.unrecognized_keys).toEqual([
      {
        entry_id: "rule.precheck.outcomes",
        key: "open_work_policy",
        value: "new_work_only",
      },
    ]);
  });

  it("rejects duplicate ids and invalid entries", () => {
    const duplicate = `entries:
  - { id: def.ql, type: definition, block: definition, section: definitions, owner: RevOps, owner_team: revops, version: 1, body: "a" }
  - { id: def.ql, type: definition, block: definition, section: definitions, owner: RevOps, owner_team: revops, version: 2, body: "b" }
`;
    expect(() => compilePlaybook(withPlaybook(inputs, duplicate))).toThrow(
      PlaybookCompileError,
    );
    const missingParams = `entries:
  - { id: rule.x, type: rule, block: custom_rule, section: routing, owner: RevOps, owner_team: revops, version: 1 }
`;
    expect(() => compilePlaybook(withPlaybook(inputs, missingParams))).toThrow(
      /rules need params/,
    );
  });
});

describe("typed rule params", () => {
  it("parses seed rule params", () => {
    expect(rule(seedRelease, "rule.sla.first_touch").params.minutes).toBe(30);
    expect(rule(seedRelease, "rule.routing.order").params.order[0]).toBe(
      "existing_active_owner",
    );
  });

  it("fails loudly on params the rule functions cannot use", () => {
    const broken = releaseWith("rule.sla.first_touch", { minutes: "sixty" });
    expect(() => rule(broken, "rule.sla.first_touch")).toThrow(
      PlaybookEntryError,
    );
  });
});
