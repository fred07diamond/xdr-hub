// A bare `fetch()`/RPC call with no timeout leaves the caller -- and
// everything sequenced after it -- stuck forever if the remote end stalls
// (confirmed live more than once in this workspace: a stalled CommonRoom MCP
// connection, a stalled HubSpot request). `Promise.race` can't cancel the
// underlying call when the callee gives no cancellation hook (an MCP tool
// call, or any RPC-style API with no AbortSignal support), but it lets the
// caller stop waiting and treat a stall as a normal, catchable error instead
// of an indefinite hang.
//
// This was independently reimplemented three times across the workspace
// (HubSpot, CommonRoom, and Apollo's fetch calls) before being extracted
// here. Apollo's own apolloFetch deliberately does NOT use this: it calls
// fetch() directly, which supports a real AbortSignal that actually cancels
// the in-flight request -- strictly better than a race when the callee
// supports it. Use withTimeout only for calls with no cancellation hook of
// their own.
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms — the connection may have stalled.`)), timeoutMs),
    ),
  ]);
}
