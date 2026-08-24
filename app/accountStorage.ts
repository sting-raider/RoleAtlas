import type { AiActivity, ProviderConfig } from "./aiProvider.ts";

export const ACCOUNT_STORAGE_KEYS = {
  workspace: "daily-workspace",
  provider: "ai-provider",
  dossiers: "dossiers",
  resumeSession: "resume-session",
  aiActivity: "ai-activity",
} as const;

export function accountStorageKey(userId: string, key: string) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("A stable account ID is required for browser storage.");
  return `roleatlas:${encodeURIComponent(normalizedUserId)}:${key}`;
}

export function providerMetadataForStorage(config: ProviderConfig): ProviderConfig {
  return {
    ...config,
    apiKey: "",
    rememberKey: false,
  };
}

export function accountStorageKeys(userId: string) {
  return Object.values(ACCOUNT_STORAGE_KEYS).map((key) => accountStorageKey(userId, key));
}

export const AI_ACTIVITY_EVENT = "roleatlas-ai-activity";

export function loadAiActivity(userId: string): AiActivity[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(accountStorageKey(userId, ACCOUNT_STORAGE_KEYS.aiActivity)) ?? "[]") as AiActivity[];
  } catch {
    return [];
  }
}

export function recordAiActivity(userId: string, activity?: AiActivity) {
  if (!activity || typeof window === "undefined") return;
  const next = [activity, ...loadAiActivity(userId).filter((item) => item.id !== activity.id)].slice(0, 25);
  window.localStorage.setItem(accountStorageKey(userId, ACCOUNT_STORAGE_KEYS.aiActivity), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(AI_ACTIVITY_EVENT, { detail: next }));
}
