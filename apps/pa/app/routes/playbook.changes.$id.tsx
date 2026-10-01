import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { TEAM_LABELS, type PlaybookRole } from "@shared/playbook-roles";
import { IconArrowLeft } from "@tabler/icons-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";

import { countryLabel } from "@/components/pa/block-editors";
import {
  ChangeStatus,
  describeItem,
  JsonBlock,
  Panel,
} from "@/components/pa/playbook";
import { ErrorState } from "@/components/pa/states";
import { Button } from "@/components/ui/button";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Playbook change - ${APP_TITLE}` }];
}

interface Finding {
  kind: string;
  audience: string;
  title: string;
  body: string;
}
interface ImpactCase {
  caseId: string;
  before: Record<string, string | null>;
  after: Record<string, string | null>;
  changed: boolean;
}
interface ChangeView {
  change: {
    id: string;
    title: string;
    rationale: string;
    status: string;
    authorEmail: string;
    authorKind: string;
    requiredTeams: string[];
    resultReleaseId: string | null;
    checks: {
      ok: boolean;
      errors: { target: string; message: string }[];
      findings: Finding[];
      pendingBuild: string[];
    } | null;
    impact: { cases: ImpactCase[]; changed: number } | null;
  };
  items: Array<{
    id: string;
    target: string;
    op: string;
    beforeValue: unknown;
    afterValue: unknown;
    ownerTeam: string;
  }>;
  checksFresh: boolean;
  approvals: Array<{
    id: string;
    team: string;
    reviewerEmail: string;
    decision: string;
    onBehalf: boolean;
    current: boolean;
  }>;
  missingTeams: string[];
  readyToPublish: boolean;
  viewer: {
    role: string | null;
    isAppOwner: boolean;
    isAuthor: boolean;
    canReviewFor: string[];
  };
}

const AUDIENCE: Record<string, string> = {
  app_owner: "App owner",
  revops: "RevOps",
  pa_team: "PA team",
};
const teamLabel = (team: string) =>
  team === "admin"
    ? "the owner or a Playbook admin"
    : (TEAM_LABELS[team as PlaybookRole] ?? team);

export default function PlaybookChangeRoute() {
  const { id = "" } = useParams();
  const query = useActionQuery("get-playbook-change", { changeId: id });
  const check = useActionMutation("check-playbook-change");
  const submit = useActionMutation("submit-playbook-change");
  const review = useActionMutation("review-playbook-change");
  const publish = useActionMutation("publish-playbook-change");
  const withdraw = useActionMutation("withdraw-playbook-change");
  const retitle = useActionMutation("update-playbook-change");
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const [draftWhy, setDraftWhy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const data = query.data as ChangeView | undefined;

  const after = (message: string) => ({
    onSuccess: () => {
      toast.success(message);
      void query.refetch();
    },
    onError: (error: unknown) => toast.error(actionErrorMessage(error)),
  });

  if (query.isPending)
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-6 text-[13px] text-muted-foreground">
        Loading the change...
      </div>
    );
  if (!data) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-6">
        <ErrorState
          title="Couldn't load this change"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const { change } = data;
  const open = change.status === "draft" || change.status === "in_review";
  const checks = change.checks;
  const busy =
    check.isPending ||
    submit.isPending ||
    review.isPending ||
    publish.isPending ||
    withdraw.isPending;

  return (
    <div className="mx-auto grid w-full max-w-[1100px] gap-4 px-3 py-4 sm:px-4 md:px-6 md:py-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/playbook">
            <IconArrowLeft className="size-4" aria-hidden="true" />
            Playbook
          </Link>
        </Button>
        <ChangeStatus status={change.status} />
        <h1 className="text-[15px] font-semibold text-foreground">
          {change.title}
        </h1>
      </div>
      <p className="text-[13px] text-muted-foreground">
        {change.rationale} Drafted by {change.authorEmail}
        {change.authorKind === "agent" ? " with the agent" : ""}.{" "}
        {change.requiredTeams.length
          ? `Approved by ${change.requiredTeams.map(teamLabel).join(" and ")}.`
          : "Needs a check first."}
      </p>
      {change.status === "draft" ? (
        <Panel title="Describe this change for reviewers">
          <div className="grid gap-2">
            <input
              className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13px] shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={draftTitle ?? change.title}
              onChange={(event) => setDraftTitle(event.target.value)}
              aria-label="Change title"
            />
            <textarea
              className="min-h-14 w-full rounded-md border border-input bg-background px-2.5 py-2 text-[13px] shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={draftWhy ?? change.rationale}
              onChange={(event) => setDraftWhy(event.target.value)}
              aria-label="Why this change"
              placeholder="The source, the problem, or the correction behind it"
            />
            <div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={
                  busy ||
                  retitle.isPending ||
                  (draftTitle === null && draftWhy === null)
                }
                onClick={() =>
                  retitle.mutate(
                    {
                      changeId: change.id,
                      title: draftTitle ?? undefined,
                      rationale: draftWhy ?? undefined,
                    },
                    {
                      ...after("Saved"),
                      onSettled: () => {
                        setDraftTitle(null);
                        setDraftWhy(null);
                      },
                    },
                  )
                }
              >
                Save description
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      {open ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={data.checksFresh ? "outline" : "default"}
            disabled={busy}
            onClick={() =>
              check.mutate({ changeId: change.id }, after("Checks finished"))
            }
          >
            {check.isPending
              ? "Checking..."
              : data.checksFresh
                ? "Run the checks again"
                : "Run the checks"}
          </Button>
          {change.status === "draft" ? (
            <Button
              type="button"
              disabled={busy || !data.checksFresh || !checks?.ok}
              onClick={() =>
                submit.mutate({ changeId: change.id }, after("Sent for review"))
              }
            >
              Send for review
            </Button>
          ) : null}
          {change.status === "in_review" ? (
            <Button
              type="button"
              disabled={busy || !data.readyToPublish}
              onClick={() =>
                publish.mutate(
                  { changeId: change.id },
                  after("Published as the active release"),
                )
              }
            >
              {publish.isPending
                ? "Publishing..."
                : data.readyToPublish
                  ? "Publish"
                  : `Waiting on ${data.missingTeams.map(teamLabel).join(" and ")}`}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              withdraw.mutate({ changeId: change.id }, after("Withdrawn"))
            }
          >
            Withdraw
          </Button>
        </div>
      ) : null}

      {change.status === "in_review" && data.viewer.canReviewFor.length > 0 ? (
        <Panel title="Your review">
          <div className="grid gap-2">
            <textarea
              className="min-h-14 w-full rounded-md border border-input bg-background px-2.5 py-2 text-[13px] shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Optional note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {data.viewer.canReviewFor.map((team) => (
                <span key={team} className="flex gap-2">
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      review.mutate(
                        {
                          changeId: change.id,
                          team: "admin",
                          decision: "approve",
                          note: note || undefined,
                        },
                        after("Approved"),
                      )
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      review.mutate(
                        {
                          changeId: change.id,
                          team: "admin",
                          decision: "reject",
                          note: note || undefined,
                        },
                        after("Rejected"),
                      )
                    }
                  >
                    Reject
                  </Button>
                </span>
              ))}
            </div>
          </div>
        </Panel>
      ) : null}

      <Panel title="What changes">
        <ul className="grid gap-4">
          {data.items.map((item) => (
            <li key={item.id} className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className="font-mono font-medium text-foreground">
                  {item.target}
                </span>
                <span className="text-muted-foreground">
                  {item.op.replace("_", " ")}, owned by{" "}
                  {item.ownerTeam === "both"
                    ? "both teams"
                    : teamLabel(item.ownerTeam)}
                </span>
              </div>
              <ul className="grid gap-0.5 text-[13px] text-foreground">
                {describeItem(item, (code) =>
                  /^[A-Z]{2}$/.test(code)
                    ? `${countryLabel(code)} (${code})`
                    : code,
                ).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <details className="text-[12px] text-muted-foreground">
                <summary className="cursor-pointer select-none">
                  Before and after, in full
                </summary>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <JsonBlock value={item.beforeValue} />
                  <JsonBlock value={item.afterValue} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="Checks"
        aside={
          checks && !data.checksFresh && open ? (
            <span className="text-[12px] text-muted-foreground">
              Out of date: edited since the last run
            </span>
          ) : null
        }
      >
        {!checks ? (
          <p className="text-[13px] text-muted-foreground">Not checked yet.</p>
        ) : (
          <div className="grid gap-3 text-[13px]">
            {checks.errors.length > 0 ? (
              <ul className="grid gap-1 text-destructive">
                {checks.errors.map((error) => (
                  <li key={`${error.target}-${error.message}`}>
                    <span className="font-mono">{error.target}</span>:{" "}
                    {error.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-foreground">No errors.</p>
            )}
            {checks.pendingBuild.length > 0 ? (
              <p className="text-amber-700 dark:text-amber-400">
                Publishes as not enforced yet: {checks.pendingBuild.join(", ")}.
                Code has no evaluator for these, so the app owner gets a build
                suggestion.
              </p>
            ) : null}
            {checks.findings.length > 0 ? (
              <ul className="grid gap-2">
                {checks.findings.map((finding) => (
                  <li
                    key={finding.title}
                    className="rounded-md border border-border p-2.5"
                  >
                    <div className="text-[12px] font-medium text-muted-foreground">
                      For {AUDIENCE[finding.audience] ?? finding.audience}, on
                      publish
                    </div>
                    <div className="font-medium text-foreground">
                      {finding.title}
                    </div>
                    <p className="whitespace-pre-line text-muted-foreground">
                      {finding.body}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </Panel>

      <Panel title="Impact on the synthetic cases">
        {!change.impact ? (
          <p className="text-[13px] text-muted-foreground">
            Run the checks to replay the cases under this change.
          </p>
        ) : change.impact.changed === 0 ? (
          <p className="text-[13px] text-foreground">
            No case would be pre-checked, routed, or scored differently.
          </p>
        ) : (
          <table className="w-full text-left text-[12.5px]">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Case</th>
                <th className="py-1.5 pr-3 font-medium">Before</th>
                <th className="py-1.5 font-medium">After</th>
              </tr>
            </thead>
            <tbody>
              {change.impact.cases
                .filter((item) => item.changed)
                .map((item) => (
                  <tr
                    key={item.caseId}
                    className="border-t border-border align-top"
                  >
                    <td className="py-1.5 pr-3 font-mono">{item.caseId}</td>
                    <td className="py-1.5 pr-3">
                      {[
                        item.before.precheck,
                        item.before.route,
                        item.before.verdict,
                      ].join(", ")}
                    </td>
                    <td className="py-1.5 font-medium">
                      {[
                        item.after.precheck,
                        item.after.route,
                        item.after.verdict,
                      ].join(", ")}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Approvals">
        {data.approvals.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No reviews yet.</p>
        ) : (
          <ul className="grid gap-1 text-[13px]">
            {data.approvals.map((approval) => (
              <li
                key={approval.id}
                className={
                  approval.current
                    ? "text-foreground"
                    : "text-muted-foreground line-through"
                }
              >
                {approval.decision === "approve" ? "Approved" : "Rejected"} for{" "}
                {teamLabel(approval.team)} by {approval.reviewerEmail}
                {approval.onBehalf
                  ? " (standing in: the team has no members)"
                  : ""}
                {approval.current ? "" : " (before the last edit)"}
              </li>
            ))}
          </ul>
        )}
        {change.resultReleaseId ? (
          <p className="mt-2 text-[13px] text-foreground">
            Published as release {change.resultReleaseId.slice(0, 8)}.
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
