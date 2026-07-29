import RoleAtlasApp from "./RoleAtlasApp";
import { getLiveJobs } from "./liveJobs";

export default async function Home() {
  const payload = await getLiveJobs();
  return <RoleAtlasApp initialPayload={payload} />;
}
