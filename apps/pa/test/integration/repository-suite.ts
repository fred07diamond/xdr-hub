// The Drizzle repository against a real database with the real migration SQL.
// The in-memory repository covers the rules; this covers the portable schema
// and the JSON codec (server/db/json.ts). Each dialect runs in its own test
// file, because the framework's database client is a per-process singleton.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { fixedClock, idFactory } from "../helpers.js";

export function defineRepositorySuite(dialect: "sqlite" | "postgres") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pa-${dialect}-`));
  vi.stubEnv(
    "DATABASE_URL",
    dialect === "sqlite"
      ? `file:${path.join(dir, "pa.db")}`
      : `pglite:${path.join(dir, "pg")}`,
  );

  type Modules = {
    repo: import("../../server/core/repo/types.js").PaRepository;
    replay: typeof import("../../server/core/replay/index.js").replaySyntheticCases;
    release: typeof import("../../server/core/playbook/release.js").seedRelease;
    exec: import("@agent-native/core/db").DbExec;
  };
  let m: Modules;

  beforeAll(async () => {
    const db = await import("@agent-native/core/db");
    const { PA_MIGRATIONS, runPaMigrations } =
      await import("../../server/plugins/db.js");
    const exec = db.getDbExec();
    expect(db.isPostgres()).toBe(dialect === "postgres");
    if (dialect === "sqlite") {
      // The real runner over the registered list, exactly as the server boots.
      await (runPaMigrations as unknown as (app: unknown) => Promise<void>)({});
    } else {
      // On Postgres the runner opens and then closes a direct DDL connection,
      // which with in-process PGlite is the same database, so apply the same
      // registered list here. Either way an unregistered migration fails.
      for (const migration of PA_MIGRATIONS) {
        for (const statement of migration.sql
          .split(";")
          .map((part) => part.trim())
          .filter(Boolean)) {
          await exec.execute(statement);
        }
      }
    }
    const { DrizzleRepository } = await import("../../server/db/repository.js");
    m = {
      repo: new DrizzleRepository(),
      replay: (await import("../../server/core/replay/index.js"))
        .replaySyntheticCases,
      release: (await import("../../server/core/playbook/release.js"))
        .seedRelease,
      exec,
    };
  });

  afterAll(async () => {
    const db = await import("@agent-native/core/db");
    await db.closeDbExec();
    fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  async function replayAll() {
    const clock = fixedClock();
    return m.replay({
      repo: m.repo,
      release: m.release,
      now: clock.now,
      newId: idFactory(clock),
      linkUserId: "dev@local.test",
    });
  }

  describe(`DrizzleRepository on ${dialect}`, () => {
    it("replays all seven synthetic cases with outcomes matching their labels", async () => {
      const results = await replayAll();
      expect(results).toHaveLength(7);
      for (const result of results) {
        expect(result.pipeline, result.caseId).toBe("done");
        expect(result.matches, result.caseId).toEqual({
          precheck: true,
          route: true,
          verdict: true,
        });
      }
    });

    it("is idempotent on the real unique indexes", async () => {
      const count = async (table: string) =>
        Number(
          (await m.exec.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0]
            .n,
        );
      const before = {
        e: await count("pa_engagements"),
        r: await count("pa_receipts"),
        i: await count("pa_inbox"),
      };
      await replayAll();
      expect({
        e: await count("pa_engagements"),
        r: await count("pa_receipts"),
        i: await count("pa_inbox"),
      }).toEqual(before);
    });

    it("stores JSON as text and reads it back as objects", async () => {
      const [engagement] = await m.repo.listEngagements();
      const receipts = await m.repo.listReceipts(engagement.id);
      expect(receipts.length).toBeGreaterThan(0);
      for (const receipt of receipts) {
        expect(Array.isArray(receipt.entryVersions)).toBe(true);
        expect(typeof receipt.ruleResults).toBe("object");
        expect(typeof receipt.inputs).toBe("object");
      }
      expect(Array.isArray(engagement.reviewFlags)).toBe(true);
      const events = await m.repo.listEvents(engagement.id);
      expect(
        events.every(
          (event) =>
            typeof event.payload === "object" && event.payload !== null,
        ),
      ).toBe(true);

      const raw = await m.exec.execute(
        `SELECT entry_versions FROM pa_receipts LIMIT 1`,
      );
      expect(typeof raw.rows[0].entry_versions).toBe("string");
    });

    it("allows only one open engagement per contact, and frees the slot when it closes", async () => {
      const [existing] = (await m.repo.listEngagements()).filter(
        (item) => !["recycled", "disqualified", "closed"].includes(item.state),
      );
      const duplicate = { ...existing, id: `${existing.id}-dup`, version: 1 };
      await expect(m.repo.insertEngagement(duplicate)).rejects.toThrow();
      const closed = await m.repo.updateEngagement(
        existing.id,
        { state: "closed" },
        existing.version,
      );
      await m.repo.insertEngagement({
        ...duplicate,
        createdAt: closed.updatedAt,
      });
      const raw = await m.exec.execute({
        sql: `SELECT id, open_contact_id FROM pa_engagements WHERE contact_id = ?`,
        args: [existing.contactId],
      });
      const byId = Object.fromEntries(
        raw.rows.map((row) => [row.id, row.open_contact_id]),
      );
      expect(byId[existing.id]).toBeNull();
      expect(byId[duplicate.id]).toBe(existing.contactId);
    });

    it("runs a playbook change from draft to the active release", async () => {
      const changes = await import("../../server/core/playbook/changes.js");
      const { replayImpact } =
        await import("../../server/core/playbook/impact.js");
      const { activeRelease } =
        await import("../../server/core/playbook/store.js");
      const clock = fixedClock();
      const deps = { repo: m.repo, now: clock.now, newId: idFactory(clock) };
      const team = {
        teamOf: async (email: string) =>
          email === "ops@example.com"
            ? ("admin" as const)
            : email === "pa@example.com"
              ? ("pa_team" as const)
              : null,
        isAppOwner: async () => false,
        hasMembers: async () => true,
      };
      const pa = { email: "pa@example.com", caller: "frontend" };
      const ops = { email: "ops@example.com", caller: "frontend" };
      const seed = await activeRelease(m.repo, clock.now());
      const entry = seed.entries.find(
        (item) => item.id === "rule.precheck.restricted_countries",
      )!;
      const change = await changes.proposeChange(deps, team, pa, {
        title: "Restricted countries",
        rationale: "xDR Playbook",
        items: [
          {
            target: entry.id,
            op: "update",
            after: { ...entry, params: { countries: ["CU", "IR"] } },
          },
        ],
      });
      await changes.checkPlaybookChange(deps, {
        changeId: change.id,
        impact: replayImpact,
      });
      await changes.submitChange(deps, team, pa, change.id);
      await changes.reviewChange(deps, team, ops, {
        changeId: change.id,
        team: "admin",
        decision: "approve",
      });
      const published = await changes.publishChange(deps, ops, change.id);

      const active = await activeRelease(m.repo, clock.now());
      expect(active.id).toBe(published.release.id);
      expect((await m.repo.getLabel("active"))?.movedBy).toBe(
        "ops@example.com",
      );
      expect((await m.repo.listReleases(10)).map((item) => item.id)).toEqual(
        expect.arrayContaining([seed.id, active.id]),
      );

      const created = await changes.recordFindings(deps, published.findings, {
        releaseId: active.id,
        changeId: change.id,
      });
      const again = await changes.recordFindings(deps, published.findings, {
        releaseId: active.id,
        changeId: change.id,
      });
      expect(again).toHaveLength(0);
      expect(
        (await m.repo.listSuggestions({ statuses: ["open"], limit: 100 }))
          .length,
      ).toBe(created.length);
    });

    it("stores the CRM schema snapshot and reads it back, replacing on refresh", async () => {
      const { loadPortalSchema, storePortalObject } =
        await import("../../server/lib/crm-schema.js");
      expect(await loadPortalSchema()).toBeNull();
      const property = {
        name: "notes_last_updated",
        label: "Last Activity Date",
        type: "datetime",
        fieldType: "date",
        groupName: null,
        description: null,
        options: [],
        hubspotDefined: true,
        calculated: false,
        readOnlyValue: true,
        referencedObjectType: null,
        hidden: false,
      };
      await storePortalObject(
        "contacts",
        [property],
        "ops@example.com",
        "2026-09-30T17:00:00.000Z",
      );
      await storePortalObject(
        "contacts",
        [property, { ...property, name: "firstname", type: "string" }],
        "ops@example.com",
        "2026-09-30T18:00:00.000Z",
      );
      const portal = await loadPortalSchema();
      expect(portal?.objects.contacts?.map((item) => item.name)).toEqual([
        "notes_last_updated",
        "firstname",
      ]);
      expect(portal?.fetchedAt).toBe("2026-09-30T18:00:00.000Z");
    });

    it("imports, edits, and versions handbook docs, refusing a stale edit", async () => {
      const { importDocs, saveDoc } =
        await import("../../server/core/handbook/index.js");
      const clock = fixedClock();
      const deps = { repo: m.repo, now: clock.now, newId: idFactory(clock) };
      const files = [
        {
          name: "00_README.md",
          content: "# Pack\n\n| 01_a.md | Doc A summary |",
        },
        { name: "01_a.md", content: "# 01. Doc A\n\nFirst body." },
      ];
      expect(
        await importDocs(deps, {
          actor: "fred@example.com",
          files,
          source: null,
        }),
      ).toEqual({ added: ["00-readme", "01-a"], updated: [], unchanged: [] });
      const doc = await m.repo.getHandbookDoc("01-a");
      expect(doc).toMatchObject({
        title: "Doc A",
        summary: "Doc A summary",
        position: 1,
        version: 1,
      });
      const saved = await saveDoc(deps, {
        actor: "fred@example.com",
        id: "01-a",
        expectedVersion: 1,
        body: "# 01. Doc A\n\nSecond body.",
        note: "tightened",
      });
      expect(saved.version).toBe(2);
      await expect(
        saveDoc(deps, {
          actor: "someone@example.com",
          id: "01-a",
          expectedVersion: 1,
          body: "stale edit",
        }),
      ).rejects.toThrow(/Someone saved this doc/);
      const revisions = await m.repo.listHandbookRevisions("01-a");
      expect(revisions.map((item) => [item.version, item.note])).toEqual([
        [2, "tightened"],
        [1, "Imported"],
      ]);
      expect((await m.repo.listHandbookDocs()).map((item) => item.id)).toEqual([
        "00-readme",
        "01-a",
      ]);
    });

    it("keeps people and route overrides (D66), last write wins", async () => {
      const at = "2026-09-30T12:00:00.000Z";
      await m.repo.upsertPerson({
        email: "PA@Example.com",
        displayName: "Pat",
        role: "pa",
        meetingLink: "https://meetings.example.com/pat",
        podAeEmail: "ae@example.com",
        updatedBy: "someone@example.com",
        createdAt: at,
        updatedAt: at,
      });
      await m.repo.upsertPerson({
        email: "pa@example.com",
        displayName: "Pat",
        role: "pa",
        meetingLink: "https://meetings.example.com/pat-2",
        podAeEmail: null,
        updatedBy: "someone@example.com",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      });
      const people = await m.repo.listPeople();
      expect(people).toHaveLength(1);
      expect(people[0]).toMatchObject({
        email: "pa@example.com",
        meetingLink: "https://meetings.example.com/pat-2",
        podAeEmail: null,
        createdAt: at,
      });

      const [engagement] = await m.repo.listEngagements();
      await m.repo.setRouteOverride({
        engagementId: engagement.id,
        route: "pa_meeting",
        note: null,
        setBy: "someone@example.com",
        setAt: at,
      });
      await m.repo.setRouteOverride({
        engagementId: engagement.id,
        route: "route_to_ae",
        note: "enterprise after all",
        setBy: "someone@example.com",
        setAt: at,
      });
      expect((await m.repo.getRouteOverride(engagement.id))?.route).toBe(
        "route_to_ae",
      );
      expect(await m.repo.listRouteOverrides()).toHaveLength(1);
      await m.repo.clearRouteOverride(engagement.id);
      expect(await m.repo.getRouteOverride(engagement.id)).toBeNull();

      // The round robin keeps the first pick for a lead (D78).
      const pick = {
        engagementId: engagement.id,
        aeEmail: "ent-a@example.com",
        method: "round_robin" as const,
        assignedAt: at,
      };
      expect(await m.repo.insertAeAssignmentIfAbsent(pick)).toBe(true);
      expect(
        await m.repo.insertAeAssignmentIfAbsent({
          ...pick,
          aeEmail: "ent-b@example.com",
        }),
      ).toBe(false);
      expect((await m.repo.getAeAssignment(engagement.id))?.aeEmail).toBe(
        "ent-a@example.com",
      );
      expect(await m.repo.listAeAssignments()).toHaveLength(1);
    });

    it("fails loudly on a corrupt JSON column instead of passing a string on", async () => {
      const [engagement] = await m.repo.listEngagements();
      await m.exec.execute({
        sql: `UPDATE pa_engagements SET review_flags = ? WHERE id = ?`,
        args: ["{not json", engagement.id],
      });
      await expect(m.repo.getEngagement(engagement.id)).rejects.toThrow(
        "pa_engagements.reviewFlags holds invalid JSON",
      );
    });
  });
}
