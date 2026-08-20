import { z } from "zod";
import { postgres } from "../../../../lib/postgres.ts";
import { sessionPrincipal, unauthorizedResponse } from "../../../../lib/session.ts";
import { validateProviderUrl } from "../../../aiProvider.ts";

const providerNames = [
  "NVIDIA NIM",
  "DeepSeek",
  "OpenAI",
  "Anthropic",
  "Gemini",
  "OpenRouter",
  "Groq",
  "Mistral",
  "Ollama",
  "Custom OpenAI-compatible",
] as const;

const bodySchema = z.object({
  provider: z.enum(providerNames),
  model: z.string().trim().min(1).max(300),
  baseUrl: z.string().trim().min(1).max(2_000),
  profile: z.string().max(10_000).default(""),
  verification: z.object({
    status: z.enum(["untested", "verified", "failed"]),
    testedAt: z.string().datetime({ offset: true }).optional(),
    baseUrl: z.string().max(2_000).optional(),
    model: z.string().max(300).optional(),
    message: z.string().max(2_000).optional(),
  }).default({ status: "untested" }),
}).strict();

export async function GET(request: Request) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  const result = await postgres.query(
    `SELECT provider, model, base_url AS "baseUrl", profile_note AS profile,
            verification, updated_at AS "updatedAt"
       FROM user_provider_configurations
      WHERE user_id = $1
      ORDER BY updated_at DESC
      LIMIT 1`,
    [principal.userId],
  );
  return Response.json({ config: result.rows[0] ?? null }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: Request) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "invalid_provider_configuration", message: "The provider configuration is invalid." } }, { status: 400 });
  }
  try {
    validateProviderUrl({ provider: parsed.data.provider }, parsed.data.baseUrl);
  } catch {
    return Response.json({ error: { code: "invalid_provider_endpoint", message: "The provider endpoint is not allowed." } }, { status: 400 });
  }
  await postgres.query(
    `INSERT INTO user_provider_configurations
      (user_id,provider,model,base_url,profile_note,verification,credential_reference)
     VALUES ($1,$2,$3,$4,$5,$6,NULL)
     ON CONFLICT (user_id,provider) DO UPDATE
       SET model=EXCLUDED.model, base_url=EXCLUDED.base_url, profile_note=EXCLUDED.profile_note,
           verification=EXCLUDED.verification, credential_reference=NULL, updated_at=NOW()`,
    [principal.userId, parsed.data.provider, parsed.data.model, parsed.data.baseUrl, parsed.data.profile, JSON.stringify(parsed.data.verification)],
  );
  return Response.json({ saved: true, credentialPersisted: false });
}

export async function DELETE(request: Request) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  await postgres.query("DELETE FROM user_provider_configurations WHERE user_id = $1", [principal.userId]);
  return Response.json({ deleted: true });
}
