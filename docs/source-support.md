# Source support matrix

| Source | Acquisition | Extraction | Stable ID | Complete-board signal | Reconciliation |
| --- | --- | --- | --- | --- | --- |
| Lever | Public postings JSON and crawl | Native JSON | `id` or posting path | Complete for recognized board API | Two-successful-run reconciliation |
| Greenhouse | Public board JSON and embedded page data | Native JSON / embedded JSON | `id`, `gh_jid`, or posting path | Complete for recognized board API | Two-successful-run reconciliation |
| Ashby | Public job-board JSON and crawl | Native JSON | `id` or posting path | Complete for recognized board API | Two-successful-run reconciliation |
| JSON-LD company pages | Respectful crawl | `JobPosting` JSON-LD | canonical URL, then fingerprint | Usually unavailable | No automatic closure without completeness evidence |
| Arbeitnow | Web server public-feed request | Feed adapter | feed slug | Not persisted yet | None |
| Remotive | Web server public-feed request | Feed adapter | feed ID | Not persisted yet | None |
| Jobicy | Web server public-feed request | Feed adapter | feed ID | Not persisted yet | None |
| Himalayas | Web server public-feed request | Feed adapter | feed GUID | Not persisted yet | None |
| Remote OK | Web server public-feed request | Feed adapter | feed ID | Not persisted yet | None |

Unsupported sources remain explicit. RoleAtlas does not bypass authentication, anti-bot controls, robots rules, or source terms.

## Validated global registry

`sources/registry/global.json` is the canonical configured-source catalog. It currently contains a deliberately small set of employer-controlled Greenhouse and Ashby boards with successful complete scans and listing-backed geography. `services/scout/default_seeds.txt` is a validated compatibility mirror, not a second source of truth.

Registry country/region tags describe only locations observed in current listings or explicit hiring metadata. Headquarters never establishes hiring eligibility. A successful HTTP response without extractable jobs does not establish health. Failed careers pages and unsupported adapters remain outside automatic selection.

Those registry tags are routing evidence, not candidate-eligibility evidence. They may select a board for a country or regional search, but every returned job is evaluated only from its own listing-level geographic, authorization, sponsorship, relocation, timezone, and attendance evidence. A registry tag cannot upgrade an ambiguous listing from `unclear` to eligible.

Run `npm run registry:validate` before contributing. See `docs/source-registry-contributing.md` for evidence, state, and AI-proposal rules. The registry API reports configured, enabled, latest-healthy/latest-failed, adapter, country, region, early-career, remote-history, and selected-geography counts; none of those counts claim full market coverage.

## Search-time orchestration

Every persisted search returns eligible jobs already present in PostgreSQL before source expansion begins. The API then selects a bounded set of verified registry sources using the confirmed geography, opportunity type, work mode, source freshness, and recorded health. A successful complete run stays fresh for six hours. Stale sources are queued through NATS, attached to the search session, and reconciled into the canonical index before that session is reranked in place.

When NATS or crawler services are unavailable, the local index and search history remain usable and the affected source selections are explicitly `deferred`. The UI reports selected, checked, scanning, failed, and deferred source counts for that search only. These are operational coverage counters, not claims about all employers or all jobs in a country.

AI query expansion may request a new search over the same validated registry. It cannot add URLs to the registry or enqueue arbitrary sites. Candidate sources proposed by a model remain untrusted until a contributor validates an employer-controlled page or supported ATS endpoint and commits the evidence required by the registry schema.

## Daily coverage experience

The Sources workspace renders the trusted configured registry with adapter, verification state, current-search relevance, last successful scan, latest observed listing count, and failure state. Search detail pages expose persisted counts for index search, selected sources, fresh sources reused, stale sources scanned, listings inspected, eligibility evaluated, listings ranked, and recommendations produced. The browser does not invent these progress values.

Coverage language is deliberately narrow: a relevant source is worth checking, not proof that a candidate is eligible for any listing; configured sources are not whole-market coverage; and failed or deferred checks can reduce the evidence available for a search. A careers URL can be submitted for validation, but it does not become trusted or automatically crawlable until it satisfies the existing registry contribution and source-policy checks.
