// Runtime validation for inbound extension messages (IPC hardening).
//
// chrome.runtime.onMessage delivers whatever a sender posts. Before P1-1 both
// listeners (content/main.ts, background/index.ts) dispatched straight on
// `message.type` and only rejected unknown types deep inside a switch's
// `default` branch — after the message had already been cast with `as`.
//
// This module centralises a cheap, defensive gate applied at each listener
// entry point: the message must be an object, carry a string `type`, and (if it
// declares one) a compatible protocol version. Anything structurally malformed
// is dropped before it reaches business logic. Unknown-but-well-formed types are
// intentionally allowed through so the existing switch `default` in each
// handleMessage remains the single source of truth for the "unknown type" error
// (the known-type list is not duplicated here).

import { MESSAGE_TYPES, type MessageType } from './constants';

/**
 * Wire-protocol version. Bump when the message contract changes incompatibly.
 * Receivers are version-tolerant: a message with NO version is treated as a
 * legacy sender and accepted; a message with a MISMATCHED version is rejected
 * so an incompatible future build can't feed malformed payloads to an old one.
 */
export const PROTOCOL_VERSION = 1;

/** Field carrying the protocol version on the wire (kept short). */
export const PROTOCOL_VERSION_FIELD = 'v';

const KNOWN_TYPES: ReadonlySet<string> = new Set(Object.values(MESSAGE_TYPES));

/** Type guard: `type` is one of the known MESSAGE_TYPES values. */
export function isKnownMessageType(type: unknown): type is MessageType {
  return typeof type === 'string' && KNOWN_TYPES.has(type);
}

export interface ValidatedMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * Runtime-validate an inbound message. Returns it when it is a well-formed
 * object with a string `type` and a compatible/absent protocol version, else
 * `null` so the listener can drop it. Unknown-but-well-formed types pass through
 * and are rejected by handleMessage's switch `default`. Never throws.
 */
export function validateIncomingMessage(message: unknown): ValidatedMessage | null {
  if (!message || typeof message !== 'object') return null;
  const m = message as Record<string, unknown>;
  if (typeof m.type !== 'string') return null;
  const v = m[PROTOCOL_VERSION_FIELD];
  if (v !== undefined && v !== PROTOCOL_VERSION) return null;
  return m as ValidatedMessage;
}
