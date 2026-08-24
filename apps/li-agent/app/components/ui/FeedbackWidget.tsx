import { useActionMutation } from "@agent-native/core/client/hooks";
import {
  IconCheck,
  IconLoader2,
  IconMessageReport,
  IconThumbDown,
  IconThumbUp,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
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
    // bottom-20 (not bottom-6) so this floating bubble clears the bottom-right
    // pagination controls that several pages (Prospects, Lead Lists) render
    // in that same corner, instead of sitting on top of them.
    <div className="fixed bottom-20 right-6 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-80 rounded-xl border border-border bg-background shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Share Feedback</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <IconX size={14} />
            </button>
          </div>

          <div className="p-4">
            {submitted ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
                  <IconCheck className="size-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Thank you for your feedback!</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Your input helps us improve LinkedIn Agent.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-xs text-primary underline-offset-4 hover:underline"
                >
                  Submit more feedback
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSentiment("positive")}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border-2 py-3 text-xs font-medium transition-colors ${
                      sentiment === "positive"
                        ? "border-emerald-400 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "border-border text-muted-foreground hover:border-emerald-300 hover:bg-emerald-500/5 hover:text-emerald-700"
                    }`}
                  >
                    <IconThumbUp size={15} />
                    It's going well
                  </button>
                  <button
                    type="button"
                    onClick={() => setSentiment("negative")}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border-2 py-3 text-xs font-medium transition-colors ${
                      sentiment === "negative"
                        ? "border-rose-400 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                        : "border-border text-muted-foreground hover:border-rose-300 hover:bg-rose-500/5 hover:text-rose-700"
                    }`}
                  >
                    <IconThumbDown size={15} />
                    Could be better
                  </button>
                </div>

                <div>
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
                    rows={3}
                    maxLength={2000}
                    className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <p className="mt-0.5 text-right text-xs text-muted-foreground">
                    {message.length} / 2000
                  </p>
                </div>

                {submitFeedback.isError && (
                  <p className="text-xs text-destructive">
                    {(submitFeedback.error as Error)?.message ?? "Failed to submit. Try again."}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={!sentiment || !message.trim() || submitFeedback.isPending}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {submitFeedback.isPending && (
                    <IconLoader2 size={13} className="animate-spin" />
                  )}
                  Submit Feedback
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="Share feedback"
        className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-colors hover:bg-primary/90"
      >
        {open ? <IconX size={20} /> : <IconMessageReport size={20} />}
      </button>
    </div>
  );
}
