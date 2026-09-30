// CRM connections (D47): the app owner's page for CRM credentials. Values are
// written once and never shown again; the page only ever sees status.
import { appPath } from "@agent-native/core/client/api-path";
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import {
  IconExternalLink,
  IconLock,
  IconPlugConnected,
} from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Panel } from "@/components/pa/playbook";
import { EmptyState, ErrorState } from "@/components/pa/states";
import { Button } from "@/components/ui/button";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `CRM connections - ${APP_TITLE}` }];
}

interface Provider {
  id: "hubspot" | "salesforce";
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

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

function TokenForm({
  provider,
  onSaved,
}: {
  provider: Provider;
  onSaved: () => void;
}) {
  const save = useActionMutation("set-crm-credential");
  const [token, setToken] = useState("");
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(
          { provider: "hubspot", token },
          {
            onSuccess: (result) => {
              setToken("");
              toast.success(
                `Saved and tested: ${(result as { message: string }).message}`,
              );
              onSaved();
            },
            onError: (error) => toast.error(actionErrorMessage(error)),
          },
        );
      }}
    >
      <label className="grid gap-1.5 text-[12.5px] font-medium">
        {provider.token?.set
          ? `Replace the ${provider.tokenLabel?.toLowerCase()}`
          : provider.tokenLabel}
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="h-8 w-full rounded-md border border-input bg-background px-2.5 font-mono text-[13px] shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="pat-..."
        />
      </label>
      <p className="text-[12px] text-muted-foreground">{provider.tokenHint}</p>
      <div>
        <Button
          type="submit"
          size="sm"
          disabled={token.trim().length < 10 || save.isPending}
        >
          <IconLock className="size-4" aria-hidden="true" />
          {save.isPending ? "Testing..." : "Test and save"}
        </Button>
      </div>
    </form>
  );
}

function ProviderCard({
  provider,
  onChanged,
}: {
  provider: Provider;
  onChanged: () => void;
}) {
  const test = useActionMutation("test-crm-connection");
  const remove = useActionMutation("remove-crm-credential");
  const [confirming, setConfirming] = useState(false);
  const connected =
    provider.token?.set ||
    provider.oauth.some((item) => item.status === "connected");
  return (
    <Panel
      title={provider.label}
      aside={
        <span
          className={
            connected
              ? "text-[12px] font-medium text-foreground"
              : "text-[12px] text-muted-foreground"
          }
        >
          {connected ? "Connected" : "Not connected"}
          {provider.adapterBuilt ? "" : ", adapter not built yet"}
        </span>
      }
    >
      <div className="grid gap-4 text-[13px]">
        {provider.token ? (
          <div className="grid gap-2">
            {provider.token.set ? (
              <p className="text-foreground">
                Token saved
                {provider.token.last4 ? `, ending ${provider.token.last4}` : ""}
                {provider.token.updatedAt
                  ? `, updated ${when(provider.token.updatedAt)}`
                  : ""}
                .
                {provider.token.source === "env"
                  ? " It comes from an environment variable; save one here to manage it in the app."
                  : ""}
              </p>
            ) : (
              <p className="text-muted-foreground">No token saved.</p>
            )}
            <p className="text-[12px] text-muted-foreground">
              Stored encrypted for the whole organization. Every xDR Hub app
              that reads HubSpot uses this token, and it is never shown again
              after saving.
            </p>
            <TokenForm provider={provider} onSaved={onChanged} />
            {provider.token.set ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={test.isPending}
                  onClick={() =>
                    test.mutate(
                      { provider: "hubspot" },
                      {
                        onSuccess: (result) => {
                          const outcome = result as {
                            ok: boolean;
                            message: string;
                          };
                          if (outcome.ok) toast.success(outcome.message);
                          else toast.error(outcome.message);
                        },
                        onError: (error) =>
                          toast.error(actionErrorMessage(error)),
                      },
                    )
                  }
                >
                  {test.isPending ? "Testing..." : "Test the saved token"}
                </Button>
                {confirming ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      disabled={remove.isPending}
                      onClick={() =>
                        remove.mutate(
                          { provider: "hubspot" },
                          {
                            onSuccess: () => {
                              setConfirming(false);
                              toast.success("Token removed");
                              onChanged();
                            },
                            onError: (error) =>
                              toast.error(actionErrorMessage(error)),
                          },
                        )
                      }
                    >
                      Remove it for every app
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirming(false)}
                    >
                      Keep it
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirming(true)}
                  >
                    Remove token
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-2">
          <div className="text-[12.5px] font-medium text-foreground">OAuth</div>
          {provider.oauth.length > 0 ? (
            <ul className="grid gap-1">
              {provider.oauth.map((connection) => (
                <li key={connection.id}>
                  {connection.label}
                  {connection.accountLabel
                    ? ` (${connection.accountLabel})`
                    : ""}
                  : {connection.status}
                  {connection.updatedAt
                    ? `, updated ${when(connection.updatedAt)}`
                    : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No OAuth connection yet.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <a
                href={appPath(
                  `/_agent-native/connections/oauth/${provider.id}/start`,
                )}
              >
                <IconPlugConnected className="size-4" aria-hidden="true" />
                Connect {provider.label} with OAuth
              </a>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <a href={provider.docsUrl} target="_blank" rel="noreferrer">
                Setup guide
                <IconExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            </Button>
          </div>
          <p className="text-[12px] text-muted-foreground">
            OAuth needs the workspace's {provider.label} client credentials; if
            the button reports they are missing, add them in Dispatch.
            {provider.adapterBuilt
              ? ""
              : ` PA can store a ${provider.label} connection now, but reads from it only once its adapter is built; choosing it in the CRM system block sends that build request.`}
          </p>
        </div>
      </div>
    </Panel>
  );
}

export default function CrmConnectionsRoute() {
  const query = useActionQuery("list-crm-connections", {});
  const data = query.data as
    | { orgId: string | null; providers: Provider[] }
    | undefined;
  return (
    <div className="mx-auto grid w-full max-w-[900px] gap-4 px-3 py-4 sm:px-4 md:px-6 md:py-5">
      <p className="text-[13px] text-muted-foreground">
        The CRMs PA can read from. Which one PA uses, and how its fields map,
        lives in the playbook's{" "}
        <Link to="/playbook" className="underline underline-offset-2">
          CRM section
        </Link>
        , owned by RevOps. PA only ever reads from the CRM.
      </p>
      {query.isPending ? (
        <p className="text-[13px] text-muted-foreground">
          Loading connections...
        </p>
      ) : !data ? (
        <ErrorState
          title="Couldn't load CRM connections"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : !data.orgId ? (
        <EmptyState icon={IconLock} title="No organization in this session">
          <p>
            CRM credentials are saved for an organization. Sign in through the
            workspace to manage them.
          </p>
        </EmptyState>
      ) : (
        data.providers.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            onChanged={() => void query.refetch()}
          />
        ))
      )}
    </div>
  );
}
