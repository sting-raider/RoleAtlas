# FirstRung

FirstRung is a qualification-first job finder for internships, apprenticeships, and genuinely entry-level roles. It is built around one question: **is this job worth a beginner's time?**

The product combines a polished discovery workspace with a distributed Rust crawler. The hosted web build indexes real beginner-friendly listings from Arbeitnow and Remotive, while the NATS scout stack expands coverage to company career pages and structured job postings.

## What is already here

- Dense job search with plain-English filters for experience, degree requirements, work style, salary, visa support, role type, and freshness.
- Transparent suitability scores with evidence, honest gaps, and source confidence.
- Saved roles, an application pipeline, and a career-profile evidence bank.
- Optional bring-your-own-model analysis for DeepSeek, OpenAI, Anthropic, Gemini, OpenRouter, Groq, Mistral, and custom OpenAI-compatible endpoints. Live job search works without a model.
- On-demand AI comparison of a listing with the candidate profile, including strengths, gaps, next steps, and a truthful application angle. Provider keys remain device-local and are sent only for an explicit analysis request.
- A NATS JetStream crawler built in Rust with durable pull consumers, explicit acknowledgements, retries, per-host pacing, `robots.txt` handling, URL canonicalization, content hashes, and job-specific Schema.org extraction.
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
Scout API :8080 ──► FirstRung web UI
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

Services:

- FirstRung Scout API: `http://localhost:8080`
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

The web app's built-in live feeds require no API key. The Rust scout is the production expansion path for direct company sites; configure the web app to consume its `/api/jobs` endpoint when that service is hosted.

## Responsible crawling

FirstRung identifies itself with a configurable user agent, reads `robots.txt`, enforces a per-host delay, caps response sizes, limits crawl depth, and follows only job-like links on the same host. Before crawling a production source, review its terms and prefer official ATS feeds or APIs where available.

## Suggested next additions

1. Account sync and encrypted server-side provider keys.
2. Resume/profile import with user-approved evidence extraction.
3. Greenhouse, Lever, and Ashby API adapters before HTML fallback.
4. Expiration checks, repost detection, and salary normalization by market.
5. Email or push alerts for saved searches.
6. Accessibility, visa, work-authorization, and schedule confidence fields.
7. Human-reviewed auto-fill assistance—never automatic submission.

## Attribution

The design and architecture were informed by the MIT-licensed [Arachne](https://github.com/Noel-Alex/Arachne) and [Career Ops](https://github.com/santifer/career-ops) projects. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
