import type { Job, ProviderName } from "../../../jobs";

type AnalyzeRequest = {
  provider: ProviderName;
  apiKey: string;
  baseUrl: string;
  model: string;
  profile: string;
  job: Job;
};

type Analysis = {
  fitSummary: string;
  strengths: string[];
  gaps: string[];
  nextSteps: string[];
  applicationAngle: string;
};

function safeEndpoint(baseUrl: string, provider: ProviderName) {
  if (provider === "Ollama") throw new Error("Ollama is only available when RoleAtlas is run locally.");
  const url = new URL(baseUrl);
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:") throw new Error("The provider URL must use HTTPS.");
  if (hostname === "localhost" || hostname.endsWith(".local") || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) {
    throw new Error("Private network provider URLs are not available from the hosted app.");
  }
  const base = url.toString().replace(/\/$/, "");
  return provider === "Anthropic" ? `${base}/v1/messages` : `${base}/chat/completions`;
}

function promptFor(profile: string, job: Job) {
  return `Analyze this real job for a career starter. Be honest and do not invent qualifications. Treat inferred metadata as uncertain.

Candidate résumé and optional context:
${profile.slice(0, 30_000)}

Job:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Type: ${job.type}
Experience signal: ${job.experienceLabel}
Skills/tags: ${job.skills.join(", ")}
Summary: ${job.summary}

Return only JSON with this exact shape: {"fitSummary":"2 concise sentences","strengths":["up to 3 evidence-based strengths"],"gaps":["up to 3 honest gaps or questions"],"nextSteps":["up to 3 concrete actions before applying"],"applicationAngle":"one truthful positioning angle"}.`;
}

function normalizeAnalysis(value: unknown): Analysis {
  const object = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const strings = (key: string) => Array.isArray(object[key]) ? (object[key] as unknown[]).filter((item): item is string => typeof item === "string").slice(0, 3) : [];
  return {
    fitSummary: typeof object.fitSummary === "string" ? object.fitSummary : "The model returned an incomplete analysis. Review the original listing before applying.",
    strengths: strings("strengths"),
    gaps: strings("gaps"),
    nextSteps: strings("nextSteps"),
    applicationAngle: typeof object.applicationAngle === "string" ? object.applicationAngle : "Lead with relevant proof from projects, coursework, or volunteering.",
  };
}

function parseModelJson(content: string) {
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return normalizeAnalysis(JSON.parse(cleaned));
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as AnalyzeRequest;
    if (!body.apiKey || !body.model || !body.baseUrl || !body.job) {
      return Response.json({ error: "Provider, key, model, and job are required." }, { status: 400 });
    }
    const endpoint = safeEndpoint(body.baseUrl, body.provider);
    const prompt = promptFor(body.profile, body.job);
    const anthropic = body.provider === "Anthropic";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: anthropic
        ? { "Content-Type": "application/json", "x-api-key": body.apiKey, "anthropic-version": "2023-06-01" }
        : { "Content-Type": "application/json", Authorization: `Bearer ${body.apiKey}` },
      body: JSON.stringify(anthropic
        ? { model: body.model, max_tokens: 1000, system: "You are a precise, supportive career analyst. Return valid JSON only.", messages: [{ role: "user", content: prompt }] }
        : { model: body.model, temperature: 0.2, max_tokens: 1000, response_format: { type: "json_object" }, messages: [{ role: "system", content: "You are a precise, supportive career analyst. Return valid JSON only." }, { role: "user", content: prompt }] }),
    });

    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const providerError = payload.error && typeof payload.error === "object" && "message" in payload.error
        ? String((payload.error as { message: unknown }).message)
        : `The provider returned ${response.status}.`;
      return Response.json({ error: providerError }, { status: 502 });
    }

    const content = anthropic
      ? ((payload.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "")
      : ((payload.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content ?? "");
    if (!content) return Response.json({ error: "The provider returned no analysis." }, { status: 502 });
    return Response.json({ analysis: parseModelJson(content) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Analysis failed." }, { status: 400 });
  }
}
