// Offline verification of server-signed license responses (ECDSA P-256).
//
// Pairs with the backend's lib/license-signing.ts. The server signs a canonical
// string with its private key; here we verify it with the embedded public key
// (LICENSE_PUBLIC_KEY). This makes a cached license tamper-evident: editing
// plan/expiresAt/status in chrome.storage.local invalidates the signature.
//
// Tri-state result so callers can treat the cases differently:
//   'valid'    — signature checks out, trust the cache.
//   'invalid'  — signature present but wrong (tampering) → force remote verify.
//   'unsigned' — no public key provisioned OR no signature on the record
//                (legacy/trial) → fall back to legacy trust (backward compat).

import { LICENSE_PUBLIC_KEY } from './constants';
import type { LicenseData } from './types';

export type SignatureCheck = 'valid' | 'invalid' | 'unsigned';

/** Canonical payload — MUST match backend canonicalLicenseString() byte-for-byte. */
function canonicalLicenseString(d: LicenseData): string {
  return [
    d.licenseKey,
    d.plan ?? '',
    d.expiresAt == null ? '' : String(d.expiresAt),
    d.status ?? '',
    String(d.signedAt ?? ''),
  ].join('|');
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

let cachedKey: CryptoKey | null = null;
let cachedKeyFailed = false;

async function getPublicKey(): Promise<CryptoKey | null> {
  if (cachedKey) return cachedKey;
  if (cachedKeyFailed || !LICENSE_PUBLIC_KEY) return null;
  try {
    cachedKey = await crypto.subtle.importKey(
      'spki',
      base64ToBytes(LICENSE_PUBLIC_KEY) as unknown as ArrayBuffer,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    return cachedKey;
  } catch (error) {
    console.error('Failed to import license public key:', error);
    cachedKeyFailed = true;
    return null;
  }
}

/**
 * Verify the signature attached to a cached license record.
 * Never throws — returns 'unsigned' on any unexpected error so a crypto glitch
 * can't lock a paying user out (the remote verify path is the safety net).
 */
export async function verifyLicenseSignature(d: LicenseData): Promise<SignatureCheck> {
  if (!d.signature || d.signedAt == null) return 'unsigned';

  const key = await getPublicKey();
  if (!key) return 'unsigned'; // signing not provisioned → legacy trust

  try {
    const data = new TextEncoder().encode(canonicalLicenseString(d));
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      base64ToBytes(d.signature) as unknown as ArrayBuffer,
      data as unknown as ArrayBuffer
    );
    return ok ? 'valid' : 'invalid';
  } catch (error) {
    console.error('License signature verification error:', error);
    return 'unsigned';
  }
}
