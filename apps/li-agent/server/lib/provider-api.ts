import {
  createProviderApiRuntime,
  type ProviderApiId,
  type ProviderApiMethod,
  type ProviderApiRequestArgs,
} from "@agent-native/core/provider-api";
import { getCredentialContext } from "@agent-native/core/server";

export const LI_AGENT_APP_ID = "li-agent";
export type { ProviderApiId, ProviderApiMethod, ProviderApiRequestArgs };

// Mirrors apps/dispatch/server/lib/provider-api.ts -- raw provider API calls
// (Notion search + block traversal for the ICP persona-doc picker) go through
// the same createProviderApiRuntime path Dispatch uses for its own workspace
// connections, so credential resolution (workspace OAuth connection first,
// falling back to a local credential) and app-access-grant enforcement work
// identically instead of reinventing them here.
const runtime = createProviderApiRuntime({
  appId: LI_AGENT_APP_ID,
  providerIds: ["notion"],
  localCredentialSource: "li_agent_local",
  getCredentialContext: () => {
    const ctx = getCredentialContext();
    if (!ctx) {
      throw new Error(
        "Notion requests require an authenticated request context.",
      );
    }
    return ctx;
  },
});

export interface ProviderApiResult {
  response: {
    status: number;
    ok: boolean;
    json?: unknown;
    text?: string;
  };
  guidance?: string | null;
}

export async function executeProviderApiRequest(
  args: ProviderApiRequestArgs,
): Promise<ProviderApiResult> {
  return (await runtime.executeRequest(args)) as ProviderApiResult;
}
