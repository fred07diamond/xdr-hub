import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconCopy,
  IconExternalLink,
  IconLoader2,
  IconPencil,
  IconRefresh,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

export function meta() {
  return [{ title: "Meetings -- XDR Booking Agent" }];
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Meeting {
  id: string;
  prospectName: string;
  company: string;
  meetingDatetime: string | null;
  prospectEmail: string | null;
  aeUserEmail: string;
  xdrUserEmail: string;
  status: string;
  meetingLink: string | null;
  createdAt: string | null;
}

interface MeetingNotes {
  meetingAgenda: string;
  xdrPain: string;
  xdrEnterpriseNeed: string;
  xdrContactQualification: string;
  xdrNotes: string;
  followUpEmail: string;
  emailSubject: string;
  status: string;
  confirmedAt: string | null;
}

// ─── Calendar constants ───────────────────────────────────────────────────────

const HOUR_PX = 56; // px per hour
const START_HOUR = 7;
const END_HOUR = 20;
const TOTAL_PX = (END_HOUR - START_HOUR) * HOUR_PX;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

// ─── Calendar helpers ─────────────────────────────────────────────────────────

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekDates(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });
}

function minuteTop(date: Date): number {
  return (date.getHours() - START_HOUR) * HOUR_PX + (date.getMinutes() / 60) * HOUR_PX;
}

function durationPx(start: Date, end: Date): number {
  return Math.max(((end.getTime() - start.getTime()) / 3600000) * HOUR_PX, 22);
}

function formatHour(h: number): string {
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  return h > 12 ? `${h - 12}pm` : `${h}am`;
}

function weekRangeLabel(dates: Date[]): string {
  const start = dates[0];
  const end = dates[6];
  if (start.getMonth() === end.getMonth()) {
    return `${MONTHS[start.getMonth()]} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${MONTHS[start.getMonth()]} ${start.getDate()} – ${MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { badge: string }> = {
  confirmed: {
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
  pending: {
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  },
  cancelled: {
    badge: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  },
};

const AVATAR_COLORS = [
  "bg-violet-500", "bg-sky-500", "bg-orange-500",
  "bg-teal-500", "bg-rose-500", "bg-indigo-500",
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length === 1
    ? parts[0].slice(0, 2).toUpperCase()
    : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getAvatarColor(name: string): string {
  const hash = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

// ─── CopyButton ───────────────────────────────────────────────────────────────

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
      title="Copy"
    >
      {copied ? (
        <IconCheck className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <IconCopy className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </button>
  );
}

// ─── AgendaDisplay ────────────────────────────────────────────────────────────

function AgendaDisplay({ value }: { value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2.5 text-sm leading-relaxed">
      {value.split("\n").map((line, i) => {
        const isSubItem = line.startsWith("  ");
        const text = line.trim();
        if (!text) return <div key={i} className="h-1.5" />;
        if (isSubItem)
          return (
            <div key={i} className="ml-4 flex gap-1.5 text-muted-foreground">
              <span className="mt-0.5 shrink-0 text-xs">·</span>
              <span>{text}</span>
            </div>
          );
        return <div key={i} className="font-medium mt-1 first:mt-0">{text}</div>;
      })}
    </div>
  );
}

// ─── MeetingCard ──────────────────────────────────────────────────────────────

interface EditDraft {
  prospectName: string;
  company: string;
  prospectEmail: string;
  meetingDatetime: string;
  aeUserEmail: string;
  status: "pending" | "confirmed" | "cancelled";
}

function toLocalDatetimeValue(iso: string | null): string {
  if (!iso) return "";
  // datetime-local needs "YYYY-MM-DDTHH:mm"
  return iso.slice(0, 16);
}

function MeetingCard({
  meeting: m,
  isExpanded,
  onToggle,
  onUpdated,
  names,
}: {
  meeting: Meeting;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdated: () => void;
  names: Record<string, string>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState<EditDraft>({
    prospectName: m.prospectName,
    company: m.company,
    prospectEmail: m.prospectEmail ?? "",
    meetingDatetime: toLocalDatetimeValue(m.meetingDatetime),
    aeUserEmail: m.aeUserEmail,
    status: (m.status as EditDraft["status"]) ?? "pending",
  });

  const updateMeeting = useActionMutation("update-meeting") as any;
  const deleteMeeting = useActionMutation("delete-meeting") as any;

  const saving = updateMeeting.isPending;

  async function handleDelete() {
    try {
      await deleteMeeting.mutateAsync({ meetingId: m.id });
      onUpdated();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setConfirmDelete(false);
    }
  }

  const { data: detail, isLoading } = useActionQuery(
    "get-meeting-detail",
    { meetingId: m.id },
    { enabled: isExpanded && !isEditing },
  ) as { data: { meeting: Meeting; notes: MeetingNotes | null } | undefined; isLoading: boolean };

  const notes = detail?.notes ?? null;

  function handleEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setSaveError(null);
    setDraft({
      prospectName: m.prospectName,
      company: m.company,
      prospectEmail: m.prospectEmail ?? "",
      meetingDatetime: toLocalDatetimeValue(m.meetingDatetime),
      aeUserEmail: m.aeUserEmail,
      status: (m.status as EditDraft["status"]) ?? "pending",
    });
    setIsEditing(true);
    if (!isExpanded) onToggle();
  }

  function handleCancel() {
    setSaveError(null);
    setIsEditing(false);
  }

  async function handleSave() {
    setSaveError(null);
    try {
      await updateMeeting.mutateAsync({
        meetingId: m.id,
        prospectName: draft.prospectName || undefined,
        company: draft.company || undefined,
        prospectEmail: draft.prospectEmail || null,
        meetingDatetime: draft.meetingDatetime
          ? new Date(draft.meetingDatetime).toISOString()
          : null,
        aeUserEmail: draft.aeUserEmail || undefined,
        status: draft.status,
      });
      setIsEditing(false);
      onUpdated();
    } catch (err) {
      console.error("[update-meeting] save failed:", err);
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  const statusStyle = STATUS_STYLE[m.status] ?? STATUS_STYLE.cancelled!;

  return (
    <div id={`meeting-card-${m.id}`} className="rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="px-4 py-4 flex items-start gap-3">
        {/* Initials avatar */}
        <div className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-white text-xs font-bold mt-0.5 ${getAvatarColor(m.prospectName)}`}>
          {getInitials(m.prospectName)}
        </div>
        <button
          type="button"
          onClick={isEditing ? undefined : onToggle}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{m.prospectName}</span>
            <span className="text-xs text-muted-foreground">{m.company}</span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusStyle.badge}`}>
              {m.status}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
            {m.meetingDatetime ? <span>{formatDateTime(m.meetingDatetime)}</span> : <span>Date TBD</span>}
            {m.aeUserEmail && <span>AE: {names[m.aeUserEmail] ?? m.aeUserEmail}</span>}
            {m.meetingLink && (
              <a
                href={m.meetingLink}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 text-primary hover:underline"
              >
                <IconExternalLink className="h-3 w-3" />
                Join
              </a>
            )}
          </div>
        </button>

        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          {!isEditing && (
            <button
              type="button"
              onClick={handleEdit}
              className="rounded p-1.5 hover:bg-muted transition-colors"
              title="Edit meeting"
            >
              <IconPencil className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
          {!isEditing && !confirmDelete && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
              className="rounded p-1.5 hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
              title="Delete meeting"
            >
              <IconTrash className="h-3.5 w-3.5" />
            </button>
          )}
          {!isEditing && confirmDelete && (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteMeeting.isPending}
                className="rounded px-1.5 py-0.5 text-xs font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                {deleteMeeting.isPending ? <IconLoader2 className="h-3 w-3 animate-spin" /> : "Delete?"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded p-1 hover:bg-muted transition-colors text-muted-foreground"
              >
                <IconX className="h-3 w-3" />
              </button>
            </div>
          )}
          {!isEditing && (
            <button type="button" onClick={onToggle} className="rounded p-1.5 hover:bg-muted transition-colors">
              {isExpanded
                ? <IconChevronUp className="h-4 w-4 text-muted-foreground" />
                : <IconChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
          )}
        </div>
      </div>

      {/* Edit form */}
      {isEditing && (
        <div className="border-t px-5 py-5 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Edit Meeting</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Prospect Name</Label>
              <Input
                value={draft.prospectName}
                onChange={(e) => setDraft((d) => ({ ...d, prospectName: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Company</Label>
              <Input
                value={draft.company}
                onChange={(e) => setDraft((d) => ({ ...d, company: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Prospect Email</Label>
              <Input
                type="email"
                value={draft.prospectEmail}
                onChange={(e) => setDraft((d) => ({ ...d, prospectEmail: e.target.value }))}
                className="h-8 text-sm"
                placeholder="prospect@company.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">AE Email</Label>
              <Input
                type="email"
                value={draft.aeUserEmail}
                onChange={(e) => setDraft((d) => ({ ...d, aeUserEmail: e.target.value }))}
                className="h-8 text-sm"
                placeholder="ae@builder.io"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Meeting Date & Time</Label>
              <Input
                type="datetime-local"
                value={draft.meetingDatetime}
                onChange={(e) => setDraft((d) => ({ ...d, meetingDatetime: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <select
                value={draft.status}
                onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as EditDraft["status"] }))}
                className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="button" size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs px-3">
              {saving ? <IconLoader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={handleCancel} disabled={saving} className="h-7 text-xs px-3">
              Cancel
            </Button>
          </div>
          {saveError && (
            <p className="text-xs text-destructive pt-1">{saveError}</p>
          )}
        </div>
      )}

      {/* Expanded detail */}
      {isExpanded && !isEditing && (
        <div className="border-t px-5 py-5 space-y-6">
          {isLoading || !notes ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <IconLoader2 className="h-4 w-4 animate-spin" />
              Loading meeting data...
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {m.prospectEmail && (
                  <>
                    <span className="text-muted-foreground">Prospect Email</span>
                    <span>{m.prospectEmail}</span>
                  </>
                )}
                <span className="text-muted-foreground">AE</span>
                <span>{names[m.aeUserEmail] ?? (m.aeUserEmail || "--")}</span>
                <span className="text-muted-foreground">XDR</span>
                <span>{names[m.xdrUserEmail] ?? m.xdrUserEmail}</span>
                {notes.emailSubject && (
                  <>
                    <span className="text-muted-foreground">Email Subject</span>
                    <div className="flex items-center gap-1">
                      <span className="truncate">{notes.emailSubject}</span>
                      <CopyButton text={notes.emailSubject} />
                    </div>
                  </>
                )}
              </div>

              <Separator />

              {notes.meetingAgenda && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Meeting Agenda
                    </Label>
                    <CopyButton text={notes.meetingAgenda} />
                  </div>
                  <AgendaDisplay value={notes.meetingAgenda} />
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["XDR: Pain", notes.xdrPain],
                    ["XDR: Enterprise Need", notes.xdrEnterpriseNeed],
                    ["XDR: Contact Qualification", notes.xdrContactQualification],
                    ["XDR: Notes", notes.xdrNotes],
                  ] as [string, string][]
                )
                  .filter(([, v]) => v)
                  .map(([label, value]) => (
                    <div key={label} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {label}
                        </Label>
                        <CopyButton text={value} />
                      </div>
                      <Textarea readOnly className="min-h-[80px] text-sm resize-none bg-muted/30" value={value} />
                    </div>
                  ))}
              </div>

              {notes.followUpEmail && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Intro Email
                    </Label>
                    <CopyButton text={notes.followUpEmail} />
                  </div>
                  <Textarea
                    readOnly
                    className="min-h-[180px] text-sm resize-none bg-muted/30 leading-relaxed"
                    value={notes.followUpEmail}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── WeekCalendar ─────────────────────────────────────────────────────────────

interface CalEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
}

function WeekCalendar({
  meetings,
  onWeekChange,
  onMeetingClick,
  names,
}: {
  meetings: Meeting[];
  onWeekChange: (from: string, to: string) => void;
  onMeetingClick?: (id: string) => void;
  names: Record<string, string>;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));

  // "mine" = current user's calendar; any other value = that person's email
  const [viewingCalendar, setViewingCalendar] = useState<string>("mine");
  const [calInput, setCalInput] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const suggestions = useMemo(() => {
    const q = calInput.toLowerCase();
    return Object.entries(names)
      .filter(([email, name]) => !q || name.toLowerCase().includes(q) || email.toLowerCase().includes(q))
      .map(([email, name]) => ({ email, name }));
  }, [calInput, names]);

  function selectCalendar(email: string) {
    setViewingCalendar(email);
    setCalInput("");
    setDropdownOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      if (suggestions.length > 0) selectCalendar(suggestions[0].email);
      else if (calInput.includes("@")) selectCalendar(calInput);
    } else if (e.key === "Escape") {
      setDropdownOpen(false);
    }
  }

  function navigate(delta: number) {
    const next = new Date(weekStart);
    next.setDate(weekStart.getDate() + delta * 7);
    setWeekStart(next);
    const end = new Date(next);
    end.setDate(next.getDate() + 6);
    onWeekChange(next.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
  }

  function goToday() {
    const ws = getWeekStart(new Date());
    setWeekStart(ws);
    const end = new Date(ws);
    end.setDate(ws.getDate() + 6);
    onWeekChange(ws.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
  }

  const weekDates = getWeekDates(weekStart);

  // Fetch real Google Calendar events for the visible week
  const calFrom = weekStart.toISOString().slice(0, 10);
  const calEnd = new Date(weekStart);
  calEnd.setDate(weekStart.getDate() + 6);
  const calTo = calEnd.toISOString().slice(0, 10);

  const calendarEmail = viewingCalendar === "mine" ? undefined : viewingCalendar;

  const { data: calData, isLoading: calLoading } = useActionQuery(
    "get-calendar-events",
    { from: calFrom, to: calTo, ...(calendarEmail ? { calendarEmail } : {}) },
  ) as { data: { events: CalEvent[]; connected: boolean; reason: string | null } | undefined; isLoading: boolean };

  // Google Calendar events — rendered as subtle background blocks
  const googleEventsByDay = new Map<string, Array<{ id: string; title: string; top: number; height: number }>>();
  for (const e of calData?.events ?? []) {
    if (e.allDay) continue;
    const start = new Date(e.start);
    const end = new Date(e.end);
    const dayKey = start.toDateString();
    const top = minuteTop(start);
    if (top < 0 || top > TOTAL_PX) continue;
    if (!googleEventsByDay.has(dayKey)) googleEventsByDay.set(dayKey, []);
    googleEventsByDay.get(dayKey)!.push({
      id: e.id,
      title: e.title,
      top,
      height: durationPx(start, end),
    });
  }

  // Parse booked meetings into positioned events
  const eventsByDay = new Map<string, Array<{ id: string; title: string; top: number; height: number; isPast: boolean }>>();
  for (const m of meetings) {
    if (!m.meetingDatetime) continue;
    const start = new Date(m.meetingDatetime);
    const end = new Date(start.getTime() + 45 * 60 * 1000); // 45min default
    const dayKey = start.toDateString();
    const top = minuteTop(start);
    if (top < 0 || top > TOTAL_PX) continue; // outside visible range
    if (!eventsByDay.has(dayKey)) eventsByDay.set(dayKey, []);
    eventsByDay.get(dayKey)!.push({
      id: m.id,
      title: `${m.prospectName} · ${m.company}`,
      top,
      height: durationPx(start, end),
      isPast: start < new Date(),
    });
  }

  // Current-time indicator position
  const now = new Date();
  const nowMinutes = (now.getHours() - START_HOUR) * 60 + now.getMinutes();
  const nowTop = (nowMinutes / 60) * HOUR_PX;
  const showNow = nowMinutes >= 0 && nowMinutes <= (END_HOUR - START_HOUR) * 60;

  return (
    <div className="flex flex-col h-full rounded-xl border bg-card overflow-hidden">
      {/* Calendar scope banner */}
      {calData && !calData.connected && calData.reason === "no_calendar_scope" && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 border-b border-amber-500/20">
          <IconRefresh className="h-3.5 w-3.5 shrink-0" />
          Calendar access expired.{" "}
          <a href="/settings#google-calendar" className="underline underline-offset-2 font-medium">
            Reconnect in Settings
          </a>
        </div>
      )}
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(-1)}>
            <IconChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(1)}>
            <IconChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs px-2 ml-1" onClick={goToday}>
            Today
          </Button>
        </div>
        <span className="text-sm font-medium">{weekRangeLabel(weekDates)}</span>
        {/* "Meet with..." calendar switcher */}
        <div className="relative" ref={searchRef}>
          {viewingCalendar !== "mine" ? (
            <div className="flex items-center gap-1.5 h-7 rounded-md border border-input bg-background px-2 text-xs">
              <span className="max-w-[130px] truncate text-foreground">
                {names[viewingCalendar] ?? viewingCalendar}
              </span>
              <button
                type="button"
                onClick={() => setViewingCalendar("mine")}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Clear"
              >
                <IconX className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <>
              <Input
                value={calInput}
                onChange={(e) => { setCalInput(e.target.value); setDropdownOpen(true); }}
                onFocus={() => setDropdownOpen(true)}
                onKeyDown={handleKeyDown}
                placeholder="Meet with..."
                className="h-7 text-xs w-40"
              />
              {dropdownOpen && suggestions.length > 0 && (
                <div className="absolute right-0 top-[calc(100%+4px)] z-50 w-60 rounded-md border bg-popover shadow-md overflow-hidden">
                  {suggestions.slice(0, 8).map(({ email, name }) => (
                    <button
                      key={email}
                      type="button"
                      className="w-full flex flex-col px-3 py-2 text-left hover:bg-accent"
                      onMouseDown={(e) => { e.preventDefault(); selectCalendar(email); }}
                    >
                      <span className="text-xs font-medium text-foreground">{name}</span>
                      <span className="text-xs text-muted-foreground">{email}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Day headers */}
      <div className="grid shrink-0 border-b" style={{ gridTemplateColumns: "3rem repeat(7, 1fr)" }}>
        <div /> {/* time gutter */}
        {weekDates.map((d) => {
          const isToday = isSameDay(d, today);
          return (
            <div key={d.toISOString()} className="py-2 text-center select-none">
              <div className={`text-xs font-medium uppercase tracking-wide ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                {DAYS[d.getDay()]}
              </div>
              <div
                className={`mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-sm font-semibold ${
                  isToday
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground"
                }`}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div className="flex-1 overflow-y-auto">
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: "3rem repeat(7, 1fr)",
            height: `${TOTAL_PX}px`,
          }}
        >
          {/* Hour labels */}
          <div className="relative">
            {HOURS.map((h) => (
              <div
                key={h}
                className="absolute right-2 text-xs text-muted-foreground select-none"
                style={{ top: `${(h - START_HOUR) * HOUR_PX - 8}px` }}
              >
                {formatHour(h)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDates.map((d, colIdx) => {
            const isToday = isSameDay(d, today);
            const dayEvents = eventsByDay.get(d.toDateString()) ?? [];
            const gEvents = googleEventsByDay.get(d.toDateString()) ?? [];

            return (
              <div
                key={d.toISOString()}
                className={`relative border-l border-border ${isToday ? "bg-primary/[0.03]" : ""}`}
              >
                {/* Hour lines */}
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-border/50"
                    style={{ top: `${(h - START_HOUR) * HOUR_PX}px` }}
                  />
                ))}

                {/* Half-hour lines */}
                {HOURS.map((h) => (
                  <div
                    key={`${h}-half`}
                    className="absolute left-0 right-0 border-t border-border/20"
                    style={{ top: `${(h - START_HOUR) * HOUR_PX + HOUR_PX / 2}px` }}
                  />
                ))}

                {/* Now indicator */}
                {isToday && showNow && (
                  <div
                    className="absolute left-0 right-0 z-10 flex items-center"
                    style={{ top: `${nowTop}px` }}
                  >
                    <div className="h-2 w-2 rounded-full bg-primary -translate-x-1 shrink-0" />
                    <div className="flex-1 border-t-2 border-primary" />
                  </div>
                )}

                {/* Google Calendar events (background) */}
                {gEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="absolute left-0.5 right-0.5 z-10 rounded px-1 py-0.5 text-xs overflow-hidden bg-sky-500/10 border border-sky-500/20 text-sky-700 dark:text-sky-300"
                    style={{ top: `${ev.top}px`, height: `${ev.height}px` }}
                    title={ev.title}
                  >
                    <div className="truncate leading-tight">{ev.title}</div>
                  </div>
                ))}

                {/* Booked meeting events (foreground) */}
                {dayEvents.map((ev) => (
                  <div
                    key={ev.id}
                    onClick={() => onMeetingClick?.(ev.id)}
                    className={`absolute left-1 right-1 z-20 rounded-md px-1.5 py-1 text-xs font-medium overflow-hidden transition-opacity cursor-pointer hover:brightness-110 active:scale-[0.98] ${
                      ev.isPast
                        ? "bg-primary/40 text-primary-foreground/70 border border-primary/30"
                        : "bg-primary text-primary-foreground shadow-sm"
                    }`}
                    style={{ top: `${ev.top}px`, height: `${ev.height}px` }}
                    title={ev.title}
                  >
                    <div className="truncate leading-tight">{ev.title}</div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main route ───────────────────────────────────────────────────────────────

export default function MeetingsRoute() {
  const { data: meetingsData, isLoading, refetch } = useActionQuery("list-meetings", {}) as any;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [, setCalendarRange] = useState({ from: "", to: "" });

  function handleMeetingClick(id: string) {
    setExpandedId(id);
    setTimeout(() => {
      document.getElementById(`meeting-card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  }

  const allMeetings = ((meetingsData as any)?.meetings ?? []) as Meeting[];

  // Collect unique internal emails to resolve to full names from HubSpot
  const emailsToResolve = useMemo(() => {
    const set = new Set<string>();
    for (const m of allMeetings) {
      if (m.aeUserEmail) set.add(m.aeUserEmail);
      if (m.xdrUserEmail) set.add(m.xdrUserEmail);
    }
    return Array.from(set);
  }, [allMeetings]);

  const { data: namesData } = useActionQuery(
    "get-user-names",
    { emails: emailsToResolve },
    { enabled: emailsToResolve.length > 0 },
  ) as { data: { names: Record<string, string> } | undefined };

  const names = namesData?.names ?? {};

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full gap-5 p-5 overflow-hidden">
      {/* Left: calendar */}
      <div className="w-[56%] shrink-0 flex flex-col h-full">
        <div className="flex items-center gap-2 mb-3 shrink-0">
          <IconCalendar className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">Calendar</h1>
        </div>
        <div className="flex-1 min-h-0">
          <WeekCalendar
            meetings={allMeetings}
            onWeekChange={(from, to) => setCalendarRange({ from, to })}
            onMeetingClick={handleMeetingClick}
            names={names}
          />
        </div>
      </div>

      {/* Right: meeting cards */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 mb-3 shrink-0">
          <h2 className="text-sm font-semibold">Booked Meetings</h2>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {allMeetings.length}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 pb-6">
          {allMeetings.length === 0 ? (
            <p className="text-sm text-muted-foreground pt-10 text-center">
              No meetings yet. Run a workflow to book your first one.
            </p>
          ) : (
            allMeetings.map((m) => (
              <MeetingCard
                key={m.id}
                meeting={m}
                isExpanded={expandedId === m.id}
                onToggle={() => setExpandedId((prev) => (prev === m.id ? null : m.id))}
                onUpdated={() => refetch()}
                names={names}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
