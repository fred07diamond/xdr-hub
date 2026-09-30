import { useActionQuery } from "@agent-native/core/client/hooks";
import { openCommandMenu } from "@agent-native/core/client/navigation";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  IconActivityHeartbeat,
  IconInbox,
  IconSearch,
  IconSettings,
  IconTags,
  type Icon,
} from "@tabler/icons-react";
import { Link, NavLink } from "react-router";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { APP_TITLE } from "@/lib/app-config";
import { useDemoMode } from "@/lib/demo-mode";
import { cn } from "@/lib/utils";

import { ReleaseChip, ShadowPill } from "./badges";
import { DemoPill } from "./demo";

const NAV: Array<{ to: string; label: string; icon: Icon; hint?: string }> = [
  { to: "/inbound", label: "Inbound", icon: IconInbox },
  { to: "/labels", label: "Labels", icon: IconTags, hint: "Planned" },
  { to: "/ops", label: "Ops", icon: IconActivityHeartbeat, hint: "Planned" },
  { to: "/settings", label: "Settings", icon: IconSettings },
];

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-ink text-[11px] font-bold tracking-[-0.04em] text-ink-foreground",
        className,
      )}
    >
      PA
    </span>
  );
}

function StatusFooter() {
  const status = useActionQuery("get-pa-status", {}, { staleTime: 5 * 60_000 });
  const demo = useDemoMode();
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
      <ShadowPill />
      {demo ? <DemoPill /> : null}
      {status.data ? (
        <ReleaseChip shortId={status.data.release.shortId} />
      ) : status.isPending ? (
        <span
          className="h-[22px] w-[88px] rounded-[5px] border border-dashed border-border"
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}

export function PaNav() {
  return (
    <aside className="flex h-full min-w-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <Link
          to="/inbound"
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <BrandMark />
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-semibold leading-tight text-sidebar-accent-foreground">
              {APP_TITLE}
            </span>
            <span className="block truncate text-[11px] leading-tight text-sidebar-foreground">
              Product Advocates
            </span>
          </span>
        </Link>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={openCommandMenu}
              aria-label="Search and commands"
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <IconSearch className="size-4" strokeWidth={1.8} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Search and commands</TooltipContent>
        </Tooltip>
      </div>

      <nav
        aria-label="Main navigation"
        className="flex-1 space-y-0.5 overflow-y-auto px-2 pt-2"
      >
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "group flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                isActive
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )
            }
          >
            <item.icon
              className="size-[18px] shrink-0"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <span className="flex-1 truncate">{item.label}</span>
            {item.hint ? (
              <span className="rounded-[4px] border border-sidebar-border px-1 text-[10.5px] font-normal text-sidebar-foreground/80">
                {item.hint}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      <div className="shrink-0 border-t border-sidebar-border pt-2.5">
        <StatusFooter />
        <div className="px-2 pb-2">
          <OrgSwitcher
            reserveSpace
            currentAppId="pa"
            className="h-10 w-full min-w-0 rounded-md bg-transparent px-2.5 py-2 text-[13px] text-sidebar-accent-foreground hover:bg-sidebar-accent"
          />
        </div>
      </div>
    </aside>
  );
}
