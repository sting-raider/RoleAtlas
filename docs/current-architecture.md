# Current architecture

Audited 2026-07-15 before Work Order 1.

## Runtime components

- `app/page.tsx` requests five public JSON feeds through `app/liveJobs.ts` during server rendering. These records are cached by the framework and are not persisted.
- `app/FirstRungApp.tsx` owns discovery filters, résumé state, AI calls, saved roles, dossiers, and application state. Most state is browser-only.
- `services/scout/src/bin/coordinator.rs` seeds a PostgreSQL crawl frontier and publishes NATS JetStream tasks.
- `services/scout/src/bin/worker.rs` applies robots rules and host delays, fetches pages, and extracts job records.
- `services/scout/src/frontier.rs` persists crawler output in PostgreSQL.
- `services/scout/src/bin/api.rs` exposes crawler jobs, counts, health, and seed submission. `app/api/local-scout/route.ts` proxies it to the web application.

## Persistence

PostgreSQL is the authoritative store only for crawler records. Public-feed records are transient. Provider configuration, bookmarks, applications, and dossiers use browser `localStorage`; the extracted résumé uses `sessionStorage`. The Cloudflare D1 files under `db/` and `worker/` are unused scaffolding, not the running data plane.

## Known failure paths

- Public feeds were deduplicated only by normalized company/title, collapsing separate locations and requisitions.
- Crawler records were upserted only by the exact `source_url` and never reconciled after a source stopped returning a job.
- The UI merged crawler refreshes into its existing array and could not remove stale records.
- Displayed totals were client-array sizes, not authoritative filtered database counts.
- AI-generated role queries were saved as résumé suggestions but never executed as discovery queries.
- An empty client filter result could not distinguish no match from incomplete source coverage.
