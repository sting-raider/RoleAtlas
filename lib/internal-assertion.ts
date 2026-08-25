import { createHash, createHmac } from "node:crypto";

export type InternalAssertionInput = {
  secret: string;
  timestamp: string;
  method: string;
  path: string;
  userId: string;
  role: "user" | "admin";
  /**
   * Hex SHA-256 of the exact request body bytes. Requests without a body
   * sign the SHA-256 of the empty string, so a captured signature can never
   * be replayed against a different payload within the timestamp window.
   */
  body?: Buffer | string;
};

/** The digest signed when no body is present (SHA-256 of zero bytes). */
const EMPTY_BODY_DIGEST = createHash("sha256").update("").digest("hex");

function bodyDigest(body: Buffer | string | undefined): string {
  if (body === undefined || body === "") return EMPTY_BODY_DIGEST;
  return createHash("sha256").update(body).digest("hex");
}

export function createInternalAssertion(input: InternalAssertionInput) {
  const message = [
    input.timestamp,
    input.method.toUpperCase(),
    input.path,
    input.userId,
    input.role,
    bodyDigest(input.body),
  ].join("\n");
  return createHmac("sha256", input.secret).update(message).digest("hex");
}
