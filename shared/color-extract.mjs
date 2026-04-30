/**
 * 色彩提取算法（Median Cut）
 * 使用 Canvas API 提取图片的主要颜色
 */

/**
 * 从图片URL提取主要颜色
 * @param {string} imageUrl - 图片URL
 * @param {number} colorCount - 要提取的颜色数量，默认 5
 * @returns {Promise<string[]>} HEX 颜色值数组
 */
export function extractColors(imageUrl, colorCount = 5) {
  return new Promise((resolve) => {
    const img = new Image();
    if (!imageUrl.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // 缩放图片到 100x100 减少计算量
        canvas.width = 100;
        canvas.height = 100;
        ctx.drawImage(img, 0, 0, 100, 100);
        
        const imageData = ctx.getImageData(0, 0, 100, 100);
        const pixels = [];
        
        // 将像素数据转为 RGB 数组，忽略透明像素
        for (let i = 0; i < imageData.data.length; i += 4) {
          const r = imageData.data[i];
          const g = imageData.data[i + 1];
          const b = imageData.data[i + 2];
          const a = imageData.data[i + 3];
          
          if (a >= 128) {
            pixels.push({ r, g, b });
          }
        }
        
        if (pixels.length === 0) {
          resolve([]);
          return;
        }
        
        // 使用 Median Cut 算法分割颜色空间
        const maxDepth = Math.ceil(Math.log2(colorCount));
        const colorBuckets = medianCut(pixels, 0, maxDepth);
        
        // 计算每个分区的平均颜色并转为 HEX，按桶大小排序
        const colorEntries = colorBuckets
          .map((bucket) => ({
            color: rgbToHex(getAverageColor(bucket).r, getAverageColor(bucket).g, getAverageColor(bucket).b),
            count: bucket.length
          }))
          .sort((a, b) => b.count - a.count);
        
        // 去重：相同 HEX 值的颜色合并，保留占比最大的
        const seen = new Set();
        const uniqueColors = [];
        for (const entry of colorEntries) {
          if (!seen.has(entry.color)) {
            seen.add(entry.color);
            uniqueColors.push(entry.color);
          }
          if (uniqueColors.length >= colorCount) break;
        }
        
        // 按色相排序，使相近颜色聚在一起，视觉更平滑
        const sortedColors = sortByHue(uniqueColors);
        
        resolve(sortedColors);
      } catch (error) {
        resolve([]);
      }
    };
    
    img.onerror = () => {
      resolve([]);
    };
    
    img.src = imageUrl;
  });
}

/**
 * Median Cut 递归分割算法
 * @param {Array<{r,g,b}>} pixels - 像素数组
 * @param {number} depth - 当前递归深度
 * @param {number} maxDepth - 最大递归深度
 * @returns {Array<Array<{r,g,b}>>} 分割后的颜色桶数组
 */
function medianCut(pixels, depth, maxDepth) {
  // 达到最大深度或像素数量不足，返回当前桶
  if (depth >= maxDepth || pixels.length <= 1) {
    return [pixels];
  }
  
  // 找到 RGB 中范围最大的通道
  let rMin = 255, rMax = 0;
  let gMin = 255, gMax = 0;
  let bMin = 255, bMax = 0;
  
  for (const pixel of pixels) {
    rMin = Math.min(rMin, pixel.r);
    rMax = Math.max(rMax, pixel.r);
    gMin = Math.min(gMin, pixel.g);
    gMax = Math.max(gMax, pixel.g);
    bMin = Math.min(bMin, pixel.b);
    bMax = Math.max(bMax, pixel.b);
  }
  
  const rRange = rMax - rMin;
  const gRange = gMax - gMin;
  const bRange = bMax - bMin;
  
  let channel = 'r';
  let maxRange = rRange;
  
  if (gRange > maxRange) {
    channel = 'g';
    maxRange = gRange;
  }
  if (bRange > maxRange) {
    channel = 'b';
    maxRange = bRange;
  }
  
  // 按范围最大的通道排序
  pixels.sort((a, b) => a[channel] - b[channel]);
  
  // 从中位数分割
  const medianIndex = Math.floor(pixels.length / 2);
  const leftPixels = pixels.slice(0, medianIndex);
  const rightPixels = pixels.slice(medianIndex);
  
  // 递归分割
  const leftBuckets = medianCut(leftPixels, depth + 1, maxDepth);
  const rightBuckets = medianCut(rightPixels, depth + 1, maxDepth);
  
  return [...leftBuckets, ...rightBuckets];
}

/**
 * RGB 转 HEX
 * @param {number} r - 红色分量 (0-255)
 * @param {number} g - 绿色分量 (0-255)
 * @param {number} b - 蓝色分量 (0-255)
 * @returns {string} HEX 颜色值 '#RRGGBB'
 */
export function rgbToHex(r, g, b) {
  const toHex = (value) => {
    const hex = Math.round(value).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

/**
 * HEX 转 RGB
 * @param {string} hex - HEX 颜色值 '#RRGGBB'
 * @returns {{r,g,b}} RGB 对象
 */
export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  
  if (!result) {
    return { r: 0, g: 0, b: 0 };
  }
  
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  };
}

/**
 * 计算像素数组的平均颜色
 * @param {Array<{r,g,b}>} pixels - 像素数组
 * @returns {{r,g,b}} 平均颜色
 */
function getAverageColor(pixels) {
  if (pixels.length === 0) {
    return { r: 0, g: 0, b: 0 };
  }
  
  let rSum = 0, gSum = 0, bSum = 0;
  
  for (const pixel of pixels) {
    rSum += pixel.r;
    gSum += pixel.g;
    bSum += pixel.b;
  }
  
  return {
    r: Math.round(rSum / pixels.length),
    g: Math.round(gSum / pixels.length),
    b: Math.round(bSum / pixels.length)
  };
}

/**
 * RGB 转 HSL
 * @param {number} r - 红色分量 (0-255)
 * @param {number} g - 绿色分量 (0-255)
 * @param {number} b - 蓝色分量 (0-255)
 * @returns {{h,s,l}} HSL 值，h: 0-360, s: 0-1, l: 0-1
 */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  
  if (max === min) return { h: 0, s: 0, l };
  
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  
  return { h: h * 360, s, l };
}

/**
 * 按色相排序颜色数组，使相近颜色聚在一起
 * 无彩色（灰/白/黑，饱和度极低）放在末尾，按亮度排序
 * @param {string[]} hexColors - HEX 颜色值数组
 * @returns {string[]} 排序后的 HEX 颜色值数组
 */
function sortByHue(hexColors) {
  if (hexColors.length <= 1) return hexColors;
  
  const achromaticThreshold = 0.08;
  
  const withHsl = hexColors.map(hex => {
    const rgb = hexToRgb(hex);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    return { hex, hsl, isAchromatic: hsl.s < achromaticThreshold };
  });
  
  const chromatic = withHsl.filter(c => !c.isAchromatic);
  const achromatic = withHsl.filter(c => c.isAchromatic);
  
  chromatic.sort((a, b) => a.hsl.h - b.hsl.h);
  achromatic.sort((a, b) => b.hsl.l - a.hsl.l);
  
  return [...chromatic, ...achromatic].map(c => c.hex);
}

/**
 * extractColorsFromUrl - extractColors 的别名，供外部调用
 */
export const extractColorsFromUrl = extractColors;
