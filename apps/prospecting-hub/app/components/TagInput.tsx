import { IconX } from "@tabler/icons-react";
import { useState } from "react";

export function safeParseList(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function TagChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-foreground"
        aria-label={`Remove ${label}`}
      >
        <IconX size={11} />
      </button>
    </span>
  );
}

// Generic multi-value chip entry — type text, press Enter or "," to commit
// it as a chip; Backspace on an empty input removes the last chip; click a
// chip's × to remove it directly. Case-insensitive dedup on commit. Replaces
// a raw comma-separated text field per Fred's explicit ask for a
// CommonRoom-like tagging UI instead of typing a delimited string.
export function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState("");

  function commit(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (!values.some((v) => v.toLowerCase() === trimmed.toLowerCase())) {
      onChange([...values, trimmed]);
    }
    setText("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(text);
    } else if (e.key === "Backspace" && text === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
      {values.map((v, i) => (
        <TagChip key={`${v}-${i}`} label={v} onRemove={() => onChange(values.filter((_, idx) => idx !== i))} />
      ))}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => commit(text)}
        placeholder={values.length === 0 ? placeholder : undefined}
        className="min-w-[80px] flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
      />
    </div>
  );
}
