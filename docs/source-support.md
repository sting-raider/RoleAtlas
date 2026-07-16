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

Run `npm run registry:validate` before contributing. See `docs/source-registry-contributing.md` for evidence, state, and AI-proposal rules. The registry API reports configured, enabled, latest-healthy/latest-failed, adapter, country, region, early-career, remote-history, and selected-geography counts; none of those counts claim full market coverage.
