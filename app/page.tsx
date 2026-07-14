import FirstRungApp from "./FirstRungApp";
import { getLiveJobs } from "./liveJobs";

export default async function Home() {
  const payload = await getLiveJobs();
  return <FirstRungApp initialPayload={payload} />;
}
