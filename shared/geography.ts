import countriesData from "./geography/countries.json" with { type: "json" };
import citiesData from "./geography/cities.json" with { type: "json" };
import regionsData from "./geography/regions.json" with { type: "json" };
import subdivisionsData from "./geography/subdivisions.json" with { type: "json" };

export type CountryRecord = {
  code: string;
  alpha3: string;
  numeric: string;
  name: string;
  officialName: string;
  aliases: string[];
  region: string | null;
  subregion: string | null;
  timezones: Array<{ name: string; utcOffsetHours: number; dstOffsetHours: number }>;
};

export type SubdivisionRecord = {
  code: string;
  countryCode: string;
  name: string;
  type: string | null;
  aliases: string[];
};

export type RegionRecord = {
  code: string;
  name: string;
  aliases: string[];
  countryCodes: string[];
  definition: string;
};

export type CityRecord = {
  name: string;
  aliases: string[];
  countryCode: string;
  subdivisionCode: string | null;
  timezone: string;
};

export type GeographicLocation = {
  raw: string;
  city: string | null;
  subdivisionCode: string | null;
  countryCode: string | null;
  regionCodes: string[];
  timezone: string | null;
  confidence: number;
  evidence: string[];
};

export const COUNTRIES = countriesData as CountryRecord[];
export const CITIES = citiesData as CityRecord[];
export const SUBDIVISIONS = subdivisionsData as SubdivisionRecord[];
export const REGIONS = regionsData as RegionRecord[];

function key(value: string) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9+/-]+/g, " ").trim();
}

const countryByCode = new Map(COUNTRIES.map((country) => [country.code, country]));
const countryAliases = new Map<string, CountryRecord>();
for (const country of COUNTRIES) for (const alias of country.aliases) countryAliases.set(key(alias), country);
const regionAliases = new Map<string, RegionRecord>();
for (const region of REGIONS) for (const alias of region.aliases) regionAliases.set(key(alias), region);
const subdivisionsByAlias = new Map<string, SubdivisionRecord[]>();
for (const subdivision of SUBDIVISIONS) {
  for (const alias of subdivision.aliases) {
    const aliasKey = key(alias);
    subdivisionsByAlias.set(aliasKey, [...(subdivisionsByAlias.get(aliasKey) ?? []), subdivision]);
  }
}

function phraseMatch(raw: string, alias: string) {
  const normalizedRaw = ` ${key(raw)} `;
  const normalizedAlias = key(alias);
  return normalizedAlias.length >= 3 && normalizedRaw.includes(` ${normalizedAlias} `);
}

export function countryByCodeValue(code: string | null | undefined) {
  return code ? countryByCode.get(code.toUpperCase()) ?? null : null;
}

export function resolveCountry(value: string | null | undefined) {
  if (!value) return null;
  const normalized = key(value);
  const exact = countryAliases.get(normalized);
  if (exact) return exact;
  const upperTokens = value.match(/\b[A-Z]{2,3}\b/g) ?? [];
  for (const token of upperTokens) {
    const country = countryAliases.get(key(token));
    if (country) return country;
  }
  return [...COUNTRIES]
    .flatMap((country) => country.aliases.filter((alias) => key(alias).length >= 4).map((alias) => ({ country, alias })))
    .sort((a, b) => b.alias.length - a.alias.length)
    .find(({ alias }) => phraseMatch(value, alias))?.country ?? null;
}

export function resolveRegion(value: string | null | undefined) {
  if (!value) return null;
  const exact = regionAliases.get(key(value));
  if (exact) return exact;
  return REGIONS
    .flatMap((region) => region.aliases.map((alias) => ({ region, alias })))
    .sort((a, b) => b.alias.length - a.alias.length)
    .find(({ alias }) => phraseMatch(value, alias))?.region ?? null;
}

export function countriesForRegion(regionCode: string) {
  return REGIONS.find((region) => region.code === regionCode.toUpperCase())?.countryCodes ?? [];
}

export function countryInRegion(countryCode: string, regionCode: string) {
  return countriesForRegion(regionCode).includes(countryCode.toUpperCase());
}

function resolveSubdivision(raw: string, countryCode: string | null) {
  const matches = [...subdivisionsByAlias.entries()]
    .filter(([alias]) => alias.length >= 3 && phraseMatch(raw, alias))
    .flatMap(([, subdivisions]) => subdivisions)
    .filter((subdivision) => !countryCode || subdivision.countryCode === countryCode)
    .sort((a, b) => b.name.length - a.name.length);
  if (!matches.length) return null;
  if (!countryCode && new Set(matches.map((match) => match.countryCode)).size > 1) return null;
  return matches[0];
}

function resolveCity(raw: string, countryCode: string | null) {
  const matches = CITIES
    .flatMap((city) => city.aliases.map((alias) => ({ city, alias })))
    .filter(({ city, alias }) => (!countryCode || city.countryCode === countryCode) && phraseMatch(raw, alias))
    .sort((a, b) => b.alias.length - a.alias.length);
  if (!matches.length) return null;
  if (!countryCode && new Set(matches.map(({ city }) => city.countryCode)).size > 1) return null;
  return matches[0].city;
}

function cityCandidate(raw: string, country: CountryRecord | null, subdivision: SubdivisionRecord | null, region: RegionRecord | null) {
  const first = raw.split(/[,;|]/)[0]?.replace(/\b(remote|hybrid|onsite|on-site)\b/gi, "").replace(/[—–-]+/g, " ").trim();
  if (!first || key(first).length < 2) return null;
  if (country && country.aliases.some((alias) => key(alias) === key(first))) return null;
  if (region && region.aliases.some((alias) => key(alias) === key(first))) return null;
  if (/^(anywhere|global|worldwide|multiple locations)$/i.test(first)) return null;
  return subdivision?.name === first || !subdivision ? first : null;
}

export function normalizeGeographicLocation(raw: string): GeographicLocation {
  const country = resolveCountry(raw);
  const region = resolveRegion(raw);
  // Region acronyms can also be legitimate subdivision names (for example APAC
  // is a district in Uganda). Without a country signal, the explicit region
  // meaning wins so a regional remote policy is never converted into a country.
  const subdivision = country || !region ? resolveSubdivision(raw, country?.code ?? null) : null;
  const city = resolveCity(raw, country?.code ?? subdivision?.countryCode ?? null);
  const countryCode = country?.code ?? subdivision?.countryCode ?? city?.countryCode ?? null;
  const derivedRegions = countryCode
    ? REGIONS.filter((candidate) => candidate.code !== "WORLDWIDE" && candidate.countryCodes.includes(countryCode)).map((candidate) => candidate.code)
    : [];
  const timezoneMatch = COUNTRIES.flatMap((candidate) => candidate.timezones).find((timezone) => raw.includes(timezone.name));
  const countryTimezones = countryCode ? countryByCode.get(countryCode)?.timezones ?? [] : [];
  const timezone = timezoneMatch?.name ?? city?.timezone ?? (countryTimezones.length === 1 ? countryTimezones[0].name : null);
  const evidence = [
    country ? `Country matched ${country.name} (${country.code}).` : "Country was not stated unambiguously.",
    subdivision ? `Subdivision matched ${subdivision.name} (${subdivision.code}).` : null,
    city ? `City matched ${city.name}.` : null,
    region ? `Region matched ${region.name} (${region.code}).` : null,
    timezoneMatch ? `Timezone matched ${timezoneMatch.name}.` : null,
  ].filter((value): value is string => Boolean(value));
  return {
    raw,
    city: city?.name ?? cityCandidate(raw, country, subdivision, region),
    subdivisionCode: subdivision?.code ?? city?.subdivisionCode ?? null,
    countryCode,
    regionCodes: [...new Set([...(region ? [region.code] : []), ...derivedRegions])].sort(),
    timezone,
    confidence: country || region ? 0.9 : city ? 0.85 : subdivision ? 0.82 : 0.25,
    evidence,
  };
}
