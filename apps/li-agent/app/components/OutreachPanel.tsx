import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconLoader2,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { MAX_FIT_SCORE } from "@/lib/fit-score-shared";

/**
 * The outreach generators a high-scoring lead earns.
 *
 * Four channels rather than one prompt with the channel named in it, because
 * their constraints genuinely differ: a connection note is hard-capped near
 * 300 characters and must not pitch, a cold email opens on them and asks for a
 * reply, an InMail can be longer but must not reintroduce you, and a call
 * opener is written to be SPOKEN.
 *
 * Existing drafts load on open so the panel shows what is already there
 * instead of charging an LLM call to redisplay it.
 */

export type OutreachSource = "lead_list_item" | "prospect";

export interface OutreachPanelLead {
  id: string;
  name: string | null;
  company: string | null;
  fitScore?: number | null;
  intentSignal?: string | null;
  enrichedEmail?: string | null;
  enrichedPhone?: string | null;
}

interface StoredDraft {
  id: string;
  kind: string;
  subject: string | null;
  body: string;
  angle: string | null;
  variantIndex: number;
  fitScoreAtGeneration?: number | null;
}

const CHANNELS: Array<{
  kind: "email" | "inmail" | "note" | "call_opener";
  label: string;
  blurb: string;
  variants?: number;
  /** Which contact field this channel needs to be usable. */
  requires?: "email" | "phone";
}> = [
  { kind: "email", label: "Cold email", blurb: "Subject and body, under 120 words", requires: "email" },
  { kind: "inmail", label: "InMail", blurb: "Longer LinkedIn message, under 150 words" },
  { kind: "note", label: "Note variants", blurb: "Three connection notes, different angles", variants: 3 },
  { kind: "call_opener", label: "Call opener", blurb: "First fifteen seconds, written to be spoken", requires: "phone" },
];

export function OutreachPanel({
  open,
  onClose,
  lead,
  source,
}: {
  open: boolean;
  onClose: () => void;
  lead: OutreachPanelLead | null;
  source: OutreachSource;
}) {
  const enabled = open && !!lead;
  const { data, refetch } = useActionQuery(
    "list-outreach-drafts",
    { source, id: lead?.id ?? "" },
    // Skipped until the panel is actually open, so opening a table does not
    // fire a query per row.
    { enabled },
  );
  const generate = useActionMutation("generate-outreach");

  const [busyKind, setBusyKind] = useState<(typeof CHANNELS)[number]["kind"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const drafts = useMemo(
    () => ((data as { drafts?: StoredDraft[] } | undefined)?.drafts ?? []),
    [data],
  );
  const byKind = useMemo(() => {
    const map = new Map<string, StoredDraft[]>();
    for (const d of drafts) {
      const list = map.get(d.kind) ?? [];
      list.push(d);
      map.set(d.kind, list);
    }
    return map;
  }, [drafts]);

  if (!open || !lead) return null;

  async function run(kind: (typeof CHANNELS)[number]["kind"], variants?: number) {
    setError(null);
    setWarning(null);
    setBusyKind(kind);
    try {
      const res = (await generate.mutateAsync({
        source,
        id: lead!.id,
        kind,
        variants: variants ?? 1,
      })) as { ok?: boolean; error?: string; unauthorizedCustomerMention?: string | null };
      if (res?.ok === false) {
        setError(res.error ?? "Generation failed.");
        return;
      }
      // Surfaced rather than silently stripped: a draft naming a customer this
      // persona is not cleared to reference is the rep's call before sending.
      if (res?.unauthorizedCustomerMention) {
        setWarning(
          `This draft mentions "${res.unauthorizedCustomerMention}", which is not an approved reference for this persona. Check before sending.`,
        );
      }
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setBusyKind(null);
    }
  }

  async function copy(draft: StoredDraft) {
    const text = draft.subject ? `${draft.subject}\n\n${draft.body}` : draft.body;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(draft.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Could not copy. Select the text and copy manually.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Write outreach for ${lead.name ?? "lead"}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busyKind) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-lg">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">
              Write outreach · {lead.name ?? "Lead"}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {lead.company ?? "—"}
              {typeof lead.fitScore === "number" && (
                <>
                  {" · "}
                  <span className="font-medium text-foreground">
                    {lead.fitScore}/{MAX_FIT_SCORE}
                  </span>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={!!busyKind}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <IconX size={16} />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {/* The signal, shown once at the top. It is what every generator
              opens on, so seeing it explains the drafts below. */}
          {lead.intentSignal && (
            <p className="border-s-2 border-amber-400 ps-2.5 text-xs italic text-foreground">
              {lead.intentSignal}
            </p>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            {CHANNELS.map((c) => {
              const existing = byKind.get(c.kind) ?? [];
              const missing =
                c.requires === "email" && !lead.enrichedEmail
                  ? "no email yet"
                  : c.requires === "phone" && !lead.enrichedPhone
                    ? "no phone yet"
                    : null;
              return (
                <button
                  key={c.kind}
                  type="button"
                  onClick={() => void run(c.kind, c.variants)}
                  disabled={!!busyKind}
                  className="rounded-lg border border-border p-2.5 text-left hover:bg-muted/50 disabled:opacity-50"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">{c.label}</span>
                    {busyKind === c.kind ? (
                      <IconLoader2 size={13} className="animate-spin text-muted-foreground" />
                    ) : existing.length > 0 ? (
                      <IconRefresh size={12} className="text-muted-foreground" />
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                    {c.blurb}
                  </span>
                  {/* Stated, not disabled. The draft is still useful before the
                      contact detail exists -- you enrich, then send -- so
                      blocking it would be wrong. */}
                  {missing && (
                    <span className="mt-0.5 block text-[11px] text-amber-600 dark:text-amber-400">
                      {missing}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
              {error}
            </p>
          )}
          {warning && (
            <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <IconAlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{warning}</span>
            </p>
          )}

          {drafts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing generated yet. Pick a channel above.
            </p>
          ) : (
            <div className="space-y-3">
              {CHANNELS.filter((c) => (byKind.get(c.kind) ?? []).length > 0).map((c) => (
                <div key={c.kind}>
                  <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {c.label}
                  </h3>
                  <div className="space-y-2">
                    {(byKind.get(c.kind) ?? []).map((d) => (
                      <div key={d.id} className="rounded-lg border border-border p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            {d.angle && (
                              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                {d.angle}
                              </p>
                            )}
                            {d.subject && (
                              <p className="mt-0.5 text-xs font-semibold text-foreground">{d.subject}</p>
                            )}
                            <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-foreground">
                              {d.body}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void copy(d)}
                            title="Copy"
                            aria-label="Copy draft"
                            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            {copied === d.id ? (
                              <IconCheck size={13} className="text-emerald-600" />
                            ) : (
                              <IconCopy size={13} />
                            )}
                          </button>
                        </div>
                        <p className="mt-1.5 text-[10px] text-muted-foreground">
                          {d.body.length} characters
                          {/* A draft written against a 92 is not the same
                              artifact after a rescore moves the lead to 61. */}
                          {typeof d.fitScoreAtGeneration === "number" &&
                            typeof lead.fitScore === "number" &&
                            d.fitScoreAtGeneration !== lead.fitScore && (
                              <> · written when this lead scored {d.fitScoreAtGeneration}</>
                            )}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
