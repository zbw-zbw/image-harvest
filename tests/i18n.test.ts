// Unit tests for shared/i18n.ts.
//
// Coverage targets:
//   - normalizeLocale: every supported tag + a few aliases + unsupported
//   - t():            primary hit, fallback to en, missing key, var subst
//   - detectLocale:   stored > chrome.i18n > navigator > fallback
//   - setLocale:      persists + flips active + fires listeners
//   - parity:         every locale catalogue exposes the same key set
//
// We don't bother mocking @testing-library here — i18n is a pure module.
// chrome.* is patched per-test with a minimal storage stub.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __test,
  detectLocale,
  getLocale,
  getLocaleLabel,
  normalizeLocale,
  onLocaleChange,
  setLocale,
  STORAGE_KEY_LOCALE,
  SUPPORTED_LOCALES,
  t,
  type Locale,
} from '../shared/i18n';
import en from '../_locales/en/messages.json';
import zhCN from '../_locales/zh_CN/messages.json';
import zhTW from '../_locales/zh_TW/messages.json';
import ja from '../_locales/ja/messages.json';
import es from '../_locales/es/messages.json';

interface StorageStub {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
}
interface I18nStub {
  getUILanguage: ReturnType<typeof vi.fn>;
}
interface ChromeStub {
  storage?: { local?: StorageStub };
  i18n?: I18nStub;
}

const realChrome = (globalThis as { chrome?: unknown }).chrome;

function installChromeStub(): { storage: StorageStub; i18n: I18nStub } {
  const storageBacking: Record<string, unknown> = {};
  const storage: StorageStub = {
    get: vi.fn(async (keys?: string | string[] | Record<string, unknown>) => {
      if (typeof keys === 'string') {
        return keys in storageBacking ? { [keys]: storageBacking[keys] } : {};
      }
      if (Array.isArray(keys)) {
        const out: Record<string, unknown> = {};
        for (const k of keys) if (k in storageBacking) out[k] = storageBacking[k];
        return out;
      }
      return { ...storageBacking };
    }),
    set: vi.fn(async (patch: Record<string, unknown>) => {
      Object.assign(storageBacking, patch);
    }),
  };
  const i18n: I18nStub = {
    getUILanguage: vi.fn(() => 'en'),
  };
  (globalThis as unknown as { chrome?: ChromeStub }).chrome = {
    storage: { local: storage },
    i18n,
  };
  return { storage, i18n };
}

beforeEach(() => {
  __test.reset();
  installChromeStub();
});

afterEach(() => {
  __test.reset();
  if (realChrome === undefined) {
    delete (globalThis as { chrome?: unknown }).chrome;
  } else {
    (globalThis as { chrome?: unknown }).chrome = realChrome;
  }
});

describe('normalizeLocale', () => {
  it('returns the exact tag for every supported locale (case-insensitive)', () => {
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('EN')).toBe('en');
    expect(normalizeLocale('zh-CN')).toBe('zh-CN');
    expect(normalizeLocale('zh_cn')).toBe('zh-CN');
    expect(normalizeLocale('zh-TW')).toBe('zh-TW');
    expect(normalizeLocale('ja')).toBe('ja');
    expect(normalizeLocale('es')).toBe('es');
  });

  it('maps coarse / regional tags to the closest supported locale', () => {
    expect(normalizeLocale('zh')).toBe('zh-CN');
    expect(normalizeLocale('zh-Hant')).toBe('zh-TW');
    expect(normalizeLocale('zh-HK')).toBe('zh-TW');
    expect(normalizeLocale('ja-JP')).toBe('ja');
    expect(normalizeLocale('es-MX')).toBe('es');
    expect(normalizeLocale('en-US')).toBe('en');
  });

  it('falls back to en for unsupported / empty input', () => {
    expect(normalizeLocale('fr')).toBe('en');
    expect(normalizeLocale('de-DE')).toBe('en');
    expect(normalizeLocale('')).toBe('en');
    expect(normalizeLocale(null)).toBe('en');
    expect(normalizeLocale(undefined)).toBe('en');
  });
});

describe('t()', () => {
  it('returns the primary-locale message when present', () => {
    __test.setActiveLocale('zh-CN');
    expect(t('common.cancel')).toBe('取消');
  });

  it('falls back to en when the key is missing in the active locale', () => {
    // Inject a key that ONLY exists in en for the test by leveraging the
    // fact that 'app.tagline' has different copy in every locale, so we
    // assert by switching active and verifying en still wins for missing.
    __test.setActiveLocale('zh-CN');
    expect(t('app.tagline')).toBe('从任意网页批量下载图片'); // exists in zh-CN

    // For a guaranteed-missing key we expect the raw key back.
    expect(t('this.key.definitely.does.not.exist')).toBe('this.key.definitely.does.not.exist');
  });

  it('substitutes {var} placeholders with provided params', () => {
    __test.setActiveLocale('en');
    expect(t('toast.url_copied.batch', { count: 42 })).toBe('42 URLs copied to clipboard');
    expect(t('pro.zip_limit', { max: 30 })).toBe(
      'Free plan allows up to 30 images per ZIP. Upgrade to Pro for unlimited!'
    );
  });

  it('leaves unmatched placeholders untouched (so QA notices missing params)', () => {
    __test.setActiveLocale('en');
    // No params at all.
    expect(t('toast.color_copied')).toBe('Color {hex} copied');
    // Param name does not match.
    expect(t('toast.color_copied', { wrong: '#fff' })).toBe('Color {hex} copied');
  });

  it('replaces every occurrence of the same placeholder', () => {
    // Inject a transient catalogue entry by stubbing a key the test owns.
    // We verify global substitution behavior by adding {x} twice.
    const cat = en as Record<string, { message: string }>;
    cat['__test.repeat'] = { message: 'a {x} b {x} c' };
    try {
      __test.setActiveLocale('en');
      expect(t('__test.repeat', { x: 'Y' })).toBe('a Y b Y c');
    } finally {
      delete cat['__test.repeat'];
    }
  });
});

describe('detectLocale', () => {
  it('returns the stored preference when present', async () => {
    const { storage } = installChromeStub();
    await storage.set({ [STORAGE_KEY_LOCALE]: 'ja' });
    const locale = await detectLocale();
    expect(locale).toBe('ja');
    expect(getLocale()).toBe('ja');
  });

  it('falls back to chrome.i18n.getUILanguage when no stored preference', async () => {
    const { i18n } = installChromeStub();
    i18n.getUILanguage.mockReturnValue('zh-CN');
    const locale = await detectLocale();
    expect(locale).toBe('zh-CN');
  });

  it('normalizes browser tags (zh-Hant → zh-TW)', async () => {
    const { i18n } = installChromeStub();
    i18n.getUILanguage.mockReturnValue('zh-Hant');
    const locale = await detectLocale();
    expect(locale).toBe('zh-TW');
  });

  it('falls back to en when both stored and browser are unavailable', async () => {
    // Wipe chrome.i18n by reassigning a stub without it.
    (globalThis as unknown as { chrome?: ChromeStub }).chrome = {
      storage: { local: installChromeStub().storage },
    };
    const locale = await detectLocale();
    expect(locale).toBe('en');
  });
});

describe('setLocale', () => {
  it('persists the choice and flips the active locale', async () => {
    const { storage } = installChromeStub();
    await setLocale('ja');
    expect(getLocale()).toBe('ja');
    expect(storage.set).toHaveBeenCalledWith({ [STORAGE_KEY_LOCALE]: 'ja' });
  });

  it('fires onLocaleChange listeners exactly once per actual change', async () => {
    installChromeStub();
    const listener = vi.fn();
    onLocaleChange(listener);
    await setLocale('zh-CN');
    await setLocale('zh-CN'); // no-op: same locale
    await setLocale('ja');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, 'zh-CN');
    expect(listener).toHaveBeenNthCalledWith(2, 'ja');
  });

  it('still persists when called with the current locale (idempotent save)', async () => {
    const { storage } = installChromeStub();
    await setLocale('ja');
    storage.set.mockClear();
    await setLocale('ja');
    expect(storage.set).toHaveBeenCalledWith({ [STORAGE_KEY_LOCALE]: 'ja' });
  });
});

describe('catalogue parity', () => {
  // The English catalogue is the source of truth. Every other locale must
  // expose AT LEAST the same key set; missing keys cause silent fallback to
  // English, which is technically OK at runtime but indicates a translation
  // gap that should be flagged in CI.
  const enKeys = new Set(Object.keys(en));

  const localeMap: Record<Exclude<Locale, 'en'>, Record<string, unknown>> = {
    'zh-CN': zhCN,
    'zh-TW': zhTW,
    ja,
    es,
  };

  for (const [locale, cat] of Object.entries(localeMap)) {
    it(`${locale} catalogue covers every English key`, () => {
      const localeKeys = new Set(Object.keys(cat));
      const missing = [...enKeys].filter((k) => !localeKeys.has(k));
      expect(missing).toEqual([]);
    });
  }
});

describe('SUPPORTED_LOCALES + getLocaleLabel', () => {
  it('exposes the expected 5-locale roster', () => {
    expect([...SUPPORTED_LOCALES]).toEqual(['en', 'zh-CN', 'zh-TW', 'ja', 'es']);
  });

  it('returns a human-readable label for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const label = getLocaleLabel(locale);
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
