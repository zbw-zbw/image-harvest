// Which browser family this install is running in.
//
// Why this exists: the Chrome Web Store GA4 property only sees installs that
// happen on a Chrome Web Store listing page. Edge Add-ons installs are
// invisible there, so without a self-reported tag our own install funnel
// mixes the two channels permanently (2026-11: GA reported 1,394 installs
// while telemetry recorded 2,016 — the gap is mostly Edge).
//
// Only the families we actually ship to are distinguished. Chromium forks
// that reuse Chrome's UA string (Brave, Vivaldi, Arc) report 'chrome' —
// deliberate: they install from the Chrome Web Store, which is the split
// that matters for channel attribution.
export type BrowserFamily = 'chrome' | 'edge' | 'other';

export function getBrowserFamily(userAgent?: string): BrowserFamily {
  const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  if (!ua) return 'other';
  // Edg/ (desktop), EdgA/ (Android), EdgiOS/ (iOS).
  if (/\bEdg[A-Z]?\//.test(ua)) return 'edge';
  // Opera also carries "Chrome/" — keep it out of the Chrome bucket.
  if (/\b(OPR|Opera)\//.test(ua)) return 'other';
  if (/\bChrome\//.test(ua)) return 'chrome';
  return 'other';
}
