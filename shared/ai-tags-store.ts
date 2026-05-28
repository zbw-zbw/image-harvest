import { STORAGE_KEYS } from './constants';

type TagMap = Record<string, string[]>;

const MAX_ENTRIES = 500;

export async function saveAiTags(url: string, tags: string[]): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.AI_TAGS);
  const map: TagMap = (result[STORAGE_KEYS.AI_TAGS] as TagMap) || {};
  map[url] = tags;
  const keys = Object.keys(map);
  if (keys.length > MAX_ENTRIES) {
    for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) {
      delete map[k];
    }
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.AI_TAGS]: map });
}

export async function loadAiTagsMap(): Promise<TagMap> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.AI_TAGS);
  return (result[STORAGE_KEYS.AI_TAGS] as TagMap) || {};
}
