use serde::{Deserialize, Serialize};
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;

pub const NORMALIZATION_VERSION: i16 = 3;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaxonomyEntry {
    category: String,
    job_type: String,
    terms: Vec<String>,
    #[serde(default)]
    title_only_terms: Vec<String>,
    #[serde(default)]
    description_terms: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpportunityClassification {
    pub category: String,
    pub job_type: String,
    pub original_label: String,
    pub matched_term: Option<String>,
    pub evidence_source: String,
    pub confidence: f64,
    pub evidence: Vec<String>,
}

static TAXONOMY: LazyLock<Vec<TaxonomyEntry>> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../shared/taxonomy/opportunity-types.json"
    ))
    .expect("shared opportunity taxonomy must be valid")
});

fn normalized(value: &str) -> String {
    value
        .nfkd()
        .filter(|character| !unicode_normalization::char::is_combining_mark(*character))
        .flat_map(char::to_lowercase)
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

fn find(value: &str, source: &str) -> Option<(&'static TaxonomyEntry, String)> {
    let haystack = format!(" {} ", normalized(value));
    for entry in TAXONOMY.iter() {
        let source_terms = if source == "description" {
            &entry.description_terms
        } else {
            &entry.terms
        };
        let mut terms = source_terms.iter().collect::<Vec<_>>();
        terms.sort_by_key(|term| std::cmp::Reverse(term.len()));
        if let Some(term) = terms
            .into_iter()
            .filter(|term| source != "description" || !entry.title_only_terms.contains(term))
            .find(|term| haystack.contains(&format!(" {} ", normalized(term))))
        {
            return Some((entry, term.clone()));
        }
    }
    None
}

pub fn classify(
    structured_label: Option<&str>,
    title: &str,
    description: &str,
) -> OpportunityClassification {
    for (source, value, confidence) in [
        ("structured", structured_label.unwrap_or_default(), 0.98),
        ("title", title, 0.94),
        ("description", description, 0.72),
    ] {
        if let Some((entry, term)) = find(value, source) {
            return OpportunityClassification {
                category: entry.category.clone(),
                job_type: entry.job_type.clone(),
                original_label: value.trim().to_string(),
                matched_term: Some(term.clone()),
                evidence_source: source.into(),
                confidence,
                evidence: vec![format!(
                    "{source} field matched ‘{term}’ in the employer's original wording."
                )],
            };
        }
    }
    OpportunityClassification {
        category: "unknown".into(),
        job_type: "Unknown".into(),
        original_label: structured_label.unwrap_or(title).trim().to_string(),
        matched_term: None,
        evidence_source: "unresolved".into(),
        confidence: 0.25,
        evidence: vec![
            "No maintained opportunity taxonomy term matched; employment type remains unknown."
                .into(),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_international_early_career_terms() {
        for (title, expected) in [
            ("Research Internship", "internship"),
            ("Software Engineering Co-op", "co_op"),
            ("Graduate Engineer Trainee", "trainee"),
            ("Werkstudent Software Engineering", "working_student"),
            ("Développeur en alternance", "apprenticeship"),
            ("Technology Placement Year", "placement"),
            ("Summer Analyst", "internship"),
        ] {
            let result = classify(None, title, "");
            assert_eq!(result.category, expected, "{title}");
            assert_eq!(result.evidence_source, "title");
            assert!(result.confidence > 0.9);
        }
    }

    #[test]
    fn structured_fields_win_and_unresolved_listings_remain_unknown() {
        let structured = classify(Some("Apprenticeship"), "Junior Intern", "");
        assert_eq!(structured.category, "apprenticeship");
        assert_eq!(structured.evidence_source, "structured");
        let unknown = classify(None, "Software Engineer", "Build reliable systems.");
        assert_eq!(unknown.category, "unknown");
        assert_eq!(unknown.job_type, "Unknown");
        assert_eq!(unknown.original_label, "Software Engineer");
        let incidental = classify(
            Some("Permanent"),
            "Staff Backend Engineer",
            "Mentor interns and support the internship program when needed.",
        );
        assert_eq!(incidental.category, "full_time");
        assert_eq!(incidental.job_type, "Full-time");
        assert_eq!(incidental.evidence_source, "structured");
    }
}
