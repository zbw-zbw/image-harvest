/**
 * 图片格式转换工具
 * 使用 Canvas API 实现图片格式转换
 */

/**
 * 获取 MIME 类型
 * @param {string} format - 图片格式 ('png', 'jpg', 'jpeg', 'webp')
 * @returns {string} MIME 类型
 */
function getMimeType(format) {
  const mimeTypes = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'webp': 'image/webp'
  };
  return mimeTypes[format.toLowerCase()] || 'image/png';
}

/**
 * 检查是否支持转换
 * @param {string} format - 图片格式
 * @returns {boolean} 是否支持转换
 */
function canConvert(format) {
  const supportedFormats = ['png', 'jpg', 'jpeg', 'webp'];
  return supportedFormats.includes(format.toLowerCase());
}

/**
 * 将图片 URL 转换为目标格式
 * @param {string} imageUrl - 图片 URL
 * @param {string} targetFormat - 目标格式 ('png', 'jpg', 'jpeg', 'webp')
 * @param {number} quality - 质量 0-1，默认 0.92
 * @returns {Promise<{dataUrl: string, blob: Blob, format: string}>} 转换结果
 */
function convertImageFormat(imageUrl, targetFormat, quality = 0.92) {
  return new Promise((resolve, reject) => {
    if (!canConvert(targetFormat)) {
      reject(new Error(`Unsupported target format: ${targetFormat}`));
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0);

        const mimeType = getMimeType(targetFormat);
        const dataUrl = canvas.toDataURL(mimeType, quality);

        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Failed to create blob'));
            return;
          }
          resolve({
            dataUrl,
            blob,
            format: targetFormat.toLowerCase()
          });
        }, mimeType, quality);
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };

    img.src = imageUrl;
  });
}

/**
 * 将 Blob 转换为目标格式
 * @param {Blob} blob - 源图片 Blob
 * @param {string} targetFormat - 目标格式 ('png', 'jpg', 'jpeg', 'webp')
 * @param {number} quality - 质量 0-1，默认 0.92
 * @returns {Promise<{dataUrl: string, blob: Blob, format: string}>} 转换结果
 */
function convertBlobFormat(blob, targetFormat, quality = 0.92) {
  return new Promise((resolve, reject) => {
    if (!canConvert(targetFormat)) {
      reject(new Error(`Unsupported target format: ${targetFormat}`));
      return;
    }

    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0);

        const mimeType = getMimeType(targetFormat);
        const dataUrl = canvas.toDataURL(mimeType, quality);

        canvas.toBlob((newBlob) => {
          URL.revokeObjectURL(url);
          if (!newBlob) {
            reject(new Error('Failed to create blob'));
            return;
          }
          resolve({
            dataUrl,
            blob: newBlob,
            format: targetFormat.toLowerCase()
          });
        }, mimeType, quality);
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image from blob'));
    };

    img.src = url;
  });
}
