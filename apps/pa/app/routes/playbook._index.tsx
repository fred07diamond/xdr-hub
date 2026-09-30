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
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
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
  IconArrowsExchange,
  IconArrowsSort,
  IconBook,
  IconBulb,
  IconClock,
  IconDatabase,
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
import { Link } from "react-router";
import { toast } from "sonner";

import { ReleaseChip } from "@/components/pa/badges";
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
  IconClock,
  IconDatabase,
  IconFilter,
  IconGauge,
  IconLayoutBoard,
  IconMail,
  IconPuzzle,
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
    default:
      return block.body ? block.body.slice(0, 140) : null;
  }
}

function PaletteTile({
  item,
  onAdd,
}: {
  item: PaletteItem;
  onAdd: (item: PaletteItem) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${item.type}`,
    data: { palette: item.type },
  });
  return (
    <li
      ref={setNodeRef}
      className={cn(
        "flex items-start gap-2 rounded-md border border-border bg-card p-2 shadow-xs",
        isDragging && "opacity-50",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Drag ${item.label} into a section`}
        className="mt-0.5 cursor-grab text-muted-foreground hover:text-foreground"
      >
        <BlockIcon name={item.icon} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-foreground">
          {item.label}
        </div>
        <p className="line-clamp-2 text-[12px] text-muted-foreground">
          {item.description}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onAdd(item)}
        aria-label={`Add ${item.label}`}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <IconPlus className="size-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}

function BlockCard({
  block,
  onOpen,
}: {
  block: Block;
  onOpen: (block: Block) => void;
}) {
  const sortable = useSortable({
    id: block.target,
    data: { section: block.section },
    disabled: block.kind === "config",
  });
  return (
    <li
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={cn(
        "group flex items-start gap-2 rounded-md border border-border bg-card p-3 shadow-xs",
        sortable.isDragging && "opacity-60",
      )}
    >
      {block.kind === "entry" ? (
        <button
          type="button"
          {...sortable.attributes}
          {...sortable.listeners}
          aria-label={`Drag ${block.target} to reorder`}
          className="mt-0.5 cursor-grab text-muted-foreground opacity-60 group-hover:opacity-100"
        >
          <IconGripVertical className="size-4" aria-hidden="true" />
        </button>
      ) : (
        <span className="w-4" aria-hidden="true" />
      )}
      <button
        type="button"
        onClick={() => onOpen(block)}
        className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-medium text-foreground">
            {block.blockLabel}
          </span>
          <span className="font-mono text-[11.5px] text-muted-foreground">
            {block.target}
          </span>
          <EnforcementChip enforcement={block.enforcement} />
          <PendingChip count={block.pending.length} />
          <TeamChip team={block.ownerTeam} />
        </div>
        {summary(block) ? (
          <p className="mt-1 line-clamp-2 text-[12.5px] text-muted-foreground">
            {summary(block)}
          </p>
        ) : null}
        {block.openFindings.length > 0 ? (
          <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-400">
            {block.openFindings[0]}
            {block.openFindings.length > 1
              ? ` and ${block.openFindings.length - 1} more`
              : ""}
          </p>
        ) : null}
      </button>
    </li>
  );
}

function SectionDrop({
  section,
  children,
  active,
}: {
  section: { id: string; label: string; hint: string };
  children: ReactNode;
  active: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `section:${section.id}`,
    data: { section: section.id },
  });
  return (
    <section
      ref={setNodeRef}
      aria-label={section.label}
      className={cn(
        "rounded-lg border border-border bg-muted/20 p-3 transition-colors",
        active && "border-dashed",
        isOver && "border-foreground/40 bg-muted/60",
      )}
    >
      <header className="mb-2">
        <h2 className="text-[13px] font-semibold text-foreground">
          {section.label}
        </h2>
        <p className="text-[12px] text-muted-foreground">{section.hint}</p>
      </header>
      {children}
    </section>
  );
}

type Editing =
  | { mode: "edit"; block: Block }
  | { mode: "new"; type: PaletteItem; section: SectionId };

export default function PlaybookRoute() {
  const query = useActionQuery("list-playbook", {});
  const propose = useActionMutation("propose-playbook-change");
  const update = useActionMutation("update-playbook-change");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [addFor, setAddFor] = useState<PaletteItem | null>(null);
  const data = query.data as PlaybookView | undefined;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const canEdit = Boolean(data && (data.viewer.isAppOwner || data.viewer.role));
  const staging = propose.isPending || update.isPending;

  const blocksById = useMemo(
    () =>
      new Map(
        (data?.sections ?? []).flatMap((section) =>
          section.blocks.map((block) => [block.target, block] as const),
        ),
      ),
    [data],
  );

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

  function startNew(type: PaletteItem, section: SectionId) {
    if (!canEdit) return toast.error("You need a playbook role to edit");
    if (
      type.singleton &&
      data?.sections.some((s) =>
        s.blocks.some((block) => block.block === type.type),
      )
    ) {
      return toast.error(
        `The playbook already has a ${type.label}. Open it to edit.`,
      );
    }
    if (!type.sections.includes(section))
      return toast.error(`A ${type.label} does not belong in that section`);
    setEditing({ mode: "new", type, section });
  }

  function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const over = event.over;
    if (!over || !data) return;
    const overSection =
      (over.data.current?.section as SectionId | undefined) ?? undefined;
    const paletteType = event.active.data.current?.palette as
      | string
      | undefined;
    if (paletteType) {
      const type = data.palette.find((item) => item.type === paletteType);
      if (type && overSection) startNew(type, overSection);
      return;
    }
    // Reordering blocks inside a section.
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
    if (items.length) stage(items, "Order staged in your draft");
  }

  if (query.isPending)
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-6 text-[13px] text-muted-foreground">
        Loading the playbook...
      </div>
    );
  if (!data) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        <ErrorState
          title="Couldn't load the playbook"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[1400px] gap-4 px-3 py-4 sm:px-4 md:px-6 md:py-5">
      <div className="flex flex-wrap items-center gap-2">
        <ReleaseChip shortId={data.release.shortId} label="active" />
        <PendingChip count={data.release.pendingConfirmations} />
        <span className="text-[12.5px] text-muted-foreground">
          {data.viewer.isAppOwner
            ? "You are the app owner"
            : data.viewer.role
              ? `You are on ${TEAM_LABELS[data.viewer.role]}`
              : "You can read the playbook; ask the app owner for a role to edit it"}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {data.myDraft ? (
            <Button asChild size="sm">
              <Link to={`/playbook/changes/${data.myDraft.id}`}>
                Review your draft ({data.myDraft.itemCount}{" "}
                {data.myDraft.itemCount === 1 ? "edit" : "edits"})
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link to="/team">
              <IconUsers className="size-4" aria-hidden="true" />
              Playbook roles
            </Link>
          </Button>
        </div>
      </div>

      {data.openChanges.filter((change) => change.id !== data.myDraft?.id)
        .length > 0 ? (
        <ul className="flex flex-wrap gap-2 text-[12.5px]">
          {data.openChanges
            .filter((change) => change.id !== data.myDraft?.id)
            .map((change) => (
              <li key={change.id}>
                <Link
                  to={`/playbook/changes/${change.id}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 hover:bg-muted"
                >
                  <ChangeStatus status={change.status} />
                  {change.title}
                </Link>
              </li>
            ))}
        </ul>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(event: DragStartEvent) =>
          setDragging(String(event.active.id))
        }
        onDragCancel={() => setDragging(null)}
        onDragEnd={onDragEnd}
      >
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside
            aria-label="Block palette"
            className="lg:sticky lg:top-4 lg:self-start"
          >
            <h2 className="mb-1 text-[13px] font-semibold text-foreground">
              Blocks
            </h2>
            <p className="mb-2 text-[12px] text-muted-foreground">
              Drag a block into a section, or use the plus.
            </p>
            <ul className="grid gap-1.5">
              {data.palette.map((item) => (
                <PaletteTile key={item.type} item={item} onAdd={setAddFor} />
              ))}
            </ul>
          </aside>

          <div className="grid gap-3">
            {data.sections.map((section) => {
              const entryIds = section.blocks
                .filter((block) => block.kind === "entry")
                .map((block) => block.target);
              return (
                <SectionDrop
                  key={section.id}
                  section={section}
                  active={Boolean(dragging?.startsWith("palette:"))}
                >
                  <SortableContext
                    items={entryIds}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="grid gap-2">
                      {section.blocks.map((block) => (
                        <BlockCard
                          key={block.target}
                          block={block}
                          onOpen={(item) =>
                            setEditing({ mode: "edit", block: item })
                          }
                        />
                      ))}
                      {section.blocks.length === 0 ? (
                        <li className="rounded-md border border-dashed border-border p-3 text-[12.5px] text-muted-foreground">
                          Drop a block here.
                        </li>
                      ) : null}
                    </ul>
                  </SortableContext>
                </SectionDrop>
              );
            })}
          </div>
        </div>
        <DragOverlay>
          {dragging?.startsWith("palette:") ? (
            <div className="rounded-md border border-border bg-card px-3 py-2 text-[13px] font-medium shadow-lg">
              {
                data.palette.find((item) => `palette:${item.type}` === dragging)
                  ?.label
              }
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <AddToSection
        item={addFor}
        sections={data.sections}
        onClose={() => setAddFor(null)}
        onPick={(section) => addFor && startNew(addFor, section)}
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

/** Keyboard and touch alternative to dragging from the palette. */
function AddToSection({
  item,
  sections,
  onClose,
  onPick,
}: {
  item: PaletteItem | null;
  sections: PlaybookView["sections"];
  onClose: () => void;
  onPick: (section: SectionId) => void;
}) {
  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Add {item?.label}</SheetTitle>
          <SheetDescription>Choose the section it belongs in.</SheetDescription>
        </SheetHeader>
        <ul className="grid gap-1.5 px-4">
          {sections
            .filter((section) => item?.sections.includes(section.id))
            .map((section) => (
              <li key={section.id}>
                <button
                  type="button"
                  className="w-full rounded-md border border-border px-3 py-2 text-left text-[13px] hover:bg-muted"
                  onClick={() => {
                    onPick(section.id as SectionId);
                    onClose();
                  }}
                >
                  <div className="font-medium">{section.label}</div>
                  <div className="text-[12px] text-muted-foreground">
                    {section.hint}
                  </div>
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
    editing.mode === "new"
      ? `New ${type?.label ?? "block"}`
      : `${existing!.blockLabel}: ${existing!.target}`;

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
        <SheetDescription>
          {type?.description} Owned by{" "}
          {
            OWNER_NAMES[
              existing?.ownerTeam ?? type?.defaultOwnerTeam ?? "revops"
            ]
          }
          ; changes go to your draft, and that team approves them before they
          take effect.
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
              className={cn(area, "min-h-24")}
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
