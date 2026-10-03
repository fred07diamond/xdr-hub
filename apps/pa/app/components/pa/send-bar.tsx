// Approve and send, or Approve to Gmail Drafts (D96). Everyone sees the two
// buttons; only the lead's owner can use them, from their own Gmail. The
// Gmail connection itself, and test sends, live in Settings > Email (D99).
// The server re-checks every rule on click.
import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import type { DraftView } from "@shared/pa-views";
import {
  IconAlertTriangle,
  IconBrandGmail,
  IconCheck,
  IconExternalLink,
  IconLoader2,
  IconSend,
} from "@tabler/icons-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useGmail } from "@/hooks/use-gmail";

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
  const { status, gmail, connected, waiting, connect } = useGmail(
    Boolean(send?.canSend),
  );
  const [confirming, setConfirming] = useState(false);
  const approve = useActionMutation("send-first-touch");

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 6000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  if (!send) return null;
  const delivery = send.delivery;

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
          to edit and send from Gmail.{" "}
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

  // Why the buttons are grey, shown on hover.
  const locked = !send.canSend
    ? send.ownerEmail
      ? `Only ${send.ownerEmail}, the lead's owner, can send this.`
      : "No owner yet, so no one can send this."
    : draft.status !== "ready"
      ? "Fix the message rule problems first."
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

  // The owner connects Gmail once before the buttons work.
  if (send.canSend && !status.isLoading && !connected)
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        <Button
          type="button"
          size="sm"
          disabled={gmail?.configured === false}
          onClick={connect}
        >
          <IconBrandGmail className="size-4" aria-hidden="true" />
          {gmail?.needsReconnect ? "Reconnect Gmail" : "Connect Gmail to send"}
        </Button>
        <span className="text-[12px] text-muted-foreground">
          {waiting
            ? "Finish in the Google window (Advanced, then Go to XDR Hub)."
            : "Once. Google will say the app is not verified: click Advanced, then Go to XDR Hub."}
        </span>
      </div>
    );

  const disabled =
    Boolean(locked) || busy || !draft.id || (send.canSend && status.isLoading);
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
      <div className="flex flex-wrap items-center gap-2">
        <Locked reason={locked}>
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={() => (confirming ? run("send") : setConfirming(true))}
          >
            {busy && approve.variables?.mode === "send" ? (
              <IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <IconSend className="size-4" aria-hidden="true" />
            )}
            {confirming ? `Send to ${draft.to.email}` : "Approve and send"}
          </Button>
        </Locked>
        <Locked reason={locked}>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => run("gmail_draft")}
            title={
              locked
                ? undefined
                : "Saves it to your Gmail Drafts to edit and send from Gmail"
            }
          >
            {busy && approve.variables?.mode === "gmail_draft" ? (
              <IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <IconCheck className="size-4" aria-hidden="true" />
            )}
            Approve
          </Button>
        </Locked>
        {confirming ? (
          <span className="text-[12px] text-muted-foreground">
            Click again to send it now from your Gmail.
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** A disabled button shows no hover, so the reason sits on a wrapper. */
function Locked({
  reason,
  children,
}: {
  reason: string | null;
  children: ReactNode;
}) {
  if (!reason) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "done" | "muted";
  children: ReactNode;
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
