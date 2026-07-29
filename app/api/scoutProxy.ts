export const LOOPBACK_SCOUT_URL = "http://127.0.0.1:8080";

type ScoutUrlOptions = {
  fallbackBaseUrl?: string;
  missingMessage?: string;
  search?: string | URLSearchParams;
};

type ForwardOptions = {
  buffered?: boolean;
  contentType?: string;
};

export function scoutApiUrl(path: string, options: ScoutUrlOptions = {}) {
  const configured = process.env.SCOUT_API_URL?.trim();
  const base = configured || options.fallbackBaseUrl;
  if (!base) {
    throw new Error(options.missingMessage ?? "The persistent RoleAtlas service is not configured.");
  }

  const url = new URL(path.replace(/^\//, ""), `${base.replace(/\/$/, "")}/`);
  if (options.search) {
    url.search = typeof options.search === "string" ? options.search : options.search.toString();
  }
  return url;
}

export function fetchScout(path: string, init?: RequestInit, options?: ScoutUrlOptions) {
  return fetch(scoutApiUrl(path, options), init);
}

export async function forwardScoutResponse(response: Response, options: ForwardOptions = {}) {
  const contentType = options.contentType ?? response.headers.get("content-type") ?? "application/json";
  const body = response.status === 204 || response.status === 304
    ? null
    : options.buffered === false
      ? response.body
      : await response.text();

  return new Response(body, {
    status: response.status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  });
}

export function scoutProxyError(error: unknown, fallbackMessage: string) {
  return Response.json(
    { error: error instanceof Error ? error.message : fallbackMessage },
    { status: 503 },
  );
}
