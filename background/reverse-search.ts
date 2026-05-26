// Reverse-search proxy upload (CORS bypass).
import { arrayBufferToBase64 } from './utils';
import { isAllowedFetchUrl } from '../shared/url-validator';

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
  const response = await fetch(url, {
    method: 'HEAD',
    headers: { Accept: 'image/*' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const contentLength = response.headers.get('content-length');
  const contentType = response.headers.get('content-type') || '';
  return {
    size: contentLength ? parseInt(contentLength, 10) : null,
    contentType,
  };
}

/** Fetch an image and return it as a `data:` URL (used to bypass CORS in UI). */
export async function fetchImageData(url: string): Promise<string> {
  if (!isAllowedFetchUrl(url)) {
    throw new Error('URL not allowed: must be public http/https');
  }
  const imageResponse = await fetch(url, {
    headers: { Accept: 'image/*' },
  });
  if (!imageResponse.ok) {
    throw new Error(`HTTP ${imageResponse.status}`);
  }
  const arrayBuffer = await imageResponse.arrayBuffer();
  const contentType = imageResponse.headers.get('content-type') || 'image/png';
  if (!contentType.startsWith('image/')) {
    throw new Error('Response is not an image');
  }
  const base64 = arrayBufferToBase64(arrayBuffer);
  return `data:${contentType};base64,${base64}`;
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
        console.log('[ImageSnatcher] Baidu file upload triggered');
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

  console.log('[ReverseSearch] Yandex response status:', yandexResp.status);

  if (!yandexResp.ok) {
    throw new Error(`Yandex HTTP ${yandexResp.status}`);
  }

  const yandexResult = (await yandexResp.json()) as YandexResponse;
  console.log('[ReverseSearch] Yandex upload response:', yandexResult);

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
