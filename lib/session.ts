import "server-only";

import { auth } from "./auth.ts";

export type SessionPrincipal = {
  userId: string;
  role: "user" | "admin";
};

export async function sessionPrincipal(
  requestHeaders: Headers,
): Promise<SessionPrincipal | null> {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user?.id) return null;
  return {
    userId: session.user.id,
    role: session.user.role === "admin" ? "admin" : "user",
  };
}

export function unauthorizedResponse() {
  return Response.json(
    { error: { code: "authentication_required", message: "Sign in to continue." } },
    { status: 401 },
  );
}

export function forbiddenResponse() {
  return Response.json(
    { error: { code: "forbidden", message: "You do not have permission to perform this action." } },
    { status: 403 },
  );
}
