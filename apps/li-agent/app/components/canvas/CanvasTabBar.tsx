import { IconLock, IconPlus, IconX } from "@tabler/icons-react";
import { useRef, useState } from "react";

export interface Canvas {
  id: string;
  name: string;
  isSystem: number;
  templateSlug: string | null;
}

interface Props {
  canvases: Canvas[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export function CanvasTabBar({ canvases, activeId, onSelect, onAdd, onRename, onDelete }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function startRename(canvas: Canvas) {
    if (canvas.isSystem) return;
    setEditingId(canvas.id);
    setEditValue(canvas.name);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitRename() {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  }

  return (
    <>
      <div className="flex items-center gap-0.5 border-b border-zinc-200 dark:border-zinc-800 px-2 overflow-x-auto">
        {canvases.map((canvas) => {
          const isActive = canvas.id === activeId;
          return (
            <div
              key={canvas.id}
              className={`group relative flex items-center gap-1.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-t whitespace-nowrap select-none transition-colors
                ${isActive
                  ? "border-b-2 border-primary text-foreground bg-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              onClick={() => onSelect(canvas.id)}
              onDoubleClick={() => startRename(canvas)}
            >
              {canvas.isSystem === 1 && (
                <IconLock size={10} className="shrink-0 opacity-60" />
              )}
              {editingId === canvas.id ? (
                <input
                  ref={inputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-24 bg-transparent border-b border-primary outline-none text-xs"
                />
              ) : (
                <span>{canvas.name}</span>
              )}
              {canvas.isSystem === 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDeleteId(canvas.id);
                  }}
                  className="hidden group-hover:flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-destructive/20 text-muted-foreground hover:text-destructive ml-0.5"
                >
                  <IconX size={9} />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center justify-center px-2 py-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
        >
          <IconPlus size={14} />
        </button>
      </div>

      {/* Delete confirmation dialog */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border shadow-2xl p-6">
            <h2 className="text-sm font-semibold mb-2">Delete this canvas?</h2>
            <p className="text-xs text-muted-foreground mb-5">
              This will permanently delete the canvas and all its nodes. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onDelete(confirmDeleteId);
                  setConfirmDeleteId(null);
                }}
                className="rounded-lg bg-destructive px-4 py-2 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
