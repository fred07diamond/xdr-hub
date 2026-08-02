import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconBrandLinkedin,
  IconBriefcase,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconLoader2,
  IconRefresh,
  IconSparkles,
  IconWand,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";

import { buildOverallScoreBreakdown, ScorePill } from "@/components/ScorePill";
import { SourceBadge } from "@/components/SourceBadge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

// The contact detail drawer — Task 6's answer to Fred's ask: "add an
// interface where I can dive a little bit deeper into these contacts...
// when I hover or when I click on them". Controlled by the parent
// (contacts.tsx / lists.tsx's ListDetailView) via `contactId`; open state is
// simply `contactId != null`.

interface ContactDetail {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  email: string | null;
  personaMatchScore: number | null;
  companyFitScore: number | null;
  engagementScore: number | null;
  hubspotQlScore: number | null;
  commonRoomIntentScore: number | null;
  commonRoomCompanyFitScore: number | null;
  overallScore: number | null;
  scoreReasoning: string | null;
  status: "active" | "actioned";
  linkedinUrl: string | null;
  hubspotUrl: string | null;
  source: "hubspot" | "commonroom" | "prospector";
  personaId: string | null;
  country: string | null;
  employees: number | null;
  draftEmailSubject: string | null;
  draftEmailBody: string | null;
  draftLinkedinMessage: string | null;
  draftGeneratedAt: string | null;
}

interface SegmentMembership {
  id: string;
  name: string;
  isActive: boolean;
}

interface CommonRoomEnrichment {
  recentActivities: unknown[] | null;
  recentWebPages: unknown[] | null;
  jobHistory: unknown[] | null;
  sparkSummary: string | null;
}

interface PersonaOption {
  id: string;
  name: string;
  color: string | null;
}

// CommonRoom's `recentActivities`/`recentWebPages`/`jobHistory` are
// unstructured-shape data as far as this app is concerned — the catalog only
// promises loose field descriptions, not an exact schema. These helpers pull
// out a display string defensively rather than assuming an inner shape.
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function formatDate(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString([], { month: "short", year: "numeric" });
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>;
}

// No shared relative-time helper is importable here (contacts.tsx's own
// `relativeTime` is a route-local, unexported function) — a simple inline
// equivalent for the draftGeneratedAt caption.
function formatRelativeTime(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard access denied/unavailable — silently no-op, nothing
          // else meaningful to do in that case.
        }
      }}
      title="Copy to clipboard"
      className="inline-flex items-center gap-1 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {copied ? <IconCheck size={13} className="text-green-600 dark:text-green-400" /> : <IconCopy size={13} />}
    </button>
  );
}

export function ContactDrawer({
  contactId,
  onClose,
}: {
  contactId: string | null;
  onClose: () => void;
}) {
  const open = contactId != null;

  const { data, isLoading, error, refetch } = useActionQuery(
    "get-contact-detail",
    { contactId: contactId ?? "" },
    { enabled: open },
  );

  const generateDraft = useActionMutation("generate-contact-draft");
  const [draftError, setDraftError] = useState<string | null>(null);

  async function handleGenerateDraft() {
    if (!contactId) return;
    setDraftError(null);
    try {
      await generateDraft.mutateAsync({ contactId });
      refetch();
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Couldn't generate outreach for this contact.");
    }
  }

  const { data: personaData } = useActionQuery("list-personas", {}, { enabled: open });
  const personaById = new Map(
    ((personaData as { personas?: PersonaOption[] })?.personas ?? []).map((p) => [p.id, p]),
  );

  const contact = (data as { contact?: ContactDetail })?.contact;
  const segments: SegmentMembership[] = (data as { segments?: SegmentMembership[] })?.segments ?? [];
  const commonRoomEnrichment: CommonRoomEnrichment | null =
    (data as { commonRoomEnrichment?: CommonRoomEnrichment | null })?.commonRoomEnrichment ?? null;

  const persona = contact?.personaId ? personaById.get(contact.personaId) : undefined;

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="sr-only">Contact detail</SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : !contact ? (
          <p className="text-sm text-destructive">
            {error instanceof Error && error.message ? error.message : "Couldn't load this contact."}
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Header: name/title/company/persona */}
            <div>
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-lg font-semibold text-foreground">{contact.name}</h2>
              </div>
              {(contact.title || contact.company) && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {contact.title}
                  {contact.title && contact.company ? " at " : ""}
                  {contact.company}
                </p>
              )}
              {contact.email && <p className="mt-0.5 text-xs text-muted-foreground/70">{contact.email}</p>}
              {persona && (
                <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-foreground">
                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: persona.color ?? "#6366f1" }} />
                  {persona.name}
                </span>
              )}
            </div>

            {/* Source + external links */}
            <div className="flex flex-wrap items-center gap-2">
              <SourceBadge source={contact.source} hubspotUrl={contact.hubspotUrl} />
              {contact.linkedinUrl && (
                <a
                  href={contact.linkedinUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <IconBrandLinkedin size={13} /> LinkedIn
                </a>
              )}
              {contact.hubspotUrl && (
                <a
                  href={contact.hubspotUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <IconExternalLink size={13} /> HubSpot
                </a>
              )}
              {segments.length > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  In {segments.map((s) => s.name).join(", ")}
                </span>
              )}
            </div>

            {/* Score breakdown */}
            <div>
              <SectionHeading>Score</SectionHeading>
              <div className="mb-3">
                <ScorePill score={contact.overallScore} size="lg" breakdown={buildOverallScoreBreakdown(contact)} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5">
                  <span className="text-muted-foreground">Persona Match</span>
                  <ScorePill score={contact.personaMatchScore} />
                </div>
                <div className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5">
                  <span className="text-muted-foreground">Company Fit</span>
                  <ScorePill score={contact.companyFitScore} />
                </div>
                <div className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5">
                  <span className="text-muted-foreground">Engagement</span>
                  <ScorePill score={contact.engagementScore} />
                </div>
                <div className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5">
                  <span className="text-muted-foreground">HubSpot QL</span>
                  <ScorePill score={contact.hubspotQlScore} />
                </div>
                <div className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5">
                  <span className="text-muted-foreground">CR Intent</span>
                  <ScorePill score={contact.commonRoomIntentScore} />
                </div>
                <div className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5">
                  <span className="text-muted-foreground">CR Company Fit</span>
                  <ScorePill score={contact.commonRoomCompanyFitScore} />
                </div>
              </div>
              {contact.scoreReasoning && (
                <p className="mt-2 text-xs text-muted-foreground/80">{contact.scoreReasoning}</p>
              )}
            </div>

            {/* CommonRoom activity feed */}
            <div>
              <SectionHeading>CommonRoom activity</SectionHeading>
              {!commonRoomEnrichment ? (
                <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground/60">
                  No CommonRoom activity found
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  {commonRoomEnrichment.sparkSummary && (
                    <div className="rounded-md bg-purple-500/5 p-3">
                      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-purple-600 dark:text-purple-400">
                        <IconSparkles size={12} /> Spark summary
                      </p>
                      <p className="text-xs text-foreground">{commonRoomEnrichment.sparkSummary}</p>
                    </div>
                  )}

                  {Array.isArray(commonRoomEnrichment.recentActivities) && commonRoomEnrichment.recentActivities.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Recent activities</p>
                      <ul className="flex flex-col gap-1.5">
                        {commonRoomEnrichment.recentActivities.slice(0, 10).map((activity, i) => {
                          const rec = asRecord(activity);
                          const type = rec ? asString(rec.type) : null;
                          const content = rec ? asString(rec.content) : null;
                          const url = rec ? asString(rec.url) : null;
                          const when = rec ? formatDate(rec.activityTime) : null;
                          return (
                            <li key={i} className="rounded-md border border-border px-2.5 py-1.5 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-foreground">{type ?? "Activity"}</span>
                                {when && <span className="text-[10px] text-muted-foreground/60">{when}</span>}
                              </div>
                              {content && <p className="mt-0.5 text-muted-foreground/80">{content}</p>}
                              {url && (
                                <a href={url} target="_blank" rel="noreferrer" className="mt-0.5 inline-block text-[11px] text-primary hover:underline">
                                  {url}
                                </a>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {Array.isArray(commonRoomEnrichment.recentWebPages) && commonRoomEnrichment.recentWebPages.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Recently visited pages</p>
                      <ul className="flex flex-col gap-1">
                        {commonRoomEnrichment.recentWebPages.slice(0, 5).map((page, i) => {
                          const rec = asRecord(page);
                          const url = (rec ? asString(rec.url) : null) ?? (typeof page === "string" ? page : null);
                          const title = rec ? asString(rec.title) : null;
                          if (!url) return null;
                          return (
                            <li key={i} className="truncate text-xs">
                              <a href={url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                {title ?? url}
                              </a>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {(!commonRoomEnrichment.sparkSummary &&
                    (!Array.isArray(commonRoomEnrichment.recentActivities) || commonRoomEnrichment.recentActivities.length === 0) &&
                    (!Array.isArray(commonRoomEnrichment.recentWebPages) || commonRoomEnrichment.recentWebPages.length === 0)) && (
                    <p className="text-xs text-muted-foreground/60">Matched in CommonRoom, but no activity details available.</p>
                  )}
                </div>
              )}
            </div>

            {/* Job history */}
            {commonRoomEnrichment?.jobHistory && commonRoomEnrichment.jobHistory.length > 0 && (
              <div>
                <SectionHeading>Job history</SectionHeading>
                <ul className="flex flex-col gap-1.5">
                  {commonRoomEnrichment.jobHistory.map((job, i) => {
                    const rec = asRecord(job);
                    const company = rec ? asString(rec.company) : null;
                    const jobTitle = rec ? asString(rec.title) : null;
                    const start = rec ? formatDate(rec.startDate) : null;
                    const end = rec ? formatDate(rec.endDate) : null;
                    return (
                      <li key={i} className="flex items-start gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs">
                        <IconBriefcase size={13} className="mt-0.5 shrink-0 text-muted-foreground/60" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground">{jobTitle ?? "Unknown role"}</p>
                          <p className="text-muted-foreground/70">
                            {company ?? "Unknown company"}
                            {(start || end) && ` · ${start ?? "?"} – ${end ?? "Present"}`}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Outreach Draft — AI-drafted cold email + LinkedIn note,
                grounded in this contact's matched persona's linked Sales
                Library docs and the single authorized Customer Evidence
                proof point (draft-outreach.ts). */}
            <div>
              <SectionHeading>Outreach Draft</SectionHeading>
              {contact.draftEmailSubject || contact.draftEmailBody || contact.draftLinkedinMessage ? (
                <div className="flex flex-col gap-3">
                  <div className="rounded-md border border-border p-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="text-[11px] font-medium text-muted-foreground">Cold email</p>
                      <CopyButton text={`${contact.draftEmailSubject ?? ""}\n\n${contact.draftEmailBody ?? ""}`} />
                    </div>
                    {contact.draftEmailSubject && (
                      <p className="text-xs font-medium text-foreground">{contact.draftEmailSubject}</p>
                    )}
                    {contact.draftEmailBody && (
                      <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground/90">{contact.draftEmailBody}</p>
                    )}
                  </div>
                  {contact.draftLinkedinMessage && (
                    <div className="rounded-md border border-border p-3">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                          <IconBrandLinkedin size={12} /> LinkedIn note
                        </p>
                        <CopyButton text={contact.draftLinkedinMessage} />
                      </div>
                      <p className="whitespace-pre-line text-xs text-muted-foreground/90">{contact.draftLinkedinMessage}</p>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    {contact.draftGeneratedAt && (
                      <p className="text-[11px] text-muted-foreground/60">Generated {formatRelativeTime(contact.draftGeneratedAt)}</p>
                    )}
                    <button
                      type="button"
                      onClick={handleGenerateDraft}
                      disabled={generateDraft.isPending}
                      className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                    >
                      {generateDraft.isPending ? (
                        <IconLoader2 size={13} className="animate-spin" />
                      ) : (
                        <IconRefresh size={13} />
                      )}
                      {generateDraft.isPending ? "Regenerating…" : "Regenerate"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleGenerateDraft}
                  disabled={generateDraft.isPending}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                >
                  {generateDraft.isPending ? (
                    <IconLoader2 size={13} className="animate-spin" />
                  ) : (
                    <IconWand size={13} />
                  )}
                  {generateDraft.isPending ? "Generating…" : "Generate Outreach"}
                </button>
              )}
              {draftError && <p className="mt-1.5 text-xs text-destructive">{draftError}</p>}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
