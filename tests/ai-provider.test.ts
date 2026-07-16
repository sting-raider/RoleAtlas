import assert from "node:assert/strict";
import test from "node:test";
import {
  activityFrom,
  providerEndpoint,
  providerHeaders,
  providerIsConfigured,
  verificationIsCurrent,
  type ProviderConfig,
} from "../app/aiProvider.ts";
import { POST as testProviderConnection } from "../app/api/ai/test/route.ts";
import { providerAddressIsPublic, secureProviderFetch, validateProviderDns } from "../app/providerFetch.ts";

const nim: ProviderConfig = {
  provider: "NVIDIA NIM",
  apiKey: "nvapi-secret",
  baseUrl: "https://integrate.api.nvidia.com/v1",
  model: "meta/llama-3.1-8b-instruct",
  profile: "",
};

test("builds hosted and self-hosted NVIDIA NIM endpoints", () => {
  assert.equal(providerEndpoint(nim, "chat"), "https://integrate.api.nvidia.com/v1/chat/completions");
  assert.equal(providerEndpoint(nim, "models"), "https://integrate.api.nvidia.com/v1/models");
  const local = { ...nim, apiKey: "", baseUrl: "http://localhost:8000/v1" };
  assert.equal(providerEndpoint(local, "chat"), "http://localhost:8000/v1/chat/completions");
  assert.equal(providerIsConfigured(local), true);
});

test("keeps private-network SSRF protections and provider-specific auth", () => {
  assert.throws(() => providerEndpoint({ ...nim, baseUrl: "http://192.168.1.20:8000/v1" }, "models"), /HTTPS|Private/);
  assert.throws(() => providerEndpoint({ ...nim, baseUrl: "https://[fd00::1]/v1" }, "models"), /Private provider URLs/);
  assert.deepEqual(providerHeaders(nim), { "Content-Type": "application/json", Authorization: "Bearer nvapi-secret" });
  assert.equal(providerEndpoint({ ...nim, provider: "Anthropic", baseUrl: "https://api.anthropic.com" }, "chat"), "https://api.anthropic.com/v1/messages");
});

test("custom provider DNS must resolve only to public addresses", async () => {
  const custom = { ...nim, provider: "Custom OpenAI-compatible" as const, baseUrl: "https://models.example/v1" };
  await assert.rejects(
    validateProviderDns(custom, "https://models.example/v1/models", async () => [{ address: "10.20.30.40", family: 4 }]),
    /blocked network address/,
  );
  const url = await validateProviderDns(custom, "https://models.example/v1/models", async () => [{ address: "8.8.4.4", family: 4 }]);
  assert.equal(url.hostname, "models.example");
  assert.equal(providerAddressIsPublic("127.0.0.1"), false);
  assert.equal(providerAddressIsPublic("198.51.100.7"), false);
  assert.equal(providerAddressIsPublic("203.0.113.7"), false);
  assert.equal(providerAddressIsPublic("8.8.8.8"), true);
  assert.equal(providerAddressIsPublic("fd00::1"), false);
});

test("authenticated provider redirects are manually validated", async () => {
  const custom = { ...nim, provider: "Custom OpenAI-compatible" as const, baseUrl: "https://models.example/v1" };
  const publicDns = async () => [{ address: "8.8.8.8", family: 4 }];
  await assert.rejects(
    secureProviderFetch(custom, "https://models.example/v1/models", { method: "GET", headers: { Authorization: "Bearer secret" } }, {
      resolveHost: publicDns,
      fetchImpl: async () => new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } }),
    }),
    /HTTPS|Private provider URLs/,
  );
  await assert.rejects(
    secureProviderFetch(custom, "https://models.example/v1/models", { method: "GET", headers: { Authorization: "Bearer secret" } }, {
      resolveHost: publicDns,
      fetchImpl: async () => new Response(null, { status: 302, headers: { Location: "https://other.example/models" } }),
    }),
    /Cross-origin provider redirects/,
  );
});

test("never treats an untested key as a verified connection", () => {
  assert.equal(providerIsConfigured(nim), true);
  assert.equal(verificationIsCurrent(nim), false);
  const verified = { ...nim, verification: { status: "verified" as const, baseUrl: nim.baseUrl, model: nim.model } };
  assert.equal(verificationIsCurrent(verified), true);
  assert.equal(verificationIsCurrent({ ...verified, model: "another-model" }), false);
});

test("activity metadata is transparent without retaining the API key", () => {
  const activity = activityFrom(nim, "connection_test", providerEndpoint(nim, "models"), "2026-07-16T00:00:00.000Z", "success", ["API credential", "configured model name"]);
  assert.equal(activity.endpoint, "https://integrate.api.nvidia.com/v1/models");
  assert.equal(JSON.stringify(activity).includes(nim.apiKey), false);
});

test("connection test verifies credentials against the provider model endpoint", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://integrate.api.nvidia.com/v1/models");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer nvapi-secret");
    return Response.json({ data: [{ id: nim.model }] });
  };
  try {
    const response = await testProviderConnection(new Request("http://roleatlas.local/api/ai/test", { method: "POST", body: JSON.stringify(nim) }));
    const payload = await response.json() as { verified: boolean; activity: { outcome: string } };
    assert.equal(response.status, 200);
    assert.equal(payload.verified, true);
    assert.equal(payload.activity.outcome, "success");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("connection test does not verify an unlisted model", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ data: [{ id: "another-model" }] });
  try {
    const response = await testProviderConnection(new Request("http://roleatlas.local/api/ai/test", { method: "POST", body: JSON.stringify(nim) }));
    const payload = await response.json() as { verified?: boolean; activity: { outcome: string } };
    assert.equal(response.status, 409);
    assert.notEqual(payload.verified, true);
    assert.equal(payload.activity.outcome, "failed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
