// The Sales handbook (D53): PA's reference docs on the sales cycle and how the
// team works. Read by everyone, edited by PA role holders, every version kept.
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { SharedRichEditor } from "@agent-native/toolkit/editor";
import {
  IconArrowBackUp,
  IconFileImport,
  IconHistory,
  IconNotebook,
  IconPencil,
  IconSearch,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { EmptyState, ErrorState } from "@/components/pa/states";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { APP_TITLE } from "@/lib/app-config";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function meta() {
  return [{ title: `Sales handbook - ${APP_TITLE}` }];
}

type Status = "index" | "current" | "legacy";

interface DocSummary {
  id: string;
  title: string;
  summary: string | null;
  status: Status;
  position: number;
  version: number;
  updatedBy: string;
  updatedAt: string;
  words: number;
}

interface ListResult {
  canEdit: boolean;
  docs: DocSummary[];
  matches: Array<{ id: string; title: string; excerpt: string }>;
}

interface DocResult {
  canEdit: boolean;
  doc: DocSummary & { body: string; source: string | null };
  viewingVersion: number;
  revisions: Array<{
    version: number;
    editedBy: string;
    note: string | null;
    createdAt: string;
  }>;
}

const GROUPS: Array<{ status: Status; label: string }> = [
  { status: "index", label: "Start here" },
  { status: "current", label: "Current" },
  { status: "legacy", label: "Legacy, background only" },
];

function ImportButton({
  onImported,
  variant = "outline",
}: {
  onImported: (firstId: string | null) => void;
  variant?: "outline" | "default";
}) {
  const input = useRef<HTMLInputElement>(null);
  const importDocs = useActionMutation("import-handbook-docs");
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".md,text/markdown"
        multiple
        className="sr-only"
        aria-label="Choose Markdown files to import"
        onChange={async (event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length === 0) return;
          const payload = await Promise.all(
            files.map(async (file) => ({
              name: file.name,
              content: await file.text(),
            })),
          );
          importDocs.mutate(
            {
              files: payload,
              source: `Imported ${new Date().toLocaleDateString()}`,
            },
            {
              onSuccess: (raw) => {
                const result = raw as {
                  added: string[];
                  updated: string[];
                  unchanged: string[];
                };
                toast.success(
                  `${result.added.length} added, ${result.updated.length} updated, ${result.unchanged.length} unchanged`,
                );
                onImported(result.added[0] ?? result.updated[0] ?? null);
              },
              onError: (error) => toast.error(actionErrorMessage(error)),
            },
          );
        }}
      />
      <Button
        type="button"
        size="sm"
        variant={variant}
        disabled={importDocs.isPending}
        onClick={() => input.current?.click()}
      >
        <IconFileImport className="size-4" aria-hidden="true" />
        {importDocs.isPending ? "Importing..." : "Import .md files"}
      </Button>
    </>
  );
}

function DocList({
  docs,
  selected,
  onSelect,
}: {
  docs: DocSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav aria-label="Handbook docs" className="space-y-4">
      {GROUPS.map((group) => {
        const items = docs.filter((doc) => doc.status === group.status);
        if (items.length === 0) return null;
        return (
          <div key={group.status}>
            <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {items.map((doc) => (
                <li key={doc.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(doc.id)}
                    aria-current={doc.id === selected ? "page" : undefined}
                    className={cn(
                      "w-full rounded-md px-2 py-1.5 text-left text-[13px] leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      doc.id === selected
                        ? "bg-accent font-medium text-foreground"
                        : "text-foreground/85 hover:bg-accent/60",
                    )}
                  >
                    {doc.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function DocView({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [version, setVersion] = useState<number | undefined>(undefined);
  const query = useActionQuery(
    "get-handbook-doc",
    version ? { id, version } : { id },
  );
  const save = useActionMutation("update-handbook-doc");
  const data = query.data as DocResult | null | undefined;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    setEditing(false);
    setVersion(undefined);
  }, [id]);

  if (query.isPending)
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading doc">
        <div className="h-7 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted/70" />
        <div className="h-64 animate-pulse rounded bg-muted/50" />
      </div>
    );
  if (!data)
    return (
      <ErrorState
        title="Couldn't load this doc"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );

  const { doc, revisions, canEdit } = data;
  const latest = revisions[0]?.version ?? doc.version;
  const viewingOld = data.viewingVersion !== latest;

  function submit(body: string, saveNote: string | null) {
    save.mutate(
      {
        id: doc.id,
        expectedVersion: latest,
        body,
        note: saveNote,
      },
      {
        onSuccess: () => {
          toast.success("Saved. The previous version is in History.");
          setEditing(false);
          setVersion(undefined);
          setNote("");
          void query.refetch();
          onChanged();
        },
        onError: (error) => toast.error(actionErrorMessage(error)),
      },
    );
  }

  return (
    <article className="min-w-0">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-foreground">
              {doc.title}
            </h2>
            {doc.status === "legacy" ? (
              <span className="rounded-[5px] bg-warning-soft px-1.5 py-0.5 text-[11.5px] font-medium text-warning-foreground">
                Legacy
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Version {data.viewingVersion}
            {viewingOld ? ` of ${latest}` : ""} · updated by {doc.updatedBy}{" "}
            {formatDateTime(doc.updatedAt)}
            {doc.source ? ` · ${doc.source}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" variant="ghost">
                <IconHistory className="size-4" aria-hidden="true" />
                History
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel className="text-[12px] text-muted-foreground">
                {revisions.length} versions
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {revisions.map((revision) => (
                <DropdownMenuItem
                  key={revision.version}
                  onSelect={() =>
                    setVersion(
                      revision.version === latest
                        ? undefined
                        : revision.version,
                    )
                  }
                  className="flex-col items-start gap-0.5 text-[12.5px]"
                >
                  <span className="font-medium">
                    Version {revision.version}
                    {revision.version === latest ? " (current)" : ""}
                  </span>
                  <span className="text-[11.5px] text-muted-foreground">
                    {revision.editedBy}, {formatDateTime(revision.createdAt)}
                    {revision.note ? ` · ${revision.note}` : ""}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {canEdit && !editing && !viewingOld ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setDraft(doc.body);
                setEditing(true);
              }}
            >
              <IconPencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
          ) : null}
        </div>
      </header>

      {viewingOld ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-[12.5px]">
          <span className="text-foreground">
            You are viewing version {data.viewingVersion}. The current version
            is {latest}.
          </span>
          <div className="ml-auto flex gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setVersion(undefined)}
            >
              Back to current
            </Button>
            {canEdit ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={save.isPending}
                onClick={() =>
                  submit(doc.body, `Restored version ${data.viewingVersion}`)
                }
              >
                <IconArrowBackUp className="size-4" aria-hidden="true" />
                Restore this version
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          "mt-4",
          editing && "rounded-lg border border-border px-4 py-3",
        )}
      >
        <SharedRichEditor
          key={`${doc.id}:${data.viewingVersion}:${editing ? "edit" : "read"}`}
          value={editing ? draft : doc.body}
          onChange={(next) => {
            if (editing) setDraft(next);
          }}
          editable={editing}
          dialect="gfm"
          features={{ tables: true, tasks: true, link: true, codeBlock: true }}
          dragHandle={editing}
          ariaLabel={doc.title}
          className="pa-handbook-doc"
        />
      </div>

      {editing ? (
        <div className="sticky bottom-0 mt-3 flex flex-wrap items-center gap-2 border-t border-border bg-background py-3">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What changed? (optional)"
            maxLength={300}
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-[13px] shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Change note"
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={save.isPending || draft.trim() === doc.body.trim()}
            onClick={() => submit(draft, note || null)}
          >
            {save.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

export default function HandbookRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const list = useActionQuery("list-handbook", term ? { query: term } : {});
  const data = list.data as ListResult | undefined;
  const docs = useMemo(() => data?.docs ?? [], [data]);
  const requested = searchParams.get("doc");
  const selected =
    requested && docs.some((doc) => doc.id === requested)
      ? requested
      : (docs.find((doc) => doc.status === "index")?.id ?? docs[0]?.id ?? null);

  useEffect(() => {
    const handle = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(handle);
  }, [search]);

  function select(id: string) {
    const params = new URLSearchParams(searchParams);
    params.set("doc", id);
    setSearchParams(params);
  }

  if (list.isPending && !data)
    return (
      <div className="mx-auto w-full max-w-[1200px] px-3 py-4 sm:px-4 md:px-6">
        <div className="h-72 animate-pulse rounded-lg border border-border bg-card" />
      </div>
    );
  if (!data)
    return (
      <div className="mx-auto w-full max-w-[1200px] px-3 py-4 sm:px-4 md:px-6">
        <ErrorState
          title="Couldn't load the handbook"
          error={list.error}
          onRetry={() => void list.refetch()}
        />
      </div>
    );

  if (docs.length === 0)
    return (
      <div className="mx-auto w-full max-w-[900px] px-3 py-4 sm:px-4 md:px-6">
        <div className="rounded-lg border border-border bg-card">
          <EmptyState
            icon={IconNotebook}
            title="The Sales handbook is empty"
            action={
              data.canEdit ? (
                <ImportButton
                  variant="default"
                  onImported={(id) => {
                    void list.refetch();
                    if (id) select(id);
                  }}
                />
              ) : null
            }
          >
            <p>
              The handbook holds how the sales team works: the sales cycle,
              qualification, lead routing, personas, and the email playbook.
              {data.canEdit
                ? " Import the Markdown files to start; you can edit each one here afterwards."
                : " Ask someone with a PA role to import it."}
            </p>
          </EmptyState>
        </div>
      </div>
    );

  return (
    <div className="mx-auto grid w-full max-w-[1200px] gap-6 px-3 py-4 sm:px-4 md:grid-cols-[15rem_minmax(0,1fr)] md:px-6 md:py-5">
      <aside className="space-y-4 md:sticky md:top-4 md:self-start">
        <label className="relative block">
          <span className="sr-only">Search the handbook</span>
          <IconSearch
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search the handbook"
            className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2.5 text-[13px] shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        {term ? (
          <div className="space-y-1">
            <p className="px-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              {data.matches.length} matches
            </p>
            <ul className="space-y-0.5">
              {data.matches.map((match) => (
                <li key={match.id}>
                  <button
                    type="button"
                    onClick={() => select(match.id)}
                    className="w-full rounded-md px-2 py-1.5 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="block text-[13px] font-medium text-foreground">
                      {match.title}
                    </span>
                    <span className="line-clamp-2 text-[12px] text-muted-foreground">
                      {match.excerpt}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <DocList docs={docs} selected={selected} onSelect={select} />
        )}
        {data.canEdit ? (
          <div className="px-2">
            <ImportButton
              onImported={(id) => {
                void list.refetch();
                if (id) select(id);
              }}
            />
          </div>
        ) : null}
      </aside>
      <section className="min-w-0 rounded-lg border border-border bg-card px-4 py-4 shadow-xs md:px-6 md:py-5">
        {selected ? (
          <DocView id={selected} onChanged={() => void list.refetch()} />
        ) : null}
      </section>
    </div>
  );
}
