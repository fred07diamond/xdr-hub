import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import { useOrgRole } from "@agent-native/core/client/org";
import {
  IconCheck,
  IconFileText,
  IconLoader2,
  IconLock,
  IconPlus,
  IconTarget,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { useRef, useState } from "react";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `${APP_TITLE} — ICP` }];
}

const PERSONA_COLORS = [
  { hex: "#6366f1", name: "Indigo" },
  { hex: "#f97316", name: "Orange" },
  { hex: "#22c55e", name: "Green" },
  { hex: "#ec4899", name: "Pink" },
  { hex: "#0ea5e9", name: "Sky" },
  { hex: "#eab308", name: "Yellow" },
  { hex: "#a855f7", name: "Purple" },
  { hex: "#ef4444", name: "Red" },
];

const ACCEPTED_EXT = [".txt", ".md", ".markdown"];
const ACCEPTED_INPUT = ACCEPTED_EXT.join(",");

// Mirrors MAX_DOCS_PER_PERSONA in server/helpers/persona-docs.ts -- kept here
// only so the UI can stop a doomed upload before sending it; the server
// enforces the real limit.
const MAX_DOCS_PER_PERSONA = 25;

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

function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

interface LoadedDoc {
  name: string;
  text: string;
}

/**
 * Reads a whole FileList, keeping the user's selection order. Returns the
 * readable documents plus a single message describing everything that was
 * rejected, so selecting eight files and getting two skipped reports both
 * rather than failing the entire batch or silently dropping them.
 */
async function readDocuments(
  files: FileList | File[],
): Promise<{ documents: LoadedDoc[]; error: string | null }> {
  const picked = Array.from(files);
  const rejected: string[] = [];
  const documents: LoadedDoc[] = [];

  for (const file of picked) {
    if (!isAccepted(file)) {
      rejected.push(`${file.name} (unsupported type)`);
      continue;
    }
    try {
      const text = await readFileAsText(file);
      if (!text.trim()) {
        rejected.push(`${file.name} (empty)`);
        continue;
      }
      documents.push({ name: file.name, text });
    } catch {
      rejected.push(`${file.name} (could not be read)`);
    }
  }

  return {
    documents,
    error: rejected.length
      ? `Skipped ${rejected.length} file${rejected.length === 1 ? "" : "s"}: ${rejected.join(", ")}. Only .txt and .md are supported.`
      : null,
  };
}

interface PersonaDoc {
  id: string;
  name: string;
  wordCount: number;
}

interface Persona {
  id: string;
  name: string;
  color: string;
  summary: string | null;
  wordCount: number;
  documents: PersonaDoc[];
  docCount: number;
  isActive: number;
  createdAt: string | null;
  updatedAt: string | null;
}

// ── Color swatch picker ──────────────────────────────────────────────────────

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {PERSONA_COLORS.map((c) => (
        <button
          key={c.hex}
          type="button"
          onClick={() => onChange(c.hex)}
          style={{ background: c.hex }}
          className="h-5 w-5 rounded-full transition-transform hover:scale-110"
          aria-label={c.name}
          aria-pressed={value === c.hex}
          title={c.name}
        >
          {value === c.hex && (
            <IconCheck size={11} className="mx-auto text-white" strokeWidth={3} />
          )}
        </button>
      ))}
    </div>
  );
}

// ── Persona card ─────────────────────────────────────────────────────────────

function PersonaCard({
  persona,
  isAdmin,
  onRefetch,
}: {
  persona: Persona;
  isAdmin: boolean;
  onRefetch: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const updatePersona = useActionMutation("update-icp-persona");
  const deletePersona = useActionMutation("delete-icp-persona");
  const setActive = useActionMutation("set-active-persona");
  const addDocuments = useActionMutation("add-persona-documents");
  const deleteDocument = useActionMutation("delete-persona-document");

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(persona.name);
  const [dragOver, setDragOver] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [removingDocId, setRemovingDocId] = useState<string | null>(null);

  const isActive = persona.isActive === 1;
  const documents = persona.documents ?? [];
  const remainingSlots = MAX_DOCS_PER_PERSONA - documents.length;

  async function handleNameBlur() {
    setEditingName(false);
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== persona.name) {
      await updatePersona.mutateAsync({ id: persona.id, name: trimmed });
      onRefetch();
    } else {
      setNameDraft(persona.name);
    }
  }

  async function handleColorChange(color: string) {
    await updatePersona.mutateAsync({ id: persona.id, color });
    onRefetch();
  }

  async function handleSetActive() {
    await setActive.mutateAsync({ id: persona.id });
    onRefetch();
  }

  // ADDS to the persona's documents -- never replaces them. update-icp-persona's
  // icpText argument is the destructive replace path and is deliberately not
  // used here; a second upload used to silently wipe out the first document.
  async function loadFiles(files: FileList | File[]) {
    setDocError(null);
    setUploading(true);
    try {
      const { documents: loaded, error } = await readDocuments(files);
      if (error) setDocError(error);
      if (loaded.length === 0) return;

      if (loaded.length > remainingSlots) {
        setDocError(
          `This persona can hold ${MAX_DOCS_PER_PERSONA} documents (${documents.length} attached, ${loaded.length} selected).`,
        );
        return;
      }

      const result = (await addDocuments.mutateAsync({
        personaId: persona.id,
        documents: loaded,
      })) as { ok?: boolean; error?: string };
      if (result?.ok === false) {
        setDocError(result.error ?? "Could not add those documents.");
        return;
      }
      onRefetch();
    } finally {
      setUploading(false);
    }
  }

  async function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files?.length) await loadFiles(files);
    e.target.value = "";
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files?.length) await loadFiles(files);
  }

  async function handleRemoveDocument(docId: string) {
    setDocError(null);
    setRemovingDocId(docId);
    try {
      const result = (await deleteDocument.mutateAsync({ id: docId })) as {
        ok?: boolean;
        error?: string;
      };
      if (result?.ok === false) {
        setDocError(result.error ?? "Could not remove that document.");
        return;
      }
      onRefetch();
    } finally {
      setRemovingDocId(null);
    }
  }

  async function handleDelete() {
    const result = await deletePersona.mutateAsync({ id: persona.id });
    if ((result as any)?.ok === false) {
      alert((result as any).error);
      setConfirmDelete(false);
      return;
    }
    onRefetch();
  }

  return (
    <div
      className="relative flex flex-col rounded-xl border border-border bg-card shadow-sm overflow-hidden"
      style={{ borderTop: `4px solid ${persona.color}` }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_INPUT}
        multiple
        className="hidden"
        onChange={handleFileInput}
      />

      <div className="flex flex-1 flex-col p-4 gap-3">
        {/* Name + active badge */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {isAdmin && editingName ? (
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={handleNameBlur}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") { setNameDraft(persona.name); setEditingName(false); }
                }}
                className="w-full rounded border border-ring bg-background px-1.5 py-0.5 text-sm font-semibold text-foreground focus:outline-none"
              />
            ) : isAdmin ? (
              <button
                type="button"
                onClick={() => setEditingName(true)}
                className="w-full text-left text-sm font-semibold text-foreground hover:text-primary truncate block"
                title="Click to rename"
              >
                {persona.name}
              </button>
            ) : (
              <p className="text-sm font-semibold text-foreground truncate">{persona.name}</p>
            )}
          </div>
          {isActive && (
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
              style={{ background: persona.color }}
              title="Used as fallback when auto-detection is inconclusive"
            >
              Default
            </span>
          )}
        </div>

        {/* Summary — first paragraph of the first document, which is also what
            the persona-matching model sees (see select-persona.ts) */}
        <div className="min-h-[48px]">
          {persona.summary ? (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
              {persona.summary}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground/50 italic">No documents uploaded yet</p>
          )}
        </div>

        {/* Attached documents — every one of these feeds the agent's scoring
            and drafting for this persona, in the order shown */}
        {documents.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
              {documents.length} document{documents.length === 1 ? "" : "s"} ·{" "}
              {persona.wordCount.toLocaleString()} words
            </p>
            <ul className="flex flex-col gap-1">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className="group flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5"
                >
                  <IconFileText size={13} className="shrink-0 text-muted-foreground/70" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium text-foreground" title={doc.name}>
                      {doc.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground/60">
                      {doc.wordCount.toLocaleString()} words
                    </p>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => handleRemoveDocument(doc.id)}
                      disabled={removingDocId === doc.id}
                      className="shrink-0 rounded p-0.5 text-muted-foreground/40 transition-colors hover:bg-muted hover:text-destructive disabled:opacity-40"
                      aria-label={`Remove ${doc.name}`}
                      title={`Remove ${doc.name}`}
                    >
                      {removingDocId === doc.id ? (
                        <IconLoader2 size={12} className="animate-spin" />
                      ) : (
                        <IconX size={12} />
                      )}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Color picker — admin only */}
        {isAdmin && <ColorPicker value={persona.color} onChange={handleColorChange} />}

        {/* Add-documents drop zone — always available to an admin, not just
            when the persona is empty, since documents now accumulate */}
        {isAdmin && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => remainingSlots > 0 && fileInputRef.current?.click()}
            className={`flex items-center justify-center gap-2 rounded-lg border border-dashed py-3 text-xs transition-colors ${
              remainingSlots <= 0
                ? "cursor-not-allowed border-border/40 text-muted-foreground/40"
                : dragOver
                  ? "cursor-pointer border-primary bg-primary/5 text-primary"
                  : "cursor-pointer border-border/60 text-muted-foreground/60 hover:border-border hover:text-muted-foreground"
            }`}
          >
            {uploading ? (
              <IconLoader2 size={13} className="animate-spin" />
            ) : (
              <IconUpload size={13} />
            )}
            {uploading
              ? "Uploading…"
              : remainingSlots <= 0
                ? `Document limit reached (${MAX_DOCS_PER_PERSONA})`
                : documents.length > 0
                  ? "Drop or click to add more documents"
                  : "Drop or click to upload documents"}
          </div>
        )}
        {docError && <p className="text-[11px] text-destructive">{docError}</p>}
        {documents.length === 0 && !isAdmin && (
          <p className="text-xs text-muted-foreground/50 italic">No documents uploaded yet</p>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
        {isAdmin ? (
          <>
            <div className="flex items-center gap-2">
              {!isActive && (
                <button
                  type="button"
                  onClick={handleSetActive}
                  disabled={setActive.isPending}
                  style={setActive.isPending ? {} : { borderColor: persona.color, color: persona.color }}
                  className="rounded-full border px-3 py-1 text-xs font-semibold transition-colors hover:opacity-80 disabled:opacity-40"
                >
                  {setActive.isPending ? "Setting…" : "Set as default"}
                </button>
              )}
              {remainingSlots > 0 && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  Add documents
                </button>
              )}
            </div>

            {/* Delete */}
            <div>
              {confirmDelete ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deletePersona.isPending}
                    className="rounded px-2 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
                  >
                    {deletePersona.isPending ? "Deleting…" : "Confirm"}
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
                  className="rounded p-1.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-destructive"
                  aria-label="Delete persona"
                >
                  <IconTrash size={14} />
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50">
            <IconLock size={11} />
            Managed by admin
          </div>
        )}
      </div>

      {/* Drag overlay when doc exists — admin only */}
      {isAdmin && documents.length > 0 && remainingSlots > 0 && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`absolute inset-0 rounded-xl border-2 border-dashed transition-all pointer-events-none ${
            dragOver ? "border-primary bg-primary/10 pointer-events-auto" : "border-transparent"
          }`}
        >
          {dragOver && (
            <div className="flex h-full items-center justify-center">
              <p className="rounded-lg bg-background/90 px-4 py-2 text-sm font-medium text-primary shadow">
                Drop to add documents
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── New persona sheet ────────────────────────────────────────────────────────

function NewPersonaPanel({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createPersona = useActionMutation("create-icp-persona");

  const [name, setName] = useState("");
  const [color, setColor] = useState(PERSONA_COLORS[0].hex);
  const [pendingDocs, setPendingDocs] = useState<LoadedDoc[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadFiles(files: FileList | File[]) {
    setError(null);
    const { documents: loaded, error: readError } = await readDocuments(files);
    if (readError) setError(readError);
    if (loaded.length === 0) return;

    // Appends, so the picker can be opened more than once to build the set up
    // (and re-picking the same file replaces that entry rather than duplicating
    // it, which is what re-dragging a corrected file is meant to do).
    setPendingDocs((prev) => {
      const merged = [...prev];
      for (const doc of loaded) {
        const at = merged.findIndex((d) => d.name === doc.name);
        if (at >= 0) merged[at] = doc;
        else merged.push(doc);
      }
      return merged.slice(0, MAX_DOCS_PER_PERSONA);
    });
    if (!name) setName(loaded[0].name.replace(/\.[^.]+$/, ""));
  }

  async function handleCreate() {
    if (!name.trim() || pendingDocs.length === 0) return;
    const result = (await createPersona.mutateAsync({
      name: name.trim(),
      color,
      documents: pendingDocs,
    })) as { ok?: boolean; error?: string };
    if (result?.ok === false) {
      setError(result.error ?? "Could not create that persona.");
      return;
    }
    onCreated();
    onClose();
  }

  const totalWords = pendingDocs.reduce((sum, d) => sum + wordCount(d.text), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">New persona</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
            <IconX size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          {/* Name */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. VP Engineering"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Color */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Color</label>
            <ColorPicker value={color} onChange={setColor} />
          </div>

          {/* Files — a persona can be built from several documents at once */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              ICP Documents
              {pendingDocs.length > 0 && (
                <span className="ml-1.5 font-normal text-muted-foreground/60">
                  {pendingDocs.length} selected · {totalWords.toLocaleString()} words
                </span>
              )}
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_INPUT}
              multiple
              className="hidden"
              onChange={async (e) => {
                const files = e.target.files;
                if (files?.length) await loadFiles(files);
                e.target.value = "";
              }}
            />

            {pendingDocs.length > 0 && (
              <ul className="mb-2 flex max-h-40 flex-col gap-1 overflow-auto">
                {pendingDocs.map((doc) => (
                  <li
                    key={doc.name}
                    className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2"
                  >
                    <IconFileText size={16} className="shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground" title={doc.name}>
                        {doc.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {wordCount(doc.text).toLocaleString()} words
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPendingDocs((prev) => prev.filter((d) => d.name !== doc.name))}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                      aria-label={`Remove ${doc.name}`}
                    >
                      <IconX size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setDragOver(false);
                const files = e.dataTransfer.files;
                if (files?.length) await loadFiles(files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed text-center transition-colors ${pendingDocs.length > 0 ? "py-3" : "py-6"} ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-border/60"}`}
            >
              <IconUpload size={pendingDocs.length > 0 ? 16 : 20} className="text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">
                Drop {pendingDocs.length > 0 ? "more files" : "files"} or{" "}
                <span className="text-primary underline underline-offset-2">browse</span>
              </p>
              {pendingDocs.length === 0 && (
                <p className="text-[11px] text-muted-foreground/50">.txt · .md · select several at once</p>
              )}
            </div>
            {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!name.trim() || pendingDocs.length === 0 || createPersona.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            {createPersona.isPending && <IconLoader2 size={12} className="animate-spin" />}
            Create persona
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Route ────────────────────────────────────────────────────────────────────

export default function IcpRoute() {
  const { canManageOrg } = useOrgRole();
  const isAdmin = canManageOrg;

  const { data, isLoading, refetch } = useActionQuery("list-icp-personas", {}, {
    refetchInterval: 30000,
    staleTime: 25000,
  });
  const [creating, setCreating] = useState(false);

  const personas: Persona[] = (data as any)?.personas ?? [];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold text-foreground">ICP Personas</h1>
          <p className="text-xs text-muted-foreground">
            {isLoading
              ? "Loading…"
              : personas.length === 0
                ? isAdmin
                  ? "No personas yet — create one to start scoring prospects"
                  : "No personas yet — ask an admin to create one"
                : `${personas.length} persona${personas.length === 1 ? "" : "s"} · auto-detected per prospect`}
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <IconPlus size={13} />
            New persona
          </button>
        )}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : personas.length === 0 ? (
          <div
            className={`flex h-48 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border text-center transition-colors ${isAdmin ? "cursor-pointer hover:border-border/60 hover:bg-muted/20" : ""}`}
            onClick={isAdmin ? () => setCreating(true) : undefined}
          >
            <IconTarget size={32} className="text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">No personas yet</p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                {isAdmin
                  ? "Create a persona for each type of prospect you target"
                  : "Ask an admin to set up personas"}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {personas.map((p) => (
              <PersonaCard key={p.id} persona={p} isAdmin={isAdmin} onRefetch={refetch} />
            ))}
            {isAdmin && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-muted-foreground/50 transition-colors hover:border-border hover:text-muted-foreground"
              >
                <IconPlus size={22} />
                <span className="text-xs font-medium">New persona</span>
              </button>
            )}
          </div>
        )}
      </div>

      {isAdmin && creating && (
        <NewPersonaPanel
          onClose={() => setCreating(false)}
          onCreated={refetch}
        />
      )}
    </div>
  );
}
