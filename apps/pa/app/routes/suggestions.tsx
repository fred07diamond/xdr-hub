import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { IconBulb } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Panel } from "@/components/pa/playbook";
import { EmptyState, ErrorState } from "@/components/pa/states";
import { Button } from "@/components/ui/button";
import { APP_TITLE } from "@/lib/app-config";
import { cn } from "@/lib/utils";

export function meta() {
  return [{ title: `Suggestions - ${APP_TITLE}` }];
}

interface Suggestion {
  id: string;
  kind: string;
  audience: string;
  title: string;
  body: string;
  source: string;
  changeId: string | null;
  status: string;
  createdAt: string;
}

const KIND: Record<string, string> = {
  feature: "Build",
  crm_field: "CRM field",
  view: "Reorganize",
  playbook: "Playbook",
  knowledge: "Knowledge",
};
const AUDIENCE: Record<string, string> = {
  app_owner: "App owner",
  revops: "RevOps",
  pa_team: "PA team",
};
const STATUSES = ["open", "accepted", "done", "dismissed"] as const;

export default function SuggestionsRoute() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("open");
  const query = useActionQuery("list-suggestions", { status: [status] });
  const update = useActionMutation("update-suggestion");
  const data = query.data as
    | { viewer: { audiences: string[] }; suggestions: Suggestion[] }
    | undefined;

  function decide(id: string, next: (typeof STATUSES)[number]) {
    update.mutate(
      { suggestionId: id, status: next },
      {
        onSuccess: () => void query.refetch(),
        onError: (error) => toast.error(actionErrorMessage(error)),
      },
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[1000px] gap-4 px-3 py-4 sm:px-4 md:px-6 md:py-5">
      <div
        className="flex flex-wrap items-center gap-2"
        role="tablist"
        aria-label="Suggestion status"
      >
        {STATUSES.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={status === item}
            onClick={() => setStatus(item)}
            className={cn(
              "h-8 rounded-md px-3 text-[13px] capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              status === item
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {item}
          </button>
        ))}
        {data ? (
          <span className="ml-auto text-[12.5px] text-muted-foreground">
            For{" "}
            {data.viewer.audiences
              .map((audience) => AUDIENCE[audience] ?? audience)
              .join(", ") || "nobody: you have no playbook role"}
          </span>
        ) : null}
      </div>

      {query.isPending ? (
        <p className="text-[13px] text-muted-foreground">
          Loading suggestions...
        </p>
      ) : !data ? (
        <ErrorState
          title="Couldn't load suggestions"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : data.suggestions.length === 0 ? (
        <EmptyState
          icon={IconBulb}
          title={
            status === "open" ? "Nothing to decide" : `No ${status} suggestions`
          }
        >
          <p>
            Suggestions appear when a playbook change needs something the app or
            the CRM does not have yet, and when the agent reviews a release or
            the week's work.
          </p>
        </EmptyState>
      ) : (
        data.suggestions.map((suggestion) => (
          <Panel
            key={suggestion.id}
            title={suggestion.title}
            aside={
              <span className="text-[12px] text-muted-foreground">
                {KIND[suggestion.kind] ?? suggestion.kind} for{" "}
                {AUDIENCE[suggestion.audience] ?? suggestion.audience}
                {suggestion.source === "agent"
                  ? ", from the agent"
                  : ", from the checks"}
              </span>
            }
          >
            <p className="whitespace-pre-line text-[13px] text-foreground">
              {suggestion.body}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {suggestion.status === "open" ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    disabled={update.isPending}
                    onClick={() => decide(suggestion.id, "accepted")}
                  >
                    Accept
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={update.isPending}
                    onClick={() => decide(suggestion.id, "dismissed")}
                  >
                    Dismiss
                  </Button>
                </>
              ) : suggestion.status === "accepted" ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={update.isPending}
                  onClick={() => decide(suggestion.id, "done")}
                >
                  Mark done
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={update.isPending}
                  onClick={() => decide(suggestion.id, "open")}
                >
                  Reopen
                </Button>
              )}
              {suggestion.changeId ? (
                <Link
                  to={`/playbook/changes/${suggestion.changeId}`}
                  className="text-[12.5px] text-muted-foreground underline-offset-2 hover:underline"
                >
                  From this change
                </Link>
              ) : null}
            </div>
          </Panel>
        ))
      )}
    </div>
  );
}
