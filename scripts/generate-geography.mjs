import { mkdirSync, writeFileSync } from "node:fs";
import worldCountries from "world-countries";
import { getTimezonesForCountry } from "countries-and-timezones";
import { allSubdivisions } from "@koshmoney/countries";

const outputDirectory = "shared/geography";
mkdirSync(outputDirectory, { recursive: true });

const unique = (values) => [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const countries = worldCountries
  .filter((country) => country.status === "officially-assigned" && /^[A-Z]{2}$/.test(country.cca2))
  .map((country) => ({
    code: country.cca2,
    alpha3: country.cca3,
    numeric: country.ccn3,
    name: country.name.common,
    officialName: country.name.official,
    aliases: unique([
      country.cca2,
      country.cca3,
      country.name.common,
      country.name.official,
      ...country.altSpellings,
      ...Object.values(country.name.native ?? {}).flatMap((name) => [name.common, name.official]),
      ...Object.values(country.translations ?? {}).flatMap((name) => [name.common, name.official]),
    ]),
    region: country.region || null,
    subregion: country.subregion || null,
    timezones: (getTimezonesForCountry(country.cca2) ?? []).map((timezone) => ({
      name: timezone.name,
      utcOffsetHours: timezone.utcOffset / 60,
      dstOffsetHours: timezone.dstOffset / 60,
    })),
  }))
  .sort((a, b) => a.code.localeCompare(b.code));

const subdivisions = allSubdivisions()
  .filter((subdivision) => /^[A-Z]{2}-/.test(subdivision.code))
  .map((subdivision) => ({
    code: subdivision.code,
    countryCode: subdivision.countryCode,
    name: subdivision.name,
    type: subdivision.type || null,
    aliases: unique([subdivision.code, subdivision.regionCode, subdivision.name]),
  }))
  .sort((a, b) => a.code.localeCompare(b.code));

// Employer ATS records frequently omit the country for a major hiring hub.
// This intentionally small, globally distributed alias layer is centralized
// here; unknown cities remain unknown instead of being guessed.
const cities = [
  ["Bengaluru", ["Bengaluru", "Bangalore"], "IN", "IN-KA", "Asia/Kolkata"],
  ["Hyderabad", ["Hyderabad"], "IN", "IN-TG", "Asia/Kolkata"],
  ["Mumbai", ["Mumbai", "Bombay"], "IN", "IN-MH", "Asia/Kolkata"],
  ["Pune", ["Pune"], "IN", "IN-MH", "Asia/Kolkata"],
  ["New York", ["New York", "New York City", "NYC"], "US", "US-NY", "America/New_York"],
  ["Toronto", ["Toronto"], "CA", "CA-ON", "America/Toronto"],
  ["Vancouver", ["Vancouver"], "CA", "CA-BC", "America/Vancouver"],
  ["São Paulo", ["São Paulo", "Sao Paulo"], "BR", "BR-SP", "America/Sao_Paulo"],
  ["Berlin", ["Berlin"], "DE", "DE-BE", "Europe/Berlin"],
  ["Paris", ["Paris"], "FR", "FR-IDF", "Europe/Paris"],
  ["Warsaw", ["Warsaw", "Warszawa"], "PL", "PL-MZ", "Europe/Warsaw"],
  ["London", ["London"], "GB", "GB-ENG", "Europe/London"],
  ["Lagos", ["Lagos"], "NG", "NG-LA", "Africa/Lagos"],
  ["Johannesburg", ["Johannesburg"], "ZA", "ZA-GT", "Africa/Johannesburg"],
  ["Cape Town", ["Cape Town"], "ZA", "ZA-WC", "Africa/Johannesburg"],
  ["Dubai", ["Dubai"], "AE", "AE-DU", "Asia/Dubai"],
  ["Singapore", ["Singapore"], "SG", null, "Asia/Singapore"],
  ["Tokyo", ["Tokyo", "Tōkyō"], "JP", "JP-13", "Asia/Tokyo"],
  ["Sydney", ["Sydney"], "AU", "AU-NSW", "Australia/Sydney"],
  ["Melbourne", ["Melbourne"], "AU", "AU-VIC", "Australia/Melbourne"],
].map(([name, aliases, countryCode, subdivisionCode, timezone]) => ({ name, aliases: unique(aliases), countryCode, subdivisionCode, timezone }));

const codesWhere = (predicate) => countries.filter(predicate).map((country) => country.code);
const EU = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];
const regions = [
  { code: "WORLDWIDE", name: "Worldwide", aliases: ["anywhere", "global", "worldwide", "work from anywhere"], countryCodes: countries.map((country) => country.code), definition: "All ISO 3166-1 officially assigned countries and territories." },
  { code: "EU", name: "European Union", aliases: ["EU", "European Union"], countryCodes: EU, definition: "Current European Union member states, maintained centrally by RoleAtlas." },
  { code: "EEA", name: "European Economic Area", aliases: ["EEA", "European Economic Area"], countryCodes: unique([...EU, "IS", "LI", "NO"]), definition: "EU member states plus Iceland, Liechtenstein, and Norway." },
  { code: "EFTA", name: "European Free Trade Association", aliases: ["EFTA", "European Free Trade Association"], countryCodes: ["CH", "IS", "LI", "NO"], definition: "EFTA member states." },
  { code: "DACH", name: "DACH", aliases: ["DACH"], countryCodes: ["AT", "CH", "DE"], definition: "Germany, Austria, and Switzerland." },
  { code: "GCC", name: "Gulf Cooperation Council", aliases: ["GCC", "Gulf Cooperation Council"], countryCodes: ["AE", "BH", "KW", "OM", "QA", "SA"], definition: "Gulf Cooperation Council member states." },
  { code: "ASEAN", name: "Association of Southeast Asian Nations", aliases: ["ASEAN", "Southeast Asia"], countryCodes: ["BN", "KH", "ID", "LA", "MY", "MM", "PH", "SG", "TH", "VN"], definition: "ASEAN member states." },
  { code: "APAC", name: "Asia Pacific", aliases: ["APAC", "Asia Pacific", "Asia-Pacific"], countryCodes: codesWhere((country) => country.region === "Asia" || country.region === "Oceania"), definition: "Operational hiring region: ISO countries and territories in the UN-style Asia or Oceania regions." },
  { code: "EMEA", name: "Europe, Middle East and Africa", aliases: ["EMEA", "Europe Middle East and Africa"], countryCodes: codesWhere((country) => country.region === "Europe" || country.region === "Africa" || country.subregion === "Western Asia"), definition: "Operational hiring region: Europe, Africa, and Western Asia. This is not a political organization." },
  { code: "LATAM", name: "Latin America and the Caribbean", aliases: ["LATAM", "Latin America", "Latin America and the Caribbean"], countryCodes: codesWhere((country) => ["South America", "Central America", "Caribbean"].includes(country.subregion)), definition: "Operational hiring region: South America, Central America, and the Caribbean." },
  { code: "MENA", name: "Middle East and North Africa", aliases: ["MENA", "Middle East and North Africa"], countryCodes: codesWhere((country) => country.subregion === "Northern Africa" || country.subregion === "Western Asia"), definition: "Operational hiring region: Northern Africa and Western Asia." },
  ...["Africa", "Americas", "Asia", "Europe", "Oceania"].map((region) => ({ code: region.toUpperCase(), name: region, aliases: [region], countryCodes: codesWhere((country) => country.region === region), definition: `ISO countries and territories whose source dataset region is ${region}.` })),
].map((region) => ({ ...region, aliases: unique(region.aliases), countryCodes: unique(region.countryCodes) }));

for (const city of cities) {
  const country = countries.find((candidate) => candidate.code === city.countryCode);
  if (!country) throw new Error(`Unknown city country ${city.countryCode} for ${city.name}`);
  if (city.subdivisionCode && !subdivisions.some((candidate) => candidate.code === city.subdivisionCode)) {
    throw new Error(`Unknown subdivision ${city.subdivisionCode} for ${city.name}`);
  }
  if (!country.timezones.some((timezone) => timezone.name === city.timezone)) {
    throw new Error(`Unknown timezone ${city.timezone} for ${city.name}`);
  }
}

const metadata = {
  generatedBy: "npm run geography:generate",
  standards: [
    "ISO 3166-1 country codes",
    "ISO 3166-2 subdivision codes",
    "IANA timezone names",
  ],
  dataSources: {
    countries: "world-countries@5.1.0",
    subdivisions: "@koshmoney/countries@1.0.1-beta.1",
    timezones: "countries-and-timezones@3.9.0",
  },
};

for (const [name, value] of Object.entries({ metadata, countries, subdivisions, cities, regions })) {
  writeFileSync(`${outputDirectory}/${name}.json`, `${JSON.stringify(value, null, 2)}\n`);
}
console.log(`Generated ${countries.length} countries, ${subdivisions.length} subdivisions, ${cities.length} verified city aliases, and ${regions.length} regions.`);
