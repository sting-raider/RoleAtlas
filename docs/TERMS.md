# Terms of use

> **Template — owner review required.** RoleAtlas is software you self-host. These terms are a starting point for an operator who runs an instance for other people; they do not bind anyone by themselves. An operator must review, adapt, and publish them with their own identity and contact information. Nothing here is legal advice.

## The service

RoleAtlas is provided as free, open-source software (see the [LICENSE](../LICENSE)) for you to run on your own infrastructure. "The service" below means a specific deployment of that software operated by someone else or by you. The RoleAtlas project itself operates no hosted service.

## No warranty

The service is provided **as is**, without warranty of any kind. To the maximum extent permitted by law, the operators and contributors disclaim all implied warranties, including merchantability, fitness for a particular purpose, and non-infringement.

In particular:

- Job listings come from public sources crawled at intervals or from public feeds. Listings may be stale, incomplete, withdrawn, inaccurate, or already filled. Coverage claims are explicit: RoleAtlas reports only the configured sources it actually checked and never claims complete job-market coverage.
- Eligibility explanations (work authorization, sponsorship, relocation, timezones, employment type) are conservative inferences from listing evidence. Missing evidence stays marked unknown. Nothing in the service is legal advice about your right to work anywhere.
- AI features are optional, powered by providers you configure with your own keys, and can be wrong. AI output never decides eligibility and never submits anything on your behalf.

## Your account and content

- You are responsible for the accuracy of what you enter: profile details, resume-derived data, goals, constraints, notes, applications, and contacts.
- Do not upload content you have no right to use, and do not use the service to misrepresent your qualifications or identity to employers.
- You keep ownership of everything you write. You grant the operator only the limited right to store and process it to provide the service to you.
- Your data lives in the operator's PostgreSQL instance and backups; see [PRIVACY.md](PRIVACY.md) for exactly where and how it is handled, exported, and deleted.

## Crawling and fair use of sources

The crawler identifies itself with a configurable user agent, honors `robots.txt`, paces requests per host, caps response sizes and crawl depth, and follows only job-like links on the same host. It does not bypass authentication, anti-bot controls, or source terms. If you operate a site that does not want crawling, standard `robots.txt` rules are respected; contact the operator of the instance you are concerned about. Source registry entries point at employer-controlled applicant-tracking feeds by design.

## Acceptable use

You agree not to:

- use the service to spam, scrape en masse on behalf of others, or resell raw listing data in violation of source terms;
- attempt to access other users' records, probe the service beyond the safe-harbor in [SECURITY.md](SECURITY.md), or interfere with its operation;
- configure AI providers you are not authorized to use;
- use the service where prohibited by applicable law.

## Limitation of liability

To the maximum extent permitted by law, neither the operators nor the RoleAtlas contributors are liable for any indirect, incidental, special, consequential, or punitive damages, or for lost opportunities, lost data, or lost profits arising from use of or inability to use the service — including consequences of acting on job listings, eligibility explanations, or AI-generated material found through it. The service surfaces information; decisions and applications remain entirely yours.

## Termination and deletion

- **By you, any time**: export your data from Settings, then delete your account from Settings. Deletion cascades through every owned record immediately and irreversibly; shared canonical job listings remain. See [PRIVACY.md](PRIVACY.md) for what survives (an anonymized audit fingerprint) and how backups are handled.
- **By the operator**: an operator may suspend or terminate access for acceptable-use violations. Before doing so for a personal-data reason other than violation, the operator should offer the export/deletion path above.
- **Discontinuation by the operator**: whoever runs an instance may shut it down; publishing advance notice and a final export window is strongly recommended.

## Changes

Operators should date and log changes to these terms when adapting them. Continued use of a deployment after a posted change constitutes acceptance of the changed terms for that deployment.

## Contact

REPLACE-ME: the operator of a public instance must list a real contact address here before inviting users.
