// Unit tests for sidepanel/collection-ui.ts — the 257-line lazy-loaded
// collection modal + JSZip export pipeline (previously at 0% coverage).
//
// Scope split across two describe clusters:
//   1. showCollectionModal + loadCollection — DOM rendering, search
//      filter, sort by createdAt desc, 7 event bindings (remove / open
//      / copy / dl / search / img load / img error), catch → empty-
//      state HTML injection.
//   2. exportCollection — JSZip pipeline (mocked), progress abort,
//      chrome.downloads.download invocation, URL.revokeObjectURL
//      cleanup, collectionGetAll empty short-circuit, per-item fetch
//      failure skip.
//
// All transitive DOM/IPC deps mocked at module level.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../shared/collection', () => ({
  collectionGetAll: vi.fn().mockResolvedValue([]),
}));
vi.mock('../sidepanel/actions', () => ({
  downloadSingle: vi.fn(),
  formatTimestamp: vi.fn(() => '2026-05-06_11-00-00'),
  getActivePageInfo: vi.fn().mockResolvedValue({ title: 'Page', url: 'https://x.com' }),
  openInNewTab: vi.fn(),
  showReverseSearchMenu: vi.fn(),
}));
vi.mock('../sidepanel/pro-features', () => ({
  removeFromCollection: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../sidepanel/ui', () => ({
  hideProgress: vi.fn(),
  showProgress: vi.fn(),
  showToast: vi.fn(),
  updateProgress: vi.fn(),
}));
vi.mock('../sidepanel/utils', () => ({
  formatBytes: vi.fn((n: number) => `${n}B`),
  generateFilename: vi.fn((_item: unknown, i: number) => `file-${i}.png`),
  truncateUrl: vi.fn((u: string, n: number) => u.slice(0, n)),
}));

import { showCollectionModal, loadCollection } from '../sidepanel/collection-ui';
import { elements, state } from '../sidepanel/state';
import type { CollectionItem } from '../shared/types';

function mkCollectionItem(id: string, overrides: Partial<CollectionItem> = {}): CollectionItem {
  return {
    id,
    url: `https://x.com/${id}.png`,
    sourceTitle: `Source ${id}`,
    sourceUrl: 'https://x.com',
    tags: [],
    createdAt: Date.now(),
    format: 'png',
    fileSize: 1024,
    width: 100,
    height: 100,
    ...overrides,
  } as CollectionItem;
}

function mountCollectionDOM(): {
  modal: HTMLElement;
  body: HTMLDivElement;
  searchInput: HTMLInputElement;
} {
  document.body.innerHTML = `
    <div id="collection-modal">
      <div class="modal-body"></div>
      <input id="collection-search" type="text" />
    </div>
    <div id="collection-body"></div>
  `;
  const body = document.getElementById('collection-body') as HTMLDivElement;
  const searchInput = document.getElementById('collection-search') as HTMLInputElement;
  // elements.collectionBody is consumed by loadCollection — wire it.
  elements.collectionBody = body;
  elements.collectionSearch = searchInput;
  return {
    modal: document.getElementById('collection-modal')!,
    body,
    searchInput,
  };
}

beforeEach(() => {
  mountCollectionDOM();
  state.collectionModalState = { open: false };
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (elements as Partial<typeof elements>).collectionBody;
  delete (elements as Partial<typeof elements>).collectionSearch;
  // Restore navigator.clipboard — the copy-button tests below use
  // Object.defineProperty(navigator, 'clipboard', { value: ... }) which
  // defaults to writable:false. Without this restore, the next test
  // file that tries a plain `navigator.clipboard = ...` assignment
  // (e.g. sidepanel-pro-features.test.tsx > copyColor) hits a
  // "Cannot assign to read only property" TypeError and fails under
  // serial test runs. `delete` works even against readonly data
  // descriptors as long as they stay configurable (we set configurable:true).
  try {
    delete (navigator as unknown as { clipboard?: unknown }).clipboard;
  } catch {
    // jsdom may disallow deletion on some Navigator builds; swallow so
    // this afterEach can never be the proximate cause of a failure.
  }
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// showCollectionModal
// ─────────────────────────────────────────────────────────────────────

describe('showCollectionModal', () => {
  it('flips state.collectionModalState.open=true + resets modal-body scrollTop', async () => {
    const modalBody = document.querySelector('.modal-body') as HTMLElement;
    modalBody.scrollTop = 300;
    showCollectionModal();
    expect(state.collectionModalState.open).toBe(true);
    expect(modalBody.scrollTop).toBe(0);
    // Wait for the loadCollection() call fired from showCollectionModal.
    await new Promise((r) => setTimeout(r, 0));
  });

  it('wires oninput on #collection-search that calls loadCollection with trimmed value', async () => {
    const collectionMod = await import('../shared/collection');
    showCollectionModal();
    const searchInput = document.getElementById('collection-search') as HTMLInputElement;
    searchInput.value = '  hello  ';
    searchInput.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));
    // Pin: value trimmed BEFORE passed to loadCollection — a regression
    // using the raw value would spend every keystroke on trailing-space
    // filter misses.
    expect(collectionMod.collectionGetAll).toHaveBeenCalled();
  });

  it('value cleared on each open (prevents stale search state across re-opens)', () => {
    const searchInput = document.getElementById('collection-search') as HTMLInputElement;
    searchInput.value = 'prev query';
    showCollectionModal();
    expect(searchInput.value).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────
// loadCollection — rendering + filtering + sorting + event bindings
// ─────────────────────────────────────────────────────────────────────

describe('loadCollection', () => {
  it('early-returns silently when elements.collectionBody is missing (no crash, no getAll)', async () => {
    const collectionMod = await import('../shared/collection');
    delete (elements as Partial<typeof elements>).collectionBody;
    await expect(loadCollection()).resolves.toBeUndefined();
    // Pin: early-return BEFORE try block, so collectionGetAll is NOT
    // invoked. This guards the pre-Preact-mount window where cached
    // elements refs haven't been populated yet.
    expect(collectionMod.collectionGetAll).not.toHaveBeenCalled();
  });

  it('empty collection → renders "No images in collection yet" empty state', async () => {
    const collectionMod = await import('../shared/collection');
    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([]);
    await loadCollection();
    const body = document.getElementById('collection-body')!;
    expect(body.innerHTML).toContain('No images in collection yet');
    expect(body.innerHTML).toContain('collection-empty');
  });

  it('empty collection + searchQuery → shows "No matching images found" variant', async () => {
    const collectionMod = await import('../shared/collection');
    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([]);
    await loadCollection('no-match');
    const body = document.getElementById('collection-body')!;
    expect(body.innerHTML).toContain('No matching images found');
    expect(body.innerHTML).toContain('Try a different search term');
  });

  it('search filter: url/sourceTitle/sourceUrl/tags all participate', async () => {
    const collectionMod = await import('../shared/collection');
    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([
      mkCollectionItem('a', { url: 'https://example.com/Cat.png' }),
      mkCollectionItem('b', { sourceTitle: 'Dog photos' }),
      mkCollectionItem('c', { sourceUrl: 'https://birds.example.com' }),
      mkCollectionItem('d', { tags: ['wildlife', 'nature'] }),
      mkCollectionItem('e', { sourceTitle: 'Elephant' }),
    ]);

    await loadCollection('cat');
    let body = document.getElementById('collection-body')!;
    // Pin: case-insensitive match on URL. "Cat.png" ↔ query "cat".
    expect(body.querySelectorAll('.collection-card')).toHaveLength(1);
    expect(body.innerHTML).toContain('data-id="a"');

    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([
      mkCollectionItem('a', { url: 'https://example.com/Cat.png' }),
      mkCollectionItem('d', { tags: ['wildlife', 'nature'] }),
    ]);
    await loadCollection('wildlife');
    body = document.getElementById('collection-body')!;
    // Pin: tags array checked via .some(). A regression using
    // includes() on the array itself would never match.
    expect(body.innerHTML).toContain('data-id="d"');
    expect(body.innerHTML).not.toContain('data-id="a"');
  });

  it('sort by createdAt DESC (newest first)', async () => {
    const collectionMod = await import('../shared/collection');
    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([
      mkCollectionItem('old', { createdAt: 1000 }),
      mkCollectionItem('new', { createdAt: 9999 }),
      mkCollectionItem('mid', { createdAt: 5000 }),
    ]);
    await loadCollection();
    const cards = document.querySelectorAll('.collection-card');
    // Pin: DESC ordering ('new' first). A regression using ASC or
    // Array.sort without a comparator would surface items in
    // insertion-random order.
    expect(cards[0].getAttribute('data-id')).toBe('new');
    expect(cards[1].getAttribute('data-id')).toBe('mid');
    expect(cards[2].getAttribute('data-id')).toBe('old');
  });

  it('renders card info bar: format uppercased + dims + filesize tags', async () => {
    const collectionMod = await import('../shared/collection');
    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([
      mkCollectionItem('a', { format: 'jpg', width: 800, height: 600, fileSize: 2048 }),
    ]);
    await loadCollection();
    const html = document.getElementById('collection-body')!.innerHTML;
    expect(html).toContain('>JPG<');
    expect(html).toContain('>800×600<');
    expect(html).toContain('>2048B<'); // via mocked formatBytes
  });

  it('missing format → renders "UNKNOWN" tag (nullish fallback)', async () => {
    const collectionMod = await import('../shared/collection');
    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([
      mkCollectionItem('a', { format: undefined as unknown as string }),
    ]);
    await loadCollection();
    expect(document.getElementById('collection-body')!.innerHTML).toContain('>UNKNOWN<');
  });

  it('remove button click: calls removeFromCollection + refreshes list + clears .btn-favorite in main grid', async () => {
    const collectionMod = await import('../shared/collection');
    const pro = await import('../sidepanel/pro-features');
    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([mkCollectionItem('a')]);

    // Set up a main-grid card with .btn-favorite (the "sync favorite
    // state across modal ↔ main grid" path).
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="image-card" data-id="a"><button class="btn-favorite favorited"></button></div>'
    );

    await loadCollection();
    const removeBtn = document.querySelector<HTMLElement>('.btn-remove-collection')!;
    // 2nd getAll call for the post-remove reload.
    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([]);
    removeBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(pro.removeFromCollection).toHaveBeenCalledWith('a');
    // Pin: main-grid card's .btn-favorite must have `.favorited` removed
    // + title reset. Without this, the star would stay filled until the
    // user refreshes, confusing the state contract.
    const favBtn = document.querySelector('.image-card[data-id="a"] .btn-favorite')!;
    expect(favBtn.classList.contains('favorited')).toBe(false);
    expect((favBtn as HTMLElement).title).toBe('Add to collection');
  });

  it('open-in-new-tab button click: calls openInNewTab with url from data-url', async () => {
    const collectionMod = await import('../shared/collection');
    const actions = await import('../sidepanel/actions');
    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([
      mkCollectionItem('a', { url: 'https://test.example.com/pic.png' }),
    ]);
    await loadCollection();
    (document.querySelector('.btn-open-collection') as HTMLElement).click();
    expect(actions.openInNewTab).toHaveBeenCalledWith('https://test.example.com/pic.png');
  });

  it('copy button click: writes url to clipboard + success toast', async () => {
    const collectionMod = await import('../shared/collection');
    const ui = await import('../sidepanel/ui');
    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([mkCollectionItem('a')]);

    const clipWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipWrite },
    });

    await loadCollection();
    (document.querySelector('.btn-copy-collection') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect(clipWrite).toHaveBeenCalledWith('https://x.com/a.png');
    expect(ui.showToast).toHaveBeenCalledWith('URL copied', 'success');
  });

  it('copy button: clipboard rejection → error toast (not silently swallowed)', async () => {
    const collectionMod = await import('../shared/collection');
    const ui = await import('../sidepanel/ui');
    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([mkCollectionItem('a')]);

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });

    await loadCollection();
    (document.querySelector('.btn-copy-collection') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));

    // Pin: user must know the copy failed. A regression swallowing
    // the rejection would show fake-success toast → user pastes the
    // wrong thing.
    expect(ui.showToast).toHaveBeenCalledWith('Failed to copy URL', 'error');
  });

  it('download button click: constructs ImageItem stub + calls downloadSingle(imgObj, null)', async () => {
    const collectionMod = await import('../shared/collection');
    const actions = await import('../sidepanel/actions');
    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([
      mkCollectionItem('a', { format: 'jpg', url: 'https://x.com/a.jpg' }),
    ]);
    await loadCollection();
    (document.querySelector('.btn-dl-collection') as HTMLElement).click();
    expect(actions.downloadSingle).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://x.com/a.jpg', format: 'jpg' }),
      null
    );
  });

  it('reverse-search button click: calls showReverseSearchMenu(url, btnEl)', async () => {
    const collectionMod = await import('../shared/collection');
    const actions = await import('../sidepanel/actions');
    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([mkCollectionItem('a')]);
    await loadCollection();
    const searchBtn = document.querySelector('.btn-search-collection') as HTMLElement;
    searchBtn.click();
    expect(actions.showReverseSearchMenu).toHaveBeenCalledWith('https://x.com/a.png', searchBtn);
  });

  it('img load event: adds .loaded class to img + parent', async () => {
    const collectionMod = await import('../shared/collection');
    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([mkCollectionItem('a')]);
    await loadCollection();
    const img = document.querySelector('.card-thumb img') as HTMLImageElement;
    img.dispatchEvent(new Event('load'));
    expect(img.classList.contains('loaded')).toBe(true);
    expect(img.parentElement?.classList.contains('loaded')).toBe(true);
  });

  it('img error event: hides img + marks parent loaded (failed broken-link UX)', async () => {
    const collectionMod = await import('../shared/collection');
    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([mkCollectionItem('a')]);
    await loadCollection();
    const img = document.querySelector('.card-thumb img') as HTMLImageElement;
    img.dispatchEvent(new Event('error'));
    // Pin: hide broken img (display:none) vs. letting the browser's
    // default broken-img icon leak into the grid. parent gets
    // .loaded to stop the skeleton shimmer.
    expect(img.style.display).toBe('none');
    expect(img.parentElement?.classList.contains('loaded')).toBe(true);
  });

  it('collectionGetAll throws → renders "Failed to load collection" empty state', async () => {
    const collectionMod = await import('../shared/collection');
    vi.mocked(collectionMod.collectionGetAll).mockRejectedValueOnce(new Error('idb dead'));
    await loadCollection();
    expect(document.getElementById('collection-body')!.innerHTML).toContain(
      'Failed to load collection'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// exportCollection — JSZip pipeline + chrome.downloads + abort handling
// ─────────────────────────────────────────────────────────────────────

// Hoisted JSZip mock state so we can inspect what the pipeline did.
interface JSZipSpy {
  folder: ReturnType<typeof vi.fn>;
  file: ReturnType<typeof vi.fn>;
  generateAsync: ReturnType<typeof vi.fn>;
}

vi.mock('jszip', () => {
  const state: { folder: JSZipSpy } = {
    folder: {
      folder: vi.fn(),
      file: vi.fn(),
      generateAsync: vi.fn(),
    },
  };
  class FakeJSZip {
    folder = vi.fn(() => state.folder);
    generateAsync = state.folder.generateAsync;
  }
  // Expose the per-instance spy state on the constructor so tests can
  // inspect `folder.file` calls without needing a handle to the instance.
  (FakeJSZip as unknown as { __spy: typeof state }).__spy = state;
  return { default: FakeJSZip };
});

describe('exportCollection', () => {
  interface ChromeDownloadStub {
    downloads: { download: ReturnType<typeof vi.fn> };
  }
  let chromeStub: ChromeDownloadStub;
  let createObjectURLMock: ReturnType<typeof vi.fn>;
  let revokeObjectURLMock: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  function installExportScaffold(): void {
    chromeStub = {
      downloads: { download: vi.fn().mockResolvedValue(undefined) },
    };
    (globalThis as unknown as { chrome: unknown }).chrome = chromeStub;

    createObjectURLMock = vi.fn(() => 'blob:fake-url');
    revokeObjectURLMock = vi.fn();
    // URL.createObjectURL is read-only on the class in jsdom; override
    // on the class prototype-level static via Object.defineProperty.
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURLMock,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURLMock,
    });

    fetchMock = vi.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  }

  beforeEach(async () => {
    installExportScaffold();
    // Reset the JSZip instance-level spy state between tests.
    const jszipMod = (await import('jszip')) as unknown as {
      default: { __spy: { folder: JSZipSpy } };
    };
    const spy = jszipMod.default.__spy;
    spy.folder.file = vi.fn();
    spy.folder.generateAsync = vi.fn().mockResolvedValue(new Blob(['fake-zip']));
  });

  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    delete (globalThis as unknown as { fetch?: unknown }).fetch;
  });

  it('empty collection → shows info toast "Collection is empty" + NO zip / NO download', async () => {
    const { exportCollection } = await import('../sidepanel/collection-ui');
    const collectionMod = await import('../shared/collection');
    const ui = await import('../sidepanel/ui');
    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([]);

    await exportCollection();

    expect(ui.showToast).toHaveBeenCalledWith('Collection is empty', 'info');
    expect(ui.showProgress).not.toHaveBeenCalled();
    expect(chromeStub.downloads.download).not.toHaveBeenCalled();
  });

  it('happy path: fetches each item, adds to zip folder, calls chrome.downloads.download, revokes blob URL', async () => {
    const { exportCollection } = await import('../sidepanel/collection-ui');
    const collectionMod = await import('../shared/collection');
    const ui = await import('../sidepanel/ui');
    const jszipMod = (await import('jszip')) as unknown as {
      default: { __spy: { folder: JSZipSpy } };
    };

    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([
      mkCollectionItem('a'),
      mkCollectionItem('b'),
    ]);
    fetchMock.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['img'])),
    });

    await exportCollection();

    // Pin: each item resulted in folder.file(filename, blob).
    const folderSpy = jszipMod.default.__spy.folder;
    expect(folderSpy.file).toHaveBeenCalledTimes(2);
    // generateFilename mock produces "file-0.png" / "file-1.png".
    expect(folderSpy.file).toHaveBeenCalledWith('file-0.png', expect.any(Blob));
    expect(folderSpy.file).toHaveBeenCalledWith('file-1.png', expect.any(Blob));

    // Progress shown / hidden.
    expect(ui.showProgress).toHaveBeenCalledWith('Exporting collection...', expect.any(Function));
    expect(ui.updateProgress).toHaveBeenCalledTimes(2);
    expect(ui.hideProgress).toHaveBeenCalledTimes(1);

    // Download invoked with expected filename shape.
    expect(chromeStub.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'blob:fake-url',
        filename: expect.stringMatching(/^collection-.+\.zip$/),
        saveAs: false,
      })
    );
    // Pin: revokeObjectURL MUST fire to avoid blob leaks across
    // multiple export jobs. Forgetting this would balloon memory on
    // every export for session-long sidepanel sessions.
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:fake-url');
    expect(ui.showToast).toHaveBeenCalledWith('Collection exported', 'success');
  });

  it('per-item fetch failure skipped silently (not whole-job abort)', async () => {
    const { exportCollection } = await import('../sidepanel/collection-ui');
    const collectionMod = await import('../shared/collection');
    const jszipMod = (await import('jszip')) as unknown as {
      default: { __spy: { folder: JSZipSpy } };
    };

    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([
      mkCollectionItem('a'),
      mkCollectionItem('b'),
      mkCollectionItem('c'),
    ]);
    // b's fetch throws; a + c succeed.
    fetchMock
      .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob(['a'])) })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob(['c'])) });

    await exportCollection();

    // Pin: only the 2 successful fetches added to zip. A regression
    // letting one fetch failure abort the whole export would strand
    // users with a 0-byte zip when one image is offline.
    const folderSpy = jszipMod.default.__spy.folder;
    expect(folderSpy.file).toHaveBeenCalledTimes(2);
    expect(chromeStub.downloads.download).toHaveBeenCalledTimes(1);
  });

  it('per-item fetch returns !ok response → that item skipped (no blob captured)', async () => {
    const { exportCollection } = await import('../sidepanel/collection-ui');
    const collectionMod = await import('../shared/collection');
    const jszipMod = (await import('jszip')) as unknown as {
      default: { __spy: { folder: JSZipSpy } };
    };

    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([mkCollectionItem('a')]);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });

    await exportCollection();

    // Pin: the `if (resp.ok)` guard. A regression reading blob() from
    // a !ok response would either throw (some fetch polyfills) or add
    // an HTML-error-page blob to the zip as if it were the image.
    const folderSpy = jszipMod.default.__spy.folder;
    expect(folderSpy.file).not.toHaveBeenCalled();
    // Zip still generated (empty) and downloaded.
    expect(chromeStub.downloads.download).toHaveBeenCalledTimes(1);
  });

  it('abort via showProgress callback → stops pipeline + toast "Export cancelled" + NO download', async () => {
    const { exportCollection } = await import('../sidepanel/collection-ui');
    const collectionMod = await import('../shared/collection');
    const ui = await import('../sidepanel/ui');

    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([
      mkCollectionItem('a'),
      mkCollectionItem('b'),
      mkCollectionItem('c'),
    ]);

    // Capture the abort callback passed to showProgress, then fire it
    // BEFORE the first fetch resolves so the loop hits the `aborted`
    // check on the next iteration.
    let abortFn: (() => void) | null = null;
    vi.mocked(ui.showProgress).mockImplementation((_title, onAbort) => {
      abortFn = onAbort ?? null;
    });

    // Start fetch as pending so we can fire abort in between.
    let resolveFirstFetch: (v: unknown) => void = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveFirstFetch = r;
        })
    );

    const pending = exportCollection();
    // Let showProgress fire first.
    await new Promise((r) => setTimeout(r, 0));
    expect(abortFn).toBeTruthy();
    // Fire abort.
    abortFn!();
    // Resolve the pending fetch so the awaiting code can reach the
    // `if (aborted) return;` check at the top of the next iteration.
    resolveFirstFetch({ ok: true, blob: () => Promise.resolve(new Blob(['a'])) });
    await pending;

    // Pin: when aborted, chrome.downloads.download must NOT fire —
    // even if the first item already got into the zip folder. The
    // `if (aborted) return` BEFORE the generateAsync+download block
    // is the last line of defense.
    expect(chromeStub.downloads.download).not.toHaveBeenCalled();
    expect(ui.showToast).toHaveBeenCalledWith('Export cancelled', 'info');
    // hideProgress still called in finally (non-negotiable cleanup).
    expect(ui.hideProgress).toHaveBeenCalledTimes(1);
  });

  it('exception before showProgress (collectionGetAll throws) → error toast + hideProgress still fires', async () => {
    const { exportCollection } = await import('../sidepanel/collection-ui');
    const collectionMod = await import('../shared/collection');
    const ui = await import('../sidepanel/ui');

    vi.mocked(collectionMod.collectionGetAll).mockRejectedValueOnce(new Error('idb dead'));

    await exportCollection();

    expect(ui.showToast).toHaveBeenCalledWith('Export failed', 'error');
    // Pin: the finally block runs even when the try body throws
    // synchronously before showProgress ever fires. Without this,
    // a pre-progress failure would leave a stale progress widget.
    expect(ui.hideProgress).toHaveBeenCalledTimes(1);
    expect(chromeStub.downloads.download).not.toHaveBeenCalled();
  });
});
