// The CRM field mapping editor (D48): one row per field PA reads, a searchable
// property picker filtered to compatible types, and suggestions a person
// reviews. Nothing here writes to the CRM; saving stages a RevOps change.
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import {
  incompatibility,
  isUnset,
  mappingValue,
  setMappingValue,
  suggestMappings,
  type CanonicalField,
  type PortalProperty,
  type PortalSchema,
} from "@shared/crm-mapping";
import { IconRefresh, IconListSearch, IconX } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MappingView {
  fields: Array<CanonicalField & { usedBy: string[]; current: unknown }>;
  portal: PortalSchema | null;
}

const input =
  "h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

function PropertyPicker({
  field,
  properties,
  value,
  onPick,
}: {
  field: CanonicalField;
  properties: PortalProperty[];
  value: string;
  onPick: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return properties
      .filter(
        (property) => !property.hidden && !incompatibility(field, property),
      )
      .filter(
        (property) =>
          property.name.toLowerCase().includes(q) ||
          property.label.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [field, properties, query]);
  const current = properties.find((property) => property.name === value);
  return (
    <div className="grid gap-1.5">
      {value ? (
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="font-mono">{value}</span>
          {current ? (
            <span className="text-muted-foreground">
              {current.label}, {current.type}
            </span>
          ) : null}
          <button
            type="button"
            aria-label="Clear"
            onClick={() => onPick("TODO")}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <IconX className="size-3" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <input
        className={input}
        value={query}
        placeholder={`Search ${field.object} properties`}
        aria-label={`Property for ${field.label}`}
        onChange={(event) => setQuery(event.target.value)}
      />
      {matches.length > 0 ? (
        <ul
          className="grid overflow-hidden rounded-md border border-border"
          role="listbox"
        >
          {matches.map((property) => (
            <li key={property.name}>
              <button
                type="button"
                role="option"
                aria-selected={property.name === value}
                className="grid w-full px-2.5 py-1.5 text-left text-[12.5px] hover:bg-muted"
                onClick={() => {
                  onPick(property.name);
                  setQuery("");
                }}
              >
                <span className="font-medium">{property.label}</span>
                <span className="text-muted-foreground">
                  {property.name}, {property.type}
                  {property.groupName ? `, ${property.groupName}` : ""}
                  {property.hubspotDefined ? ", standard" : ", custom"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function MappingEditor({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const query = useActionQuery("get-crm-mapping", {});
  const refresh = useActionMutation("refresh-crm-schema");
  const view = query.data as MappingView | undefined;
  const portal = view?.portal ?? null;
  const [suggested, setSuggested] = useState<Set<string>>(new Set());

  function set(path: string, value: unknown) {
    onChange(setMappingValue(data, path, value));
  }

  function applySuggestions() {
    if (!portal) return;
    const proposals = suggestMappings(data, portal);
    if (proposals.length === 0)
      return toast.message("No confident matches for the unmapped fields");
    let next = data;
    const fields = new Set<string>();
    for (const proposal of proposals) {
      const field = view?.fields.find((item) => item.key === proposal.field);
      if (!field?.mapping) continue;
      next = setMappingValue(next, field.mapping, proposal.property);
      fields.add(field.key);
    }
    onChange(next);
    setSuggested(fields);
    toast.success(`Proposed ${fields.size}. Review each, then stage the edit.`);
  }

  if (query.isPending)
    return (
      <p className="text-[12.5px] text-muted-foreground">
        Loading the mapping...
      </p>
    );
  if (!view)
    return (
      <p className="text-[12.5px] text-destructive">
        {actionErrorMessage(query.error)}
      </p>
    );

  const lifecycleName = String(
    mappingValue(data, "contact.lifecycle_stage") ?? "",
  );
  const lifecycle = portal?.objects.contacts?.find(
    (property) => property.name === lifecycleName,
  );
  const mapped = view.fields.filter((field) => field.mapping);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 p-2.5 text-[12.5px]">
        <span className="text-muted-foreground">
          {portal
            ? `HubSpot fields read ${new Date(portal.fetchedAt).toLocaleString()}`
            : "HubSpot fields not read yet: property names can be typed, or refresh to pick from the portal."}
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={refresh.isPending}
            onClick={() =>
              refresh.mutate(
                {},
                {
                  onSuccess: () => void query.refetch(),
                  onError: (error) => toast.error(actionErrorMessage(error)),
                },
              )
            }
          >
            <IconRefresh className="size-4" aria-hidden="true" />
            {refresh.isPending
              ? "Reading HubSpot..."
              : "Refresh HubSpot fields"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!portal}
            onClick={applySuggestions}
          >
            <IconListSearch className="size-4" aria-hidden="true" />
            Suggest mappings
          </Button>
        </div>
      </div>

      <ul className="grid gap-3">
        {mapped.map((field) => {
          const path = field.mapping as string;
          const value = mappingValue(data, path);
          const properties =
            (field.object && portal?.objects[field.object]) || [];
          const property = properties.find((item) => item.name === value);
          const problem =
            !portal || isUnset(value)
              ? null
              : field.expects === "lifecycle_option"
                ? lifecycle &&
                  !lifecycle.options.some((option) => option.value === value)
                  ? `${String(value)} is not an option of ${lifecycle.name}`
                  : null
                : !property
                  ? `${String(value)} is not in the portal`
                  : incompatibility(field, property);
          const status = isUnset(value)
            ? "Unmapped"
            : problem
              ? "Needs attention"
              : portal
                ? "Mapped"
                : "Mapped, not checked";
          return (
            <li
              key={field.key}
              className={cn(
                "grid gap-2 rounded-md border p-3",
                suggested.has(field.key)
                  ? "border-foreground/40"
                  : "border-border",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium capitalize text-foreground">
                  {field.label}
                </span>
                <span
                  className={cn(
                    "rounded-[5px] border px-1.5 text-[11.5px]",
                    problem || isUnset(value)
                      ? "border-amber-500/60 text-amber-700 dark:text-amber-400"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {suggested.has(field.key) ? "Suggested, review it" : status}
                </span>
              </div>
              <p className="text-[12px] text-muted-foreground">
                {field.meaning}
                {field.usedBy.length
                  ? ` Read by ${field.usedBy.join(", ")}.`
                  : ""}
              </p>
              {problem ? (
                <p className="text-[12px] text-destructive">{problem}</p>
              ) : null}
              {field.expects === "lifecycle_option" ? (
                lifecycle ? (
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-[13px]"
                    value={isUnset(value) ? "" : String(value)}
                    onChange={(event) =>
                      set(path, event.target.value || "TODO")
                    }
                    aria-label={field.label}
                  >
                    <option value="">Choose the SAL stage</option>
                    {lifecycle.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} ({option.value})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={input}
                    value={isUnset(value) ? "" : String(value)}
                    placeholder="Internal value, such as salesqualifiedlead"
                    onChange={(event) =>
                      set(path, event.target.value || "TODO")
                    }
                  />
                )
              ) : portal && properties.length ? (
                <PropertyPicker
                  field={field}
                  properties={properties}
                  value={isUnset(value) ? "" : String(value)}
                  onPick={(name) => set(path, name)}
                />
              ) : (
                <input
                  className={cn(input, "font-mono")}
                  value={isUnset(value) ? "" : String(value)}
                  placeholder="HubSpot internal property name"
                  onChange={(event) => set(path, event.target.value || "TODO")}
                />
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-[12px] text-muted-foreground">
        Fields without a row (company name, deal owner, open deals) are standard
        HubSpot fields and need no mapping. Other keys in the mapping stay as
        they are.
      </p>
    </div>
  );
}
