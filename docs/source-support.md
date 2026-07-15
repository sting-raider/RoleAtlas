# Source support matrix

| Source | Acquisition | Extraction | Stable ID | Complete-board signal | Reconciliation |
| --- | --- | --- | --- | --- | --- |
| Lever | Public postings JSON and crawl | Native JSON | `id` or posting path | Available for board API | Planned WO2 |
| Greenhouse | Public board JSON and embedded page data | Native JSON / embedded JSON | `id`, `gh_jid`, or posting path | Available for board API | Planned WO2 |
| Ashby | Public job-board JSON and crawl | Native JSON | `id` or posting path | Available for board API | Planned WO2 |
| JSON-LD company pages | Respectful crawl | `JobPosting` JSON-LD | canonical URL, then fingerprint | Usually unavailable | No automatic closure without completeness evidence |
| Arbeitnow | Web server public-feed request | Feed adapter | feed slug | Not persisted yet | None |
| Remotive | Web server public-feed request | Feed adapter | feed ID | Not persisted yet | None |
| Jobicy | Web server public-feed request | Feed adapter | feed ID | Not persisted yet | None |
| Himalayas | Web server public-feed request | Feed adapter | feed GUID | Not persisted yet | None |
| Remote OK | Web server public-feed request | Feed adapter | feed ID | Not persisted yet | None |

Unsupported sources remain explicit. RoleAtlas does not bypass authentication, anti-bot controls, robots rules, or source terms.
