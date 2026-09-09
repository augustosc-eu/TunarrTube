"use client";

import { useEffect, useState } from "react";

export type ViewMode = "grid" | "list";

// Per-page grid/list preference, persisted client-side only -- there's nothing server-worthy about it.
export function useViewMode(key: string, initial: ViewMode = "grid") {
  const [mode, setMode] = useState<ViewMode>(initial);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`view-mode:${key}`);
      if (stored === "grid" || stored === "list") setMode(stored);
    } catch {
      // Private browsing / storage disabled -- fall back to the initial mode.
    }
  }, [key]);

  function update(next: ViewMode) {
    setMode(next);
    try { localStorage.setItem(`view-mode:${key}`, next); } catch {}
  }

  return [mode, update] as const;
}
