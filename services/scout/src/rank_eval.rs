//! Deterministic offline ranking-evaluation primitives shared by unit tests and
//! the PostgreSQL fixture evaluation. Relevance is graded 0–3 by construction:
//! 3 perfect role match, 2 good partial match, 1 marginal match, 0 irrelevant.
//! Unknown evidence stays unknown: missing data never earns positive credit.

use serde::Serialize;
use uuid::Uuid;

const EXACT_TITLE_BONUS_BASELINE: f64 = 30.0;
const TITLE_HIT_BONUS_BASELINE: f64 = 8.0;
const BASE_SCORE_BASELINE: f64 = 45.0;

const EXACT_TITLE_BONUS_PROPOSED: f64 = 15.0;
const TITLE_HIT_BONUS_PROPOSED: f64 = 9.0;
const TITLE_COVERAGE_BONUS_PROPOSED: f64 = 10.0;
const RETRIEVAL_WEIGHT_PROPOSED: f64 = 18.0;
const FRESH_CREDIT_PROPOSED: f64 = 8.0;
const RECENT_CREDIT_PROPOSED: f64 = 4.0;
const BASE_SCORE_PROPOSED: f64 = 40.0;

#[derive(Clone, Debug)]
pub struct JudgedCandidate {
    pub job_id: Uuid,
    pub gain: u8,
    pub hard_disqualified: bool,
    pub duplicate_of_higher_ranked: bool,
    pub unknown_eligibility: bool,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct RankingMetrics {
    pub precision_at_k: f64,
    pub recall_at_k: f64,
    pub reciprocal_rank: f64,
    pub ndcg_at_k: f64,
    pub evaluated_depth: usize,
    pub hard_disqualifier_leakage: usize,
    pub duplicates_in_top_k: usize,
    pub unknown_in_top_k: usize,
}

impl RankingMetrics {
    pub fn compute(
        ranked: &[JudgedCandidate],
        k: usize,
        total_relevant: usize,
        total_gains: &[u8],
    ) -> Self {
        let depth = ranked.len().min(k);
        let top = &ranked[..depth];
        let relevant_in_top = top.iter().filter(|job| job.gain >= 1).count();
        let first_relevant = ranked
            .iter()
            .position(|job| job.gain >= 2)
            .map(|position| 1.0 / (position + 1) as f64)
            .unwrap_or(0.0);
        Self {
            precision_at_k: fraction(relevant_in_top, depth),
            recall_at_k: fraction(relevant_in_top, total_relevant),
            reciprocal_rank: first_relevant,
            ndcg_at_k: ndcg(top, k, total_gains),
            evaluated_depth: depth,
            hard_disqualifier_leakage: top.iter().filter(|job| job.hard_disqualified).count(),
            duplicates_in_top_k: top
                .iter()
                .filter(|job| job.duplicate_of_higher_ranked)
                .count(),
            unknown_in_top_k: top.iter().filter(|job| job.unknown_eligibility).count(),
        }
    }
}

fn fraction(numerator: usize, denominator: usize) -> f64 {
    if denominator == 0 {
        return 0.0;
    }
    numerator as f64 / denominator as f64
}

fn discounted_gain(gain: u8) -> f64 {
    // Graded gain uses the standard exponential discount 2^rel - 1 so a perfect
    // match (3) dominates three marginal matches (1) instead of equaling them.
    let gain = f64::from(gain);
    (2f64).powf(gain) - 1.0
}

fn dcg(judged: &[JudgedCandidate]) -> f64 {
    judged
        .iter()
        .enumerate()
        .map(|(index, job)| discounted_gain(job.gain) / (index as f64 + 2.0).log2())
        .sum()
}

fn ndcg(top: &[JudgedCandidate], k: usize, total_gains: &[u8]) -> f64 {
    let mut ideal = total_gains.to_vec();
    ideal.sort_unstable_by(|a, b| b.cmp(a));
    ideal.truncate(k);
    let ideal_dcg: f64 = ideal
        .iter()
        .enumerate()
        .map(|(index, gain)| discounted_gain(*gain) / (index as f64 + 2.0).log2())
        .sum();
    if ideal_dcg <= 0.0 {
        return 0.0;
    }
    dcg(top) / ideal_dcg
}

#[derive(Clone, Copy, Debug)]
pub struct RankFeatures {
    pub title_term_hits: usize,
    pub title_term_total: usize,
    pub exact_query_in_title: bool,
    /// Query-pool-normalized lexical retrieval relevance in 0..=1. Zero means
    /// the retrieval engine produced no usable score for the candidate.
    pub retrieval_relevance: f64,
    /// Listing age in days. `None` is unknown and never earns freshness credit.
    pub age_days: Option<i64>,
}

/// Counts lowercase-title term hits and whether the complete lowercase query
/// appears verbatim in the title.
pub fn title_features(lowercase_title: &str, lowercase_terms: &[String]) -> (usize, bool) {
    let hits = lowercase_terms
        .iter()
        .filter(|term| lowercase_title.contains(term.as_str()))
        .count();
    let exact = !lowercase_terms.is_empty() && lowercase_title.contains(&lowercase_terms.join(" "));
    (hits, exact)
}

fn freshness_credit(age_days: Option<i64>) -> f64 {
    match age_days {
        Some(days) if days <= 7 => FRESH_CREDIT_PROPOSED,
        Some(days) if days <= 21 => RECENT_CREDIT_PROPOSED,
        _ => 0.0,
    }
}

/// The shipped deterministic session heuristic.
pub fn baseline_score(features: &RankFeatures, eligibility_adjustment: f64) -> f64 {
    let exact = if features.exact_query_in_title {
        EXACT_TITLE_BONUS_BASELINE
    } else {
        0.0
    };
    BASE_SCORE_BASELINE
        + exact
        + features.title_term_hits as f64 * TITLE_HIT_BONUS_BASELINE
        + eligibility_adjustment
}

/// Candidate feature-blend replacement. Retrieval relevance contributes only a
/// bounded weight so description-only and stuffed listings cannot outrank clear
/// title evidence, while title coverage rewards satisfying more of the query.
pub fn proposed_score(features: &RankFeatures, eligibility_adjustment: f64) -> f64 {
    let coverage = if features.title_term_total == 0 {
        0.0
    } else {
        features.title_term_hits as f64 / features.title_term_total as f64
    };
    let exact = if features.exact_query_in_title {
        EXACT_TITLE_BONUS_PROPOSED
    } else {
        0.0
    };
    BASE_SCORE_PROPOSED
        + exact
        + features.title_term_hits as f64 * TITLE_HIT_BONUS_PROPOSED
        + coverage * TITLE_COVERAGE_BONUS_PROPOSED
        + features.retrieval_relevance.clamp(0.0, 1.0) * RETRIEVAL_WEIGHT_PROPOSED
        + freshness_credit(features.age_days)
        + eligibility_adjustment
}

pub fn normalized_retrieval_scores(raw_scores: &[i64]) -> Vec<f64> {
    let maximum = raw_scores.iter().copied().max().unwrap_or(0);
    if maximum <= 0 {
        return vec![0.0; raw_scores.len()];
    }
    raw_scores
        .iter()
        .map(|score| (*score).max(0) as f64 / maximum as f64)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(gain: u8) -> JudgedCandidate {
        JudgedCandidate {
            job_id: Uuid::new_v4(),
            gain,
            hard_disqualified: false,
            duplicate_of_higher_ranked: false,
            unknown_eligibility: false,
        }
    }

    #[test]
    fn metrics_measure_precision_recall_mrr_and_ndcg() {
        let ranked = vec![candidate(3), candidate(0), candidate(2), candidate(1)];
        let total_gains = vec![3u8, 2, 1, 0];
        let metrics = RankingMetrics::compute(&ranked, 3, 3, &total_gains);
        assert_eq!(metrics.evaluated_depth, 3);
        assert!((metrics.precision_at_k - 2.0 / 3.0).abs() < 1e-9);
        assert!((metrics.recall_at_k - 2.0 / 3.0).abs() < 1e-9);
        assert!((metrics.reciprocal_rank - 1.0).abs() < 1e-9);

        let dcg = discounted_gain(3) / 1.0 + discounted_gain(2) / 2.0;
        let idcg = discounted_gain(3) / 1.0
            + discounted_gain(2) / (3.0f64).log2()
            + discounted_gain(1) / 2.0;
        assert!((metrics.ndcg_at_k - dcg / idcg).abs() < 1e-9);
    }

    #[test]
    fn mrr_requires_a_good_match_not_a_marginal_one() {
        let ranked = vec![candidate(1), candidate(0), candidate(2)];
        let metrics = RankingMetrics::compute(&ranked, 3, 2, &[1u8, 0, 2]);
        assert!((metrics.reciprocal_rank - 1.0 / 3.0).abs() < 1e-9);
        assert!((metrics.precision_at_k - 2.0 / 3.0).abs() < 1e-9);
    }

    #[test]
    fn leakage_duplicates_and_unknown_are_counted_inside_top_k() {
        let mut ranked = vec![candidate(3), candidate(2), candidate(0), candidate(1)];
        ranked[1].hard_disqualified = true;
        ranked[2].duplicate_of_higher_ranked = true;
        ranked[3].unknown_eligibility = true;
        let metrics = RankingMetrics::compute(&ranked, 3, 4, &[3u8, 2, 0, 1]);
        assert_eq!(metrics.hard_disqualifier_leakage, 1);
        assert_eq!(metrics.duplicates_in_top_k, 1);
        assert_eq!(metrics.unknown_in_top_k, 0);

        let deeper = RankingMetrics::compute(&ranked, 4, 4, &[3u8, 2, 0, 1]);
        assert_eq!(deeper.unknown_in_top_k, 1);
    }

    #[test]
    fn ndcg_is_zero_without_any_relevant_judgment() {
        let ranked = vec![candidate(0), candidate(0)];
        let metrics = RankingMetrics::compute(&ranked, 2, 0, &[0u8, 0]);
        assert_eq!(metrics.ndcg_at_k, 0.0);
        assert_eq!(metrics.precision_at_k, 0.0);
        assert_eq!(metrics.recall_at_k, 0.0);
        assert_eq!(metrics.reciprocal_rank, 0.0);
    }

    #[test]
    fn baseline_matches_the_shipped_session_heuristic() {
        let features = RankFeatures {
            title_term_hits: 2,
            title_term_total: 3,
            exact_query_in_title: true,
            retrieval_relevance: 0.0,
            age_days: Some(1),
        };
        let score = baseline_score(&features, 6.0);
        assert!((score - (45.0 + 30.0 + 16.0 + 6.0)).abs() < 1e-9);
    }

    #[test]
    fn proposed_blend_stays_bounded_and_rewards_coverage() {
        let sparse = RankFeatures {
            title_term_hits: 1,
            title_term_total: 3,
            exact_query_in_title: false,
            retrieval_relevance: 1.0,
            age_days: None,
        };
        let covered = RankFeatures {
            title_term_hits: 3,
            ..sparse
        };
        let sparse_score = proposed_score(&sparse, 0.0);
        let covered_score = proposed_score(&covered, 0.0);
        assert!(covered_score > sparse_score);
        assert!(sparse_score <= 40.0 + 9.0 + 10.0 + 18.0);
    }

    #[test]
    fn unknown_age_and_absent_relevance_never_earn_positive_credit() {
        let unknown = RankFeatures {
            title_term_hits: 0,
            title_term_total: 3,
            exact_query_in_title: false,
            retrieval_relevance: 0.0,
            age_days: None,
        };
        let stale = RankFeatures {
            age_days: Some(400),
            ..unknown
        };
        assert!((proposed_score(&unknown, 0.0) - proposed_score(&stale, 0.0)).abs() < 1e-9);
        assert!((proposed_score(&unknown, 0.0) - BASE_SCORE_PROPOSED).abs() < 1e-9);
    }

    #[test]
    fn normalization_handles_empty_and_degenerate_pools() {
        assert!(normalized_retrieval_scores(&[]).is_empty());
        assert!(
            normalized_retrieval_scores(&[0, -5])
                .iter()
                .all(|value| *value == 0.0)
        );
        let normalized = normalized_retrieval_scores(&[500, 250, 0]);
        assert!((normalized[0] - 1.0).abs() < 1e-9);
        assert!((normalized[1] - 0.5).abs() < 1e-9);
        assert_eq!(normalized[2], 0.0);
    }

    #[test]
    fn title_features_detect_hits_and_exact_phrase() {
        let terms = vec![
            "quantum".to_string(),
            "widget".to_string(),
            "designer".to_string(),
        ];
        let (hits, exact) = title_features("quantum widget designer", &terms);
        assert_eq!(hits, 3);
        assert!(exact);
        let (hits, exact) = title_features("senior widget designer", &terms);
        assert_eq!(hits, 2);
        assert!(!exact);
        let (hits, exact) = title_features("head of people", &terms);
        assert_eq!(hits, 0);
        assert!(!exact);
        let (_, exact) = title_features("anything", &[]);
        assert!(!exact);
    }
}
