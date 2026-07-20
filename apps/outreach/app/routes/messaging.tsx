import {
  sendToAgentChat,
  useActionMutation,
  useActionQuery,
  useAgentChatGenerating,
} from "@agent-native/core/client";
import { useOrgRole } from "@agent-native/core/client/org";
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
} from "@xyflow/react";
import type { Connection, Edge, EdgeProps, Node, NodeProps } from "@xyflow/react";
import {
  IconBriefcase,
  IconFileUpload,
  IconLock,
  IconMicrophone2,
  IconNote,
  IconPlus,
  IconRefresh,
  IconSparkles,
  IconTextPlus,
  IconTrash,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `${APP_TITLE} — Messaging` }];
}

// ── Types ──────────────────────────────────────────────────────────────────────

type NodeKind = "persona" | "tone" | "phrase_rule" | "example" | "role";

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
}

// ── Unified canvas node component ──────────────────────────────────────────────

function CanvasNode({ data }: NodeProps) {
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
      className="rounded-xl border border-zinc-200/60 bg-white shadow-md dark:border-zinc-700/60 dark:bg-zinc-900 cursor-pointer w-[220px] overflow-hidden"
      style={accentColor ? { borderLeft: `3px solid ${accentColor}` } : undefined}
      onClick={() => d.onClick(d.dbNode)}
    >
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

      {/* Field preview */}
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
                  {text.length > 60 ? text.slice(0, 57) + "…" : text}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Persona ancestry badge */}
      {accentColor && d.ancestorPersona && (
        <div className="flex items-center gap-1.5 border-t border-zinc-100 dark:border-zinc-800 px-3 py-1">
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: accentColor }} />
          <span className="text-[9px] text-zinc-400 truncate">{d.ancestorPersona.name}</span>
        </div>
      )}

      {/* Persona nodes are source-only anchors — no incoming connections allowed */}
      {!isGlobal && !isPersona && <Handle type="target" position={Position.Left} />}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { persona: CanvasNode, tone: CanvasNode, phrase_rule: CanvasNode, example: CanvasNode, role: CanvasNode };

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

type PaletteKind = "tone" | "phrase_rule" | "example" | "role";
const PALETTE_TYPES: PaletteKind[] = ["tone", "phrase_rule", "example", "role"];

function NodePalette({ onSelect }: { onSelect: (type: PaletteKind) => void }) {
  return (
    <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden">
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

// ── Import from doc dialog ─────────────────────────────────────────────────────

function ImportDocDialog({ open, onClose, personas }: { open: boolean; onClose: () => void; personas: Persona[] }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setText(reader.result as string);
    reader.readAsText(file);
  }

  function handleImport() {
    if (!text.trim()) return;
    const personaList = personas.length > 0
      ? `\nExisting ICP personas:\n${personas.map((p) => `- ${p.name} (id: ${p.id})`).join("\n")}`
      : "";

    sendToAgentChat({
      message:
        `Parse this messaging document and build out the Messaging Canvas.\n\n` +
        `## Canvas model\n` +
        `Each ICP persona has a persona anchor node (type='persona'). Fine-tuning nodes (tone, phrase_rule, example, role) branch off personas via edges. Source = parent, target = child.\n\n` +
        `## Instructions\n` +
        `1. Call get-messaging-graph to get current node IDs — persona anchor nodes are already there.\n` +
        `2. For each persona, if the doc has persona-level baseline messaging (tone, value props, phrases, examples), call update-messaging-node on that persona's canvas node (find it by type='persona' and matching personaId).\n` +
        `3. For each distinct tone/voice section within a persona, create a "tone" node.\n` +
        `4. For each set of use/avoid phrases, create a "phrase_rule" node.\n` +
        `5. For each example note or template, create an "example" node.\n` +
        `6. For each role-specific section, create a "role" node with the role name as the title.\n` +
        `7. Wire each new node to its parent with create-messaging-edge (source = parent id, target = child id).\n` +
        `8. Be faithful to the doc — don't invent content that isn't there.` +
        personaList +
        `\n\n## Document\n\n${text.trim()}`,
      submit: true,
    });

    setText(""); setFileName(""); onClose();
    toast.success("Sent to agent — check the Chat tab for progress");
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[520px] rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">Import messaging doc</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700"><IconX size={16} /></button>
        </div>
        <div className="flex flex-col gap-4 p-5">
          <p className="text-xs text-zinc-500">
            Paste your messaging guidelines or upload a .txt / .md file. The agent will parse it and create typed nodes automatically.
          </p>
          <div>
            <input ref={fileRef} type="file" accept=".txt,.md,.markdown" className="hidden" onChange={handleFile} />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="gap-1.5">
              <IconFileUpload size={14} />
              {fileName || "Upload file"}
            </Button>
          </div>
          <textarea
            className="h-48 w-full resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            placeholder="Or paste your messaging doc here…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleImport} disabled={!text.trim()}>Import</Button>
          </div>
        </div>
      </div>
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

function NodeEditorSheet({ node, isAdmin, onClose, onSaved, onDeleted }: EditorProps) {
  const updateNode = useActionMutation("update-messaging-node");
  const deleteNode = useActionMutation("delete-messaging-node");

  const isPersona = node?.type === "persona";
  const isGlobal = (node?.type as string) === "global";
  const readOnly = (isGlobal || isPersona) && !isAdmin;
  const cfg = node ? (NODE_CONFIG[node.type as NodeKind] ?? NODE_CONFIG.tone) : NODE_CONFIG.tone;

  const [title, setTitle] = useState("");
  const [tone, setTone] = useState("");
  const [valueProps, setValueProps] = useState("");
  const [phrasesToUse, setPhrasesToUse] = useState("");
  const [phrasesToAvoid, setPhrasesToAvoid] = useState("");
  const [exampleNotes, setExampleNotes] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!node) return;
    setTitle(node.title ?? "");
    setTone(node.tone ?? "");
    setValueProps(node.valueProps ?? "");
    setPhrasesToUse(node.phrasesToUse ?? "");
    setPhrasesToAvoid(node.phrasesToAvoid ?? "");
    setExampleNotes(node.exampleNotes ?? "");
    setNotes(node.notes ?? "");
  }, [node?.id]);

  async function handleSave() {
    if (!node) return;
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

  // Persona nodes: Notes + Tone only — value props, phrases, examples belong in child nodes
  const showNotes = isGlobal || isPersona || node?.type === "role";
  const showTone = isGlobal || isPersona || node?.type === "tone" || node?.type === "role";
  const showValueProps = isGlobal || node?.type === "tone";
  const showUse = isGlobal || node?.type === "phrase_rule" || node?.type === "role";
  const showAvoid = isGlobal || node?.type === "phrase_rule" || node?.type === "role";
  const showExample = isGlobal || node?.type === "example";

  return (
    <Sheet open={!!node} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[420px] overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-2">
            {node && (
              <div className="flex h-7 w-7 items-center justify-center rounded" style={{ background: cfg.color }}>
                <cfg.Icon size={14} className="text-white" />
              </div>
            )}
            <SheetTitle>
            {isPersona ? (node?.title ?? cfg.label) : cfg.label}
          </SheetTitle>
          </div>
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-4">
          <EditorField label="Title" readOnly={readOnly}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} placeholder="Node title" />
          </EditorField>

          {showNotes && (
            <EditorField label={node?.type === "role" ? "Role description" : "Notes"} readOnly={readOnly}>
              <textarea
                className="w-full resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={readOnly}
                placeholder={node?.type === "role" ? "e.g. When messaging VPs of Engineering, lead with reliability and team impact..." : "Any other instructions for the AI..."}
              />
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
              <Button onClick={handleSave} disabled={updateNode.isPending} className="flex-1">
                {updateNode.isPending && <IconRefresh className="animate-spin mr-1" size={13} />}
                Save
              </Button>
              {!isGlobal && !isPersona && (
                <Button variant="destructive" onClick={handleDelete} disabled={deleteNode.isPending}>
                  <IconTrash size={14} />
                </Button>
              )}
            </div>
          )}

          {readOnly && <p className="text-xs text-zinc-500 italic">Global baseline is admin-managed.</p>}
          {isPersona && !readOnly && <p className="text-xs text-zinc-500 italic">Persona anchor. Add tone/voice here as a baseline, then branch off Phrase Rule, Example, and Role nodes for the details.</p>}
          {isPersona && readOnly && <p className="text-xs text-zinc-500 italic">Persona nodes are admin-managed.</p>}
        </div>
      </SheetContent>
    </Sheet>
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

function BuildWithAIDialog({ graph, onClose, onSubmitted }: { graph: GraphData; onClose: () => void; onSubmitted: () => void }) {
  const [prompt, setPrompt] = useState("");

  function buildContext(): string {
    const parts: string[] = [];

    parts.push("## ICP Personas & Documents");
    for (const p of graph.personas) {
      const anchorNode = graph.nodes.find((n) => n.type === "persona" && n.personaId === p.id);
      parts.push(`\n### ${p.name} (canvas node id: ${anchorNode?.id ?? "none"})`);
      parts.push(p.icpText ? p.icpText : "No ICP document uploaded.");
    }

    parts.push("\n\n## Current Canvas Nodes");
    parts.push("\nPersona anchor nodes (already exist — connect to these, do NOT recreate them):");
    for (const n of graph.nodes.filter((n) => n.type === "persona")) {
      parts.push(`- "${n.title}" id=${n.id}`);
    }
    const fineNodes = graph.nodes.filter((n) => n.type !== "persona");
    if (fineNodes.length > 0) {
      parts.push("\nExisting fine-tuning nodes (update if relevant, skip if already good):");
      for (const n of fineNodes) {
        parts.push(`- [${n.type}] "${n.title}" id=${n.id}`);
      }
    }
    if (graph.edges.length > 0) {
      parts.push("\nExisting edges:");
      for (const e of graph.edges) {
        const src = graph.nodes.find((n) => n.id === e.sourceId);
        const tgt = graph.nodes.find((n) => n.id === e.targetId);
        parts.push(`- "${src?.title}" → "${tgt?.title}" id=${e.id}`);
      }
    }

    return parts.join("\n");
  }

  function buildLayoutExample(): string {
    const n = graph.personas.length;
    if (n === 0) return "";
    const childCount = 3;
    const bandH = childCount * 230;
    const lines = ["\n\nWorked example with your " + n + " persona(s), 3 children each:"];
    let yc = 0;
    graph.personas.slice(0, Math.min(n, 3)).forEach((p, i) => {
      const anchor = graph.nodes.find((nd) => nd.type === "persona" && nd.personaId === p.id);
      lines.push(`  Persona ${i} (${p.name}, id=${anchor?.id ?? "?"}): x=80, y=${yc + Math.round(bandH / 2)}`);
      for (let j = 0; j < childCount; j++) {
        lines.push(`    Child ${j}: x=500, y=${yc + j * 230 + 115}`);
      }
      yc += bandH + 180;
    });
    return lines.join("\n");
  }

  function handleBuild() {
    sendToAgentChat({
      message:
        `Build my messaging canvas.\n\n## My Request\n${prompt.trim()}\n\n` +
        buildContext() +
        `\n\n## Build Instructions\n\n` +
        `Node types available: tone (voice/style/valueProps), phrase_rule (phrasesToUse/phrasesToAvoid), example (exampleNotes), role (notes + tone + phrases).\n` +
        `Fill content fields from the ICP doc text. Only populate fields that have relevant content.\n\n` +
        `## Layout Algorithm — MUST FOLLOW EXACTLY\n\n` +
        `STEP 1 — Plan before calling any action:\n` +
        `  For each persona, decide which 2–4 child nodes to create (tone, phrase_rule, example, role).\n\n` +
        `STEP 2 — Calculate every position using this formula:\n` +
        `  y_cursor = 0\n` +
        `  For each persona (i = 0, 1, 2...):\n` +
        `    N = number of child nodes for this persona\n` +
        `    band_h = N × 230\n` +
        `    Persona anchor → positionX=80, positionY = y_cursor + (band_h / 2)\n` +
        `    Child node j (j=0..N-1) → positionX=500, positionY = y_cursor + (j × 230) + 115\n` +
        `    y_cursor += band_h + 180\n\n` +
        `STEP 3 — Execute in this order:\n` +
        `  a. update-messaging-node for each persona anchor (reposition to calculated x/y)\n` +
        `  b. create-messaging-node for each child (pass calculated positionX/positionY)\n` +
        `  c. create-messaging-edge for each child (sourceId=personaAnchorId, targetId=newChildId)\n` +
        `  d. update-messaging-node for each child to fill in content fields\n\n` +
        `CRITICAL: no two nodes may share the same positionY. Use exactly the formula above.` +
        buildLayoutExample(),
      submit: true,
    });
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

// ── Canvas ─────────────────────────────────────────────────────────────────────

function toFlowNode(
  dbNode: MessagingNode,
  personas: Persona[],
  ancestorPersonaMap: Map<string, Persona>,
  isAdmin: boolean,
  onClick: (n: MessagingNode) => void,
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
  const { canManageOrg } = useOrgRole();
  const isAdmin = canManageOrg;

  const { data: graph, isLoading, refetch } = useActionQuery<GraphData>("get-messaging-graph", {});
  const createNode = useActionMutation("create-messaging-node");
  const createEdge = useActionMutation("create-messaging-edge");
  const deleteEdge = useActionMutation("delete-messaging-edge");
  const updateNode = useActionMutation("update-messaging-node");

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [editingNode, setEditingNode] = useState<MessagingNode | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);

  const personasRef = useRef<Persona[]>([]);
  const hasAutoInitializedRef = useRef(false);
  const dragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBuildRef = useRef(false);

  // Auto-refetch canvas after agent finishes a Build with AI run
  const [isGenerating] = useAgentChatGenerating();
  const wasGeneratingRef = useRef(false);
  useEffect(() => {
    if (wasGeneratingRef.current && !isGenerating && pendingBuildRef.current) {
      pendingBuildRef.current = false;
      refetch();
    }
    wasGeneratingRef.current = isGenerating;
  }, [isGenerating, refetch]);
  const { screenToFlowPosition } = useReactFlow();

  const openEditor = useCallback((n: MessagingNode) => setEditingNode(n), []);

  useEffect(() => {
    if (!graph) return;
    personasRef.current = graph.personas;
    setPersonas(graph.personas);
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    const ancestorPersonaMap = computeAncestorPersonas(graph.nodes, graph.edges, graph.personas);
    setNodes(graph.nodes.map((n) => toFlowNode(n, graph.personas, ancestorPersonaMap, isAdmin, openEditor)));
    setEdges(graph.edges.map((e) => toFlowEdge(e, nodeById, ancestorPersonaMap, graph.personas)));

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
    setPaletteOpen(false);
    const pos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const result = await createNode.mutateAsync({
      nodeType,
      positionX: Math.round(pos.x),
      positionY: Math.round(pos.y),
    }) as MessagingNode;
    setNodes((nds) => [...nds, toFlowNode(result, personasRef.current, new Map(), isAdmin, openEditor)]);
    setEditingNode(result);
  }

  function handleNodeDragStop(_: unknown, node: Node) {
    if (dragTimerRef.current) clearTimeout(dragTimerRef.current);
    dragTimerRef.current = setTimeout(() => {
      updateNode.mutate({ id: node.id, positionX: Math.round(node.position.x), positionY: Math.round(node.position.y) });
    }, 300);
  }

  const handleConnect = useCallback(
    async (conn: Connection) => {
      const optimistic = addEdge({ ...conn, type: "deletable", animated: false, style: { stroke: "#94a3b8", strokeWidth: 1.5 }, markerEnd: { type: "arrowclosed" as any, color: "#94a3b8" } }, edges);
      setEdges(optimistic);
      const res = await createEdge.mutateAsync({ sourceId: conn.source!, targetId: conn.target! }) as any;
      if (res?.ok === false) {
        toast.error(res.error ?? "Could not connect nodes.");
        setEdges(edges);
      } else {
        setEdges((eds) => eds.map((e) =>
          e.source === conn.source && e.target === conn.target && e.id !== res.id ? { ...e, id: res.id } : e,
        ));
      }
    },
    [edges, createEdge],
  );

  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => { for (const e of deleted) deleteEdge.mutate({ id: e.id }); },
    [deleteEdge],
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

  function handleNodeDeleted(id: string) {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
  }

  if (isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-zinc-500">Loading canvas…</div>;
  }

  if (graph && graph.personas.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <IconUsers size={32} className="mx-auto mb-3 text-zinc-300" />
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">No ICP personas yet</p>
          <p className="mt-1 text-xs text-zinc-400">Create personas on the ICP tab, then come back here to add messaging guidelines.</p>
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
          Personas are root anchors. Branch off Tone, Phrase Rule, Example, and Role nodes. Click a persona to build from its ICP doc.
        </p>
        <Button
          size="sm"
          onClick={() => setBuildOpen(true)}
          className="gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700 border-0"
        >
          <IconSparkles size={14} />
          Build with AI
        </Button>
        <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} className="gap-1.5">
          <IconFileUpload size={14} />
          Import doc
        </Button>
        {/* Add node button with palette */}
        <div className="relative">
          <Button size="sm" onClick={() => setPaletteOpen((o) => !o)} className="gap-1">
            <IconPlus size={14} />
            Add Node
          </Button>
          {paletteOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setPaletteOpen(false)} />
              <div className="z-50 relative">
                <NodePalette onSelect={handleAddNode} />
              </div>
            </>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          <IconRefresh size={14} />
        </Button>
      </div>

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

      {/* Canvas */}
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={handleConnect}
          onEdgesDelete={handleEdgesDelete}
          onNodeDragStop={handleNodeDragStop}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          deleteKeyCode="Delete"
          className="bg-zinc-50 dark:bg-zinc-950"
        >
          <Background color="#e4e4e7" gap={20} />
          <Controls />
          <MiniMap
            nodeColor={(n) => {
              if (n.type === "persona") return (n.data as NodeData).persona?.color ?? "#0a66c2";
              return NODE_CONFIG[n.type as NodeKind]?.color ?? "#94a3b8";
            }}
            maskColor="rgba(0,0,0,0.05)"
          />
        </ReactFlow>
      </div>

      <ImportDocDialog open={importOpen} onClose={() => setImportOpen(false)} personas={personas} />

      {buildOpen && graph && (
        <BuildWithAIDialog
          graph={graph}
          onClose={() => setBuildOpen(false)}
          onSubmitted={() => { pendingBuildRef.current = true; }}
        />
      )}

      <NodeEditorSheet
        node={editingNode}
        isAdmin={isAdmin}
        onClose={() => setEditingNode(null)}
        onSaved={handleNodeSaved}
        onDeleted={handleNodeDeleted}
      />
    </div>
  );
}
