const PRIVATE_IP_PREFIXES = ['10.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.',
  '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.', '172.28.',
  '172.29.', '172.30.', '172.31.', '192.168.', '169.254.'];

const PRIVATE_HOSTNAMES = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'];

export function isSafeImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'data:', 'blob:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function isAllowedFetchUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const hostname = parsed.hostname;
    if (PRIVATE_HOSTNAMES.includes(hostname)) return false;
    if (PRIVATE_IP_PREFIXES.some((prefix) => hostname.startsWith(prefix))) return false;
    if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return false;
    return true;
  } catch {
    return false;
  }
}
