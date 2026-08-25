import { sendToAgentChat, useAgentChatGenerating } from "@agent-native/core/client/agent-chat";
import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  getSmoothStepPath,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useViewport,
} from "@xyflow/react";
import type { Connection, Edge, EdgeProps, Node, NodeProps } from "@xyflow/react";
import {
  IconAlertCircle,
  IconAward,
  IconBriefcase,
  IconBuilding,
  IconChecklist,
  IconCoin,
  IconFileText,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconFileUpload,
  IconLayoutGrid,
  IconList,
  IconLock,
  IconMicrophone2,
  IconNote,
  IconPlus,
  IconRefresh,
  IconRoute,
  IconSitemap,
  IconSparkles,
  IconStar,
  IconSword,
  IconTarget,
  IconTextPlus,
  IconTrash,
  IconUserCheck,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MouseEvent, ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_TITLE } from "@/lib/app-config";
import { CanvasTabBar } from "../components/canvas/CanvasTabBar.js";
import { TemplatePicker, type TemplateSlug } from "../components/canvas/TemplatePicker.js";
import { PreviewPanel } from "../components/canvas/PreviewPanel.js";
import { NodeContextMenu } from "../components/canvas/NodeContextMenu.js";

export function meta() {
  return [{ title: `${APP_TITLE} — Messaging` }];
}

// ── Types ──────────────────────────────────────────────────────────────────────

type NodeKind =
  | "persona" | "tone" | "phrase_rule" | "example" | "role" | "company"
  | "metrics" | "economic_buyer" | "decision_criteria" | "decision_process"
  | "paper_process" | "identify_pain" | "champion" | "competition"
  | "persona_ref" | "hubspot_reference";

interface MessagingNode {
  id: string;
  type: NodeKind;
  title: string;
  personaId: string | null;
  tone: string | null;
  valueProps: string | null;
  phrasesToUse: string | null;
  phrasesToAvoid: string | null;
  exampleNotes: string | null;
  notes: string | null;
  hubspotContactId: string | null;
  positionX: number;
  positionY: number;
  createdAt: string | null;
  updatedAt: string | null;
}

interface MessagingEdge {
  id: string;
  sourceId: string;
  targetId: string;
  createdAt: string | null;
}

interface Persona {
  id: string;
  name: string;
  color: string;
  icpText?: string | null;
}

interface GraphData {
  nodes: MessagingNode[];
  edges: MessagingEdge[];
  personas: Persona[];
  activeCanvasId: string;
  newPersonaNodeIds?: string[];
}

// ── Node type config ───────────────────────────────────────────────────────────

const NODE_CONFIG: Record<NodeKind, {
  label: string;
  color: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  description: string;
  previewFields: (keyof MessagingNode)[];
}> = {
  persona: {
    label: "ICP Persona",
    color: "#0a66c2",
    Icon: IconUsers,
    description: "Persona anchor — fine-tuning nodes branch from here",
    previewFields: ["notes", "tone"],
  },
  tone: {
    label: "Tone & Voice",
    color: "#7c3aed",
    Icon: IconMicrophone2,
    description: "Sets voice, style, and key value props",
    previewFields: ["tone", "valueProps"],
  },
  phrase_rule: {
    label: "Phrase Rule",
    color: "#16a34a",
    Icon: IconTextPlus,
    description: "Words to always use or never say",
    previewFields: ["phrasesToUse", "phrasesToAvoid"],
  },
  example: {
    label: "Example Note",
    color: "#d97706",
    Icon: IconNote,
    description: "Concrete example notes to guide the AI's output",
    previewFields: ["exampleNotes"],
  },
  role: {
    label: "Role Targeting",
    color: "#0891b2",
    Icon: IconBriefcase,
    description: "Adjustments when messaging a specific role/title",
    previewFields: ["notes", "tone", "phrasesToUse", "phrasesToAvoid"],
  },
  company: {
    label: "Company",
    color: "#0e7490",
    Icon: IconBuilding,
    description: "Company context — auto-researches from the internet",
    previewFields: ["notes"],
  },
  metrics: {
    label: "Metrics",
    color: "#16a34a",
    Icon: IconTarget,
    description: "Quantifiable business outcomes delivered",
    previewFields: ["notes"],
  },
  economic_buyer: {
    label: "Economic Buyer",
    color: "#b45309",
    Icon: IconCoin,
    description: "Person with budget authority",
    previewFields: ["notes"],
  },
  decision_criteria: {
    label: "Decision Criteria",
    color: "#4338ca",
    Icon: IconChecklist,
    description: "Technical and financial requirements",
    previewFields: ["notes"],
  },
  decision_process: {
    label: "Decision Process",
    color: "#0284c7",
    Icon: IconRoute,
    description: "Steps to reach a purchasing decision",
    previewFields: ["notes"],
  },
  paper_process: {
    label: "Paper Process",
    color: "#64748b",
    Icon: IconFileText,
    description: "Legal, procurement, and contract steps",
    previewFields: ["notes"],
  },
  identify_pain: {
    label: "Identify Pain",
    color: "#dc2626",
    Icon: IconAlertCircle,
    description: "The core problem requiring a solution",
    previewFields: ["notes"],
  },
  champion: {
    label: "Champion",
    color: "#d97706",
    Icon: IconStar,
    description: "An influential internal advocate",
    previewFields: ["notes"],
  },
  competition: {
    label: "Competition",
    color: "#7c2d12",
    Icon: IconSword,
    description: "Knowledge of rival solutions",
    previewFields: ["notes"],
  },
  persona_ref: {
    label: "Persona",
    color: "#0a66c2",
    Icon: IconUserCheck,
    description: "Pin a specific ICP persona to this branch",
    previewFields: ["notes"],
  },
  hubspot_reference: {
    label: "HubSpot Reference",
    color: "#ff7a59",
    Icon: IconAward,
    description: "A real contact + correspondence pulled from HubSpot as a proof example",
    previewFields: ["notes", "valueProps", "exampleNotes"],
  },
};

const FIELD_LABELS: Partial<Record<keyof MessagingNode, string>> = {
  tone: "Tone",
  valueProps: "Value props",
  phrasesToUse: "Use",
  phrasesToAvoid: "Avoid",
  exampleNotes: "Example",
  notes: "Notes",
};

// ── Custom node data shape ─────────────────────────────────────────────────────

interface NodeData extends Record<string, unknown> {
  dbNode: MessagingNode;
  persona: Persona | undefined;
  ancestorPersona: Persona | undefined; // for child nodes: the persona this tree traces back to
  isAdmin: boolean;
  onClick: (node: MessagingNode) => void;
  onContextMenu: (node: MessagingNode, event: MouseEvent) => void;
  onDelete: (id: string) => void;
  onAddConnected?: (sourceId: string, type: PaletteKind) => void;
}

// ── Interactive source handle with click-to-add ────────────────────────────────

function SourceAddHandle({ nodeId, onAddConnected }: {
  nodeId: string;
  onAddConnected?: (sourceId: string, type: PaletteKind) => void;
}) {
  const [palettePos, setPalettePos] = useState<{ x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState(false);
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);

  return (
    <>
      <Handle
        type="source"
        position={Position.Right}
        className={`!w-4 !h-4 !border-2 !transition-all !duration-150 !flex !items-center !justify-center !cursor-pointer ${
          hovered
            ? "!bg-primary/10 !border-primary !scale-110"
            : "!bg-white dark:!bg-zinc-800 !border-zinc-300 dark:!border-zinc-600"
        }`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onMouseDown={(e) => { mouseDownPos.current = { x: e.clientX, y: e.clientY }; }}
        onMouseUp={(e) => {
          if (!mouseDownPos.current) return;
          const pos = mouseDownPos.current;
          mouseDownPos.current = null;
          const dist = Math.hypot(e.clientX - pos.x, e.clientY - pos.y);
          if (dist < 6 && onAddConnected) {
            e.stopPropagation();
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setPalettePos({ x: rect.right + 8, y: rect.top + rect.height / 2 - 20 });
          }
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* "+" appears only on hover */}
        <IconPlus
          size={8}
          className={`pointer-events-none transition-opacity duration-150 ${hovered ? "opacity-100 text-primary" : "opacity-0"}`}
        />
      </Handle>

      {palettePos && onAddConnected && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setPalettePos(null); }} />
          <div className="fixed z-50" style={{ left: palettePos.x, top: palettePos.y }} onClick={(e) => e.stopPropagation()}>
            <NodePalette
              onSelect={(type) => {
                onAddConnected(nodeId, type);
                setPalettePos(null);
              }}
            />
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

// ── Unified canvas node component ──────────────────────────────────────────────

// Cuts at the last word boundary at or before the limit instead of slicing
// mid-word -- a plain character slice (the previous behavior here) can land
// inside a word, e.g. "reliability" -> "reliabil…".
function truncateAtWordBoundary(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut) + "…";
}

// Semantic zoom -- below this zoom level, node cards drop their field
// previews and show just the icon + title, so a zoomed-out view of a large
// canvas isn't a wall of crammed, barely-legible text. Read once via
// useViewport() in a small wrapper around <ReactFlow> (ZoomLevelProvider,
// below) rather than in MessagingCanvas itself, so the constant viewport
// updates during a pan/zoom don't force the whole toolbar/palette/panel
// tree to re-render too.
const COMPACT_ZOOM_THRESHOLD = 0.5;
const ZoomLevelContext = createContext(1);
function useIsCompactZoom(): boolean {
  return useContext(ZoomLevelContext) < COMPACT_ZOOM_THRESHOLD;
}
function ZoomLevelProvider({ children }: { children: ReactNode }) {
  const { zoom } = useViewport();
  return <ZoomLevelContext.Provider value={zoom}>{children}</ZoomLevelContext.Provider>;
}

function CanvasNode({ data }: NodeProps) {
  const compact = useIsCompactZoom();
  const d = data as NodeData;
  const cfg = NODE_CONFIG[d.dbNode.type as NodeKind] ?? NODE_CONFIG.tone;
  const isPersona = d.dbNode.type === "persona";
  const isGlobal = (d.dbNode.type as string) === "global";
  const headerColor = isPersona ? (d.persona?.color ?? cfg.color) : cfg.color;
  const accentColor = !isPersona && !isGlobal ? d.ancestorPersona?.color : undefined;

  const filled = cfg.previewFields
    .map((k) => ({ key: k, label: FIELD_LABELS[k] ?? String(k), val: d.dbNode[k] }))
    .filter((f) => f.val);

  return (
    <div
      className="relative rounded-xl border border-zinc-200/60 bg-white shadow-md dark:border-zinc-700/60 dark:bg-zinc-900 cursor-pointer w-[220px] group"
      style={accentColor ? { borderLeft: `3px solid ${accentColor}` } : undefined}
      onClick={() => d.onClick(d.dbNode)}
      onContextMenu={(e) => { e.preventDefault(); d.onContextMenu(d.dbNode, e); }}
    >
      {/* Hover delete — only for non-persona, non-global nodes */}
      {!isPersona && !isGlobal && (
        <button
          type="button"
          className="absolute top-1 right-1 z-10 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full bg-black/20 hover:bg-destructive text-white transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            d.onDelete(d.dbNode.id);
          }}
        >
          <IconX size={9} />
        </button>
      )}
      {/* Content clipped to rounded corners; handles live outside this wrapper */}
      <div className="overflow-hidden rounded-xl">
        {/* Header */}
        <div
          className="flex items-center gap-1.5 px-3 py-2 text-white"
          style={{ background: headerColor }}
        >
          <cfg.Icon size={12} className="shrink-0 opacity-90" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold truncate">
              {isPersona ? (d.persona?.name ?? d.dbNode.title) : d.dbNode.title}
            </p>
            {isPersona && <p className="text-[9px] opacity-75">ICP Persona</p>}
          </div>
          {(isGlobal || isPersona) && !d.isAdmin && <IconLock size={10} className="opacity-80" />}
        </div>

        {/* Field preview -- dropped entirely at low zoom (semantic zoom),
            since illegibly-small crammed text isn't worth rendering. */}
        {!compact && (
          <div className="px-3 py-2 text-[10px] space-y-0.5">
            {filled.length === 0 ? (
              <p className="italic text-zinc-400">
                {isPersona ? "No baseline messaging yet — click to add" : "Empty — click to edit"}
              </p>
            ) : (
              filled.map(({ key, label, val }) => {
                const text = String(val ?? "");
                return (
                  <div key={String(key)} className="flex gap-1 leading-snug">
                    <span className="shrink-0 font-semibold text-zinc-400">{label}:</span>
                    <span className="text-zinc-600 dark:text-zinc-300 break-words line-clamp-2">
                      {truncateAtWordBoundary(text, 57)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Persona ancestry badge */}
        {accentColor && d.ancestorPersona && (
          <div className="flex items-center gap-1.5 border-t border-zinc-100 dark:border-zinc-800 px-3 py-1">
            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: accentColor }} />
            <span className="text-[9px] text-zinc-400 truncate">{d.ancestorPersona.name}</span>
          </div>
        )}
      </div>

      {/* Persona nodes are source-only anchors — no incoming connections allowed */}
      {!isGlobal && !isPersona && <Handle type="target" position={Position.Left} />}
      <SourceAddHandle nodeId={d.dbNode.id} onAddConnected={d.onAddConnected} />
    </div>
  );
}

function CompanyNode({ data }: NodeProps) {
  const compact = useIsCompactZoom();
  const d = data as NodeData;
  const hasName = d.dbNode.title && d.dbNode.title !== "Company";
  const hasNotes = !!d.dbNode.notes;

  return (
    <div
      className="relative rounded-xl border-2 border-cyan-600 bg-white dark:bg-zinc-900 shadow-md w-[220px] cursor-pointer group"
      onClick={() => d.onClick(d.dbNode)}
      onContextMenu={(e) => { e.preventDefault(); d.onContextMenu(d.dbNode, e); }}
    >
      <button
        type="button"
        className="absolute top-1 right-1 z-10 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full bg-black/20 hover:bg-destructive text-white transition-colors"
        onClick={(e) => { e.stopPropagation(); d.onDelete(d.dbNode.id); }}
      >
        <IconX size={9} />
      </button>
      <Handle type="target" position={Position.Left} />
      <div className="overflow-hidden rounded-xl">
        <div className="flex items-center gap-1.5 px-3 py-2 text-white bg-cyan-700">
          <IconBuilding size={12} className="shrink-0 opacity-90" />
          <p className="text-[11px] font-semibold flex-1 truncate">
            {hasName ? d.dbNode.title : "Company"}
          </p>
        </div>
        {!compact && (
          <div className="px-3 py-2">
            {hasNotes ? (
              <p className="text-[10px] text-zinc-500 line-clamp-3">{d.dbNode.notes}</p>
            ) : (
              <p className="text-[10px] text-zinc-400 italic">
                {hasName ? "Click to add research →" : "Click to set company name →"}
              </p>
            )}
          </div>
        )}
      </div>
      <SourceAddHandle nodeId={d.dbNode.id} onAddConnected={d.onAddConnected} />
    </div>
  );
}

function PersonaRefNode({ data }: NodeProps) {
  const compact = useIsCompactZoom();
  const d = data as NodeData & {
    allPersonas: Persona[];
    onPersonaSelect: (nodeId: string, personaId: string) => void;
  };
  const selected = (d.allPersonas ?? []).find((p) => p.id === d.dbNode.personaId);
  const headerColor = selected?.color ?? "#0a66c2";

  return (
    <div
      className="relative rounded-xl border border-zinc-200/60 bg-white shadow-md dark:border-zinc-700/60 dark:bg-zinc-900 cursor-pointer w-[220px] group"
      onClick={() => d.onClick(d.dbNode)}
    >
      <button
        type="button"
        className="absolute top-1 right-1 z-10 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full bg-black/20 hover:bg-destructive text-white transition-colors"
        onClick={(e) => { e.stopPropagation(); d.onDelete(d.dbNode.id); }}
      >
        <IconX size={9} />
      </button>
      <div className="overflow-hidden rounded-xl">
        <div className="flex items-center gap-1.5 px-3 py-2 text-white" style={{ background: headerColor }}>
          <IconUserCheck size={12} className="shrink-0 opacity-90" />
          <p className="text-[11px] font-semibold truncate flex-1">
            {selected?.name ?? "Select Persona"}
          </p>
        </div>
        <div className="px-3 py-2 flex flex-col gap-1.5">
          <select
            value={d.dbNode.personaId ?? ""}
            onChange={(e) => { e.stopPropagation(); d.onPersonaSelect(d.dbNode.id, e.target.value); }}
            onClick={(e) => e.stopPropagation()}
            className="w-full text-xs bg-transparent border border-zinc-200 dark:border-zinc-700 rounded px-1 py-0.5 outline-none"
          >
            <option value="">Choose persona…</option>
            {(d.allPersonas ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {!compact && d.dbNode.notes && (
            <p className="text-[10px] text-zinc-500 line-clamp-2">{d.dbNode.notes}</p>
          )}
        </div>
      </div>
      <Handle type="target" position={Position.Left} />
      <SourceAddHandle nodeId={d.dbNode.id} onAddConnected={d.onAddConnected} />
    </div>
  );
}

// HubSpot contact record URLs carry the numeric contact ID in the path —
// either the legacy `/contact/{id}` form or the current `/record/0-1/{id}`
// form (0-1 is the built-in Contact object type). Matches either.
function extractHubspotContactId(input: string): string | null {
  const match = input.trim().match(/(?:contact|0-1)\/(\d+)/);
  return match ? match[1] : null;
}

function HubspotReferenceNode({ data }: NodeProps) {
  const compact = useIsCompactZoom();
  const d = data as NodeData;
  const hasContact = d.dbNode.title && d.dbNode.title !== "HubSpot Reference";

  return (
    <div
      className="relative rounded-xl border-2 w-[220px] cursor-pointer group bg-white dark:bg-zinc-900 shadow-md"
      style={{ borderColor: "#ff7a59" }}
      onClick={() => d.onClick(d.dbNode)}
      onContextMenu={(e) => { e.preventDefault(); d.onContextMenu(d.dbNode, e); }}
    >
      <button
        type="button"
        className="absolute top-1 right-1 z-10 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full bg-black/20 hover:bg-destructive text-white transition-colors"
        onClick={(e) => { e.stopPropagation(); d.onDelete(d.dbNode.id); }}
      >
        <IconX size={9} />
      </button>
      <Handle type="target" position={Position.Left} />
      <div className="overflow-hidden rounded-xl">
        <div className="flex items-center gap-1.5 px-3 py-2 text-white" style={{ background: "#ff7a59" }}>
          <IconAward size={12} className="shrink-0 opacity-90" />
          <p className="text-[11px] font-semibold flex-1 truncate">
            {hasContact ? d.dbNode.title : "HubSpot Reference"}
          </p>
        </div>
        {!compact && (
          <div className="px-3 py-2">
            {hasContact ? (
              <>
                <p className="text-[10px] text-zinc-500 truncate">
                  {[d.dbNode.notes, d.dbNode.valueProps].filter(Boolean).join(" at ") || "No role/company set"}
                </p>
                {d.dbNode.exampleNotes && (
                  <p className="text-[10px] text-zinc-500 line-clamp-2 mt-0.5">{d.dbNode.exampleNotes}</p>
                )}
              </>
            ) : (
              <p className="text-[10px] text-zinc-400 italic">Click to paste a HubSpot link →</p>
            )}
          </div>
        )}
      </div>
      <SourceAddHandle nodeId={d.dbNode.id} onAddConnected={d.onAddConnected} />
    </div>
  );
}

// Walks edges upward from each node to find its persona root.
function computeAncestorPersonas(
  nodes: MessagingNode[],
  edges: MessagingEdge[],
  personas: Persona[],
): Map<string, Persona> {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const parentOf = new Map(edges.map((e) => [e.targetId, e.sourceId]));
  const result = new Map<string, Persona>();
  for (const node of nodes) {
    if (node.type === "persona") continue;
    let cur = node.id;
    const seen = new Set<string>();
    while (true) {
      if (seen.has(cur)) break;
      seen.add(cur);
      const parentId = parentOf.get(cur);
      if (!parentId) break;
      const parent = nodeById.get(parentId);
      if (!parent) break;
      if (parent.type === "persona") {
        const p = personas.find((p) => p.id === parent.personaId);
        if (p) result.set(node.id, p);
        break;
      }
      cur = parentId;
    }
  }
  return result;
}

// ── Custom deletable edge ──────────────────────────────────────────────────────

function DeletableEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  style, markerEnd, selected,
}: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const [hovered, setHovered] = useState(false);
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });

  return (
    <>
      {/* Invisible wide path for hover detection */}
      <path
        d={edgePath}
        stroke="transparent"
        strokeWidth={20}
        fill="none"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <BaseEdge path={edgePath} style={style} markerEnd={markerEnd} />
      {(selected || hovered) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className="nodrag nopan"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteElements({ edges: [{ id }] });
              }}
              className="flex h-5 w-5 items-center justify-center rounded-full bg-white border border-zinc-300 text-zinc-400 shadow-sm hover:bg-red-50 hover:border-red-400 hover:text-red-500 transition-colors"
              title="Remove connection"
            >
              <IconX size={10} />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes = { deletable: DeletableEdge };

// ── Node type palette ──────────────────────────────────────────────────────────

type PaletteKind =
  | "tone" | "phrase_rule" | "example" | "role" | "company"
  | "metrics" | "economic_buyer" | "decision_criteria" | "decision_process"
  | "paper_process" | "identify_pain" | "champion" | "competition"
  | "persona_ref" | "hubspot_reference";
const PALETTE_TYPES: PaletteKind[] = [
  "tone", "phrase_rule", "example", "role", "company",
  "metrics", "economic_buyer", "decision_criteria", "decision_process",
  "paper_process", "identify_pain", "champion", "competition",
  "persona_ref", "hubspot_reference",
];

function NodePalette({ onSelect }: { onSelect: (type: PaletteKind) => void }) {
  return (
    <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900 max-h-[480px] overflow-y-auto">
      {PALETTE_TYPES.map((kind) => {
        const cfg = NODE_CONFIG[kind];
        return (
          <button
            key={kind}
            className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            onClick={() => onSelect(kind)}
          >
            <div
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded"
              style={{ background: cfg.color }}
            >
              <cfg.Icon size={12} className="text-white" />
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{cfg.label}</p>
              <p className="text-[10px] text-zinc-500 leading-snug">{cfg.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// Permanent left rail replacing the toolbar's old "Add Node" popover -- part
// of the three-panel layout (palette rail · canvas · properties). The
// per-node "+" source-handle popover (SourceAddHandle, below) still uses the
// plain NodePalette above as a floating contextual menu, unchanged -- that
// one has to appear at an arbitrary canvas position next to a specific
// handle, which is inherently ephemeral, not a global affordance to dock.
function NodePaletteRail({ onSelect }: { onSelect: (type: PaletteKind) => void }) {
  return (
    <div className="w-56 shrink-0 overflow-y-auto border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <p className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Add node</p>
      {PALETTE_TYPES.map((kind) => {
        const cfg = NODE_CONFIG[kind];
        return (
          <button
            key={kind}
            className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
            onClick={() => onSelect(kind)}
          >
            <div
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded"
              style={{ background: cfg.color }}
            >
              <cfg.Icon size={12} className="text-white" />
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{cfg.label}</p>
              <p className="text-[10px] text-zinc-500 leading-snug">{cfg.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Node editor sheet ──────────────────────────────────────────────────────────

interface EditorProps {
  node: MessagingNode | null;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (updated: Partial<MessagingNode>) => void;
  onDeleted: (id: string) => void;
}

// Docked right-hand properties panel -- permanently mounted (not a dismissible
// overlay) so editing a node and seeing the canvas stay visible at the same
// time, part of the three-panel layout (palette rail · canvas · properties).
// Renamed from NodeEditorSheet; internal editing logic is unchanged, only the
// outer wrapper (Sheet -> plain docked div) and the null-node empty state are
// new.
function NodePropertiesPanel({ node, isAdmin, onClose, onSaved, onDeleted }: EditorProps) {
  const updateNode = useActionMutation("update-messaging-node");
  const deleteNode = useActionMutation("delete-messaging-node");
  const researchCompany = useActionMutation("research-company");
  const fetchHubspotContact = useActionMutation("fetch-hubspot-contact");

  const isCompany = node?.type === "company";
  const isPersona = node?.type === "persona";
  const isGlobal = (node?.type as string) === "global";
  const isHubspotReference = node?.type === "hubspot_reference";
  const readOnly = (isGlobal || isPersona) && !isAdmin;
  const cfg = node ? (NODE_CONFIG[node.type as NodeKind] ?? NODE_CONFIG.tone) : NODE_CONFIG.tone;

  const [title, setTitle] = useState("");
  const [tone, setTone] = useState("");
  const [valueProps, setValueProps] = useState("");
  const [phrasesToUse, setPhrasesToUse] = useState("");
  const [phrasesToAvoid, setPhrasesToAvoid] = useState("");
  const [exampleNotes, setExampleNotes] = useState("");
  const [notes, setNotes] = useState("");
  const [hubspotContactId, setHubspotContactId] = useState<string | null>(null);
  const [hsLink, setHsLink] = useState("");

  useEffect(() => {
    if (!node) return;
    setTitle(node.title ?? "");
    setTone(node.tone ?? "");
    setValueProps(node.valueProps ?? "");
    setPhrasesToUse(node.phrasesToUse ?? "");
    setPhrasesToAvoid(node.phrasesToAvoid ?? "");
    setExampleNotes(node.exampleNotes ?? "");
    setNotes(node.notes ?? "");
    setHubspotContactId(node.hubspotContactId ?? null);
    setHsLink("");
  }, [node?.id]);

  // For hubspot_reference: a pasted link means "Save" should fetch from
  // HubSpot (contact + correspondence + AI summary) instead of just
  // persisting whatever's currently in the text fields.
  const pendingHubspotContactId = isHubspotReference ? extractHubspotContactId(hsLink) : null;

  async function handleSave() {
    if (!node) return;

    if (isHubspotReference && pendingHubspotContactId) {
      setHubspotContactId(pendingHubspotContactId);
      setHsLink("");
      try {
        const result = await fetchHubspotContact.mutateAsync({
          nodeId: node.id,
          contactId: pendingHubspotContactId,
        }) as {
          name: string; role: string | null; company: string | null; summary: string | null; warning?: string;
        };
        setTitle(result.name);
        setNotes(result.role ?? "");
        setValueProps(result.company ?? "");
        setExampleNotes(result.summary ?? "");
        onSaved({ title: result.name, notes: result.role, valueProps: result.company, exampleNotes: result.summary });
        if (result.warning) toast.warning(result.warning);
        else toast.success("Pulled from HubSpot");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not fetch that contact — try again.");
      }
      return;
    }

    if (isHubspotReference && hsLink.trim() && !pendingHubspotContactId) {
      toast.error("Couldn't find a contact ID in that link — paste the full HubSpot contact record URL.");
      return;
    }

    const patch: Partial<MessagingNode> = {
      title: title || undefined,
      tone: tone || null,
      valueProps: valueProps || null,
      phrasesToUse: phrasesToUse || null,
      phrasesToAvoid: phrasesToAvoid || null,
      exampleNotes: exampleNotes || null,
      notes: notes || null,
    };
    await updateNode.mutateAsync({ id: node.id, ...patch });
    onSaved(patch);
    toast.success("Saved");
  }

  async function handleDelete() {
    if (!node) return;
    const res = await deleteNode.mutateAsync({ id: node.id }) as any;
    if (res?.ok === false) { toast.error(res.error ?? "Cannot delete this node."); return; }
    onDeleted(node.id);
    onClose();
  }

  async function handleAddResearch() {
    if (!node || !title.trim()) return;
    await updateNode.mutateAsync({ id: node.id, title });
    onSaved({ title });
    try {
      const result = await researchCompany.mutateAsync({ nodeId: node.id, companyName: title.trim() }) as { notes: string };
      setNotes(result.notes ?? "");
      onSaved({ title, notes: result.notes });
      toast.success("Research complete");
    } catch {
      toast.error("Research failed — try again.");
    }
  }

  const NOTES_ONLY_TYPES = new Set([
    "metrics", "economic_buyer", "decision_criteria", "decision_process",
    "paper_process", "identify_pain", "champion", "competition", "persona_ref",
    "company",
  ]);
  const showNotes = isGlobal || isPersona || node?.type === "role" || NOTES_ONLY_TYPES.has(node?.type ?? "");
  const showTone = isGlobal || isPersona || node?.type === "tone" || node?.type === "role";
  const showValueProps = isGlobal || node?.type === "tone";
  const showUse = isGlobal || node?.type === "phrase_rule" || node?.type === "role";
  const showAvoid = isGlobal || node?.type === "phrase_rule" || node?.type === "role";
  const showExample = isGlobal || node?.type === "example";

  if (!node) {
    return (
      <div className="w-96 shrink-0 border-l border-zinc-200 dark:border-zinc-800 bg-background flex items-center justify-center">
        <p className="max-w-[220px] text-center text-sm text-zinc-400">Select a node to edit its details here.</p>
      </div>
    );
  }

  return (
    <div className="w-96 shrink-0 overflow-y-auto border-l border-zinc-200 bg-background dark:border-zinc-800">
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded" style={{ background: cfg.color }}>
            <cfg.Icon size={14} className="text-white" />
          </div>
          <h2 className="text-sm font-semibold">{isPersona ? (node?.title ?? cfg.label) : cfg.label}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
        >
          <IconX size={15} />
        </button>
      </div>

      <div className="flex flex-col gap-4 p-5">
          <EditorField label="Title" readOnly={readOnly}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} placeholder="Node title" />
          </EditorField>

          {isHubspotReference && (
            <EditorField label="HubSpot Contact Link" readOnly={false}>
              <Input
                value={hsLink}
                onChange={(e) => setHsLink(e.target.value)}
                disabled={fetchHubspotContact.isPending}
                placeholder="Paste a HubSpot contact link, then Save…"
              />
              {hubspotContactId && !hsLink && !fetchHubspotContact.isPending && (
                <p className="text-[10px] text-zinc-400 mt-1">
                  Linked to HubSpot contact {hubspotContactId} — paste another link and Save to switch.
                </p>
              )}
            </EditorField>
          )}

          {isHubspotReference && (
            <div className="grid grid-cols-2 gap-3">
              <EditorField label="Role" readOnly={readOnly}>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={readOnly || fetchHubspotContact.isPending}
                  placeholder="Senior Product Manager"
                />
              </EditorField>
              <EditorField label="Company" readOnly={readOnly}>
                <Input
                  value={valueProps}
                  onChange={(e) => setValueProps(e.target.value)}
                  disabled={readOnly || fetchHubspotContact.isPending}
                  placeholder="Rotten Tomatoes"
                />
              </EditorField>
            </div>
          )}

          {isHubspotReference && (
            <EditorField label="Why This Worked" readOnly={readOnly}>
              <textarea
                className="w-full resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                rows={5}
                value={exampleNotes}
                onChange={(e) => setExampleNotes(e.target.value)}
                disabled={readOnly || fetchHubspotContact.isPending}
                placeholder="Paste a HubSpot contact link above and Save — this fills in automatically from their email correspondence. You can edit it after."
              />
              {fetchHubspotContact.isPending && (
                <p className="text-[11px] text-orange-600 italic animate-pulse flex items-center gap-1 mt-1">
                  <IconRefresh size={11} className="animate-spin" /> Pulling from HubSpot…
                </p>
              )}
            </EditorField>
          )}

          {showNotes && (
            <EditorField
              label={
                isCompany ? "Research Notes"
                : node?.type === "role" ? "Role description"
                : "Notes"
              }
              readOnly={readOnly}
            >
              <textarea
                className="w-full resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                rows={isCompany ? 8 : 3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={readOnly || researchCompany.isPending}
                placeholder={
                  isCompany
                    ? "Research results will appear here after you click Add Research…"
                    : node?.type === "role"
                    ? "e.g. When messaging VPs of Engineering, lead with reliability and team impact..."
                    : "Any other instructions for the AI..."
                }
              />
              {researchCompany.isPending && (
                <p className="text-[11px] text-cyan-600 italic animate-pulse flex items-center gap-1">
                  <IconRefresh size={11} className="animate-spin" /> Researching {title}…
                </p>
              )}
            </EditorField>
          )}

          {showTone && (
            <EditorField label="Tone / Voice" readOnly={readOnly}>
              <textarea
                className="w-full resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                rows={3}
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                disabled={readOnly}
                placeholder="e.g. Warm and direct. No corporate jargon. Lead with curiosity."
              />
            </EditorField>
          )}

          {showValueProps && (
            <EditorField label="Key Value Props" readOnly={readOnly}>
              <textarea
                className="w-full resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                rows={3}
                value={valueProps}
                onChange={(e) => setValueProps(e.target.value)}
                disabled={readOnly}
                placeholder="Core differentiators to highlight in every note..."
              />
            </EditorField>
          )}

          {showUse && (
            <EditorField label="Phrases to Always Use" readOnly={readOnly}>
              <textarea
                className="w-full resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                rows={3}
                value={phrasesToUse}
                onChange={(e) => setPhrasesToUse(e.target.value)}
                disabled={readOnly}
                placeholder={"e.g. \"I noticed you...\", \"quick question\""}
              />
            </EditorField>
          )}

          {showAvoid && (
            <EditorField label="Phrases to Never Say" readOnly={readOnly}>
              <textarea
                className="w-full resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                rows={3}
                value={phrasesToAvoid}
                onChange={(e) => setPhrasesToAvoid(e.target.value)}
                disabled={readOnly}
                placeholder={"e.g. \"hope this finds you well\", \"I wanted to reach out\""}
              />
            </EditorField>
          )}

          {showExample && (
            <EditorField label="Example Notes" readOnly={readOnly}>
              <textarea
                className="w-full resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                rows={5}
                value={exampleNotes}
                onChange={(e) => setExampleNotes(e.target.value)}
                disabled={readOnly}
                placeholder={"Write 2-3 example notes in your voice:\n\"Hi Sarah, love what you're doing with design systems at IKEA...\"\n\"Hi John, saw you just launched — quick question about...\""}
              />
            </EditorField>
          )}

          {!readOnly && (
            <div className="flex items-center gap-2 pt-2">
              {isCompany ? (
                <>
                  <Button
                    onClick={handleAddResearch}
                    disabled={researchCompany.isPending || !title.trim()}
                    className="flex-1 gap-1.5"
                  >
                    {researchCompany.isPending
                      ? <><IconRefresh className="animate-spin" size={13} /> Researching…</>
                      : <><IconSparkles size={13} /> Add Research</>
                    }
                  </Button>
                  <Button variant="outline" onClick={handleSave} disabled={updateNode.isPending} size="sm">
                    Save
                  </Button>
                  <Button variant="destructive" onClick={handleDelete} disabled={deleteNode.isPending} size="sm">
                    <IconTrash size={14} />
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    onClick={handleSave}
                    disabled={updateNode.isPending || fetchHubspotContact.isPending}
                    className="flex-1 gap-1.5"
                  >
                    {(updateNode.isPending || fetchHubspotContact.isPending) && (
                      <IconRefresh className="animate-spin" size={13} />
                    )}
                    {pendingHubspotContactId ? "Save & Pull from HubSpot" : "Save"}
                  </Button>
                  {!isGlobal && !isPersona && (
                    <Button variant="destructive" onClick={handleDelete} disabled={deleteNode.isPending}>
                      <IconTrash size={14} />
                    </Button>
                  )}
                </>
              )}
            </div>
          )}

          {readOnly && <p className="text-xs text-zinc-500 italic">Global baseline is admin-managed.</p>}
          {isPersona && !readOnly && <p className="text-xs text-zinc-500 italic">Persona anchor. Add tone/voice here as a baseline, then branch off Phrase Rule, Example, and Role nodes for the details.</p>}
          {isPersona && readOnly && <p className="text-xs text-zinc-500 italic">Persona nodes are admin-managed.</p>}
        </div>
    </div>
  );
}

function EditorField({ label, readOnly, children }: { label: string; readOnly: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {label}{readOnly && " (read-only)"}
      </Label>
      {children}
    </div>
  );
}

// ── Build with AI dialog ───────────────────────────────────────────────────────

function BuildWithAIDialog({ graph, onClose, onSubmitted, onSend }: {
  graph: GraphData; onClose: () => void; onSubmitted: () => void;
  onSend: (label: string, message: string) => void;
}) {
  const [prompt, setPrompt] = useState("");

  function handleBuild() {
    // Positioning is no longer the agent's job -- it can create nodes with
    // no positionX/positionY at all (create-messaging-node defaults them),
    // and the real dagre auto-layout pass (handleAutoArrange, run
    // automatically once this background task finishes) arranges the whole
    // graph for real afterward, regardless of how many children got made.
    const personaList = graph.personas
      .map((p) => {
        const anchor = graph.nodes.find((n) => n.type === "persona" && n.personaId === p.id);
        return `- ${p.name} (anchor id=${anchor?.id ?? "missing"})`;
      })
      .join("\n");

    onSend(
      "Building your canvas…",
      `Build my messaging canvas.\n\n` +
        `## Target canvas\nUse canvasId="${graph.activeCanvasId}" for every call below. ` +
        `This is the canvas the user currently has open — do not call list-canvases or pick a different one.\n\n` +
        `## Request\n${prompt.trim()}\n\n` +
        `## Personas\n${personaList}\n\n` +
        `## Instructions — execute in order\n` +
        `1. Call get-messaging-graph to read ICP documents for each persona.\n` +
        `2. For each persona anchor, call update-messaging-node with the anchor id, filling tone and notes from the ICP doc. Do not pass positionX/positionY -- the canvas auto-arranges everything once you're done.\n` +
        `3. For each persona, create 2–4 child nodes. Node types: tone (tone + valueProps fields), phrase_rule (phrasesToUse + phrasesToAvoid), example (exampleNotes), role (notes + tone + phrases for a specific title).\n` +
        `   For each child, call create-messaging-node with nodeType, a descriptive title, AND all content fields filled from the ICP doc in the same call. Do NOT pass positionX/positionY. Do NOT leave content empty and update later.\n` +
        `4. For each created child, call create-messaging-edge with sourceId=<persona anchor id>, targetId=<new child id>.\n\n` +
        `Key rules: fill content at creation time (step 3) — do not do a separate update round. Content comes from the ICP doc only.`,
    );
    onSubmitted();
    onClose();
  }

  const personasWithDocs = graph.personas.filter((p) => p.icpText).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <IconSparkles size={15} className="text-primary" />
            <h2 className="text-sm font-semibold">Build with AI</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
            <IconX size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-5">
          <p className="text-xs text-muted-foreground">
            Describe how you want to message your personas. The AI will read your ICP documents and build out the nodes and connections for you.
          </p>
          <textarea
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim()) handleBuild(); }}
            rows={5}
            placeholder={
              `e.g. Build out messaging for all my personas. For design leaders focus on empathy and craft. ` +
              `For engineering lead with ROI and reliability. Keep the tone peer-to-peer, not salesy.`
            }
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="text-[11px] text-muted-foreground/60">
            {graph.personas.length} persona{graph.personas.length !== 1 ? "s" : ""}
            {personasWithDocs > 0 ? ` · ${personasWithDocs} with ICP docs` : " — upload ICP docs on the ICP tab for best results"}
            {" · "}⌘↵ to submit
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleBuild}
            disabled={!prompt.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            <IconSparkles size={12} />
            Build
          </button>
        </div>
      </div>
    </div>
  );
}

// Real auto-layout via dagre -- replaces the old "Build with AI" approach of
// baking fixed band-math positions (a hardcoded 2-column grid capped at 4
// children per persona) into the LLM prompt. Runs over the WHOLE graph, so
// it works regardless of how many children a persona actually ended up
// with, and can also be triggered on demand via the toolbar's "Auto-arrange"
// button. Left-to-right, personas in one column, children flowing right --
// mirrors the previous layout's general shape without its hard cap.
const AUTO_LAYOUT_NODE_WIDTH = 220;
const AUTO_LAYOUT_NODE_HEIGHT = 140;

function computeAutoLayout(nodes: MessagingNode[], edges: MessagingEdge[]): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 120 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) {
    g.setNode(n.id, { width: AUTO_LAYOUT_NODE_WIDTH, height: AUTO_LAYOUT_NODE_HEIGHT });
  }
  for (const e of edges) {
    if (g.hasNode(e.sourceId) && g.hasNode(e.targetId)) g.setEdge(e.sourceId, e.targetId);
  }
  dagre.layout(g);
  const positions = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const pos = g.node(n.id);
    if (pos) positions.set(n.id, { x: Math.round(pos.x), y: Math.round(pos.y) });
  }
  return positions;
}

// Field payload for re-creating a deleted node on undo -- shared by
// handleBeforeDelete (batch/keyboard delete) and handleNodeDeleted
// (hover/context-menu/panel single-node delete) so both stay in sync.
// canvasId isn't part of the frontend MessagingNode type (get-messaging-
// graph doesn't return it), so it's passed in separately -- both call
// sites already have activeCanvasId in scope. nodeType is cast because
// create-messaging-node's schema excludes "persona"/"global" -- callers
// already guarantee n is never one of those (handleBeforeDelete filters
// them out, and delete-messaging-node rejects/admin-gates them, so neither
// can ever actually reach a delete-then-undo path).
function recreateNodePayload(n: MessagingNode, canvasId: string) {
  return {
    canvasId, nodeType: n.type as Exclude<NodeKind, "persona" | "global">, title: n.title,
    positionX: n.positionX, positionY: n.positionY, personaId: n.personaId,
    tone: n.tone, valueProps: n.valueProps, phrasesToUse: n.phrasesToUse,
    phrasesToAvoid: n.phrasesToAvoid, exampleNotes: n.exampleNotes, notes: n.notes,
  };
}

// ── Undo/redo ──────────────────────────────────────────────────────────────────
// Scoped to structural operations only (create/delete node, create/delete
// edge, reposition) -- every mutation here is a direct, immediately-
// committed server write with no client-side snapshot of its own, so "undo"
// means invoking the inverse action, not restoring in-memory state. In-panel
// text-field edits (Notes/Tone/Use/Avoid content) are deliberately excluded:
// those are authored edits with their own explicit Save step, not the kind
// of instant/irreversible action (a stray Delete key, a mis-drag) this is
// meant to protect against.

interface HistoryEntry {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const HISTORY_LIMIT = 50;

function useCanvasHistory() {
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  // Undo/redo button disabled-state needs a re-render on stack changes;
  // the stacks themselves stay in refs so pushing doesn't churn renders.
  const [depths, setDepths] = useState({ undo: 0, redo: 0 });
  const sync = () => setDepths({ undo: undoStack.current.length, redo: redoStack.current.length });

  const push = useCallback((entry: HistoryEntry) => {
    undoStack.current.push(entry);
    if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift();
    redoStack.current = [];
    sync();
  }, []);

  const undo = useCallback(async () => {
    const entry = undoStack.current.pop();
    if (!entry) return;
    try {
      await entry.undo();
      redoStack.current.push(entry);
    } catch {
      toast.error(`Couldn't undo "${entry.label}" — try again.`);
      undoStack.current.push(entry);
    }
    sync();
  }, []);

  const redo = useCallback(async () => {
    const entry = redoStack.current.pop();
    if (!entry) return;
    try {
      await entry.redo();
      undoStack.current.push(entry);
    } catch {
      toast.error(`Couldn't redo "${entry.label}" — try again.`);
      redoStack.current.push(entry);
    }
    sync();
  }, []);

  return { push, undo, redo, canUndo: depths.undo > 0, canRedo: depths.redo > 0 };
}

// ── Outline view ───────────────────────────────────────────────────────────────
// Alternative to the canvas -- personas as section headers, their connected
// nodes as a nested list, using the exact same graph data the canvas
// already has (no separate fetch). Selecting a row opens the same docked
// NodePropertiesPanel the canvas uses, so editing is identical either way.

interface OutlineRow {
  node: MessagingNode;
  depth: number;
}

function buildOutlineRows(graph: GraphData): { personaSections: { persona: Persona; rows: OutlineRow[] }[]; otherRows: OutlineRow[] } {
  const childrenBySource = new Map<string, string[]>();
  for (const e of graph.edges) {
    const list = childrenBySource.get(e.sourceId) ?? [];
    list.push(e.targetId);
    childrenBySource.set(e.sourceId, list);
  }
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();

  function collect(nodeId: string, depth: number, out: OutlineRow[]) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodeById.get(nodeId);
    if (!node) return;
    out.push({ node, depth });
    for (const childId of childrenBySource.get(nodeId) ?? []) collect(childId, depth + 1, out);
  }

  const personaSections = graph.personas.map((persona) => {
    const anchor = graph.nodes.find((n) => n.type === "persona" && n.personaId === persona.id);
    const rows: OutlineRow[] = [];
    if (anchor) collect(anchor.id, 0, rows);
    return { persona, rows };
  });

  const otherRows: OutlineRow[] = [];
  for (const n of graph.nodes) {
    if (!visited.has(n.id)) collect(n.id, 0, otherRows);
  }

  return { personaSections, otherRows };
}

function OutlineRowButton({ row, onSelect }: { row: OutlineRow; onSelect: (n: MessagingNode) => void }) {
  const cfg = NODE_CONFIG[row.node.type as NodeKind] ?? NODE_CONFIG.tone;
  const isGlobal = (row.node.type as string) === "global";
  return (
    <button
      type="button"
      onClick={() => onSelect(row.node)}
      style={{ paddingLeft: `${12 + row.depth * 20}px` }}
      className="flex w-full items-center gap-2 py-1.5 pr-3 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
    >
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded" style={{ background: isGlobal ? "#71717a" : cfg.color }}>
        <cfg.Icon size={11} className="text-white" />
      </div>
      <span className="truncate text-zinc-800 dark:text-zinc-100">{row.node.title}</span>
      <span className="ml-auto shrink-0 text-[10px] text-zinc-400">{isGlobal ? "Global" : cfg.label}</span>
    </button>
  );
}

function MessagingOutlineView({ graph, onSelect }: { graph: GraphData; onSelect: (n: MessagingNode) => void }) {
  const { personaSections, otherRows } = useMemo(() => buildOutlineRows(graph), [graph]);
  return (
    <div className="h-full overflow-y-auto bg-white dark:bg-zinc-950">
      {personaSections.map(({ persona, rows }) => (
        <div key={persona.id} className="border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: persona.color }} />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{persona.name}</h3>
          </div>
          {rows.length === 0 ? (
            <p className="px-3 pb-2 pl-[35px] text-xs italic text-zinc-400">No messaging nodes yet.</p>
          ) : (
            rows.map((row) => <OutlineRowButton key={row.node.id} row={row} onSelect={onSelect} />)
          )}
        </div>
      ))}
      {otherRows.length > 0 && (
        <div>
          <div className="px-3 py-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Other nodes</h3>
          </div>
          {otherRows.map((row) => <OutlineRowButton key={row.node.id} row={row} onSelect={onSelect} />)}
        </div>
      )}
    </div>
  );
}

// ── Canvas ─────────────────────────────────────────────────────────────────────

function toFlowNode(
  dbNode: MessagingNode,
  personas: Persona[],
  ancestorPersonaMap: Map<string, Persona>,
  isAdmin: boolean,
  onClick: (n: MessagingNode) => void,
  onContextMenu: (n: MessagingNode, e: MouseEvent) => void,
  onDelete: (id: string) => void,
  onPersonaSelect?: (nodeId: string, personaId: string) => void,
  onAddConnected?: (sourceId: string, type: PaletteKind) => void,
): Node {
  return {
    id: dbNode.id,
    type: dbNode.type as string,
    position: { x: dbNode.positionX, y: dbNode.positionY },
    data: {
      dbNode,
      persona: personas.find((p) => p.id === dbNode.personaId),
      ancestorPersona: ancestorPersonaMap.get(dbNode.id),
      isAdmin,
      onClick,
      onContextMenu,
      onDelete,
      onAddConnected,
      ...(dbNode.type === "persona_ref" ? { allPersonas: personas, onPersonaSelect } : {}),
    } as NodeData,
  };
}

function toFlowEdge(
  e: MessagingEdge,
  nodeById: Map<string, MessagingNode>,
  ancestorPersonaMap: Map<string, Persona>,
  personas: Persona[],
): Edge {
  const sourceNode = nodeById.get(e.sourceId);
  let edgeColor = "#94a3b8";
  if (sourceNode?.type === "persona") {
    edgeColor = personas.find((p) => p.id === sourceNode.personaId)?.color ?? edgeColor;
  } else if (sourceNode) {
    edgeColor = ancestorPersonaMap.get(e.sourceId)?.color ?? edgeColor;
  }
  return {
    id: e.id,
    source: e.sourceId,
    target: e.targetId,
    type: "deletable",
    animated: false,
    style: { stroke: edgeColor, strokeWidth: 1.5 },
    markerEnd: { type: "arrowclosed" as any, color: edgeColor },
  };
}

export default function MessagingPage() {
  return (
    <ReactFlowProvider>
      <MessagingCanvas />
    </ReactFlowProvider>
  );
}

function MessagingCanvas() {
  const { data: roleData } = useActionQuery("get-my-role", {});
  const isAdmin = (roleData as { role?: string } | undefined)?.role === "admin";

  const { data: canvasData, refetch: refetchCanvases } = useActionQuery<{
    canvases: Array<{ id: string; name: string; isSystem: number; templateSlug: string | null }>;
  }>("list-canvases", {});

  const createCanvas = useActionMutation("create-canvas");
  const renameCanvas = useActionMutation("rename-canvas");
  const deleteCanvas = useActionMutation("delete-canvas");

  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data: graph, isLoading, refetch } = useActionQuery<GraphData>(
    "get-messaging-graph",
    activeCanvasId ? { canvasId: activeCanvasId } : {},
    { enabled: !!activeCanvasId },
  );
  const createNode = useActionMutation("create-messaging-node");
  const createEdge = useActionMutation("create-messaging-edge");
  const deleteEdge = useActionMutation("delete-messaging-edge");
  const deleteNode = useActionMutation("delete-messaging-node");
  const updateNode = useActionMutation("update-messaging-node");
  const generatePreview = useActionMutation("generate-canvas-preview");
  const history = useCanvasHistory();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [editingNode, setEditingNode] = useState<MessagingNode | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [viewMode, setViewMode] = useState<"canvas" | "outline">("canvas");
  const [buildOpen, setBuildOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const previewPendingRef = useRef(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; node: MessagingNode;
  } | null>(null);

  const userCanvases = (canvasData?.canvases ?? []).filter((c) => c.isSystem === 0);
  const systemCanvases = (canvasData?.canvases ?? []).filter((c) => c.isSystem === 1);
  const allTabCanvases = userCanvases;

  // Show template picker when user has no canvases
  useEffect(() => {
    if (canvasData && userCanvases.length === 0) {
      setPickerOpen(true);
    }
  }, [canvasData]);

  // Set active canvas when canvases load
  useEffect(() => {
    if (!activeCanvasId && userCanvases.length > 0) {
      setActiveCanvasId(userCanvases[0].id);
    }
  }, [canvasData]);

  const personasRef = useRef<Persona[]>([]);
  const hasAutoInitializedRef = useRef(false);
  const dragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last-persisted position per node, for undo/redo on drag -- `graph.nodes`
  // itself only refreshes on an explicit refetch, so it can't be trusted as
  // "the position before this drag" after more than one drag in a row.
  const lastKnownPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const pendingBuildRef = useRef(false);
  const addConnectedRef = useRef<((sourceId: string, type: PaletteKind) => void) | null>(null);
  const stableAddConnected = useCallback(
    (sourceId: string, type: PaletteKind) => addConnectedRef.current?.(sourceId, type),
    [],
  );

  // Clear any pending drag-save timer when the canvas unmounts
  useEffect(() => () => { if (dragTimerRef.current) clearTimeout(dragTimerRef.current); }, []);

  // Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z redo -- skipped while focus is inside
  // a text input/textarea (e.g. the properties panel) so the browser's own
  // native text-undo isn't hijacked; canvas undo/redo is scoped to
  // structural operations, not in-panel field edits, anyway (see the
  // useCanvasHistory comment above).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) history.redo();
      else history.undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [history.undo, history.redo]);

  // Auto-refetch canvas after agent finishes a Build with AI run. Using this
  // hook's own `send` (not the raw sendToAgentChat import) scopes isGenerating
  // to runs WE started here, so the progress banner below never fires for
  // unrelated sidebar chat activity.
  const [isGenerating, sendAgentTask] = useAgentChatGenerating();
  const [backgroundTaskLabel, setBackgroundTaskLabel] = useState<string | null>(null);
  const wasGeneratingRef = useRef(false);
  useEffect(() => {
    if (wasGeneratingRef.current && !isGenerating) {
      setBackgroundTaskLabel(null);
      if (previewPendingRef.current) {
        previewPendingRef.current = false;
        setPreviewing(false);
        // The result is in the agent chat panel — no need to extract it
      }
      if (pendingBuildRef.current) {
        pendingBuildRef.current = false;
        // The agent creates nodes with no meaningful position (create-
        // messaging-node's default), so auto-arrange the freshly-created
        // graph once it's back instead of leaving everything stacked.
        refetch().then((result) => {
          if (result.data) handleAutoArrange(result.data.nodes, result.data.edges);
        });
      }
    }
    wasGeneratingRef.current = isGenerating;
  }, [isGenerating, refetch]);

  // Every "Import doc" / "Build with AI" run gets its own fresh chat tab,
  // runs silently in the background, and shows a progress banner instead of
  // popping the sidebar open. A new tab means the agent never sees a prior
  // turn in this conversation, so it can't mistake a fresh import for a
  // duplicate of something "already built" earlier.
  const runInBackground = useCallback(
    (label: string, opts: Parameters<typeof sendAgentTask>[0]) => {
      setBackgroundTaskLabel(label);
      sendAgentTask({ ...opts, newTab: true, background: true, openSidebar: false });
    },
    [sendAgentTask],
  );
  const { screenToFlowPosition } = useReactFlow();

  // Runs dagre over the given nodes/edges (defaulting to whatever's
  // currently loaded) and persists any changed positions. Used both by the
  // toolbar's on-demand "Auto-arrange" button and automatically right after
  // a Build with AI run finishes (see the isGenerating effect above) --
  // agent-created nodes land at create-messaging-node's default position
  // (300, 300) with no math baked into the prompt, and this pass is what
  // actually spreads them out for real, regardless of how many were made.
  const [isAutoArranging, setIsAutoArranging] = useState(false);
  const handleAutoArrange = useCallback(async (arrangeNodes?: MessagingNode[], arrangeEdges?: MessagingEdge[]) => {
    const targetNodes = arrangeNodes ?? graph?.nodes ?? [];
    const targetEdges = arrangeEdges ?? graph?.edges ?? [];
    if (targetNodes.length === 0) return;
    setIsAutoArranging(true);
    try {
      const positions = computeAutoLayout(targetNodes, targetEdges);
      await Promise.all(
        targetNodes.map((n) => {
          const pos = positions.get(n.id);
          if (!pos || (pos.x === n.positionX && pos.y === n.positionY)) return Promise.resolve();
          return updateNode.mutateAsync({ id: n.id, positionX: pos.x, positionY: pos.y });
        }),
      );
      await refetch();
    } finally {
      setIsAutoArranging(false);
    }
  }, [graph, updateNode, refetch]);

  const openEditor = useCallback((n: MessagingNode) => setEditingNode(n), []);

  const handleHoverDelete = useCallback((id: string) => {
    deleteNode.mutate({ id });
    handleNodeDeleted(id);
  }, [deleteNode]);

  const handleNodeContextMenu = useCallback((node: MessagingNode, e: MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  function handleAIAction(action: "variations" | "generate" | "rewrite", nodeId: string) {
    const node = graph?.nodes.find((n) => n.id === nodeId);
    if (!node || !activeCanvasId) return;

    const nodeContent = [node.tone, node.valueProps, node.phrasesToUse, node.phrasesToAvoid, node.exampleNotes, node.notes]
      .filter(Boolean).join("\n");

    const prompts: Record<typeof action, string> = {
      variations:
        `Create 2 alternative versions of this messaging node and add them to the canvas.\n\n` +
        `Original node id: ${node.id}\nType: ${node.type}\nTitle: ${node.title}\nContent:\n${nodeContent || "(empty)"}\n\n` +
        `For each variation, call create-messaging-node with canvasId="${activeCanvasId}", the same nodeType="${node.type}", ` +
        `a slightly different title (e.g. "${node.title} — Variant A"), and different content. ` +
        `Place them at positionX=${node.positionX + 260}, positionY=${node.positionY} and positionY=${node.positionY + 240}.`,
      generate:
        `Fill this empty messaging node with content based on the rest of the canvas.\n\n` +
        `Node id: ${node.id}\nType: ${node.type}\nTitle: ${node.title}\n\n` +
        `Call update-messaging-node with id="${node.id}" and fill in appropriate content fields for this node type.`,
      rewrite:
        `Rewrite this messaging node's content from a different angle while keeping the same node type and structure.\n\n` +
        `Node id: ${node.id}\nType: ${node.type}\nTitle: ${node.title}\nCurrent content:\n${nodeContent || "(empty)"}\n\n` +
        `Call update-messaging-node with id="${node.id}" and replace the content fields with a rewritten version.`,
    };

    pendingBuildRef.current = true;
    sendToAgentChat({ message: prompts[action], submit: true });
  }

  const nodeTypes = useMemo(() => ({
    persona: CanvasNode,
    tone: CanvasNode,
    phrase_rule: CanvasNode,
    example: CanvasNode,
    role: CanvasNode,
    company: CompanyNode,
    metrics: CanvasNode,
    economic_buyer: CanvasNode,
    decision_criteria: CanvasNode,
    decision_process: CanvasNode,
    paper_process: CanvasNode,
    identify_pain: CanvasNode,
    champion: CanvasNode,
    competition: CanvasNode,
    persona_ref: PersonaRefNode,
    hubspot_reference: HubspotReferenceNode,
  }), []);

  function handlePersonaSelect(nodeId: string, personaId: string) {
    updateNode.mutate({ id: nodeId, personaId: personaId || null });
    setNodes((nds) => nds.map((n) => {
      if (n.id !== nodeId) return n;
      const dbNode = { ...(n.data as NodeData).dbNode, personaId: personaId || null };
      const selected = personasRef.current.find((p) => p.id === personaId);
      return { ...n, data: { ...n.data, dbNode, persona: selected, allPersonas: personasRef.current } as unknown as NodeData };
    }));
  }

  function handleGeneratePreview() {
    if (!activeCanvasId) return;
    setPreviewing(true);
    generatePreview.mutateAsync({ canvasId: activeCanvasId })
      .then((result) => {
        setPreviewText((result as { preview?: string | null }).preview ?? null);
      })
      .catch(() => {
        toast.error("Preview generation failed.");
      })
      .finally(() => {
        setPreviewing(false);
      });
  }

  const ancestorPersonaMap = useMemo(
    () => graph ? computeAncestorPersonas(graph.nodes, graph.edges, graph.personas) : new Map<string, Persona>(),
    [graph],
  );

  const handleAddConnected = useCallback(
    async (sourceNodeId: string, type: PaletteKind) => {
      if (!activeCanvasId || !graph) return;
      const sourceNode = graph.nodes.find((n) => n.id === sourceNodeId);
      if (!sourceNode) return;

      const newNode = await createNode.mutateAsync({
        canvasId: activeCanvasId,
        nodeType: type,
        positionX: sourceNode.positionX + 280,
        positionY: sourceNode.positionY,
      }) as MessagingNode;

      setNodes((nds) => [
        ...nds,
        toFlowNode(newNode, personasRef.current, new Map(), isAdmin, openEditor, handleNodeContextMenu, handleHoverDelete, undefined, stableAddConnected),
      ]);

      const edgeRes = await createEdge.mutateAsync({
        canvasId: activeCanvasId,
        sourceId: sourceNodeId,
        targetId: newNode.id,
      }) as any;

      if (edgeRes?.ok !== false) {
        const nodeById = new Map([...graph.nodes, newNode].map((n) => [n.id, n]));
        setEdges((eds) => [
          ...eds,
          toFlowEdge(
            { id: edgeRes.id, sourceId: sourceNodeId, targetId: newNode.id, createdAt: null },
            nodeById, ancestorPersonaMap, personasRef.current,
          ),
        ]);

        // One combined entry -- undoing "add connected node" should remove
        // both the node and the edge it was created with in a single step.
        let currentNodeId = newNode.id;
        let currentEdgeId = edgeRes.id;
        history.push({
          label: "Add connected node",
          undo: async () => {
            await deleteEdge.mutateAsync({ id: currentEdgeId });
            await deleteNode.mutateAsync({ id: currentNodeId });
            await refetch();
          },
          redo: async () => {
            const recreatedNode = await createNode.mutateAsync({
              canvasId: activeCanvasId, nodeType: type,
              positionX: sourceNode.positionX + 280, positionY: sourceNode.positionY,
            }) as MessagingNode;
            currentNodeId = recreatedNode.id;
            const recreatedEdge = await createEdge.mutateAsync({
              canvasId: activeCanvasId, sourceId: sourceNodeId, targetId: currentNodeId,
            }) as any;
            currentEdgeId = recreatedEdge.id;
            await refetch();
          },
        });
      }
    },
    [activeCanvasId, graph, createNode, createEdge, deleteNode, deleteEdge, refetch, history.push, isAdmin, openEditor, handleNodeContextMenu, handleHoverDelete, stableAddConnected, ancestorPersonaMap],
  );

  // Keep ref current so stableAddConnected always calls the latest closure
  addConnectedRef.current = handleAddConnected;

  useEffect(() => {
    if (!graph) return;
    personasRef.current = graph.personas;
    setPersonas(graph.personas);
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    setNodes(graph.nodes.map((n) => toFlowNode(n, graph.personas, ancestorPersonaMap, isAdmin, openEditor, handleNodeContextMenu, handleHoverDelete, handlePersonaSelect, stableAddConnected)));
    setEdges(graph.edges.map((e) => toFlowEdge(e, nodeById, ancestorPersonaMap, graph.personas)));
    for (const n of graph.nodes) lastKnownPositionsRef.current.set(n.id, { x: n.positionX, y: n.positionY });

    // Auto-fill persona nodes — only admins may write to shared persona nodes
    if (!isAdmin) return;
    if (hasAutoInitializedRef.current) return;

    const toInit = graph.nodes
      .filter((n) => n.type === "persona" && !n.tone && !n.notes)
      .map((node) => {
        const persona = graph.personas.find((p) => p.id === node.personaId);
        return persona?.icpText ? { node, persona } : null;
      })
      .filter(Boolean) as { node: MessagingNode; persona: Persona & { icpText: string } }[];

    if (toInit.length === 0) return;

    hasAutoInitializedRef.current = true;

    const blocks = toInit.map(({ node, persona }) =>
      `### ${persona.name} (canvas node id: ${node.id})\n${persona.icpText}`,
    ).join("\n\n---\n\n");

    sendToAgentChat({
      message:
        `Auto-fill the persona canvas nodes from their ICP documents.\n\n` +
        `## Instructions\n` +
        `For each persona below, call update-messaging-node once with:\n` +
        `- id: the canvas node id shown in the header\n` +
        `- tone: a concise 1–2 sentence summary of the outreach tone/voice for this persona\n` +
        `- notes: a brief description of who this persona is and how to approach them in outreach\n\n` +
        `Only populate fields with information actually present in the doc. Do NOT create any child nodes.\n\n` +
        `## ICP Documents\n\n${blocks}`,
      submit: true,
    });
  }, [graph, isAdmin]);

  async function handleAddNode(nodeType: PaletteKind) {
    if (!activeCanvasId || !graph) return;
    const pos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const positionX = Math.round(pos.x);
    const positionY = Math.round(pos.y);
    const result = await createNode.mutateAsync({
      canvasId: graph!.activeCanvasId,
      nodeType,
      positionX,
      positionY,
    }) as MessagingNode;
    setNodes((nds) => [...nds, toFlowNode(result, personasRef.current, new Map(), isAdmin, openEditor, handleNodeContextMenu, handleHoverDelete, undefined, stableAddConnected)]);
    setEditingNode(result);

    // currentId is reassigned on redo, since re-creating gets a new id --
    // this closure has to track "whichever id currently represents this
    // node" rather than the one captured at push time.
    let currentId = result.id;
    history.push({
      label: "Create node",
      undo: async () => { await deleteNode.mutateAsync({ id: currentId }); await refetch(); },
      redo: async () => {
        const recreated = await createNode.mutateAsync({ canvasId: activeCanvasId, nodeType, positionX, positionY }) as MessagingNode;
        currentId = recreated.id;
        await refetch();
      },
    });
  }

  function handleNodeDragStop(_: unknown, node: Node) {
    const oldPos = lastKnownPositionsRef.current.get(node.id);
    const newPos = { x: Math.round(node.position.x), y: Math.round(node.position.y) };
    if (dragTimerRef.current) clearTimeout(dragTimerRef.current);
    dragTimerRef.current = setTimeout(() => {
      updateNode.mutate({ id: node.id, positionX: newPos.x, positionY: newPos.y });
      lastKnownPositionsRef.current.set(node.id, newPos);
      if (oldPos && (oldPos.x !== newPos.x || oldPos.y !== newPos.y)) {
        history.push({
          label: "Move node",
          undo: async () => {
            await updateNode.mutateAsync({ id: node.id, positionX: oldPos.x, positionY: oldPos.y });
            lastKnownPositionsRef.current.set(node.id, oldPos);
            await refetch();
          },
          redo: async () => {
            await updateNode.mutateAsync({ id: node.id, positionX: newPos.x, positionY: newPos.y });
            lastKnownPositionsRef.current.set(node.id, newPos);
            await refetch();
          },
        });
      }
    }, 300);
  }

  const handleConnect = useCallback(
    async (conn: Connection) => {
      const optimistic = addEdge({ ...conn, type: "deletable", animated: false, style: { stroke: "#94a3b8", strokeWidth: 1.5 }, markerEnd: { type: "arrowclosed" as any, color: "#94a3b8" } }, edges);
      setEdges(optimistic);
      const res = await createEdge.mutateAsync({ canvasId: graph!.activeCanvasId, sourceId: conn.source!, targetId: conn.target! }) as any;
      if (res?.ok === false) {
        toast.error(res.error ?? "Could not connect nodes.");
        setEdges(edges);
      } else {
        setEdges((eds) => eds.map((e) =>
          e.source === conn.source && e.target === conn.target && e.id !== res.id ? { ...e, id: res.id } : e,
        ));
        let currentEdgeId = res.id;
        history.push({
          label: "Connect nodes",
          undo: async () => { await deleteEdge.mutateAsync({ id: currentEdgeId }); await refetch(); },
          redo: async () => {
            const recreated = await createEdge.mutateAsync({ canvasId: graph!.activeCanvasId, sourceId: conn.source!, targetId: conn.target! }) as any;
            currentEdgeId = recreated.id;
            await refetch();
          },
        });
      }
    },
    [edges, createEdge, deleteEdge, refetch, history.push, graph],
  );

  // Edge deletion is always preceded by handleBeforeDelete in React Flow's
  // deletion pipeline (keyboard delete AND the per-edge delete button, which
  // calls deleteElements() -- same pipeline), so the combined undo entry
  // pushed there already covers this. Just perform the mutation here.
  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => { for (const e of deleted) deleteEdge.mutate({ id: e.id }); },
    [deleteEdge],
  );

  // Prevent persona/global nodes from being deleted via keyboard or selection.
  // Also the single recording point for a keyboard/selection-driven delete
  // (as opposed to the hover-delete/context-menu/panel single-node paths,
  // recorded in handleNodeDeleted below) -- nodes and their about-to-cascade
  // edges arrive together here, so one user action becomes one undo entry
  // instead of a separate entry per node/edge that could undo out of order.
  const handleBeforeDelete = useCallback(
    async ({ nodes: toDelete, edges: toDeleteEdges }: { nodes: Node[]; edges: Edge[] }) => {
      const filteredNodes = toDelete.filter((n) => {
        const t = n.type as string;
        return t !== "persona" && t !== "global";
      });
      if (filteredNodes.length > 0 || toDeleteEdges.length > 0) {
        const nodeSnapshots = filteredNodes.map((n) => (n.data as NodeData).dbNode);
        const edgeSnapshots = toDeleteEdges.map((e) => ({ id: e.id, sourceId: e.source, targetId: e.target }));
        // Maps each snapshot's ORIGINAL id to whichever id currently
        // represents it -- re-creating on undo always gets a new id, so a
        // later redo (or a repeat undo/redo cycle) has to look the current
        // one up rather than reuse what was captured at push time.
        const currentNodeId = new Map(nodeSnapshots.map((n) => [n.id, n.id]));
        const currentEdgeId = new Map(edgeSnapshots.map((e) => [e.id, e.id]));
        history.push({
          label: filteredNodes.length > 0 ? "Delete node" : "Delete edge",
          undo: async () => {
            for (const n of nodeSnapshots) {
              const recreated = await createNode.mutateAsync(recreateNodePayload(n, activeCanvasId!)) as MessagingNode;
              currentNodeId.set(n.id, recreated.id);
            }
            for (const e of edgeSnapshots) {
              const recreated = await createEdge.mutateAsync({
                canvasId: activeCanvasId!,
                sourceId: currentNodeId.get(e.sourceId) ?? e.sourceId,
                targetId: currentNodeId.get(e.targetId) ?? e.targetId,
              }) as any;
              if (recreated?.id) currentEdgeId.set(e.id, recreated.id);
            }
            await refetch();
          },
          redo: async () => {
            // Edges first -- deleting a node cascades its edges server-side,
            // so an edge-only deletion (no connected node in this batch)
            // still needs its own explicit delete.
            for (const e of edgeSnapshots) await deleteEdge.mutateAsync({ id: currentEdgeId.get(e.id) ?? e.id });
            for (const n of nodeSnapshots) await deleteNode.mutateAsync({ id: currentNodeId.get(n.id) ?? n.id });
            await refetch();
          },
        });
      }
      return { nodes: filteredNodes, edges: toDeleteEdges };
    },
    [activeCanvasId, createNode, createEdge, deleteNode, deleteEdge, refetch, history.push],
  );

  const handleNodesDelete = useCallback(
    (deleted: Node[]) => { for (const n of deleted) deleteNode.mutate({ id: n.id }); },
    [deleteNode],
  );

  function handleNodeSaved(updated: Partial<MessagingNode>) {
    if (!editingNode) return;
    const merged = { ...editingNode, ...updated };
    setEditingNode(merged);
    setNodes((nds) => nds.map((n) =>
      n.id === merged.id
        ? { ...n, data: { ...n.data, dbNode: merged, persona: personasRef.current.find((p) => p.id === merged.personaId) } as NodeData }
        : n,
    ));
  }

  // Single recording point for the hover-delete / context-menu / properties-
  // panel delete paths -- all three bypass React Flow's own deletion
  // pipeline (unlike keyboard/selection delete, recorded in
  // handleBeforeDelete above) and call this directly once their own
  // deleteNode mutation has already fired. Local nodes/edges state still
  // has the full snapshot at this point since this function is what clears
  // it, so read it BEFORE filtering.
  function handleNodeDeleted(id: string) {
    const deletedNode = nodes.find((n) => n.id === id);
    if (deletedNode) {
      const nodeSnapshot = (deletedNode.data as NodeData).dbNode;
      const edgeSnapshots = edges
        .filter((e) => e.source === id || e.target === id)
        .map((e) => ({ id: e.id, sourceId: e.source, targetId: e.target }));
      const currentNodeId = new Map([[nodeSnapshot.id, nodeSnapshot.id]]);
      const currentEdgeId = new Map(edgeSnapshots.map((e) => [e.id, e.id]));
      history.push({
        label: "Delete node",
        undo: async () => {
          const recreated = await createNode.mutateAsync(recreateNodePayload(nodeSnapshot, activeCanvasId!)) as MessagingNode;
          currentNodeId.set(nodeSnapshot.id, recreated.id);
          for (const e of edgeSnapshots) {
            const recreatedEdge = await createEdge.mutateAsync({
              canvasId: activeCanvasId!,
              sourceId: currentNodeId.get(e.sourceId) ?? e.sourceId,
              targetId: currentNodeId.get(e.targetId) ?? e.targetId,
            }) as any;
            if (recreatedEdge?.id) currentEdgeId.set(e.id, recreatedEdge.id);
          }
          await refetch();
        },
        redo: async () => {
          for (const e of edgeSnapshots) await deleteEdge.mutateAsync({ id: currentEdgeId.get(e.id) ?? e.id });
          await deleteNode.mutateAsync({ id: currentNodeId.get(nodeSnapshot.id) ?? nodeSnapshot.id });
          await refetch();
        },
      });
    }
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
  }

  async function handleSelectTemplate(slug: TemplateSlug) {
    setPickerOpen(false);
    try {
      const result = await createCanvas.mutateAsync({ templateSlug: slug }) as { id: string; name: string };
      await refetchCanvases();
      setActiveCanvasId(result.id);
    } catch {
      setPickerOpen(true);
      toast.error("Could not create canvas. Please try again.");
    }
  }

  async function handleRenameCanvas(id: string, name: string) {
    await renameCanvas.mutateAsync({ id, name });
    refetchCanvases();
  }

  async function handleDeleteCanvas(id: string) {
    await deleteCanvas.mutateAsync({ id });
    await refetchCanvases();
    const remaining = userCanvases.filter((c) => c.id !== id);
    if (remaining.length > 0) {
      setActiveCanvasId(remaining[0].id);
    } else {
      setActiveCanvasId(null);
      setPickerOpen(true);
    }
  }

  const tabBar = (
    <CanvasTabBar
      canvases={allTabCanvases}
      activeId={activeCanvasId ?? ""}
      onSelect={setActiveCanvasId}
      onAdd={() => setPickerOpen(true)}
      onRename={handleRenameCanvas}
      onDelete={handleDeleteCanvas}
    />
  );
  const templatePicker = (
    <TemplatePicker
      open={pickerOpen}
      onSelect={handleSelectTemplate}
      onClose={userCanvases.length > 0 ? () => setPickerOpen(false) : undefined}
    />
  );

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        {tabBar}{templatePicker}
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">Loading canvas…</div>
      </div>
    );
  }

  if (graph && graph.personas.length === 0) {
    return (
      <div className="flex h-full flex-col">
        {tabBar}{templatePicker}
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <IconUsers size={32} className="mx-auto mb-3 text-zinc-300" />
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">No ICP personas yet</p>
            <p className="mt-1 text-xs text-zinc-400">Create personas on the ICP tab, then come back here to add messaging guidelines.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h1 className="text-sm font-semibold">Messaging Canvas</h1>
        <p className="text-xs text-zinc-500 flex-1 hidden sm:block">
          Personas are root anchors. Branch off nodes to add messaging rules. Drag to multi-select · Delete to remove. · Share a doc in Chat to auto-build nodes.
        </p>
        <div className="flex gap-0.5 rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-800 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => setViewMode("canvas")}
            title="Canvas view"
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              viewMode === "canvas" ? "bg-white shadow-sm dark:bg-zinc-800" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            <IconSitemap size={13} /> Canvas
          </button>
          <button
            type="button"
            onClick={() => setViewMode("outline")}
            title="Outline view"
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              viewMode === "outline" ? "bg-white shadow-sm dark:bg-zinc-800" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            <IconList size={13} /> Outline
          </button>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={previewing || !activeCanvasId || !graph}
          onClick={() => { setPreviewOpen(true); handleGeneratePreview(); }}
          className="gap-1.5"
        >
          <IconSparkles size={14} />
          Preview message
        </Button>
        <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} className="gap-1.5">
          <IconFileUpload size={14} />
          Import doc
        </Button>
        <Button
          size="sm"
          onClick={() => setBuildOpen(true)}
          className="gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700 border-0"
        >
          <IconSparkles size={14} />
          Build with AI
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isAutoArranging || !graph || graph.nodes.length === 0}
          onClick={() => handleAutoArrange()}
          className="gap-1.5"
        >
          {isAutoArranging ? <IconRefresh size={14} className="animate-spin" /> : <IconLayoutGrid size={14} />}
          Auto-arrange
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!history.canUndo}
          onClick={() => history.undo()}
          title="Undo (⌘Z)"
        >
          <IconArrowBackUp size={14} />
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!history.canRedo}
          onClick={() => history.redo()}
          title="Redo (⌘⇧Z)"
        >
          <IconArrowForwardUp size={14} />
        </Button>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          <IconRefresh size={14} />
        </Button>
      </div>

      <CanvasTabBar
        canvases={allTabCanvases}
        activeId={activeCanvasId ?? ""}
        onSelect={setActiveCanvasId}
        onAdd={() => setPickerOpen(true)}
        onRename={handleRenameCanvas}
        onDelete={handleDeleteCanvas}
      />
      <TemplatePicker
        open={pickerOpen}
        onSelect={handleSelectTemplate}
        onClose={userCanvases.length > 0 ? () => setPickerOpen(false) : undefined}
      />

      {/* Legend */}
      <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-1.5 dark:border-zinc-800/50 flex-wrap">
        {personas.map((p) => (
          <div key={p.id} className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            <span className="text-[10px] text-zinc-500">{p.name}</span>
          </div>
        ))}
        {personas.length > 0 && (
          <span className="text-[10px] text-zinc-300 dark:text-zinc-600">·</span>
        )}
        {(["tone", "phrase_rule", "example", "role"] as NodeKind[]).map((kind) => {
          const cfg = NODE_CONFIG[kind];
          return (
            <div key={kind} className="flex items-center gap-1">
              <div className="h-2 w-2 rounded-full" style={{ background: cfg.color }} />
              <span className="text-[10px] text-zinc-500">{cfg.label}</span>
            </div>
          );
        })}
      </div>

      {/* Three-panel body: palette rail · canvas · properties panel --
          all permanently docked, none a dismissible overlay, so a node can
          be edited while the canvas and the palette both stay visible. */}
      <div className="flex flex-1 min-h-0">
        <NodePaletteRail onSelect={handleAddNode} />

        <div className="flex-1 relative">
          {viewMode === "canvas" ? (
            <ZoomLevelProvider>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={handleConnect}
                onEdgesDelete={handleEdgesDelete}
                onNodesDelete={handleNodesDelete}
                onBeforeDelete={handleBeforeDelete}
                onNodeDragStop={handleNodeDragStop}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                deleteKeyCode={["Delete", "Backspace"]}
                selectionOnDrag
                className="bg-zinc-50 dark:bg-zinc-950"
              >
                <Background color="#e4e4e7" gap={20} />
                <Controls />
                <MiniMap
                  nodeColor={(n) => {
                    if (n.type === "persona") return (n.data as NodeData).persona?.color ?? "#0a66c2";
                    return NODE_CONFIG[n.type as NodeKind]?.color ?? "#94a3b8";
                  }}
                  maskColor="rgba(0,0,0,0.15)"
                  style={{ background: "hsl(var(--background))" }}
                />
              </ReactFlow>
            </ZoomLevelProvider>
          ) : (
            <MessagingOutlineView graph={graph!} onSelect={openEditor} />
          )}
          <PreviewPanel
            open={previewOpen}
            onClose={() => setPreviewOpen(false)}
            onGenerate={handleGeneratePreview}
            preview={previewText}
            generating={previewing}
          />
        </div>

        <NodePropertiesPanel
          node={editingNode}
          isAdmin={isAdmin}
          onClose={() => setEditingNode(null)}
          onSaved={handleNodeSaved}
          onDeleted={handleNodeDeleted}
        />
      </div>

      {buildOpen && graph && (
        <BuildWithAIDialog
          graph={graph}
          onClose={() => setBuildOpen(false)}
          onSubmitted={() => { pendingBuildRef.current = true; }}
          onSend={(label, message) => runInBackground(label, { message, submit: true })}
        />
      )}

      <ImportDocModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        activeCanvasId={activeCanvasId}
        onSend={(label, message, context) => {
          pendingBuildRef.current = true;
          runInBackground(label, { message, context, submit: true });
        }}
      />

      {backgroundTaskLabel && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-card/95 px-4 py-2 text-xs font-medium shadow-lg backdrop-blur">
            <IconRefresh size={13} className="animate-spin text-primary" />
            {backgroundTaskLabel}
          </div>
        </div>
      )}

      {contextMenu && (
        <NodeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          onClose={() => setContextMenu(null)}
          onDelete={() => {
            deleteNode.mutate({ id: contextMenu.node.id });
            handleNodeDeleted(contextMenu.node.id);
          }}
          onAIAction={handleAIAction}
        />
      )}
    </div>
  );
}

// ── Import Doc Modal ───────────────────────────────────────────────────────────

type ImportStatus = "idle" | "parsing" | "sending" | "done" | "error";

const ACCEPTED_TYPES: Record<string, string[]> = {
  "application/pdf": [],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [],
  "application/msword": [],
  "text/plain": [],
  "text/markdown": [],
};
const ACCEPTED_EXT = ".pdf,.docx,.doc,.txt,.md,.markdown";

async function extractText(file: File): Promise<string> {
  const mime = file.type || "";
  const name = file.name.toLowerCase();

  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    const pdfjsLib = await import("pdfjs-dist");
    const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl.href;
    const bytes = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
    }
    return pages.join("\n\n");
  }

  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  ) {
    const mammoth = await import("mammoth");
    const bytes = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: bytes });
    return result.value;
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function ImportDocModal({ open, onClose, activeCanvasId, onSend }: {
  open: boolean; onClose: () => void; activeCanvasId: string | null;
  onSend: (label: string, message: string, context: string) => void;
}) {
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStatus("idle");
    setFileName(null);
    setErrorMsg(null);
    setDragOver(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  async function processFile(file: File) {
    const accepted = Object.keys(ACCEPTED_TYPES).includes(file.type) ||
      ACCEPTED_EXT.split(",").some((ext) => file.name.toLowerCase().endsWith(ext.trim()));
    if (!accepted) {
      setStatus("error");
      setErrorMsg("Unsupported file type. Use PDF, DOCX, DOC, or TXT.");
      return;
    }

    setFileName(file.name);
    setStatus("parsing");
    setErrorMsg(null);

    let text: string;
    try {
      text = await extractText(file);
    } catch {
      setStatus("error");
      setErrorMsg("Could not read the file. Try a different format.");
      return;
    }

    if (!text.trim()) {
      setStatus("error");
      setErrorMsg("The file appears to be empty or could not be read.");
      return;
    }

    setStatus("sending");
    onSend(
      `Extracting nodes from ${file.name}…`,
      `I've attached "${file.name}". Extract canvas nodes from this document and build my messaging canvas.\n\n` +
        (activeCanvasId
          ? `Target canvas ID: "${activeCanvasId}" — this is the tab I currently have open. Use this exact canvas for every action; do not call list-canvases or pick a different one.\n\n`
          : "") +
        `Treat this as a brand-new import — even if a similar or identical document was imported before, extract and create nodes fresh; never skip or refuse because it seems already built.`,
      text,
    );

    // The canvas-level progress banner takes over from here — close right away
    // instead of showing our own "done" state and waiting on a timer.
    handleClose();
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          <IconX size={16} />
        </button>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
          Import document
        </h2>
        <p className="text-xs text-zinc-500 mb-4">
          Drop a PDF, Word doc, or text file. The agent will extract canvas nodes from it.
        </p>

        {status === "idle" || status === "error" ? (
          <>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 transition-colors ${
                dragOver
                  ? "border-violet-500 bg-violet-50 dark:bg-violet-900/20"
                  : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
              }`}
            >
              <IconFileUpload size={28} className="text-zinc-400" />
              <p className="text-xs text-zinc-500">
                Drop file here or <span className="text-violet-600 dark:text-violet-400">click to browse</span>
              </p>
              <p className="text-xs text-zinc-400">PDF, DOCX, DOC, TXT</p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_EXT}
              className="hidden"
              onChange={handleFileInput}
            />
            {status === "error" && errorMsg && (
              <p className="mt-3 text-xs text-red-500">{errorMsg}</p>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            {status === "parsing" && (
              <>
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />
                <p className="text-xs text-zinc-500">Reading {fileName}…</p>
              </>
            )}
            {status === "sending" && (
              <>
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />
                <p className="text-xs text-zinc-500">Sending to agent…</p>
              </>
            )}
            {status === "done" && (
              <>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/30">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8l3.5 3.5L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="text-xs text-zinc-500">Sent! Check the Chat panel for results.</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
