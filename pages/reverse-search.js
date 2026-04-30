(async function () {
  const statusEl = document.getElementById('status');

  function showError(message) {
    statusEl.innerHTML = `<div class="error"><p>❌ ${message}</p><p><a href="#" id="close-tab">Close this tab</a></p></div>`;
    document.getElementById('close-tab')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.close();
    });
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const engine = params.get('engine');
    const imageUrl = params.get('imageUrl');

    if (!engine || !imageUrl) {
      showError('Missing search parameters.');
      return;
    }

    statusEl.querySelector('p').textContent = `Downloading image for ${engine} search...`;

    // Ask background to fetch the image data
    const response = await chrome.runtime.sendMessage({
      type: 'FETCH_IMAGE_DATA',
      url: imageUrl
    });

    if (!response || !response.success || !response.dataUrl) {
      // Fallback: try URL-based search directly
      fallbackUrlSearch(engine, imageUrl);
      return;
    }

    const dataUrl = response.dataUrl;
    statusEl.querySelector('p').textContent = `Submitting image to ${engine}...`;

    // Convert data URL to Blob
    const blob = dataUrlToBlob(dataUrl);
    const fileName = guessFileName(imageUrl, blob.type);

    // Submit to the selected engine
    switch (engine) {
      case 'google':
        submitFormUpload('https://lens.google.com/v3/upload', 'encoded_image', blob, fileName);
        break;
      case 'yandex':
        await submitYandex(dataUrl, imageUrl);
        break;
      case 'tineye':
        submitFormUpload('https://tineye.com/search', 'image', blob, fileName);
        break;
      case 'baidu':
        await submitBaidu(dataUrl, imageUrl);
        break;
      default:
        showError(`Unknown search engine: ${engine}`);
    }
  } catch (error) {
    console.error('Reverse search error:', error);
    showError(`Search failed: ${error.message}`);
  }

  // ---- Engine-specific submission ----

  function submitFormUpload(actionUrl, fieldName, blob, fileName, extraFields) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.enctype = 'multipart/form-data';
    form.action = actionUrl;
    form.target = '_self';

    if (extraFields) {
      for (const [name, value] of Object.entries(extraFields)) {
        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.name = name;
        hidden.value = value;
        form.appendChild(hidden);
      }
    }

    const fileInput = createFileInput(fieldName, blob, fileName);
    form.appendChild(fileInput);

    document.body.appendChild(form);
    form.submit();
  }

  async function submitYandex(imageDataUrl, imageUrl) {
    // Yandex.com is blocked in China, try yandex.ru via background proxy
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'REVERSE_SEARCH_UPLOAD',
        engine: 'yandex',
        imageDataUrl: imageDataUrl
      });

      if (result && result.success && result.redirectUrl) {
        window.location.href = result.redirectUrl;
        return;
      }
    } catch (error) {
      console.warn('Yandex background upload failed:', error);
    }
    // Fallback to URL-based search
    fallbackUrlSearch('yandex', imageUrl);
  }

  async function submitBaidu(imageDataUrl, imageUrl) {
    // Baidu requires opening their page and injecting a script to simulate
    // file upload (their API rejects direct fetch requests)
    try {
      statusEl.querySelector('p').textContent = 'Opening Baidu image search...';
      const result = await chrome.runtime.sendMessage({
        type: 'REVERSE_SEARCH_UPLOAD',
        engine: 'baidu',
        imageDataUrl: imageDataUrl
      });

      if (result && result.success) {
        // Background opened Baidu page and injected upload script
        // Close this intermediate tab
        window.close();
        return;
      }
    } catch (error) {
      console.warn('Baidu inject failed:', error);
    }
    // Fallback to URL-based search
    fallbackUrlSearch('baidu', imageUrl);
  }

  // ---- Helpers ----

  function createFileInput(fieldName, blob, fileName) {
    const dataTransfer = new DataTransfer();
    const file = new File([blob], fileName, { type: blob.type });
    dataTransfer.items.add(file);

    const input = document.createElement('input');
    input.type = 'file';
    input.name = fieldName;
    input.files = dataTransfer.files;
    input.style.display = 'none';
    return input;
  }

  function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const byteString = atob(parts[1]);
    const arrayBuffer = new ArrayBuffer(byteString.length);
    const uint8Array = new Uint8Array(arrayBuffer);
    for (let i = 0; i < byteString.length; i++) {
      uint8Array[i] = byteString.charCodeAt(i);
    }
    return new Blob([uint8Array], { type: mime });
  }

  function guessFileName(url, mimeType) {
    try {
      const pathname = new URL(url).pathname;
      const lastSegment = pathname.split('/').pop();
      if (lastSegment && /\.\w{2,5}$/.test(lastSegment)) {
        return lastSegment;
      }
    } catch {
      // ignore URL parse errors
    }

    const extMap = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/bmp': '.bmp',
      'image/svg+xml': '.svg',
      'image/avif': '.avif'
    };
    const ext = extMap[mimeType] || '.jpg';
    return `image${ext}`;
  }

  function fallbackUrlSearch(engine, imageUrl) {
    const encodedUrl = encodeURIComponent(imageUrl);
    const fallbackUrls = {
      google: `https://lens.google.com/uploadbyurl?url=${encodedUrl}`,
      tineye: `https://tineye.com/search?url=${encodedUrl}`,
      baidu: `https://graph.baidu.com/details?isfromtusdk=1&tn=pc&image=${encodedUrl}`,
      yandex: `https://yandex.com/images/search?rpt=imageview&url=${encodedUrl}`
    };
    if (fallbackUrls[engine]) {
      window.location.href = fallbackUrls[engine];
    } else {
      showError('Fallback search not available for this engine.');
    }
  }
})();
