"use client";

import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

// Shared selection toolbar for bulk-action lists: a "select all eligible" checkbox on the left,
// the caller's action buttons on the right once something is selected. `eligible` is the count
// select-all targets (e.g. rows an action can actually apply to); `total` is just for the label.
export function BulkBar({ selected, eligible, total, onSelectAll, onClear, busy, children }: {
  selected: number;
  eligible: number;
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  busy?: boolean;
  children?: ReactNode;
}) {
  if (!total) return null;
  return (
    <div className="toolbar bulk-bar">
      <label className="bulk-select-all">
        <input
          type="checkbox"
          aria-label="Select all"
          disabled={eligible === 0}
          checked={selected > 0 && selected === eligible}
          ref={(el) => { if (el) el.indeterminate = selected > 0 && selected < eligible; }}
          onChange={(event) => (event.target.checked ? onSelectAll() : onClear())}
        />
        {selected > 0 ? `${selected} selected` : `Select all (${eligible})`}
      </label>
      {selected > 0 ? <span className="toolbar" style={{ marginBottom: 0 }}>{children}{busy ? <LoaderCircle size={14} className="animate-spin" /> : null}</span> : null}
      <span className="spacer" />
    </div>
  );
}
