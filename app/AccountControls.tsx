"use client";

import { useState } from "react";
import { Download, LogOut, ShieldAlert, Trash2, X } from "lucide-react";
import { authClient } from "../lib/auth-client.ts";
import { accountStorageKeys } from "./accountStorage.ts";

export function AccountControls({ user }: { user: { id: string; name: string; email: string } }) {
  const [confirming, setConfirming] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function removeAccount() {
    setPending(true);
    setError("");
    const result = await authClient.deleteUser({
      callbackURL: "/sign-in",
      ...(password ? { password } : {}),
    });
    if (result.error) {
      setPending(false);
      setError(result.error.message ?? "The account could not be deleted.");
      return;
    }
    for (const key of accountStorageKeys(user.id)) {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    }
    window.location.assign("/sign-in");
  }

  return (
    <section className="daily-card account-settings-card">
      <div className="daily-card-head"><div><span className="eyebrow">Account and privacy</span><h2>{user.name}</h2></div><ShieldAlert size={18} /></div>
      <p>{user.email}</p>
      <p className="coverage-claim">Your profile, searches, feedback, and workspace belong to this account. Shared canonical job records contain no private candidate data.</p>
      <div className="settings-actions">
        <a className="secondary-button" href="/api/account/export" download><Download size={14} /> Export my data</a>
        <button type="button" className="secondary-button" onClick={() => void authClient.signOut({ fetchOptions: { onSuccess: () => window.location.assign("/sign-in") } })}><LogOut size={14} /> Sign out</button>
        <button type="button" className="text-button danger" onClick={() => setConfirming(true)}><Trash2 size={14} /> Delete account</button>
      </div>
      {confirming && <div className="workspace-dialog-backdrop"><section className="workspace-dialog account-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-account-title"><header><div><span className="eyebrow">Permanent action</span><h2 id="delete-account-title">Delete your RoleAtlas account?</h2></div><button type="button" className="icon-button" aria-label="Close account deletion" onClick={() => setConfirming(false)}><X size={17} /></button></header><div className="workspace-form"><p>This permanently removes your candidate data, searches, feedback, and workspace. Export first if you need a copy.</p><label><span>Type DELETE to confirm</span><input value={phrase} onChange={(event) => setPhrase(event.target.value)} autoComplete="off" /></label><label><span>Password (credential accounts)</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /><small>OAuth-only accounts can leave this empty while the session is fresh.</small></label>{error && <p role="alert" className="auth-message error">{error}</p>}</div><footer><button type="button" className="secondary-button" onClick={() => setConfirming(false)}>Cancel</button><button type="button" className="primary-button destructive" disabled={phrase !== "DELETE" || pending} onClick={() => void removeAccount()}>{pending ? "Deleting…" : "Delete permanently"}</button></footer></section></div>}
    </section>
  );
}
