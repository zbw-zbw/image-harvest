// Lightweight i18n for Image Harvest.
//
// Why a custom 60-line module instead of i18next?
// 1. Bundle size — i18next + ICU pulls ~30KB gzip into every entry; the
//    sidepanel is already at ~110KB. We only need t() with `{var}` substitution
//    and a synchronous lookup, so a hand-rolled impl is 1/30th the size.
// 2. Chrome extension parity — the long-term plan is to migrate to Chrome's
//    native `chrome.i18n.getMessage` (which uses _locales/*/messages.json
//    out of the box). Keeping our t() signature compatible with that schema
//    means the future swap is mechanical: the catalogue files don't move, the
//    callers don't change, only the internals do.
// 3. Background SW + sidepanel + content scripts share this module and each
//    runs in a different runtime. A pure in-memory loader with `import` of
//    JSON works in all three; chrome.i18n only works in some contexts (e.g.
//    options pages need MV3 polyfills, content scripts need extra perms).
//
// Catalogue format mirrors Chrome's _locales/<locale>/messages.json:
//   { "key_name": { "message": "Hello {name}", "description": "..." } }
// Keys use underscores only (Chrome forbids dots in message keys).
// `description` is for translators only; we ignore it at runtime.

import en from '../_locales/en/messages.json';
import zhCN from '../_locales/zh_CN/messages.json';
import zhTW from '../_locales/zh_TW/messages.json';
import ja from '../_locales/ja/messages.json';
import es from '../_locales/es/messages.json';
import ko from '../_locales/ko/messages.json';
import de from '../_locales/de/messages.json';
import fr from '../_locales/fr/messages.json';
import pt from '../_locales/pt/messages.json';
import ru from '../_locales/ru/messages.json';
import ar from '../_locales/ar/messages.json';
import hi from '../_locales/hi/messages.json';
import th from '../_locales/th/messages.json';
import it from '../_locales/it/messages.json';
import nl from '../_locales/nl/messages.json';

export type Locale =
  | 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'es'
  | 'ko' | 'de' | 'fr' | 'pt' | 'ru'
  | 'ar' | 'hi' | 'th' | 'it' | 'nl';

export interface MessageEntry {
  message: string;
  description?: string;
}
export type Catalogue = Record<string, MessageEntry>;

// Static catalogues — bundled at build time so the first call to t() is
// synchronous and never blocks rendering on a network/storage roundtrip.
const CATALOGUES: Record<Locale, Catalogue> = {
  en: en as Catalogue,
  'zh-CN': zhCN as Catalogue,
  'zh-TW': zhTW as Catalogue,
  ja: ja as Catalogue,
  es: es as Catalogue,
  ko: ko as Catalogue,
  de: de as Catalogue,
  fr: fr as Catalogue,
  pt: pt as Catalogue,
  ru: ru as Catalogue,
  ar: ar as Catalogue,
  hi: hi as Catalogue,
  th: th as Catalogue,
  it: it as Catalogue,
  nl: nl as Catalogue,
};

// English is always the fallback when a key is missing in the active locale,
// guaranteeing that t() never returns the raw key string in production builds
// (which would leak technical identifiers like "toast.download.failed" into
// the UI). The English catalogue is therefore the single source of truth for
// "every translatable string in the product".
const FALLBACK_LOCALE: Locale = 'en';

export const SUPPORTED_LOCALES: readonly Locale[] = [
  'en', 'zh-CN', 'zh-TW', 'ja', 'es',
  'ko', 'de', 'fr', 'pt', 'ru',
  'ar', 'hi', 'th', 'it', 'nl',
] as const;

const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  ja: '日本語',
  es: 'Español',
  ko: '한국어',
  de: 'Deutsch',
  fr: 'Français',
  pt: 'Português',
  ru: 'Русский',
  ar: 'العربية',
  hi: 'हिन्दी',
  th: 'ไทย',
  it: 'Italiano',
  nl: 'Nederlands',
};

export function getLocaleLabel(locale: Locale): string {
  return LOCALE_LABELS[locale] || locale;
}

export const STORAGE_KEY_LOCALE = '_i18n_locale';

// Mutable in-memory locale. Initialized lazily on first detectLocale() /
// setLocale() call. Module consumers should NOT read this directly — go
// through getLocale() so we keep the freedom to derive it differently later
// (e.g. per-request override for tests).
let activeLocale: Locale = FALLBACK_LOCALE;

// Subscribers fire whenever setLocale() actually flips the active locale.
// Used by Preact components (and the legacy `applyTranslations()` mutator)
// to re-render after a runtime language switch without a page reload.
type LocaleListener = (locale: Locale) => void;
const localeListeners = new Set<LocaleListener>();

export function getLocale(): Locale {
  return activeLocale;
}

export function onLocaleChange(listener: LocaleListener): () => void {
  localeListeners.add(listener);
  return () => {
    localeListeners.delete(listener);
  };
}

/**
 * Normalize a Chrome / browser locale tag to one of our SUPPORTED_LOCALES.
 *   "zh"        → "zh-CN"
 *   "zh-Hant"   → "zh-TW"
 *   "ja-JP"     → "ja"
 *   "fr-FR"     → "fr"
 *   "xyz"       → "en"   (unsupported → fallback)
 *
 * The mapping is deliberately conservative: we'd rather show English than
 * silently render a half-translated UI in a partially-mapped locale.
 */
export function normalizeLocale(raw: string | undefined | null): Locale {
  if (!raw) return FALLBACK_LOCALE;
  const lower = raw.toLowerCase().replace('_', '-');
  // Exact match against SUPPORTED_LOCALES (case-insensitive).
  for (const supported of SUPPORTED_LOCALES) {
    if (supported.toLowerCase() === lower) return supported;
  }
  // Coarse mapping by primary subtag.
  if (lower.startsWith('zh')) {
    if (lower.includes('tw') || lower.includes('hant') || lower.includes('hk')) return 'zh-TW';
    return 'zh-CN';
  }
  const PRIMARY_MAP: Record<string, Locale> = {
    ja: 'ja', es: 'es', en: 'en',
    ko: 'ko', de: 'de', fr: 'fr', pt: 'pt', ru: 'ru',
    ar: 'ar', hi: 'hi', th: 'th', it: 'it', nl: 'nl',
  };
  const primary = lower.split('-')[0];
  return PRIMARY_MAP[primary] ?? FALLBACK_LOCALE;
}

/**
 * Resolve the locale to use for the current session. Order of precedence:
 *   1. user-saved preference in chrome.storage.local
 *   2. chrome.i18n.getUILanguage() (browser UI)
 *   3. navigator.language (test / non-extension contexts)
 *   4. FALLBACK_LOCALE
 */
export async function detectLocale(): Promise<Locale> {
  // Stored preference wins. Wrap in try/catch because chrome.storage may be
  // unavailable in unit tests (we patch chrome there but not always storage).
  try {
    const stored = await chrome?.storage?.local?.get?.(STORAGE_KEY_LOCALE);
    const saved = stored?.[STORAGE_KEY_LOCALE];
    if (typeof saved === 'string') {
      const normalized = normalizeLocale(saved);
      activeLocale = normalized;
      return normalized;
    }
  } catch {
    /* fall through to browser detection */
  }
  let browser: string | undefined;
  try {
    browser = chrome?.i18n?.getUILanguage?.();
  } catch {
    /* ignore */
  }
  if (!browser && typeof navigator !== 'undefined') {
    browser = navigator.language;
  }
  const normalized = normalizeLocale(browser);
  activeLocale = normalized;
  return normalized;
}

/**
 * Persist the user's choice and switch the active locale immediately. Fires
 * onLocaleChange subscribers so components can re-render. No-op when the
 * requested locale equals the active one to avoid spurious re-renders.
 */
export async function setLocale(locale: Locale): Promise<void> {
  const normalized = normalizeLocale(locale);
  if (normalized === activeLocale) {
    // Still persist in case the previous value came from auto-detection and
    // the user wants to lock it in.
    try {
      await chrome?.storage?.local?.set?.({ [STORAGE_KEY_LOCALE]: normalized });
    } catch {
      /* ignore */
    }
    return;
  }
  activeLocale = normalized;
  try {
    await chrome?.storage?.local?.set?.({ [STORAGE_KEY_LOCALE]: normalized });
  } catch {
    /* ignore */
  }
  for (const listener of localeListeners) listener(normalized);
}

/**
 * Look up a translation key and substitute `{var}` placeholders.
 *
 * Lookup order (first hit wins):
 *   1. activeLocale catalogue
 *   2. FALLBACK_LOCALE catalogue
 *   3. the raw key (last-resort, surfaces missing translations in dev)
 *
 * Substitution syntax mirrors Chrome's: `{name}` is replaced with
 * `params.name`. Missing params leave the placeholder untouched so the
 * developer notices in QA rather than seeing "undefined" silently rendered.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const primary = CATALOGUES[activeLocale]?.[key]?.message;
  const fallback = CATALOGUES[FALLBACK_LOCALE]?.[key]?.message;
  let template = primary ?? fallback ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      template = template.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
    }
  }
  return template;
}

/**
 * Test-only hook: synchronously force the active locale without touching
 * chrome.storage. Used by tests/i18n.test.ts to exercise per-locale lookups
 * without an async setup step.
 */
export const __test = {
  setActiveLocale(locale: Locale): void {
    activeLocale = normalizeLocale(locale);
  },
  reset(): void {
    activeLocale = FALLBACK_LOCALE;
    localeListeners.clear();
  },
};
