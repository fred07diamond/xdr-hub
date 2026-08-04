import { useActionQuery } from "@agent-native/core/client";
import { IconSparkles } from "@tabler/icons-react";
import { useState } from "react";

import { ContactsTable } from "@/components/ContactsTable";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `${APP_TITLE} — Contacts` }];
}

export default function ContactsRoute() {
  // Lifted from ContactsTable via onStatsChange so this page-level header
  // can keep reporting the same total/loading state the table's own
  // (filtered/paginated) list-contacts query already has, without this
  // route running a second, separate, unfiltered query just for a count.
  const [tableStats, setTableStats] = useState<{ total: number; isLoading: boolean }>({
    total: 0,
    isLoading: true,
  });

  const { data: homeStatsData } = useActionQuery("get-contacts-home-stats", {}, {
    refetchInterval: 60000,
    staleTime: 30000,
  });
  const homeStats = homeStatsData as { newTodayCount: number } | undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-foreground">Contacts</h1>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            <IconSparkles size={11} />
            {homeStats ? `${homeStats.newTodayCount.toLocaleString()} new today` : "…"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {tableStats.isLoading
            ? "Loading…"
            : tableStats.total === 0
              ? "No contacts synced yet"
              : `${tableStats.total.toLocaleString()} contact${tableStats.total === 1 ? "" : "s"} across HubSpot and CommonRoom`}
        </p>
      </div>

      <ContactsTable onStatsChange={setTableStats} />
    </div>
  );
}
