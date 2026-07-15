use crate::models::NormalizedJob;
use chrono::NaiveDate;
use regex::Regex;
use scraper::{Html, Selector};
use serde_json::Value;
use std::collections::HashSet;
use url::Url;

pub fn extract_jobs(html: &str, source_url: &Url) -> Vec<NormalizedJob> {
    if let Some(jobs) = extract_provider_json(html, source_url) {
        return jobs;
    }
    let document = Html::parse_document(html);
    let selector = Selector::parse("script[type='application/ld+json']").expect("static selector");
    let mut postings = Vec::new();

    for node in document.select(&selector) {
        let raw = node.inner_html();
        if let Ok(value) = serde_json::from_str::<Value>(&raw) {
            collect_job_postings(&value, &mut postings);
        }
    }

    let mut jobs = postings
        .into_iter()
        .filter_map(|posting| normalize_posting(posting, source_url))
        .collect::<Vec<_>>();
    jobs.extend(extract_greenhouse_jobs(&document, source_url));
    jobs
}

fn extract_provider_json(body: &str, source_url: &Url) -> Option<Vec<NormalizedJob>> {
    let host = source_url.host_str()?.to_ascii_lowercase();
    let value = serde_json::from_str::<Value>(body).ok()?;
    if host == "api.lever.co" || host == "api.eu.lever.co" {
        let company = source_url.path_segments()?.nth(2).map(slug_title)?;
        let postings = value.as_array()?;
        return Some(postings.iter().filter_map(|posting| normalize_lever_job(posting, &company, source_url)).collect());
    }
    if host == "boards-api.greenhouse.io" {
        let company = source_url.path_segments()?.nth(2).map(slug_title)?;
        let postings = value.get("jobs")?.as_array()?;
        return Some(postings.iter().filter_map(|posting| normalize_greenhouse_api_job(posting, &company, source_url)).collect());
    }
    if host == "api.ashbyhq.com" {
        let company = source_url.path_segments()?.nth(2).map(slug_title)?;
        let postings = value.get("jobs")?.as_array()?;
        return Some(postings.iter().filter_map(|posting| normalize_ashby_job(posting, &company, source_url)).collect());
    }
    None
}

fn slug_title(value: &str) -> String {
    value.split(['-', '_']).filter(|part| !part.is_empty()).map(|part| {
        let mut chars = part.chars();
        chars.next().map(|first| first.to_uppercase().collect::<String>() + chars.as_str()).unwrap_or_default()
    }).collect::<Vec<_>>().join(" ")
}

fn normalize_lever_job(raw: &Value, company: &str, api_url: &Url) -> Option<NormalizedJob> {
    let title = string_at(raw, &["text"])?;
    let source_url = string_at(raw, &["hostedUrl"])
        .or_else(|| string_at(raw, &["applyUrl"]))
        .unwrap_or_else(|| api_url.to_string());
    let description = string_at(raw, &["descriptionPlain"])
        .or_else(|| string_at(raw, &["description"]).map(|value| strip_html(&value)))
        .unwrap_or_default();
    let location = string_at(raw, &["categories", "location"]);
    let employment_type = string_at(raw, &["categories", "commitment"]);
    let remote = location.as_deref().is_some_and(|value| value.to_ascii_lowercase().contains("remote"));
    let country = location.as_deref().and_then(infer_country);
    let id = NormalizedJob::stable_id(&source_url, &title, company);
    Some(NormalizedJob {
        id, source_url, source_name: "Lever".into(), title, company: company.to_string(), location, country, remote,
        employment_type, experience_years: extract_experience(&description), degree_required: detect_degree_requirement(&description),
        salary_min: None, salary_max: None, salary_currency: None,
        date_posted: raw.get("createdAt").and_then(Value::as_i64).and_then(|value| chrono::DateTime::from_timestamp_millis(value)).map(|value| value.date_naive()),
        valid_through: None, description, skills: Vec::new(), raw: raw.clone(),
    })
}

fn normalize_greenhouse_api_job(raw: &Value, company: &str, api_url: &Url) -> Option<NormalizedJob> {
    let title = string_at(raw, &["title"])?;
    let source_url = string_at(raw, &["absolute_url"]).unwrap_or_else(|| api_url.to_string());
    let description = string_at(raw, &["content"]).map(|value| strip_html(&value)).unwrap_or_default();
    let location = string_at(raw, &["location", "name"]);
    let remote = location.as_deref().is_some_and(|value| value.to_ascii_lowercase().contains("remote"));
    let country = location.as_deref().and_then(infer_country);
    let id = NormalizedJob::stable_id(&source_url, &title, company);
    Some(NormalizedJob {
        id, source_url, source_name: "Greenhouse".into(), title, company: company.to_string(), location, country, remote,
        employment_type: None, experience_years: extract_experience(&description), degree_required: detect_degree_requirement(&description),
        salary_min: None, salary_max: None, salary_currency: None,
        date_posted: parse_date(string_at(raw, &["first_published"]).as_deref()), valid_through: None,
        description, skills: Vec::new(), raw: raw.clone(),
    })
}

fn normalize_ashby_job(raw: &Value, company: &str, api_url: &Url) -> Option<NormalizedJob> {
    let title = string_at(raw, &["title"])?;
    let source_url = string_at(raw, &["jobUrl"])
        .or_else(|| string_at(raw, &["applyUrl"]))
        .unwrap_or_else(|| api_url.to_string());
    let description = string_at(raw, &["descriptionPlain"])
        .or_else(|| string_at(raw, &["descriptionHtml"]).map(|value| strip_html(&value)))
        .unwrap_or_default();
    let location = string_at(raw, &["location"]);
    let workplace = string_at(raw, &["workplaceType"]).unwrap_or_default();
    let remote = workplace.eq_ignore_ascii_case("remote") || location.as_deref().is_some_and(|value| value.to_ascii_lowercase().contains("remote"));
    let country = location.as_deref().and_then(infer_country);
    let compensation = raw.get("compensation");
    let salary_min = compensation.and_then(|value| number(value.get("minValue")));
    let salary_max = compensation.and_then(|value| number(value.get("maxValue")));
    let salary_currency = compensation.and_then(|value| value.get("currency")).and_then(Value::as_str).map(ToOwned::to_owned);
    let id = NormalizedJob::stable_id(&source_url, &title, company);
    Some(NormalizedJob {
        id, source_url, source_name: "Ashby".into(), title, company: company.to_string(), location, country, remote,
        employment_type: string_at(raw, &["employmentType"]), experience_years: extract_experience(&description), degree_required: detect_degree_requirement(&description),
        salary_min, salary_max, salary_currency, date_posted: parse_date(string_at(raw, &["publishedAt"]).as_deref()),
        valid_through: None, description, skills: string_at(raw, &["team"]).into_iter().collect(), raw: raw.clone(),
    })
}

fn extract_greenhouse_jobs(document: &Html, page_url: &Url) -> Vec<NormalizedJob> {
    let selector = Selector::parse("script").expect("static selector");
    let mut posts = Vec::new();

    for node in document.select(&selector) {
        let script = node.inner_html();
        let Some(start) = script.find("window.__remixContext = ") else { continue };
        let serialized = script[start + "window.__remixContext = ".len()..]
            .trim()
            .trim_end_matches(';');
        let Ok(value) = serde_json::from_str::<Value>(serialized) else { continue };
        collect_greenhouse_posts(&value, &mut posts);
    }

    posts
        .into_iter()
        .filter_map(|post| normalize_greenhouse_job(post, page_url))
        .collect()
}

fn collect_greenhouse_posts(value: &Value, output: &mut Vec<Value>) {
    match value {
        Value::Object(object) => {
            if let Some(post) = object.get("jobPost") {
                if post.get("title").and_then(Value::as_str).is_some()
                    && post.get("company_name").and_then(Value::as_str).is_some()
                {
                    output.push(post.clone());
                }
            }
            object.values().for_each(|child| collect_greenhouse_posts(child, output));
        }
        Value::Array(items) => items.iter().for_each(|child| collect_greenhouse_posts(child, output)),
        _ => {}
    }
}

fn normalize_greenhouse_job(raw: Value, page_url: &Url) -> Option<NormalizedJob> {
    let title = string_at(&raw, &["title"])?;
    let company = string_at(&raw, &["company_name"])?;
    let source_url = string_at(&raw, &["public_url"])
        .and_then(|value| page_url.join(&value).ok())
        .unwrap_or_else(|| page_url.clone())
        .to_string();
    let description = string_at(&raw, &["content"])
        .map(|value| strip_html(&value))
        .unwrap_or_default();
    let location = string_at(&raw, &["job_post_location"]);
    let country = location.as_deref().and_then(infer_country);
    let remote = location
        .as_deref()
        .is_some_and(|value| value.to_ascii_lowercase().contains("remote"));
    let employment_type = string_at(&raw, &["employment"])
        .map(|value| value.replace('_', " ").to_ascii_lowercase());
    let experience_years = extract_experience(&description);
    let degree_required = detect_degree_requirement(&description);
    let source_name = "Greenhouse".to_string();
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
        salary_min: None,
        salary_max: None,
        salary_currency: None,
        date_posted: parse_date(string_at(&raw, &["published_at"]).as_deref()),
        valid_through: None,
        description,
        skills: Vec::new(),
        raw,
    })
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
        if seen.len() >= 100 {
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
        .or_else(|| string_at(&raw, &["applicantLocationRequirements", "name"]))
        .and_then(|value| infer_country(&value));
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

fn infer_country(location: &str) -> Option<String> {
    let normalized = location.trim().to_ascii_lowercase();
    if normalized.is_empty() { return None }

    let exact = match normalized.as_str() {
        "in" => Some("India"),
        "us" | "usa" => Some("United States"),
        "gb" | "uk" => Some("United Kingdom"),
        "de" => Some("Germany"),
        "fr" => Some("France"),
        "ca" => Some("Canada"),
        "au" => Some("Australia"),
        "jp" => Some("Japan"),
        "sg" => Some("Singapore"),
        _ => None,
    };
    if let Some(country) = exact { return Some(country.to_string()) }

    let mappings: &[(&str, &[&str])] = &[
        ("India", &["india", "bengaluru", "bangalore", "hyderabad", "pune", "mumbai", "delhi", "gurugram", "gurgaon", "noida", "chennai", "kolkata", "ahmedabad", "kochi", "jaipur", "chandigarh", "indore", "bhubaneswar"]),
        ("United States", &["united states", "u.s.", "new york", "san francisco", "seattle", "boston", "austin", "chicago", "washington d.c.", "los angeles"]),
        ("United Kingdom", &["united kingdom", "england", "scotland", "wales", "london", "manchester", "edinburgh"]),
        ("Germany", &["germany", "berlin", "munich", "hamburg"]),
        ("Ireland", &["ireland", "dublin"]),
        ("Canada", &["canada", "toronto", "vancouver", "montreal"]),
        ("Australia", &["australia", "sydney", "melbourne"]),
        ("France", &["france", "paris"]),
        ("Netherlands", &["netherlands", "amsterdam"]),
        ("Singapore", &["singapore"]),
        ("Japan", &["japan", "tokyo"]),
        ("United Arab Emirates", &["united arab emirates", "dubai", "abu dhabi"]),
        ("Brazil", &["brazil", "sao paulo", "são paulo"]),
    ];
    if let Some((country, _)) = mappings.iter().find(|(_, signals)| signals.iter().any(|signal| normalized.contains(signal))) {
        return Some((*country).to_string());
    }

    location
        .split(',')
        .next_back()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
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

    #[test]
    fn extracts_greenhouse_remix_job_post() {
        let html = r#"<script>window.__remixContext = {"state":{"loaderData":{"route":{"jobPost":{
          "title":"Graduate Data Analyst","company_name":"Example India","public_url":"https://job-boards.greenhouse.io/example/jobs/123",
          "published_at":"2026-07-14T10:30:00Z","job_post_location":"Bengaluru, India",
          "content":"<p>No degree required. Projects welcome.</p>","employment":"FULL_TIME","pay_ranges":[]
        }}}}};</script>"#;
        let jobs = extract_jobs(html, &Url::parse("https://job-boards.greenhouse.io/example/jobs/123").unwrap());
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].title, "Graduate Data Analyst");
        assert_eq!(jobs[0].company, "Example India");
        assert_eq!(jobs[0].location.as_deref(), Some("Bengaluru, India"));
        assert_eq!(jobs[0].country.as_deref(), Some("India"));
    }

    #[test]
    fn normalizes_indian_city_only_locations() {
        let body = r#"{"jobs":[{"title":"Application Security Intern","absolute_url":"https://example.com/jobs/1","content":"Projects welcome.","location":{"name":"Bangalore"},"first_published":"2026-06-02"}]}"#;
        let jobs = extract_jobs(body, &Url::parse("https://boards-api.greenhouse.io/v1/boards/example/jobs?content=true").unwrap());
        assert_eq!(jobs[0].country.as_deref(), Some("India"));
    }

    #[test]
    fn extracts_lever_public_api_board() {
        let body = r#"[{"text":"Software Engineering Intern","hostedUrl":"https://jobs.lever.co/example/123","descriptionPlain":"Projects welcome. No degree required.","categories":{"location":"Bengaluru, India","commitment":"Internship"},"createdAt":1784059200000}]"#;
        let jobs = extract_jobs(body, &Url::parse("https://api.lever.co/v0/postings/example?mode=json").unwrap());
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].title, "Software Engineering Intern");
        assert_eq!(jobs[0].company, "Example");
        assert_eq!(jobs[0].degree_required, Some(false));
    }

    #[test]
    fn extracts_ashby_public_api_board() {
        let body = r#"{"jobs":[{"title":"Graduate Product Analyst","jobUrl":"https://jobs.ashbyhq.com/example/123","descriptionPlain":"Projects welcome. 0-1 years experience.","location":"Remote, India","workplaceType":"Remote","employmentType":"FullTime","publishedAt":"2026-07-14T10:30:00Z"}]}"#;
        let jobs = extract_jobs(body, &Url::parse("https://api.ashbyhq.com/posting-api/job-board/example?includeCompensation=true").unwrap());
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].title, "Graduate Product Analyst");
        assert_eq!(jobs[0].company, "Example");
        assert!(jobs[0].remote);
    }
}
