import { describe, expect, it } from 'vitest';
import { isAllowedFetchUrl, isSafeImageUrl } from '../shared/url-validator';

describe('isSafeImageUrl', () => {
  it('allows http/https/data/blob protocols', () => {
    expect(isSafeImageUrl('https://example.com/img.png')).toBe(true);
    expect(isSafeImageUrl('http://example.com/img.png')).toBe(true);
    expect(isSafeImageUrl('data:image/png;base64,abc')).toBe(true);
    expect(isSafeImageUrl('blob:https://example.com/uuid')).toBe(true);
  });

  it('rejects non-standard protocols', () => {
    expect(isSafeImageUrl('ftp://example.com/img.png')).toBe(false);
    expect(isSafeImageUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeImageUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isSafeImageUrl('')).toBe(false);
    expect(isSafeImageUrl('not-a-url')).toBe(false);
  });
});

describe('isAllowedFetchUrl', () => {
  it('allows public https URLs', () => {
    expect(isAllowedFetchUrl('https://cdn.example.com/image.jpg')).toBe(true);
    expect(isAllowedFetchUrl('https://images.unsplash.com/photo.webp')).toBe(true);
  });

  it('allows public http URLs', () => {
    expect(isAllowedFetchUrl('http://example.com/photo.png')).toBe(true);
  });

  it('rejects non-http protocols', () => {
    expect(isAllowedFetchUrl('ftp://example.com/file')).toBe(false);
    expect(isAllowedFetchUrl('data:image/png;base64,abc')).toBe(false);
    expect(isAllowedFetchUrl('file:///etc/passwd')).toBe(false);
  });

  describe('IPv4 private addresses', () => {
    it('rejects localhost', () => {
      expect(isAllowedFetchUrl('http://localhost/img.png')).toBe(false);
      expect(isAllowedFetchUrl('http://127.0.0.1/img.png')).toBe(false);
      expect(isAllowedFetchUrl('http://0.0.0.0/img.png')).toBe(false);
    });

    it('rejects 10.x.x.x', () => {
      expect(isAllowedFetchUrl('http://10.0.0.1/img.png')).toBe(false);
      expect(isAllowedFetchUrl('http://10.255.255.255/img.png')).toBe(false);
    });

    it('rejects 172.16-31.x.x', () => {
      expect(isAllowedFetchUrl('http://172.16.0.1/img.png')).toBe(false);
      expect(isAllowedFetchUrl('http://172.31.255.255/img.png')).toBe(false);
    });

    it('rejects 192.168.x.x', () => {
      expect(isAllowedFetchUrl('http://192.168.0.1/img.png')).toBe(false);
      expect(isAllowedFetchUrl('http://192.168.1.100/img.png')).toBe(false);
    });

    it('rejects link-local 169.254.x.x', () => {
      expect(isAllowedFetchUrl('http://169.254.1.1/img.png')).toBe(false);
    });
  });

  describe('IPv6 private addresses', () => {
    it('rejects IPv6 loopback [::1]', () => {
      expect(isAllowedFetchUrl('http://[::1]/img.png')).toBe(false);
    });

    it('rejects IPv4-mapped IPv6 [::ffff:127.0.0.1]', () => {
      expect(isAllowedFetchUrl('http://[::ffff:127.0.0.1]/img.png')).toBe(false);
    });

    it('rejects IPv4-mapped IPv6 private ranges', () => {
      expect(isAllowedFetchUrl('http://[::ffff:10.0.0.1]/img.png')).toBe(false);
      expect(isAllowedFetchUrl('http://[::ffff:192.168.1.1]/img.png')).toBe(false);
    });

    it('rejects ULA fc00::/7', () => {
      expect(isAllowedFetchUrl('http://[fc00::1]/img.png')).toBe(false);
      expect(isAllowedFetchUrl('http://[fd00::1]/img.png')).toBe(false);
      expect(isAllowedFetchUrl('http://[fdab:cdef::1]/img.png')).toBe(false);
    });

    it('rejects link-local fe80::', () => {
      expect(isAllowedFetchUrl('http://[fe80::1]/img.png')).toBe(false);
      expect(isAllowedFetchUrl('http://[fe80::1%25eth0]/img.png')).toBe(false);
    });
  });

  describe('special hostnames', () => {
    it('rejects .local domains', () => {
      expect(isAllowedFetchUrl('http://myserver.local/img.png')).toBe(false);
    });

    it('rejects .internal domains', () => {
      expect(isAllowedFetchUrl('http://api.internal/img.png')).toBe(false);
    });
  });

  it('rejects malformed URLs', () => {
    expect(isAllowedFetchUrl('')).toBe(false);
    expect(isAllowedFetchUrl('not-a-url')).toBe(false);
    expect(isAllowedFetchUrl('://missing-scheme')).toBe(false);
  });
});
