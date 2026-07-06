// Reverse-search proxy upload (CORS bypass).
import { arrayBufferToBase64 } from './utils';
import { isAllowedFetchUrl } from '../shared/url-validator';

/** Detect image MIME type from the first few bytes (magic number). */
function detectImageMimeFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // GIF: 47 49 46
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  // BMP: 42 4D
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'image/bmp';
  }
  // ICO: 00 00 01 00
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) {
    return 'image/x-icon';
  }
  // SVG: starts with < (text-based)
  if (bytes[0] === 0x3c) {
    const header = new TextDecoder().decode(bytes.slice(0, 256));
    if (header.includes('<svg') || header.includes('<?xml')) {
      return 'image/svg+xml';
    }
  }
  return null;
}

interface ReverseSearchSuccess {
  success: true;
  injected?: boolean;
  redirectUrl?: string;
}

export type ReverseSearchResult = ReverseSearchSuccess;

/** Lightweight HEAD-only proxy to retrieve content-length and content-type (bypasses CORS). */
export async function fetchImageMetaProxy(
  url: string
): Promise<{ size: number | null; contentType: string }> {
  if (!isAllowedFetchUrl(url)) {
    throw new Error('URL not allowed: must be public http/https');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: { Accept: 'image/*' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    // Re-validate the final URL after redirects to prevent DNS rebinding bypass
    if (!isAllowedFetchUrl(response.url)) {
      throw new Error('Redirected to disallowed URL');
    }
    const contentLength = response.headers.get('content-length');
    const contentType = response.headers.get('content-type') || '';
    return {
      size: contentLength ? parseInt(contentLength, 10) : null,
      contentType,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetch an image and return it as a `data:` URL (used to bypass CORS in UI). */
export async function fetchImageData(url: string): Promise<string> {
  if (!isAllowedFetchUrl(url)) {
    throw new Error('URL not allowed: must be public http/https');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const imageResponse = await fetch(url, {
      headers: { Accept: 'image/*' },
      signal: controller.signal,
    });
    if (!imageResponse.ok) {
      throw new Error(`HTTP ${imageResponse.status}`);
    }
    // Re-validate the final URL after redirects to prevent DNS rebinding bypass
    if (!isAllowedFetchUrl(imageResponse.url)) {
      throw new Error('Redirected to disallowed URL');
    }
    const arrayBuffer = await imageResponse.arrayBuffer();
    let contentType = imageResponse.headers.get('content-type') || '';

    // If content-type is not image/*, try to detect from magic bytes
    if (!contentType.startsWith('image/')) {
      const detected = detectImageMimeFromBytes(new Uint8Array(arrayBuffer));
      if (detected) {
        contentType = detected;
      } else {
        throw new Error('Response is not an image');
      }
    }

    const base64 = arrayBufferToBase64(arrayBuffer);
    return `data:${contentType};base64,${base64}`;
  } finally {
    clearTimeout(timeout);
  }
}

/** Upload an image to a reverse-search engine (Baidu / Yandex). */
export async function reverseSearchUpload(
  engine: string,
  imageDataUrl: string
): Promise<ReverseSearchResult> {
  const dataParts = imageDataUrl.split(',');
  if (dataParts.length < 2 || !dataParts[1]) {
    throw new Error('Invalid data URL format');
  }
  const mimeMatch = dataParts[0].match(/:(.*?);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
  if (!mimeType.startsWith('image/')) {
    throw new Error('Data URL is not an image type');
  }
  let binaryStr: string;
  try {
    binaryStr = atob(dataParts[1]);
  } catch {
    throw new Error('Invalid base64 data');
  }
  const binaryArr = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    binaryArr[i] = binaryStr.charCodeAt(i);
  }
  const imageBlob = new Blob([binaryArr], { type: mimeType });

  const extMap: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
  };
  const ext = extMap[mimeType] || '.jpg';
  const uploadFileName = `image${ext}`;

  if (engine === 'baidu') {
    return uploadToBaidu(imageDataUrl, uploadFileName, mimeType);
  }
  if (engine === 'yandex') {
    return uploadToYandex(imageBlob, uploadFileName, mimeType);
  }
  throw new Error(`Unknown engine: ${engine}`);
}

/** Open Baidu's reverse-search page and inject the file into its uploader. */
async function uploadToBaidu(
  imageDataUrl: string,
  uploadFileName: string,
  mimeType: string
): Promise<ReverseSearchResult> {
  const baiduPageUrl = 'https://graph.baidu.com/pcpage/index?tpl_from=pc';
  const tab = await chrome.tabs.create({ url: baiduPageUrl, active: true });
  if (tab.id === undefined) {
    throw new Error('Failed to open Baidu reverse-search tab');
  }
  const tabId = tab.id;

  await new Promise<void>((resolve) => {
    const listener = (changedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 10000);
  });

  await new Promise((r) => setTimeout(r, 300));

  await chrome.scripting.executeScript({
    target: { tabId },
    args: [imageDataUrl, uploadFileName, mimeType],
    func: (dataUrl: string, fileName: string, mime: string) => {
      const parts = dataUrl.split(',');
      const byteString = atob(parts[1]);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ia], { type: mime });
      const file = new File([blob], fileName, { type: mime });

      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      if (input) {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        console.error('[ImageSnatcher] Baidu: input[type=file] not found');
      }
    },
  });

  return { success: true, injected: true };
}

interface YandexCbirParams {
  cbirId?: string;
}

interface YandexResponse {
  blocks?: Array<{ params?: YandexCbirParams }>;
  cbir_id?: string;
}

/** Upload to Yandex's CBIR (content-based image retrieval) endpoint. */
async function uploadToYandex(
  imageBlob: Blob,
  uploadFileName: string,
  mimeType: string
): Promise<ReverseSearchResult> {
  const yandexUrl =
    'https://yandex.ru/images/touch/search?rpt=imageview&format=json' +
    '&request=' +
    encodeURIComponent('{"blocks":[{"block":"cbir-uploader__get-cbir-id"}]}');

  const yandexForm = new FormData();
  yandexForm.append('upfile', new File([imageBlob], uploadFileName, { type: mimeType }));

  const yandexResp = await fetch(yandexUrl, {
    method: 'POST',
    body: yandexForm,
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/javascript, */*; q=0.01',
    },
  });

  if (!yandexResp.ok) {
    throw new Error(`Yandex HTTP ${yandexResp.status}`);
  }

  const yandexResult = (await yandexResp.json()) as YandexResponse;

  const cbirParams = yandexResult?.blocks?.[0]?.params;
  if (cbirParams?.cbirId) {
    return {
      success: true,
      redirectUrl: `https://yandex.ru/images/search?cbir_id=${cbirParams.cbirId}&rpt=imageview`,
    };
  }
  if (yandexResult?.cbir_id) {
    return {
      success: true,
      redirectUrl: `https://yandex.ru/images/search?rpt=imageview&cbir_id=${yandexResult.cbir_id}`,
    };
  }
  throw new Error('Yandex returned no cbir_id');
}
