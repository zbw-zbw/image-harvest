/// <reference types="vite/client" />
/// <reference types="chrome" />

/**
 * Compile-time constant injected by Vite `define`.
 * `true` in development builds, `false` in production builds.
 * Used by shared/telemetry.ts to disable telemetry during local dev.
 */
declare const __DEV__: boolean;

/**
 * Compile-time constant injected by Vite `define` (VITE_E2E=1 → true).
 * E2E builds are production-identical except this flag is true: telemetry
 * (shared/telemetry.ts track) and the trial RPC (shared/trial.ts startTrial)
 * hard-return before any network write, so Playwright runs against the real
 * bundle can never write to the production DB. Guards against the
 * 2026-08-24 pollution incident (CI e2e polluted ~76% of trials rows /
 * ~88% of telemetry instances before this existed).
 */
declare const __E2E__: boolean;

interface ImportMetaEnv {
  readonly VITE_API_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
