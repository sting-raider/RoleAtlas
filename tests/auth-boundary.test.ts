import assert from "node:assert/strict";
import test from "node:test";
import { createInternalAssertion } from "../lib/internal-assertion.ts";

test("internal service assertions bind method, path, user, role, and timestamp", () => {
  const input = {
    secret: "a-production-length-internal-service-secret",
    timestamp: "1786646400",
    method: "POST",
    path: "/api/search-sessions/11111111-1111-4111-8111-111111111111/rerun",
    userId: "22222222-2222-4222-8222-222222222222",
    role: "user" as const,
  };
  const original = createInternalAssertion(input);
  assert.equal(original.length, 64);
  assert.notEqual(original, createInternalAssertion({ ...input, method: "GET" }));
  assert.notEqual(original, createInternalAssertion({ ...input, role: "admin" }));
  assert.notEqual(original, createInternalAssertion({ ...input, userId: "33333333-3333-4333-8333-333333333333" }));
  assert.notEqual(original, createInternalAssertion({ ...input, path: "/api/seeds" }));
});
