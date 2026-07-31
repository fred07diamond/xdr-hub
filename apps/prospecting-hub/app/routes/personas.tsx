import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
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
  return [{ title: `${APP_TITLE} — Personas` }];
}

const PERSONA_COLORS = [
  "#6366f1", // indigo
  "#f97316", // orange
  "#22c55e", // green
  "#ec4899", // pink
  "#0ea5e9", // sky
  "#eab308", // yellow
  "#a855f7", // purple
  "#ef4444", // red
];

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

interface Persona {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
  sourceDocUrl: string | null;
  wordCount: number;
  ownerEmail: string;
  createdAt: string | null;
}

interface SubPersona {
  id: string;
  personaId: string;
  name: string;
  wordCount: number;
  ownerEmail: string;
  createdAt: string | null;
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
          key={c}
          type="button"
          onClick={() => onChange(c)}
          style={{ background: c }}
          className="h-5 w-5 rounded-full transition-transform hover:scale-110"
          aria-label={c}
        >
          {value === c && (
            <IconCheck size={11} className="mx-auto text-white" strokeWidth={3} />
          )}
        </button>
      ))}
    </div>
  );
}

// ── Sub-personas (inline, XDR/AE-owned, on every card) ───────────────────────

function SubPersonaSection({ personaId }: { personaId: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [pendingFile, setPendingFile] = useState<{ name: string; text: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, refetch } = useActionQuery(
    "list-sub-personas",
    { personaId },
    { enabled: expanded },
  );
  const createSubPersona = useActionMutation("create-sub-persona");
  const deleteSubPersona = useActionMutation("delete-sub-persona");

  const subPersonas: SubPersona[] = (data as { subPersonas?: SubPersona[] })?.subPersonas ?? [];

  async function loadFile(file: File) {
    setError(null);
    if (!isAccepted(file)) { setError("Only .txt and .md files supported."); return; }
    const text = await readFileAsText(file);
    if (!text.trim()) { setError("File appears to be empty."); return; }
    setPendingFile({ name: file.name, text });
    if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
  }

  async function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) await loadFile(file);
    e.target.value = "";
  }

  function resetAddForm() {
    setAdding(false);
    setName("");
    setPendingFile(null);
    setError(null);
  }

  async function handleCreate() {
    if (!name.trim() || !pendingFile) return;
    await createSubPersona.mutateAsync({ personaId, name: name.trim(), text: pendingFile.text });
    resetAddForm();
    refetch();
  }

  async function handleDelete(id: string) {
    const result = await deleteSubPersona.mutateAsync({ id });
    if ((result as { ok?: boolean; error?: string })?.ok === false) {
      alert((result as { error: string }).error);
      return;
    }
    refetch();
  }

  return (
    <div className="border-t border-border/60 px-4 py-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        Sub-personas
        {expanded ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
      </button>

      {expanded && (
        <div className="mt-2 flex flex-col gap-1.5">
          {isLoading ? (
            <p className="text-[11px] text-muted-foreground/50">Loading…</p>
          ) : subPersonas.length === 0 ? (
            <p className="text-[11px] italic text-muted-foreground/50">None yet</p>
          ) : (
            subPersonas.map((sp) => (
              <div key={sp.id} className="flex items-center justify-between gap-2 rounded bg-muted/30 px-2 py-1">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium text-foreground">{sp.name}</p>
                  <p className="text-[10px] text-muted-foreground/60">{sp.wordCount.toLocaleString()} words</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(sp.id)}
                  disabled={deleteSubPersona.isPending}
                  className="shrink-0 rounded p-1 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-destructive"
                  aria-label={`Delete ${sp.name}`}
                >
                  <IconTrash size={11} />
                </button>
              </div>
            ))
          )}

          {adding ? (
            <div className="mt-1 flex flex-col gap-1.5 rounded-lg border border-border bg-background p-2">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sub-persona name"
                className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_INPUT}
                className="hidden"
                onChange={handleFileInput}
              />
              {pendingFile ? (
                <div className="flex items-center gap-2 rounded border border-border bg-muted/30 px-2 py-1">
                  <IconFileText size={12} className="shrink-0 text-muted-foreground" />
                  <p className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">{pendingFile.name}</p>
                  <button
                    type="button"
                    onClick={() => setPendingFile(null)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <IconX size={10} />
                  </button>
                </div>
              ) : (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={async (e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) await loadFile(f); }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex cursor-pointer items-center justify-center gap-1.5 rounded border border-dashed py-2 text-[10px] transition-colors ${
                    dragOver
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border/60 text-muted-foreground/60 hover:border-border"
                  }`}
                >
                  <IconUpload size={11} />
                  Drop or click to add criteria doc
                </div>
              )}
              {error && <p className="text-[10px] text-destructive">{error}</p>}
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={resetAddForm}
                  className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={!name.trim() || !pendingFile || createSubPersona.isPending}
                  className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                >
                  {createSubPersona.isPending && <IconLoader2 size={10} className="animate-spin" />}
                  Add
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-0.5 inline-flex items-center gap-1 self-start text-[11px] text-primary hover:underline"
            >
              <IconPlus size={11} />
              Add sub-persona
            </button>
          )}
        </div>
      )}
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
  const updatePersona = useActionMutation("update-persona");
  const deletePersona = useActionMutation("delete-persona");

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(persona.name);
  const [dragOver, setDragOver] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState(false);

  const color = persona.color ?? PERSONA_COLORS[0];

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

  async function handleColorChange(newColor: string) {
    await updatePersona.mutateAsync({ id: persona.id, color: newColor });
    onRefetch();
  }

  async function loadFile(file: File) {
    if (!isAccepted(file)) return;
    setUploading(true);
    try {
      const text = await readFileAsText(file);
      if (text.trim()) {
        await updatePersona.mutateAsync({ id: persona.id, text });
        onRefetch();
      }
    } finally {
      setUploading(false);
    }
  }

  async function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) await loadFile(file);
    e.target.value = "";
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await loadFile(file);
  }

  async function handleDelete() {
    const result = await deletePersona.mutateAsync({ id: persona.id });
    if ((result as { ok?: boolean; error?: string })?.ok === false) {
      alert((result as { error: string }).error);
      setConfirmDelete(false);
      return;
    }
    onRefetch();
  }

  return (
    <div
      className="relative flex flex-col rounded-xl border border-border bg-card shadow-sm overflow-hidden"
      style={{ borderTop: `4px solid ${color}` }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_INPUT}
        className="hidden"
        onChange={handleFileInput}
      />

      <div className="flex flex-1 flex-col p-4 gap-3">
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
        </div>

        <div className="min-h-[48px]">
          {persona.description ? (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
              {persona.description}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground/50 italic">No description</p>
          )}
        </div>

        {persona.wordCount > 0 && (
          <p className="text-xs text-muted-foreground/60">
            {persona.wordCount.toLocaleString()} words synced
          </p>
        )}

        {isAdmin && <ColorPicker value={color} onChange={handleColorChange} />}

        {persona.wordCount === 0 && isAdmin && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed py-3 text-xs transition-colors ${
              dragOver
                ? "border-primary bg-primary/5 text-primary"
                : "border-border/60 text-muted-foreground/60 hover:border-border hover:text-muted-foreground"
            }`}
          >
            {uploading ? (
              <IconLoader2 size={13} className="animate-spin" />
            ) : (
              <IconUpload size={13} />
            )}
            {uploading ? "Uploading…" : "Drop or click to upload doc"}
          </div>
        )}
        {persona.wordCount === 0 && !isAdmin && (
          <p className="text-xs text-muted-foreground/50 italic">No document uploaded yet</p>
        )}
      </div>

      <SubPersonaSection personaId={persona.id} />

      <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
        {isAdmin ? (
          <>
            <div className="flex items-center gap-2">
              {persona.wordCount > 0 && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  Replace doc
                </button>
              )}
            </div>

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

      {isAdmin && persona.wordCount > 0 && (
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
                Drop to replace document
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
  const createPersona = useActionMutation("create-persona");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(PERSONA_COLORS[0]);
  const [pendingFile, setPendingFile] = useState<{ name: string; text: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadFile(file: File) {
    setError(null);
    if (!isAccepted(file)) { setError("Only .txt and .md files supported."); return; }
    const text = await readFileAsText(file);
    if (!text.trim()) { setError("File appears to be empty."); return; }
    setPendingFile({ name: file.name, text });
    if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
  }

  async function handleCreate() {
    if (!name.trim() || !pendingFile) return;
    await createPersona.mutateAsync({
      name: name.trim(),
      color,
      description: description.trim() || undefined,
      text: pendingFile.text,
    });
    onCreated();
    onClose();
  }

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

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Description (optional)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One line about who this targets"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Color</label>
            <ColorPicker value={color} onChange={setColor} />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Persona document</label>
            <input ref={fileInputRef} type="file" accept={ACCEPTED_INPUT} className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await loadFile(f); e.target.value = ""; }} />

            {pendingFile ? (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                <IconFileText size={18} className="shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{pendingFile.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {pendingFile.text.split(/\s+/).filter(Boolean).length.toLocaleString()} words
                  </p>
                </div>
                <button type="button" onClick={() => setPendingFile(null)} className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground">
                  <IconX size={13} />
                </button>
              </div>
            ) : (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={async (e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) await loadFile(f); }}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed py-6 text-center transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-border/60"}`}
              >
                <IconUpload size={20} className="text-muted-foreground/50" />
                <p className="text-xs text-muted-foreground">
                  Drop a file or{" "}
                  <span className="text-primary underline underline-offset-2">browse</span>
                </p>
                <p className="text-[11px] text-muted-foreground/50">.txt · .md</p>
              </div>
            )}
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
            disabled={!name.trim() || !pendingFile || createPersona.isPending}
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

export default function PersonasRoute() {
  const { data: roleData } = useActionQuery("get-my-role", {});
  const isAdmin = (roleData as { role?: string })?.role === "admin";

  const { data, isLoading, refetch } = useActionQuery("list-personas", {}, {
    refetchInterval: 30000,
    staleTime: 25000,
  });
  const [creating, setCreating] = useState(false);

  const personas: Persona[] = (data as { personas?: Persona[] })?.personas ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Personas</h1>
          <p className="text-xs text-muted-foreground">
            {isLoading
              ? "Loading…"
              : personas.length === 0
                ? isAdmin
                  ? "No personas yet — upload a doc to define your first ICP"
                  : "No personas yet — ask an admin to create one"
                : `${personas.length} persona${personas.length === 1 ? "" : "s"} · used to score and sort contacts`}
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
                  ? "Upload a doc for each type of prospect you target"
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
