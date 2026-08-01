# Current architecture

Audited 2026-07-15 before Work Order 1.

## Runtime components

> Production-readiness update (2026-08-01): the canonical web runtime now uses supported Next.js 16 Node self-hosting. The unused Vinext/Vite/Cloudflare D1 starter scaffold was removed. The ownership and browser-storage descriptions below remain historical gaps until the tenancy and normalized-data phases replace them.

- `app/page.tsx` requests five public JSON feeds through `app/liveJobs.ts` during server rendering. These records are cached by the framework and are not persisted.
- `app/RoleAtlasApp.tsx` owns discovery filters, résumé state, AI calls, saved roles, dossiers, and application state. Durable daily state is synchronized through the workspace API when the complete stack is available, with reduced browser persistence as a fallback.
- `services/scout/src/bin/coordinator.rs` seeds a PostgreSQL crawl frontier and publishes NATS JetStream tasks.
- `services/scout/src/bin/worker.rs` applies robots rules and host delays, fetches pages, and extracts job records.
- `services/scout/src/frontier.rs` persists crawler output in PostgreSQL.
- `services/scout/src/bin/api.rs` exposes crawler jobs, counts, health, and seed submission. `app/api/local-scout/route.ts` proxies it to the web application.

## Persistence

PostgreSQL is the authoritative store for the Scout index and the current persisted profile/search/workspace paths. Public-feed records are transient. Provider configuration, compatibility bookmarks, dossiers, and extracted résumé text still have browser-storage paths that are scheduled for replacement by owned server records.

## Known failure paths

- Public feeds were deduplicated only by normalized company/title, collapsing separate locations and requisitions.
- Crawler records were upserted only by the exact `source_url` and never reconciled after a source stopped returning a job.
- The UI merged crawler refreshes into its existing array and could not remove stale records.
- Displayed totals were client-array sizes, not authoritative filtered database counts.
- AI-generated role queries were saved as résumé suggestions but never executed as discovery queries.
- An empty client filter result could not distinguish no match from incomplete source coverage.
