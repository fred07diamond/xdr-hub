// Lead routing in Settings, Organization (D79): grouped by the rule.
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

const person = (email: string, role: string | null, extra = {}) => ({
  email,
  displayName: email.split("@")[0],
  role,
  meetingLink: role ? `https://meetings.example.com/${email}` : null,
  saved: role !== null,
  seenAsPa: 0,
  seenAsAccountOwner: 0,
  roundRobinLeads: 0,
  ...extra,
});

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) => String(error),
  useActionQuery: () => ({
    isPending: false,
    refetch: () => {},
    data: {
      canEdit: true,
      commercialLine: 8000,
      people: [
        person("ent-a@example.com", "ae", { roundRobinLeads: 3 }),
        person("pa@example.com", "pa"),
        person("owner@example.com", null, { seenAsAccountOwner: 2 }),
      ],
    },
  }),
  useActionMutation: () => ({ mutate: () => {}, isPending: false }),
}));

describe("lead routing settings", () => {
  it("groups people by the routing rule", async () => {
    const { RoutingSettings } =
      await import("../../app/components/pa/routing-settings.js");
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RoutingSettings />
      </MemoryRouter>,
    );
    expect(html).toContain("Lead routing");
    expect(html).toContain("8,000 employees or fewer");
    expect(html).toContain("Set the Commercial AE");
    expect(html).toContain("3 leads from the round robin");
    expect(html).toContain("Add an Enterprise AE");
    expect(html).toContain("Product Advocates");
    expect(html).toContain("Seen on leads, not set up");
  });
});
