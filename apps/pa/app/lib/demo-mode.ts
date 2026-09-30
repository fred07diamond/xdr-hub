import { setClientAppState } from "@agent-native/core/client/hooks";
import { useEffect, useSyncExternalStore } from "react";

import type { DemoData } from "../../server/core/demo/index.js";

const STORAGE_KEY = "pa-hub:demo-mode";
const APP_STATE_KEY = "pa-demo-mode";
const listeners = new Set<() => void>();

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function syncAgentState(enabled: boolean) {
  void setClientAppState(
    APP_STATE_KEY,
    enabled ? { enabled: true, capturedAt: Date.now() } : null,
    {
      keepalive: true,
    },
  ).catch(() => undefined);
}

export function setDemoMode(enabled: boolean) {
  try {
    if (enabled) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode); the toggle still works for this page.
  }
  syncAgentState(enabled);
  for (const listener of listeners) listener();
}

export function useDemoMode(): boolean {
  return useSyncExternalStore(subscribe, readEnabled, () => false);
}

/** Tells the agent (via app state) that demo data is on screen. Mount once. */
export function useDemoModeAgentSync() {
  const enabled = useDemoMode();
  useEffect(() => {
    if (enabled) syncAgentState(true);
  }, [enabled]);
}

let pending: Promise<DemoData> | null = null;

/** Builds the demo dataset once per page load; the engine is fetched only when needed. */
export function loadDemoData(): Promise<DemoData> {
  pending ??= import("../../server/core/demo/index.js")
    .then((mod) => mod.buildDemoData({ now: new Date() }))
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });
  return pending;
}
