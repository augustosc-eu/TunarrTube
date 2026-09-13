"use client";

import { LayoutGrid, List } from "lucide-react";
import type { ViewMode } from "@/lib/hooks/use-view-mode";

export function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <div className="view-toggle" role="group" aria-label="View">
      <button type="button" aria-pressed={mode === "grid"} aria-label="Grid view" className={mode === "grid" ? "active" : ""} onClick={() => onChange("grid")}><LayoutGrid size={15} /></button>
      <button type="button" aria-pressed={mode === "list"} aria-label="List view" className={mode === "list" ? "active" : ""} onClick={() => onChange("list")}><List size={15} /></button>
    </div>
  );
}
