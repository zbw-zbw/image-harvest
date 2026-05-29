import { STORAGE_KEYS, FREE_LIMITS } from './constants';

interface AiFreeDailyData {
  date: string;
  count: number;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

async function getData(): Promise<AiFreeDailyData> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.AI_FREE_DAILY);
  const raw = result[STORAGE_KEYS.AI_FREE_DAILY] as AiFreeDailyData | undefined;
  const today = todayUTC();
  if (!raw || raw.date !== today) {
    return { date: today, count: 0 };
  }
  return raw;
}

export async function getRemainingDailyFreeAiTags(): Promise<number> {
  const data = await getData();
  return Math.max(0, FREE_LIMITS.MAX_DAILY_AI_TAGS - data.count);
}

export async function incrementDailyFreeAiTag(): Promise<number> {
  const data = await getData();
  data.count += 1;
  await chrome.storage.local.set({ [STORAGE_KEYS.AI_FREE_DAILY]: data });
  return Math.max(0, FREE_LIMITS.MAX_DAILY_AI_TAGS - data.count);
}
