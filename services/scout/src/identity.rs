use crate::models::NormalizedJob;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use url::Url;

const TRACKING_PARAMETERS: &[&str] = &[
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
    "ref",
    "referrer",
    "source",
    "utm_campaign",
    "utm_content",
    "utm_medium",
    "utm_source",
    "utm_term",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobIdentity {
    pub source_id: String,
    pub source_type: String,
    pub source_job_id: Option<String>,
    pub canonical_url: String,
    pub apply_url: String,
    pub company_domain: Option<String>,
    pub identity_key: String,
    pub strategy: &'static str,
}

pub fn canonicalize_url(value: &str) -> String {
    let Ok(mut url) = Url::parse(value) else {
        return value.trim().to_string();
    };
    url.set_fragment(None);
    let _ = match (url.scheme(), url.port()) {
        ("https", Some(443)) | ("http", Some(80)) => url.set_port(None),
        _ => Ok(()),
    };
    if let Some(host) = url
        .host_str()
        .map(|host| host.trim_start_matches("www.").to_ascii_lowercase())
    {
        let _ = url.set_host(Some(&host));
    }
    let retained = url
        .query_pairs()
        .filter(|(key, _)| !TRACKING_PARAMETERS.contains(&key.to_ascii_lowercase().as_str()))
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<BTreeMap<_, _>>();
    url.set_query(None);
    if !retained.is_empty() {
        url.query_pairs_mut().extend_pairs(retained);
    }
    let normalized_path = url.path().replace("//", "/");
    let normalized_path = normalized_path.trim_end_matches('/');
    url.set_path(if normalized_path.is_empty() {
        "/"
    } else {
        normalized_path
    });
    url.to_string()
}

fn normalized_text(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
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

fn raw_string(job: &NormalizedJob, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| job.raw.get(*key))
        .and_then(|value| {
            value
                .as_str()
                .map(ToOwned::to_owned)
                .or_else(|| value.as_i64().map(|number| number.to_string()))
        })
        .filter(|value| !value.trim().is_empty())
}

fn source_namespace(job: &NormalizedJob, canonical_url: &str) -> (String, String) {
    let source_type = normalized_text(&job.source_name).replace(' ', "_");
    let board = Url::parse(canonical_url)
        .ok()
        .and_then(|url| {
            let segments = url
                .path_segments()?
                .filter(|segment| !segment.is_empty())
                .collect::<Vec<_>>();
            match source_type.as_str() {
                "lever" | "ashby" => segments.first().copied(),
                "greenhouse" if segments.first().is_some_and(|value| *value == "jobs") => {
                    segments.get(1).copied()
                }
                "greenhouse" => segments.first().copied(),
                _ => url.host_str(),
            }
            .map(normalized_text)
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| normalized_text(&job.company));
    (format!("{source_type}:{board}"), source_type)
}

fn fingerprint(job: &NormalizedJob) -> String {
    let date = job
        .date_posted
        .map(|value| value.to_string())
        .unwrap_or_else(|| "unknown".into());
    let material = format!(
        "{}|{}|{}|{}",
        normalized_text(&job.company),
        normalized_text(&job.title),
        normalized_text(job.location.as_deref().unwrap_or("")),
        date
    );
    format!("sha256:{:x}", Sha256::digest(material.as_bytes()))
}

pub fn identify_job(job: &NormalizedJob) -> JobIdentity {
    let canonical_url = canonicalize_url(&job.source_url);
    let (source_id, source_type) = source_namespace(job, &canonical_url);
    let source_job_id = raw_string(job, &["id", "jobId", "job_id", "identifier"])
        .or_else(|| {
            Url::parse(&canonical_url).ok().and_then(|url| {
                url.query_pairs()
                    .find(|(key, _)| key == "gh_jid")
                    .map(|(_, value)| value.into_owned())
                    .or_else(|| {
                        url.path_segments()?
                            .filter(|part| !part.is_empty())
                            .next_back()
                            .map(ToOwned::to_owned)
                    })
            })
        })
        .filter(|value| !matches!(value.as_str(), "jobs" | "postings"));
    let identity_key = if let Some(job_id) = &source_job_id {
        format!("source:{source_id}:{job_id}")
    } else if !canonical_url.is_empty() {
        format!("url:{canonical_url}")
    } else {
        fingerprint(job)
    };
    let strategy = if source_job_id.is_some() {
        "source_job_id"
    } else if !canonical_url.is_empty() {
        "canonical_url"
    } else {
        "fingerprint"
    };
    let company_domain = Url::parse(&canonical_url)
        .ok()
        .and_then(|url| url.host_str().map(ToOwned::to_owned));

    JobIdentity {
        source_id,
        source_type,
        source_job_id,
        canonical_url: canonical_url.clone(),
        apply_url: canonical_url,
        company_domain,
        identity_key,
        strategy,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;
    use serde_json::json;
    use uuid::Uuid;

    fn job(url: &str, location: &str, raw: serde_json::Value) -> NormalizedJob {
        NormalizedJob {
            id: Uuid::nil(),
            source_url: url.into(),
            source_name: "Lever".into(),
            title: "Software Intern".into(),
            company: "Example".into(),
            location: Some(location.into()),
            country: None,
            remote: false,
            employment_type: None,
            experience_years: None,
            degree_required: None,
            salary_min: None,
            salary_max: None,
            salary_currency: None,
            date_posted: Some(NaiveDate::from_ymd_opt(2026, 7, 15).unwrap()),
            valid_through: None,
            description: String::new(),
            skills: vec![],
            raw,
        }
    }

    #[test]
    fn canonical_url_removes_tracking_without_removing_identity_parameters() {
        assert_eq!(
            canonicalize_url("https://www.example.com/jobs/7/?utm_source=x&gh_jid=7#apply"),
            "https://example.com/jobs/7?gh_jid=7"
        );
    }

    #[test]
    fn source_job_id_is_stronger_than_url() {
        let identity = identify_job(&job(
            "https://jobs.lever.co/example/abc?utm_source=x",
            "India",
            json!({"id":"abc"}),
        ));
        assert_eq!(identity.source_id, "lever:example");
        assert_eq!(identity.source_job_id.as_deref(), Some("abc"));
        assert_eq!(identity.strategy, "source_job_id");
    }

    #[test]
    fn distinct_locations_have_distinct_fingerprints() {
        assert_ne!(
            fingerprint(&job("", "Bengaluru", json!({}))),
            fingerprint(&job("", "Pune", json!({})))
        );
    }
}
