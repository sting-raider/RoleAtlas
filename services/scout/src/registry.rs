use crate::geography;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::LazyLock};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryCompany {
    pub name: String,
    pub domain: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpportunityHistory {
    pub categories: Vec<String>,
    pub observed_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHistory {
    pub scopes: Vec<String>,
    pub observed_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryVerification {
    pub method: String,
    pub result: String,
    pub observed_jobs: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrySource {
    pub id: String,
    pub company: RegistryCompany,
    pub careers_url: String,
    pub adapter: String,
    pub board_id: String,
    pub endpoint_url: String,
    pub headquarters_country_code: Option<String>,
    pub hiring_country_codes: Vec<String>,
    pub hiring_region_codes: Vec<String>,
    pub known_city_locations: Vec<String>,
    pub opportunity_history: OpportunityHistory,
    pub remote_history: RemoteHistory,
    pub languages: Vec<String>,
    pub status: String,
    pub last_verified: String,
    pub verification: RegistryVerification,
    pub proposed_by: Option<String>,
    pub auto_enqueue: bool,
    pub notes: String,
}

pub static SOURCES: LazyLock<Vec<RegistrySource>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../sources/registry/global.json"))
        .expect("validated global source registry must be valid")
});

pub fn enabled_sources() -> impl Iterator<Item = &'static RegistrySource> {
    SOURCES
        .iter()
        .filter(|source| source.status == "verified" && source.auto_enqueue)
}

pub fn supports_geography(
    source: &RegistrySource,
    country_codes: &[String],
    region_codes: &[String],
) -> bool {
    if country_codes.is_empty() && region_codes.is_empty() {
        return true;
    }
    country_codes.iter().any(|country| {
        source.hiring_country_codes.contains(country)
            || source
                .hiring_region_codes
                .iter()
                .any(|region| geography::country_in_region(country, region))
    }) || region_codes.iter().any(|region| {
        source.hiring_region_codes.contains(region)
            || source
                .hiring_country_codes
                .iter()
                .any(|country| geography::country_in_region(country, region))
    })
}

pub fn static_statistics() -> serde_json::Value {
    let count_by = |values: Vec<String>| {
        let mut counts = BTreeMap::<String, u64>::new();
        for value in values {
            *counts.entry(value).or_default() += 1;
        }
        counts
    };
    serde_json::json!({
        "totalSources": SOURCES.len(),
        "enabledSources": enabled_sources().count(),
        "byAdapter": count_by(SOURCES.iter().map(|source| source.adapter.clone()).collect()),
        "byCountry": count_by(SOURCES.iter().flat_map(|source| source.hiring_country_codes.clone()).collect()),
        "byRegion": count_by(SOURCES.iter().flat_map(|source| source.hiring_region_codes.clone()).collect()),
        "withEarlyCareerHistory": SOURCES.iter().filter(|source| source.opportunity_history.observed_count > 0).count(),
        "withRemoteHistory": SOURCES.iter().filter(|source| source.remote_history.observed_count > 0).count(),
        "coverageClaim": "Configured and successfully checked sources only; this is not full market coverage."
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_only_verified_compatible_sources_by_default() {
        assert_eq!(SOURCES.len(), 16);
        assert_eq!(enabled_sources().count(), 16);
        for source in enabled_sources() {
            assert_eq!(source.verification.result, "success");
            assert!(source.verification.observed_jobs > 0);
            assert_eq!(
                crate::identity::identify_source_url(&source.endpoint_url).id,
                source.id
            );
            assert!(
                source
                    .hiring_country_codes
                    .iter()
                    .all(|code| geography::country_by_code(code).is_some())
            );
        }
    }

    #[test]
    fn selects_sources_for_global_country_and_region_models() {
        let sources = enabled_sources().collect::<Vec<_>>();
        assert!(
            sources
                .iter()
                .any(|source| supports_geography(source, &["IN".into()], &[]))
        );
        assert!(
            sources
                .iter()
                .any(|source| supports_geography(source, &["DE".into()], &[]))
        );
        assert!(sources.iter().any(|source| supports_geography(
            source,
            &["BR".into()],
            &["LATAM".into()]
        )));
        assert!(
            !sources
                .iter()
                .all(|source| supports_geography(source, &["NZ".into()], &[]))
        );
    }
}
