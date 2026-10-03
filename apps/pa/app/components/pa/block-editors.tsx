import { SchemaBlockEditor } from "@agent-native/core/blocks";
// Structured editors for playbook blocks (D46): each block type edits its data
// like a CMS field, never as raw JSON. Types without a custom editor fall back
// to core's schema-driven SchemaBlockEditor.
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CADENCE_ROUTES,
  type CadenceStep,
  type RouteCadence,
} from "@shared/cadence";
import { blockType } from "@shared/playbook-blocks";
import { IconGripVertical, IconPlus, IconX } from "@tabler/icons-react";
import { useMemo, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { MappingEditor } from "./mapping-editor";

type Data = Record<string, unknown>;
export interface BlockEditorProps {
  block: string;
  data: Data;
  onChange: (next: Data) => void;
}

const input =
  "h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="text-[12.5px] font-medium text-foreground">{label}</div>
      {hint ? (
        <div className="-mt-1 text-[12px] text-muted-foreground">{hint}</div>
      ) : null}
      {children}
    </div>
  );
}

/** Chips with an input: type and press Enter to add an element. */
export function ChipList({
  values,
  onChange,
  placeholder,
  normalize = (value) => value.trim(),
  validate,
  render = (value) => value,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  normalize?: (value: string) => string;
  validate?: (value: string) => string | null;
  render?: (value: string) => ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  function add() {
    const value = normalize(draft);
    if (!value) return;
    const problem = validate?.(value) ?? null;
    if (problem) return setError(problem);
    if (!values.includes(value)) onChange([...values, value]);
    setDraft("");
    setError(null);
  }
  return (
    <div className="grid gap-2">
      {values.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <li
              key={value}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 py-0.5 pl-2 pr-1 text-[12.5px]"
            >
              {render(value)}
              <button
                type="button"
                onClick={() =>
                  onChange(values.filter((item) => item !== value))
                }
                aria-label={`Remove ${value}`}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <IconX className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">Nothing yet.</p>
      )}
      <div className="flex gap-2">
        <input
          className={input}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          onClick={add}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border px-2.5 text-[12.5px] hover:bg-muted"
        >
          <IconPlus className="size-3.5" aria-hidden="true" />
          Add
        </button>
      </div>
      {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
    </div>
  );
}

// ISO 3166-1 alpha-2 codes the browser can name, built once.
let countryCache: { code: string; name: string }[] | null = null;
export function isoCountries() {
  if (countryCache) return countryCache;
  const names = new Intl.DisplayNames(["en"], {
    type: "region",
    fallback: "none",
  });
  const out: { code: string; name: string }[] = [];
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const a of letters) {
    for (const b of letters) {
      const code = a + b;
      const name = names.of(code);
      // Skip codes the browser does not name, and the "Unknown Region" style fallbacks.
      if (name && name !== code && !/unknown/i.test(name))
        out.push({ code, name });
    }
  }
  countryCache = out.sort((x, y) => x.name.localeCompare(y.name));
  return countryCache;
}

export function countryLabel(code: string) {
  return isoCountries().find((item) => item.code === code)?.name ?? code;
}

export function CountryPicker({
  values,
  onChange,
}: {
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const all = isoCountries();
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return all
      .filter(
        (item) =>
          !values.includes(item.code) &&
          (item.name.toLowerCase().includes(q) ||
            item.code.toLowerCase() === q),
      )
      .slice(0, 8);
  }, [all, query, values]);
  return (
    <div className="grid gap-2">
      <ul className="flex flex-wrap gap-1.5">
        {values.map((code) => (
          <li
            key={code}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 py-0.5 pl-2 pr-1 text-[12.5px]"
          >
            {countryLabel(code)}{" "}
            <span className="text-muted-foreground">{code}</span>
            <button
              type="button"
              onClick={() => onChange(values.filter((item) => item !== code))}
              aria-label={`Remove ${countryLabel(code)}`}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <IconX className="size-3" aria-hidden="true" />
            </button>
          </li>
        ))}
        {values.length === 0 ? (
          <li className="text-[12.5px] text-muted-foreground">
            No countries yet.
          </li>
        ) : null}
      </ul>
      <input
        className={input}
        value={query}
        placeholder="Add a country: type a name or a code"
        aria-label="Search countries"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && matches[0]) {
            event.preventDefault();
            onChange([...values, matches[0].code]);
            setQuery("");
          }
        }}
      />
      {matches.length > 0 ? (
        <ul
          className="grid overflow-hidden rounded-md border border-border"
          role="listbox"
          aria-label="Matching countries"
        >
          {matches.map((item) => (
            <li key={item.code}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full justify-between px-2.5 py-1.5 text-left text-[13px] hover:bg-muted"
                onClick={() => {
                  onChange([...values, item.code]);
                  setQuery("");
                }}
              >
                {item.name}
                <span className="text-muted-foreground">{item.code}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SortableRow({ id, children }: { id: string; children: ReactNode }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5",
        isDragging && "opacity-60 shadow-md",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="cursor-grab rounded p-0.5 text-muted-foreground hover:text-foreground"
      >
        <IconGripVertical className="size-4" aria-hidden="true" />
      </button>
      {children}
    </li>
  );
}

/** An ordered list: drag to reorder, remove, and add from known options. */
export function SortableList<T extends { id: string }>({
  items,
  onChange,
  renderItem,
}: {
  items: T[];
  onChange: (next: T[]) => void;
  renderItem: (item: T) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  function onDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const from = items.findIndex((item) => item.id === event.active.id);
    const to = items.findIndex((item) => item.id === event.over!.id);
    onChange(arrayMove(items, from, to));
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={items.map((item) => item.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="grid gap-1.5">
          {items.map((item) => (
            <SortableRow key={item.id} id={item.id}>
              {renderItem(item)}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

const ROUTING_STEPS: Record<string, string> = {
  existing_active_owner: "Existing active owner",
  deal_or_customer_owner: "Deal or customer owner",
  agency_partner_rep: "Agency partner rep",
  round_robin: "Round robin",
};
const OUTCOMES: Record<string, string> = {
  attach_to_owner: "Attach to existing owner",
  route_to_support: "Route to support",
  self_serve_thank_you: "Self-serve thank-you",
  ignore_logged: "Ignore and log",
  disqualify_logged: "Disqualify and log",
  continue: "Continue",
};
const CLASS_LABELS: Record<string, string> = {
  hq_content: "Exceptional, Content",
  hq_code: "Exceptional, Code",
  standard_content: "Requires discovery, Content",
  standard_code: "Requires discovery, Code",
  content_price_check: "Content price check",
  agency: "Agency",
};
const ROUTE_OPTIONS: Record<string, string> = {
  route_to_ae: "Route to the AE (AE's meeting link)",
  pa_meeting: "PA takes the call (PA's meeting link)",
  qualify_first: "Qualify first (questions, no link)",
  agency: "Agency path (path question)",
};

function ClassRoutesEditor({
  data,
  onChange,
}: {
  data: Data;
  onChange: (next: Data) => void;
}) {
  return (
    <Field
      label="Route for each class"
      hint="The PA can still change the route on any lead."
    >
      <ul className="grid gap-1.5">
        {Object.entries(CLASS_LABELS).map(([key, label]) => (
          <li key={key} className="flex flex-wrap items-center gap-2">
            <span className="min-w-40 flex-1 text-[13px]">{label}</span>
            <select
              aria-label={`Route for ${label}`}
              className="h-7 rounded-md border border-input bg-background px-1.5 text-[12.5px]"
              value={String(data[key] ?? "qualify_first")}
              onChange={(event) =>
                onChange({ ...data, [key]: event.target.value })
              }
            >
              {Object.entries(ROUTE_OPTIONS).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </Field>
  );
}

/**
 * Follow-up cadence (D101): for each route, on or off, whether the AE stays
 * on cc, and the steps: a day after the first touch and what the email is
 * for. The agent writes each email from its purpose.
 */
export function CadenceEditor({
  data,
  onChange,
}: {
  data: Data;
  onChange: (next: Data) => void;
}) {
  const cadenceOf = (route: string): RouteCadence =>
    (data[route] as RouteCadence | undefined) ?? { enabled: false, steps: [] };
  const set = (route: string, next: RouteCadence) =>
    onChange({ ...data, [route]: next });
  return (
    <div className="grid gap-4">
      {CADENCE_ROUTES.map(({ route, label, hint }) => {
        const cadence = cadenceOf(route);
        const steps = cadence.steps;
        const setStep = (index: number, patch: Partial<CadenceStep>) =>
          set(route, {
            ...cadence,
            steps: steps.map((step, i) =>
              i === index ? { ...step, ...patch } : step,
            ),
          });
        return (
          <section
            key={route}
            className="rounded-md border border-border p-3"
            aria-label={label}
          >
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex flex-1 items-center gap-2 text-[13px] font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={cadence.enabled}
                  onChange={(event) =>
                    set(route, { ...cadence, enabled: event.target.checked })
                  }
                />
                {label}
              </label>
              {route === "route_to_ae" ? (
                <label className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={cadence.cc_ae ?? true}
                    disabled={!cadence.enabled}
                    onChange={(event) =>
                      set(route, { ...cadence, cc_ae: event.target.checked })
                    }
                  />
                  Keep the AE on cc
                </label>
              ) : null}
            </div>
            {hint ? (
              <p className="mt-1 text-[12px] text-muted-foreground">{hint}</p>
            ) : null}
            {cadence.enabled ? (
              <ol className="mt-3 grid gap-2">
                {steps.map((step, index) => (
                  <li
                    key={index}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2"
                  >
                    <label className="flex items-center gap-1 text-[12.5px] text-muted-foreground">
                      Day
                      <input
                        type="number"
                        min={1}
                        max={60}
                        aria-label={`Day for follow-up ${index + 1}`}
                        className={cn(input, "w-16")}
                        value={step.day}
                        onChange={(event) =>
                          setStep(index, {
                            day: Math.max(1, Number(event.target.value) || 1),
                          })
                        }
                      />
                    </label>
                    <textarea
                      aria-label={`What follow-up ${index + 1} is for`}
                      rows={2}
                      className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-[13px] leading-snug text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      placeholder="What this follow-up is for, e.g. share one customer example that matches their need"
                      value={step.purpose}
                      onChange={(event) =>
                        setStep(index, { purpose: event.target.value })
                      }
                    />
                    <button
                      type="button"
                      aria-label={`Remove follow-up ${index + 1}`}
                      className="mt-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() =>
                        set(route, {
                          ...cadence,
                          steps: steps.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <IconX className="size-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
                {steps.length === 0 ? (
                  <li className="text-[12.5px] text-muted-foreground">
                    No follow-ups yet.
                  </li>
                ) : null}
                <li>
                  <button
                    type="button"
                    disabled={steps.length >= 10}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12.5px] font-medium text-primary hover:bg-primary-soft disabled:opacity-50"
                    onClick={() =>
                      set(route, {
                        ...cadence,
                        steps: [
                          ...steps,
                          {
                            day: (steps[steps.length - 1]?.day ?? 0) + 2,
                            purpose: "",
                          },
                        ],
                      })
                    }
                  >
                    <IconPlus className="size-3.5" aria-hidden="true" />
                    Add follow-up
                  </button>
                </li>
              </ol>
            ) : (
              <p className="mt-2 text-[12.5px] text-muted-foreground">
                Off: no follow-ups after the first touch.
              </p>
            )}
          </section>
        );
      })}
      <p className="text-[12px] text-muted-foreground">
        Days count from the first touch. Follow-ups stop when the lead replies,
        books a meeting, opts out, or HubSpot moves them on. A change applies to
        leads whose first touch goes out after it is published.
      </p>
    </div>
  );
}

const humanize = (key: string) =>
  key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const email = (value: string) =>
  value === "TODO" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ? null
    : "Use an email address, or TODO";

function RoutingOrderEditor({
  data,
  onChange,
}: {
  data: Data;
  onChange: (next: Data) => void;
}) {
  const order = (Array.isArray(data.order) ? data.order : []) as string[];
  const missing = Object.keys(ROUTING_STEPS).filter(
    (step) => !order.includes(step),
  );
  return (
    <div className="grid gap-4">
      <Field
        label="Steps, in order"
        hint="The first step that finds an owner wins. Drag to reorder."
      >
        <SortableList
          items={order.map((step) => ({ id: step }))}
          onChange={(next) =>
            onChange({ ...data, order: next.map((item) => item.id) })
          }
          renderItem={(item) => (
            <>
              <span className="flex-1 text-[13px]">
                {ROUTING_STEPS[item.id] ??
                  `${humanize(item.id)} (not built yet)`}
              </span>
              <button
                type="button"
                aria-label={`Remove ${item.id}`}
                onClick={() =>
                  onChange({
                    ...data,
                    order: order.filter((step) => step !== item.id),
                  })
                }
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <IconX className="size-3.5" aria-hidden="true" />
              </button>
            </>
          )}
        />
        {missing.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {missing.map((step) => (
              <button
                key={step}
                type="button"
                onClick={() => onChange({ ...data, order: [...order, step] })}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-border px-2 text-[12px] hover:bg-muted"
              >
                <IconPlus className="size-3" aria-hidden="true" />
                {ROUTING_STEPS[step]}
              </button>
            ))}
          </div>
        ) : null}
      </Field>
      <Field
        label="Agency partner rep"
        hint="Who gets agency leads when the agency step runs."
      >
        <input
          className={input}
          value={String(data.agency_partner_rep ?? "")}
          placeholder="name@builder.io, or TODO"
          onChange={(event) =>
            onChange({ ...data, agency_partner_rep: event.target.value })
          }
        />
      </Field>
    </div>
  );
}

function OutcomeMapEditor({
  data,
  onChange,
}: {
  data: Data;
  onChange: (next: Data) => void;
}) {
  const rows = Object.entries(data).map(([signal, outcome]) => ({
    id: signal,
    outcome: String(outcome),
  }));
  const [signal, setSignal] = useState("");
  const write = (next: { id: string; outcome: string }[]) =>
    onChange(Object.fromEntries(next.map((row) => [row.id, row.outcome])));
  return (
    <Field
      label="Signals, checked in order"
      hint="Drag to change which signal wins. A new signal needs a rule function; the app owner gets a build request."
    >
      <SortableList
        items={rows}
        onChange={write}
        renderItem={(row) => (
          <>
            <span className="min-w-0 flex-1 truncate text-[13px]">
              {humanize(row.id)}
            </span>
            <select
              aria-label={`Outcome for ${row.id}`}
              className="h-7 rounded-md border border-input bg-background px-1.5 text-[12.5px]"
              value={row.outcome}
              onChange={(event) =>
                write(
                  rows.map((item) =>
                    item.id === row.id
                      ? { ...item, outcome: event.target.value }
                      : item,
                  ),
                )
              }
            >
              {Object.entries(OUTCOMES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={`Remove ${row.id}`}
              onClick={() => write(rows.filter((item) => item.id !== row.id))}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <IconX className="size-3.5" aria-hidden="true" />
            </button>
          </>
        )}
      />
      <div className="flex gap-2">
        <input
          className={input}
          value={signal}
          placeholder="New signal, such as competitor_customer"
          onChange={(event) => setSignal(event.target.value)}
        />
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border px-2.5 text-[12.5px] hover:bg-muted"
          onClick={() => {
            const key = signal
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "_");
            if (!key || rows.some((row) => row.id === key)) return;
            write([...rows, { id: key, outcome: "continue" }]);
            setSignal("");
          }}
        >
          <IconPlus className="size-3.5" aria-hidden="true" />
          Add
        </button>
      </div>
    </Field>
  );
}

function NumbersEditor({
  data,
  onChange,
  units,
}: {
  data: Data;
  onChange: (next: Data) => void;
  units?: Record<string, string>;
}) {
  const numeric = Object.entries(data).filter(
    ([, value]) => typeof value === "number",
  );
  return (
    <div className="grid gap-3">
      {numeric.map(([key, value]) => (
        <Field key={key} label={humanize(key)}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              className={cn(input, "max-w-40")}
              value={value as number}
              onChange={(event) =>
                onChange({
                  ...data,
                  [key]:
                    event.target.value === "" ? 0 : Number(event.target.value),
                })
              }
            />
            {units?.[key] ? (
              <span className="text-[12.5px] text-muted-foreground">
                {units[key]}
              </span>
            ) : null}
          </div>
        </Field>
      ))}
      {numeric.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">
          No numbers on this block.
        </p>
      ) : null}
    </div>
  );
}

function ClockEditor({
  data,
  onChange,
}: {
  data: Data;
  onChange: (next: Data) => void;
}) {
  const unit = data.minutes !== undefined ? "minutes" : "hours";
  const amount = Number(data[unit] ?? 0);
  return (
    <div className="grid gap-4">
      <Field label="Time allowed">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            className={cn(input, "max-w-32")}
            value={amount}
            onChange={(event) =>
              onChange({ ...data, [unit]: Number(event.target.value) })
            }
          />
          <select
            aria-label="Unit"
            className="h-8 rounded-md border border-input bg-background px-2 text-[13px]"
            value={unit}
            onChange={(event) => {
              const { minutes: _m, hours: _h, ...rest } = data;
              onChange({ ...rest, [event.target.value]: amount });
            }}
          >
            <option value="minutes">working minutes</option>
            <option value="hours">hours</option>
          </select>
        </div>
      </Field>
      <Field label="Remind at" hint="A share of the time allowed, such as 75%.">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={99}
            className={cn(input, "max-w-24")}
            value={
              data.reminder_at_fraction === undefined
                ? ""
                : Math.round(Number(data.reminder_at_fraction) * 100)
            }
            placeholder="none"
            onChange={(event) => {
              const { reminder_at_fraction: _r, ...rest } = data;
              onChange(
                event.target.value === ""
                  ? rest
                  : {
                      ...rest,
                      reminder_at_fraction: Number(event.target.value) / 100,
                    },
              );
            }}
          />
          <span className="text-[12.5px] text-muted-foreground">%</span>
        </div>
      </Field>
      <Field label="Escalate a breach to" hint="A role or an email.">
        <input
          className={input}
          value={String(data.breach_notify ?? "")}
          placeholder="pa_lead"
          onChange={(event) =>
            onChange({ ...data, breach_notify: event.target.value })
          }
        />
      </Field>
    </div>
  );
}

function MessageRuleEditor({
  data,
  onChange,
}: {
  data: Data;
  onChange: (next: Data) => void;
}) {
  const list = (key: string) =>
    Array.isArray(data[key]) ? (data[key] as string[]) : [];
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3">
        {(["min_words", "max_words"] as const).map((key) => (
          <Field
            key={key}
            label={key === "min_words" ? "Fewest words" : "Most words"}
          >
            <input
              type="number"
              className={input}
              value={data[key] === undefined ? "" : Number(data[key])}
              onChange={(event) => {
                const { [key]: _drop, ...rest } = data;
                onChange(
                  event.target.value === ""
                    ? rest
                    : { ...rest, [key]: Number(event.target.value) },
                );
              }}
            />
          </Field>
        ))}
      </div>
      <Field label="Phrases never to use">
        <ChipList
          values={list("banned_phrases")}
          placeholder="Add a phrase"
          onChange={(next) => onChange({ ...data, banned_phrases: next })}
        />
      </Field>
      <Field label="Characters never to use" hint="Such as the em dash.">
        <ChipList
          values={list("banned_chars")}
          placeholder="Paste a character"
          normalize={(value) => value.trim().slice(0, 2)}
          render={(value) =>
            `${value} (U+${value.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")})`
          }
          onChange={(next) => onChange({ ...data, banned_chars: next })}
        />
      </Field>
    </div>
  );
}

export function BlockDataEditor({ block, data, onChange }: BlockEditorProps) {
  switch (block) {
    case "country_list":
      return (
        <Field
          label="Countries"
          hint="Two-letter ISO codes. Regions such as Crimea need a separate check."
        >
          <CountryPicker
            values={(data.countries as string[]) ?? []}
            onChange={(next) => onChange({ ...data, countries: next })}
          />
        </Field>
      );
    case "precheck_outcomes":
      return <OutcomeMapEditor data={data} onChange={onChange} />;
    case "routing_order":
      return <RoutingOrderEditor data={data} onChange={onChange} />;
    case "class_routes":
      return <ClassRoutesEditor data={data} onChange={onChange} />;
    case "cadence":
      return <CadenceEditor data={data} onChange={onChange} />;
    case "threshold":
      return (
        <NumbersEditor
          data={data}
          onChange={onChange}
          units={{
            days: "days",
            code_min_seats: "seats",
            hours: "hours",
            exceptional_signals: "of 5 signals",
            intent_exceptional: "intent score",
            intent_recycle: "intent score",
            employees_exceptional: "employees",
            max_employees: "employees",
            signups_multiple: "sign-ups",
            thin_message_words: "words",
          }}
        />
      );
    case "clock":
      return <ClockEditor data={data} onChange={onChange} />;
    case "message_rule":
      return <MessageRuleEditor data={data} onChange={onChange} />;
    case "person_pool":
      return (
        <Field
          label="People in the pool"
          hint="New, unowned leads are shared between them."
        >
          <ChipList
            values={(data.pool as string[]) ?? []}
            placeholder="name@builder.io"
            normalize={(value) => value.trim().toLowerCase()}
            validate={email}
            onChange={(next) => onChange({ ...data, pool: next })}
          />
        </Field>
      );
    case "crm_system":
      return (
        <Field
          label="CRM"
          hint="HubSpot is built. Choosing Salesforce publishes, and asks the app owner to build its adapter."
        >
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-[13px]"
            value={String(data.system ?? "hubspot")}
            onChange={(event) =>
              onChange({ ...data, system: event.target.value })
            }
          >
            <option value="hubspot">HubSpot</option>
            <option value="salesforce">Salesforce</option>
          </select>
        </Field>
      );
    case "crm_mapping":
      return <MappingEditor data={data} onChange={onChange} />;
    case "definition":
    case "knowledge":
      return null;
    default: {
      const type = blockType(block);
      if (!type) return null;
      return (
        <SchemaBlockEditor
          data={data}
          onChange={(next) => onChange(next as Data)}
          schema={type.schema as never}
          editable
          ctx={{}}
        />
      );
    }
  }
}
