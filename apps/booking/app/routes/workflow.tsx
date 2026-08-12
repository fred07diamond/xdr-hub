import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { IconBell, IconCheck, IconCopy, IconLoader2, IconPencil, IconX } from "@tabler/icons-react";
import { useState, type ReactNode } from "react";

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

type IntroCallRecommendation = "take_call" | "pivot_ae" | "disqualify";
type PillarLabel = "Confirmed" | "Hypothesis" | "Unknown";

interface ParsedIntroCallResearch {
  contact: {
    name: string | null;
    jobTitle: string | null;
    location: string | null;
    linkedinUrl: string | null;
    breezeFitScore: string | null;
    signUpTimeStamp: string | null;
    jobFunctions: string | null;
    howHeardAboutBuilder: string | null;
    numNotes: number;
    messageVerbatim: string | null;
  };
  company: {
    name: string | null;
    industry: string | null;
    employeeCount: number | null;
    location: string | null;
    parentCompanyName: string | null;
  } | null;
  otherContacts: Array<{ name: string | null; jobTitle: string | null; activeInBuilderApp: boolean }>;
  activeInAppUserCount: number;
  deals: Array<{
    name: string | null;
    stage: string | null;
    ownerName: string | null;
    closedLostReasonCategory: string | null;
    closedLostReasonDetail: string | null;
  }>;
  notesUnreadable: boolean;
}

interface InboundLead {
  id: string;
  prospectName: string;
  prospectEmail: string | null;
  company: string | null;
  contactSalesDate: string | null;
  introTldr: string | null;
  introResearchJson: string | null;
  introProduct: "content" | "code" | null;
  introProductSignal: string | null;
  introEnterpriseNeedScore: number | null;
  introEnterpriseNeedLabel: PillarLabel | null;
  introEnterpriseNeedSignals: string | null;
  introIcpFitScore: number | null;
  introIcpFitLabel: PillarLabel | null;
  introIcpFitSignals: string | null;
  introMaturityStage: number | null;
  introMaturityStageReason: string | null;
  introPainScore: number | null;
  introPainLabel: PillarLabel | null;
  introPainRationale: string | null;
  introChampionScore: number | null;
  introChampionLabel: PillarLabel | null;
  introChampionRationale: string | null;
  introRecommendation: IntroCallRecommendation | null;
  introRecommendationRationale: string | null;
  introCheckpointGeneratedAt: string | null;
  introDecision: IntroCallRecommendation | null;
  introOutputSubject: string | null;
  introOutputBody: string | null;
  introAeName: string | null;
  introTimeWorks: number | null;
  introWorksheet: string | null;
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
  if (days < 7) return `${days}d ago`;
  return submitted.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fullSubmissionDate(dateStr: string | null): string | undefined {
  if (!dateStr) return undefined;
  const submitted = new Date(dateStr);
  if (Number.isNaN(submitted.getTime())) return undefined;
  return submitted.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

const RECOMMENDATION_LABEL: Record<IntroCallRecommendation, string> = {
  take_call: "Take the call",
  pivot_ae: "Pivot to AE",
  disqualify: "Disqualify",
};

// Color is reserved for this one signal (the recommendation/decision) so it
// stays meaningful instead of washing the whole panel in a single accent.
// Solid fill once the xDR has decided; outline while it's just the
// suggested read, so the two states are visually distinct at a glance.
function recommendationBadgeClasses(rec: IntroCallRecommendation, decided: boolean): string {
  const solid: Record<IntroCallRecommendation, string> = {
    take_call: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    pivot_ae: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    disqualify: "bg-slate-500/15 text-slate-700 dark:text-slate-400",
  };
  const outline: Record<IntroCallRecommendation, string> = {
    take_call: "border border-blue-500/40 text-blue-700 dark:text-blue-400",
    pivot_ae: "border border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
    disqualify: "border border-slate-500/40 text-slate-700 dark:text-slate-400",
  };
  return decided ? solid[rec] : outline[rec];
}

// Headline banner: what to do, and why, in one glance -- this is the actual
// answer the xDR opened the row for. Everything below it is supporting
// evidence, not the point.
function RecommendationBanner({ recommendation, rationale }: { recommendation: IntroCallRecommendation; rationale: string | null }) {
  const wash: Record<IntroCallRecommendation, string> = {
    take_call: "border-blue-500/30 bg-blue-500/[0.06]",
    pivot_ae: "border-emerald-500/30 bg-emerald-500/[0.06]",
    disqualify: "border-slate-500/30 bg-slate-500/[0.06]",
  };
  const text: Record<IntroCallRecommendation, string> = {
    take_call: "text-blue-700 dark:text-blue-400",
    pivot_ae: "text-emerald-700 dark:text-emerald-400",
    disqualify: "text-slate-700 dark:text-slate-400",
  };
  return (
    <div className={cn("rounded-md border px-3 py-2.5", wash[recommendation])}>
      <p className={cn("text-sm font-semibold", text[recommendation])}>{RECOMMENDATION_LABEL[recommendation]}</p>
      {rationale && <p className="mt-1 text-sm leading-relaxed text-foreground/90">{rationale}</p>}
    </div>
  );
}

function pillarLabelClasses(label: PillarLabel): string {
  if (label === "Confirmed") return "text-emerald-700 dark:text-emerald-400";
  if (label === "Hypothesis") return "text-amber-700 dark:text-amber-400";
  return "text-muted-foreground";
}

interface PillarCardData {
  title: string;
  score: number | null;
  label: PillarLabel | null;
  rationale: string | null;
}

// Compact stat cards, not paragraphs -- the score and label are the thing
// to scan; the rationale is one line, not a justification essay.
function ScorecardGrid({ pillars }: { pillars: PillarCardData[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {pillars.map((p) => (
        <div key={p.title} className="space-y-0.5 rounded-md border bg-muted/20 p-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{p.title}</p>
          <p className="flex items-baseline gap-1">
            <span className="text-lg font-semibold leading-none">{p.score ?? "--"}</span>
            <span className="text-xs text-muted-foreground">/10</span>
          </p>
          <p className={cn("text-[11px] font-medium", p.label ? pillarLabelClasses(p.label) : "text-muted-foreground")}>
            {p.label ?? "Unknown"}
          </p>
          {p.rationale && <p className="line-clamp-2 pt-0.5 text-xs text-muted-foreground">{p.rationale}</p>}
        </div>
      ))}
    </div>
  );
}

function FactGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border bg-muted/20 p-3 sm:grid-cols-3">{children}</div>;
}

function Fact({ label, value, full }: { label: string; value: ReactNode; full?: boolean }) {
  if (!value) return null;
  return (
    <div className={cn("space-y-0.5", full && "col-span-2 sm:col-span-3")}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm leading-snug">{value}</p>
    </div>
  );
}

function fmtOtherContact(c: ParsedIntroCallResearch["otherContacts"][number]): string {
  return `${c.name ?? "(unnamed)"}${c.jobTitle ? ` (${c.jobTitle})` : ""}${c.activeInBuilderApp ? " · active" : ""}`;
}

function fmtDealFact(d: ParsedIntroCallResearch["deals"][number]): string {
  const closedLost = d.closedLostReasonCategory
    ? ` — Closed Lost: ${d.closedLostReasonCategory}${d.closedLostReasonDetail ? ` (${d.closedLostReasonDetail})` : ""}`
    : "";
  return `${d.name ?? "(unnamed)"} · ${d.stage ?? "?"}${d.ownerName ? ` · ${d.ownerName}` : ""}${closedLost}`;
}

function IntroCallCheckpointDisplay({ lead }: { lead: InboundLead }) {
  let research: ParsedIntroCallResearch | null = null;
  if (lead.introResearchJson) {
    try {
      research = JSON.parse(lead.introResearchJson) as ParsedIntroCallResearch;
    } catch {
      research = null;
    }
  }

  const enterpriseNeedSignals: string[] = lead.introEnterpriseNeedSignals ? JSON.parse(lead.introEnterpriseNeedSignals) : [];
  const icpFitSignals: string[] = lead.introIcpFitSignals ? JSON.parse(lead.introIcpFitSignals) : [];

  const pillars: PillarCardData[] = [
    { title: "Enterprise Need", score: lead.introEnterpriseNeedScore, label: lead.introEnterpriseNeedLabel, rationale: enterpriseNeedSignals[0] ?? null },
    { title: "Pain we can solve", score: lead.introPainScore, label: lead.introPainLabel, rationale: lead.introPainRationale },
    { title: "Potential Champion", score: lead.introChampionScore, label: lead.introChampionLabel, rationale: lead.introChampionRationale },
    { title: "ICP Fit", score: lead.introIcpFitScore, label: lead.introIcpFitLabel, rationale: icpFitSignals[0] ?? null },
  ];

  const c = research?.contact;
  const co = research?.company;

  return (
    <div className="space-y-3">
      {lead.introTldr && <p className="text-sm leading-relaxed">{lead.introTldr}</p>}

      {lead.introRecommendation && (
        <RecommendationBanner recommendation={lead.introRecommendation} rationale={lead.introRecommendationRationale} />
      )}

      <ScorecardGrid pillars={pillars} />

      {c?.messageVerbatim && (
        <blockquote className="border-l-2 border-muted-foreground/30 pl-3 text-sm italic leading-relaxed text-foreground/80">
          &ldquo;{c.messageVerbatim}&rdquo;
        </blockquote>
      )}

      {research && (
        <FactGrid>
          <Fact label="Contact" value={[c?.name, c?.jobTitle].filter(Boolean).join(" · ") || "unknown"} />
          <Fact label="Location" value={c?.location} />
          <Fact label="LinkedIn" value={c?.linkedinUrl ?? "none on file"} />
          <Fact label="Fit score (Breeze)" value={c?.breezeFitScore} />
          <Fact label="Signed up" value={c?.signUpTimeStamp} />
          <Fact label="Heard about us" value={c?.howHeardAboutBuilder} />
          <Fact label="Job function" value={c?.jobFunctions} />
          <Fact
            label="Product"
            value={
              lead.introProduct
                ? `${lead.introProduct === "code" ? "Builder Code" : "Builder Content"}${lead.introProductSignal ? ` (${lead.introProductSignal})` : ""}`
                : null
            }
          />
          {lead.introMaturityStage != null && (
            <Fact label="Maturity stage" value={`Stage ${lead.introMaturityStage}${lead.introMaturityStageReason ? ` — ${lead.introMaturityStageReason}` : ""}`} full />
          )}
          <Fact
            label="Company"
            value={
              co
                ? [co.name, co.employeeCount ? `${co.employeeCount} employees` : null, co.industry, co.location, co.parentCompanyName ? `parent: ${co.parentCompanyName}` : null]
                    .filter(Boolean)
                    .join(" · ")
                : "unknown"
            }
            full
          />
          <Fact
            label="Deals"
            value={research.deals.length ? research.deals.map(fmtDealFact).join("; ") : "None — clean account"}
            full
          />
          <Fact
            label={`Other contacts (${research.activeInAppUserCount}/${research.otherContacts.length} active in-app)`}
            value={research.otherContacts.length ? research.otherContacts.map(fmtOtherContact).join(" · ") : "None"}
            full
          />
          <Fact
            label="Notes"
            value={c?.numNotes ? `${c.numNotes}${research.notesUnreadable ? " — paste in if relevant, bodies aren't readable here" : ""}` : "None"}
          />
        </FactGrid>
      )}
    </div>
  );
}

function EmailOutputDisplay({ subject, body }: { subject: string; body: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-sm">
        <span className="text-muted-foreground">Subject:</span>
        <span className="truncate font-medium">{subject}</span>
        <CopyButton text={subject} />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</Label>
          <CopyButton text={body} />
        </div>
        <Textarea readOnly className="min-h-[160px] text-sm resize-y bg-muted/30 leading-relaxed" value={body} />
      </div>
    </div>
  );
}

interface PivotAeFormState {
  leadId: string;
  aeName: string;
  aeEmail: string;
  timeWorks: boolean;
  altTime1: string;
  altTime2: string;
}

function PivotAeForm({
  form,
  onChange,
  onCancel,
  onSubmit,
  submitting,
}: {
  form: PivotAeFormState;
  onChange: (next: PivotAeFormState) => void;
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const canSubmit = form.aeName.trim().length > 0 && (form.timeWorks || (form.altTime1.trim() && form.altTime2.trim()));

  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">AE name</Label>
          <Input
            value={form.aeName}
            onChange={(e) => onChange({ ...form, aeName: e.target.value })}
            placeholder="e.g. Jamie Diaz"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">AE email (optional)</Label>
          <Input
            value={form.aeEmail}
            onChange={(e) => onChange({ ...form, aeEmail: e.target.value })}
            placeholder="jamie@builder.io"
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Does the booked time work for the AE?</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={form.timeWorks ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => onChange({ ...form, timeWorks: true })}
          >
            Yes, keep it
          </Button>
          <Button
            type="button"
            size="sm"
            variant={!form.timeWorks ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => onChange({ ...form, timeWorks: false })}
          >
            No, needs new times
          </Button>
        </div>
      </div>

      {!form.timeWorks && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Alt time 1</Label>
            <Input
              value={form.altTime1}
              onChange={(e) => onChange({ ...form, altTime1: e.target.value })}
              placeholder="Thursday 2pm ET"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Alt time 2</Label>
            <Input
              value={form.altTime2}
              onChange={(e) => onChange({ ...form, altTime2: e.target.value })}
              placeholder="Friday 11am ET"
              className="h-8 text-sm"
            />
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button type="button" size="sm" className="h-7 text-xs" disabled={!canSubmit || submitting} onClick={onSubmit}>
          {submitting ? <IconLoader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
          Generate email
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function InboundLeadsPanel({
  leads,
  dismissingLeadIds,
  failedLeadId,
  onDismiss,
  onGenerated,
}: {
  leads: InboundLead[];
  dismissingLeadIds: Set<string>;
  failedLeadId: string | null;
  onDismiss: (leadId: string) => void;
  onGenerated: () => void;
}) {
  const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null);
  const [checkpointLeadId, setCheckpointLeadId] = useState<string | null>(null);
  const [checkpointError, setCheckpointError] = useState<{ leadId: string; message: string } | null>(null);
  const [decidingLeadId, setDecidingLeadId] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<{ leadId: string; message: string } | null>(null);
  const [worksheetLeadId, setWorksheetLeadId] = useState<string | null>(null);
  const [worksheetError, setWorksheetError] = useState<{ leadId: string; message: string } | null>(null);
  const [pivotForm, setPivotForm] = useState<PivotAeFormState | null>(null);

  const runCheckpoint = useActionMutation("run-intro-call-checkpoint") as any;
  const decide = useActionMutation("decide-intro-call") as any;
  const genWorksheet = useActionMutation("generate-intro-call-worksheet") as any;

  if (leads.length === 0) return null;

  async function handleCheckpoint(leadId: string) {
    setCheckpointError(null);
    setCheckpointLeadId(leadId);
    try {
      await runCheckpoint.mutateAsync({ leadId });
      onGenerated();
    } catch (err: any) {
      setCheckpointError({ leadId, message: err?.message ?? "Checkpoint failed" });
    } finally {
      setCheckpointLeadId(null);
    }
  }

  async function handleDecide(leadId: string, decision: IntroCallRecommendation, extra?: Record<string, unknown>) {
    setDecideError(null);
    setDecidingLeadId(leadId);
    try {
      await decide.mutateAsync({ leadId, decision, ...extra });
      setPivotForm(null);
      onGenerated();
    } catch (err: any) {
      setDecideError({ leadId, message: err?.message ?? "Failed to generate output" });
    } finally {
      setDecidingLeadId(null);
    }
  }

  async function handleWorksheet(leadId: string) {
    setWorksheetError(null);
    setWorksheetLeadId(leadId);
    try {
      await genWorksheet.mutateAsync({ leadId });
      onGenerated();
    } catch (err: any) {
      setWorksheetError({ leadId, message: err?.message ?? "Worksheet generation failed" });
    } finally {
      setWorksheetLeadId(null);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <IconBell className="h-4 w-4 text-muted-foreground" />
          <span>Inbound leads from Contact Sales</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {leads.length}
          </span>
        </div>
        <div className="space-y-1.5">
          {leads.map((lead) => {
            const isDismissing = dismissingLeadIds.has(lead.id);
            const isFailed = failedLeadId === lead.id;
            const isExpanded = expandedLeadId === lead.id;
            const isCheckpointing = checkpointLeadId === lead.id;
            const isDeciding = decidingLeadId === lead.id;
            const isWorksheeting = worksheetLeadId === lead.id;
            const hasCheckpoint = !!lead.introCheckpointGeneratedAt;
            const badgeRec = lead.introDecision ?? lead.introRecommendation;
            const decided = !!lead.introDecision;
            const preview = !hasCheckpoint
              ? "Not yet reviewed — click to pull HubSpot data and run Checkpoint 1."
              : lead.introDecision
                ? `${RECOMMENDATION_LABEL[lead.introDecision]} — ${lead.introDecision === "take_call" && !lead.introWorksheet ? "email ready, worksheet next" : "email ready"}`
                : lead.introTldr ?? "Checkpoint ready — pick a decision below.";
            const showPivotForm = pivotForm?.leadId === lead.id;

            return (
              <div
                key={lead.id}
                className={cn(
                  "rounded-md border bg-background shadow-sm transition-[opacity,transform] duration-200 ease-out",
                  isDismissing && "-translate-y-1 opacity-0",
                )}
              >
                <button
                  type="button"
                  onClick={() => setExpandedLeadId(isExpanded ? null : lead.id)}
                  className="flex w-full flex-col gap-1 px-3 py-2.5 text-left text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-foreground/80">
                        {leadInitials(lead.prospectName)}
                      </span>
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{lead.prospectName}</span>
                        {lead.company && <span className="text-muted-foreground"> · {lead.company}</span>}
                        {lead.prospectEmail && (
                          <span className="text-muted-foreground"> · {lead.prospectEmail}</span>
                        )}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                          badgeRec ? recommendationBadgeClasses(badgeRec, decided) : "border border-dashed text-muted-foreground",
                        )}
                      >
                        {badgeRec ? RECOMMENDATION_LABEL[badgeRec] : "Not actioned"}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {isFailed && <span className="text-xs text-destructive">Failed, try again</span>}
                      <span
                        className="text-xs text-muted-foreground"
                        title={fullSubmissionDate(lead.contactSalesDate)}
                      >
                        {relativeSubmissionDate(lead.contactSalesDate)}
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDismiss(lead.id);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), onDismiss(lead.id))}
                        title="Dismiss"
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.96]"
                      >
                        <IconX className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </div>
                  <p className="truncate pl-9 text-xs text-muted-foreground">{preview}</p>
                </button>

                {isExpanded && (
                  <div className="space-y-4 border-t px-3 py-3">
                    {!hasCheckpoint ? (
                      <div className="flex items-center justify-between gap-3">
                        <p
                          className={cn(
                            "text-xs",
                            checkpointError?.leadId === lead.id ? "text-destructive" : "text-muted-foreground",
                          )}
                        >
                          {isCheckpointing
                            ? "Reading HubSpot data and scoring the lead..."
                            : checkpointError?.leadId === lead.id
                              ? checkpointError.message
                              : "No checkpoint yet for this lead."}
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCheckpoint(lead.id);
                          }}
                          disabled={isCheckpointing}
                          className="h-7 shrink-0 text-xs px-3"
                        >
                          {isCheckpointing ? <IconLoader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                          Action lead
                        </Button>
                      </div>
                    ) : (
                      <>
                        <IntroCallCheckpointDisplay lead={lead} />

                        {!lead.introDecision ? (
                          <div className="space-y-3 border-t pt-3">
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                className="h-7 text-xs px-3"
                                disabled={isDeciding}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDecide(lead.id, "take_call");
                                }}
                              >
                                {isDeciding ? <IconLoader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                                Take the call
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs px-3"
                                disabled={isDeciding}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPivotForm({
                                    leadId: lead.id,
                                    aeName: "",
                                    aeEmail: "",
                                    timeWorks: true,
                                    altTime1: "",
                                    altTime2: "",
                                  });
                                }}
                              >
                                Pivot to AE
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs px-3"
                                disabled={isDeciding}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDecide(lead.id, "disqualify");
                                }}
                              >
                                Disqualify
                              </Button>
                            </div>
                            {showPivotForm && pivotForm && (
                              <PivotAeForm
                                form={pivotForm}
                                onChange={setPivotForm}
                                onCancel={() => setPivotForm(null)}
                                submitting={isDeciding}
                                onSubmit={() =>
                                  handleDecide(lead.id, "pivot_ae", {
                                    aeName: pivotForm.aeName.trim(),
                                    aeEmail: pivotForm.aeEmail.trim() || undefined,
                                    timeWorks: pivotForm.timeWorks,
                                    altTime1: pivotForm.timeWorks ? undefined : pivotForm.altTime1.trim(),
                                    altTime2: pivotForm.timeWorks ? undefined : pivotForm.altTime2.trim(),
                                  })
                                }
                              />
                            )}
                            {decideError?.leadId === lead.id && (
                              <p className="text-xs text-destructive">{decideError.message}</p>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-3 border-t pt-3">
                            <p className="text-xs font-medium text-muted-foreground">
                              Decision: {RECOMMENDATION_LABEL[lead.introDecision]}
                              {lead.introAeName ? ` (${lead.introAeName})` : ""}
                            </p>
                            {lead.introDecision === "disqualify" && (
                              <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                                Recycle this lead in HubSpot.
                              </p>
                            )}
                            {lead.introOutputBody && (
                              <EmailOutputDisplay subject={lead.introOutputSubject ?? ""} body={lead.introOutputBody} />
                            )}
                            {lead.introDecision === "take_call" && (
                              lead.introWorksheet ? (
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                      Live Call Worksheet
                                    </Label>
                                    <CopyButton text={lead.introWorksheet} />
                                  </div>
                                  <Textarea
                                    readOnly
                                    className="min-h-[240px] text-xs font-mono resize-y bg-muted/30 leading-relaxed"
                                    value={lead.introWorksheet}
                                  />
                                </div>
                              ) : (
                                <div className="flex items-center justify-between gap-3">
                                  <p
                                    className={cn(
                                      "text-xs",
                                      worksheetError?.leadId === lead.id ? "text-destructive" : "text-muted-foreground",
                                    )}
                                  >
                                    {isWorksheeting
                                      ? "Building the worksheet..."
                                      : worksheetError?.leadId === lead.id
                                        ? worksheetError.message
                                        : "No worksheet yet."}
                                  </p>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 shrink-0 text-xs px-3"
                                    disabled={isWorksheeting}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleWorksheet(lead.id);
                                    }}
                                  >
                                    {isWorksheeting ? <IconLoader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                                    Generate worksheet
                                  </Button>
                                </div>
                              )
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
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
        onGenerated={refetchLeads}
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
