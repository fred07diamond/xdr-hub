import { useActionMutation } from "@agent-native/core/client/hooks";
import { IconPhone } from "@tabler/icons-react";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useApolloEnrichment } from "@/lib/apollo-enrichment";
import { CREDITS_PER_PHONE_REVEAL, formatCreditCount } from "@/lib/apollo-limits";

// A phone reveal costs 8 Apollo credits -- eight times an email. Before this,
// an empty phone cell was a plain one-click enrich trigger, so the most
// expensive action in the app was also its least deliberate one.
//
// Three paths:
//   A. lead clears the fit bar          -> one confirmation stating the cost
//   B. lead does NOT clear the bar      -> two steps, second needs a checkbox
//   C. reveals paused (budget tier)     -> no override offered at all
//
// C is not negotiable by design: the 80% pause is a workspace policy, not a
// nag. An override covers lead quality, never credits the workspace has
// already run out of -- and the server enforces that regardless of this UI.

export interface RevealPhoneButtonProps {
  source: "lead_list_item" | "prospect";
  id: string;
  fitVerdict: string | null;
  fitReason: string | null;
  /** Already known to hold no number -- Apollo told us so. */
  noNumberKnown?: boolean;
  onRevealed: () => void;
}

type Step = "idle" | "warned" | "done";

export function RevealPhoneButton({
  source,
  id,
  fitVerdict,
  fitReason,
  noNumberKnown,
  onRevealed,
}: RevealPhoneButtonProps) {
  const apollo = useApolloEnrichment();
  const reveal = useActionMutation("reveal-phone");
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gateFailed, setGateFailed] = useState(false);

  const remaining = apollo.status?.remaining ?? null;
  const resetLabel = apollo.status?.resetLabel ?? null;
  const paused = !apollo.phoneRevealsEnabled;

  function reset() {
    setStep("idle");
    setAcknowledged(false);
    setError(null);
  }

  async function submit(override: boolean) {
    setError(null);
    try {
      const res = (await reveal.mutateAsync({
        source,
        id,
        override,
        // The server requires the client to echo the exact price, so a stale
        // client or a blind retry cannot spend by accident.
        confirmCredits: CREDITS_PER_PHONE_REVEAL,
      })) as { ok?: boolean; code?: string; error?: string; fitVerdict?: string | null; fitReason?: string | null };

      if (res?.ok) {
        setStep("done");
        onRevealed();
        // Apollo answers by callback, so closing immediately would hide the
        // fact that the number is still on its way.
        setTimeout(() => {
          setOpen(false);
          reset();
        }, 2500);
        return;
      }

      // The server is the authority on the gate: if it says the lead is below
      // the bar, escalate to the two-step override rather than trusting the
      // verdict this row happened to be rendered with.
      if (res?.code === "fit_gate") {
        setGateFailed(true);
        setStep("warned");
        return;
      }
      setError(res?.error ?? "Could not reveal the number.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reveal the number.");
    }
  }

  if (noNumberKnown) {
    return (
      <span
        className="text-xs italic text-muted-foreground/70"
        title="Apollo has no personal number on file for this lead, so a reveal would spend 8 credits to learn nothing."
      >
        No phone on file
      </span>
    );
  }

  if (!apollo.enabled) {
    return <span className="text-xs text-muted-foreground/50">—</span>;
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 underline decoration-dotted underline-offset-2 hover:text-foreground"
          title={`Reveal phone number (${CREDITS_PER_PHONE_REVEAL} Apollo credits)`}
        >
          <IconPhone size={11} />
          Reveal
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 text-xs" onClick={(e) => e.stopPropagation()}>
        {step === "done" ? (
          <>
            <p className="mb-1 text-sm font-semibold">Reveal requested</p>
            <p className="text-muted-foreground">
              Apollo delivers the number by callback, usually within a few seconds. The Phone column
              will update on its own.
            </p>
          </>
        ) : paused ? (
          /* ── Path C: paused. No override offered. ─────────────────────── */
          <>
            <p className="mb-1 text-sm font-semibold">Phone reveals are paused</p>
            <p className="mb-3 text-muted-foreground">
              The workspace has spent {apollo.status?.spentPct ?? 0}% of its Apollo credits this period.
              Reveals resume {resetLabel ?? "next period"}. Email enrichment still works.
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              Got it
            </button>
          </>
        ) : step === "warned" || (gateFailed && step !== "idle") ? (
          /* ── Path B step 2: the deliberate extra step ─────────────────── */
          <>
            <p className="mb-1 text-sm font-semibold text-destructive">
              Spend {CREDITS_PER_PHONE_REVEAL} credits on a {fitVerdict ?? "low-fit"} lead?
            </p>
            <p className="mb-2 text-muted-foreground">
              This is recorded against your name on the workspace credit log.
            </p>
            <label className="mb-3 flex cursor-pointer items-start gap-2 text-muted-foreground">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                I understand this spends {CREDITS_PER_PHONE_REVEAL} shared workspace credits on a lead
                the ICP scored <strong className="text-foreground capitalize">{fitVerdict ?? "low"}</strong>.
              </span>
            </label>
            {error && <p className="mb-2 text-destructive">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!acknowledged || reveal.isPending}
                onClick={() => submit(true)}
                className="flex-1 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-40"
              >
                {reveal.isPending ? "Revealing…" : `Spend ${CREDITS_PER_PHONE_REVEAL} credits`}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </>
        ) : gateFailed ? (
          /* ── Path B step 1: name the actual reason ────────────────────── */
          <>
            <p className="mb-1 text-sm font-semibold">This lead is not a strong fit</p>
            <p className="mb-2">
              <strong className="capitalize">{fitVerdict ?? "Unscored"}</strong>
              {fitReason ? <span className="text-muted-foreground"> — {fitReason}</span> : null}
            </p>
            <p className="mb-3 text-muted-foreground">
              Phone reveals are reserved for strong-fit leads because Apollo charges{" "}
              <strong className="text-foreground">{CREDITS_PER_PHONE_REVEAL} credits</strong> each, eight
              times what an email costs.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setStep("warned")}
                className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
              >
                Reveal anyway →
              </button>
            </div>
          </>
        ) : (
          /* ── Path A: clears the bar. One step, cost stated. ───────────── */
          <>
            <p className="mb-1 text-sm font-semibold">Reveal phone number</p>
            <p className="mb-2 text-muted-foreground">
              Apollo charges <strong className="text-foreground">{CREDITS_PER_PHONE_REVEAL} credits</strong>{" "}
              for a phone reveal. An email costs 1.
            </p>
            {remaining != null && (
              <p className="mb-3 text-muted-foreground">
                {formatCreditCount(remaining)} credits left this period
                {resetLabel ? ` · resets ${resetLabel}` : ""}.
              </p>
            )}
            {error && <p className="mb-2 text-destructive">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={reveal.isPending}
                onClick={() => submit(false)}
                className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {reveal.isPending ? "Revealing…" : `Reveal for ${CREDITS_PER_PHONE_REVEAL} credits`}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
