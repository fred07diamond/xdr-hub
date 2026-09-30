import { describe, expect, it } from "vitest";

import { APPROACHES } from "../../server/core/drafting/index.js";
import { messagingGuide } from "../../server/core/playbook/messaging.js";
import { seedRelease } from "../../server/core/playbook/release.js";

describe("the playbook's Messaging section (D65)", () => {
  it("holds the TCQ rubric, voice, questions, and the example", () => {
    const ids = messagingGuide(seedRelease, null).rules.map((rule) => rule.id);
    for (const id of [
      "msg.first_touch.structure",
      "msg.first_touch.voice",
      "msg.first_touch.questions",
      "msg.first_touch.example",
    ])
      expect(ids).toContain(id);
  });

  it("gives every sales class its formula and nothing from other classes", () => {
    for (const approach of APPROACHES.filter((item) => item !== "not_sales")) {
      const rules = messagingGuide(seedRelease, approach).rules;
      const scoped = rules.filter((rule) => rule.appliesTo !== null);
      expect(scoped.map((rule) => rule.appliesTo)).toEqual([approach]);
      expect(rules[0].id).toBe("msg.first_touch.structure");
    }
  });

  it("keeps dashes out of the guidance", () => {
    for (const rule of messagingGuide(seedRelease, null).rules)
      expect(rule.body ?? "").not.toMatch(/[—–]/);
  });
});
