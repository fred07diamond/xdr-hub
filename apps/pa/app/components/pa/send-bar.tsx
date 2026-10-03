// Approve and send, or Approve to Gmail Drafts (D96). Only the lead's owner
// sees the buttons; the email goes out from their own Gmail, and HubSpot logs
// it through their inbox sync. The server re-checks every rule on click.
import { appPath } from "@agent-native/core/client/api-path";
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import type { DraftView } from "@shared/pa-views";
import {
  IconAlertTriangle,
  IconBrandGmail,
  IconCheck,
  IconExternalLink,
  IconLoader2,
  IconMailForward,
  IconSend,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

const GMAIL_DRAFTS = "https://mail.google.com/mail/u/0/#drafts";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function SendBar({
  engagementId,
  draft,
  onDone,
}: {
  engagementId: string;
  draft: DraftView;
  onDone: () => void;
}) {
  const send = draft.send;
  const [waitingForGoogle, setWaitingForGoogle] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const status = useActionQuery(
    "get-gmail-status",
    {},
    {
      enabled: Boolean(send),
      // While the Google window is open, check every few seconds.
      refetchInterval: waitingForGoogle ? 3000 : false,
    },
  );
  const approve = useActionMutation("send-first-touch");
  const test = useActionMutation("send-test-email");
  const gmail = status.data as
    | {
        configured: boolean;
        connected: boolean;
        needsReconnect: boolean;
        email: string | null;
      }
    | undefined;
  const connected = Boolean(gmail?.connected && !gmail.needsReconnect);

  useEffect(() => {
    if (waitingForGoogle && connected) {
      setWaitingForGoogle(false);
      toast.success("Gmail connected. You can send from PA now.");
    }
  }, [waitingForGoogle, connected]);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 6000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  if (!send) return null;
  const delivery = send.delivery;
  const connectGmail = () => {
    setWaitingForGoogle(true);
    window.open(
      appPath("/_agent-native/gmail/auth-url?redirect=1"),
      "pa-connect-gmail",
      "width=520,height=680",
    );
  };
  // Anyone can try the Gmail path on any lead: it goes to their own inbox (D97).
  const testButton = (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={test.isPending || !draft.id}
      onClick={() =>
        test.mutate(
          { engagementId, draftId: draft.id ?? "" },
          {
            onSuccess: () =>
              toast.success(
                `Test sent to ${gmail?.email ?? "you"}. Check your inbox.`,
              ),
            onError: (error) => toast.error(actionErrorMessage(error)),
          },
        )
      }
      title="Sends this draft to your own inbox from your Gmail. The lead gets nothing."
    >
      {test.isPending ? (
        <IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <IconMailForward className="size-4" aria-hidden="true" />
      )}
      Send a test to me
    </Button>
  );

  if (delivery?.kind === "sent")
    return (
      <Banner tone="done">
        <IconCheck className="size-4 shrink-0" aria-hidden="true" />
        Sent from {delivery.by ?? "the owner"}'s Gmail, {when(delivery.at)}.
        HubSpot logs it through their inbox sync.
      </Banner>
    );
  if (delivery?.kind === "gmail_draft" && delivery.draftId === draft.id)
    return (
      <Banner tone="done">
        <IconCheck className="size-4 shrink-0" aria-hidden="true" />
        <span>
          Approved. It is in {delivery.by ?? "the owner"}'s Gmail Drafts, ready
          to edit and send from Gmail. PA marks the lead contacted once HubSpot
          logs it.{" "}
          <a
            href={GMAIL_DRAFTS}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 font-medium underline underline-offset-2"
          >
            Open Gmail Drafts
            <IconExternalLink className="size-3" aria-hidden="true" />
          </a>
        </span>
      </Banner>
    );
  if (delivery?.kind === "sending")
    return (
      <Banner tone="muted">
        <IconLoader2
          className="size-4 shrink-0 animate-spin"
          aria-hidden="true"
        />
        Going out from {delivery.by ?? "the owner"}'s Gmail.
        {delivery.error ? ` ${delivery.error}` : ""}
      </Banner>
    );

  if (!send.canSend)
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5 text-[12.5px] text-muted-foreground">
        <span className="min-w-0 flex-1">
          {send.ownerEmail
            ? `Only ${send.ownerEmail}, the lead's owner, can approve this. It goes out from their Gmail.`
            : "No owner yet. Once the lead has one, they approve and send it from their Gmail."}
        </span>
        {status.isLoading ? null : connected ? (
          testButton
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={gmail?.configured === false}
            onClick={connectGmail}
            title="Connect your Gmail to send yourself a test of this draft"
          >
            <IconBrandGmail className="size-4" aria-hidden="true" />
            {waitingForGoogle
              ? "Finish in the Google window"
              : "Connect Gmail to test"}
          </Button>
        )}
      </div>
    );

  const blocked =
    draft.status !== "ready"
      ? "Fix the message rule problems before it goes out."
      : draft.rewriting
        ? "Wait for the rewrite to finish."
        : null;
  const busy = approve.isPending;
  const run = (mode: "send" | "gmail_draft") =>
    approve.mutate(
      { engagementId, draftId: draft.id ?? "", mode },
      {
        onSuccess: () => {
          setConfirming(false);
          toast.success(
            mode === "send"
              ? `Sent to ${draft.to.email} from your Gmail.`
              : "Approved. It is in your Gmail Drafts.",
          );
          onDone();
        },
        onError: (error) => {
          setConfirming(false);
          toast.error(actionErrorMessage(error));
          onDone();
        },
      },
    );

  return (
    <div className="border-t border-border px-4 py-3">
      {delivery?.kind === "failed" ? (
        <p className="mb-2 flex items-start gap-1.5 text-[12.5px] text-warning-foreground">
          <IconAlertTriangle
            className="mt-0.5 size-3.5 shrink-0"
            aria-hidden="true"
          />
          Last try did not go out: {delivery.error ?? "Gmail refused it"}.
          Nothing was sent; you can try again.
        </p>
      ) : null}
      {status.isLoading ? (
        <p className="text-[12.5px] text-muted-foreground">
          Checking your Gmail connection...
        </p>
      ) : !connected ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={gmail?.configured === false}
            onClick={connectGmail}
          >
            <IconBrandGmail className="size-4" aria-hidden="true" />
            {gmail?.needsReconnect
              ? "Reconnect Gmail"
              : "Connect Gmail to send"}
          </Button>
          <span className="text-[12px] text-muted-foreground">
            {gmail?.configured === false
              ? "Google sign-in is not set up on this server."
              : waitingForGoogle
                ? "Finish in the Google window. This updates on its own."
                : "Once, so PA can send or save drafts as you. Nothing goes out until you approve."}
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={Boolean(blocked) || busy || !draft.id}
            onClick={() => (confirming ? run("send") : setConfirming(true))}
          >
            {busy && approve.variables?.mode === "send" ? (
              <IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <IconSend className="size-4" aria-hidden="true" />
            )}
            {confirming ? `Send to ${draft.to.email}` : "Approve and send"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={Boolean(blocked) || busy || !draft.id}
            onClick={() => run("gmail_draft")}
            title="Saves it to your Gmail Drafts to edit and send from Gmail"
          >
            {busy && approve.variables?.mode === "gmail_draft" ? (
              <IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <IconCheck className="size-4" aria-hidden="true" />
            )}
            Approve
          </Button>
          {testButton}
          <span className="text-[12px] text-muted-foreground">
            {blocked ??
              (confirming
                ? "Click again to send. It goes out now from your Gmail."
                : `From ${gmail?.email ?? "your Gmail"}${draft.cc ? `, cc ${draft.cc}` : ""}. Approve saves it to your Gmail Drafts instead.`)}
          </span>
        </div>
      )}
    </div>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "done" | "muted";
  children: React.ReactNode;
}) {
  return (
    <p
      className={
        tone === "done"
          ? "flex items-start gap-2 border-t border-border bg-primary-soft px-4 py-2.5 text-[12.5px] text-primary"
          : "flex items-start gap-2 border-t border-border px-4 py-2.5 text-[12.5px] text-muted-foreground"
      }
    >
      {children}
    </p>
  );
}
