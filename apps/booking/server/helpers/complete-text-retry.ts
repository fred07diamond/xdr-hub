import { completeText, runWithRequestContext, type CompleteTextOptions } from "@agent-native/core/server";
import { getOwnerCtx } from "./get-owner-ctx.js";

// The shared LLM gateway occasionally returns an "Inactivity Timeout" HTML
// page after waiting too long on the model's first token -- more likely on
// long system prompts -- and sometimes leaks that raw HTML as the error
// message instead of a clean sentence. Retry transparently and scrub any
// HTML that slips through so callers never show a wall of <HTML> tags.
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = [1000, 3000];

function cleanErrorMessage(raw: string): string {
  const looksHtml = /<html[\s>]|<body[\s>]|<head[\s>]/i.test(raw);
  if (!looksHtml) return raw;
  const text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text || "The AI gateway returned an unreadable error page.";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptCompleteText(options: CompleteTextOptions): Promise<string> {
  const ownerCtx = await getOwnerCtx();
  const call = () => completeText(options);
  let result: Awaited<ReturnType<typeof call>>;
  try {
    result = ownerCtx ? await runWithRequestContext(ownerCtx, call) : await call();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw Object.assign(new Error(`AI generation failed: ${cleanErrorMessage(msg)}`), { statusCode: 502 });
  }
  return result.text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

/** completeText() with automatic retry on transient gateway failures, returning the raw (fence-stripped) text. */
export async function completeTextWithRetry(options: CompleteTextOptions): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await attemptCompleteText(options);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(RETRY_DELAY_MS[attempt] ?? RETRY_DELAY_MS[RETRY_DELAY_MS.length - 1]);
      }
    }
  }
  throw lastErr;
}

/** completeTextWithRetry() that also parses the result as JSON, with a clean error on parse failure. */
export async function completeJsonWithRetry<T = Record<string, unknown>>(options: CompleteTextOptions): Promise<T> {
  const raw = await completeTextWithRetry(options);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw Object.assign(
      new Error(`AI generation failed: could not parse response as JSON. Raw response: ${cleanErrorMessage(raw).slice(0, 200)}`),
      { statusCode: 422 },
    );
  }
}
