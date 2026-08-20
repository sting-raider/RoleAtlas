import { createHmac } from "node:crypto";

export type InternalAssertionInput = {
  secret: string;
  timestamp: string;
  method: string;
  path: string;
  userId: string;
  role: "user" | "admin";
};

export function createInternalAssertion(input: InternalAssertionInput) {
  const message = [
    input.timestamp,
    input.method.toUpperCase(),
    input.path,
    input.userId,
    input.role,
  ].join("\n");
  return createHmac("sha256", input.secret).update(message).digest("hex");
}
