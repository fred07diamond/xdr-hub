// The playbook page shows one section at a time, with plain titles and no
// ids or chips on the cards unless something needs attention.
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { seedRelease } from "../../server/core/playbook/release.js";
import { entryTitle, SECTIONS } from "../../shared/playbook-blocks.js";

const view = {
  release: { shortId: seedRelease.short_id, pendingConfirmations: 0 },
  viewer: { role: "pa_team", isAppOwner: false },
  sections: SECTIONS.map((section) => ({
    ...section,
    blocks: seedRelease.entries
      .filter((entry) => entry.section === section.id)
      .map((entry) => ({
        target: entry.id,
        title: entryTitle(entry.id),
        kind: "entry",
        block: entry.block ?? null,
        blockLabel: "Block",
        section: section.id,
        position: entry.position ?? 0,
        ownerTeam: entry.owner_team,
        owner: entry.owner,
        version: entry.version,
        status: entry.status ?? "active",
        enforcement: "guidance",
        body: entry.body ?? null,
        data: entry.params ?? {},
        raw: entry,
        pending: [],
        openFindings: [],
      })),
  })),
  palette: [],
  takenIds: [],
  myDraft: null,
  openChanges: [],
};

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) => String(error),
  useActionQuery: () => ({ data: view, isPending: false, refetch: () => {} }),
  useActionMutation: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: () => {},
}));

describe("playbook page", () => {
  it("shows the chosen section with plain titles and no ids", async () => {
    const { default: PlaybookRoute } =
      await import("../../app/routes/playbook._index.js");
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/playbook?section=messaging"]}>
        <PlaybookRoute />
      </MemoryRouter>,
    );
    expect(html).toContain("First touch structure (TCQ)");
    expect(html).toContain("Highly Qualified Content");
    expect(html).not.toContain("msg.first_touch.structure");
    // Other sections are in the nav, not rendered as blocks.
    expect(html).toContain("Definitions");
    expect(html).not.toContain("Qualified lead (QL)");
  });
});
