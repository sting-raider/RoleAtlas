# Career agent runtime

RoleAtlas has one server-side career-agent runtime. It is not a collection of prompt endpoints, and it never gives a model raw PostgreSQL, NATS, crawler, shell, or arbitrary HTTP access.

## Execution boundary

An authenticated user creates an `agent_run` with a natural-language goal and explicit budgets. The runtime then advances a persistent loop:

1. create or load an inspectable plan;
2. resolve step inputs only from persisted observations;
3. validate a proposed tool and its arguments against the registered schema;
4. enforce the tool's effect policy and ownership boundary;
5. execute the bounded server-side implementation;
6. validate and persist the result as untrusted evidence;
7. retry, wait, re-plan, pause for approval, or complete.

Every transition is lease-protected. A web restart, browser refresh, or another device can load and resume the same run without relying on browser state. Interrupted idempotent calls are recoverable; interrupted non-idempotent calls pause for human review.

## Persistent records

Migrations `0014_agent_runtime.sql` and `0015_agent_step_keys.sql` add:

- `agent_runs` — goal, status, phase, budgets, usage, model metadata, deadline, cancellation, and lease;
- `agent_plan_revisions` — immutable plan history and re-plan reason;
- `agent_steps` — plan, tool, message, observation, delegation, and approval steps;
- `agent_tool_calls` — validated arguments, policy result, idempotency key, result, latency, usage metadata, and safe failure;
- `agent_approvals` — exact-call, expiring human approval decisions;
- `agent_workers` — bounded delegated work owned by the same user and run;
- `agent_run_events` — ordered lifecycle and policy evidence.

All tables are user-owned, have same-user parent foreign keys, and cascade on account erasure. Account export schema version 3 includes the complete agent history but never provider credentials.

## Registered tools and effects

The initial registry exposes canonical search and product operations:

- read-only: `search_jobs`, `get_job`, `compare_jobs`, `get_search_strategy`, `get_search_coverage`, `get_source_scan_status`, `rank_jobs`, `analyze_job`, controlled research placeholders, `get_application_state`, `get_followups`, and `get_notifications`;
- auditable internal writes: `create_search_strategy`, `revise_search_strategy`, `request_source_scan`, `prepare_application`, `prepare_interview`, and `update_application_state`;
- approval required: the reserved `send_external_message` boundary.

Research tools return an explicit unavailable result until a controlled provider exists. External message delivery is intentionally not implemented. The deterministic planner and product remain usable without an AI provider.

## Approved-source crawler dispatch

`request_source_scan` accepts only a stable source ID. The web runtime signs the authenticated user and exact `/api/source-scans` request through `lib/scout-client.ts`. Scout then:

1. resolves the ID from the compiled, verified, auto-enqueue registry;
2. rejects a disabled or quarantined database source;
3. derives a retry-stable source-run UUID from the user, source ID, and idempotency key;
4. resolves the endpoint URL internally—never from model output;
5. publishes the crawl task to the bounded JetStream work queue with a NATS message ID;
6. returns only the source-run receipt.

The status tool reads that persisted shared source run. A `queued` or `running` observation puts the agent run in `waiting_for_tool`; a later resume polls again and continues only after a terminal crawler result. Existing indexed jobs remain available if Scout or NATS is unavailable.

Registry hiring geography may help select a source, but it never confirms a candidate's eligibility for an individual listing.

## Current limitations

- The production model-backed planner/router and encrypted long-lived BYOK storage are not implemented yet.
- Bounded persistent parallel workers have schema groundwork but are not connected to execution yet.
- Async runs currently advance when the authenticated client or a future scheduler calls resume; a background agent-run scheduler is not connected yet.
- Company, compensation, and contact research providers are explicit unavailable placeholders.
- Application artifacts are deterministic evidence-required templates until the user approves a configured model action.
- Agent plan/activity/approval UI is not yet implemented.

These limitations keep unsafe behavior unavailable rather than simulated.
