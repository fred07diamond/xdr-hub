import {
  AgentChatSurface,
  markAgentChatHomeHandoff,
  sendToAgentChat,
} from "@agent-native/core/client";
import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router";

import { APP_TITLE } from "@/lib/app-config";
import { TAB_ID } from "@/lib/tab-id";

const SEO_TITLE = `${APP_TITLE} — Chat`;

export function meta() {
  return [{ title: SEO_TITLE }];
}

function chatThreadPath(threadId: string | null) {
  return threadId ? `/chat/${encodeURIComponent(threadId)}` : "/chat";
}

const ACCEPTED = ".txt,.md,.markdown,text/plain,text/markdown";

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export default function ChatRoute() {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleChatRunning(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.isRunning === true) markAgentChatHomeHandoff("chat");
    }
    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    return () =>
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const content = await readFileAsText(file);
    sendToAgentChat({
      message: `Here is my ICP document "${file.name}". Please save it and confirm what criteria you found.`,
      context: content,
      submit: true,
    });
    e.target.value = "";
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={handleFileChange}
      />
      <AgentChatSurface
        mode="page"
        chatViewTransition
        className="h-full"
        defaultMode="chat"
        storageKey="chat"
        threadUrlSync={{
          routeThreadId: threadId ?? null,
          getPath: chatThreadPath,
          navigate,
        }}
        browserTabId={TAB_ID}
        showHeader={false}
        showTabBar={false}
        dynamicSuggestions={false}
        suggestions={[
          "Show me my current ICP document",
          "What prospects have I captured so far?",
          "How does scoring work?",
        ]}
        emptyStateDisplay="hidden"
        centerComposerWhenEmpty
        composerLayoutVariant="hero"
        composerPlaceholder="Ask about your prospects, update your ICP, or paste criteria here…"
        composerSlot={
          <div className="mx-auto mb-5 max-w-xl px-4 text-center">
            <h1 className="text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
              LinkedIn Agent
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Ask about your prospects or update your ICP.
            </p>
          </div>
        }
      />
    </div>
  );
}
