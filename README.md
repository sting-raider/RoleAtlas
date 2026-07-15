# RoleAtlas

RoleAtlas is a global, qualification-first job discovery and application workspace for internships, apprenticeships, entry-level roles, and adjacent opportunities. It is built around one question: **is this job worth your time?**

The product combines a polished discovery workspace with a distributed Rust crawler. The web app indexes hundreds of real listings from Arbeitnow, Remotive, Jobicy, Himalayas, and Remote OK, while the NATS scout stack automatically expands coverage to a maintained catalog of company career pages and structured job postings.

## What is already here

- Dense job search with plain-English filters for experience, degree requirements, work style, salary, visa support, role type, and freshness.
- Resume-first suitability scores with traceable evidence, honest gaps, and source confidence. No personal match is shown until a PDF resume is supplied.
- Saved roles, a persistent application pipeline, and a career-profile evidence bank.
- Career Ops-style application dossiers: a structured A–F evaluation, posting-legitimacy signals, factual résumé tailoring, a cover letter, recruiter outreach, interview questions, story prompts, and a next-action checklist. Dossiers and statuses persist in the browser.
- Optional bring-your-own-model automation for DeepSeek, OpenAI, Anthropic, Gemini, OpenRouter, Groq, Mistral, and custom OpenAI-compatible endpoints. Live job search and local resume matching work without a model.
- Connected models parse resume evidence, infer realistic role families and search terms, batch-rank jobs, interpret requirements, surface constraints, and prepare truthful applications. Provider keys remain device-local and are sent only when the user runs AI matching or preparation.
- A NATS JetStream crawler built in Rust with durable pull consumers, explicit acknowledgements, retries, per-host pacing, `robots.txt` handling, URL canonicalization, content hashes, Schema.org extraction, and bulk public ATS ingestion for Greenhouse, Lever, and Ashby.
- PostgreSQL frontier deduplication and normalized job storage.
- A small HTTP API for filtered jobs, crawl stats, health, and adding new seed URLs.

## Architecture

```text
Seed URLs / API
      │
      ▼
Coordinator ── firstrung.crawl.pending ──► NATS JetStream
      ▲                                         │
      │                                         ▼
PostgreSQL ◄── firstrung.crawl.result ─── Rust worker fleet
  frontier        normalized jobs          fetch + parse + discover
      │
      ▼
Scout API :8080 ──► RoleAtlas web UI
```

The architecture keeps scheduling, crawling, indexing, and presentation separate. Add worker replicas to increase crawl throughput; every worker shares the same durable pull consumer and acknowledges work only after publishing a result.

## Run the web experience

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

The local site is available at `http://localhost:3000`.

## Run the live scout stack

Requirements: Docker with Compose.

```bash
cp .env.example .env
docker compose up --build
```

If a recent Docker Desktop on Windows returns a `v1.54/images/create` 500 error, use its stable compatibility API for that PowerShell session:

```powershell
$env:DOCKER_API_VERSION="1.44"
docker compose up --build
```

Open `http://localhost:3000`. The crawler starts with Docker Compose, queues the maintained source catalog without user input, revisits it every six hours, and the website merges newly indexed jobs into Discover every 30 seconds. **Scout controls** is an advanced status panel for watching the queue or adding an extra careers page. Search starts with no filters selected; choose a country and then a city or region when location matters.

Services:

- RoleAtlas website and scout controls: `http://localhost:3000`
- RoleAtlas Scout API: `http://localhost:8080`
- NATS monitoring: `http://localhost:8222`
- PostgreSQL: `localhost:5432`

Add a company careers page:

```bash
curl -X POST http://localhost:8080/api/seeds \
  -H "content-type: application/json" \
  -d '{"url":"https://example.com/careers"}'
```

Run additional workers with:

```bash
docker compose up --scale worker=4
```

The web app's built-in public feeds, PDF text extraction, deterministic resume ranking, and local crawler require no model API key. Docker Compose connects the website to the Rust scout automatically. A model key unlocks semantic resume interpretation, role-query generation, batch evidence ranking, constraint checks, and application preparation.

## Responsible crawling

RoleAtlas identifies itself with a configurable user agent, reads `robots.txt`, enforces a per-host delay, caps response sizes, limits crawl depth, and follows only job-like links on the same host. Before crawling a production source, review its terms and prefer official ATS feeds or APIs where available.

## Suggested next additions

1. Account sync and encrypted server-side provider keys.
2. Encrypted account sync across devices.
3. Expiration checks, repost detection, and salary normalization by market.
4. Email or push alerts for saved searches.
5. Accessibility, visa, work-authorization, and schedule confidence fields.
6. Human-reviewed auto-fill assistance—never automatic submission.

## Attribution

The design and architecture were informed by the MIT-licensed [Arachne](https://github.com/Noel-Alex/Arachne) and [Career Ops](https://github.com/santifer/career-ops) projects. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
