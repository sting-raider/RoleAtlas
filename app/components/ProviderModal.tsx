"use client";

import { useEffect, useState } from "react";
import { Check, ShieldCheck, Sparkles, WandSparkles, X } from "lucide-react";
import {
  ACCOUNT_STORAGE_KEYS,
  accountStorageKey,
  AI_ACTIVITY_EVENT,
  loadAiActivity,
  providerMetadataForStorage,
  recordAiActivity,
} from "../accountStorage.ts";
import { PROVIDERS, type ProviderName } from "../jobs";
import {
  providerIsConfigured,
  verificationIsCurrent,
  type AiActivity,
  type ProviderConfig,
} from "../aiProvider.ts";
import { aiRequestPreview, type AiRequestPreview } from "../dailyProduct.ts";
import { useDialogFocus } from "../useDialogFocus";
import { SelectMenu } from "./ui";

export function ProviderModal({
  userId,
  config,
  setConfig,
  onClose,
}: {
  userId: string;
  config: ProviderConfig;
  setConfig: (config: ProviderConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(config);
  const [status, setStatus] = useState<"idle" | "testing" | "verified" | "failed" | "saved">(verificationIsCurrent(config) ? "verified" : "idle");
  const [message, setMessage] = useState(config.verification?.message ?? "");
  const [activities, setActivities] = useState<AiActivity[]>(() => loadAiActivity(userId));
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);
  const connectionPreview = aiRequestPreview({ provider: draft.provider, model: draft.model, baseUrl: draft.baseUrl, purpose: "Verify provider credentials and model availability", dataCategories: ["API credential in an authorization header", "configured model name"], estimatedInputCharacters: draft.model.length + draft.baseUrl.length });

  useEffect(() => {
    const update = (event: Event) => setActivities((event as CustomEvent<AiActivity[]>).detail);
    window.addEventListener(AI_ACTIVITY_EVENT, update);
    return () => window.removeEventListener(AI_ACTIVITY_EVENT, update);
  }, []);

  const updateDraft = (changes: Partial<ProviderConfig>) => {
    setDraft((current) => ({ ...current, ...changes, verification: { status: "untested" } }));
    setStatus("idle");
    setMessage("");
  };

  const updateProvider = (provider: ProviderName) => {
    const defaults = PROVIDERS[provider];
    updateDraft({ provider, baseUrl: defaults.baseUrl, model: defaults.model });
  };

  const testConnection = async () => {
    if (!providerIsConfigured(draft)) {
      setStatus("failed");
      setMessage("Add the provider URL, model, and required API key first.");
      return;
    }
    setStatus("testing");
    setMessage("Checking credentials and model availability…");
    try {
      const response = await fetch("/api/ai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const payload = await response.json() as { verified?: boolean; message?: string; error?: string; activity?: AiActivity };
      recordAiActivity(userId, payload.activity);
      const verification = { status: payload.verified ? "verified" as const : "failed" as const, testedAt: new Date().toISOString(), baseUrl: draft.baseUrl, model: draft.model, message: payload.message ?? payload.error ?? "Connection test failed." };
      setDraft((current) => ({ ...current, verification }));
      setStatus(payload.verified ? "verified" : "failed");
      setMessage(verification.message);
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "Connection test failed.");
    }
  };

  const save = () => {
    const active = { ...draft, rememberKey: false };
    const metadata = providerMetadataForStorage(active);
    setConfig(active);
    window.localStorage.setItem(accountStorageKey(userId, ACCOUNT_STORAGE_KEYS.provider), JSON.stringify(metadata));
    void fetch("/api/ai/provider-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: metadata.provider, model: metadata.model, baseUrl: metadata.baseUrl, profile: metadata.profile, verification: metadata.verification }),
    }).catch(() => undefined);
    setStatus("saved");
    window.setTimeout(onClose, 550);
  };

  const clearKey = () => {
    const cleared = { ...draft, apiKey: "", rememberKey: false, verification: { status: "untested" as const } };
    setDraft(cleared);
    setConfig(cleared);
    window.localStorage.setItem(accountStorageKey(userId, ACCOUNT_STORAGE_KEYS.provider), JSON.stringify(cleared));
    void fetch("/api/ai/provider-config", { method: "DELETE" }).catch(() => undefined);
    setStatus("idle");
    setMessage("The in-memory API key and saved verification state were cleared.");
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={dialogRef} tabIndex={-1} className="provider-modal" role="dialog" aria-modal="true" aria-labelledby="provider-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title-wrap">
            <div className="modal-icon"><WandSparkles size={20} /></div>
            <div>
              <span className="eyebrow">Your AI, your choice</span>
              <h2 id="provider-title">Connect a model provider</h2>
            </div>
          </div>
          <button type="button" className="icon-button" aria-label="Close provider settings" onClick={onClose}><X size={19} /></button>
        </div>
        <p className="modal-intro">AI can expand confirmed searches, rank résumé evidence, interpret unclear requirements, and prepare truthful application material. It never decides geographic eligibility or adds crawler sources.</p>

        <div className="provider-grid">
          <label>
            <span>Provider</span>
            <SelectMenu value={draft.provider} onChange={(value) => updateProvider(value as ProviderName)} placeholder="Choose provider" ariaLabel="AI provider" options={Object.keys(PROVIDERS).map((provider) => ({ value: provider, label: provider }))} />
          </label>
          <label>
            <span>Model</span>
            <input value={draft.model} onChange={(event) => updateDraft({ model: event.target.value })} placeholder="Model name" />
          </label>
        </div>
        <label className="full-field">
          <span>API base URL</span>
          <input value={draft.baseUrl} onChange={(event) => updateDraft({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" />
        </label>
        <label className="full-field">
          <span>API key</span>
          <input type="password" autoComplete="off" value={draft.apiKey} onChange={(event) => updateDraft({ apiKey: event.target.value })} placeholder={draft.provider === "Ollama" ? "Not required for local Ollama" : draft.provider === "NVIDIA NIM" ? "NVIDIA key (optional for loopback NIM)" : "Paste your key"} />
        </label>
        <p className="provider-key-policy"><ShieldCheck size={15} /> API keys remain only in memory for this page session and are never written to normal browser storage. Refreshing or signing out requires the key again.</p>
        <label className="full-field">
          <span>Optional note or hard constraints</span>
          <textarea rows={3} value={draft.profile} onChange={(event) => setDraft({ ...draft, profile: event.target.value })} placeholder="Optional: work authorization, schedule, industries to avoid, or anything the résumé does not explain…" />
        </label>

        <div className="privacy-note">
          <ShieldCheck size={17} />
          <p><strong>AI is optional and separate from crawling.</strong> Your key is sent through this RoleAtlas instance only for a connection test or AI action you trigger, remains in memory for this page session, and is not persisted in browser storage. Search, NATS crawling, and deterministic eligibility work without AI.</p>
        </div>

        <div className="ai-request-preview">
          <div><span className="eyebrow">Connection-test preview</span><strong>{connectionPreview.provider} · {connectionPreview.model || "No model selected"}</strong><small>{connectionPreview.purpose} · {connectionPreview.location} · Browser → this RoleAtlas instance → provider · about {connectionPreview.estimatedInputCharacters} input characters</small><small>Data: {connectionPreview.dataCategories.join(", ")}</small></div>
          <p>Ranking and application preparation show their own confirmation previews before any request. API keys are never written to the activity log.</p>
          {message && <p className={`provider-test-message ${status}`}>{message}</p>}
        </div>

        <div className="ai-activity-log">
          <span className="eyebrow">Recent AI activity on this browser</span>
          {activities.length === 0 ? <p>No model requests recorded yet.</p> : activities.slice(0, 5).map((activity) => <div key={activity.id}><span className={activity.outcome}>{activity.outcome}</span><strong>{activity.action.replaceAll("_", " ")}</strong><small>{activity.provider} · {activity.model} · {new Date(activity.completedAt).toLocaleString()}</small><p>Sent: {activity.dataSent.join(", ")}</p></div>)}
        </div>

        <div className="modal-actions">
          <button type="button" className="text-button" onClick={clearKey} disabled={!draft.apiKey}>Clear session key</button>
          <button type="button" className="secondary-button" onClick={() => void testConnection()} disabled={status === "testing"}>
            {status === "testing" ? "Testing provider…" : status === "verified" || (status === "saved" && verificationIsCurrent(draft)) ? <><Check size={15} /> Connection verified</> : "Test real connection"}
          </button>
          <button type="button" className="primary-button" onClick={save} disabled={!providerIsConfigured(draft)}>
            {status === "saved" ? <><Check size={15} /> Saved</> : "Save provider"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function AiActionPreviewModal({ preview, onCancel, onConfirm }: { preview: AiRequestPreview; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(true, onCancel);
  return <div className="workspace-dialog-backdrop" role="presentation"><section ref={dialogRef} tabIndex={-1} className="workspace-dialog ai-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-preview-title"><header><div><span className="eyebrow">Explicit model request</span><h2 id="ai-preview-title">Review before sending</h2></div><button type="button" className="icon-button" aria-label="Cancel AI request" onClick={onCancel}><X size={17} /></button></header><div className="ai-request-preview"><dl><div><dt>Provider</dt><dd>{preview.provider}</dd></div><div><dt>Model</dt><dd>{preview.model}</dd></div><div><dt>Purpose</dt><dd>{preview.purpose}</dd></div><div><dt>Request location</dt><dd>{preview.location === "local" ? "Local provider" : "External provider"}</dd></div><div><dt>Network path</dt><dd>{preview.passesThroughRoleAtlas ? "Browser → this RoleAtlas instance → provider" : "Direct"}</dd></div><div><dt>Estimated input</dt><dd>About {preview.estimatedInputCharacters.toLocaleString()} characters</dd></div></dl><div><strong>Data categories being sent</strong><ul>{preview.dataCategories.map((category) => <li key={category}>{category}</li>)}</ul></div><p><ShieldCheck size={15} /> No request has been made yet. Cancel keeps the deterministic result unchanged.</p></div><footer><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button><button type="button" className="primary-button" onClick={onConfirm}><Sparkles size={15} /> Send this request</button></footer></section></div>;
}
