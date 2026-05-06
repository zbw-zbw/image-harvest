// Unit tests for the Sprint 3.6 rating prompt.
//
// Two surfaces under test:
//   1. shared/rating-prompt-state.ts — pure state machine (threshold,
//      cooldown, resolved-once semantics). Covered with the __test
//      adapter so we don't need a real chrome.storage round-trip.
//   2. <RatingPromptModal/> — Preact component. Renders nothing until
//      shouldShowRatingPrompt() resolves true; clicking the CTAs flips
//      the persisted state correctly.
//
// Mock strategy: same as tests/sidepanel-batch-copy.test.tsx — we keep
// the state-machine tests at the module boundary (no DOM), and use
// vi.spyOn inside the component describe block so the spies don't leak
// into the state-machine block above.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/preact';

// ── State machine tests ──────────────────────────────────────────────────
import {
  RATING_PROMPT_THRESHOLD,
  RATING_PROMPT_COOLDOWN_MS,
  recordDownloadForRating,
  shouldShowRatingPrompt,
  markRatingPromptShown,
  markRatingPromptDismissed,
  markRatingPromptResolved,
  getRatingPromptState,
  __test as ratingTestHooks,
} from '../shared/rating-prompt-state';

interface FakeStore {
  store: Map<string, unknown>;
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

function makeFakeStorage(): FakeStore {
  const m = new Map<string, unknown>();
  return {
    store: m,
    async get(key) {
      return m.get(key);
    },
    async set(key, value) {
      m.set(key, value);
    },
  };
}

let fakeNow = 1_700_000_000_000;

beforeEach(() => {
  ratingTestHooks.reset();
  ratingTestHooks.setStorage(makeFakeStorage());
  fakeNow = 1_700_000_000_000;
  ratingTestHooks.setNow(() => fakeNow);
});

afterEach(() => {
  ratingTestHooks.reset();
});

describe('rating-prompt-state', () => {
  it('exports a threshold of 50 (per Sprint 3.6 plan)', () => {
    expect(RATING_PROMPT_THRESHOLD).toBe(50);
  });

  it('exports a 14-day cooldown (shorter than soft paywall)', () => {
    expect(RATING_PROMPT_COOLDOWN_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it('starts with downloadCount = 0 / shownCount = 0 / resolved = false', async () => {
    expect(await getRatingPromptState()).toMatchObject({
      downloadCount: 0,
      shownCount: 0,
      shownAt: 0,
      dismissedAt: 0,
      resolved: false,
    });
  });

  it('does not show the prompt before the threshold is met', async () => {
    await recordDownloadForRating(RATING_PROMPT_THRESHOLD - 1);
    expect(await shouldShowRatingPrompt()).toBe(false);
  });

  it('shows the prompt once the threshold is reached', async () => {
    await recordDownloadForRating(RATING_PROMPT_THRESHOLD);
    expect(await shouldShowRatingPrompt()).toBe(true);
  });

  it('counts batch contributions correctly (recordDownloadForRating(N) adds N)', async () => {
    await recordDownloadForRating(20);
    await recordDownloadForRating(35);
    expect((await getRatingPromptState()).downloadCount).toBe(55);
    expect(await shouldShowRatingPrompt()).toBe(true);
  });

  it('ignores zero / negative / non-finite contributions', async () => {
    await recordDownloadForRating(0);
    await recordDownloadForRating(-5);
    await recordDownloadForRating(Number.NaN);
    await recordDownloadForRating(Number.POSITIVE_INFINITY);
    expect((await getRatingPromptState()).downloadCount).toBe(0);
  });

  it('floors fractional contributions (defensive against bad caller math)', async () => {
    await recordDownloadForRating(2.7);
    await recordDownloadForRating(3.4);
    expect((await getRatingPromptState()).downloadCount).toBe(5); // 2 + 3
  });

  it('suppresses re-show within the same 60s session window', async () => {
    await recordDownloadForRating(RATING_PROMPT_THRESHOLD);
    expect(await shouldShowRatingPrompt()).toBe(true);
    await markRatingPromptShown();
    // 30s later — still within the per-session suppression window.
    fakeNow += 30_000;
    expect(await shouldShowRatingPrompt()).toBe(false);
  });

  it('re-arms after the per-session window elapses', async () => {
    await recordDownloadForRating(RATING_PROMPT_THRESHOLD);
    await markRatingPromptShown();
    fakeNow += 70_000;
    expect(await shouldShowRatingPrompt()).toBe(true);
  });

  it('respects the cooldown after a "Maybe later" dismissal', async () => {
    await recordDownloadForRating(RATING_PROMPT_THRESHOLD);
    await markRatingPromptDismissed();
    // 7 days later — still within the 14-day cooldown.
    fakeNow += 7 * 24 * 60 * 60 * 1000;
    expect(await shouldShowRatingPrompt()).toBe(false);
  });

  it('re-arms after the cooldown elapses', async () => {
    await recordDownloadForRating(RATING_PROMPT_THRESHOLD);
    await markRatingPromptDismissed();
    fakeNow += RATING_PROMPT_COOLDOWN_MS + 1;
    expect(await shouldShowRatingPrompt()).toBe(true);
  });

  it('never shows again after markRatingPromptResolved (sticky terminal state)', async () => {
    await recordDownloadForRating(RATING_PROMPT_THRESHOLD * 100);
    await markRatingPromptResolved();
    fakeNow += 365 * 24 * 60 * 60 * 1000; // a year later
    expect(await shouldShowRatingPrompt()).toBe(false);
    expect((await getRatingPromptState()).resolved).toBe(true);
  });

  it('markRatingPromptShown increments shownCount and sets shownAt', async () => {
    await markRatingPromptShown();
    const s1 = await getRatingPromptState();
    expect(s1.shownCount).toBe(1);
    expect(s1.shownAt).toBe(fakeNow);
    fakeNow += 1_000;
    await markRatingPromptShown();
    const s2 = await getRatingPromptState();
    expect(s2.shownCount).toBe(2);
    expect(s2.shownAt).toBe(fakeNow);
  });
});

// ── Component tests ──────────────────────────────────────────────────────
// Stub navigator + chrome.* before importing the component so its useEffect
// (which calls i18n.t and shouldShowRatingPrompt) doesn't blow up at
// module load.

import { RatingPromptModal, CHROME_STORE_REVIEW_URL } from '../sidepanel/components/RatingPromptModal';
import * as ratingState from '../shared/rating-prompt-state';

describe('<RatingPromptModal/>', () => {
  // Typed as MockInstance without generics so the narrower window.open
  // overload (3 positional optional params) can be assigned here without
  // tsc rejecting the variance mismatch against vi.spyOn's inferred type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let openSpy: any;

  beforeEach(() => {
    // Make i18n happy: detectLocale reads chrome.storage on first t() call.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome = {
      storage: {
        local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
      },
      i18n: { getUILanguage: () => 'en' },
    };
    openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    openSpy.mockRestore();
    vi.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).chrome;
  });

  it('renders nothing when shouldShowRatingPrompt returns false', async () => {
    vi.spyOn(ratingState, 'shouldShowRatingPrompt').mockResolvedValue(false);
    const markShown = vi.spyOn(ratingState, 'markRatingPromptShown').mockResolvedValue();
    const { container } = render(<RatingPromptModal />);
    // Wait one microtask tick so the useEffect promise settles.
    await Promise.resolve();
    await Promise.resolve();
    expect(container.querySelector('#rating-prompt-modal')).toBeNull();
    expect(markShown).not.toHaveBeenCalled();
  });

  it('mounts the modal and calls markRatingPromptShown when the gate opens', async () => {
    vi.spyOn(ratingState, 'shouldShowRatingPrompt').mockResolvedValue(true);
    const markShown = vi.spyOn(ratingState, 'markRatingPromptShown').mockResolvedValue();
    const { container, findByText } = render(<RatingPromptModal />);
    await findByText('Enjoying Image Harvest?');
    expect(container.querySelector('#rating-prompt-modal')).not.toBeNull();
    expect(markShown).toHaveBeenCalledTimes(1);
  });

  it('"Rate now" opens the Chrome Web Store review URL in a new tab and resolves', async () => {
    vi.spyOn(ratingState, 'shouldShowRatingPrompt').mockResolvedValue(true);
    vi.spyOn(ratingState, 'markRatingPromptShown').mockResolvedValue();
    const markResolved = vi.spyOn(ratingState, 'markRatingPromptResolved').mockResolvedValue();
    const { findByText } = render(<RatingPromptModal />);
    const btn = await findByText('⭐ Rate on Chrome Store');
    fireEvent.click(btn);
    expect(openSpy).toHaveBeenCalledWith(
      CHROME_STORE_REVIEW_URL,
      '_blank',
      'noopener,noreferrer'
    );
    expect(markResolved).toHaveBeenCalledTimes(1);
  });

  it('"Maybe later" only marks dismissed (NOT resolved)', async () => {
    vi.spyOn(ratingState, 'shouldShowRatingPrompt').mockResolvedValue(true);
    vi.spyOn(ratingState, 'markRatingPromptShown').mockResolvedValue();
    const markDismissed = vi.spyOn(ratingState, 'markRatingPromptDismissed').mockResolvedValue();
    const markResolved = vi.spyOn(ratingState, 'markRatingPromptResolved').mockResolvedValue();
    const { findByText } = render(<RatingPromptModal />);
    const btn = await findByText('Maybe later');
    fireEvent.click(btn);
    expect(markDismissed).toHaveBeenCalledTimes(1);
    expect(markResolved).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('"Don\'t ask again" marks resolved without opening the store', async () => {
    vi.spyOn(ratingState, 'shouldShowRatingPrompt').mockResolvedValue(true);
    vi.spyOn(ratingState, 'markRatingPromptShown').mockResolvedValue();
    const markResolved = vi.spyOn(ratingState, 'markRatingPromptResolved').mockResolvedValue();
    const { findByText } = render(<RatingPromptModal />);
    const btn = await findByText("Don't ask again");
    fireEvent.click(btn);
    expect(markResolved).toHaveBeenCalledTimes(1);
    expect(openSpy).not.toHaveBeenCalled();
  });
});
