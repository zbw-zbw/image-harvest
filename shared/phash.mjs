
/**
 * 感知哈希（pHash）算法实现
 * 纯前端 Canvas API，使用 ES6 模块导出
 */

/**
 * 计算图片的感知哈希
 * @param {string} imageUrl - 图片URL
 * @returns {Promise<string|null>} 64位二进制字符串，失败返回null
 */
export function calculatePHash(imageUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    if (!imageUrl.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    
    img.onload = function() {
      try {
        // 创建Canvas，缩放到32x32
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 32, 32);
        
        // 获取像素数据
        const imageData = ctx.getImageData(0, 0, 32, 32);
        
        // 转为灰度值
        const grayscale = imageToGrayscale(imageData.data, 32, 32);
        
        // 计算DCT
        const dctMatrix = dct2d(grayscale, 32);
        
        // 取8x8低频区域（左上角）
        const lowFreq = [];
        for (let v = 0; v < 8; v++) {
          for (let u = 0; u < 8; u++) {
            lowFreq.push(dctMatrix[v * 32 + u]);
          }
        }
        
        // 计算中值（跳过DC分量，即第一个值）
        const acCoefficients = lowFreq.slice(1);
        const sorted = [...acCoefficients].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        
        // 生成64位哈希
        let hash = '';
        for (let i = 0; i < 64; i++) {
          if (i === 0) {
            // DC分量
            hash += '0';
          } else {
            hash += lowFreq[i] > median ? '1' : '0';
          }
        }
        
        resolve(hash);
      } catch (error) {
        resolve(null);
      }
    };
    
    img.onerror = function() {
      resolve(null);
    };
    
    img.src = imageUrl;
  });
}

/**
 * 计算两个哈希的汉明距离
 * @param {string|null} hash1 - 第一个哈希
 * @param {string|null} hash2 - 第二个哈希
 * @returns {number} 不同位的数量，任一为null返回Infinity
 */
export function hammingDistance(hash1, hash2) {
  if (hash1 === null || hash2 === null) {
    return Infinity;
  }
  if (hash1.length !== hash2.length) {
    return Infinity;
  }
  
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) {
      distance++;
    }
  }
  return distance;
}

/**
 * 判断两个哈希是否相似
 * @param {string|null} hash1 - 第一个哈希
 * @param {string|null} hash2 - 第二个哈希
 * @param {number} threshold - 阈值，默认5
 * @returns {boolean} 是否相似
 */
export function areSimilar(hash1, hash2, threshold) {
  if (threshold === undefined) {
    threshold = 5;
  }
  return hammingDistance(hash1, hash2) <= threshold;
}

/**
 * 2D DCT-II 变换（内部函数，不导出）
 * @param {number[]} matrix - size x size 矩阵（一维数组，按行存储）
 * @param {number} size - 矩阵大小
 * @returns {number[]} DCT系数矩阵
 */
function dct2d(matrix, size) {
  const result = new Array(size * size);
  const N = size;
  
  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      let sum = 0;
      
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const pixel = matrix[y * size + x];
          const cosX = Math.cos((2 * x + 1) * u * Math.PI / (2 * N));
          const cosY = Math.cos((2 * y + 1) * v * Math.PI / (2 * N));
          sum += pixel * cosX * cosY;
        }
      }
      
      const C_u = u === 0 ? 1 / Math.sqrt(N) : Math.sqrt(2 / N);
      const C_v = v === 0 ? 1 / Math.sqrt(N) : Math.sqrt(2 / N);
      
      result[v * size + u] = C_u * C_v * sum;
    }
  }
  
  return result;
}

/**
 * 将ImageData转为灰度值矩阵（内部函数，不导出）
 * @param {Uint8ClampedArray} imageData - RGBA数据
 * @param {number} width - 宽度
 * @param {number} height - 高度
 * @returns {number[]} 灰度值数组
 */
function imageToGrayscale(imageData, width, height) {
  const grayscale = new Array(width * height);
  
  for (let i = 0; i < width * height; i++) {
    const r = imageData[i * 4];
    const g = imageData[i * 4 + 1];
    const b = imageData[i * 4 + 2];
    // 使用标准灰度转换公式
    grayscale[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  
  return grayscale;
}
