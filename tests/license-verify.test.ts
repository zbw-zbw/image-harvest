// Offline license-signature verification — shared/license-verify.ts.
//
// Money-path: this module decides whether a cached Pro license can be
// trusted offline. A bug here either locks paying users out ('invalid'
// for a genuine signature) or lets casual tampering through ('valid'
// for an edited record). We exercise all three states of the tri-state
// result with REAL WebCrypto keys — no crypto mocking — because the
// exact ECDSA/P-256/SHA-256/ieee-p1363 parameter combination is the
// contract with the backend's lib/license-signing.ts.
//
// LICENSE_PUBLIC_KEY is a build-time constant ('' in repos where signing
// is not yet enabled), and license-verify.ts caches the imported CryptoKey
// at module level. Each scenario therefore resets the module registry and
// re-mocks shared/constants before importing the module under test.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { LicenseData } from '../shared/types';

// ── WebCrypto helpers (mirror the backend's signing side) ─────────────────

function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function makeKeyPair(): Promise<{ publicKeyB64: string; privateKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  return { publicKeyB64: bytesToBase64(spki), privateKey: pair.privateKey };
}

/** Byte-for-byte copy of the canonical string both sides sign/verify. */
function canonical(d: LicenseData): string {
  return [
    d.licenseKey,
    d.plan ?? '',
    d.expiresAt == null ? '' : String(d.expiresAt),
    d.status ?? '',
    String(d.signedAt ?? ''),
  ].join('|');
}

async function signRecord(privateKey: CryptoKey, d: LicenseData): Promise<string> {
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(canonical(d))
  );
  return bytesToBase64(sig);
}

/**
 * Import a fresh copy of license-verify with LICENSE_PUBLIC_KEY overridden.
 * resetModules clears the module-level CryptoKey cache between scenarios.
 */
async function loadVerifier(publicKeyB64: string) {
  vi.resetModules();
  vi.doMock('../shared/constants', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../shared/constants')>()),
    LICENSE_PUBLIC_KEY: publicKeyB64,
  }));
  const mod = await import('../shared/license-verify');
  return mod.verifyLicenseSignature;
}

function baseRecord(overrides: Partial<LicenseData> = {}): LicenseData {
  return {
    licenseKey: 'ABCD-EFGH-IJKL-MNOP',
    status: 'active',
    plan: 'yearly',
    expiresAt: 2000000000000,
    instanceId: 'inst_1',
    signedAt: 1700000000000,
    ...overrides,
  };
}

describe('verifyLicenseSignature', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock('../shared/constants');
  });

  // ── 'unsigned' paths ──────────────────────────────────────────────────

  it("returns 'unsigned' when the record has no signature (legacy/trial)", async () => {
    const { publicKeyB64 } = await makeKeyPair();
    const verify = await loadVerifier(publicKeyB64);
    expect(await verify(baseRecord({ signature: undefined }))).toBe('unsigned');
  });

  it("returns 'unsigned' when signedAt is missing even if a signature exists", async () => {
    const { publicKeyB64, privateKey } = await makeKeyPair();
    const rec = baseRecord();
    rec.signature = await signRecord(privateKey, rec);
    rec.signedAt = undefined;
    const verify = await loadVerifier(publicKeyB64);
    expect(await verify(rec)).toBe('unsigned');
  });

  it("returns 'unsigned' when no public key is provisioned (empty constant)", async () => {
    const { privateKey } = await makeKeyPair();
    const rec = baseRecord();
    rec.signature = await signRecord(privateKey, rec);
    const verify = await loadVerifier('');
    expect(await verify(rec)).toBe('unsigned');
  });

  it("returns 'unsigned' (never throws) when the embedded public key is garbage", async () => {
    const { privateKey } = await makeKeyPair();
    const rec = baseRecord();
    rec.signature = await signRecord(privateKey, rec);
    const verify = await loadVerifier(btoa('not-a-real-spki-key'));
    expect(await verify(rec)).toBe('unsigned');
  });

  it("returns 'unsigned' (never throws) when the signature is not valid base64", async () => {
    const { publicKeyB64 } = await makeKeyPair();
    const verify = await loadVerifier(publicKeyB64);
    const rec = baseRecord({ signature: '!!!not-base64!!!' });
    expect(await verify(rec)).toBe('unsigned');
  });

  // ── 'valid' path ──────────────────────────────────────────────────────

  it("returns 'valid' for a genuine signature from the paired private key", async () => {
    const { publicKeyB64, privateKey } = await makeKeyPair();
    const rec = baseRecord();
    rec.signature = await signRecord(privateKey, rec);
    const verify = await loadVerifier(publicKeyB64);
    expect(await verify(rec)).toBe('valid');
  });

  it('treats null plan/expiresAt as empty strings in the canonical payload', async () => {
    const { publicKeyB64, privateKey } = await makeKeyPair();
    const rec = baseRecord({ plan: null, expiresAt: null });
    rec.signature = await signRecord(privateKey, rec);
    const verify = await loadVerifier(publicKeyB64);
    expect(await verify(rec)).toBe('valid');
  });

  it('caches the imported public key across calls (second verify still works)', async () => {
    const { publicKeyB64, privateKey } = await makeKeyPair();
    const rec = baseRecord();
    rec.signature = await signRecord(privateKey, rec);
    const verify = await loadVerifier(publicKeyB64);
    expect(await verify(rec)).toBe('valid');
    expect(await verify(rec)).toBe('valid');
  });

  // ── 'invalid' paths (the tamper-evidence contract) ────────────────────

  it.each([
    ['plan', { plan: 'lifetime' }],
    ['expiresAt', { expiresAt: 4000000000000 }],
    ['status', { status: 'active' as const }],
    ['licenseKey', { licenseKey: 'QQQQ-QQQQ-QQQQ-QQQQ' }],
    ['signedAt', { signedAt: 1800000000000 }],
  ])("returns 'invalid' when %s is edited after signing", async (_field, tamper) => {
    const { publicKeyB64, privateKey } = await makeKeyPair();
    // Sign a record that DIFFERS from the tampered one in exactly one field.
    const original = baseRecord({ status: 'expired' });
    const signature = await signRecord(privateKey, original);
    const tampered: LicenseData = { ...original, ...tamper, signature };
    const verify = await loadVerifier(publicKeyB64);
    expect(await verify(tampered)).toBe('invalid');
  });

  it("returns 'invalid' for a signature produced by a DIFFERENT private key", async () => {
    const victim = await makeKeyPair();
    const attacker = await makeKeyPair();
    const rec = baseRecord();
    rec.signature = await signRecord(attacker.privateKey, rec);
    const verify = await loadVerifier(victim.publicKeyB64);
    expect(await verify(rec)).toBe('invalid');
  });

  it("returns 'invalid' for a well-formed but random signature", async () => {
    const { publicKeyB64 } = await makeKeyPair();
    const rec = baseRecord();
    // 64 zero bytes — structurally the right length for ieee-p1363 r||s.
    rec.signature = bytesToBase64(new Uint8Array(64).buffer);
    const verify = await loadVerifier(publicKeyB64);
    expect(await verify(rec)).toBe('invalid');
  });
});
