use crate::geography::{
    self, GeographicLocation, country_in_region, mentioned_countries, mentioned_regions,
    normalize_location,
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::sync::LazyLock;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CandidateMobility {
    pub residence_country_code: Option<String>,
    #[serde(default)]
    pub citizenship_country_codes: Vec<String>,
    #[serde(default)]
    pub work_authorized_country_codes: Vec<String>,
    #[serde(default)]
    pub requires_sponsorship_country_codes: Vec<String>,
    #[serde(default)]
    pub preferred_country_codes: Vec<String>,
    #[serde(default)]
    pub excluded_country_codes: Vec<String>,
    #[serde(default)]
    pub preferred_cities: Vec<GeographicLocation>,
    #[serde(default)]
    pub willing_to_relocate: bool,
    #[serde(default)]
    pub relocation_country_codes: Vec<String>,
    #[serde(default)]
    pub preferred_timezones: Vec<String>,
    pub maximum_timezone_difference_hours: Option<f64>,
    #[serde(default)]
    pub inferred_fields: Vec<String>,
    #[serde(default)]
    pub confirmed_fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkMode {
    Remote,
    Hybrid,
    Onsite,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RemoteScope {
    Worldwide,
    Countries,
    Region,
    Timezone,
    LocationRestricted,
    Unspecified,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UtcOffsetRange {
    pub minimum: f64,
    pub maximum: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemotePolicy {
    pub mode: WorkMode,
    pub scope: RemoteScope,
    pub eligible_country_codes: Vec<String>,
    pub excluded_country_codes: Vec<String>,
    pub eligible_region_codes: Vec<String>,
    pub excluded_region_codes: Vec<String>,
    pub excluded_subdivision_codes: Vec<String>,
    pub required_timezones: Vec<String>,
    pub required_utc_offset_range: Option<UtcOffsetRange>,
    pub residency_requirements: Vec<String>,
    pub work_authorization_requirements: Vec<String>,
    pub sponsorship_available: Option<bool>,
    pub office_locations: Vec<GeographicLocation>,
    pub office_frequency: Option<String>,
    pub confidence: f64,
    pub evidence: Vec<String>,
    pub original_wording: String,
}

impl Default for RemotePolicy {
    fn default() -> Self {
        Self {
            mode: WorkMode::Unknown,
            scope: RemoteScope::Unspecified,
            eligible_country_codes: Vec::new(),
            excluded_country_codes: Vec::new(),
            eligible_region_codes: Vec::new(),
            excluded_region_codes: Vec::new(),
            excluded_subdivision_codes: Vec::new(),
            required_timezones: Vec::new(),
            required_utc_offset_range: None,
            residency_requirements: Vec::new(),
            work_authorization_requirements: Vec::new(),
            sponsorship_available: None,
            office_locations: Vec::new(),
            office_frequency: None,
            confidence: 0.2,
            evidence: vec!["The listing does not state a clear work-location policy.".into()],
            original_wording: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CandidateEligibility {
    Confirmed,
    Likely,
    Unclear,
    Excluded,
    RequiresSponsorship,
    RequiresRelocation,
    RequiresOfficeAttendance,
    TimezoneMismatch,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EligibilityDecision {
    pub status: CandidateEligibility,
    pub confidence: f64,
    pub evidence: Vec<String>,
}

static UTC_RANGE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)UTC\s*([+-]?\d{1,2}(?:\.\d+)?)\s*(?:to|through|[-–—])\s*UTC?\s*([+-]?\d{1,2}(?:\.\d+)?)")
        .expect("static UTC range regex")
});
static OFFICE_FREQUENCY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b((?:one|two|three|four|five|1|2|3|4|5)\s+days?\s+per\s+week|occasional(?:ly)?(?:\s+travel)?)\b")
        .expect("static office frequency regex")
});
static SENTENCE_SPLIT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\r\n.!?;]+").expect("static sentence regex"));

fn sorted(values: impl IntoIterator<Item = String>) -> Vec<String> {
    values
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn relevant_sentences(location: &str, description: &str) -> Vec<String> {
    let mut sentences = vec![location.trim().to_string()];
    sentences.extend(
        SENTENCE_SPLIT
            .split(description)
            .map(str::trim)
            .filter(|sentence| {
                let lower = sentence.to_lowercase();
                [
                    "remote",
                    "hybrid",
                    "onsite",
                    "on-site",
                    "office",
                    "reside",
                    "residency",
                    "eligible",
                    "available in",
                    "candidates in",
                    "work authorization",
                    "work permit",
                    "sponsor",
                    "visa",
                    "timezone",
                    "time zone",
                    "utc",
                    "pacific time",
                    "eastern time",
                    "central time",
                    "mountain time",
                    "travel to",
                ]
                .iter()
                .any(|signal| lower.contains(signal))
            })
            .map(ToOwned::to_owned),
    );
    sentences.retain(|sentence| !sentence.is_empty());
    sentences.dedup();
    sentences
}

fn is_exclusion(sentence: &str) -> bool {
    let lower = sentence.to_lowercase();
    [
        "not available in",
        "not eligible in",
        "excluding",
        "except for",
        "cannot reside in",
    ]
    .iter()
    .any(|signal| lower.contains(signal))
}

fn is_geographic_constraint(sentence: &str) -> bool {
    let lower = sentence.to_lowercase();
    [
        "only",
        "within",
        "candidates in",
        "eligible",
        "must reside",
        "must be based",
        "open to",
        "across",
        "remote —",
        "remote -",
        "remote in",
        "remote from",
    ]
    .iter()
    .any(|signal| lower.contains(signal))
}

fn timezone_aliases(sentence: &str) -> Vec<String> {
    let lower = sentence.to_lowercase();
    [
        ("pacific time", "America/Los_Angeles"),
        ("eastern time", "America/New_York"),
        ("central time", "America/Chicago"),
        ("mountain time", "America/Denver"),
        ("greenwich mean time", "Etc/GMT"),
        ("india standard time", "Asia/Kolkata"),
        ("central european time", "Europe/Berlin"),
    ]
    .into_iter()
    .filter(|(alias, _)| lower.contains(alias))
    .map(|(_, timezone)| timezone.to_string())
    .collect()
}

pub fn parse_remote_policy(
    location: Option<&str>,
    description: &str,
    remote_signal: bool,
) -> RemotePolicy {
    let location = location.unwrap_or_default();
    let sentences = relevant_sentences(location, description);
    let original_wording = sentences.join(" ");
    let lower = original_wording.to_lowercase();
    if original_wording.is_empty() && !remote_signal {
        return RemotePolicy::default();
    }

    let mode = if lower.contains("hybrid")
        || (lower.contains("office") && OFFICE_FREQUENCY.is_match(&lower))
    {
        WorkMode::Hybrid
    } else if lower.contains("onsite") || lower.contains("on-site") || lower.contains("on site") {
        WorkMode::Onsite
    } else if remote_signal
        || lower.contains("remote")
        || lower.contains("work from anywhere")
        || lower.contains("work from home")
    {
        WorkMode::Remote
    } else {
        WorkMode::Unknown
    };

    let mut eligible_countries = BTreeSet::new();
    let mut excluded_countries = BTreeSet::new();
    let mut eligible_regions = BTreeSet::new();
    let mut excluded_regions = BTreeSet::new();
    let mut excluded_subdivisions = BTreeSet::new();
    let mut evidence = Vec::new();
    let mut office_locations = Vec::new();
    let mut residency_requirements = Vec::new();
    let mut work_authorization_requirements = Vec::new();
    let mut required_timezones = BTreeSet::new();

    for sentence in &sentences {
        let lower_sentence = sentence.to_lowercase();
        let exclusion = is_exclusion(sentence);
        if exclusion || is_geographic_constraint(sentence) {
            for country in mentioned_countries(sentence) {
                if exclusion {
                    excluded_countries.insert(country.code.clone());
                } else {
                    eligible_countries.insert(country.code.clone());
                }
            }
            for region in mentioned_regions(sentence) {
                if region.code == "WORLDWIDE" {
                    continue;
                }
                if exclusion {
                    excluded_regions.insert(region.code.clone());
                } else {
                    eligible_regions.insert(region.code.clone());
                }
            }
            let normalized = normalize_location(sentence);
            if exclusion {
                if let Some(code) = normalized.subdivision_code {
                    excluded_subdivisions.insert(code);
                }
            }
            evidence.push(sentence.clone());
        }
        if lower_sentence.contains("must reside") || lower_sentence.contains("residency") {
            residency_requirements.push(sentence.clone());
        }
        if lower_sentence.contains("work authorization") || lower_sentence.contains("work permit") {
            work_authorization_requirements.push(sentence.clone());
        }
        for timezone in timezone_aliases(sentence) {
            required_timezones.insert(timezone);
        }
        if matches!(mode, WorkMode::Hybrid | WorkMode::Onsite)
            || lower_sentence.contains("travel to")
            || lower_sentence.contains("office required")
        {
            let normalized = normalize_location(sentence);
            if normalized.country_code.is_some() || normalized.city.is_some() {
                office_locations.push(normalized);
            }
        }
    }

    let worldwide = lower.contains("remote worldwide")
        || lower.contains("work from anywhere")
        || lower.contains("worldwide remote")
        || lower.trim() == "worldwide";
    let required_utc_offset_range = UTC_RANGE.captures(&original_wording).and_then(|captures| {
        Some(UtcOffsetRange {
            minimum: captures.get(1)?.as_str().parse().ok()?,
            maximum: captures.get(2)?.as_str().parse().ok()?,
        })
    });
    let sponsorship_available = if [
        "no sponsorship",
        "sponsorship is not available",
        "unable to sponsor",
        "cannot sponsor",
    ]
    .iter()
    .any(|signal| lower.contains(signal))
    {
        Some(false)
    } else if [
        "sponsorship is available",
        "visa sponsorship available",
        "can sponsor",
    ]
    .iter()
    .any(|signal| lower.contains(signal))
    {
        Some(true)
    } else {
        None
    };
    let office_frequency = OFFICE_FREQUENCY
        .find(&original_wording)
        .map(|matched| matched.as_str().to_string());
    let scope = if worldwide {
        RemoteScope::Worldwide
    } else if !eligible_countries.is_empty() {
        RemoteScope::Countries
    } else if !eligible_regions.is_empty() {
        RemoteScope::Region
    } else if !required_timezones.is_empty() || required_utc_offset_range.is_some() {
        RemoteScope::Timezone
    } else if matches!(mode, WorkMode::Hybrid | WorkMode::Onsite) || !office_locations.is_empty() {
        RemoteScope::LocationRestricted
    } else {
        RemoteScope::Unspecified
    };
    if evidence.is_empty() {
        evidence.push(match scope {
            RemoteScope::Unspecified => {
                "Remote scope was not stated; RoleAtlas does not assume worldwide eligibility."
                    .into()
            }
            _ => original_wording.clone(),
        });
    }
    let confidence = if matches!(scope, RemoteScope::Unspecified) {
        0.45
    } else {
        0.92
    };

    RemotePolicy {
        mode,
        scope,
        eligible_country_codes: eligible_countries.into_iter().collect(),
        excluded_country_codes: excluded_countries.into_iter().collect(),
        eligible_region_codes: eligible_regions.into_iter().collect(),
        excluded_region_codes: excluded_regions.into_iter().collect(),
        excluded_subdivision_codes: excluded_subdivisions.into_iter().collect(),
        required_timezones: required_timezones.into_iter().collect(),
        required_utc_offset_range,
        residency_requirements,
        work_authorization_requirements,
        sponsorship_available,
        office_locations,
        office_frequency,
        confidence,
        evidence: sorted(evidence),
        original_wording,
    }
}

fn candidate_country(mobility: &CandidateMobility) -> Option<&str> {
    mobility
        .residence_country_code
        .as_deref()
        .or_else(|| mobility.preferred_country_codes.first().map(String::as_str))
}

fn timezone_offsets(timezone: &str) -> Vec<f64> {
    let mut offsets = geography::COUNTRIES
        .iter()
        .flat_map(|country| &country.timezones)
        .filter(|candidate| candidate.name == timezone)
        .flat_map(|candidate| [candidate.utc_offset_hours, candidate.dst_offset_hours])
        .collect::<Vec<_>>();
    offsets.sort_by(f64::total_cmp);
    offsets.dedup();
    offsets
}

pub fn evaluate_candidate(
    mobility: &CandidateMobility,
    policy: &RemotePolicy,
) -> EligibilityDecision {
    let country = candidate_country(mobility);
    let candidate_subdivisions = mobility
        .preferred_cities
        .iter()
        .filter_map(|location| location.subdivision_code.as_deref())
        .collect::<Vec<_>>();
    let job_country_codes = policy
        .eligible_country_codes
        .iter()
        .chain(
            policy
                .office_locations
                .iter()
                .filter_map(|location| location.country_code.as_ref()),
        )
        .collect::<BTreeSet<_>>();
    if job_country_codes
        .iter()
        .any(|code| mobility.excluded_country_codes.contains(code))
        || country.is_some_and(|code| {
            policy
                .excluded_country_codes
                .iter()
                .any(|excluded| excluded == code)
        })
        || candidate_subdivisions.iter().any(|code| {
            policy
                .excluded_subdivision_codes
                .iter()
                .any(|excluded| excluded == code)
        })
        || country.is_some_and(|code| {
            policy
                .excluded_region_codes
                .iter()
                .any(|region| country_in_region(code, region))
        })
    {
        return EligibilityDecision {
            status: CandidateEligibility::Excluded,
            confidence: policy.confidence,
            evidence: policy.evidence.clone(),
        };
    }

    let geography_matches = match policy.scope {
        RemoteScope::Worldwide => Some(true),
        RemoteScope::Countries => country.map(|code| {
            policy
                .eligible_country_codes
                .iter()
                .any(|eligible| eligible == code)
        }),
        RemoteScope::Region => country.map(|code| {
            policy
                .eligible_region_codes
                .iter()
                .any(|region| country_in_region(code, region))
        }),
        RemoteScope::Timezone | RemoteScope::Unspecified => None,
        RemoteScope::LocationRestricted => country.map(|code| {
            policy
                .office_locations
                .iter()
                .any(|location| location.country_code.as_deref() == Some(code))
        }),
    };
    if geography_matches == Some(false) && matches!(policy.mode, WorkMode::Remote) {
        return EligibilityDecision {
            status: CandidateEligibility::Excluded,
            confidence: policy.confidence,
            evidence: policy.evidence.clone(),
        };
    }

    let authorization_country = policy
        .eligible_country_codes
        .first()
        .map(String::as_str)
        .or(country);
    let authorization_required = !policy.work_authorization_requirements.is_empty()
        || !policy.residency_requirements.is_empty();
    if authorization_required
        && authorization_country.is_some_and(|code| {
            !mobility
                .work_authorized_country_codes
                .iter()
                .any(|authorized| authorized == code)
        })
    {
        let sponsorship_needed = authorization_country.is_some_and(|code| {
            mobility
                .requires_sponsorship_country_codes
                .iter()
                .any(|required| required == code)
        });
        return EligibilityDecision {
            status: if sponsorship_needed && policy.sponsorship_available == Some(true) {
                CandidateEligibility::RequiresSponsorship
            } else if sponsorship_needed && policy.sponsorship_available == Some(false) {
                CandidateEligibility::Excluded
            } else {
                CandidateEligibility::Unclear
            },
            confidence: policy.confidence,
            evidence: policy.evidence.clone(),
        };
    }

    if matches!(policy.mode, WorkMode::Hybrid) {
        let office_country = policy
            .office_locations
            .first()
            .and_then(|location| location.country_code.as_deref());
        if office_country.is_some_and(|code| country != Some(code)) {
            return EligibilityDecision {
                status: if mobility.willing_to_relocate
                    && (mobility.relocation_country_codes.is_empty()
                        || office_country.is_some_and(|code| {
                            mobility
                                .relocation_country_codes
                                .iter()
                                .any(|candidate| candidate == code)
                        })) {
                    CandidateEligibility::RequiresRelocation
                } else {
                    CandidateEligibility::Excluded
                },
                confidence: policy.confidence,
                evidence: policy.evidence.clone(),
            };
        }
        return EligibilityDecision {
            status: CandidateEligibility::RequiresOfficeAttendance,
            confidence: policy.confidence,
            evidence: policy.evidence.clone(),
        };
    }

    if matches!(policy.mode, WorkMode::Onsite) {
        let office_country = policy
            .office_locations
            .first()
            .and_then(|location| location.country_code.as_deref());
        if office_country != country {
            return EligibilityDecision {
                status: if mobility.willing_to_relocate {
                    CandidateEligibility::RequiresRelocation
                } else {
                    CandidateEligibility::Excluded
                },
                confidence: policy.confidence,
                evidence: policy.evidence.clone(),
            };
        }
    }

    if !policy.required_timezones.is_empty() {
        if mobility.preferred_timezones.is_empty() {
            return EligibilityDecision {
                status: CandidateEligibility::Unclear,
                confidence: policy.confidence,
                evidence: policy.evidence.clone(),
            };
        }
        if !mobility
            .preferred_timezones
            .iter()
            .any(|timezone| policy.required_timezones.contains(timezone))
        {
            return EligibilityDecision {
                status: CandidateEligibility::TimezoneMismatch,
                confidence: policy.confidence,
                evidence: policy.evidence.clone(),
            };
        }
    }
    if let Some(range) = &policy.required_utc_offset_range {
        if mobility.preferred_timezones.is_empty() {
            return EligibilityDecision {
                status: CandidateEligibility::Unclear,
                confidence: policy.confidence,
                evidence: policy.evidence.clone(),
            };
        }
        let fits = mobility
            .preferred_timezones
            .iter()
            .flat_map(|timezone| timezone_offsets(timezone))
            .any(|offset| offset >= range.minimum && offset <= range.maximum);
        if !fits {
            return EligibilityDecision {
                status: CandidateEligibility::TimezoneMismatch,
                confidence: policy.confidence,
                evidence: policy.evidence.clone(),
            };
        }
    }

    EligibilityDecision {
        status: if geography_matches == Some(true) && policy.confidence >= 0.8 {
            CandidateEligibility::Confirmed
        } else if geography_matches == Some(true) {
            CandidateEligibility::Likely
        } else {
            CandidateEligibility::Unclear
        },
        confidence: policy.confidence,
        evidence: policy.evidence.clone(),
    }
}

pub fn normalized_locations(location: Option<&str>) -> Vec<GeographicLocation> {
    location
        .filter(|value| !value.trim().is_empty())
        .map(|value| vec![normalize_location(value)])
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(value: &str) -> RemotePolicy {
        parse_remote_policy(Some(value), value, value.to_lowercase().contains("remote"))
    }

    fn india() -> CandidateMobility {
        CandidateMobility {
            residence_country_code: Some("IN".into()),
            preferred_country_codes: vec!["IN".into()],
            preferred_timezones: vec!["Asia/Kolkata".into()],
            ..CandidateMobility::default()
        }
    }

    #[test]
    fn parses_global_remote_scope_without_assuming_unspecified_is_worldwide() {
        assert_eq!(parse("Remote worldwide").scope, RemoteScope::Worldwide);
        assert_eq!(parse("Work from anywhere").scope, RemoteScope::Worldwide);
        assert_eq!(parse("Remote").scope, RemoteScope::Unspecified);
        assert_eq!(
            parse("Remote within India").eligible_country_codes,
            vec!["IN"]
        );
        assert_eq!(
            parse("US and Canada only").eligible_country_codes,
            vec!["CA", "US"]
        );
        assert_eq!(parse("Remote — APAC").eligible_region_codes, vec!["APAC"]);
        assert_eq!(
            parse("Open to candidates in the EU").eligible_region_codes,
            vec!["EU"]
        );
        assert_eq!(
            parse("Remote across Latin America").eligible_region_codes,
            vec!["LATAM"]
        );
        assert_eq!(parse("EMEA only").eligible_region_codes, vec!["EMEA"]);
    }

    #[test]
    fn parses_exclusions_authorization_sponsorship_timezones_and_offices() {
        assert_eq!(
            parse("Not available in India").excluded_country_codes,
            vec!["IN"]
        );
        assert_eq!(
            parse("Not available in California").excluded_subdivision_codes,
            vec!["US-CA"]
        );
        assert!(
            !parse("Must already have UK work authorization")
                .work_authorization_requirements
                .is_empty()
        );
        assert_eq!(
            parse("Visa sponsorship is available").sponsorship_available,
            Some(true)
        );
        assert_eq!(
            parse("No sponsorship available").sponsorship_available,
            Some(false)
        );
        assert_eq!(
            parse("Overlap with Pacific Time required").required_timezones,
            vec!["America/Los_Angeles"]
        );
        assert_eq!(
            parse("UTC-2 to UTC+4").required_utc_offset_range,
            Some(UtcOffsetRange {
                minimum: -2.0,
                maximum: 4.0
            })
        );
        let hybrid = parse("Hybrid in Bengaluru three days per week");
        assert_eq!(hybrid.mode, WorkMode::Hybrid);
        assert_eq!(
            hybrid.office_locations[0].country_code.as_deref(),
            Some("IN")
        );
        assert_eq!(
            hybrid.office_frequency.as_deref(),
            Some("three days per week")
        );
        assert!(
            !parse("Occasional travel to the Berlin office required")
                .office_locations
                .is_empty()
        );
    }

    #[test]
    fn evaluates_country_region_exclusion_timezone_sponsorship_and_hybrid_cases() {
        assert_eq!(
            evaluate_candidate(&india(), &parse("Remote worldwide")).status,
            CandidateEligibility::Confirmed
        );
        assert_eq!(
            evaluate_candidate(&india(), &parse("Remote within India")).status,
            CandidateEligibility::Confirmed
        );
        assert_eq!(
            evaluate_candidate(&india(), &parse("Remote — APAC")).status,
            CandidateEligibility::Confirmed
        );
        assert_eq!(
            evaluate_candidate(&india(), &parse("Not available in India")).status,
            CandidateEligibility::Excluded
        );
        assert_eq!(
            evaluate_candidate(&india(), &parse("Remote")).status,
            CandidateEligibility::Unclear
        );
        assert_eq!(
            evaluate_candidate(&india(), &parse("Overlap with Pacific Time required")).status,
            CandidateEligibility::TimezoneMismatch
        );
        assert_eq!(
            evaluate_candidate(&india(), &parse("Hybrid in Bengaluru three days per week")).status,
            CandidateEligibility::RequiresOfficeAttendance
        );

        let mut uk_sponsorship = india();
        uk_sponsorship.requires_sponsorship_country_codes = vec!["GB".into()];
        let sponsored = parse_remote_policy(
            Some("Remote within the United Kingdom"),
            "Must already have UK work authorization. Visa sponsorship is available.",
            true,
        );
        assert_eq!(
            evaluate_candidate(&uk_sponsorship, &sponsored).status,
            CandidateEligibility::Excluded
        );
        uk_sponsorship.residence_country_code = Some("GB".into());
        assert_eq!(
            evaluate_candidate(&uk_sponsorship, &sponsored).status,
            CandidateEligibility::RequiresSponsorship
        );

        let mut relocation = india();
        relocation.willing_to_relocate = true;
        relocation.relocation_country_codes = vec!["DE".into()];
        assert_eq!(
            evaluate_candidate(&relocation, &parse("Onsite in Berlin")).status,
            CandidateEligibility::RequiresRelocation
        );
    }

    #[test]
    fn covers_every_inhabited_continent_with_central_region_membership() {
        for (country, region) in [
            ("CA", "AMERICAS"),
            ("BR", "LATAM"),
            ("DE", "EU"),
            ("NG", "AFRICA"),
            ("IN", "APAC"),
            ("AU", "OCEANIA"),
        ] {
            assert!(country_in_region(country, region));
            assert!(geography::country_by_code(country).is_some());
        }
    }

    #[test]
    fn work_order_five_geographic_acceptance_matrix() {
        let candidate = |country: &str| CandidateMobility {
            residence_country_code: Some(country.into()),
            preferred_country_codes: vec![country.into()],
            ..CandidateMobility::default()
        };

        let onsite_de = candidate("DE");
        assert_eq!(
            evaluate_candidate(&onsite_de, &parse("Onsite in Berlin, Germany")).status,
            CandidateEligibility::Confirmed
        );
        assert_eq!(
            evaluate_candidate(&india(), &parse("Remote across APAC")).status,
            CandidateEligibility::Confirmed
        );
        assert_eq!(
            evaluate_candidate(&candidate("BR"), &parse("Remote worldwide")).status,
            CandidateEligibility::Confirmed
        );
        assert_eq!(
            evaluate_candidate(&candidate("DE"), &parse("Remote across the EU")).status,
            CandidateEligibility::Confirmed
        );
        assert_eq!(
            evaluate_candidate(&india(), &parse("Remote worldwide. Not available in India")).status,
            CandidateEligibility::Excluded
        );

        let california = CandidateMobility {
            preferred_cities: vec![normalize_location("San Francisco, California")],
            ..candidate("US")
        };
        assert_eq!(
            evaluate_candidate(
                &california,
                &parse("Remote within the United States. Not available in California")
            )
            .status,
            CandidateEligibility::Excluded
        );

        let authorized_de = CandidateMobility {
            work_authorized_country_codes: vec!["DE".into()],
            ..candidate("DE")
        };
        let authorization_policy = parse_remote_policy(
            Some("Remote within Germany"),
            "Must already have German work authorization.",
            true,
        );
        assert_eq!(
            evaluate_candidate(&authorized_de, &authorization_policy).status,
            CandidateEligibility::Confirmed
        );

        let needs_sponsorship = CandidateMobility {
            requires_sponsorship_country_codes: vec!["DE".into()],
            ..candidate("DE")
        };
        let sponsorship_available = parse_remote_policy(
            Some("Remote within Germany"),
            "Must already have German work authorization. Visa sponsorship is available.",
            true,
        );
        assert_eq!(
            evaluate_candidate(&needs_sponsorship, &sponsorship_available).status,
            CandidateEligibility::RequiresSponsorship
        );
        let sponsorship_unavailable = parse_remote_policy(
            Some("Remote within Germany"),
            "Must already have German work authorization. No sponsorship available.",
            true,
        );
        assert_eq!(
            evaluate_candidate(&needs_sponsorship, &sponsorship_unavailable).status,
            CandidateEligibility::Excluded
        );

        let relocation = CandidateMobility {
            willing_to_relocate: true,
            relocation_country_codes: vec!["DE".into()],
            ..india()
        };
        assert_eq!(
            evaluate_candidate(&relocation, &parse("Onsite in Berlin, Germany")).status,
            CandidateEligibility::RequiresRelocation
        );
        assert_eq!(
            evaluate_candidate(
                &CandidateMobility {
                    preferred_timezones: vec!["Asia/Kolkata".into()],
                    ..india()
                },
                &parse("Remote with Pacific Time overlap required")
            )
            .status,
            CandidateEligibility::TimezoneMismatch
        );
        assert_eq!(
            evaluate_candidate(
                &india(),
                &parse("Hybrid in Bengaluru, India three days per week")
            )
            .status,
            CandidateEligibility::RequiresOfficeAttendance
        );
    }
}
