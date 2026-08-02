import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import {
  IconBuildingSkyscraper,
  IconFileText,
  IconLoader2,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUpload,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import { useMemo, useRef, useState } from "react";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `${APP_TITLE} — Sales Library` }];
}

// ── Categories ────────────────────────────────────────────────────────────────
// No server-side label mapping exists — this is the single local source of
// truth for how the 7 fixed category values (from library-tagging.ts's
// LIBRARY_CATEGORIES) are labeled and colored in this UI.

type LibraryCategory =
  | "icp"
  | "persona_messaging"
  | "sales_process"
  | "campaigns"
  | "tools"
  | "positioning"
  | "other";

const CATEGORY_LABELS: Record<LibraryCategory, string> = {
  icp: "ICP",
  persona_messaging: "Personas & Messaging",
  sales_process: "Sales Process",
  campaigns: "Campaigns",
  tools: "Tools",
  positioning: "Positioning",
  other: "Other",
};

const CATEGORY_COLORS: Record<LibraryCategory, string> = {
  icp: "#6366f1", // indigo
  persona_messaging: "#ec4899", // pink
  sales_process: "#22c55e", // green
  campaigns: "#f97316", // orange
  tools: "#0ea5e9", // sky
  positioning: "#a855f7", // purple
  other: "#64748b", // slate
};

const CATEGORIES = Object.keys(CATEGORY_LABELS) as LibraryCategory[];

const ACCEPTED_EXT = [".txt", ".md", ".markdown"];
const ACCEPTED_INPUT = ACCEPTED_EXT.join(",");

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function isAccepted(file: File) {
  const ext = "." + file.name.split(".").pop()?.toLowerCase();
  return ACCEPTED_EXT.includes(ext) || file.type.startsWith("text/");
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface LibraryDocSummary {
  id: string;
  name: string;
  category: LibraryCategory;
  tags: string[];
  contentSnippet: string;
  linkedPersonaId: string | null;
  linkedPersonaName: string | null;
  linkedIcpId: string | null;
  linkedIcpName: string | null;
  ownerEmail: string;
  createdAt: string | null;
}

interface LibraryDocFull {
  id: string;
  name: string;
  category: LibraryCategory;
  tags: string[];
  content: string;
  linkedPersonaId: string | null;
  linkedIcpId: string | null;
  ownerEmail: string;
  createdAt: string | null;
}

interface PersonaOption {
  id: string;
  name: string;
  color: string | null;
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: LibraryCategory }) {
  const color = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.other;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ borderColor: `${color}55`, color, background: `${color}14` }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
      {CATEGORY_LABELS[category] ?? category}
    </span>
  );
}

function TagChip({
  children,
  onRemove,
}: {
  children: React.ReactNode;
  onRemove?: () => void;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-foreground">
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={`Remove tag ${children}`}
        >
          <IconX size={10} />
        </button>
      )}
    </span>
  );
}

function PersonaBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <IconUser size={11} />
      {name}
    </span>
  );
}

// Distinct from PersonaBadge on purpose — amber/firmographic styling and a
// "Criteria:" prefix so a doc linked to Company Criteria reads as "a
// different kind of link" than one linked to a person-level persona, not a
// copy-pasted clone.
function CriteriaBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
      <IconBuildingSkyscraper size={11} />
      Criteria: {name}
    </span>
  );
}

// Editable tag chip list — adds via Enter, removes via the chip's × button.
// Each change is saved immediately (matching this file's other inline-edit
// fields), so callers only need to pass the current saved value + a setter.
function TagEditor({
  tags,
  onChange,
  saving,
}: {
  tags: string[];
  onChange: (next: string[]) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState("");

  function addTag() {
    const trimmed = draft.trim();
    if (!trimmed || tags.includes(trimmed)) {
      setDraft("");
      return;
    }
    onChange([...tags, trimmed]);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.length === 0 && (
          <p className="text-[11px] italic text-muted-foreground/50">No tags</p>
        )}
        {tags.map((tag) => (
          <TagChip key={tag} onRemove={() => onChange(tags.filter((t) => t !== tag))}>
            {tag}
          </TagChip>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder="Add tag…"
          disabled={saving}
          className="w-32 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          type="button"
          onClick={addTag}
          disabled={saving || !draft.trim()}
          className="rounded px-1.5 py-1 text-[11px] text-primary hover:underline disabled:opacity-40"
        >
          Add
        </button>
        {saving && <IconLoader2 size={11} className="animate-spin text-muted-foreground" />}
      </div>
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

function LibraryCard({
  doc,
  onSelect,
}: {
  doc: LibraryDocSummary;
  onSelect: () => void;
}) {
  const color = CATEGORY_COLORS[doc.category] ?? CATEGORY_COLORS.other;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 text-left shadow-sm transition-colors hover:border-ring"
      style={{ borderTop: `4px solid ${color}` }}
    >
      <p className="truncate text-sm font-semibold text-foreground">{doc.name}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <CategoryBadge category={doc.category} />
        {doc.linkedPersonaName && <PersonaBadge name={doc.linkedPersonaName} />}
        {doc.linkedIcpName && <CriteriaBadge name={doc.linkedIcpName} />}
      </div>
      <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
        {doc.contentSnippet}
      </p>
      {doc.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {doc.tags.slice(0, 4).map((tag) => (
            <TagChip key={tag}>{tag}</TagChip>
          ))}
          {doc.tags.length > 4 && (
            <span className="text-[11px] text-muted-foreground/50">+{doc.tags.length - 4}</span>
          )}
        </div>
      )}
    </button>
  );
}

// ── Detail / edit panel ──────────────────────────────────────────────────────

function DetailPanel({
  docId,
  personaOptions,
  onClose,
  onChanged,
  onDeleted,
}: {
  docId: string;
  personaOptions: PersonaOption[];
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { data, isLoading, refetch } = useActionQuery("get-library-doc", { id: docId });
  const updateDoc = useActionMutation("update-library-doc");
  const deleteDoc = useActionMutation("delete-library-doc");

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const doc = data as LibraryDocFull | undefined;

  async function runUpdate(patch: Record<string, unknown>) {
    setActionError(null);
    const result = await updateDoc.mutateAsync({ id: docId, ...patch });
    if ((result as { ok?: boolean; error?: string })?.ok === false) {
      setActionError((result as { error: string }).error);
      return;
    }
    refetch();
    onChanged();
  }

  async function handleNameBlur() {
    setEditingName(false);
    if (!doc) return;
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== doc.name) {
      await runUpdate({ name: trimmed });
    }
  }

  async function handleDelete() {
    const result = await deleteDoc.mutateAsync({ id: docId });
    if ((result as { ok?: boolean; error?: string })?.ok === false) {
      setActionError((result as { error: string }).error);
      setConfirmDelete(false);
      return;
    }
    onDeleted();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-card border border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          {editingName && doc ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={handleNameBlur}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setNameDraft(doc.name);
                  setEditingName(false);
                }
              }}
              className="min-w-0 flex-1 rounded border border-ring bg-background px-1.5 py-0.5 text-sm font-semibold text-foreground focus:outline-none"
            />
          ) : (
            <button
              type="button"
              disabled={!doc}
              onClick={() => {
                if (doc) {
                  setNameDraft(doc.name);
                  setEditingName(true);
                }
              }}
              className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-foreground hover:text-primary"
              title="Click to rename"
            >
              {doc?.name ?? "Loading…"}
            </button>
          )}
          <button type="button" onClick={onClose} className="ms-2 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted">
            <IconX size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {isLoading || !doc ? (
            <div className="flex h-32 items-center justify-center">
              <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Category</label>
                  <select
                    value={doc.category}
                    onChange={(e) => runUpdate({ category: e.target.value as LibraryCategory })}
                    disabled={updateDoc.isPending}
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Linked persona</label>
                  <select
                    value={doc.linkedPersonaId ?? ""}
                    onChange={(e) => runUpdate({ linkedPersonaId: e.target.value || null })}
                    disabled={updateDoc.isPending}
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">None</option>
                    {personaOptions.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">Tags</label>
                <TagEditor
                  tags={doc.tags}
                  saving={updateDoc.isPending}
                  onChange={(next) => runUpdate({ tags: next })}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">Content</label>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/20 p-3 text-xs leading-relaxed text-foreground">
                  {doc.content}
                </pre>
              </div>

              {actionError && <p className="text-xs text-destructive">{actionError}</p>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <p className="text-[11px] text-muted-foreground/60">
            {doc ? `Added by ${doc.ownerEmail}` : ""}
          </p>
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteDoc.isPending}
                className="rounded px-2 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
              >
                {deleteDoc.isPending ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted"
              >
                <IconX size={12} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={!doc}
              className="inline-flex items-center gap-1.5 rounded p-1.5 text-xs text-muted-foreground/60 transition-colors hover:bg-muted hover:text-destructive"
            >
              <IconTrash size={13} />
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Upload panel ─────────────────────────────────────────────────────────────

function UploadPanel({
  personaOptions,
  onClose,
  onCreated,
}: {
  personaOptions: PersonaOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createDoc = useActionMutation("create-library-doc");
  const updateDoc = useActionMutation("update-library-doc");

  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [linkedPersonaId, setLinkedPersonaId] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  // After a successful create, we switch into "review" mode: the AI-derived
  // category/tags are shown as editable chips right away, and any change is
  // saved via update-library-doc before closing.
  const [created, setCreated] = useState<{ id: string; category: LibraryCategory; tags: string[] } | null>(null);

  async function loadFile(file: File) {
    setError(null);
    if (!isAccepted(file)) {
      setError("Only .txt and .md files supported.");
      return;
    }
    const loaded = await readFileAsText(file);
    if (!loaded.trim()) {
      setError("File appears to be empty.");
      return;
    }
    setText(loaded);
    setFileName(file.name);
    if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
  }

  async function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) await loadFile(file);
    e.target.value = "";
  }

  async function handleCreate() {
    if (!name.trim() || !text.trim()) return;
    setError(null);
    const result = (await createDoc.mutateAsync({
      name: name.trim(),
      text,
      linkedPersonaId: linkedPersonaId || undefined,
    })) as { id: string; category: LibraryCategory; tags: string[] };
    setCreated(result);
    onCreated();
  }

  async function handleCategoryChange(category: LibraryCategory) {
    if (!created) return;
    const previous = created;
    setCreated({ ...created, category });
    setError(null);
    const result = await updateDoc.mutateAsync({ id: created.id, category });
    if ((result as { ok?: boolean; error?: string })?.ok === false) {
      setCreated(previous);
      setError((result as { error: string }).error);
    }
  }

  async function handleTagsChange(tags: string[]) {
    if (!created) return;
    const previous = created;
    setCreated({ ...created, tags });
    setError(null);
    const result = await updateDoc.mutateAsync({ id: created.id, tags });
    if ((result as { ok?: boolean; error?: string })?.ok === false) {
      setCreated(previous);
      setError((result as { error: string }).error);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">
            {created ? "Review category & tags" : "Upload doc"}
          </h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
            <IconX size={16} />
          </button>
        </div>

        {created ? (
          <div className="flex flex-col gap-4 p-5">
            <p className="text-xs text-muted-foreground">
              We derived a category and tags from “{name.trim()}”. Adjust them if needed — changes save automatically.
            </p>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Category</label>
              <select
                value={created.category}
                onChange={(e) => handleCategoryChange(e.target.value as LibraryCategory)}
                disabled={updateDoc.isPending}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Tags</label>
              <TagEditor tags={created.tags} saving={updateDoc.isPending} onChange={handleTagsChange} />
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-5">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Name</label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Enterprise Cold Call Script"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Linked persona (optional)</label>
              <select
                value={linkedPersonaId}
                onChange={(e) => setLinkedPersonaId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">None</option>
                {personaOptions.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Document text</label>
              <textarea
                value={text}
                onChange={(e) => { setText(e.target.value); setFileName(null); }}
                placeholder="Paste text here…"
                rows={6}
                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
              />

              <input ref={fileInputRef} type="file" accept={ACCEPTED_INPUT} className="hidden" onChange={handleFileInput} />

              {fileName ? (
                <div className="mt-2 flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
                  <IconFileText size={16} className="shrink-0 text-muted-foreground" />
                  <p className="min-w-0 flex-1 truncate text-xs text-foreground">{fileName}</p>
                  <button
                    type="button"
                    onClick={() => { setFileName(null); setText(""); }}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <IconX size={13} />
                  </button>
                </div>
              ) : (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={async (e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) await loadFile(f); }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed py-3 text-center text-xs transition-colors ${dragOver ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-border/60"}`}
                >
                  <IconUpload size={14} />
                  or drop / browse a .txt or .md file
                </div>
              )}
              {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          {created ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Done
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={!name.trim() || !text.trim() || createDoc.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              >
                {createDoc.isPending && <IconLoader2 size={12} className="animate-spin" />}
                Upload
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Route ────────────────────────────────────────────────────────────────────

export default function LibraryRoute() {
  const [categoryFilter, setCategoryFilter] = useState<LibraryCategory | "">("");
  const [search, setSearch] = useState("");
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const queryArgs = useMemo(
    () => ({
      category: categoryFilter || undefined,
      search: search.trim() || undefined,
    }),
    [categoryFilter, search],
  );

  const { data, isLoading, refetch } = useActionQuery("list-library-docs", queryArgs, {
    refetchInterval: 30000,
    staleTime: 25000,
  });
  const { data: personasData } = useActionQuery("list-personas", {});
  const personaOptions: PersonaOption[] = (personasData as { personas?: PersonaOption[] })?.personas ?? [];

  const docs: LibraryDocSummary[] = (data as { docs?: LibraryDocSummary[] })?.docs ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Sales Library</h1>
          <p className="text-xs text-muted-foreground">
            {isLoading
              ? "Loading…"
              : docs.length === 0
                ? "No docs yet — upload call scripts, ICP notes, and positioning docs"
                : `${docs.length} doc${docs.length === 1 ? "" : "s"}${categoryFilter || search ? " matching filters" : ""}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setUploading(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <IconPlus size={13} />
          Upload doc
        </button>
      </div>

      <div className="flex flex-col gap-2.5 border-b border-border px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCategoryFilter("")}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              categoryFilter === ""
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            All
          </button>
          {CATEGORIES.map((c) => {
            const active = categoryFilter === c;
            const color = CATEGORY_COLORS[c];
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategoryFilter(active ? "" : c)}
                className="rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors"
                style={
                  active
                    ? { background: color, color: "white" }
                    : { background: `${color}14`, color }
                }
              >
                {CATEGORY_LABELS[c]}
              </button>
            );
          })}
        </div>

        <div className="relative w-64">
          <IconSearch size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or content"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : docs.length === 0 ? (
          <div
            className="flex h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border text-center transition-colors hover:border-border/60 hover:bg-muted/20"
            onClick={() => setUploading(true)}
          >
            <IconFileText size={32} className="text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">No docs match</p>
              <p className="mt-1 text-xs text-muted-foreground/60">Upload a call script, ICP note, or positioning doc</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {docs.map((doc) => (
              <LibraryCard key={doc.id} doc={doc} onSelect={() => setSelectedDocId(doc.id)} />
            ))}
          </div>
        )}
      </div>

      {selectedDocId && (
        <DetailPanel
          docId={selectedDocId}
          personaOptions={personaOptions}
          onClose={() => setSelectedDocId(null)}
          onChanged={refetch}
          onDeleted={() => {
            setSelectedDocId(null);
            refetch();
          }}
        />
      )}

      {uploading && (
        <UploadPanel
          personaOptions={personaOptions}
          onClose={() => {
            setUploading(false);
            refetch();
          }}
          onCreated={refetch}
        />
      )}
    </div>
  );
}
