import {
  activityFrom,
  providerEndpoint,
  providerHeaders,
  providerIsConfigured,
  type ProviderConfig,
} from "../../../aiProvider.ts";
import { secureProviderFetch } from "../../../providerFetch.ts";

export async function POST(request: Request) {
  const startedAt = new Date().toISOString();
  let config: ProviderConfig | undefined;
  let endpoint = "";
  try {
    config = await request.json() as ProviderConfig;
    if (!providerIsConfigured(config)) {
      return Response.json({ error: "Base URL, model, and provider credentials are required." }, { status: 400 });
    }
    endpoint = providerEndpoint(config, "models");
    const response = await secureProviderFetch(config, endpoint, {
      method: "GET",
      headers: providerHeaders(config),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const providerMessage = payload.error && typeof payload.error === "object" && "message" in payload.error
        ? String((payload.error as { message: unknown }).message)
        : `Provider model discovery returned HTTP ${response.status}.`;
      return Response.json({
        error: providerMessage,
        activity: activityFrom(config, "connection_test", endpoint, startedAt, "failed", ["API credential", "configured model name"], { message: providerMessage }),
      }, { status: 502 });
    }
    const records = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
    const modelIds = records.flatMap((record) => {
      if (typeof record === "string") return [record];
      if (record && typeof record === "object" && "id" in record) return [String((record as { id: unknown }).id)];
      if (record && typeof record === "object" && "name" in record) return [String((record as { name: unknown }).name)];
      return [];
    });
    const modelFound = modelIds.includes(config.model);
    if (!modelFound) {
      const message = `Connection succeeded, but model “${config.model}” was not listed by this endpoint.`;
      return Response.json({
        error: message,
        availableModels: modelIds.slice(0, 30),
        activity: activityFrom(config, "connection_test", endpoint, startedAt, "failed", ["API credential", "configured model name"], { message }),
      }, { status: 409 });
    }
    const message = modelIds.length > 0 ? `Connected; ${modelIds.length} models are available.` : "Connected; the provider accepted the credentials.";
    return Response.json({
      verified: true,
      modelFound,
      availableModels: modelIds.slice(0, 30),
      message,
      activity: activityFrom(config, "connection_test", endpoint, startedAt, "success", ["API credential", "configured model name"], { message }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider connection test failed.";
    return Response.json({
      error: message,
      ...(config && endpoint ? { activity: activityFrom(config, "connection_test", endpoint, startedAt, "failed", ["API credential", "configured model name"], { message }) } : {}),
    }, { status: 400 });
  }
}
