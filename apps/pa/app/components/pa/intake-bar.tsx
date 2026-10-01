// Live intake controls on the board (D54): when leads were last pulled from
// HubSpot, what is waiting on the agent, and the two buttons that matter.
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { IconCloudDownload, IconRefresh, IconRobot } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/format";

interface IntakeStatus {
  lastPull: {
    at: string;
    by: string;
    found?: number;
    new?: number;
    failed?: number;
  } | null;
  agentWork: number;
  agentEnabled: boolean | null;
  canPull: boolean;
  isAppOwner: boolean;
}

export function IntakeBar({ onPulled }: { onPulled: () => void }) {
  const status = useActionQuery("get-intake-status", {});
  const pull = useActionMutation("pull-contact-sales");
  const enable = useActionMutation("enable-inbound-agent");
  const refreshAll = useActionMutation("refresh-all-leads");
  const data = status.data as IntakeStatus | undefined;
  if (!data) return null;
  const last = data.lastPull;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
      <span>
        {last
          ? `HubSpot pulled ${formatRelative(last.at)}, ${last.new ?? 0} new`
          : "No leads pulled from HubSpot yet"}
        {data.agentWork > 0 ? ` · ${data.agentWork} waiting for the agent` : ""}
      </span>
      {data.isAppOwner && data.agentEnabled === false ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={enable.isPending}
          onClick={() =>
            enable.mutate(
              {},
              {
                onSuccess: () => {
                  toast.success(
                    "Inbound agent on: it pulls leads and drafts replies every 30 minutes. Nothing is sent.",
                  );
                  void status.refetch();
                },
                onError: (error) => toast.error(actionErrorMessage(error)),
              },
            )
          }
        >
          <IconRobot className="size-4" aria-hidden="true" />
          Turn on the inbound agent
        </Button>
      ) : null}
      {data.canPull ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={refreshAll.isPending}
          title="Re-read every undecided lead from HubSpot and run it through today's triage, class, brief, draft, and decision, so older leads match new ones."
          onClick={() =>
            refreshAll.mutate(
              {},
              {
                onSuccess: (raw) => {
                  const result = raw as { queued: number };
                  toast.success(
                    result.queued > 0
                      ? `Refreshing ${result.queued} ${result.queued === 1 ? "lead" : "leads"} from HubSpot. They update over the next few minutes.`
                      : "No undecided leads to refresh.",
                  );
                  onPulled();
                },
                onError: (error) => toast.error(actionErrorMessage(error)),
              },
            )
          }
        >
          <IconRefresh className="size-4" aria-hidden="true" />
          {refreshAll.isPending ? "Queuing..." : "Refresh all leads"}
        </Button>
      ) : null}
      {data.canPull ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pull.isPending}
          onClick={() =>
            pull.mutate(
              {},
              {
                onSuccess: (raw) => {
                  const result = raw as {
                    found: number;
                    new: number;
                    notContactSales: number;
                    agentWork: number;
                    agent: string;
                  };
                  toast.success(
                    [
                      `${result.new} new of ${result.found} recent Contact Sales submissions.`,
                      result.notContactSales > 0
                        ? `${result.notContactSales} other form ${result.notContactSales === 1 ? "submission" : "submissions"} left out.`
                        : "",
                      result.agentWork > 0
                        ? `${result.agentWork} waiting for the agent${result.agent === "not_enabled" ? "; turn on the inbound agent to draft them" : ""}.`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" "),
                  );
                  void status.refetch();
                  onPulled();
                },
                onError: (error) => toast.error(actionErrorMessage(error)),
              },
            )
          }
        >
          <IconCloudDownload className="size-4" aria-hidden="true" />
          {pull.isPending ? "Pulling..." : "Pull new leads"}
        </Button>
      ) : null}
    </div>
  );
}
