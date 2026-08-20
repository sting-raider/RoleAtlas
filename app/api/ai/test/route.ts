import { sessionPrincipal, unauthorizedResponse } from "../../../../lib/session.ts";
import { testProviderConnection } from "../../../aiConnectionTest.ts";
import { persistAiActivity } from "../../../../lib/ai-activity.ts";

export async function POST(request: Request) {
  const principal = await sessionPrincipal(request.headers);
  if (!principal) return unauthorizedResponse();
  return testProviderConnection(request, (activity) => persistAiActivity(principal.userId, activity));
}
