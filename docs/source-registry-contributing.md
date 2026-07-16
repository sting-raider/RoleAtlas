# Contributing a source

RoleAtlas accepts canonical employer-controlled careers boards and supported public ATS endpoints. The registry is intentionally evidence-first: adding fewer verified boards is better than adding a large speculative list.

## Required evidence

1. Confirm the careers URL is controlled by the employer.
2. Resolve it to a supported public Greenhouse, Lever, or Ashby board endpoint.
3. Run a complete scan without bypassing authentication, robots rules, rate limits, or access protections.
4. Record the observed job count and only the hiring countries/regions present in current listing evidence or explicit employer hiring metadata.
5. Record internship and remote history only when current listings support it. Never convert “remote” into “worldwide.”
6. Run `npm run registry:validate` and the fixture-based test suite.

Employer headquarters, marketing presence, résumé language, and a careers-page HTTP 200 are not proof of hiring eligibility. AI may suggest a board for human review, but an AI-proposed URL must remain experimental with `autoEnqueue: false` until canonical ownership, adapter compatibility, and a successful scan are verified.

## States

- `verified`: canonical endpoint, compatible adapter, successful complete scan with at least one job, eligible for automatic scans.
- `experimental`: under manual validation; never automatically scanned.
- `disabled`: retained for history but excluded from selection and scanning.

Do not put secrets, private recruiter links, authenticated endpoints, scraped aggregators, or model-generated URLs into the trusted registry.
