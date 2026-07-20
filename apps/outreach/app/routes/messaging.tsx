import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import { useOrgRole } from "@agent-native/core/client/org";
import "@xyflow/react/dist/style.css";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import type {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  NodeProps,
} from "@xyflow/react";
import {
  IconLock,
  IconPlus,
  IconRefresh,
  IconTrash,
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

interface MessagingNode {
  id: string;
  type: string;
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
}

interface GraphData {
  nodes: MessagingNode[];
  edges: MessagingEdge[];
  personas: Persona[];
}

// ── Custom node data shape ─────────────────────────────────────────────────────

interface NodeData extends Record<string, unknown> {
  dbNode: MessagingNode;
  persona: Persona | undefined;
  isAdmin: boolean;
  onClick: (node: MessagingNode) => void;
}

// ── Global node ────────────────────────────────────────────────────────────────

function GlobalNode({ data }: NodeProps) {
  const d = data as NodeData;
  return (
    <div
      className="rounded-lg border-2 border-[#0a66c2] bg-white shadow-md dark:bg-zinc-900 cursor-pointer min-w-[180px]"
      onClick={() => d.onClick(d.dbNode)}
    >
      <div className="flex items-center gap-1.5 rounded-t-md bg-[#0a66c2] px-3 py-1.5 text-white">
        <span className="text-xs font-semibold truncate flex-1">{d.dbNode.title}</span>
        {!d.isAdmin && <IconLock size={11} />}
      </div>
      <div className="px-3 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        Global baseline
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

// ── Standard node ──────────────────────────────────────────────────────────────

function StandardNode({ data }: NodeProps) {
  const d = data as NodeData;
  return (
    <div
      className="rounded-lg border border-zinc-200 bg-white shadow-md dark:border-zinc-700 dark:bg-zinc-900 cursor-pointer min-w-[180px]"
      onClick={() => d.onClick(d.dbNode)}
    >
      <div className="flex items-center gap-1.5 rounded-t-md bg-slate-600 px-3 py-1.5 text-white">
        <span className="text-xs font-semibold truncate flex-1">{d.dbNode.title}</span>
      </div>
      <div className="px-3 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        {d.persona ? (
          <span
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-white text-[10px] font-medium"
            style={{ background: d.persona.color }}
          >
            {d.persona.name}
          </span>
        ) : (
          "No persona linked"
        )}
      </div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { global: GlobalNode, standard: StandardNode };

// ── Node Editor Sheet ──────────────────────────────────────────────────────────

interface EditorSheetProps {
  node: MessagingNode | null;
  personas: Persona[];
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (updated: Partial<MessagingNode>) => void;
  onDeleted: (id: string) => void;
}

function NodeEditorSheet({ node, personas, isAdmin, onClose, onSaved, onDeleted }: EditorSheetProps) {
  const updateNode = useActionMutation("update-messaging-node");
  const deleteNode = useActionMutation("delete-messaging-node");

  const isGlobal = node?.type === "global";
  const readOnly = isGlobal && !isAdmin;

  const [title, setTitle] = useState("");
  const [personaId, setPersonaId] = useState<string>("");
  const [tone, setTone] = useState("");
  const [valueProps, setValueProps] = useState("");
  const [phrasesToUse, setPhrasesToUse] = useState("");
  const [phrasesToAvoid, setPhrasesToAvoid] = useState("");
  const [exampleNotes, setExampleNotes] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!node) return;
    setTitle(node.title ?? "");
    setPersonaId(node.personaId ?? "");
    setTone(node.tone ?? "");
    setValueProps(node.valueProps ?? "");
    setPhrasesToUse(node.phrasesToUse ?? "");
    setPhrasesToAvoid(node.phrasesToAvoid ?? "");
    setExampleNotes(node.exampleNotes ?? "");
    setNotes(node.notes ?? "");
  }, [node?.id]);

  async function handleSave() {
    if (!node) return;
    await updateNode.mutateAsync({
      id: node.id,
      title: title || undefined,
      personaId: isGlobal ? undefined : (personaId || null),
      tone: tone || null,
      valueProps: valueProps || null,
      phrasesToUse: phrasesToUse || null,
      phrasesToAvoid: phrasesToAvoid || null,
      exampleNotes: exampleNotes || null,
      notes: notes || null,
    });
    onSaved({ title, personaId: personaId || null, tone: tone || null, valueProps: valueProps || null, phrasesToUse: phrasesToUse || null, phrasesToAvoid: phrasesToAvoid || null, exampleNotes: exampleNotes || null, notes: notes || null });
    toast.success("Saved");
  }

  async function handleDelete() {
    if (!node) return;
    const res = await deleteNode.mutateAsync({ id: node.id });
    if ((res as any)?.ok === false) {
      toast.error((res as any).error ?? "Cannot delete this node.");
      return;
    }
    onDeleted(node.id);
    onClose();
  }

  return (
    <Sheet open={!!node} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[420px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isGlobal ? "Global Baseline" : "Node Settings"}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-4">
          <Field label="Title" readOnly={readOnly}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={readOnly}
              placeholder="Node title"
            />
          </Field>

          {!isGlobal && (
            <Field label="Link to Persona" readOnly={readOnly}>
              <select
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                value={personaId}
                onChange={(e) => setPersonaId(e.target.value)}
                disabled={readOnly}
              >
                <option value="">— No persona —</option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Tone / Voice" readOnly={readOnly}>
            <textarea
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 resize-none"
              rows={3}
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              disabled={readOnly}
              placeholder="e.g. Warm and direct. No corporate jargon."
            />
          </Field>

          <Field label="Key Value Props" readOnly={readOnly}>
            <textarea
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 resize-none"
              rows={3}
              value={valueProps}
              onChange={(e) => setValueProps(e.target.value)}
              disabled={readOnly}
              placeholder="Core benefits or differentiators to highlight..."
            />
          </Field>

          <Field label="Phrases to Use" readOnly={readOnly}>
            <textarea
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 resize-none"
              rows={3}
              value={phrasesToUse}
              onChange={(e) => setPhrasesToUse(e.target.value)}
              disabled={readOnly}
              placeholder="Phrases, words, or approaches to include..."
            />
          </Field>

          <Field label="Phrases to Avoid" readOnly={readOnly}>
            <textarea
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 resize-none"
              rows={3}
              value={phrasesToAvoid}
              onChange={(e) => setPhrasesToAvoid(e.target.value)}
              disabled={readOnly}
              placeholder="Phrases or approaches to never use..."
            />
          </Field>

          <Field label="Example Notes" readOnly={readOnly}>
            <textarea
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 resize-none"
              rows={4}
              value={exampleNotes}
              onChange={(e) => setExampleNotes(e.target.value)}
              disabled={readOnly}
              placeholder="Show 2-3 example connection notes in your voice..."
            />
          </Field>

          <Field label="Free-form Notes" readOnly={readOnly}>
            <textarea
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 resize-none"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={readOnly}
              placeholder="Any other instructions for the AI..."
            />
          </Field>

          {!readOnly && (
            <div className="flex items-center gap-2 pt-2">
              <Button
                onClick={handleSave}
                disabled={updateNode.isPending}
                className="flex-1"
              >
                {updateNode.isPending ? <IconRefresh className="animate-spin" size={14} /> : null}
                Save
              </Button>
              {!isGlobal && (
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleteNode.isPending}
                >
                  <IconTrash size={14} />
                </Button>
              )}
            </div>
          )}

          {readOnly && (
            <p className="text-xs text-zinc-500 italic">
              Global baseline is managed by an admin.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  readOnly,
  children,
}: {
  label: string;
  readOnly: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {label}
        {readOnly && " (read-only)"}
      </Label>
      {children}
    </div>
  );
}

// ── Canvas page ────────────────────────────────────────────────────────────────

function toFlowNode(dbNode: MessagingNode, personas: Persona[], isAdmin: boolean, onClick: (n: MessagingNode) => void): Node {
  const persona = personas.find((p) => p.id === dbNode.personaId);
  return {
    id: dbNode.id,
    type: dbNode.type === "global" ? "global" : "standard",
    position: { x: dbNode.positionX, y: dbNode.positionY },
    data: { dbNode, persona, isAdmin, onClick } as NodeData,
  };
}

function toFlowEdge(e: MessagingEdge): Edge {
  return {
    id: e.id,
    source: e.sourceId,
    target: e.targetId,
    type: "smoothstep",
    animated: false,
    style: { stroke: "#94a3b8", strokeWidth: 1.5 },
    markerEnd: { type: "arrowclosed" as any, color: "#94a3b8" },
  };
}

export default function MessagingPage() {
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

  const dragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  const openEditor = useCallback((n: MessagingNode) => setEditingNode(n), []);

  // Sync graph data → flow state
  useEffect(() => {
    if (!graph) return;
    setPersonas(graph.personas);
    setNodes(graph.nodes.map((n) => toFlowNode(n, graph.personas, isAdmin, openEditor)));
    setEdges(graph.edges.map(toFlowEdge));
  }, [graph, isAdmin]);

  // Add a new node at viewport center
  async function handleAddNode() {
    const pos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const result = await createNode.mutateAsync({ positionX: Math.round(pos.x), positionY: Math.round(pos.y) }) as MessagingNode;
    const newNode = toFlowNode(result, personas, isAdmin, openEditor);
    setNodes((nds) => [...nds, newNode]);
    setEditingNode(result);
  }

  // Debounced position save after drag
  function handleNodeDragStop(_: unknown, node: Node) {
    if (dragTimerRef.current) clearTimeout(dragTimerRef.current);
    dragTimerRef.current = setTimeout(() => {
      updateNode.mutate({ id: node.id, positionX: Math.round(node.position.x), positionY: Math.round(node.position.y) });
    }, 300);
  }

  // Connect two nodes
  const handleConnect = useCallback(
    async (conn: Connection) => {
      const optimistic = addEdge({ ...conn, type: "smoothstep", animated: false, style: { stroke: "#94a3b8", strokeWidth: 1.5 }, markerEnd: { type: "arrowclosed" as any, color: "#94a3b8" } }, edges);
      setEdges(optimistic);
      const res = await createEdge.mutateAsync({ sourceId: conn.source!, targetId: conn.target! }) as any;
      if (res?.ok === false) {
        toast.error(res.error ?? "Could not create connection.");
        setEdges(edges); // rollback
      } else {
        // Update the edge id to the server-assigned one
        setEdges((eds) =>
          eds.map((e) =>
            e.source === conn.source && e.target === conn.target && e.id !== res.id
              ? { ...e, id: res.id }
              : e,
          ),
        );
      }
    },
    [edges, createEdge],
  );

  // Delete edges
  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const e of deleted) {
        deleteEdge.mutate({ id: e.id });
      }
    },
    [deleteEdge],
  );

  // Sheet callbacks
  function handleNodeSaved(updated: Partial<MessagingNode>) {
    if (!editingNode) return;
    const merged = { ...editingNode, ...updated };
    setEditingNode(merged);
    setNodes((nds) =>
      nds.map((n) =>
        n.id === merged.id
          ? { ...n, data: { ...n.data, dbNode: merged, persona: personas.find((p) => p.id === merged.personaId) } as NodeData }
          : n,
      ),
    );
  }

  function handleNodeDeleted(id: string) {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Loading canvas…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h1 className="text-sm font-semibold">Messaging Canvas</h1>
        <p className="text-xs text-zinc-500 flex-1">
          Connect nodes to build an inheritance chain. Each persona node extends its parent.
        </p>
        <Button size="sm" onClick={handleAddNode} disabled={createNode.isPending}>
          <IconPlus size={14} className="mr-1" />
          Add Node
        </Button>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          <IconRefresh size={14} />
        </Button>
      </div>

      {/* Canvas */}
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
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
            nodeColor={(n) => (n.type === "global" ? "#0a66c2" : "#64748b")}
            maskColor="rgba(0,0,0,0.05)"
          />
        </ReactFlow>
      </div>

      {/* Node editor */}
      <NodeEditorSheet
        node={editingNode}
        personas={personas}
        isAdmin={isAdmin}
        onClose={() => setEditingNode(null)}
        onSaved={handleNodeSaved}
        onDeleted={handleNodeDeleted}
      />
    </div>
  );
}
