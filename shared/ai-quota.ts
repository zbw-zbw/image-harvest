import { STORAGE_KEYS, getProAiQuotaLimit } from './constants';

interface AiQuotaData {
  count: number;
  month: string;
}

function currentMonth(): string {
  // UTC, matching the backend's currentMonth() and the other local quota
  // trackers (ai-free-quota, feature-quota). A local-timezone key drifted
  // from the server's for hours around month boundaries, so the cached
  // Pro count disagreed with the authoritative one right when quotas reset.
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export async function getLocalQuota(): Promise<AiQuotaData> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.AI_QUOTA);
  const raw = result[STORAGE_KEYS.AI_QUOTA] as AiQuotaData | undefined;
  const month = currentMonth();
  if (!raw || raw.month !== month) {
    return { count: 0, month };
  }
  return raw;
}

export async function incrementLocalQuota(): Promise<number> {
  const quota = await getLocalQuota();
  quota.count += 1;
  await chrome.storage.local.set({ [STORAGE_KEYS.AI_QUOTA]: quota });
  return Math.max(0, getProAiQuotaLimit() - quota.count);
}

export async function setLocalQuotaFromServer(remaining: number): Promise<void> {
  const month = currentMonth();
  const count = Math.max(0, getProAiQuotaLimit() - remaining);
  await chrome.storage.local.set({ [STORAGE_KEYS.AI_QUOTA]: { count, month } });
}

export async function getRemainingQuota(): Promise<number> {
  const quota = await getLocalQuota();
  return Math.max(0, getProAiQuotaLimit() - quota.count);
}
