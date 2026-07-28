import type { ComponentType } from "react";
import { IconBriefcase, IconBuilding, IconUser, IconX } from "@tabler/icons-react";

export type TemplateSlug = "account" | "role" | "prospect" | "blank";

interface Template {
  slug: TemplateSlug;
  name: string;
  description: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
}

const TEMPLATES: Template[] = [
  {
    slug: "account",
    name: "Account-Based",
    description: "Company at the root, branches to org-level tone and role-specific messaging. The trickle-down model.",
    Icon: IconBuilding,
  },
  {
    slug: "role",
    name: "Role-Based",
    description: "Target a specific buyer persona. Pain-centric with role-specific language and example notes.",
    Icon: IconBriefcase,
  },
  {
    slug: "prospect",
    name: "Prospect-Driven",
    description: "Signal-led, ultra-personalized. Built for when you've done real research on a specific person.",
    Icon: IconUser,
  },
  {
    slug: "blank",
    name: "Blank",
    description: "Start with a single role node and build your own structure from scratch.",
    Icon: IconX,
  },
];

interface Props {
  open: boolean;
  onSelect: (slug: TemplateSlug) => void;
  onClose?: () => void;
}

export function TemplatePicker({ open, onSelect, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">Choose a starting template</h2>
          {onClose && (
            <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
              <IconX size={16} />
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 p-5">
          {TEMPLATES.map((t) => (
            <button
              key={t.slug}
              type="button"
              onClick={() => onSelect(t.slug)}
              className="flex flex-col items-start gap-2 rounded-xl border border-border p-4 text-left hover:border-primary hover:bg-primary/5 transition-colors"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted">
                <t.Icon size={16} className="text-foreground" />
              </div>
              <div>
                <p className="text-xs font-semibold">{t.name}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{t.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
