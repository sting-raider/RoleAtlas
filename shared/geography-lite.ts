import liteCountries from "./geography/countries-lite.json" with { type: "json" };

// Browser-safe country data: display names plus bounded code<->name mapping.
// Full alias resolution — multilingual names, subdivisions, cities,
// timezones — stays server-side in shared/geography.ts so the ~1.3 MB corpus
// never enters the client bundle. Job payloads arrive with `country` already
// normalized server-side; this module only labels and round-trips codes.
export type LiteCountry = { code: string; name: string; aliases: string[] };

export const LITE_COUNTRIES = liteCountries as LiteCountry[];

const byCode = new Map(LITE_COUNTRIES.map((country) => [country.code, country]));
const byAlias = new Map<string, LiteCountry>();
for (const country of LITE_COUNTRIES) {
  for (const alias of [...country.aliases, country.name]) {
    const aliasKey = liteKey(alias);
    if (!byAlias.has(aliasKey)) byAlias.set(aliasKey, country);
  }
}

// Same normalization shape as the server's key(): case- and diacritic-folded
// so "Bharat", "bharat", and "BHĀRAT" all resolve identically.
function liteKey(value: string) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9+/-]+/g, " ").trim();
}

export function liteCountryByCode(code: string | null | undefined) {
  return code ? byCode.get(code.toUpperCase()) ?? null : null;
}

// Exact-token resolution only: the whole trimmed value must match a name,
// alias, or ISO code. Free-text phrase matching is a server capability on
// purpose — unknown input stays unknown instead of being guessed.
export function resolveLiteCountry(value: string | null | undefined) {
  if (!value) return null;
  return byAlias.get(liteKey(value.trim())) ?? null;
}
