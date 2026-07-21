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
  color: string;
  summary: string | null;
  wordCount: number;
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

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(persona.name);
  const [dragOver, setDragOver] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState(false);

  const isActive = persona.isActive === 1;

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

  async function loadFile(file: File) {
    if (!isAccepted(file)) return;
    setUploading(true);
    try {
      const text = await readFileAsText(file);
      if (text.trim()) {
        await updatePersona.mutateAsync({ id: persona.id, icpText: text });
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

        {/* Summary */}
        <div className="min-h-[48px]">
          {persona.summary ? (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
              {persona.summary}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground/50 italic">No document uploaded yet</p>
          )}
        </div>

        {/* Word count */}
        {persona.wordCount > 0 && (
          <p className="text-xs text-muted-foreground/60">
            {persona.wordCount.toLocaleString()} words
          </p>
        )}

        {/* Color picker — admin only */}
        {isAdmin && <ColorPicker value={persona.color} onChange={handleColorChange} />}

        {/* Drop zone hint when no doc */}
        {!persona.summary && isAdmin && (
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
        {!persona.summary && !isAdmin && (
          <p className="text-xs text-muted-foreground/50 italic">No document uploaded yet</p>
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
                  {setActive.isPending ? "Setting…" : "Set active"}
                </button>
              )}
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
  const createPersona = useActionMutation("create-icp-persona");

  const [name, setName] = useState("");
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
    await createPersona.mutateAsync({ name: name.trim(), color, icpText: pendingFile.text });
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

          {/* File */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">ICP Document</label>
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
