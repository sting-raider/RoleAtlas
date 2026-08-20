import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { AuthForm } from "../AuthForm";
import { auth } from "../../lib/auth.ts";

export default async function SignInPage() {
  if (await auth.api.getSession({ headers: await headers() })) redirect("/");
  return <AuthForm mode="sign-in" githubEnabled={Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)} />;
}
