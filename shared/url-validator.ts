const PRIVATE_IP_PREFIXES = [
  // IPv4 private ranges
  '0.', // 0.0.0.0/8 — "This" network
  '10.', // 10.0.0.0/8 — Private
  '127.', // 127.0.0.0/8 — Loopback
  '100.64.', // 100.64.0.0/10 — CGNAT (first octet)
  '100.65.',
  '100.66.',
  '100.67.',
  '100.68.',
  '100.69.',
  '100.70.',
  '100.71.',
  '100.72.',
  '100.73.',
  '100.74.',
  '100.75.',
  '100.76.',
  '100.77.',
  '100.78.',
  '100.79.',
  '100.80.',
  '100.81.',
  '100.82.',
  '100.83.',
  '100.84.',
  '100.85.',
  '100.86.',
  '100.87.',
  '100.88.',
  '100.89.',
  '100.90.',
  '100.91.',
  '100.92.',
  '100.93.',
  '100.94.',
  '100.95.',
  '100.96.',
  '100.97.',
  '100.98.',
  '100.99.',
  '100.100.',
  '100.101.',
  '100.102.',
  '100.103.',
  '100.104.',
  '100.105.',
  '100.106.',
  '100.107.',
  '100.108.',
  '100.109.',
  '100.110.',
  '100.111.',
  '100.112.',
  '100.113.',
  '100.114.',
  '100.115.',
  '100.116.',
  '100.117.',
  '100.118.',
  '100.119.',
  '100.120.',
  '100.121.',
  '100.122.',
  '100.123.',
  '100.124.',
  '100.125.',
  '100.126.',
  '100.127.',
  '169.254.', // 169.254.0.0/16 — Link-local
  '172.16.',
  '172.17.',
  '172.18.',
  '172.19.',
  '172.20.',
  '172.21.',
  '172.22.',
  '172.23.',
  '172.24.',
  '172.25.',
  '172.26.',
  '172.27.',
  '172.28.',
  '172.29.',
  '172.30.',
  '172.31.',
  '192.168.',
  '198.18.', // 198.18.0.0/15 — Benchmarking
  '198.19.',
];

const PRIVATE_HOSTNAMES = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'];

/** Regex to detect non-standard IP representations (decimal/octal/hex integers). */
const NON_STANDARD_IP_PATTERN = /^(0x[0-9a-fA-F]+|0[0-7]+|\d+)$/;

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

    // Detect URLs with embedded credentials that could disguise the real host
    // (e.g. http://public.com@127.0.0.1/)
    if (parsed.username || parsed.password) return false;

    const hostname = parsed.hostname.toLowerCase();

    // Block non-standard IP representations (decimal/octal/hex integers)
    // that would resolve to loopback or private addresses
    if (NON_STANDARD_IP_PATTERN.test(hostname)) return false;

    if (PRIVATE_HOSTNAMES.includes(hostname)) return false;
    if (PRIVATE_IP_PREFIXES.some((prefix) => hostname.startsWith(prefix))) return false;
    if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return false;

    // IPv6 address checks
    if (hostname.startsWith('[')) {
      const inner = hostname.slice(1, -1).toLowerCase();
      if (
        inner === '::1' || // IPv6 loopback
        inner === '::' || // IPv6 unspecified (all zeros)
        inner.startsWith('::ffff:') || // IPv4-mapped IPv6 (shorthand)
        inner.startsWith('0:0:0:0:0:ffff:') || // IPv4-mapped IPv6 (expanded)
        inner.startsWith('fc') || // fc00::/7 — IPv6 Unique Local
        inner.startsWith('fd') || // fd00::/8 — IPv6 Unique Local
        inner.startsWith('fe80') || // fe80::/10 — IPv6 Link-local
        inner.startsWith('fe8') || // fe80::/10 includes fe80-fe8f
        inner.startsWith('fe9') || // fe90::/10 extension
        inner.startsWith('fea') ||
        inner.startsWith('feb') ||
        inner.startsWith('ff') // ff00::/8 — IPv6 Multicast
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
