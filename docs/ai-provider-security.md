# AI provider network security

RoleAtlas sends model requests from its server routes, not directly from the browser. The request path is `browser -> RoleAtlas /api/ai/* -> provider`; therefore the RoleAtlas server temporarily receives the configured credential and request data. Credentials are not written to PostgreSQL or server storage. Browser persistence is optional and uses local storage only when the user selects **Remember key on this device**.

## Enforced controls

- Hosted and custom provider endpoints must use HTTPS. Loopback HTTP is permitted only for local Ollama and NVIDIA NIM runtimes.
- Literal loopback, private, link-local, multicast, unspecified, benchmarking, and documentation-only address ranges are rejected for non-local providers.
- Customized provider hostnames are resolved before the request. Every resolved address must be public; a mixed public/private response is rejected.
- Redirects are handled manually, limited to three hops, and every target is revalidated. Cross-origin redirects are rejected so credentials cannot be forwarded to another origin. Authenticated POST redirects that would change the HTTP method are also rejected.
- Model-generated URLs never enter the source registry or provider configuration automatically.

## Known limitations

- DNS validation and the subsequent network connection are separate operations. The runtime fetch performs its own DNS lookup, so a malicious DNS service could change an answer between validation and connection (DNS rebinding/time-of-check-to-time-of-use). The resolved address is not yet pinned to the outbound socket.
- Built-in official provider origins are allowlisted and skip the extra application-level DNS preflight. They still require HTTPS and manual redirect validation, but trust also depends on system DNS, the hosting platform, and the provider domain remaining secure.
- Loopback Ollama/NIM access is intentional. Anyone who can change RoleAtlas provider settings may direct those two provider types to services on the RoleAtlas host's loopback interface.
- A reverse proxy, service mesh, HTTP proxy environment variable, or custom runtime resolver can alter the effective network route after application validation. Deployments should also enforce outbound firewall or egress-proxy rules.
- HTTPS protects credentials in transit only when certificate validation and the host running RoleAtlas are trusted. A remotely hosted RoleAtlas instance can observe the API key and submitted resume/job data while proxying the request.

For high-assurance deployments, restrict outbound traffic to approved provider domains/IP ranges, isolate the RoleAtlas service from private networks, avoid arbitrary custom endpoints, and use short-lived or least-privilege provider credentials.

## User-visible request transparency

Work Order 6 exposes the existing provider architecture through Settings. Before an AI action, RoleAtlas shows the provider, model, purpose, categories of candidate/job data being sent, whether the target is local or external, whether the request passes through the RoleAtlas server, and an estimated input size. The user must confirm the action; configuring a provider does not silently trigger model requests.

The activity history records redacted request metadata and status, never the credential or full prompt. Clearing a key removes the browser-held credential. AI remains optional for onboarding, strategy editing, search, eligibility evaluation, feedback, saved jobs, and application tracking. No real provider credential was used during Work Order 6 verification; provider networking is covered by deterministic fixtures and the existing SSRF/redirect tests.
