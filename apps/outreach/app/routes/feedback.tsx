import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { IconLoader2, IconMessageReport, IconSend } from "@tabler/icons-react";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Feedback — ${APP_TITLE}` }];
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function FeedbackRoute() {
  useSetPageTitle("Feedback");
  const { data, isLoading, error, refetch } = useActionQuery("list-feedback", {});
  const submitFeedback = useActionMutation("submit-feedback");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    await submitFeedback.mutateAsync({ message: message.trim() });
    setMessage("");
    setSent(true);
    setTimeout(() => setSent(false), 3000);
  }

  const isAdminError =
    error &&
    (error instanceof Error
      ? error.message.toLowerCase().includes("admin") || error.message.includes("403")
      : false);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold">Feedback</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Share feedback about Builder.LI, or review what your team has submitted.
        </p>
      </div>

      {/* Submit feedback form — visible to everyone */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Send feedback</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What's working well? What could be better?"
              rows={4}
              maxLength={2000}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{message.length} / 2000</span>
              <button
                type="submit"
                disabled={!message.trim() || submitFeedback.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {submitFeedback.isPending ? (
                  <IconLoader2 size={12} className="animate-spin" />
                ) : (
                  <IconSend size={12} />
                )}
                {sent ? "Sent!" : "Send feedback"}
              </button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Admin-only: feedback list */}
      {isAdminError ? (
        <p className="text-center text-sm text-muted-foreground">
          Only admins can view team feedback submissions.
        </p>
      ) : isLoading ? (
        <div className="flex justify-center py-8">
          <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">All submissions</h2>
          {!data || (data as any).feedback?.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <IconMessageReport className="size-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No feedback yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {((data as any).feedback as Array<{ id: string; userEmail: string | null; message: string; createdAt: string | null }>).map((item) => (
                <div key={item.id} className="px-4 py-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-muted-foreground">
                      {item.userEmail ?? "Anonymous"}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground/60">
                      {formatDate(item.createdAt)}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
