import assert from "node:assert/strict";
import test from "node:test";

// Dependency-free module so these run directly under --experimental-strip-types.
const { joinList, rawMatchesList, splitList } = await import("../app/listText.ts");

test("splitList parses comma and newline separated values", () => {
  assert.deepEqual(splitList("data science, policy research"), ["data science", "policy research"]);
  assert.deepEqual(splitList("one\ntwo\nthree"), ["one", "two", "three"]);
  assert.deepEqual(splitList("a, b,,c , "), ["a", "b", "c"]);
});

test("splitList deduplicates case-insensitively while preserving first spelling", () => {
  assert.deepEqual(splitList("Rust, rust, RUST, go"), ["Rust", "go"]);
});

test("raw text keeps characters the parsed list would drop", () => {
  // The exact regression: trailing space and trailing comma must survive in
  // the raw buffer; only the parsed view trims them.
  const raw = "data sci ";
  assert.deepEqual(splitList(raw), ["data sci"]);
  assert.equal(raw.endsWith(" "), true);
  const midTyping = "data,";
  assert.deepEqual(splitList(midTyping), ["data"]);
  assert.equal(midTyping.endsWith(","), true);
});

test("rawMatchesList treats delimiter and case noise as unchanged", () => {
  assert.equal(rawMatchesList("data, ", ["data"]), true);
  assert.equal(rawMatchesList("Data Science", ["data science"]), true);
  assert.equal(rawMatchesList("a ,b,  c", ["a", "b", "c"]), true);
  assert.equal(rawMatchesList("completely different", ["data"]), false);
  assert.equal(rawMatchesList("a, b", ["a", "b", "c"]), false);
  assert.equal(rawMatchesList("", []), true);
});

test("joinList round-trips through splitList", () => {
  const values = ["data science", "policy research"];
  assert.deepEqual(splitList(joinList(values)), values);
});
