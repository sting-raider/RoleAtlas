use crate::models::NormalizedJob;
use chrono::NaiveDate;
use regex::Regex;
use scraper::{Html, Selector};
use serde_json::Value;
use std::collections::HashSet;
use url::Url;

pub fn extract_jobs(html: &str, source_url: &Url) -> Vec<NormalizedJob> {
    let document = Html::parse_document(html);
    let selector = Selector::parse("script[type='application/ld+json']").expect("static selector");
    let mut postings = Vec::new();

    for node in document.select(&selector) {
        let raw = node.inner_html();
        if let Ok(value) = serde_json::from_str::<Value>(&raw) {
            collect_job_postings(&value, &mut postings);
        }
    }

    postings
        .into_iter()
        .filter_map(|posting| normalize_posting(posting, source_url))
        .collect()
}

pub fn discover_job_urls(html: &str, source_url: &Url) -> Vec<String> {
    let document = Html::parse_document(html);
    let selector = Selector::parse("a[href]").expect("static selector");
    let source_host = source_url.host_str();
    let mut seen = HashSet::new();

    for element in document.select(&selector) {
        let Some(href) = element.value().attr("href") else { continue };
        let Ok(mut url) = source_url.join(href) else { continue };
        if !matches!(url.scheme(), "http" | "https") || url.host_str() != source_host {
            continue;
        }
        url.set_fragment(None);
        let retained = url
            .query_pairs()
            .filter(|(key, _)| !key.starts_with("utm_") && key != "ref" && key != "source")
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect::<Vec<_>>();
        url.set_query(None);
        if !retained.is_empty() {
            url.query_pairs_mut().extend_pairs(retained);
        }
        let path = url.path().to_ascii_lowercase();
        if is_job_path(&path) {
            seen.insert(url.to_string());
        }
        if seen.len() >= 200 {
            break;
        }
    }

    let mut urls = seen.into_iter().collect::<Vec<_>>();
    urls.sort();
    urls
}

fn is_job_path(path: &str) -> bool {
    ["/job", "/jobs", "/career", "/careers", "/position", "/positions", "/opening", "/vacancy"]
        .iter()
        .any(|needle| path.contains(needle))
}

fn collect_job_postings(value: &Value, output: &mut Vec<Value>) {
    match value {
        Value::Array(items) => items.iter().for_each(|item| collect_job_postings(item, output)),
        Value::Object(object) => {
            let is_job = object
                .get("@type")
                .map(|kind| match kind {
                    Value::String(kind) => kind.eq_ignore_ascii_case("JobPosting"),
                    Value::Array(kinds) => kinds.iter().any(|kind| kind.as_str().is_some_and(|kind| kind.eq_ignore_ascii_case("JobPosting"))),
                    _ => false,
                })
                .unwrap_or(false);
            if is_job {
                output.push(value.clone());
            }
            if let Some(graph) = object.get("@graph") {
                collect_job_postings(graph, output);
            }
        }
        _ => {}
    }
}

fn normalize_posting(raw: Value, page_url: &Url) -> Option<NormalizedJob> {
    let title = string_at(&raw, &["title"])?;
    let company = string_at(&raw, &["hiringOrganization", "name"])
        .or_else(|| string_at(&raw, &["organization", "name"]))?;
    let source_url = string_at(&raw, &["url"])
        .and_then(|url| page_url.join(&url).ok())
        .unwrap_or_else(|| page_url.clone())
        .to_string();
    let description = string_at(&raw, &["description"])
        .map(|value| strip_html(&value))
        .unwrap_or_default();
    let employment_type = value_at(&raw, &["employmentType"]).and_then(join_string_value);
    let location = location_text(&raw);
    let country = string_at(&raw, &["jobLocation", "address", "addressCountry"])
        .or_else(|| string_at(&raw, &["applicantLocationRequirements", "name"]));
    let remote = string_at(&raw, &["jobLocationType"])
        .is_some_and(|value| value.eq_ignore_ascii_case("TELECOMMUTE"))
        || location.as_deref().is_some_and(|value| value.to_ascii_lowercase().contains("remote"));
    let experience_text = string_at(&raw, &["experienceRequirements"])
        .unwrap_or_else(|| description.clone());
    let experience_years = extract_experience(&experience_text);
    let degree_required = detect_degree_requirement(&description);
    let (salary_min, salary_max, salary_currency) = salary(&raw);
    let skills = value_at(&raw, &["skills"])
        .and_then(join_string_value)
        .map(|skills| skills.split([',', ';']).map(str::trim).filter(|s| !s.is_empty()).take(20).map(str::to_string).collect())
        .unwrap_or_default();
    let source_name = source_name(page_url);
    let id = NormalizedJob::stable_id(&source_url, &title, &company);

    Some(NormalizedJob {
        id,
        source_url,
        source_name,
        title,
        company,
        location,
        country,
        remote,
        employment_type,
        experience_years,
        degree_required,
        salary_min,
        salary_max,
        salary_currency,
        date_posted: parse_date(string_at(&raw, &["datePosted"]).as_deref()),
        valid_through: parse_date(string_at(&raw, &["validThrough"]).as_deref()),
        description,
        skills,
        raw,
    })
}

fn value_at<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    path.iter().try_fold(value, |current, key| current.get(*key))
}

fn string_at(value: &Value, path: &[&str]) -> Option<String> {
    value_at(value, path).and_then(|value| match value {
        Value::String(value) => Some(value.trim().to_string()),
        Value::Number(value) => Some(value.to_string()),
        Value::Object(object) => object.get("name").and_then(Value::as_str).map(str::to_string),
        _ => None,
    })
}

fn join_string_value(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Array(values) => Some(values.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", ")),
        _ => None,
    }
}

fn location_text(raw: &Value) -> Option<String> {
    let location = value_at(raw, &["jobLocation"])?;
    let location = location.as_array().and_then(|items| items.first()).unwrap_or(location);
    let address = location.get("address").unwrap_or(location);
    let parts = ["addressLocality", "addressRegion", "addressCountry"]
        .iter()
        .filter_map(|key| address.get(*key).and_then(Value::as_str))
        .collect::<Vec<_>>();
    if parts.is_empty() { None } else { Some(parts.join(", ")) }
}

fn salary(raw: &Value) -> (Option<f64>, Option<f64>, Option<String>) {
    let Some(base) = raw.get("baseSalary") else { return (None, None, None) };
    let currency = base.get("currency").and_then(Value::as_str).map(str::to_string);
    let value = base.get("value").unwrap_or(base);
    let min = number(value.get("minValue").or_else(|| value.get("value")));
    let max = number(value.get("maxValue").or_else(|| value.get("value")));
    (min, max, currency)
}

fn number(value: Option<&Value>) -> Option<f64> {
    value.and_then(|value| value.as_f64().or_else(|| value.as_str().and_then(|value| value.replace(',', "").parse().ok())))
}

fn extract_experience(text: &str) -> Option<i16> {
    let regex = Regex::new(r"(?i)(\d{1,2})\s*(?:\+|[-–]\s*\d{1,2}|to\s*\d{1,2})?\s*years?").expect("static regex");
    regex.captures(text).and_then(|captures| captures.get(1)).and_then(|value| value.as_str().parse().ok())
}

fn detect_degree_requirement(description: &str) -> Option<bool> {
    let lower = description.to_ascii_lowercase();
    if ["no degree required", "degree not required", "equivalent experience", "or equivalent practical experience"]
        .iter().any(|phrase| lower.contains(phrase)) {
        Some(false)
    } else if ["bachelor's degree required", "bachelors degree required", "must have a degree"]
        .iter().any(|phrase| lower.contains(phrase)) {
        Some(true)
    } else {
        None
    }
}

fn parse_date(value: Option<&str>) -> Option<NaiveDate> {
    let value = value?;
    NaiveDate::parse_from_str(value.get(..10).unwrap_or(value), "%Y-%m-%d").ok()
}

fn strip_html(value: &str) -> String {
    let fragment = Html::parse_fragment(value);
    fragment.root_element().text().collect::<Vec<_>>().join(" ").split_whitespace().collect::<Vec<_>>().join(" ")
}

fn source_name(url: &Url) -> String {
    let host = url.host_str().unwrap_or("company-site").to_ascii_lowercase();
    if host.contains("greenhouse") { "Greenhouse".into() }
    else if host.contains("lever.co") { "Lever".into() }
    else if host.contains("ashbyhq") { "Ashby".into() }
    else { "Company site".into() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_schema_job_posting() {
        let html = r#"<script type="application/ld+json">{
          "@type":"JobPosting","title":"Junior Analyst","description":"No degree required. 0-1 years experience.",
          "hiringOrganization":{"name":"Example Co"},"jobLocation":{"address":{"addressLocality":"Pune","addressCountry":"IN"}},
          "employmentType":"FULL_TIME","datePosted":"2026-07-10"
        }</script>"#;
        let jobs = extract_jobs(html, &Url::parse("https://example.com/jobs/1").unwrap());
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].title, "Junior Analyst");
        assert_eq!(jobs[0].experience_years, Some(0));
        assert_eq!(jobs[0].degree_required, Some(false));
    }
}
