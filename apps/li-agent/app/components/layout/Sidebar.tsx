import {
  appPath,
  navigateWithAgentChatViewTransition,
  useChatThreads,
  useT,
  type ChatThreadSummary,
} from "@agent-native/core/client";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { OrgSwitcher, useOrgRole } from "@agent-native/core/client/org";
import {
  IconArchive,
  IconChartBar,
  IconCheck,
  IconChevronDown,
  IconDots,
  IconEdit,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconActivity,
  IconListCheck,
  IconMessages,
  IconPin,
  IconPlus,
  IconSettings,
  IconTarget,
  IconUsers,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type ComponentType, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { APP_TITLE } from "@/lib/app-config";
import { cn } from "@/lib/utils";

const navItems: Array<{
  icon: ComponentType<{ className?: string }>;
  labelKey: string;
  label?: string;
  href: string;
  view: string;
}> = [
  { icon: IconUsers, labelKey: "navigation.prospects", href: "/", view: "prospects" },
  { icon: IconListCheck, labelKey: "navigation.queue", label: "Queue", href: "/queue", view: "queue" },
  { icon: IconTarget, labelKey: "navigation.icp", href: "/icp", view: "icp" },
  { icon: IconMessages, labelKey: "navigation.messaging", href: "/messaging", view: "messaging" },
  { icon: IconActivity, labelKey: "navigation.engagement", label: "Engagement", href: "/engagement", view: "engagement" },
  { icon: IconChartBar, labelKey: "navigation.analytics", href: "/analytics", view: "analytics" },
  { icon: IconSettings, labelKey: "navigation.settings", href: "/settings", view: "settings" },
];

const WORKSPACE_APPS = [
  { name: "LinkedIn Agent", badge: "BLI", color: "#0a66c2", href: "/li-agent" },
  { name: "XDR Booking", badge: "BK", color: "#6366f1", href: "/booking" },
  { name: "Dispatch", badge: "XDR", color: "#64748b", href: "/dispatch" },
  { name: "Prospecting Hub", badge: "PH", color: "#f97316", href: "/prospecting-hub" },
] as const;

function AppSwitcher({ collapsed }: { collapsed: boolean }) {
  const current = WORKSPACE_APPS[0];
  const others = WORKSPACE_APPS.slice(1);
  const trigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        className={cn(
          "flex min-w-0 items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-sidebar-accent/50 transition-colors",
          collapsed ? "size-7 justify-center" : "flex-1 gap-3 px-0.5 py-0.5",
        )}
        aria-label={collapsed ? `Switch app (${current.name})` : undefined}
      >
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-black tracking-tight text-white"
          style={{ backgroundColor: current.color }}
        >
          {current.badge}
        </span>
        <span className={cn("flex min-w-0 flex-1 items-center gap-1", collapsed && "sr-only")}>
          <span className="truncate text-sm font-semibold text-sidebar-accent-foreground">
            {APP_TITLE}
          </span>
          <IconChevronDown className="size-3.5 shrink-0 text-sidebar-foreground/50" />
        </span>
      </button>
    </DropdownMenuTrigger>
  );
  return (
    <DropdownMenu>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right">Switch app</TooltipContent>
        </Tooltip>
      ) : trigger}
      <DropdownMenuContent align="start" side="bottom" sideOffset={8} className="w-52">
        <DropdownMenuItem className="gap-2.5 opacity-50 cursor-default" disabled>
          <span
            className="shrink-0 rounded px-1 py-0.5 text-[10px] font-black tracking-tight text-white"
            style={{ backgroundColor: current.color }}
          >
            {current.badge}
          </span>
          <span className="flex-1 text-sm">{current.name}</span>
          <IconCheck className="size-3.5 shrink-0" />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {others.map((app) => (
          <DropdownMenuItem key={app.href} asChild>
            <a href={app.href} className="flex items-center gap-2.5">
              <span
                className="shrink-0 rounded px-1 py-0.5 text-[10px] font-black tracking-tight text-white"
                style={{ backgroundColor: app.color }}
              >
                {app.badge}
              </span>
              <span className="flex-1 text-sm">{app.name}</span>
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const CHAT_STORAGE_KEY = "chat";
const CHAT_ACTIVE_THREAD_KEY = `agent-chat-active-thread:${CHAT_STORAGE_KEY}`;

interface SidebarProps {
  collapsed?: boolean;
  collapsible?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

function formatThreadAge(updatedAt: number) {
  const diffMs = Math.max(0, Date.now() - updatedAt);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(updatedAt).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function threadTitle(thread: ChatThreadSummary) {
  return thread.title || thread.preview || "Untitled chat";
}

function threadUpdatedAt(thread: ChatThreadSummary) {
  return Number.isFinite(thread.updatedAt)
    ? thread.updatedAt
    : Number.isFinite(thread.createdAt)
      ? thread.createdAt
      : 0;
}

function compareThreads(a: ChatThreadSummary, b: ChatThreadSummary) {
  const aPinned = a.pinnedAt ?? 0;
  const bPinned = b.pinnedAt ?? 0;
  if (aPinned || bPinned) return bPinned - aPinned;
  return threadUpdatedAt(b) - threadUpdatedAt(a);
}

function persistedActiveThreadId() {
  try {
    return localStorage.getItem(CHAT_ACTIVE_THREAD_KEY);
  } catch {
    return null;
  }
}

function threadIdFromPath(pathname: string) {
  const match = pathname.match(/^\/chat\/([^/]+)/);
  if (!match) return null;
  try {
    const value = decodeURIComponent(match[1]).trim();
    return value || null;
  } catch {
    return null;
  }
}

function chatThreadPath(threadId: string) {
  return `/chat/${encodeURIComponent(threadId)}`;
}

function ChatThreadsSection() {
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();
  const {
    threads,
    activeThreadId,
    createThread,
    switchThread,
    pinThread,
    archiveThread,
    renameThread,
    refreshThreads,
  } = useChatThreads(undefined, CHAT_STORAGE_KEY, undefined, {
    autoCreate: false,
    restoreActiveThread: false,
  });
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const committingRenameRef = useRef(false);

  const visibleThreads = useMemo(
    () =>
      threads
        .filter((thread) => thread.messageCount > 0 && !thread.archivedAt)
        .sort(compareThreads)
        .slice(0, 12),
    [threads],
  );

  useEffect(() => {
    const refresh = () => refreshThreads();
    const handleRunning = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { isRunning?: unknown }
        | undefined;
      if (typeof detail?.isRunning === "boolean") refreshThreads();
    };

    window.addEventListener("agent-chat:threads-updated", refresh);
    window.addEventListener("agentNative.chatRunning", handleRunning);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("agent-chat:threads-updated", refresh);
      window.removeEventListener("agentNative.chatRunning", handleRunning);
      window.removeEventListener("focus", refresh);
    };
  }, [refreshThreads]);

  useEffect(() => {
    if (!renamingThreadId) return;
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [renamingThreadId]);

  function openThread(threadId: string, options?: { isNew?: boolean }) {
    switchThread(threadId);
    navigateWithAgentChatViewTransition(
      navigate,
      options?.isNew ? "/" : chatThreadPath(threadId),
    );
    window.requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: { threadId, newThread: options?.isNew === true },
        }),
      );
    });
  }

  async function handleNewChat() {
    const threadId = await createThread();
    if (threadId) openThread(threadId, { isNew: true });
  }

  async function handleArchiveThread(threadId: string) {
    const wasActive =
      threadId === activeThreadId || threadId === persistedActiveThreadId();
    const archived = await archiveThread(threadId);
    if (!archived) {
      toast.error(t("chat.archiveFailed"));
      return;
    }
    if (wasActive) {
      await handleNewChat();
    }
  }

  function startRenameThread(thread: ChatThreadSummary) {
    committingRenameRef.current = false;
    setRenameDraft(threadTitle(thread));
    setRenamingThreadId(thread.id);
  }

  function cancelRenameThread() {
    committingRenameRef.current = true;
    setRenamingThreadId(null);
    setRenameDraft("");
  }

  async function commitRenameThread() {
    if (committingRenameRef.current) return;
    const threadId = renamingThreadId;
    const title = renameDraft.trim();
    if (!threadId) return;
    committingRenameRef.current = true;
    setRenamingThreadId(null);
    setRenameDraft("");
    if (title) {
      const renamed = await renameThread(threadId, title);
      if (!renamed) toast.error(t("chat.renameFailed"));
    }
    committingRenameRef.current = false;
  }

  function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void commitRenameThread();
  }

  return (
    <div className="mt-2 border-s border-sidebar-border/70 ps-3">
      <div className="mb-1 flex h-7 items-center gap-2 pe-1">
        <div className="min-w-0 flex-1 text-xs font-medium text-sidebar-foreground/70">
          {t("chat.chats")}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleNewChat}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              aria-label={t("chat.newChat")}
            >
              <IconPlus className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("chat.newChat")}</TooltipContent>
        </Tooltip>
      </div>
      <div className="grid gap-0.5">
        {visibleThreads.map((thread) => {
          const isActive =
            thread.id ===
            (threadIdFromPath(location.pathname) ??
              (location.pathname === "/" ? null : activeThreadId));
          const isRenaming = thread.id === renamingThreadId;
          return (
            <div
              key={thread.id}
              className={cn(
                "group flex h-8 min-w-0 items-center rounded-md text-sm transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
              )}
            >
              {isRenaming ? (
                <form
                  onSubmit={handleRenameSubmit}
                  className="flex h-full min-w-0 flex-1 items-center px-1.5"
                >
                  <Input
                    ref={renameInputRef}
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onBlur={() => void commitRenameThread()}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelRenameThread();
                      }
                    }}
                    maxLength={160}
                    aria-label={t("chat.renameThread", {
                      title: threadTitle(thread),
                    })}
                    className="h-6 min-w-0 rounded-sm border-sidebar-border bg-background px-1.5 text-xs"
                  />
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => openThread(thread.id)}
                    className="flex h-full min-w-0 flex-1 items-center px-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {threadTitle(thread)}
                    </span>
                  </button>
                  <div className="relative flex size-7 shrink-0 items-center justify-end pe-1">
                    <span className="text-[11px] text-sidebar-foreground/50 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                      {isActive ? "" : formatThreadAge(threadUpdatedAt(thread))}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={t("chat.optionsFor", {
                            title: threadTitle(thread),
                          })}
                          className="absolute end-1 flex size-6 items-center justify-center rounded-md text-sidebar-foreground/65 opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
                        >
                          <IconDots className="size-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        side="right"
                        sideOffset={6}
                      >
                        <DropdownMenuItem
                          onSelect={() => startRenameThread(thread)}
                        >
                          <IconEdit className="size-4" />
                          {t("chat.renameChat")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            void pinThread(thread.id, !thread.pinnedAt)
                          }
                        >
                          <IconPin className="size-4" />
                          {thread.pinnedAt
                            ? t("chat.unpinChat")
                            : t("chat.pinChat")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:bg-destructive focus:text-destructive-foreground"
                          onSelect={() => void handleArchiveThread(thread.id)}
                        >
                          <IconArchive className="size-4" />
                          {t("chat.archiveChat")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Sidebar({
  collapsed = false,
  collapsible = true,
  onCollapsedChange,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const { canManageOrg } = useOrgRole();
  const visibleNavItems = navItems.filter(
    (item) => item.view !== "analytics" || canManageOrg,
  );
  const isChatRoute =
    location.pathname === "/chat" || location.pathname.startsWith("/chat/");
  const ToggleIcon = collapsed
    ? IconLayoutSidebarLeftExpand
    : IconLayoutSidebarLeftCollapse;
  const navClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex items-center text-sm transition-colors",
      collapsed
        ? "relative h-10 w-full justify-center rounded-none border-s-2 px-0"
        : "h-9 rounded-md gap-3 px-3",
      isActive
        ? collapsed
          ? "border-s-sidebar-accent-foreground/80 bg-sidebar-accent text-sidebar-accent-foreground"
          : "bg-sidebar-accent text-sidebar-accent-foreground"
        : collapsed
          ? "border-s-transparent text-sidebar-foreground/70 hover:bg-sidebar-accent/55 hover:text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
    );
  const collapseButton = collapsible ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onCollapsedChange?.(!collapsed)}
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed ? "size-8" : "size-7",
          )}
          aria-label={
            collapsed
              ? t("navigation.expandSidebar")
              : t("navigation.collapseSidebar")
          }
        >
          <ToggleIcon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {collapsed
          ? t("navigation.expandSidebar")
          : t("navigation.collapseSidebar")}
      </TooltipContent>
    </Tooltip>
  ) : null;

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-e border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
        collapsed ? "w-12" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center border-b border-sidebar-border",
          collapsed ? "h-12 justify-center px-0" : "h-14 px-3",
        )}
      >
        <AppSwitcher collapsed={collapsed} />
      </div>

      <nav
        className={cn(
          "flex-1 overflow-y-auto",
          collapsed ? "px-0 py-2" : "px-2 py-3",
        )}
      >
        <div className={cn("grid", collapsed ? "gap-0" : "gap-1")}>
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/"
                ? location.pathname === "/"
                : item.href === "/chat"
                  ? isChatRoute
                  : location.pathname.startsWith(item.href);
            const link = (
              <Link
                to={item.href}
                onClick={(event) => {
                  if (
                    item.href === "/chat" &&
                    !isChatRoute &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    navigateWithAgentChatViewTransition(navigate, "/chat");
                  }
                }}
                className={navClass({ isActive })}
                aria-current={isActive ? "page" : undefined}
                aria-label={collapsed ? (item.label ?? t(item.labelKey)) : undefined}
              >
                <Icon className="size-4 shrink-0" />
                <span className={collapsed ? "sr-only" : "truncate"}>
                  {item.label ?? t(item.labelKey)}
                </span>
              </Link>
            );
            return (
              <div key={item.href}>
                {collapsed ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">
                      {item.label ?? t(item.labelKey)}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  link
                )}
                {!collapsed && item.view === "chat" && isChatRoute ? (
                  <ChatThreadsSection />
                ) : null}
              </div>
            );
          })}
        </div>
      </nav>

      <div className={cn("mt-auto shrink-0", collapsed && "py-2")}>
        {!collapsed ? (
          <div className="px-2 py-1">
            <ExtensionsSidebarSection />
          </div>
        ) : null}

        <div className={cn(collapsed ? "px-1 py-1" : "px-3 py-2")}>
          <OrgSwitcher
            reserveSpace
            className={
              collapsed
                ? "h-8 justify-center px-0 [&>span]:sr-only [&>svg:last-child]:hidden"
                : undefined
            }
          />
        </div>

        {collapseButton ? (
          <div
            className={cn(
              collapsed
                ? "flex justify-center px-1 py-1"
                : "flex justify-end px-3 py-2",
            )}
          >
            {collapseButton}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
