// ImageCard Preact component tests.
//
// Strategy: mock side-effect modules (actions, pro-features, ui, settings)
// so the component can render in jsdom without touching chrome.* APIs,
// IndexedDB, or the real toast/dialog DOM. We only verify rendering and
// click-handler wiring — store-driven re-render is covered by store tests
// already.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';

// ── Mocks ────────────────────────────────────────────────────────────────
// vi.mock factories run hoisted *before* any module-level statements, so we
// stash spy bags inside vi.hoisted() to make them visible to both the
// factory (top) and the test bodies (bottom).
const mocks = vi.hoisted(() => ({
  actions: {
    toggleSelection: vi.fn(),
    setupDragAndDrop: vi.fn(),
    copyImageUrl: vi.fn(),
    downloadSingle: vi.fn(),
    openInNewTab: vi.fn(),
    showReverseSearchMenu: vi.fn(),
  },
  pro: {
    addToCollection: vi.fn().mockResolvedValue(undefined),
    copyColor: vi.fn(),
    isImageInCollection: vi.fn().mockResolvedValue(false),
    removeFromCollection: vi.fn().mockResolvedValue(undefined),
    removeImageById: vi.fn(),
  },
  ui: {
    showConfirmDialog: vi.fn().mockResolvedValue(true),
    showToast: vi.fn(),
  },
  settings: {
    showProUpgradeModal: vi.fn(),
  },
}));

vi.mock('../sidepanel/actions', () => mocks.actions);
vi.mock('../sidepanel/pro-features', () => mocks.pro);
vi.mock('../sidepanel/ui', () => mocks.ui);
vi.mock('../sidepanel/settings', () => mocks.settings);

// Imports MUST come after vi.mock() calls.
import { ImageCard } from '../sidepanel/components/ImageCard';
import { state, store } from '../sidepanel/state';
import { makeImage } from './_helpers/imageFixtures';

beforeEach(() => {
  store.reset();
  [mocks.actions, mocks.pro, mocks.ui, mocks.settings].forEach((bag) => {
    Object.values(bag).forEach((fn) => fn.mockClear?.());
  });
  mocks.pro.isImageInCollection.mockResolvedValue(false);
  mocks.ui.showConfirmDialog.mockResolvedValue(true);
});

describe('ImageCard – rendering', () => {
  it('renders the image url, format, dimensions and filesize', () => {
    const img = makeImage({
      url: 'https://cdn.example.com/cat.jpg',
      format: 'jpg',
      naturalWidth: 1024,
      naturalHeight: 768,
      estimatedSize: 2048,
    });
    const { container } = render(<ImageCard img={img} index={0} />);

    expect(container.querySelector('.image-card')).toBeInTheDocument();
    expect(screen.getByText('JPG')).toBeInTheDocument();
    expect(screen.getByText('1024×768')).toBeInTheDocument();
    expect(screen.getByText(/cat\.jpg/)).toBeInTheDocument();
    // formatBytes(2048) → "2 KB"
    expect(screen.getByText(/KB|B/)).toBeInTheDocument();
  });

  it('renders the thumbnail image with the source url', () => {
    const img = makeImage({ url: 'https://x.test/y.png' });
    const { container } = render(<ImageCard img={img} index={0} />);
    const thumb = container.querySelector<HTMLImageElement>('.card-thumb img');
    expect(thumb).not.toBeNull();
    expect(thumb!.getAttribute('src')).toBe('https://x.test/y.png');
  });

  it('renders color swatches when colors are present', () => {
    const img = makeImage({ colors: ['#ff0000', '#00ff00', '#0000ff'] });
    const { container } = render(<ImageCard img={img} index={0} />);
    const swatches = container.querySelectorAll('.card-color-bar');
    expect(swatches.length).toBe(3);
    expect(swatches[0].getAttribute('data-color')).toBe('#ff0000');
  });

  it('renders the empty color bar when image has no colors', () => {
    const img = makeImage({ colors: [] });
    const { container } = render(<ImageCard img={img} index={0} />);
    expect(container.querySelector('.card-color-bar-empty')).toBeInTheDocument();
    expect(container.querySelectorAll('.card-color-bar').length).toBe(0);
  });

  it('omits the color bar entirely when extraction is disabled', () => {
    state.appSettings = { ...state.appSettings, enableColorExtraction: false };
    const { container } = render(<ImageCard img={makeImage()} index={0} />);
    expect(container.querySelector('.card-color-bar-row')).toBeNull();
  });
});

describe('ImageCard – selection state', () => {
  it('reflects initial selectedImages in the .selected class + checkbox', () => {
    const img = makeImage({ id: 'sel-1' });
    state.selectedImages = new Set(['sel-1']);
    const { container } = render(<ImageCard img={img} index={0} />);
    expect(container.querySelector('.image-card.selected')).toBeInTheDocument();
    expect(container.querySelector('.card-checkbox.checked')).toBeInTheDocument();
    const cb = container.querySelector<HTMLInputElement>('input[type=checkbox]');
    expect(cb?.checked).toBe(true);
  });

  it('reactively updates when the store selection changes', async () => {
    const img = makeImage({ id: 'sel-2' });
    const { container } = render(<ImageCard img={img} index={0} />);
    expect(container.querySelector('.image-card.selected')).toBeNull();

    state.selectedImages = new Set(['sel-2']);
    await waitFor(() => {
      expect(container.querySelector('.image-card.selected')).toBeInTheDocument();
    });
  });
});

describe('ImageCard – click handlers', () => {
  it('calls toggleSelection when the card body is clicked', () => {
    const img = makeImage({ id: 'click-1' });
    const { container } = render(<ImageCard img={img} index={0} />);
    fireEvent.click(container.querySelector('.image-card')!);
    expect(mocks.actions.toggleSelection).toHaveBeenCalledWith('click-1');
  });

  it('does NOT toggle selection when clicking inside an action button', () => {
    const img = makeImage();
    const { container } = render(<ImageCard img={img} index={0} />);
    fireEvent.click(container.querySelector('.btn-dl')!);
    // toggleSelection should not fire — but downloadSingle should
    expect(mocks.actions.toggleSelection).not.toHaveBeenCalled();
    expect(mocks.actions.downloadSingle).toHaveBeenCalledTimes(1);
  });

  it('wires download / copy-url / open / search buttons', () => {
    const img = makeImage({ url: 'https://target.example/img.png' });
    const { container } = render(<ImageCard img={img} index={0} />);
    fireEvent.click(container.querySelector('.btn-copy-url')!);
    fireEvent.click(container.querySelector('.btn-open')!);
    fireEvent.click(container.querySelector('.btn-search')!);
    expect(mocks.actions.copyImageUrl).toHaveBeenCalledWith('https://target.example/img.png');
    expect(mocks.actions.openInNewTab).toHaveBeenCalledWith('https://target.example/img.png');
    expect(mocks.actions.showReverseSearchMenu).toHaveBeenCalledWith(
      'https://target.example/img.png',
      expect.any(HTMLElement)
    );
  });

  it('shows the upgrade modal when a free user clicks favorite', async () => {
    state.isProUser = false;
    const { container } = render(<ImageCard img={makeImage()} index={0} />);
    fireEvent.click(container.querySelector('.btn-favorite')!);
    await waitFor(() => {
      expect(mocks.ui.showToast).toHaveBeenCalledWith('Collection is a Pro feature', 'warning');
      expect(mocks.settings.showProUpgradeModal).toHaveBeenCalled();
      expect(mocks.pro.addToCollection).not.toHaveBeenCalled();
    });
  });

  it('adds to collection when a Pro user clicks favorite', async () => {
    state.isProUser = true;
    const img = makeImage({ id: 'fav-1' });
    const { container } = render(<ImageCard img={img} index={0} />);
    fireEvent.click(container.querySelector('.btn-favorite')!);
    await waitFor(() => {
      expect(mocks.pro.addToCollection).toHaveBeenCalledWith(img);
    });
  });

  it('confirms before deleting and calls removeImageById (Pro user)', async () => {
    // After the Pro-guard refactor handleDelete fast-fails for free
    // users — the confirm dialog never appears unless isProUser is true.
    state.isProUser = true;
    const img = makeImage({ id: 'del-1' });
    const { container } = render(<ImageCard img={img} index={0} />);
    fireEvent.click(container.querySelector('.btn-delete')!);
    await waitFor(() => {
      expect(mocks.ui.showConfirmDialog).toHaveBeenCalled();
      expect(mocks.pro.removeImageById).toHaveBeenCalledWith('del-1');
    });
  });

  it('aborts deletion when the user cancels the confirm dialog (Pro user)', async () => {
    state.isProUser = true;
    mocks.ui.showConfirmDialog.mockResolvedValueOnce(false);
    const img = makeImage({ id: 'del-2' });
    const { container } = render(<ImageCard img={img} index={0} />);
    fireEvent.click(container.querySelector('.btn-delete')!);
    await waitFor(() => {
      expect(mocks.ui.showConfirmDialog).toHaveBeenCalled();
    });
    expect(mocks.pro.removeImageById).not.toHaveBeenCalled();
  });

  it('shows the upgrade modal when a free user clicks delete (no confirm dialog)', async () => {
    // Pins the bug fix: the Pro guard runs BEFORE the confirm dialog
    // so free users see ProUpgradeModal immediately, not after dismissing
    // a confirm prompt.
    state.isProUser = false;
    const img = makeImage({ id: 'del-3' });
    const { container } = render(<ImageCard img={img} index={0} />);
    fireEvent.click(container.querySelector('.btn-delete')!);
    await waitFor(() => {
      expect(mocks.ui.showToast).toHaveBeenCalledWith(
        'Image removal is a Pro feature. Upgrade to unlock!',
        'warning'
      );
      expect(mocks.settings.showProUpgradeModal).toHaveBeenCalled();
    });
    expect(mocks.ui.showConfirmDialog).not.toHaveBeenCalled();
    expect(mocks.pro.removeImageById).not.toHaveBeenCalled();
  });

  it('blocks color copy for free users and copies for Pro', () => {
    state.isProUser = false;
    const { container, rerender } = render(
      <ImageCard img={makeImage({ colors: ['#abcdef'] })} index={0} />
    );
    fireEvent.click(container.querySelector('.card-color-bar')!);
    expect(mocks.ui.showToast).toHaveBeenCalledWith('Color copy is a Pro feature', 'warning');
    expect(mocks.pro.copyColor).not.toHaveBeenCalled();

    state.isProUser = true;
    rerender(<ImageCard img={makeImage({ colors: ['#abcdef'] })} index={0} />);
    fireEvent.click(container.querySelector('.card-color-bar')!);
    expect(mocks.pro.copyColor).toHaveBeenCalledWith('#abcdef');
  });
});

describe('ImageCard – side-effect wiring', () => {
  it('calls setupDragAndDrop on the thumbnail after mount', () => {
    const img = makeImage({ id: 'drag-1' });
    render(<ImageCard img={img} index={0} />);
    expect(mocks.actions.setupDragAndDrop).toHaveBeenCalledTimes(1);
    const [el, passedImg] = mocks.actions.setupDragAndDrop.mock.calls[0];
    expect(el).toBeInstanceOf(HTMLElement);
    expect((el as HTMLElement).classList.contains('card-thumb')).toBe(true);
    expect(passedImg).toBe(img);
  });

  it('queries collection membership and reflects favorited state', async () => {
    mocks.pro.isImageInCollection.mockResolvedValueOnce(true);
    const { container } = render(<ImageCard img={makeImage()} index={0} />);
    await waitFor(() => {
      expect(container.querySelector('.btn-favorite.favorited')).toBeInTheDocument();
    });
  });
});
