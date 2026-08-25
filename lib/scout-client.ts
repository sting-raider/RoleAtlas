import "server-only";

import { createInternalAssertion } from "./internal-assertion.ts";
import type { SessionPrincipal } from "./session.ts";

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

function internalSecret() {
  const secret = process.env.SCOUT_INTERNAL_SECRET?.trim();
  if (!secret) {
    throw new Error("The RoleAtlas internal service credential is not configured.");
  }
  return secret;
}

export function fetchScoutForUser(
  principal: SessionPrincipal,
  path: string,
  init: RequestInit = {},
  options?: ScoutUrlOptions,
) {
  const url = scoutApiUrl(path, options);
  const method = (init.method ?? "GET").toUpperCase();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const pathAndQuery = `${url.pathname}${url.search}`;
  // The body must be a string/Buffer for the assertion to cover it; streaming
  // bodies are not used by the Scout proxies.
  if (typeof init.body !== "string" && init.body !== undefined && !Buffer.isBuffer(init.body)) {
    throw new Error("Scout proxy requests must pass a string or Buffer body.");
  }
  const body = typeof init.body === "string" ? Buffer.from(init.body, "utf8") : init.body;
  const signature = createInternalAssertion({
    secret: internalSecret(),
    timestamp,
    method,
    path: pathAndQuery,
    userId: principal.userId,
    role: principal.role,
    body,
  });
  const headers = new Headers(init.headers);
  headers.set("x-roleatlas-user-id", principal.userId);
  headers.set("x-roleatlas-user-role", principal.role);
  headers.set("x-roleatlas-auth-timestamp", timestamp);
  headers.set("x-roleatlas-auth-signature", signature);
  return fetch(url, { ...init, headers });
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
  if (process.env.NODE_ENV !== "production") {
    console.error(fallbackMessage, error);
  }
  return Response.json(
    { error: { code: "upstream_unavailable", message: fallbackMessage } },
    { status: 503 },
  );
}
