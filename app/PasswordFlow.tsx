"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowLeft, ArrowRight, KeyRound, LoaderCircle, Radar } from "lucide-react";
import { authClient } from "../lib/auth-client.ts";

export function PasswordFlow({ mode, token = "" }: { mode: "request" | "reset"; token?: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const result = mode === "request"
      ? await authClient.requestPasswordReset({
          email: String(data.get("email") ?? "").trim(),
          redirectTo: "/reset-password",
        })
      : await authClient.resetPassword({
          newPassword: String(data.get("password") ?? ""),
          token,
        });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "The request could not be completed.");
      return;
    }
    setMessage(mode === "request"
      ? "If that account exists, a reset link has been sent."
      : "Your password was updated. You can sign in now.");
  }

  const missingToken = mode === "reset" && !token;
  return (
    <main className="auth-page compact">
      <section className="auth-panel password-panel">
        <Link className="auth-brand" href="/"><Radar aria-hidden="true" size={20} /> RoleAtlas</Link>
        <div className="auth-form-heading">
          <KeyRound aria-hidden="true" size={20} />
          <div><span className="eyebrow">Account recovery</span><h1>{mode === "request" ? "Reset your password" : "Choose a new password"}</h1></div>
        </div>
        <p>{mode === "request" ? "Enter your account email. We’ll send a time-limited recovery link without revealing whether the account exists." : "Use at least 12 characters and avoid a password you use elsewhere."}</p>
        <form onSubmit={submit} className="auth-form">
          {mode === "request"
            ? <label><span>Email</span><input name="email" type="email" autoComplete="email" required /></label>
            : <label><span>New password</span><input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={missingToken} /></label>}
          {missingToken && <p className="auth-message error" role="alert">This reset link is missing its token. Request a new link.</p>}
          {error && <p className="auth-message error" role="alert">{error}</p>}
          {message && <p className="auth-message" role="status">{message}</p>}
          <button className="auth-submit" type="submit" disabled={pending || missingToken}>{pending && <LoaderCircle className="spin" aria-hidden="true" size={17} />}{mode === "request" ? "Send reset link" : "Update password"}<ArrowRight aria-hidden="true" size={16} /></button>
        </form>
        <Link className="auth-text-link" href="/sign-in"><ArrowLeft aria-hidden="true" size={14} /> Back to sign in</Link>
      </section>
    </main>
  );
}
