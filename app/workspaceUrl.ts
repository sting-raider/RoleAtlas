import type { DailyView } from "./DailyWorkspaces";

export type View = DailyView;

// One source of truth for URL serialization so nav items and deep links
// round-trip through the same vocabulary as DailyView itself.
export const VIEW_IDS: Array<View> = ["home", "discover", "searches", "saved", "applications", "profile", "sources", "settings"];

const VIEW_ID_SET = new Set<string>(VIEW_IDS);

/** Unknown or stale ?view= values fall back to home instead of a blank page. */
export function parseWorkspaceView(value: string | null | undefined): View {
  return value && VIEW_ID_SET.has(value) ? value as View : "home";
}

export function serializeWorkspaceView(view: View) {
  return view;
}

function readQueryParam(name: string) {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    // A malformed location can never block rendering.
    return null;
  }
}

/** Initial workspace state comes straight from the address bar on mount. */
export function readInitialWorkspaceState() {
  const rawView = readQueryParam("view");
  const rawJob = readQueryParam("job");
  return {
    view: parseWorkspaceView(rawView),
    jobId: rawJob && /^[A-Za-z0-9_-]{1,120}$/.test(rawJob) ? rawJob : null,
  };
}

/**
 * Mirror the workspace state into ?view=/?job= without navigation. replaceState
 * keeps SSR auth flow, scroll position, and re-render storms untouched; home
 * with no drawer drops the params entirely so links stay clean.
 */
export function syncWorkspaceUrl(view: View, jobId: string | null) {
  if (typeof window === "undefined") return;
  try {
    const params = new URLSearchParams(window.location.search);
    params.delete("view");
    params.delete("job");
    if (view !== "home") params.set("view", serializeWorkspaceView(view));
    if (jobId) params.set("job", jobId);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  } catch {
    // History failures must never break the interaction that triggered them.
  }
}
