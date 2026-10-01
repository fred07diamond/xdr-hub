// Lead routing, its own Settings tab (D79): who exceptional leads go to,
// grouped the way the rule reads. The Commercial AE, the Enterprise AEs the
// round robin rotates through, and each PA's meeting link for when the PA
// takes the call. Owners seen on leads but not set up are listed last.
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { SettingsGroup, SettingsRow } from "@agent-native/core/client/settings";
import {
  IconBuildingSkyscraper,
  IconBuildingStore,
  IconExternalLink,
  IconPlus,
  IconUser,
  IconUserQuestion,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type Role = "pa" | "ae" | "commercial_ae" | "csm";

interface Person {
  email: string;
  displayName: string | null;
  role: Role | null;
  meetingLink: string | null;
  saved: boolean;
  seenAsPa: number;
  seenAsAccountOwner: number;
  roundRobinLeads: number;
}

interface PeopleResult {
  people: Person[];
  commercialLine: number | null;
  canEdit: boolean;
}

const input =
  "h-8 w-full rounded-md border border-input bg-background px-2 text-[13px] shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

const shortLink = (link: string) =>
  link.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

const nameOf = (person: Person) => person.displayName ?? person.email;

/** Add someone, or change their name and link, for one role. */
function PersonForm({
  role,
  person,
  submitLabel,
  onDone,
}: {
  role: Role;
  person?: Person;
  submitLabel: string;
  onDone: () => void;
}) {
  const save = useActionMutation("save-person");
  const [email, setEmail] = useState(person?.email ?? "");
  const [name, setName] = useState(person?.displayName ?? "");
  const [link, setLink] = useState(person?.meetingLink ?? "");
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const validLink = !link.trim() || /^https:\/\/\S+$/.test(link.trim());
  return (
    <form
      className="grid gap-2 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(
          {
            email: email.trim().toLowerCase(),
            displayName: name.trim() || null,
            role,
            meetingLink: link.trim() || null,
          },
          {
            onSuccess: () => {
              toast.success(`Saved ${name.trim() || email.trim()}`);
              onDone();
            },
            onError: (error) => toast.error(actionErrorMessage(error)),
          },
        );
      }}
    >
      <label className="grid gap-1 text-[12px] text-muted-foreground">
        Email
        <input
          className={input}
          type="email"
          required
          value={email}
          readOnly={Boolean(person)}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@builder.io"
        />
      </label>
      <label className="grid gap-1 text-[12px] text-muted-foreground">
        Name
        <input
          className={input}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="First Last"
        />
      </label>
      <label className="grid gap-1 text-[12px] text-muted-foreground sm:col-span-2">
        Meeting link
        <input
          className={input}
          type="url"
          inputMode="url"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder="https://meetings.hubspot.com/..."
        />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <Button
          type="submit"
          size="sm"
          disabled={save.isPending || !validEmail || !validLink}
        >
          {save.isPending ? "Saving..." : submitLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** One person in a routing group, with edit and remove. */
function PersonRow({
  person,
  role,
  icon,
  detail,
  canEdit,
  onChanged,
}: {
  person: Person;
  role: Role;
  icon: ReactNode;
  detail?: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const save = useActionMutation("save-person");
  const [editing, setEditing] = useState(false);
  return (
    <SettingsRow
      icon={icon}
      label={nameOf(person)}
      description={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {person.displayName ? (
            <span className="font-mono text-[12px]">{person.email}</span>
          ) : null}
          {person.meetingLink ? (
            <a
              href={person.meetingLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline decoration-border underline-offset-2 hover:text-foreground"
            >
              {shortLink(person.meetingLink)}
              <IconExternalLink className="size-3" aria-hidden="true" />
            </a>
          ) : (
            <span className="text-amber-700 dark:text-amber-400">
              No meeting link yet
            </span>
          )}
          {detail ? <span>{detail}</span> : null}
        </span>
      }
      control={
        canEdit && !editing ? (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={save.isPending}
              className="text-muted-foreground"
              onClick={() =>
                save.mutate(
                  {
                    email: person.email,
                    displayName: person.displayName,
                    role: null,
                    meetingLink: person.meetingLink,
                  },
                  {
                    onSuccess: () => {
                      toast.success(`Removed ${nameOf(person)} from routing`);
                      onChanged();
                    },
                    onError: (error) => toast.error(actionErrorMessage(error)),
                  },
                )
              }
            >
              Remove
            </Button>
          </div>
        ) : null
      }
    >
      {editing ? (
        <div className="mt-2">
          <PersonForm
            role={role}
            person={person}
            submitLabel="Save"
            onDone={() => {
              setEditing(false);
              onChanged();
            }}
          />
        </div>
      ) : null}
    </SettingsRow>
  );
}

/** The add button and form at the bottom of a group. */
function AddPerson({
  role,
  label,
  canEdit,
  onChanged,
}: {
  role: Role;
  label: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!canEdit) return null;
  return (
    <div className="px-4 py-3">
      {open ? (
        <PersonForm
          role={role}
          submitLabel="Add"
          onDone={() => {
            setOpen(false);
            onChanged();
          }}
        />
      ) : (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <IconPlus className="size-4" aria-hidden="true" />
          {label}
        </Button>
      )}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 py-3 text-[13px] text-muted-foreground">{children}</p>
  );
}

export function RoutingSettings() {
  const query = useActionQuery("list-people", {});
  const data = query.data as PeopleResult | undefined;
  const refresh = () => void query.refetch();
  const people = data?.people ?? [];
  const canEdit = Boolean(data?.canEdit);
  const line = (data?.commercialLine ?? 8000).toLocaleString();
  const commercial = people.filter((person) => person.role === "commercial_ae");
  const enterprise = people.filter((person) => person.role === "ae");
  const pas = people.filter((person) => person.role === "pa");
  const unset = people.filter((person) => !person.role);

  return (
    <section id="lead-routing" className="mx-auto w-full max-w-3xl space-y-4">
      <div>
        <h2 className="text-[16px] font-semibold text-foreground">
          Lead routing
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Who an exceptional lead goes to. Owned by an AE in HubSpot: nothing
          happens in PA, because HubSpot's workflow emails them. Not owned,{" "}
          {line} employees or fewer: the Commercial AE. Not owned and bigger:
          the next Enterprise AE in the round robin. The email carries that
          person's meeting link. An owner counts as an AE once they are listed
          here.{" "}
          <Link
            to="/playbook?section=routing"
            className="text-foreground underline underline-offset-2"
          >
            Change the line in the playbook
          </Link>
        </p>
      </div>

      {query.isPending ? (
        <div className="h-40 animate-pulse rounded-lg border border-border bg-card" />
      ) : (
        <>
          <SettingsGroup
            title="Commercial AE"
            description={`Unowned accounts with ${line} employees or fewer.`}
          >
            {commercial.length === 0 ? (
              <Empty>Not set. Commercial leads wait until one is added.</Empty>
            ) : (
              commercial.map((person) => (
                <PersonRow
                  key={person.email}
                  person={person}
                  role="commercial_ae"
                  icon={<IconBuildingStore className="size-4" />}
                  canEdit={canEdit}
                  onChanged={refresh}
                />
              ))
            )}
            {commercial.length === 0 ? (
              <AddPerson
                role="commercial_ae"
                label="Set the Commercial AE"
                canEdit={canEdit}
                onChanged={refresh}
              />
            ) : null}
          </SettingsGroup>

          <SettingsGroup
            title="Enterprise AEs"
            description="Unowned accounts over the line rotate through these AEs: the one given the fewest leads goes next."
          >
            {enterprise.length === 0 ? (
              <Empty>No Enterprise AEs yet.</Empty>
            ) : (
              enterprise.map((person) => (
                <PersonRow
                  key={person.email}
                  person={person}
                  role="ae"
                  icon={<IconBuildingSkyscraper className="size-4" />}
                  detail={`${person.roundRobinLeads} ${person.roundRobinLeads === 1 ? "lead" : "leads"} from the round robin`}
                  canEdit={canEdit}
                  onChanged={refresh}
                />
              ))
            )}
            <AddPerson
              role="ae"
              label="Add an Enterprise AE"
              canEdit={canEdit}
              onChanged={refresh}
            />
          </SettingsGroup>

          <SettingsGroup
            title="Product Advocates"
            description="Their meeting link goes in the email when the PA takes the call."
          >
            {pas.length === 0 ? (
              <Empty>No PAs set up yet.</Empty>
            ) : (
              pas.map((person) => (
                <PersonRow
                  key={person.email}
                  person={person}
                  role="pa"
                  icon={<IconUser className="size-4" />}
                  canEdit={canEdit}
                  onChanged={refresh}
                />
              ))
            )}
            <AddPerson
              role="pa"
              label="Add a PA"
              canEdit={canEdit}
              onChanged={refresh}
            />
          </SettingsGroup>

          {unset.length > 0 ? (
            <SettingsGroup
              title="Seen on leads, not set up"
              description="Owners PA has seen in HubSpot. Give them a role to use them for routing."
            >
              {unset.map((person) => (
                <UnsetRow
                  key={person.email}
                  person={person}
                  canEdit={canEdit}
                  onChanged={refresh}
                />
              ))}
            </SettingsGroup>
          ) : null}
        </>
      )}
    </section>
  );
}

function UnsetRow({
  person,
  canEdit,
  onChanged,
}: {
  person: Person;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [role, setRole] = useState<Role | null>(null);
  const seen = [
    person.seenAsPa ? `PA on ${person.seenAsPa} leads` : null,
    person.seenAsAccountOwner
      ? `owns ${person.seenAsAccountOwner} accounts`
      : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <SettingsRow
      icon={<IconUserQuestion className="size-4" />}
      label={nameOf(person)}
      description={seen || person.email}
      control={
        canEdit && !role ? (
          <select
            aria-label={`Role for ${nameOf(person)}`}
            className="h-8 rounded-md border border-input bg-background px-2 text-[13px]"
            value=""
            onChange={(event) => setRole((event.target.value || null) as Role)}
          >
            <option value="">Set a role</option>
            <option value="pa">Product Advocate</option>
            <option value="ae">Enterprise AE</option>
            <option value="commercial_ae">Commercial AE</option>
          </select>
        ) : null
      }
    >
      {role ? (
        <div className="mt-2">
          <PersonForm
            role={role}
            person={person}
            submitLabel="Save"
            onDone={() => {
              setRole(null);
              onChanged();
            }}
          />
        </div>
      ) : null}
    </SettingsRow>
  );
}
