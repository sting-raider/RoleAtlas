import { PasswordFlow } from "../PasswordFlow";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <PasswordFlow mode="reset" token={token} />;
}
