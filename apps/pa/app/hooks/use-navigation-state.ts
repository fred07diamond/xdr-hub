import { appBasePath, appPath } from "@agent-native/core/client/api-path";
import { useAgentRouteState } from "@agent-native/core/client/navigation";

import { TAB_ID } from "@/lib/tab-id";

export interface NavigationState {
  view: string;
  path?: string;
  engagementId?: string;
  changeId?: string;
  docId?: string;
  filters?: { tab: string; state?: string };
  threadId?: string;
}

interface NavigateCommand {
  view?: string;
  path?: string;
  engagementId?: string;
  changeId?: string;
  docId?: string;
  tab?: string;
  state?: string;
  threadId?: string;
}

export function useNavigationState() {
  useAgentRouteState<NavigationState, NavigateCommand>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,
    getNavigationState: ({ pathname, searchParams }) => {
      const state: NavigationState = {
        view: viewForPath(pathname),
        path: appPath(pathname),
      };
      const engagementId = matchOne(pathname, /^\/inbound\/([^/]+)/);
      if (engagementId) state.engagementId = engagementId;
      const changeId = matchOne(pathname, /^\/playbook\/changes\/([^/]+)/);
      if (changeId) state.changeId = changeId;
      if (state.view === "handbook") {
        const docId = searchParams.get("doc");
        if (docId) state.docId = docId;
      }
      if (state.view === "inbound") {
        const tab = searchParams.get("tab") ?? "mine";
        const filterState = searchParams.get("state");
        state.filters = filterState ? { tab, state: filterState } : { tab };
      }
      const threadId = matchOne(pathname, /^\/chat\/([^/]+)/);
      if (threadId) state.threadId = threadId;
      return state;
    },
    getCommandPath: (command) =>
      routerPath(command.path || pathForCommand(command)),
  });
}

function matchOne(pathname: string, pattern: RegExp): string | null {
  const match = pathname.match(pattern);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).trim() || null;
  } catch {
    return null;
  }
}

function viewForPath(pathname: string): string {
  if (/^\/inbound\/[^/]+/.test(pathname)) return "engagement";
  if (pathname.startsWith("/inbound")) return "inbound";
  if (pathname.startsWith("/labels")) return "labels";
  if (pathname.startsWith("/ops")) return "ops";
  if (/^\/playbook\/changes\/[^/]+/.test(pathname)) return "playbook-change";
  if (pathname.startsWith("/playbook")) return "playbook";
  if (pathname.startsWith("/suggestions")) return "suggestions";
  if (pathname.startsWith("/handbook")) return "handbook";
  if (pathname.startsWith("/crm")) return "crm";
  if (pathname === "/home" || pathname.startsWith("/chat/")) return "agent";
  if (pathname.startsWith("/database")) return "database";
  if (pathname.startsWith("/extensions")) return "extensions";
  if (pathname.startsWith("/observability")) return "observability";
  if (
    pathname.startsWith("/settings") ||
    pathname.startsWith("/team") ||
    pathname.startsWith("/agent")
  ) {
    return "settings";
  }
  return "inbound";
}

function pathForCommand(command: NavigateCommand): string {
  switch (command.view) {
    case "engagement":
      return command.engagementId
        ? `/inbound/${encodeURIComponent(command.engagementId)}`
        : "/inbound";
    case "labels":
      return "/labels";
    case "playbook":
      return "/playbook";
    case "playbook-change":
      return command.changeId
        ? `/playbook/changes/${encodeURIComponent(command.changeId)}`
        : "/playbook";
    case "suggestions":
      return "/suggestions";
    case "handbook":
      return command.docId
        ? `/handbook?doc=${encodeURIComponent(command.docId)}`
        : "/handbook";
    case "crm":
      return "/crm";
    case "ops":
      return "/ops";
    case "settings":
      return "/settings";
    case "agent":
      return command.threadId
        ? `/chat/${encodeURIComponent(command.threadId)}`
        : "/home";
    default: {
      const params = new URLSearchParams();
      if (command.tab) params.set("tab", command.tab);
      if (command.state) params.set("state", command.state);
      const query = params.toString();
      return query ? `/inbound?${query}` : "/inbound";
    }
  }
}

function routerPath(path: string): string {
  const basePath = appBasePath();
  if (!basePath) return path;
  if (path === basePath) return "/";
  if (path.startsWith(`${basePath}/`)) {
    return path.slice(basePath.length) || "/";
  }
  return path;
}
