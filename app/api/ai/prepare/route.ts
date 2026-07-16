import type { CareerDossier } from "../../../careerOps";
import type { Job, ProviderName } from "../../../jobs";
import { activityFrom, providerEndpoint, providerHeaders, providerIsConfigured } from "../../../aiProvider.ts";
import { secureProviderFetch } from "../../../providerFetch.ts";

type PrepareRequest = {
  provider: ProviderName;
  apiKey: string;
  baseUrl: string;
  model: string;
  profile: string;
  resumeText: string;
  job: Job;
};

function prompt(body: PrepareRequest) {
  const description = (body.job.description || body.job.summary).slice(0, 45_000);
  return `Build a complete, honest career-operations dossier for one job. The candidate may be early-career. Never invent experience, metrics, employers, education, or projects. Reframe only facts present in the resume. If evidence is absent, put it in missingEvidence instead of fabricating it.

CANDIDATE RESUME (only source of candidate claims):
${body.resumeText.slice(0, 55_000)}

OPTIONAL CANDIDATE CONSTRAINTS:
${body.profile || "None supplied"}

JOB:
Title: ${body.job.title}
Company: ${body.job.company}
Location: ${body.job.location}
Work mode: ${body.job.workMode}
Employment: ${body.job.type}
Experience signal: ${body.job.experienceLabel}
Posting age: ${body.job.postedDays == null ? "unknown" : `${body.job.postedDays} days`}
Source: ${body.job.source}
URL: ${body.job.url}
Description:
${description}

Evaluate these six dimensions on a 1-5 scale: Resume evidence, Skill alignment, Level accessibility, Career direction, Practical constraints, Employer clarity. The overall score is 0-100 and grade is A/B/C/D/F. Legitimacy is separate from fit and must use cautious language. Tailored resume content must remain ATS-safe and factual. Cover letter must be specific, natural, under 300 words, and contain no placeholders. Recruiter message must be under 450 characters. Return JSON only in exactly this shape:
{
  "grade":"A",
  "score":86,
  "verdict":"Apply now",
  "roleSummary":"...",
  "whyThisRole":"...",
  "dimensions":[{"name":"Resume evidence","score":4,"evidence":"..."}],
  "strengths":["..."],
  "gaps":["..."],
  "legitimacy":{"rating":"High confidence","signals":["..."]},
  "keywords":["..."],
  "resume":{"headline":"...","summary":"...","bulletRewrites":["..."],"missingEvidence":["..."]},
  "coverLetter":"...",
  "recruiterMessage":"...",
  "interview":{"likelyQuestions":["..."],"storiesToPrepare":["..."],"questionsToAsk":["..."]},
  "nextActions":["..."]
}`;
}

function stringArray(value: unknown, limit: number) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, limit) : [];
}

function normalize(value: unknown, provider: string): CareerDossier {
  const object = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const resume = object.resume && typeof object.resume === "object" ? object.resume as Record<string, unknown> : {};
  const legitimacy = object.legitimacy && typeof object.legitimacy === "object" ? object.legitimacy as Record<string, unknown> : {};
  const interview = object.interview && typeof object.interview === "object" ? object.interview as Record<string, unknown> : {};
  const grade = ["A", "B", "C", "D", "F"].includes(String(object.grade)) ? String(object.grade) as CareerDossier["grade"] : "C";
  const verdicts: CareerDossier["verdict"][] = ["Apply now", "Worth applying", "Consider carefully", "Skip"];
  const ratings: CareerDossier["legitimacy"]["rating"][] = ["High confidence", "Proceed with caution", "Suspicious"];
  const dimensions = Array.isArray(object.dimensions) ? object.dimensions.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.name !== "string") return [];
    return [{ name: row.name, score: Math.max(1, Math.min(5, Number(row.score) || 3)), evidence: typeof row.evidence === "string" ? row.evidence : "Evidence was not supplied." }];
  }).slice(0, 6) : [];
  return {
    grade,
    score: Math.max(0, Math.min(100, Number(object.score) || 50)),
    verdict: verdicts.includes(object.verdict as CareerDossier["verdict"]) ? object.verdict as CareerDossier["verdict"] : "Consider carefully",
    roleSummary: typeof object.roleSummary === "string" ? object.roleSummary : "Review the original listing before deciding.",
    whyThisRole: typeof object.whyThisRole === "string" ? object.whyThisRole : "The model did not return a career-direction assessment.",
    dimensions,
    strengths: stringArray(object.strengths, 6),
    gaps: stringArray(object.gaps, 6),
    legitimacy: { rating: ratings.includes(legitimacy.rating as CareerDossier["legitimacy"]["rating"]) ? legitimacy.rating as CareerDossier["legitimacy"]["rating"] : "Proceed with caution", signals: stringArray(legitimacy.signals, 6) },
    keywords: stringArray(object.keywords, 20),
    resume: { headline: typeof resume.headline === "string" ? resume.headline : "", summary: typeof resume.summary === "string" ? resume.summary : "", bulletRewrites: stringArray(resume.bulletRewrites, 8), missingEvidence: stringArray(resume.missingEvidence, 6) },
    coverLetter: typeof object.coverLetter === "string" ? object.coverLetter : "",
    recruiterMessage: typeof object.recruiterMessage === "string" ? object.recruiterMessage : "",
    interview: { likelyQuestions: stringArray(interview.likelyQuestions, 8), storiesToPrepare: stringArray(interview.storiesToPrepare, 6), questionsToAsk: stringArray(interview.questionsToAsk, 8) },
    nextActions: stringArray(object.nextActions, 6),
    generatedAt: new Date().toISOString(),
    provider,
  };
}

function parseJson(content: string) {
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(cleaned) as unknown;
}

export async function POST(request: Request) {
  const startedAt = new Date().toISOString();
  try {
    const body = await request.json() as PrepareRequest;
    if (!providerIsConfigured(body) || !body.resumeText || !body.job) {
      return Response.json({ error: "A résumé, job, model, and provider connection are required." }, { status: 400 });
    }
    const anthropic = body.provider === "Anthropic";
    const endpoint = providerEndpoint(body, "chat");
    const response = await secureProviderFetch(body, endpoint, {
      method: "POST",
      headers: providerHeaders(body),
      body: JSON.stringify(anthropic
        ? { model: body.model, max_tokens: 7000, system: "You are a rigorous career operations agent. Use only supplied candidate facts. Return valid JSON only.", messages: [{ role: "user", content: prompt(body) }] }
        : { model: body.model, temperature: 0.2, max_tokens: 7000, response_format: { type: "json_object" }, messages: [{ role: "system", content: "You are a rigorous career operations agent. Use only supplied candidate facts. Return valid JSON only." }, { role: "user", content: prompt(body) }] }),
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const providerError = payload.error && typeof payload.error === "object" && "message" in payload.error ? String((payload.error as { message: unknown }).message) : `The provider returned ${response.status}.`;
      return Response.json({ error: providerError }, { status: 502 });
    }
    const content = anthropic ? ((payload.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "") : ((payload.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content ?? "");
    if (!content) return Response.json({ error: "The provider returned an empty dossier." }, { status: 502 });
    return Response.json({ dossier: normalize(parseJson(content), body.provider), activity: activityFrom(body, "application_dossier", endpoint, startedAt, "success", ["résumé text", "optional constraints", "selected job description"], { jobCount: 1 }) });
  } catch (error) {
    const message = error instanceof SyntaxError ? "The model stopped before the dossier was complete. Try again; no application data was lost." : error instanceof Error ? error.message : "The dossier could not be prepared.";
    return Response.json({ error: message }, { status: 400 });
  }
}
