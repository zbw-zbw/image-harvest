/// <reference types="vite/client" />
/// <reference types="chrome" />

/**
 * Compile-time constant injected by Vite `define`.
 * `true` in development builds, `false` in production builds.
 * Used by shared/telemetry.ts to disable telemetry during local dev.
 */
declare const __DEV__: boolean;
