# Search and ranking

This document describes the current Phase 3 search path. Eligibility is a separate deterministic decision and is never inferred from lexical relevance.

## Indexed retrieval

Migration `0016_indexed_job_search.sql` adds:

- a stored, weighted PostgreSQL `tsvector` over title, company, and description;
- GIN full-text and title/company/location trigram indexes;
- partial active-listing indexes for stable date/source/work-mode scans.

`services/scout/src/search_index.rs` is the canonical lexical retrieval implementation used by:

- `GET /api/jobs`;
- the registered `search_jobs` agent tool through the signed Scout client;
- persisted search-session candidate retrieval.

Search combines `websearch_to_tsquery`, weighted `ts_rank_cd`, and trigram fallback for title/company misspellings. Structured filters cover ISO country code, source ID, employment type, experience ceiling, remote mode, degree requirement, and freshness. Closed or expired listings do not enter the result set.

## Pagination and response boundaries

Canonical job pages are limited to 100 records. The opaque cursor contains the last stable retrieval score/date/first-seen/job-ID tuple, the total count, and a hash of the normalized filter set. A cursor is rejected if it is malformed or reused with different filters.

List results contain a 320-character description preview and omit full descriptions plus internal cursor/eligibility material. `GET /api/jobs/{id}` returns the complete canonical listing on demand. The web client cancels stale index requests, follows bounded cursor pages, and lazy-loads full detail when a Scout job is opened.

Persisted search-session results are ranked once and paged by stable rank through `GET /api/search-sessions/{id}?cursor=&limit=`. The client currently follows at most 400 results per active view; the server retains the complete persisted result set and reports the full count.

## Session execution and persistence

Each confirmed role query retrieves at most 1,000 indexed candidates in pages of 100. Existing deterministic exclusions, opportunity-type constraints, experience/degree/freshness limits, and geographic eligibility are then applied. Explicitly excluded and timezone-mismatched jobs cannot become recommendations; unclear evidence remains unclear.

For each role query, RoleAtlas writes the query receipt once and persists all accepted results and provenance with two `UNNEST` batch statements inside one transaction. This replaces the former 5,000-row `ILIKE` scan and two writes per matching job. Result ranks use a deterministic score/job-ID tie break.

## Current ranking status

`services/scout/src/rank_eval.rs` holds the deterministic offline evaluation primitives: graded-relevance precision@K, recall@K, MRR, NDCG@K, hard-disqualifier leakage, duplicate rate, unknown-evidence visibility, and two scorers — the shipped session heuristic (`baseline_score`) and a candidate feature blend (`proposed_score`) that adds pool-normalized lexical retrieval relevance, title-term coverage, and bounded freshness credit while keeping identical eligibility adjustments. Missing data never earns credit: unknown listing age and zero retrieval relevance contribute nothing, so unknown evidence cannot become positive evidence.

`services/scout/tests/ranking_evaluation.rs` seeds a curated 14-listing adversarial corpus (perfect/partial/marginal matches, keyword-stuffed and description-only distractors, a duplicate pair, a policy-excluded listing, a timezone-mismatched listing, and an unknown-geography listing) into a disposable PostgreSQL database, retrieves through the real indexed engine, applies the deterministic eligibility filter, and compares both scorers.

First measured run (2026-08-22, disposable PostgreSQL 17 container on the development machine):

| model | P@5 | P@10 | R@5 | R@10 | MRR | NDCG@5 | NDCG@10 | leak | dup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline heuristic | 1.000 | 0.900 | 0.500 | 0.900 | 1.000 | 0.788 | 0.810 | 0 | 1 |
| proposed blend | 1.000 | 0.900 | 0.500 | 0.900 | 1.000 | 0.818 | 0.836 | 0 | 1 |

Both models kept both disqualifier fixtures out of results, surfaced exactly one member of the duplicate pair above its twin, and left the unknown-geography listing visible with unclear status. The decisive difference is tie handling: five listings share the baseline's top score (exact phrase + term hits + confirmed eligibility) so their order degenerates to job-ID order, which placed stale and duplicated gain-2 listings above both gain-3 matches. The proposed blend separates them with retrieval relevance and freshness and moved a gain-0 marketing distractor out of the top nine. Indexed retrieval of the full pool took 8 ms.

The user-visible session score still deliberately uses the shipped heuristic. One curated corpus is not adoption evidence; the blend may only replace the default after the same harness shows stable improvement across expanded corpora and the scale benchmark records no latency cost (the blend computes from already-retrieved candidates, so none is expected). The harness is repeatable via `cargo test --test ranking_evaluation -- --ignored --nocapture`.

## Measured local evidence

Measured on 2026-08-20 using Windows 11 Pro, an Intel Core i7-12700H (14 cores/20 logical processors), 15.8 GiB RAM, Docker Desktop PostgreSQL 17, and 4,033 canonical jobs:

- `jobs` relation plus indexes: 105 MiB;
- representative `software engineer` FTS query: 1.939 ms execution time;
- query plan: `jobs_search_document_gin_idx` bitmap index scan followed by a bounded top-N sort;
- pre-compaction 100-job HTTP page: 425,936 bytes and 134.3 ms warm median over five localhost requests. A post-compaction number must be recorded after the rebuilt API image is measured.

These are development-machine measurements, not production capacity claims. The required 10k/100k/1m and concurrent-user benchmark suite remains pending.

## Operational limitations

- Cursors provide deterministic continuation for a changing index, not snapshot isolation; newly ingested jobs can legitimately change later pages.
- Migration 0016 builds generated data and ordinary indexes transactionally. Large production databases require a planned maintenance window or a later online/concurrent rollout migration.
- The first UI slice follows multiple pages automatically rather than exposing a user-controlled infinite-scroll boundary.
- Semantic retrieval is not implemented and is not required for deterministic search.
- The ranking harness covers one curated corpus so far; corpus expansion and the scale/load benchmark gates remain open.
