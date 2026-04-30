// Reverse search proxy upload (bypass CORS)
import { arrayBufferToBase64 } from './utils.js';

// Fetch image data as data URL (proxy for CORS bypass)
export async function fetchImageData(url) {
  const imageResponse = await fetch(url, {
    headers: { 'Accept': 'image/*' }
  });
  if (!imageResponse.ok) {
    throw new Error(`HTTP ${imageResponse.status}`);
  }
  const arrayBuffer = await imageResponse.arrayBuffer();
  const contentType = imageResponse.headers.get('content-type') || 'image/png';
  const base64 = arrayBufferToBase64(arrayBuffer);
  return `data:${contentType};base64,${base64}`;
}

// Upload image to reverse search engine
export async function reverseSearchUpload(engine, imageDataUrl) {
  const dataParts = imageDataUrl.split(',');
  const mimeMatch = dataParts[0].match(/:(.*?);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
  const binaryStr = atob(dataParts[1]);
  const binaryArr = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    binaryArr[i] = binaryStr.charCodeAt(i);
  }
  const imageBlob = new Blob([binaryArr], { type: mimeType });

  const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
  const ext = extMap[mimeType] || '.jpg';
  const uploadFileName = `image${ext}`;

  if (engine === 'baidu') {
    return await uploadToBaidu(imageDataUrl, uploadFileName, mimeType);
  } else if (engine === 'yandex') {
    return await uploadToYandex(imageBlob, uploadFileName, mimeType);
  } else {
    throw new Error(`Unknown engine: ${engine}`);
  }
}

// Baidu: inject file upload into Baidu page
async function uploadToBaidu(imageDataUrl, uploadFileName, mimeType) {
  const baiduPageUrl = 'https://graph.baidu.com/pcpage/index?tpl_from=pc';
  const tab = await chrome.tabs.create({ url: baiduPageUrl, active: true });

  await new Promise((resolve) => {
    const listener = (tabId, changeInfo) => {
      if (tabId === tab.id && changeInfo.status === 'complete') {
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

  await new Promise(r => setTimeout(r, 1500));

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [imageDataUrl, uploadFileName, mimeType],
    func: (dataUrl, fileName, mime) => {
      const parts = dataUrl.split(',');
      const byteString = atob(parts[1]);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ia], { type: mime });
      const file = new File([blob], fileName, { type: mime });

      const input = document.querySelector('input[type="file"]');
      if (input) {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[ImageSnatcher] Baidu file upload triggered');
      } else {
        console.error('[ImageSnatcher] Baidu: input[type=file] not found');
      }
    }
  });

  return { success: true, injected: true };
}

// Yandex: upload via touch search API
async function uploadToYandex(imageBlob, uploadFileName, mimeType) {
  const yandexUrl = 'https://yandex.ru/images/touch/search?rpt=imageview&format=json'
    + '&request=' + encodeURIComponent('{"blocks":[{"block":"cbir-uploader__get-cbir-id"}]}');

  const yandexForm = new FormData();
  yandexForm.append('upfile', new File([imageBlob], uploadFileName, { type: mimeType }));

  const yandexResp = await fetch(yandexUrl, {
    method: 'POST',
    body: yandexForm,
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json, text/javascript, */*; q=0.01'
    }
  });

  console.log('[ReverseSearch] Yandex response status:', yandexResp.status);

  if (yandexResp.ok) {
    const yandexResult = await yandexResp.json();
    console.log('[ReverseSearch] Yandex upload response:', yandexResult);
    const cbirParams = yandexResult?.blocks?.[0]?.params;
    if (cbirParams && cbirParams.cbirId) {
      return { success: true, redirectUrl: `https://yandex.ru/images/search?cbir_id=${cbirParams.cbirId}&rpt=imageview` };
    } else if (yandexResult && yandexResult.cbir_id) {
      return { success: true, redirectUrl: `https://yandex.ru/images/search?rpt=imageview&cbir_id=${yandexResult.cbir_id}` };
    } else {
      throw new Error('Yandex returned no cbir_id');
    }
  } else {
    throw new Error(`Yandex HTTP ${yandexResp.status}`);
  }
}
