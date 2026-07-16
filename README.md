# RoleAtlas

RoleAtlas is a qualification-first job discovery and application workspace. It searches an existing job index immediately, explains geographic and employment eligibility conservatively, expands selected verified sources through a NATS-backed crawler, and helps a candidate prepare a truthful application.

It is designed for searches in any country. India is an important regression case, not a special-case architecture. RoleAtlas reports only the configured sources it successfully checked; it does not claim complete global job-market coverage.

## What is implemented

- A resume-first candidate profile that must be reviewed before it becomes a persisted search plan. Raw resume text remains in browser session storage; the structured profile and plan are stored in PostgreSQL.
- Persisted full-index search sessions with query provenance, history, source coverage, feedback, and reruns. A reviewed plan can be rerun after a browser restart without uploading the resume again; AI actions that need raw resume text still require it in the current browser session.
- A centralized global eligibility model built from ISO 3166 countries/subdivisions, IANA timezones, explicit region membership, and listing-level evidence. It covers country and subdivision exclusions, remote regions, work authorization, sponsorship, relocation, timezones, and hybrid attendance.
- International opportunity classification for internships, apprenticeships, entry-level, full-time, part-time, and contract work. Unresolved employment types remain `Unknown`; they are not silently converted to full-time roles.
- Search-directed source expansion. Existing eligible results appear first, then the API selects up to 12 relevant sources from the trusted registry, reuses fresh runs, or queues stale sources through NATS. Completed runs reconcile into the canonical index and rerank the same persisted session.
- A Rust crawler with NATS JetStream durable consumers, retries, per-host pacing, `robots.txt` handling, URL canonicalization, content hashes, Schema.org extraction, and supported Greenhouse, Lever, and Ashby adapters.
- Canonical job identity, source-run reconciliation, lifecycle history, trustworthy pre-pagination counts, and explicit partial/deferred coverage when PostgreSQL, NATS, or crawler components are unavailable.
- Career Ops-style application dossiers: structured evaluation, legitimacy signals, factual resume tailoring, cover letters, recruiter outreach, interview preparation, story prompts, and a next-action checklist.
- Optional bring-your-own-model support for NVIDIA NIM, DeepSeek, OpenAI, Anthropic, Gemini, OpenRouter, Groq, Mistral, Ollama, and custom OpenAI-compatible endpoints. Search and deterministic eligibility continue to work with AI disabled.

## Current source limitation

The trusted automatic registry currently contains **16 verified employer-controlled Greenhouse or Ashby boards**. These sources are geographically diverse and listing-backed, but they are not 16 countries, a complete market, or proof of worldwide coverage. Each search selects at most 12 of them. Arbeitnow, Remotive, Jobicy, Himalayas, and Remote OK can supplement the web experience, but those public-feed listings are still transient and do not yet participate in crawler reconciliation.

Registry-level country and region tags are routing evidence only: they can make a source worth scanning. They never confirm that an individual candidate may apply. Candidate eligibility requires evidence on the individual listing; missing or ambiguous evidence remains `unclear`.

See [docs/source-support.md](docs/source-support.md) for the exact support and trust boundaries.

## Architecture

```text
Resume -> reviewed profile -> persisted search plan
                              |
                              v
                     full PostgreSQL index --------> immediate eligible results
                              |
                              v
                  verified source selection (max 12 of 16)
                              |
                 fresh run --+-- stale run -> NATS JetStream -> Rust workers
                              |                         |
                              +---- reconciliation <---+
                                        |
                              rerank persisted session
```

Canonical identity, source reconciliation, search history, and eligibility are server-side. The browser renders the persisted decisions and evidence instead of maintaining a competing location engine.

## Run the web experience

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

The local site is available at `http://localhost:3000`. Without PostgreSQL or NATS it retains public-feed discovery and deterministic browser-side matching, while unavailable persisted/crawler features are reported honestly.

## Run the complete scout stack

Requirements: Docker with Compose.

```bash
cp .env.example .env
docker compose up --build
```

On Windows, if Docker Desktop reports that `dockerDesktopLinuxEngine` cannot be found, start Docker Desktop and wait for the Linux engine to become ready. If a recent Docker Desktop instead returns a `v1.54/images/create` compatibility error, set this for that PowerShell session:

```powershell
$env:DOCKER_API_VERSION="1.44"
docker compose up --build
```

Services:

- RoleAtlas website: `http://localhost:3000`
- Scout API: `http://localhost:8080`
- NATS monitoring: `http://localhost:8222`
- PostgreSQL: `localhost:5432`

The coordinator periodically revisits the configured registry. Persisted searches also direct incremental expansion automatically; users do not have to start the crawler. Custom careers URLs remain an advanced operator action and do not enter the trusted registry automatically.

Additional workers can be started with:

```bash
docker compose up --scale worker=4
```

## AI providers and NVIDIA NIM

AI is optional. A configured provider can interpret resume evidence, expand confirmed search queries, batch-rank retrieved jobs, explain constraints, and prepare application material. AI cannot decide geographic eligibility, trust a source, enqueue a model-generated URL, or submit an application.

NVIDIA NIM supports both NVIDIA's hosted OpenAI-compatible endpoint and a loopback self-hosted NIM runtime. Hosted and custom providers require HTTPS. Plain HTTP is allowed only for loopback Ollama or NVIDIA NIM.

The actual API-key network path is:

```text
browser -> RoleAtlas /api/ai/* server route -> configured model provider
```

The browser does **not** call the model vendor directly. The RoleAtlas server receives the key for that request and forwards it in the provider authorization header; it does not persist the key in PostgreSQL or server storage. Browser persistence is opt-in through **Remember key on this device**; otherwise the key is held only in page memory. Use HTTPS and a trusted RoleAtlas host when the browser and server are on different machines.

A provider is shown as verified only after RoleAtlas calls its model-list endpoint and confirms the configured model. Request activity records provider, model, purpose, status, and data categories but never the key. Custom provider URLs receive scheme, literal-address, DNS-resolution, and redirect-target checks. The remaining DNS-rebinding and deployment-proxy limitations are documented in [docs/ai-provider-security.md](docs/ai-provider-security.md).

## Verification

```bash
npm run format:check
npm run lint
npm run typecheck
npm run registry:validate
npm test
cargo fmt --manifest-path services/scout/Cargo.toml --all -- --check
cargo clippy --manifest-path services/scout/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path services/scout/Cargo.toml
```

PostgreSQL integration tests are marked ignored and are run explicitly against the Docker database; see [docs/progress.md](docs/progress.md) for the latest executed verification.

## Responsible crawling

RoleAtlas identifies itself with a configurable user agent, reads `robots.txt`, enforces a per-host delay, caps response sizes, limits crawl depth, and follows only job-like links on the same host. It does not bypass authentication, anti-bot controls, source terms, or crawl protections. Prefer official employer ATS feeds and validate source evidence before adding an automatic registry entry.

## Attribution

The design and architecture were informed by the MIT-licensed [Arachne](https://github.com/Noel-Alex/Arachne) and [Career Ops](https://github.com/santifer/career-ops) projects. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
