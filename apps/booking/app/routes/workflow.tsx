import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { IconBell, IconCheck, IconCopy, IconLoader2, IconPencil, IconX } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn, localDatetimeValueToISO, toLocalDatetimeValue } from "@/lib/utils";

export function meta() {
  return [{ title: "XDR Booking Agent" }];
}

type WorkflowStep = "idle" | "generating" | "review" | "confirming" | "done";

interface DraftState {
  meetingId: string;
  meetingAgenda: string;
  xdrPain: string;
  xdrEnterpriseNeed: string;
  xdrContactQualification: string;
  xdrNotes: string;
  followUpEmail: string;
  emailSubject: string;
  prospectName: string;
  company: string;
  meetingDatetime: string;
  aeEmail: string;
  prospectEmail: string;
  needsDatetime: boolean;
  needsAe: boolean;
}

interface ConfirmResult {
  hubspotDealId: string | null;
  calendarEventId: string | null;
  meetingLink: string | null;
  emailSent: boolean;
  errors: { hubspot: string | null; calendar: string | null; email: string | null };
}

interface InboundLead {
  id: string;
  prospectName: string;
  prospectEmail: string | null;
  company: string | null;
  contactSalesDate: string | null;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded p-1 hover:bg-muted transition-colors"
      title="Copy to clipboard"
    >
      {copied
        ? <IconCheck className="h-3.5 w-3.5 text-green-500" />
        : <IconCopy className="h-3.5 w-3.5 text-muted-foreground" />}
    </button>
  );
}

function leadInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

function relativeSubmissionDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const submitted = new Date(dateStr);
  if (Number.isNaN(submitted.getTime())) return "";
  const days = Math.floor((Date.now() - submitted.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

function InboundLeadsPanel({
  leads,
  dismissingLeadIds,
  failedLeadId,
  onDismiss,
}: {
  leads: InboundLead[];
  dismissingLeadIds: Set<string>;
  failedLeadId: string | null;
  onDismiss: (leadId: string) => void;
}) {
  if (leads.length === 0) return null;

  return (
    <Card className="border-amber-500/30 bg-amber-500/[0.06] shadow-sm">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
          <IconBell className="h-4 w-4" />
          {leads.length} new inbound lead{leads.length > 1 ? "s" : ""} from Contact Sales
        </div>
        <div className="space-y-1.5">
          {leads.map((lead) => {
            const isDismissing = dismissingLeadIds.has(lead.id);
            const isFailed = failedLeadId === lead.id;
            return (
              <div
                key={lead.id}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-md bg-background px-3 py-2 text-sm shadow-sm transition-[opacity,transform] duration-200 ease-out",
                  isDismissing && "-translate-y-1 opacity-0",
                )}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    {leadInitials(lead.prospectName)}
                  </span>
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{lead.prospectName}</span>
                    {lead.company && <span className="text-muted-foreground"> · {lead.company}</span>}
                    {lead.prospectEmail && (
                      <span className="text-muted-foreground"> · {lead.prospectEmail}</span>
                    )}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {isFailed && (
                    <span className="text-xs text-destructive">Failed, try again</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {relativeSubmissionDate(lead.contactSalesDate)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onDismiss(lead.id)}
                    disabled={isDismissing}
                    title="Dismiss"
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.96] disabled:opacity-50"
                  >
                    <IconX className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusIcon({ ok, error }: { ok: boolean | null; error?: string | null }) {
  if (ok === null) return <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (ok) return <IconCheck className="h-4 w-4 text-green-500" />;
  return (
    <span title={error ?? "Failed"}>
      <IconX className="h-4 w-4 text-destructive" />
    </span>
  );
}

// Renders the meeting agenda with section headers bold and sub-items indented.
// Toggling the pencil switches to a raw textarea for editing.
function AgendaDisplay({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (editing || disabled === false && value === "") {
    return (
      <div className="space-y-1">
        <Textarea
          className="min-h-[220px] font-mono text-sm leading-relaxed"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          autoFocus
          onBlur={() => setEditing(false)}
        />
      </div>
    );
  }

  const lines = value.split("\n");

  return (
    <div className="group relative">
      <div className="rounded-md border bg-muted/30 px-3 py-2.5 min-h-[220px] text-sm leading-relaxed">
        {lines.map((line, i) => {
          const isSubItem = line.startsWith("  ");
          const text = line.trim();
          if (!text) return <div key={i} className="h-2" />;
          if (isSubItem) {
            return (
              <div key={i} className="ml-4 flex gap-1.5 text-muted-foreground">
                <span className="mt-0.5 shrink-0 text-xs">·</span>
                <span>{text}</span>
              </div>
            );
          }
          return (
            <div key={i} className="font-medium mt-1 first:mt-0">
              {text}
            </div>
          );
        })}
      </div>
      {!disabled && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="absolute right-2 top-2 rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted"
          title="Edit agenda"
        >
          <IconPencil className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}

export default function WorkflowRoute() {
  const [step, setStep] = useState<WorkflowStep>("idle");
  const [transcript, setTranscript] = useState("");
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(null);

  const initiate = useActionMutation("initiate-workflow");
  const confirm = useActionMutation("confirm-workflow");
  const dismissLead = useActionMutation("dismiss-inbound-lead") as any;
  const { data: leadsData, refetch: refetchLeads } = useActionQuery(
    "list-unseen-inbound-leads",
    {},
    { refetchInterval: 60_000 },
  ) as { data: { leads: InboundLead[] } | undefined; refetch: () => void };
  const [dismissingLeadIds, setDismissingLeadIds] = useState<Set<string>>(new Set());
  const [failedLeadId, setFailedLeadId] = useState<string | null>(null);

  // Exit plays first (translate + fade), then the row actually leaves the
  // list once the transition has had time to finish -- removing it from the
  // query result immediately would cut the animation short.
  async function handleDismissLead(leadId: string) {
    setFailedLeadId(null);
    setDismissingLeadIds((prev) => new Set(prev).add(leadId));
    try {
      await dismissLead.mutateAsync({ leadId });
      setTimeout(() => refetchLeads(), 200);
    } catch {
      setDismissingLeadIds((prev) => {
        const next = new Set(prev);
        next.delete(leadId);
        return next;
      });
      setFailedLeadId(leadId);
    }
  }

  async function handleGenerate() {
    if (!transcript.trim()) return;
    setStep("generating");
    try {
      const result = await initiate.mutateAsync({ transcript }) as any;
      setDraft({
        meetingId: result.meetingId,
        meetingAgenda: result.generatedNotes.meetingAgenda,
        xdrPain: result.generatedNotes.xdrPain,
        xdrEnterpriseNeed: result.generatedNotes.xdrEnterpriseNeed,
        xdrContactQualification: result.generatedNotes.xdrContactQualification,
        xdrNotes: result.generatedNotes.xdrNotes,
        followUpEmail: result.generatedNotes.followUpEmail,
        emailSubject: result.generatedNotes.emailSubject,
        prospectName: result.extractedMeeting.prospectName,
        company: result.extractedMeeting.company,
        meetingDatetime: result.extractedMeeting.meetingDatetime ?? "",
        aeEmail: result.extractedMeeting.aeEmail ?? "",
        prospectEmail: result.extractedMeeting.prospectEmail ?? "",
        needsDatetime: result.extractedMeeting.needsDatetime,
        needsAe: result.extractedMeeting.needsAe,
      });
      setStep("review");
    } catch (err: any) {
      setStep("idle");
      alert(`Generation failed: ${err?.message ?? "Unknown error"}`);
    }
  }

  async function handleConfirm() {
    if (!draft) return;
    setStep("confirming");
    try {
      const result = await confirm.mutateAsync({
        meetingId: draft.meetingId,
        notes: {
          meetingAgenda: draft.meetingAgenda,
          xdrPain: draft.xdrPain,
          xdrEnterpriseNeed: draft.xdrEnterpriseNeed,
          xdrContactQualification: draft.xdrContactQualification,
          xdrNotes: draft.xdrNotes,
          followUpEmail: draft.followUpEmail,
        },
        meetingDetails: {
          prospectName: draft.prospectName,
          prospectEmail: draft.prospectEmail || undefined,
          company: draft.company,
          meetingDatetime: draft.meetingDatetime,
          aeEmail: draft.aeEmail,
          emailSubject: draft.emailSubject || undefined,
        },
      }) as any;
      setConfirmResult(result);
      setStep("done");
    } catch (err: any) {
      setStep("review");
      alert(`Confirm failed: ${err?.message ?? "Unknown error"}`);
    }
  }

  function handleReset() {
    setStep("idle");
    setTranscript("");
    setDraft(null);
    setConfirmResult(null);
  }

  const isReview = step === "review";
  const showOutputs = step === "review" || step === "confirming" || step === "done";

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <InboundLeadsPanel
        leads={leadsData?.leads ?? []}
        dismissingLeadIds={dismissingLeadIds}
        failedLeadId={failedLeadId}
        onDismiss={handleDismissLead}
      />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Post-Call Workflow</h1>
          <p className="text-sm text-muted-foreground">
            Paste your Nooks transcript to generate outputs and book the meeting.
          </p>
        </div>
        {step !== "idle" && (
          <Button variant="outline" size="sm" onClick={handleReset}>
            Start Over
          </Button>
        )}
      </div>

      {/* Step 1: Transcript input */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Paste Call Transcript</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder="Paste your Nooks call transcript here..."
            className="min-h-[180px] font-mono text-xs"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            disabled={step !== "idle"}
          />
          <Button onClick={handleGenerate} disabled={!transcript.trim() || step !== "idle"}>
            {step === "generating" ? (
              <>
                <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              "Generate Outputs →"
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Step 2: Review */}
      {showOutputs && draft && (
        <>
          {/* Meeting details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. Review Meeting Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Prospect Name</Label>
                <Input
                  value={draft.prospectName}
                  onChange={(e) => setDraft({ ...draft, prospectName: e.target.value })}
                  disabled={!isReview}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Prospect Email</Label>
                <Input
                  type="email"
                  placeholder="prospect@company.com"
                  value={draft.prospectEmail}
                  onChange={(e) => setDraft({ ...draft, prospectEmail: e.target.value })}
                  disabled={!isReview}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Company</Label>
                <Input
                  value={draft.company}
                  onChange={(e) => setDraft({ ...draft, company: e.target.value })}
                  disabled={!isReview}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  Meeting Date &amp; Time
                  {draft.needsDatetime && (
                    <span className="ml-1 text-xs text-amber-500">(not found — enter manually)</span>
                  )}
                </Label>
                <Input
                  type="datetime-local"
                  value={toLocalDatetimeValue(draft.meetingDatetime)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      meetingDatetime: localDatetimeValueToISO(e.target.value) ?? "",
                    })
                  }
                  disabled={!isReview}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  AE Email
                  {draft.needsAe && (
                    <span className="ml-1 text-xs text-amber-500">(not found — enter manually)</span>
                  )}
                </Label>
                <Input
                  type="email"
                  placeholder="ae@builder.io"
                  value={draft.aeEmail}
                  onChange={(e) => setDraft({ ...draft, aeEmail: e.target.value })}
                  disabled={!isReview}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email Subject</Label>
                <Input
                  placeholder="Auto-generated from AI"
                  value={draft.emailSubject}
                  onChange={(e) => setDraft({ ...draft, emailSubject: e.target.value })}
                  disabled={!isReview}
                />
              </div>
            </CardContent>
          </Card>

          {/* Agenda + Intro Email side by side */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Meeting Agenda</CardTitle>
                  <CopyButton text={draft.meetingAgenda} />
                </div>
              </CardHeader>
              <CardContent>
                <AgendaDisplay
                  value={draft.meetingAgenda}
                  onChange={(v) => setDraft({ ...draft, meetingAgenda: v })}
                  disabled={!isReview}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Intro Email</CardTitle>
                  <CopyButton text={draft.followUpEmail} />
                </div>
              </CardHeader>
              <CardContent>
                <Textarea
                  className="min-h-[220px] text-sm leading-relaxed"
                  value={draft.followUpEmail}
                  onChange={(e) => setDraft({ ...draft, followUpEmail: e.target.value })}
                  disabled={!isReview}
                />
              </CardContent>
            </Card>
          </div>

          {/* CRM Notes — 4 separate fields */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">CRM Notes</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    XDR: Pain
                  </Label>
                  <CopyButton text={draft.xdrPain} />
                </div>
                <Textarea
                  className="min-h-[100px] text-sm"
                  value={draft.xdrPain}
                  onChange={(e) => setDraft({ ...draft, xdrPain: e.target.value })}
                  disabled={!isReview}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    XDR: Enterprise Need
                  </Label>
                  <CopyButton text={draft.xdrEnterpriseNeed} />
                </div>
                <Textarea
                  className="min-h-[100px] text-sm"
                  value={draft.xdrEnterpriseNeed}
                  onChange={(e) => setDraft({ ...draft, xdrEnterpriseNeed: e.target.value })}
                  disabled={!isReview}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    XDR: Contact Qualification
                  </Label>
                  <CopyButton text={draft.xdrContactQualification} />
                </div>
                <Textarea
                  className="min-h-[100px] text-sm"
                  value={draft.xdrContactQualification}
                  onChange={(e) => setDraft({ ...draft, xdrContactQualification: e.target.value })}
                  disabled={!isReview}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    XDR: Notes
                  </Label>
                  <CopyButton text={draft.xdrNotes} />
                </div>
                <Textarea
                  className="min-h-[100px] text-sm"
                  value={draft.xdrNotes}
                  onChange={(e) => setDraft({ ...draft, xdrNotes: e.target.value })}
                  disabled={!isReview}
                />
              </div>
            </CardContent>
          </Card>

          {isReview && (
            <Button
              size="lg"
              onClick={handleConfirm}
              disabled={!draft.meetingDatetime || !draft.aeEmail}
            >
              Confirm &amp; Send Everything
            </Button>
          )}
        </>
      )}

      {/* Step 3: Confirmation status */}
      {step === "done" && confirmResult && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Confirmation Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <StatusIcon ok={!!confirmResult.hubspotDealId} error={confirmResult.errors.hubspot} />
              <span className="text-sm">
                {confirmResult.hubspotDealId
                  ? `HubSpot deal created (${confirmResult.hubspotDealId})`
                  : `HubSpot deal failed -- ${confirmResult.errors.hubspot}`}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <StatusIcon ok={!!confirmResult.calendarEventId} error={confirmResult.errors.calendar} />
              <span className="text-sm">
                {confirmResult.meetingLink ? (
                  <a
                    href={confirmResult.meetingLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    Calendar event created -- Join link
                  </a>
                ) : confirmResult.calendarEventId ? (
                  "Calendar event created"
                ) : (
                  `Calendar booking failed -- ${confirmResult.errors.calendar}`
                )}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <StatusIcon ok={confirmResult.emailSent} error={confirmResult.errors.email} />
              <span className="text-sm">
                {confirmResult.emailSent
                  ? "Intro email sent"
                  : confirmResult.errors.email
                  ? `Email send failed -- ${confirmResult.errors.email}`
                  : "Email skipped (no prospect address)"}
              </span>
            </div>
            <Button variant="outline" onClick={handleReset} className="mt-2">
              Start Another Workflow
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
