// CRM connections (D47): the owner's secure home for CRM credentials. Keys are
// stored by the framework's encrypted secret store at org scope, the slot the
// shared HubSpot client (@xdr-hub/shared) and the Dispatch vault use, so every
// xDR Hub app reads the same key. No action ever returns a value.
// Docs: secrets skill; dist/secrets/storage.d.ts; workspace-connections.
import {
  deleteAppSecret,
  getAppSecretMeta,
  readAppSecret,
  writeAppSecret,
} from "@agent-native/core/secrets";
import { listWorkspaceConnectionsForApp } from "@agent-native/core/workspace-connections";

export const CRM_PROVIDERS = [
  {
    id: "hubspot",
    label: "HubSpot",
    secretKey: "HUBSPOT_ACCESS_TOKEN",
    tokenLabel: "Private app access token",
    tokenHint:
      "HubSpot > Settings > Integrations > Private apps. Read scopes only: crm.objects.contacts/companies/deals.read, crm.schemas.contacts/companies/deals.read, crm.objects.owners.read.",
    docsUrl: "https://developers.hubspot.com/docs/api/private-apps",
    oauth: true,
    adapterBuilt: true,
  },
  {
    id: "salesforce",
    label: "Salesforce",
    secretKey: null,
    tokenLabel: null,
    tokenHint: "Salesforce connects with OAuth only.",
    docsUrl:
      "https://help.salesforce.com/s/articleView?id=sf.connected_app_overview.htm",
    oauth: true,
    adapterBuilt: false,
  },
] as const;
export type CrmProviderId = (typeof CRM_PROVIDERS)[number]["id"];

export function crmProvider(id: string) {
  return CRM_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

const TEST_TIMEOUT_MS = 10_000;

/**
 * A read-only call that proves a HubSpot token works: one owner.
 * https://developers.hubspot.com/docs/api/crm/owners
 */
export async function testHubSpotToken(
  token: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch(
      "https://api.hubapi.com/crm/v3/owners?limit=1",
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      },
    );
    if (response.ok) return { ok: true, message: "HubSpot accepted the token" };
    if (response.status === 401)
      return { ok: false, message: "HubSpot rejected the token (401)" };
    if (response.status === 403) {
      return {
        ok: false,
        message:
          "The token works but lacks a read scope PA needs (403). Add crm.objects.owners.read and the CRM read scopes.",
      };
    }
    return { ok: false, message: `HubSpot answered ${response.status}` };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `Could not reach HubSpot: ${error.message}`
          : "Could not reach HubSpot",
    };
  }
}

export interface CrmConnectionStatus {
  id: CrmProviderId;
  label: string;
  adapterBuilt: boolean;
  token: null | {
    set: boolean;
    last4: string | null;
    updatedAt: string | null;
    source: "vault" | "env" | null;
  };
  oauth: Array<{
    id: string;
    label: string;
    status: string;
    accountLabel: string | null;
    updatedAt: string | null;
  }>;
  tokenLabel: string | null;
  tokenHint: string;
  docsUrl: string;
}

export async function crmConnectionStatus(
  orgId: string | null,
): Promise<CrmConnectionStatus[]> {
  return Promise.all(
    CRM_PROVIDERS.map(async (provider) => {
      let token: CrmConnectionStatus["token"] = null;
      if (provider.secretKey) {
        const meta = orgId
          ? await getAppSecretMeta({
              key: provider.secretKey,
              scope: "org",
              scopeId: orgId,
            })
          : null;
        // guard:allow-env-credential — presence check only (never read or returned): shows that a bootstrap env fallback is in use
        const envSet = Boolean(process.env[provider.secretKey]);
        token = meta
          ? {
              set: true,
              last4: meta.last4 ?? null,
              updatedAt: meta.updatedAt ? String(meta.updatedAt) : null,
              source: "vault",
            }
          : {
              set: envSet,
              last4: null,
              updatedAt: null,
              source: envSet ? "env" : null,
            };
      }
      let oauth: CrmConnectionStatus["oauth"] = [];
      try {
        oauth = (
          await listWorkspaceConnectionsForApp({
            appId: "pa",
            provider: provider.id,
          })
        ).map((connection) => ({
          id: connection.id,
          label: connection.label ?? provider.label,
          status: connection.status,
          accountLabel: connection.accountLabel ?? null,
          updatedAt: connection.updatedAt ? String(connection.updatedAt) : null,
        }));
      } catch {
        oauth = [];
      }
      return {
        id: provider.id,
        label: provider.label,
        adapterBuilt: provider.adapterBuilt,
        token,
        oauth,
        tokenLabel: provider.tokenLabel,
        tokenHint: provider.tokenHint,
        docsUrl: provider.docsUrl,
      };
    }),
  );
}

export async function saveCrmToken(
  provider: CrmProviderId,
  orgId: string,
  value: string,
) {
  const def = crmProvider(provider);
  if (!def?.secretKey)
    throw new Error(`${def?.label ?? provider} does not use a token`);
  await writeAppSecret({
    key: def.secretKey,
    scope: "org",
    scopeId: orgId,
    value,
    description: `${def.label} CRM access for PA and the xDR Hub apps, set on PA's CRM connections page`,
    // JSON-stringified origins (dist/secrets/storage.d.ts).
    urlAllowlist: JSON.stringify(["https://api.hubapi.com"]),
  });
}

export async function removeCrmToken(provider: CrmProviderId, orgId: string) {
  const def = crmProvider(provider);
  if (!def?.secretKey) return false;
  return deleteAppSecret({ key: def.secretKey, scope: "org", scopeId: orgId });
}

/** The stored token, server-side only, for the test action. */
export async function storedCrmToken(
  provider: CrmProviderId,
  orgId: string | null,
): Promise<string | null> {
  const def = crmProvider(provider);
  if (!def?.secretKey) return null;
  if (orgId) {
    const stored = await readAppSecret({
      key: def.secretKey,
      scope: "org",
      scopeId: orgId,
    });
    if (stored?.value) return stored.value;
  }
  // guard:allow-env-credential — env fallback only when no vault-stored secret exists (single-workspace bootstrap and local dev)
  return process.env[def.secretKey] ?? null;
}
