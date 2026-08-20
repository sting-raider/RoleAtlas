import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_STORAGE_KEYS,
  accountStorageKey,
  accountStorageKeys,
  providerMetadataForStorage,
} from "../app/accountStorage.ts";

test("browser persistence is namespaced by a stable authenticated account ID", () => {
  const userA = "11111111-1111-4111-8111-111111111111";
  const userB = "22222222-2222-4222-8222-222222222222";

  assert.notEqual(
    accountStorageKey(userA, ACCOUNT_STORAGE_KEYS.workspace),
    accountStorageKey(userB, ACCOUNT_STORAGE_KEYS.workspace),
  );
  assert.match(accountStorageKey(userA, ACCOUNT_STORAGE_KEYS.workspace), new RegExp(userA));
  assert.throws(() => accountStorageKey(" ", ACCOUNT_STORAGE_KEYS.workspace), /stable account ID/);
  assert.equal(new Set(accountStorageKeys(userA)).size, Object.keys(ACCOUNT_STORAGE_KEYS).length);
});

test("provider metadata persistence always strips raw credentials", () => {
  const stored = providerMetadataForStorage({
    provider: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    apiKey: "never-write-this-key",
    profile: "confirmed preferences",
    rememberKey: true,
    verification: { status: "verified", testedAt: "2026-08-20T00:00:00.000Z" },
  });

  assert.equal(stored.apiKey, "");
  assert.equal(stored.rememberKey, false);
  assert.equal(stored.provider, "DeepSeek");
  assert.equal(stored.profile, "confirmed preferences");
});
