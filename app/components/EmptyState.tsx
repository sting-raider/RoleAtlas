"use client";

import { Search } from "lucide-react";
import type { View } from "../workspaceUrl";

export function EmptyState({ view, reset, coverage }: { view: View; reset: () => void; coverage?: { sources: number; successful: number; complete: boolean } | null }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Search size={24} /></div>
      <h3>{view === "saved" ? "No saved roles match these filters" : "No strong matches yet"}</h3>
      <p>{coverage ? `No indexed match for this query. ${coverage.successful} of ${coverage.sources} configured sources have completed successfully${coverage.complete ? "." : "; coverage is still incomplete."}` : "Broaden one or two filters and RoleAtlas will show you the closest honest fits."}</p>
      <button type="button" className="secondary-button" onClick={reset}>Reset filters</button>
    </div>
  );
}
