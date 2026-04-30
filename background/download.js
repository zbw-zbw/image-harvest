// Download management (ZIP packaging and single file downloads)
import { MESSAGE_TYPES, LIMITS } from '../shared/constants.mjs';
import { generateId, generateFilename, getFileFormat } from '../shared/utils.mjs';
import { addDownloadRecord } from '../shared/storage.mjs';
import { broadcastToPopup } from './utils.js';

// Download images as ZIP
export async function downloadZip(imageUrls, tabInfo) {
  const zip = new JSZip();
  const folder = zip.folder('images');
  const failedUrls = [];
  const successfulDownloads = [];
  
  const concurrency = LIMITS.CONCURRENT_FETCHES;
  
  for (let i = 0; i < imageUrls.length; i += concurrency) {
    const batch = imageUrls.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((url, idx) => fetchImageWithTimeout(url, i + idx))
    );
    
    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const index = i + j;
      
      if (result.success) {
        const filename = generateFilename(result.url, index, result.format);
        folder.file(filename, result.blob);
        successfulDownloads.push({ url: result.url, filename });
      } else {
        failedUrls.push({ url: result.url, error: result.error });
      }
      
      broadcastToPopup({
        type: MESSAGE_TYPES.DOWNLOAD_PROGRESS,
        completed: index + 1,
        total: imageUrls.length,
        current: result.url
      });
    }
  }
  
  if (failedUrls.length > 0) {
    const report = failedUrls.map(f => `${f.url} - ${f.error}`).join('\n');
    zip.file('_failed-downloads.txt', `Failed Downloads:\n\n${report}`);
  }
  
  const content = await zip.generateAsync({ 
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
  
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const domain = tabInfo?.domain || 'images';
  const zipFilename = `${domain}-${timestamp}.zip`;
  
  const blobUrl = URL.createObjectURL(content);
  const downloadId = await chrome.downloads.download({
    url: blobUrl,
    filename: zipFilename,
    saveAs: false
  });
  
  const record = {
    id: generateId(zipFilename),
    filename: zipFilename,
    timestamp: Date.now(),
    pageUrl: tabInfo?.url || '',
    pageTitle: tabInfo?.title || '',
    imageCount: successfulDownloads.length,
    totalSizeBytes: content.size,
    imageUrls: successfulDownloads.map(d => d.url)
  };
  
  await addDownloadRecord(record);
  
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  
  broadcastToPopup({
    type: MESSAGE_TYPES.DOWNLOAD_COMPLETE,
    filename: zipFilename,
    count: successfulDownloads.length,
    failed: failedUrls.length
  });
  
  return {
    filename: zipFilename,
    successful: successfulDownloads.length,
    failed: failedUrls.length
  };
}

// Fetch image with timeout
export async function fetchImageWithTimeout(url, index) {
  const timeout = LIMITS.FETCH_TIMEOUT_MS;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await fetch(url, {
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit'
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const blob = await response.blob();
    const format = getFileFormat(url, response.headers.get('content-type'));
    
    return {
      success: true,
      url,
      blob,
      format,
      size: blob.size
    };
  } catch (error) {
    try {
      const response = await fetch(url, {
        mode: 'no-cors',
        credentials: 'omit'
      });
      
      const blob = await response.blob();
      
      if (blob.size > 0) {
        return {
          success: true,
          url,
          blob,
          format: getFileFormat(url, blob.type),
          size: blob.size
        };
      }
    } catch {
      // Fall through to error
    }
    
    return {
      success: false,
      url,
      error: error.name === 'AbortError' ? 'Timeout' : error.message
    };
  }
}
