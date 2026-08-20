"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowRight, GitBranch, LoaderCircle, LockKeyhole, Radar } from "lucide-react";
import { authClient } from "../lib/auth-client.ts";

type Mode = "sign-in" | "sign-up";

export function AuthForm({ mode, githubEnabled }: { mode: Mode; githubEnabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setNotice("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const result = mode === "sign-up"
      ? await authClient.signUp.email({
          name: String(data.get("name") ?? "").trim(),
          email,
          password,
          callbackURL: "/",
        })
      : await authClient.signIn.email({ email, password, callbackURL: "/" });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Authentication could not be completed.");
      return;
    }
    if (mode === "sign-up" && !result.data?.token) {
      setNotice("Check your inbox to verify your email, then sign in.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  async function github() {
    setPending(true);
    setError("");
    const result = await authClient.signIn.social({ provider: "github", callbackURL: "/" });
    if (result.error) {
      setPending(false);
      setError(result.error.message ?? "GitHub sign-in could not be started.");
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-story" aria-labelledby="auth-title">
        <Link className="auth-brand" href="/"><Radar aria-hidden="true" size={20} /> RoleAtlas</Link>
        <div>
          <span className="eyebrow">Your private opportunity workspace</span>
          <h1 id="auth-title">Find work that fits <em>your actual life.</em></h1>
          <p>Search verified sources, keep eligibility honest, and carry your searches and applications safely across devices.</p>
        </div>
        <ul>
          <li>Deterministic search works without AI</li>
          <li>Your profile and activity are isolated to your account</li>
          <li>Provider credentials are never required to discover jobs</li>
        </ul>
      </section>
      <section className="auth-panel" aria-label={mode === "sign-in" ? "Sign in" : "Create account"}>
        <div className="auth-form-heading">
          <LockKeyhole aria-hidden="true" size={20} />
          <div>
            <span className="eyebrow">{mode === "sign-in" ? "Welcome back" : "Start your atlas"}</span>
            <h2>{mode === "sign-in" ? "Sign in" : "Create an account"}</h2>
          </div>
        </div>
        <form onSubmit={submit} className="auth-form">
          {mode === "sign-up" && <label><span>Name</span><input name="name" autoComplete="name" minLength={2} maxLength={100} required /></label>}
          <label><span>Email</span><input name="email" type="email" autoComplete="email" required /></label>
          <label><span>Password</span><input name="password" type="password" autoComplete={mode === "sign-up" ? "new-password" : "current-password"} minLength={12} maxLength={128} required /><small>At least 12 characters.</small></label>
          {error && <p className="auth-message error" role="alert">{error}</p>}
          {notice && <p className="auth-message" role="status">{notice}</p>}
          <button type="submit" className="auth-submit" disabled={pending}>{pending ? <LoaderCircle className="spin" aria-hidden="true" size={17} /> : null}{mode === "sign-in" ? "Sign in" : "Create account"}<ArrowRight aria-hidden="true" size={16} /></button>
        </form>
        {mode === "sign-in" && <Link className="auth-text-link" href="/forgot-password">Forgot your password?</Link>}
        {githubEnabled && <><div className="auth-divider"><span>or</span></div><button type="button" className="auth-social" disabled={pending} onClick={() => void github()}><GitBranch aria-hidden="true" size={17} /> Continue with GitHub</button></>}
        <p className="auth-switch">{mode === "sign-in" ? "New to RoleAtlas?" : "Already have an account?"} <Link href={mode === "sign-in" ? "/sign-up" : "/sign-in"}>{mode === "sign-in" ? "Create one" : "Sign in"}</Link></p>
        <p className="auth-privacy">RoleAtlas uses a secure HTTP-only session cookie. Your résumé content is processed only when you choose to upload it.</p>
      </section>
    </main>
  );
}
