// apps/outreach/app/components/canvas/NodeContextMenu.tsx
import { IconCopy, IconSparkles, IconTrash, IconRefresh } from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

type AIAction = "variations" | "generate" | "rewrite";

interface MessagingNodeLike {
  id: string;
  type: string;
  title: string;
}

interface Props {
  x: number;
  y: number;
  node: MessagingNodeLike;
  onClose: () => void;
  onDelete: () => void;
  onAIAction: (action: AIAction, nodeId: string) => void;
}

export function NodeContextMenu({ x, y, node, onClose, onDelete, onAIAction }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const isProtected = node.type === "persona" || node.type === "global";

  return (
    <div
      ref={ref}
      style={{ position: "fixed", top: y, left: x, zIndex: 1000 }}
      className="w-52 rounded-xl border border-border bg-popover shadow-xl py-1 text-sm"
    >
      <MenuItem icon={<IconCopy size={13} />} label="Create variations" onClick={() => { onAIAction("variations", node.id); onClose(); }} />
      <MenuItem icon={<IconSparkles size={13} />} label="Generate content" onClick={() => { onAIAction("generate", node.id); onClose(); }} />
      <MenuItem icon={<IconRefresh size={13} />} label="Rewrite" onClick={() => { onAIAction("rewrite", node.id); onClose(); }} />
      {!isProtected && (
        <>
          <div className="my-1 border-t border-border" />
          <MenuItem
            icon={<IconTrash size={13} />}
            label="Delete node"
            onClick={() => { onDelete(); onClose(); }}
            danger
          />
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon, label, onClick, danger,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-muted transition-colors
        ${danger ? "text-destructive hover:bg-destructive/10" : "text-foreground"}`}
    >
      {icon}
      {label}
    </button>
  );
}
