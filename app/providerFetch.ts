import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isLoopbackProviderHost, validateProviderUrl, type ProviderConfig } from "./aiProvider.ts";
import { PROVIDERS } from "./jobs.ts";

type ProviderRequestConfig = Pick<ProviderConfig, "provider">;
type ResolvedAddress = { address: string; family: number };
type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;
type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ProviderFetchDependencies = {
  fetchImpl?: FetchImplementation;
  resolveHost?: Resolver;
  maxRedirects?: number;
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function officialOrigin(provider: ProviderConfig["provider"]) {
  const baseUrl = PROVIDERS[provider].baseUrl;
  return baseUrl ? new URL(baseUrl).origin : null;
}

function ipv4IsPublic(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [a, b] = octets;
  return !(a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && octets[2] === 100)
    || (a === 203 && b === 0 && octets[2] === 113)
    || a >= 224);
}

export function providerAddressIsPublic(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const family = isIP(normalized);
  if (family === 4) return ipv4IsPublic(normalized);
  if (family !== 6) return false;
  if (normalized.startsWith("::ffff:")) return ipv4IsPublic(normalized.slice("::ffff:".length));
  return normalized !== "::"
    && normalized !== "::1"
    && !/^(fc|fd|fe8|fe9|fea|feb|ff)/i.test(normalized)
    && !normalized.startsWith("2001:db8:");
}

const systemResolver: Resolver = async (hostname) => lookup(hostname, { all: true, verbatim: true });

export async function validateProviderDns(
  config: ProviderRequestConfig,
  input: string | URL,
  resolveHost: Resolver = systemResolver,
) {
  const url = validateProviderUrl(config, input);
  if (isLoopbackProviderHost(url.hostname.toLowerCase())) return url;
  if (url.origin === officialOrigin(config.provider)) return url;
  const addresses = await resolveHost(url.hostname);
  if (!addresses.length) throw new Error("The custom provider hostname did not resolve to an address.");
  const blocked = addresses.find(({ address }) => !providerAddressIsPublic(address));
  if (blocked) throw new Error(`The custom provider hostname resolves to a blocked network address (${blocked.address}).`);
  return url;
}

export async function secureProviderFetch(
  config: ProviderRequestConfig,
  endpoint: string,
  init: RequestInit,
  dependencies: ProviderFetchDependencies = {},
) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const resolveHost = dependencies.resolveHost ?? systemResolver;
  const maxRedirects = dependencies.maxRedirects ?? 3;
  let current = await validateProviderDns(config, endpoint, resolveHost);
  const initialOrigin = current.origin;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetchImpl(current, { ...init, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    if (redirectCount === maxRedirects) throw new Error("The provider exceeded the redirect limit.");
    const location = response.headers.get("location");
    if (!location) throw new Error("The provider returned a redirect without a Location header.");
    const next = await validateProviderDns(config, new URL(location, current), resolveHost);
    if (next.origin !== initialOrigin) {
      throw new Error("Cross-origin provider redirects are blocked to protect API credentials.");
    }
    const method = (init.method ?? "GET").toUpperCase();
    if ([301, 302, 303].includes(response.status) && method !== "GET" && method !== "HEAD") {
      throw new Error("Provider redirects that change an authenticated request method are blocked.");
    }
    current = next;
  }
  throw new Error("The provider redirect could not be completed.");
}
