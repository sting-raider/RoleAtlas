import type { ProviderConfig } from "./aiProvider.ts";

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
