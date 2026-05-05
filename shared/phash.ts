// Perceptual hash (pHash) implementation. Pure Canvas API, no DOM mutation.

/**
 * Compute the 64-bit pHash of an image. Resolves to `null` on load/decode error.
 */
export function calculatePHash(imageUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (!imageUrl.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, 32, 32);

        const imageData = ctx.getImageData(0, 0, 32, 32);
        const grayscale = imageToGrayscale(imageData.data, 32, 32);
        const dctMatrix = dct2d(grayscale, 32);

        // Take the 8x8 low-frequency block (top-left).
        const lowFreq: number[] = [];
        for (let v = 0; v < 8; v++) {
          for (let u = 0; u < 8; u++) {
            lowFreq.push(dctMatrix[v * 32 + u]);
          }
        }

        // Median of AC coefficients (skip DC).
        const acCoefficients = lowFreq.slice(1);
        const sorted = [...acCoefficients].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];

        let hash = '';
        for (let i = 0; i < 64; i++) {
          if (i === 0) {
            hash += '0';
          } else {
            hash += lowFreq[i] > median ? '1' : '0';
          }
        }

        resolve(hash);
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => {
      resolve(null);
    };

    img.src = imageUrl;
  });
}

/**
 * Hamming distance between two equal-length hashes. Returns Infinity for null
 * inputs or mismatched lengths.
 */
export function hammingDistance(hash1: string | null, hash2: string | null): number {
  if (hash1 === null || hash2 === null) return Infinity;
  if (hash1.length !== hash2.length) return Infinity;

  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) distance++;
  }
  return distance;
}

export function areSimilar(
  hash1: string | null,
  hash2: string | null,
  threshold: number = 5
): boolean {
  return hammingDistance(hash1, hash2) <= threshold;
}

// ── Internals ───────────────────────────────────────────────────────────────

function dct2d(matrix: number[], size: number): number[] {
  const result = new Array(size * size);
  const N = size;

  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      let sum = 0;

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const pixel = matrix[y * size + x];
          const cosX = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N));
          const cosY = Math.cos(((2 * y + 1) * v * Math.PI) / (2 * N));
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

function imageToGrayscale(imageData: Uint8ClampedArray, width: number, height: number): number[] {
  const grayscale = new Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = imageData[i * 4];
    const g = imageData[i * 4 + 1];
    const b = imageData[i * 4 + 2];
    grayscale[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return grayscale;
}
