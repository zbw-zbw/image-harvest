// Tests for shared/messaging.ts — the runtime validation gate applied at every
// chrome.runtime.onMessage entry point (P1-1 IPC hardening).
import { describe, expect, it } from 'vitest';

import { MESSAGE_TYPES } from '../shared/constants';
import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_FIELD,
  isKnownMessageType,
  validateIncomingMessage,
} from '../shared/messaging';

describe('isKnownMessageType', () => {
  it('accepts every value declared in MESSAGE_TYPES', () => {
    for (const type of Object.values(MESSAGE_TYPES)) {
      expect(isKnownMessageType(type)).toBe(true);
    }
  });

  it('rejects unknown strings and non-string inputs', () => {
    expect(isKnownMessageType('NOT_A_REAL_TYPE')).toBe(false);
    expect(isKnownMessageType(undefined)).toBe(false);
    expect(isKnownMessageType(null)).toBe(false);
    expect(isKnownMessageType(123)).toBe(false);
    expect(isKnownMessageType({})).toBe(false);
  });
});

describe('validateIncomingMessage', () => {
  it('returns the same object when type is known and no version is present (legacy sender)', () => {
    const msg = { type: MESSAGE_TYPES.PING, foo: 1 };
    expect(validateIncomingMessage(msg)).toBe(msg);
  });

  it('accepts a message carrying the matching protocol version', () => {
    const msg = { type: MESSAGE_TYPES.PING, [PROTOCOL_VERSION_FIELD]: PROTOCOL_VERSION };
    expect(validateIncomingMessage(msg)).toBe(msg);
  });

  it('rejects a mismatched protocol version', () => {
    const msg = { type: MESSAGE_TYPES.PING, [PROTOCOL_VERSION_FIELD]: PROTOCOL_VERSION + 1 };
    expect(validateIncomingMessage(msg)).toBeNull();
  });

  it('lets an unknown but well-formed string type through (switch default owns the error)', () => {
    const msg = { type: 'NOT_A_REAL_TYPE' };
    expect(validateIncomingMessage(msg)).toBe(msg);
  });

  it('rejects non-objects, null, and objects without a string type', () => {
    expect(validateIncomingMessage(null)).toBeNull();
    expect(validateIncomingMessage(undefined)).toBeNull();
    expect(validateIncomingMessage('a string')).toBeNull();
    expect(validateIncomingMessage(42)).toBeNull();
    expect(validateIncomingMessage({})).toBeNull();
    expect(validateIncomingMessage({ foo: 'bar' })).toBeNull();
    expect(validateIncomingMessage({ type: 123 })).toBeNull();
  });
});
