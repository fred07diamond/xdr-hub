import { IconRefresh, IconX, IconClipboard, IconCheck, IconSparkles } from "@tabler/icons-react";
import { useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onGenerate: () => void;
  preview: string | null;
  generating: boolean;
}

export function PreviewPanel({ open, onClose, onGenerate, preview, generating }: Props) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  function handleCopy() {
    if (!preview) return;
    navigator.clipboard.writeText(preview).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="absolute right-0 top-0 bottom-0 w-80 z-30 flex flex-col bg-background border-l border-border shadow-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <IconSparkles size={14} className="text-primary" />
          <span className="text-sm font-semibold">Message Preview</span>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 hover:bg-muted text-muted-foreground">
          <IconX size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {generating && (
          <p className="text-xs text-muted-foreground italic animate-pulse">Generating preview…</p>
        )}
        {!generating && !preview && (
          <p className="text-xs text-muted-foreground italic">
            Click "Generate" to preview what a connection note would look like using this canvas.
          </p>
        )}
        {!generating && preview && (
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{preview}</p>
        )}
      </div>

      <div className="flex gap-2 px-4 py-3 border-t border-border">
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
        >
          <IconRefresh size={12} className={generating ? "animate-spin" : ""} />
          {preview ? "Regenerate" : "Generate"}
        </button>
        {preview && (
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
          >
            {copied ? <IconCheck size={12} /> : <IconClipboard size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    </div>
  );
}
