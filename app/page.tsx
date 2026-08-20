import RoleAtlasApp from "./RoleAtlasApp";
import { getLiveJobs } from "./liveJobs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "../lib/auth.ts";

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const payload = await getLiveJobs();
  return <RoleAtlasApp initialPayload={payload} currentUser={{ id: session.user.id, name: session.user.name, email: session.user.email }} />;
}
