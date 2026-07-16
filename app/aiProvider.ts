import type { ProviderName } from "./jobs.ts";

export type ProviderVerification = {
  status: "untested" | "verified" | "failed";
  testedAt?: string;
  baseUrl?: string;
  model?: string;
  message?: string;
};

export type ProviderConfig = {
  provider: ProviderName;
  apiKey: string;
  baseUrl: string;
  model: string;
  profile: string;
  rememberKey?: boolean;
  verification?: ProviderVerification;
};

export type AiActivity = {
  id: string;
  action: "connection_test" | "resume_ranking" | "job_analysis" | "application_dossier";
  provider: ProviderName;
  model: string;
  endpoint: string;
  startedAt: string;
  completedAt: string;
  outcome: "success" | "failed";
  dataSent: string[];
  jobCount?: number;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  message?: string;
};

export function isLoopbackProviderHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function isPrivateNetwork(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  return host === "0.0.0.0"
    || host === "::"
    || host.endsWith(".local")
    || /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
    || /^(fc|fd|fe8|fe9|fea|feb)[0-9a-f]*:/i.test(host)
    || /^::ffff:(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(host);
}

export function validateProviderUrl(config: Pick<ProviderConfig, "provider">, input: string | URL) {
  const url = new URL(input);
  const hostname = url.hostname.toLowerCase();
  const localRuntime = isLoopbackProviderHost(hostname) && (config.provider === "Ollama" || config.provider === "NVIDIA NIM");
  if (url.protocol !== "https:" && !(localRuntime && url.protocol === "http:")) {
    throw new Error("Provider URLs must use HTTPS; loopback HTTP is allowed only for local Ollama or NVIDIA NIM.");
  }
  if (!localRuntime && (isLoopbackProviderHost(hostname) || isPrivateNetwork(hostname))) {
    throw new Error("Private provider URLs are blocked. Use loopback Ollama/NIM or a public HTTPS endpoint.");
  }
  return url;
}

export function providerEndpoint(config: Pick<ProviderConfig, "provider" | "baseUrl">, kind: "chat" | "models") {
  const url = validateProviderUrl(config, config.baseUrl);
  url.hash = "";
  url.search = "";
  const base = url.toString().replace(/\/$/, "");
  if (config.provider === "Anthropic") {
    return `${base}/v1/${kind === "chat" ? "messages" : "models"}`;
  }
  return `${base}/${kind === "chat" ? "chat/completions" : "models"}`;
}

export function providerHeaders(config: Pick<ProviderConfig, "provider" | "apiKey">): Record<string, string> {
  if (config.provider === "Anthropic") {
    return {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  return headers;
}

export function providerIsConfigured(config: Pick<ProviderConfig, "provider" | "apiKey" | "baseUrl" | "model">) {
  let loopbackNim = false;
  try {
    loopbackNim = config.provider === "NVIDIA NIM" && isLoopbackProviderHost(new URL(config.baseUrl).hostname.toLowerCase());
  } catch {
    return false;
  }
  const keyOptional = config.provider === "Ollama" || loopbackNim;
  return Boolean(config.baseUrl && config.model && (config.apiKey || keyOptional));
}

export function verificationIsCurrent(config: ProviderConfig) {
  return providerIsConfigured(config)
    && config.verification?.status === "verified"
    && config.verification.baseUrl === config.baseUrl
    && config.verification.model === config.model;
}

export function publicEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  return `${url.origin}${url.pathname}`;
}

export function activityFrom(
  config: Pick<ProviderConfig, "provider" | "model">,
  action: AiActivity["action"],
  endpoint: string,
  startedAt: string,
  outcome: AiActivity["outcome"],
  dataSent: string[],
  options: Partial<Pick<AiActivity, "jobCount" | "usage" | "message">> = {},
): AiActivity {
  return {
    id: crypto.randomUUID(),
    action,
    provider: config.provider,
    model: config.model,
    endpoint: publicEndpoint(endpoint),
    startedAt,
    completedAt: new Date().toISOString(),
    outcome,
    dataSent,
    ...options,
  };
}

export function usageFrom(payload: Record<string, unknown>): AiActivity["usage"] | undefined {
  const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as Record<string, unknown> : undefined;
  if (!usage) return undefined;
  const number = (key: string) => typeof usage[key] === "number" ? usage[key] as number : undefined;
  return {
    inputTokens: number("prompt_tokens") ?? number("input_tokens"),
    outputTokens: number("completion_tokens") ?? number("output_tokens"),
    totalTokens: number("total_tokens"),
  };
}
