import {
  AgentChatSurface,
  markAgentChatHomeHandoff,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router";

import { APP_TITLE } from "@/lib/app-config";
import { TAB_ID } from "@/lib/tab-id";

const SEO_TITLE = `${APP_TITLE} - Open Source AI app starter with actions`;
const SEO_DESCRIPTION =
  "Open Source starter for agent-native apps with durable chat, shared actions, UI state, tools, and a backend your agent can extend.";

export function meta() {
  return [
    { title: SEO_TITLE },
    {
      name: "description",
      content: SEO_DESCRIPTION,
    },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

function chatThreadPath(threadId: string | null) {
  return threadId ? `/chat/${encodeURIComponent(threadId)}` : "/";
}

export default function ChatRoute() {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();
  const threadUrlSync = threadId
    ? {
        routeThreadId: threadId,
        getPath: chatThreadPath,
        navigate,
      }
    : undefined;

  useEffect(() => {
    function handleChatRunning(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.isRunning === true) markAgentChatHomeHandoff("chat");
    }

    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    return () =>
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
  }, []);

  // `location.key` is React Router's built-in marker for "this is the entry
  // that existed before any client-side navigation happened in this
  // session" — it's literally the string "default" for that entry and a
  // fresh random value for every subsequent push/replace. That lets us tell
  // "user just opened the app at bare /" (fresh doc load or a hard refresh)
  // apart from "user clicked the Chat item in the sidebar", which performs a
  // client-side navigate() to "/" and therefore always gets a non-"default"
  // key. Only the former should bounce to /contacts; the latter must keep
  // rendering chat so Chat stays fully reachable from the sidebar. This only
  // applies to the bare "/" path (no threadId) — direct/bookmarked links to
  // a specific thread at /chat/:threadId are never redirected.
  if (!threadId && location.key === "default") {
    return <Navigate to="/contacts" replace />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AgentChatSurface
        mode="page"
        chatViewTransition
        className="h-full"
        defaultMode="chat"
        storageKey="chat"
        threadUrlSync={threadUrlSync}
        browserTabId={TAB_ID}
        showHeader={false}
        showTabBar={false}
        dynamicSuggestions={false}
        suggestions={[
          t("chat.suggestionCapabilities"),
          t("chat.suggestionCustomize"),
          t("chat.suggestionActions"),
        ]}
        emptyStateText={t("chat.emptyState")}
        emptyStateDisplay="hidden"
        centerComposerWhenEmpty
        composerLayoutVariant="hero"
        composerPlaceholder={t("chat.composerPlaceholder")}
        composerSlot={
          <div className="mx-auto mb-5 max-w-xl px-4 text-center">
            <h1 className="text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
              {t("chat.heroTitle")}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t("chat.heroDescription")}
            </p>
          </div>
        }
      />
    </div>
  );
}
