use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, sync::LazyLock};
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimezoneRecord {
    pub name: String,
    pub utc_offset_hours: f64,
    pub dst_offset_hours: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountryRecord {
    pub code: String,
    pub alpha3: String,
    pub numeric: String,
    pub name: String,
    pub official_name: String,
    pub aliases: Vec<String>,
    pub region: Option<String>,
    pub subregion: Option<String>,
    pub timezones: Vec<TimezoneRecord>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubdivisionRecord {
    pub code: String,
    pub country_code: String,
    pub name: String,
    pub r#type: Option<String>,
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionRecord {
    pub code: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub country_codes: Vec<String>,
    pub definition: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CityRecord {
    pub name: String,
    pub aliases: Vec<String>,
    pub country_code: String,
    pub subdivision_code: Option<String>,
    pub timezone: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GeographicLocation {
    pub raw: String,
    pub city: Option<String>,
    pub subdivision_code: Option<String>,
    pub country_code: Option<String>,
    pub region_codes: Vec<String>,
    pub timezone: Option<String>,
    pub confidence: f64,
    pub evidence: Vec<String>,
}

pub static COUNTRIES: LazyLock<Vec<CountryRecord>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../shared/geography/countries.json"))
        .expect("generated country data must be valid")
});
pub static SUBDIVISIONS: LazyLock<Vec<SubdivisionRecord>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../shared/geography/subdivisions.json"))
        .expect("generated subdivision data must be valid")
});
pub static CITIES: LazyLock<Vec<CityRecord>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../shared/geography/cities.json"))
        .expect("generated city data must be valid")
});
pub static REGIONS: LazyLock<Vec<RegionRecord>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../shared/geography/regions.json"))
        .expect("generated region data must be valid")
});
static UPPER_CODE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b[A-Z]{2,3}\b").expect("static regex"));

fn key(value: &str) -> String {
    value
        .nfkd()
        .filter(|character| !unicode_normalization::char::is_combining_mark(*character))
        .flat_map(char::to_lowercase)
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '+' | '/' | '-') {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn phrase_match(raw: &str, alias: &str) -> bool {
    let normalized_alias = key(alias);
    normalized_alias.len() >= 3
        && format!(" {} ", key(raw)).contains(&format!(" {normalized_alias} "))
}

pub fn country_by_code(code: &str) -> Option<&'static CountryRecord> {
    COUNTRIES
        .iter()
        .find(|country| country.code.eq_ignore_ascii_case(code))
}

pub fn resolve_country(value: &str) -> Option<&'static CountryRecord> {
    let normalized = key(value);
    if let Some(country) = COUNTRIES
        .iter()
        .find(|country| country.aliases.iter().any(|alias| key(alias) == normalized))
    {
        return Some(country);
    }
    for token in UPPER_CODE.find_iter(value) {
        if let Some(country) = COUNTRIES.iter().find(|country| {
            country
                .aliases
                .iter()
                .any(|alias| key(alias) == key(token.as_str()))
        }) {
            return Some(country);
        }
    }
    COUNTRIES
        .iter()
        .flat_map(|country| {
            country
                .aliases
                .iter()
                .filter(|alias| key(alias).len() >= 4)
                .map(move |alias| (country, alias))
        })
        .filter(|(_, alias)| phrase_match(value, alias))
        .max_by_key(|(_, alias)| alias.len())
        .map(|(country, _)| country)
}

pub fn resolve_region(value: &str) -> Option<&'static RegionRecord> {
    let normalized = key(value);
    REGIONS
        .iter()
        .flat_map(|region| region.aliases.iter().map(move |alias| (region, alias)))
        .filter(|(_, alias)| key(alias) == normalized || phrase_match(value, alias))
        .max_by_key(|(_, alias)| alias.len())
        .map(|(region, _)| region)
}

pub fn country_in_region(country_code: &str, region_code: &str) -> bool {
    REGIONS.iter().any(|region| {
        region.code.eq_ignore_ascii_case(region_code)
            && region
                .country_codes
                .iter()
                .any(|code| code.eq_ignore_ascii_case(country_code))
    })
}

fn resolve_subdivision(
    value: &str,
    country_code: Option<&str>,
) -> Option<&'static SubdivisionRecord> {
    let matches = SUBDIVISIONS
        .iter()
        .filter(|subdivision| {
            country_code.is_none_or(|country| subdivision.country_code == country)
                && subdivision
                    .aliases
                    .iter()
                    .any(|alias| key(alias).len() >= 3 && phrase_match(value, alias))
        })
        .collect::<Vec<_>>();
    if matches.is_empty() {
        return None;
    }
    if country_code.is_none()
        && matches
            .iter()
            .map(|subdivision| &subdivision.country_code)
            .collect::<BTreeSet<_>>()
            .len()
            > 1
    {
        return None;
    }
    matches
        .into_iter()
        .max_by_key(|subdivision| subdivision.name.len())
}

fn resolve_city(value: &str, country_code: Option<&str>) -> Option<&'static CityRecord> {
    let matches = CITIES
        .iter()
        .flat_map(|city| city.aliases.iter().map(move |alias| (city, alias)))
        .filter(|(city, alias)| {
            country_code.is_none_or(|country| city.country_code == country)
                && phrase_match(value, alias)
        })
        .collect::<Vec<_>>();
    if matches.is_empty() {
        return None;
    }
    if country_code.is_none()
        && matches
            .iter()
            .map(|(city, _)| &city.country_code)
            .collect::<BTreeSet<_>>()
            .len()
            > 1
    {
        return None;
    }
    matches
        .into_iter()
        .max_by_key(|(_, alias)| alias.len())
        .map(|(city, _)| city)
}

fn city_candidate(
    raw: &str,
    country: Option<&CountryRecord>,
    subdivision: Option<&SubdivisionRecord>,
    region: Option<&RegionRecord>,
) -> Option<String> {
    let first = raw.split([',', ';', '|']).next()?.replace(['—', '–'], " ");
    let remote = Regex::new(r"(?i)\b(remote|hybrid|onsite|on-site)\b").expect("static regex");
    let first = remote.replace_all(&first, "").trim().to_string();
    if key(&first).len() < 2
        || country.is_some_and(|value| value.aliases.iter().any(|alias| key(alias) == key(&first)))
        || region.is_some_and(|value| value.aliases.iter().any(|alias| key(alias) == key(&first)))
        || matches!(
            key(&first).as_str(),
            "anywhere" | "global" | "worldwide" | "multiple locations"
        )
    {
        return None;
    }
    if subdivision.is_none_or(|value| value.name == first) {
        Some(first)
    } else {
        None
    }
}

pub fn normalize_location(raw: &str) -> GeographicLocation {
    let country = resolve_country(raw);
    let region = resolve_region(raw);
    // Region acronyms can also be real subdivision names (APAC is a district
    // in Uganda). An explicit region therefore wins unless a country anchors
    // the subdivision interpretation.
    let subdivision = if country.is_some() || region.is_none() {
        resolve_subdivision(raw, country.map(|value| value.code.as_str()))
    } else {
        None
    };
    let city = resolve_city(
        raw,
        country
            .map(|value| value.code.as_str())
            .or_else(|| subdivision.map(|value| value.country_code.as_str())),
    );
    let country_code = country
        .map(|value| value.code.clone())
        .or_else(|| subdivision.map(|value| value.country_code.clone()))
        .or_else(|| city.map(|value| value.country_code.clone()));
    let mut region_codes = REGIONS
        .iter()
        .filter(|candidate| {
            candidate.code != "WORLDWIDE"
                && country_code
                    .as_ref()
                    .is_some_and(|code| candidate.country_codes.contains(code))
        })
        .map(|candidate| candidate.code.clone())
        .collect::<BTreeSet<_>>();
    if let Some(region) = region {
        region_codes.insert(region.code.clone());
    }
    let timezone_match = COUNTRIES
        .iter()
        .flat_map(|candidate| &candidate.timezones)
        .find(|timezone| raw.contains(&timezone.name));
    let country_timezones = country_code
        .as_deref()
        .and_then(country_by_code)
        .map(|country| &country.timezones);
    let timezone = timezone_match
        .map(|value| value.name.clone())
        .or_else(|| city.map(|value| value.timezone.clone()))
        .or_else(|| {
            country_timezones
                .filter(|timezones| timezones.len() == 1)
                .map(|timezones| timezones[0].name.clone())
        });
    let mut evidence = vec![country.map_or_else(
        || "Country was not stated unambiguously.".to_string(),
        |country| format!("Country matched {} ({}).", country.name, country.code),
    )];
    if let Some(subdivision) = subdivision {
        evidence.push(format!(
            "Subdivision matched {} ({}).",
            subdivision.name, subdivision.code
        ));
    }
    if let Some(city) = city {
        evidence.push(format!("City matched {}.", city.name));
    }
    if let Some(region) = region {
        evidence.push(format!("Region matched {} ({}).", region.name, region.code));
    }
    if let Some(timezone) = timezone_match {
        evidence.push(format!("Timezone matched {}.", timezone.name));
    }
    GeographicLocation {
        raw: raw.to_string(),
        city: city
            .map(|value| value.name.clone())
            .or_else(|| city_candidate(raw, country, subdivision, region)),
        subdivision_code: subdivision
            .map(|value| value.code.clone())
            .or_else(|| city.and_then(|value| value.subdivision_code.clone())),
        country_code: country_code.clone(),
        region_codes: region_codes.into_iter().collect(),
        timezone,
        confidence: if country.is_some() || region.is_some() {
            0.9
        } else if city.is_some() {
            0.85
        } else if subdivision.is_some() {
            0.82
        } else {
            0.25
        },
        evidence,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_standards_data_and_resolves_global_regions() {
        assert_eq!(COUNTRIES.len(), 249);
        assert!(SUBDIVISIONS.len() > 5_000);
        assert_eq!(
            resolve_country("IND").map(|country| country.code.as_str()),
            Some("IN")
        );
        assert!(country_in_region("DE", "EU"));
        assert!(!country_in_region("GB", "EU"));
        assert!(country_in_region("BR", "LATAM"));
        assert!(country_in_region("JP", "APAC"));
    }

    #[test]
    fn normalizes_country_subdivision_region_and_timezone() {
        let india = normalize_location("Bengaluru, India");
        assert_eq!(india.country_code.as_deref(), Some("IN"));
        assert_eq!(india.city.as_deref(), Some("Bengaluru"));
        assert_eq!(india.timezone.as_deref(), Some("Asia/Kolkata"));
        assert!(india.region_codes.contains(&"APAC".to_string()));

        let california = normalize_location("California, United States");
        assert_eq!(california.subdivision_code.as_deref(), Some("US-CA"));
        assert_eq!(california.country_code.as_deref(), Some("US"));

        let apac = normalize_location("Remote — APAC");
        assert_eq!(apac.country_code, None);
        assert!(apac.region_codes.contains(&"APAC".to_string()));
    }
}
