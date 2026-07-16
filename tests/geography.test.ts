import assert from "node:assert/strict";
import test from "node:test";
import { COUNTRIES, SUBDIVISIONS, countryInRegion, normalizeGeographicLocation, resolveCountry, resolveRegion } from "../shared/geography.ts";

test("loads the canonical ISO country and subdivision datasets", () => {
  assert.equal(COUNTRIES.length, 249);
  assert.ok(SUBDIVISIONS.length > 5_000);
  assert.equal(resolveCountry("IND")?.code, "IN");
  assert.equal(resolveCountry("United Arab Emirates")?.code, "AE");
  assert.equal(resolveCountry("Brasil")?.code, "BR");
});

test("uses centralized deterministic region membership", () => {
  assert.equal(countryInRegion("DE", "EU"), true);
  assert.equal(countryInRegion("GB", "EU"), false);
  assert.equal(countryInRegion("JP", "APAC"), true);
  assert.equal(countryInRegion("AU", "APAC"), true);
  assert.equal(countryInRegion("BR", "LATAM"), true);
  assert.equal(countryInRegion("NG", "EMEA"), true);
  assert.equal(countryInRegion("AE", "GCC"), true);
  assert.equal(resolveRegion("Open to candidates in the European Economic Area")?.code, "EEA");
});

test("normalizes countries, subdivisions, cities, regions, and timezones", () => {
  const india = normalizeGeographicLocation("Bengaluru, India");
  assert.equal(india.countryCode, "IN");
  assert.equal(india.city, "Bengaluru");
  assert.equal(india.timezone, "Asia/Kolkata");
  assert.ok(india.regionCodes.includes("APAC"));

  const california = normalizeGeographicLocation("California, United States");
  assert.equal(california.countryCode, "US");
  assert.equal(california.subdivisionCode, "US-CA");

  const apac = normalizeGeographicLocation("Remote — APAC");
  assert.equal(apac.countryCode, null);
  assert.ok(apac.regionCodes.includes("APAC"));
});
