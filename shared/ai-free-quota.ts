import { STORAGE_KEYS, getFreeLimits } from './constants';

interface AiFreeMonthlyData {
  month: string;
  count: number;
}

function currentMonthUTC(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

async function getData(): Promise<AiFreeMonthlyData> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.AI_FREE_MONTHLY);
  const raw = result[STORAGE_KEYS.AI_FREE_MONTHLY] as AiFreeMonthlyData | undefined;
  const month = currentMonthUTC();
  if (!raw || raw.month !== month) {
    return { month, count: 0 };
  }
  return raw;
}

export async function getRemainingMonthlyFreeAiTags(): Promise<number> {
  const data = await getData();
  return Math.max(0, getFreeLimits().MAX_MONTHLY_AI_TAGS - data.count);
}

export async function incrementMonthlyFreeAiTag(): Promise<number> {
  const data = await getData();
  data.count += 1;
  await chrome.storage.local.set({ [STORAGE_KEYS.AI_FREE_MONTHLY]: data });
  return Math.max(0, getFreeLimits().MAX_MONTHLY_AI_TAGS - data.count);
}
