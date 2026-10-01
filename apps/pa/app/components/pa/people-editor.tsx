// The people leads are routed to (D66, D78): role and meeting link. Owners PA
// has seen on leads are listed so their details can be filled.
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { IconCheck, IconUserPlus } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Person {
  email: string;
  displayName: string | null;
  role: "pa" | "ae" | "commercial_ae" | "csm" | null;
  meetingLink: string | null;
  podAeEmail: string | null;
  saved: boolean;
  seenAsPa: number;
  seenAsAccountOwner: number;
}

const field =
  "h-8 w-full rounded-md border border-input bg-background px-2 text-[13px] shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

const ROLE_LABELS = {
  pa: "PA",
  ae: "Enterprise AE",
  commercial_ae: "Commercial AE",
  csm: "CSM",
} as const;

function seenLabel(person: Person) {
  const parts = [
    person.seenAsPa
      ? `PA on ${person.seenAsPa} ${person.seenAsPa === 1 ? "lead" : "leads"}`
      : null,
    person.seenAsAccountOwner
      ? `owns ${person.seenAsAccountOwner} ${person.seenAsAccountOwner === 1 ? "account" : "accounts"}`
      : null,
  ].filter(Boolean);
  return parts.length ? `Seen in HubSpot: ${parts.join(", ")}` : null;
}

function PersonRow({
  person,
  aes,
  canEdit,
  onSaved,
}: {
  person: Person;
  aes: Person[];
  canEdit: boolean;
  onSaved: () => void;
}) {
  const save = useActionMutation("save-person");
  const guessRole =
    person.role ??
    (person.seenAsPa > 0 ? "pa" : person.seenAsAccountOwner > 0 ? "ae" : null);
  const [role, setRole] = useState<string>(guessRole ?? "");
  const [link, setLink] = useState(person.meetingLink ?? "");
  const dirty =
    !person.saved ||
    role !== (person.role ?? "") ||
    link !== (person.meetingLink ?? "") ||
    false;
  const name = person.displayName ?? person.email;

  function submit() {
    save.mutate(
      {
        email: person.email,
        displayName: person.displayName,
        role: (role || null) as never,
        meetingLink: link.trim() || null,
        // Pod AEs no longer route leads (D78); keep what is stored.
        podAeEmail: person.podAeEmail,
      },
      {
        onSuccess: () => {
          toast.success(`Saved ${name}`);
          onSaved();
        },
        onError: (error) => toast.error(actionErrorMessage(error)),
      },
    );
  }

  return (
    <li className="grid gap-2 border-b border-border px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1.3fr)_9rem_minmax(0,2fr)_auto] md:items-center">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-foreground">
          {name}
        </p>
        <p className="truncate text-[12px] text-muted-foreground">
          {person.displayName ? person.email : null}
          {!person.saved && seenLabel(person) ? (
            <span
              className={cn(person.displayName && "before:content-['_·_']")}
            >
              {seenLabel(person)}
            </span>
          ) : null}
        </p>
      </div>
      <label className="grid gap-0.5">
        <span className="text-[11px] text-muted-foreground md:sr-only">
          Role
        </span>
        <select
          className={field}
          value={role}
          disabled={!canEdit}
          onChange={(event) => setRole(event.target.value)}
        >
          <option value="">Role</option>
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-0.5">
        <span className="text-[11px] text-muted-foreground md:sr-only">
          Meeting link
        </span>
        <input
          className={field}
          type="url"
          inputMode="url"
          placeholder="https://meetings.hubspot.com/..."
          value={link}
          disabled={!canEdit}
          onChange={(event) => setLink(event.target.value)}
        />
      </label>
      <div className="flex justify-end">
        {canEdit ? (
          <Button
            size="sm"
            variant={dirty ? "default" : "ghost"}
            disabled={!dirty || save.isPending}
            onClick={submit}
          >
            {dirty ? (
              "Save"
            ) : (
              <>
                <IconCheck className="size-4" aria-hidden="true" />
                Saved
              </>
            )}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function PeopleEditor() {
  const query = useActionQuery("list-people", {});
  const data = query.data as { people: Person[]; canEdit: boolean } | undefined;
  const [email, setEmail] = useState("");
  const [extra, setExtra] = useState<Person[]>([]);
  const people = [
    ...(data?.people ?? []),
    ...extra.filter(
      (item) => !(data?.people ?? []).some((p) => p.email === item.email),
    ),
  ];
  const aes = people.filter((person) => person.role === "ae");
  const hasCommercial = people.some(
    (person) => person.role === "commercial_ae",
  );

  function add() {
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      return toast.error("Enter an email address");
    setExtra((items) => [
      ...items,
      {
        email: value,
        displayName: null,
        role: null,
        meetingLink: null,
        podAeEmail: null,
        saved: false,
        seenAsPa: 0,
        seenAsAccountOwner: 0,
      },
    ]);
    setEmail("");
  }

  return (
    <section
      aria-labelledby="people-title"
      className="mx-auto w-full max-w-[1100px] px-3 pb-8 sm:px-4 md:px-6"
    >
      <div className="mb-2">
        <h2 id="people-title" className="text-[15px] font-semibold">
          Routing: people and meeting links
        </h2>
        <p className="max-w-[70ch] text-[12.5px] text-muted-foreground">
          Who takes the meeting once a lead is triaged. An exceptional lead goes
          to the AE who owns the account in HubSpot. With no AE owner, 8,000
          employees or fewer goes to the Commercial AE, and bigger accounts
          round robin across the Enterprise AEs. The email carries that AE's
          meeting link. When the PA takes the call, it carries the PA's link.
          Saved in PA only.
          {hasCommercial ? "" : " No Commercial AE is set yet."}
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card">
        {query.isPending ? (
          <p className="px-4 py-6 text-[13px] text-muted-foreground">
            Loading people...
          </p>
        ) : people.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-muted-foreground">
            Nobody yet. Owners appear here once leads come in.
          </p>
        ) : (
          <ul>
            {people.map((person) => (
              <PersonRow
                key={`${person.email}:${person.saved}`}
                person={person}
                aes={aes}
                canEdit={Boolean(data?.canEdit)}
                onSaved={() => void query.refetch()}
              />
            ))}
          </ul>
        )}
        {data?.canEdit ? (
          <form
            className="flex gap-2 border-t border-border px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
          >
            <input
              className={cn(field, "max-w-xs")}
              type="email"
              placeholder="Add someone by email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button type="submit" size="sm" variant="outline">
              <IconUserPlus className="size-4" aria-hidden="true" />
              Add
            </Button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
