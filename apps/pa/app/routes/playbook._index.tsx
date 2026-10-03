import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
// The playbook builder (D46): a palette of block types, sections of blocks,
// and structured editors. Edits stage into one draft change that the owning
// teams review and publish.
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { blockType, newEntryId, type SectionId } from "@shared/playbook-blocks";
import { TEAM_LABELS, type PlaybookRole } from "@shared/playbook-roles";
import {
  IconAlertTriangle,
  IconArrowsExchange,
  IconTimelineEvent,
  IconArrowsSort,
  IconBook,
  IconBulb,
  IconChevronRight,
  IconClock,
  IconDatabase,
  IconDots,
  IconFilter,
  IconGauge,
  IconGripVertical,
  IconLayoutBoard,
  IconMail,
  IconMessageCircle,
  IconPlus,
  IconPuzzle,
  IconSquare,
  IconUsers,
  IconWorld,
  type Icon,
} from "@tabler/icons-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import {
  BlockDataEditor,
  countryLabel,
  Field,
} from "@/components/pa/block-editors";
import {
  ChangeStatus,
  EnforcementChip,
  PendingChip,
  TeamChip,
} from "@/components/pa/playbook";
import { ErrorState } from "@/components/pa/states";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { APP_TITLE } from "@/lib/app-config";
import { cn } from "@/lib/utils";

export function meta() {
  return [{ title: `Playbook - ${APP_TITLE}` }];
}

interface Block {
  target: string;
  title: string;
  kind: "entry" | "config";
  block: string | null;
  blockLabel: string;
  section: string;
  position: number;
  ownerTeam: string;
  owner: string;
  version: number | null;
  status: string;
  enforcement: string;
  body: string | null;
  data: Record<string, unknown>;
  raw: Record<string, unknown> | null;
  pending: unknown[];
  openFindings: string[];
}
interface PaletteItem {
  type: string;
  label: string;
  icon: string;
  description: string;
  sections: string[];
  defaultOwnerTeam: string;
  body: "required" | "optional" | "none";
  singleton: boolean;
  storage:
    | { kind: "entry"; entryType: string; idPrefix: string }
    | { kind: "config"; target: string };
  empty: Record<string, unknown>;
}
interface PlaybookView {
  release: { shortId: string; pendingConfirmations: number };
  viewer: { role: PlaybookRole | null; isAppOwner: boolean };
  sections: Array<{ id: string; label: string; hint: string; blocks: Block[] }>;
  palette: PaletteItem[];
  takenIds: string[];
  myDraft: { id: string; title: string; itemCount: number } | null;
  openChanges: Array<{
    id: string;
    title: string;
    status: string;
    requiredTeams: string[];
  }>;
  /** Sales handbook docs not in the playbook yet (D95). */
  handbook?: { waiting: number; pendingChangeId: string | null };
}
interface ItemInput {
  target: string;
  op: "add" | "update" | "retire" | "set_config";
  after?: unknown;
}

// Static, so the bundle carries only these icons.
const ICONS: Record<string, Icon> = {
  IconArrowsExchange,
  IconArrowsSort,
  IconBook,
  IconBulb,
  IconChevronRight,
  IconClock,
  IconDatabase,
  IconDots,
  IconFilter,
  IconGauge,
  IconLayoutBoard,
  IconMail,
  IconPuzzle,
  IconTimelineEvent,
  IconUsers,
  IconWorld,
};

function BlockIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? IconSquare;
  return (
    <Icon className={cn("size-4 shrink-0", className)} aria-hidden="true" />
  );
}

const OWNER_NAMES: Record<string, string> = {
  revops: "RevOps",
  pa_team: "PA team",
  both: "RevOps and PA team",
};

const CLASS_NAMES: Record<string, string> = {
  hq_content: "Exceptional, Content",
  hq_code: "Exceptional, Code",
  standard_content: "Requires discovery, Content",
  standard_code: "Requires discovery, Code",
  content_price_check: "Content price check",
  agency: "Agency",
};

/** A short read view of a block's data, like a CMS card preview. */
function summary(block: Block): ReactNode {
  const d = block.data;
  switch (block.block) {
    case "country_list": {
      const countries = (d.countries as string[]) ?? [];
      return countries.length
        ? countries.map(countryLabel).join(", ")
        : "No countries yet";
    }
    case "routing_order":
      return ((d.order as string[]) ?? [])
        .map((step) => step.replace(/_/g, " "))
        .join(", then ");
    case "precheck_outcomes":
      return `${Object.keys(d).length} signals, checked in order`;
    case "threshold":
    case "clock":
      return Object.entries(d)
        .filter(([, value]) => typeof value === "number")
        .map(([key, value]) => `${key.replace(/_/g, " ")} ${value}`)
        .join(", ");
    case "person_pool": {
      const pool = (d.pool as string[]) ?? [];
      return pool.length ? `${pool.length} people` : "Nobody yet";
    }
    case "crm_system":
      return String(d.system ?? "hubspot") === "hubspot"
        ? "HubSpot"
        : "Salesforce";
    case "crm_mapping":
      return "Open to map CRM properties";
    case "class_routes": {
      const toAe = Object.entries(d)
        .filter(([, route]) => route === "route_to_ae")
        .map(([key]) => CLASS_NAMES[key] ?? key);
      const pa = Object.entries(d)
        .filter(([, route]) => route === "pa_meeting")
        .map(([key]) => CLASS_NAMES[key] ?? key);
      return [
        toAe.length ? `To the AE: ${toAe.join(", ")}` : null,
        pa.length ? `PA takes the call: ${pa.join(", ")}` : null,
        "Everything else qualifies first",
      ]
        .filter(Boolean)
        .join(". ");
    }
    default: {
      if (!block.body) return null;
      // Message rules open with their own name; the card already shows it.
      const lines = block.body.split("\n").filter((line) => line.trim());
      const first = lines[0]?.trim().replace(/\.$/, "").toLowerCase();
      const rest =
        first && block.title.toLowerCase().startsWith(first)
          ? lines.slice(1)
          : lines;
      return rest.join(" ").slice(0, 220);
    }
  }
}

function Attention({ block }: { block: Block }) {
  const notes = [
    block.enforcement === "not_enforced" ? "Not enforced yet" : null,
    block.pending.length > 0 ? `${block.pending.length} to confirm` : null,
    block.openFindings.length > 0
      ? block.openFindings.length === 1
        ? block.openFindings[0]
        : `${block.openFindings.length} issues`
      : null,
  ].filter(Boolean);
  if (notes.length === 0) return null;
  return (
    <p className="mt-1 flex items-start gap-1 text-[12px] text-amber-700 dark:text-amber-400">
      <IconAlertTriangle
        className="mt-0.5 size-3.5 shrink-0"
        aria-hidden="true"
      />
      <span>{notes.join(", ")}</span>
    </p>
  );
}

const needsAttention = (block: Block) =>
  block.enforcement === "not_enforced" ||
  block.pending.length > 0 ||
  block.openFindings.length > 0;

function BlockCard({
  block,
  sortable: canSort,
  onOpen,
}: {
  block: Block;
  sortable: boolean;
  onOpen: (block: Block) => void;
}) {
  const sortable = useSortable({
    id: block.target,
    data: { section: block.section },
    disabled: !canSort || block.kind === "config",
  });
  const preview = summary(block);
  return (
    <li
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={cn(
        "group relative flex items-start gap-1 border-b border-border last:border-b-0",
        sortable.isDragging && "z-10 bg-card opacity-80 shadow-md",
      )}
    >
      {canSort && block.kind === "entry" ? (
        <button
          type="button"
          {...sortable.attributes}
          {...sortable.listeners}
          aria-label={`Drag ${block.title} to reorder`}
          className="mt-3.5 ml-1 cursor-grab rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <IconGripVertical className="size-4" aria-hidden="true" />
        </button>
      ) : (
        <span className="ml-1 w-4 shrink-0" aria-hidden="true" />
      )}
      <button
        type="button"
        onClick={() => onOpen(block)}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-md px-2 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium text-foreground">
            {block.title}
          </div>
          {preview ? (
            <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
              {preview}
            </p>
          ) : null}
          <Attention block={block} />
        </div>
        <IconChevronRight
          className="mt-0.5 size-4 shrink-0 text-muted-foreground/60 group-hover:text-muted-foreground"
          aria-hidden="true"
        />
      </button>
    </li>
  );
}

type Editing =
  | { mode: "edit"; block: Block }
  | { mode: "new"; type: PaletteItem; section: SectionId };

export default function PlaybookRoute() {
  const query = useActionQuery("list-playbook", {});
  const propose = useActionMutation("propose-playbook-change");
  const update = useActionMutation("update-playbook-change");
  const moveHandbook = useActionMutation("move-handbook-to-playbook");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [adding, setAdding] = useState(false);
  const data = query.data as PlaybookView | undefined;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const canEdit = Boolean(data && (data.viewer.isAppOwner || data.viewer.role));
  const staging = propose.isPending || update.isPending;

  // Follow-up cadences live on the Sequencing page (D102).
  const sections = (data?.sections ?? []).filter(
    (section) => section.id !== "follow_ups",
  );
  const requested = searchParams.get("section");
  const current =
    sections.find((section) => section.id === requested) ?? sections[0];

  const blocksById = useMemo(
    () =>
      new Map(
        (data?.sections ?? []).flatMap((section) =>
          section.blocks.map((block) => [block.target, block] as const),
        ),
      ),
    [data],
  );

  function select(id: string) {
    const params = new URLSearchParams(searchParams);
    params.set("section", id);
    setSearchParams(params, { replace: true });
  }

  /** Stage items into the viewer's open draft, or start one. */
  function stage(items: ItemInput[], message: string) {
    const done = {
      onSuccess: () => {
        toast.success(message);
        void query.refetch();
      },
      onError: (error: unknown) => toast.error(actionErrorMessage(error)),
    };
    if (data?.myDraft)
      update.mutate({ changeId: data.myDraft.id, set: items }, done);
    else
      propose.mutate(
        {
          title: "Playbook edits",
          rationale: "Edited in the playbook builder",
          items,
        },
        done,
      );
  }

  /** Block types that can still be added to a section. */
  function addable(sectionId: string) {
    return (data?.palette ?? []).filter(
      (type) =>
        type.sections.includes(sectionId) &&
        !(
          type.singleton &&
          sections.some((s) => s.blocks.some((b) => b.block === type.type))
        ),
    );
  }

  function onDragEnd(event: DragEndEvent) {
    const over = event.over;
    if (!over || !data) return;
    const moved = blocksById.get(String(event.active.id));
    const target = blocksById.get(String(over.id));
    if (
      !moved ||
      !target ||
      moved.section !== target.section ||
      moved.target === target.target
    )
      return;
    const section = data.sections.find((item) => item.id === moved.section);
    if (!section) return;
    const entries = section.blocks.filter((block) => block.kind === "entry");
    const next = arrayMove(
      entries,
      entries.indexOf(moved),
      entries.indexOf(target),
    );
    const items = next
      .map((block, index) => ({ block, index }))
      .filter(({ block, index }) => block.position !== index && block.raw)
      .map(({ block, index }) => ({
        target: block.target,
        op: "update" as const,
        after: { ...block.raw, position: index },
      }));
    if (items.length) stage(items, "New order staged in your draft");
  }

  if (query.isPending)
    return (
      <div className="mx-auto w-full max-w-[1100px] px-3 py-4 sm:px-4 md:px-6">
        <div className="h-72 animate-pulse rounded-lg border border-border bg-card" />
      </div>
    );
  if (!data || !current) {
    return (
      <div className="mx-auto w-full max-w-[1100px] px-3 py-4 sm:px-4 md:px-6">
        <ErrorState
          title="Couldn't load the playbook"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const inReview = data.openChanges.filter(
    (change) => change.id !== data.myDraft?.id,
  );
  const types = addable(current.id);
  const entryIds = current.blocks
    .filter((block) => block.kind === "entry")
    .map((block) => block.target);

  return (
    <div className="mx-auto grid w-full max-w-[1100px] gap-5 px-3 py-4 sm:px-4 md:px-6 md:py-5">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[18px] font-semibold text-foreground">
            Playbook
          </h1>
          <p className="mt-0.5 max-w-[60ch] text-[13px] text-muted-foreground">
            How PA handles Contact Sales leads. Edits collect in your draft, and
            the owner or a Playbook admin approves them before they take effect.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/suggestions">
              <IconBulb className="size-4" aria-hidden="true" />
              Suggestions
            </Link>
          </Button>
          {data.myDraft ? (
            <Button asChild size="sm">
              <Link to={`/playbook/changes/${data.myDraft.id}`}>
                Review your draft ({data.myDraft.itemCount}{" "}
                {data.myDraft.itemCount === 1 ? "edit" : "edits"})
              </Link>
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label="More">
                <IconDots className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-[12px] font-normal text-muted-foreground">
                Release {data.release.shortId}
                {data.release.pendingConfirmations > 0
                  ? `, ${data.release.pendingConfirmations} values to confirm`
                  : ""}
                <br />
                {data.viewer.isAppOwner
                  ? "You are the app owner"
                  : data.viewer.role
                    ? `You are on ${TEAM_LABELS[data.viewer.role]}`
                    : "Read only. Ask the app owner for a role to edit."}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/team">
                  <IconUsers className="size-4" aria-hidden="true" />
                  Playbook roles
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {data.handbook && data.handbook.waiting > 0 && canEdit ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-border bg-muted/30 px-4 py-3 text-[13px]">
          <IconBook
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 text-foreground">
            {data.handbook.pendingChangeId
              ? "The Sales handbook is waiting to be approved into the playbook's Knowledge section."
              : `${data.handbook.waiting} Sales handbook ${data.handbook.waiting === 1 ? "doc is" : "docs are"} not in the playbook yet. Move them into the Knowledge section so the playbook is the one place PA reads from.`}
          </span>
          {data.handbook.pendingChangeId ? (
            <Button asChild size="sm">
              <Link to={`/playbook/changes/${data.handbook.pendingChangeId}`}>
                Review and approve
              </Link>
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={moveHandbook.isPending}
              onClick={() =>
                moveHandbook.mutate(
                  {},
                  {
                    onSuccess: (raw) => {
                      const result = raw as { changeId: string | null };
                      if (result.changeId) {
                        toast.success(
                          "The handbook is a playbook change now. Approve and publish it.",
                        );
                        navigate(`/playbook/changes/${result.changeId}`);
                      } else void query.refetch();
                    },
                    onError: (error) => toast.error(actionErrorMessage(error)),
                  },
                )
              }
            >
              {moveHandbook.isPending ? "Moving..." : "Move into the playbook"}
            </Button>
          )}
        </div>
      ) : null}

      {inReview.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-[12.5px]">
          <span className="text-muted-foreground">In review</span>
          {inReview.map((change) => (
            <Link
              key={change.id}
              to={`/playbook/changes/${change.id}`}
              className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-muted"
            >
              {change.title}
              <ChangeStatus status={change.status} />
            </Link>
          ))}
        </div>
      ) : null}

      <div className="grid gap-5 md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav
          aria-label="Playbook sections"
          className="md:sticky md:top-4 md:self-start"
        >
          <ul className="-mx-1 flex gap-1 overflow-x-auto pb-1 md:mx-0 md:flex-col md:overflow-visible md:pb-0">
            {sections.map((section) => {
              const flagged = section.blocks.filter(needsAttention).length;
              const active = section.id === current.id;
              return (
                <li key={section.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => select(section.id)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "bg-accent font-medium text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <span className="flex-1">{section.label}</span>
                    {flagged > 0 ? (
                      <span
                        className="size-1.5 rounded-full bg-amber-500"
                        title={`${flagged} need attention`}
                      />
                    ) : null}
                    <span className="tabular-nums text-[12px] text-muted-foreground">
                      {section.blocks.length}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section aria-labelledby="section-title" className="min-w-0">
          <div className="mb-2 flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <h2
                id="section-title"
                className="text-[15px] font-semibold text-foreground"
              >
                {current.label}
              </h2>
              <p className="text-[12.5px] text-muted-foreground">
                {current.hint}
              </p>
            </div>
            {canEdit && types.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  types.length === 1
                    ? setEditing({
                        mode: "new",
                        type: types[0],
                        section: current.id as SectionId,
                      })
                    : setAdding(true)
                }
              >
                <IconPlus className="size-4" aria-hidden="true" />
                Add block
              </Button>
            ) : null}
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={entryIds}
              strategy={verticalListSortingStrategy}
            >
              <ul className="rounded-lg border border-border bg-card">
                {current.blocks.map((block) => (
                  <BlockCard
                    key={block.target}
                    block={block}
                    sortable={canEdit}
                    onOpen={(item) => setEditing({ mode: "edit", block: item })}
                  />
                ))}
                {current.blocks.length === 0 ? (
                  <li className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                    Nothing in {current.label} yet.
                  </li>
                ) : null}
              </ul>
            </SortableContext>
          </DndContext>
        </section>
      </div>

      <AddBlock
        open={adding}
        section={current}
        types={types}
        onClose={() => setAdding(false)}
        onPick={(type) =>
          setEditing({ mode: "new", type, section: current.id as SectionId })
        }
      />
      <BlockSheet
        editing={editing}
        view={data}
        canEdit={canEdit}
        busy={staging}
        onClose={() => setEditing(null)}
        onStage={(items, message) => {
          stage(items, message);
          setEditing(null);
        }}
      />
    </div>
  );
}

/** Pick which kind of block to add to the open section. */
function AddBlock({
  open,
  section,
  types,
  onClose,
  onPick,
}: {
  open: boolean;
  section: { label: string };
  types: PaletteItem[];
  onClose: () => void;
  onPick: (type: PaletteItem) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Add to {section.label}</SheetTitle>
          <SheetDescription>Choose the kind of block.</SheetDescription>
        </SheetHeader>
        <ul className="grid gap-1.5 px-4">
          {types.map((type) => (
            <li key={type.type}>
              <button
                type="button"
                className="flex w-full items-start gap-2.5 rounded-md border border-border px-3 py-2.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  onPick(type);
                  onClose();
                }}
              >
                <BlockIcon
                  name={type.icon}
                  className="mt-0.5 text-muted-foreground"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">
                    {type.label}
                  </span>
                  <span className="block text-[12px] text-muted-foreground">
                    {type.description}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

const area =
  "w-full rounded-md border border-input bg-background px-2.5 py-2 text-[13px] text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

function BlockSheet({
  editing,
  view,
  canEdit,
  busy,
  onClose,
  onStage,
}: {
  editing: Editing | null;
  view: PlaybookView;
  canEdit: boolean;
  busy: boolean;
  onClose: () => void;
  onStage: (items: ItemInput[], message: string) => void;
}) {
  const key = editing
    ? editing.mode === "edit"
      ? editing.block.target
      : `new:${editing.type.type}:${editing.section}`
    : "none";
  return (
    <Sheet open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {editing ? (
          <BlockForm
            key={key}
            editing={editing}
            view={view}
            canEdit={canEdit}
            busy={busy}
            onStage={onStage}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function BlockForm({
  editing,
  view,
  canEdit,
  busy,
  onStage,
}: {
  editing: Editing;
  view: PlaybookView;
  canEdit: boolean;
  busy: boolean;
  onStage: (items: ItemInput[], message: string) => void;
}) {
  const type =
    editing.mode === "new"
      ? editing.type
      : (view.palette.find((item) => item.type === editing.block.block) ??
        null);
  const existing = editing.mode === "edit" ? editing.block : null;
  const [name, setName] = useState("");
  const [body, setBody] = useState(existing?.body ?? "");
  const [rationale, setRationale] = useState(
    String(existing?.raw?.rationale ?? ""),
  );
  const [data, setData] = useState<Record<string, unknown>>(
    existing ? existing.data : { ...(type?.empty ?? {}) },
  );

  const title =
    editing.mode === "new" ? `New ${type?.label ?? "block"}` : existing!.title;

  function save() {
    if (!type) return;
    if (editing.mode === "edit" && existing) {
      if (existing.kind === "config") {
        onStage(
          [{ target: existing.target, op: "set_config", after: data }],
          "Edit staged in your draft",
        );
        return;
      }
      // Start from the full entry so fields this editor does not show survive.
      const after = {
        ...existing.raw,
        body: body.trim()
          ? body
          : type.body === "none"
            ? null
            : (existing.raw?.body ?? null),
        params: data,
        ...(rationale.trim() ? { rationale } : {}),
      };
      onStage(
        [{ target: existing.target, op: "update", after }],
        "Edit staged in your draft",
      );
      return;
    }
    if (editing.mode !== "new" || type.storage.kind !== "entry") return;
    const section = editing.section;
    const registered = blockType(type.type);
    if (!registered) return;
    const id = newEntryId(registered, section, name, new Set(view.takenIds));
    const position =
      view.sections
        .find((item) => item.id === section)
        ?.blocks.filter((block) => block.kind === "entry").length ?? 0;
    const after = {
      id,
      type: type.storage.entryType,
      block: type.type,
      section,
      position,
      owner: OWNER_NAMES[type.defaultOwnerTeam] ?? "RevOps",
      owner_team: type.defaultOwnerTeam,
      body: body.trim() ? body : null,
      params: data,
      ...(rationale.trim() ? { rationale } : {}),
    };
    onStage(
      [{ target: id, op: "add", after }],
      `${type.label} staged in your draft`,
    );
  }

  function retire() {
    if (!existing || existing.kind !== "entry") return;
    onStage(
      [{ target: existing.target, op: "retire" }],
      "Removal staged in your draft",
    );
  }

  function askAgent() {
    sendToAgentChat({
      message:
        editing.mode === "new"
          ? `Help me add a ${type?.label} block to the ${editing.section.replace(/_/g, " ")} section.`
          : `Help me change the ${existing!.blockLabel} block ${existing!.target}.`,
      context: `Playbook builder. Follow the playbook-steward skill: read list-playbook and list-playbook-blocks, stage edits with propose-playbook-change or update-playbook-change on the viewer's open draft, and run check-playbook-change. People approve and publish.`,
      submit: false,
      openSidebar: true,
    });
  }

  const needsName = editing.mode === "new";
  const canSave =
    canEdit &&
    !busy &&
    (!needsName || name.trim().length > 1) &&
    (type?.body !== "required" || body.trim().length > 0);

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2 text-[14px]">
          {type ? <BlockIcon name={type.icon} /> : null}
          {title}
        </SheetTitle>
        {existing ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-muted-foreground">
              {existing.blockLabel}
            </span>
            <span className="font-mono text-[11.5px] text-muted-foreground">
              {existing.target}
            </span>
            <EnforcementChip enforcement={existing.enforcement} />
            <PendingChip count={existing.pending.length} />
            <TeamChip team={existing.ownerTeam} />
          </div>
        ) : null}
        <SheetDescription>
          {type?.description} Owned by{" "}
          {
            OWNER_NAMES[
              existing?.ownerTeam ?? type?.defaultOwnerTeam ?? "revops"
            ]
          }
          ; changes go to your draft, and the owner or a Playbook admin approves
          them before they take effect.
        </SheetDescription>
      </SheetHeader>
      <div className="grid gap-4 px-4 pb-6">
        {needsName ? (
          <Field
            label="Name"
            hint="Becomes the block's id, for example Priority countries."
          >
            <input
              className={cn(area, "h-8 py-0")}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </Field>
        ) : null}
        {existing?.openFindings.length ? (
          <ul className="grid gap-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-[12.5px] text-amber-800 dark:text-amber-300">
            {existing.openFindings.map((finding) => (
              <li key={finding}>{finding}</li>
            ))}
          </ul>
        ) : null}
        {type && type.body !== "none" ? (
          <Field label={type.body === "required" ? "Text" : "Text (optional)"}>
            <textarea
              className={cn(area, "min-h-24 leading-relaxed")}
              rows={Math.min(28, Math.max(4, Math.ceil(body.length / 70) + 2))}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </Field>
        ) : null}
        {type ? (
          <BlockDataEditor block={type.type} data={data} onChange={setData} />
        ) : null}
        {existing?.kind !== "config" ? (
          <Field
            label="Why (optional)"
            hint="Kept on the entry as its rationale."
          >
            <textarea
              className={cn(area, "min-h-14")}
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
            />
          </Field>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={save} disabled={!canSave}>
            {busy
              ? "Staging..."
              : editing.mode === "new"
                ? "Add to draft"
                : "Stage edit"}
          </Button>
          <Button type="button" variant="outline" onClick={askAgent}>
            <IconMessageCircle className="size-4" aria-hidden="true" />
            Ask the agent
          </Button>
          {existing?.kind === "entry" && canEdit ? (
            <Button
              type="button"
              variant="ghost"
              onClick={retire}
              disabled={busy}
              className="ml-auto text-destructive"
            >
              Remove block
            </Button>
          ) : null}
        </div>
        {!canEdit ? (
          <p className="text-[12.5px] text-muted-foreground">
            You can read this block. A playbook role is needed to edit it.
          </p>
        ) : null}
      </div>
    </>
  );
}
