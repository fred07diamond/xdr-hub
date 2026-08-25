import {
  navigateWithAgentChatViewTransition,
  useChatThreads,
  type ChatThreadSummary,
} from "@agent-native/core/client/agent-chat";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { useT } from "@agent-native/core/client/i18n";
import { OrgSwitcher } from "@agent-native/core/client/org";
import { FeedbackButton } from "@agent-native/core/client/ui";
import {
  ChatHistoryRail,
  type ChatHistoryItem,
} from "@agent-native/toolkit/chat-history";
import {
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconHierarchy2,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconMessageCircle,
  IconSettings,
  IconShield,
  IconWand,
} from "@tabler/icons-react";
import { useEffect, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { APP_TITLE } from "@/lib/app-config";
import { cn } from "@/lib/utils";

const navItems = [
  {
    icon: IconMessageCircle,
    labelKey: "navigation.chat",
    href: "/",
    view: "chat",
  },
  {
    icon: IconWand,
    labelKey: "navigation.workflow",
    href: "/workflow",
    view: "workflow",
  },
  {
    icon: IconCalendar,
    labelKey: "navigation.meetings",
    href: "/meetings",
    view: "meetings",
  },
  {
    icon: IconHierarchy2,
    labelKey: "settings.agentTitle",
    href: "/agent",
    view: "agent",
  },
  {
    icon: IconSettings,
    labelKey: "navigation.settings",
    href: "/settings",
    view: "settings",
  },
];

const WORKSPACE_APPS = [
  { name: "LinkedIn Agent", badge: "BLI", color: "#0a66c2", href: "/li-agent" },
  { name: "XDR Booking", badge: "BK", color: "#6366f1", href: "/booking" },
  { name: "Dispatch", badge: "XDR", color: "#64748b", href: "/dispatch" },
  { name: "Prospecting Hub", badge: "PRO", color: "#0d9488", href: "/prospecting-hub" },
] as const;

function AppSwitcher({ collapsed }: { collapsed: boolean }) {
  const current = WORKSPACE_APPS[1];
  const others = [WORKSPACE_APPS[0], WORKSPACE_APPS[2], WORKSPACE_APPS[3]];
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
            {/* Must not be a real <a href>: the framework's global chat-home
                click interceptor (document, capture phase) hijacks anchor
                clicks on the chat route and re-runs the path through this
                app's React Router navigate(), which re-prepends this app's
                basename (e.g. "/booking/li-agent" instead of "/li-agent").
                A <button> + window.location.assign bypasses that a[href]
                match entirely. */}
            <button
              type="button"
              onClick={() => window.location.assign(app.href)}
              className="flex items-center gap-2.5"
            >
              <span
                className="shrink-0 rounded px-1 py-0.5 text-[10px] font-black tracking-tight text-white"
                style={{ backgroundColor: app.color }}
              >
                {app.badge}
              </span>
              <span className="flex-1 text-left text-sm">{app.name}</span>
            </button>
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

function persistActiveThreadId(threadId: string) {
  try {
    localStorage.setItem(CHAT_ACTIVE_THREAD_KEY, threadId);
  } catch {}
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

  const visibleThreads = useMemo(
    () =>
      threads
        .filter((thread) => thread.messageCount > 0 && !thread.archivedAt)
        .sort(compareThreads)
        .slice(0, 15),
    [threads],
  );
  const displayedActiveThreadId =
    threadIdFromPath(location.pathname) ??
    (location.pathname === "/" ? null : activeThreadId);
  const chatItems = useMemo<ChatHistoryItem[]>(
    () =>
      visibleThreads.map((thread) => ({
        id: thread.id,
        title: threadTitle(thread),
        titleText: threadTitle(thread),
        timestamp:
          thread.id === displayedActiveThreadId
            ? undefined
            : formatThreadAge(threadUpdatedAt(thread)),
        pinned: Boolean(thread.pinnedAt),
      })),
    [displayedActiveThreadId, visibleThreads],
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

  function openThread(threadId: string, options?: { isNew?: boolean }) {
    switchThread(threadId);
    persistActiveThreadId(threadId);
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

  function handleRenameThread(threadId: string, title: string) {
    void renameThread(threadId, title).then((renamed) => {
      if (!renamed) toast.error(t("chat.renameFailed"));
    });
  }

  return (
    <div className="mt-2 border-s border-sidebar-border/70 ps-3">
      <ChatHistoryRail
        items={chatItems}
        activeId={displayedActiveThreadId}
        onSelect={(threadId) => openThread(threadId)}
        onNewChat={() => void handleNewChat()}
        railLabels={{
          newChat: t("chat.newChat"),
          showMore: t("chat.chats"),
          showLess: t("chat.chats"),
        }}
        renameMaxLength={160}
        onTogglePin={(threadId) => {
          const thread = visibleThreads.find((item) => item.id === threadId);
          if (thread) void pinThread(threadId, !thread.pinnedAt);
        }}
        onRename={handleRenameThread}
        onDelete={(threadId) => void handleArchiveThread(threadId)}
        labels={{
          options: (item) =>
            t("chat.optionsFor", { title: item.titleText ?? "" }),
          renameInput: (item) =>
            t("chat.renameThread", { title: item.titleText ?? "" }),
          rename: t("chat.renameChat"),
          pin: t("chat.pinChat"),
          unpin: t("chat.unpinChat"),
          delete: t("chat.archiveChat"),
        }}
        className="min-w-0"
      />
    </div>
  );
}

function useCurrentUserRole() {
  const { data } = useActionQuery("get-current-user", {});
  return (data as any)?.role as string | undefined;
}

export function Sidebar({
  collapsed = false,
  collapsible = true,
  onCollapsedChange,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const currentRole = useCurrentUserRole();
  const isChatRoute =
    location.pathname === "/" || location.pathname.startsWith("/chat/");
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
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/"
                ? isChatRoute
                : location.pathname.startsWith(item.href);
            const link = (
              <Link
                to={item.href}
                onClick={(event) => {
                  if (
                    item.href === "/" &&
                    !isChatRoute &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    navigateWithAgentChatViewTransition(navigate, "/");
                  }
                }}
                className={navClass({ isActive })}
                aria-current={isActive ? "page" : undefined}
                aria-label={collapsed ? t(item.labelKey) : undefined}
              >
                <Icon className="size-4 shrink-0" />
                <span className={collapsed ? "sr-only" : "truncate"}>
                  {t(item.labelKey)}
                </span>
              </Link>
            );
            return (
              <div key={item.href}>
                {collapsed ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">
                      {t(item.labelKey)}
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
          {currentRole === "admin" && (() => {
            const isActive = location.pathname.startsWith("/admin");
            const adminLabel = t("navigation.admin");
            const adminLink = (
              <Link
                to="/admin"
                className={navClass({ isActive })}
                aria-current={isActive ? "page" : undefined}
                aria-label={collapsed ? adminLabel : undefined}
              >
                <IconShield className="size-4 shrink-0" />
                <span className={collapsed ? "sr-only" : "truncate"}>
                  {adminLabel}
                </span>
              </Link>
            );
            return (
              <div key="/admin">
                {collapsed ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{adminLink}</TooltipTrigger>
                    <TooltipContent side="right">{adminLabel}</TooltipContent>
                  </Tooltip>
                ) : (
                  adminLink
                )}
              </div>
            );
          })()}
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

        {!collapsed ? (
          <div className="flex items-center justify-end gap-1 px-3 py-2">
            <FeedbackButton className="min-w-0 flex-1" side="right" />
            {collapseButton}
          </div>
        ) : collapseButton ? (
          <div className="flex justify-center px-1 py-1">{collapseButton}</div>
        ) : null}
      </div>
    </aside>
  );
}
