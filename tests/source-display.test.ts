import assert from "node:assert/strict";
import test from "node:test";
import { registryCompanyLabel } from "../app/sourceDisplay.ts";

test("renders both legacy and structured registry company metadata", () => {
  assert.equal(registryCompanyLabel("Anthropic"), "Anthropic");
  assert.equal(registryCompanyLabel({ name: "Anthropic", domain: "anthropic.com" }), "Anthropic");
});
