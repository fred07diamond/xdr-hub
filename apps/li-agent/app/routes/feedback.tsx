import { useActionMutation } from "@agent-native/core/client/hooks";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconCheck, IconLoader2, IconThumbDown, IconThumbUp } from "@tabler/icons-react";
import { useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Feedback — ${APP_TITLE}` }];
}

export default function FeedbackRoute() {
  useSetPageTitle("Feedback");
  const submitFeedback = useActionMutation("submit-feedback");
  const [sentiment, setSentiment] = useState<"positive" | "negative" | null>(null);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sentiment || !message.trim()) return;
    await submitFeedback.mutateAsync({ sentiment, message: message.trim() });
    setSubmitted(true);
  }

  function handleReset() {
    setSentiment(null);
    setMessage("");
    setSubmitted(false);
    submitFeedback.reset();
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 px-6 py-12">
      <div>
        <h1 className="text-xl font-semibold">Share Feedback</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell us what's working and what could be better.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">How is LinkedIn Agent working for you?</CardTitle>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <IconCheck className="size-6 text-emerald-600" />
              </div>
              <div>
                <p className="font-semibold">Thank you for your feedback!</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your input helps us improve LinkedIn Agent for everyone.
                </p>
              </div>
              <button
                type="button"
                onClick={handleReset}
                className="mt-2 text-xs text-primary underline-offset-4 hover:underline"
              >
                Submit more feedback
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Sentiment toggle */}
              <div>
                <p className="mb-3 text-sm text-muted-foreground">Overall experience</p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setSentiment("positive")}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border-2 py-4 text-sm font-medium transition-colors ${
                      sentiment === "positive"
                        ? "border-emerald-400 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "border-border text-muted-foreground hover:border-emerald-300 hover:bg-emerald-500/5 hover:text-emerald-700"
                    }`}
                  >
                    <IconThumbUp size={20} />
                    It's going well
                  </button>
                  <button
                    type="button"
                    onClick={() => setSentiment("negative")}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border-2 py-4 text-sm font-medium transition-colors ${
                      sentiment === "negative"
                        ? "border-rose-400 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                        : "border-border text-muted-foreground hover:border-rose-300 hover:bg-rose-500/5 hover:text-rose-700"
                    }`}
                  >
                    <IconThumbDown size={20} />
                    Could be better
                  </button>
                </div>
              </div>

              {/* Written feedback — always visible, required */}
              <div>
                <label className="mb-1.5 block text-sm text-muted-foreground">
                  Tell us more <span className="text-muted-foreground/60">(required)</span>
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={
                    sentiment === "positive"
                      ? "What's working well for you?"
                      : sentiment === "negative"
                      ? "What could we improve?"
                      : "Share your thoughts…"
                  }
                  rows={5}
                  maxLength={2000}
                  required
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <p className="mt-1 text-right text-xs text-muted-foreground">
                  {message.length} / 2000
                </p>
              </div>

              {submitFeedback.isError && (
                <p className="text-sm text-destructive">
                  {(submitFeedback.error as Error)?.message ?? "Failed to submit. Try again."}
                </p>
              )}

              <button
                type="submit"
                disabled={!sentiment || !message.trim() || submitFeedback.isPending}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {submitFeedback.isPending && <IconLoader2 size={14} className="animate-spin" />}
                Submit Feedback
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
