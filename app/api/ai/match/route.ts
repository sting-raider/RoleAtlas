import type { Job, ProviderName } from "../../../jobs";
import { activityFrom, providerEndpoint, providerHeaders, providerIsConfigured } from "../../../aiProvider.ts";

type MatchRequest = {
  provider: ProviderName;
  apiKey: string;
  baseUrl: string;
  model: string;
  profile?: string;
  resumeText: string;
  jobs: Job[];
};

type MatchResult = {
  profile?: { headline?: string; skills?: string[]; roleQueries?: string[]; experienceLevel?: string; locationHints?: string[] };
  matches?: Array<{ id?: string; score?: number; reasons?: string[]; gap?: string; verdict?: string }>;
};

function promptFor(body: MatchRequest, jobs: Job[], includeProfile: boolean) {
  const candidates = jobs.map((job) => ({
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    type: job.type,
    experience: job.experienceLabel,
    skills: job.skills,
    summary: job.summary.slice(0, 360),
  }));
  const profileInstruction = includeProfile
    ? 'Include "profile":{"headline":"one sentence","skills":["max 15"],"roleQueries":["5-10 concrete searches"],"experienceLevel":"short label","locationHints":["locations inferred"]},'
    : "";

  return `Evaluate this small batch of jobs against the candidate's résumé and infer realistic role families and search terms. Never invent experience. Scores must reflect résumé evidence, not general job friendliness. Penalize clear seniority, location, work-authorization, and missing must-have constraints. Projects, coursework, and volunteering count as evidence.

Optional user note:
${(body.profile ?? "").slice(0, 2000)}

Résumé text:
${body.resumeText.slice(0, 30_000)}

Candidate jobs:
${JSON.stringify(candidates)}

Return only JSON in this exact shape: {${profileInstruction}"matches":[{"id":"exact supplied id","score":0,"reasons":["2-3 evidence-based reasons"],"gap":"one honest gap or constraint","verdict":"strong|possible|stretch"}]}. Include every supplied job exactly once. Use the full 0-100 range.`;
}

function parseJson(content: string): MatchResult {
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(cleaned) as MatchResult;
}

async function requestChunk(body: MatchRequest, endpoint: string, jobs: Job[], includeProfile: boolean) {
  const anthropic = body.provider === "Anthropic";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: providerHeaders(body),
    body: JSON.stringify(anthropic
      ? { model: body.model, max_tokens: 2600, system: "Return complete, valid JSON only.", messages: [{ role: "user", content: promptFor(body, jobs, includeProfile) }] }
      : { model: body.model, temperature: 0.1, max_tokens: 2600, response_format: { type: "json_object" }, messages: [{ role: "system", content: "Return complete, valid JSON only." }, { role: "user", content: promptFor(body, jobs, includeProfile) }] }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const providerError = payload.error && typeof payload.error === "object" && "message" in payload.error
      ? String((payload.error as { message: unknown }).message)
      : `The provider returned ${response.status}.`;
    throw new Error(providerError);
  }
  const content = anthropic
    ? ((payload.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "")
    : ((payload.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content ?? "");
  if (!content) throw new Error("The provider returned no match data.");
  return parseJson(content);
}

export async function POST(request: Request) {
  const startedAt = new Date().toISOString();
  try {
    const body = await request.json() as MatchRequest;
    if (!providerIsConfigured(body) || !body.resumeText || !Array.isArray(body.jobs) || !body.jobs.length) {
      return Response.json({ error: "A configured model, résumé, and candidate jobs are required." }, { status: 400 });
    }

    const endpoint = providerEndpoint(body, "chat");
    const jobs = body.jobs.slice(0, 40);
    const chunks = Array.from({ length: Math.ceil(jobs.length / 8) }, (_, index) => jobs.slice(index * 8, index * 8 + 8));
    const combined: MatchResult = { profile: {}, matches: [] };

    for (const [index, chunk] of chunks.entries()) {
      const parsed = await requestChunk(body, endpoint, chunk, index === 0);
      if (index === 0) combined.profile = parsed.profile ?? {};
      combined.matches?.push(...(parsed.matches ?? []));
    }

    const matches = (combined.matches ?? [])
      .filter((match) => typeof match.id === "string" && typeof match.score === "number")
      .map((match) => ({
        id: match.id as string,
        score: Math.max(0, Math.min(100, Math.round(match.score as number))),
        reasons: (match.reasons ?? []).filter((reason): reason is string => typeof reason === "string").slice(0, 3),
        gap: typeof match.gap === "string" ? match.gap : "Review the original requirements before applying.",
        verdict: match.verdict === "strong" || match.verdict === "possible" || match.verdict === "stretch" ? match.verdict : "possible",
      }));
    return Response.json({ profile: combined.profile ?? {}, matches, activity: activityFrom(body, "resume_ranking", endpoint, startedAt, "success", ["résumé text", "optional constraints", "candidate job summaries"], { jobCount: jobs.length }) });
  } catch (error) {
    const message = error instanceof SyntaxError
      ? "The model returned an incomplete batch. Please try the AI ranking again."
      : error instanceof Error ? error.message : "AI matching failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
