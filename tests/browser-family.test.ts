import { describe, expect, it } from 'vitest';

import { getBrowserFamily } from '../shared/browser-family';

// Edge and Chrome both ship Chromium and both carry "Chrome/" in the UA;
// the only reliable discriminator is the trailing Edg/ token. Getting this
// wrong silently merges the two install channels in the funnel.
const UA = {
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  chromeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edgeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  edgeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  edgeAndroid:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 EdgA/131.0.0.0',
  opera:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/117.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
};

describe('getBrowserFamily', () => {
  it('reports chrome for Chrome on macOS and Windows', () => {
    expect(getBrowserFamily(UA.chromeMac)).toBe('chrome');
    expect(getBrowserFamily(UA.chromeWin)).toBe('chrome');
  });

  it('reports edge for desktop and Android Edge even though the UA contains Chrome/', () => {
    expect(getBrowserFamily(UA.edgeWin)).toBe('edge');
    expect(getBrowserFamily(UA.edgeMac)).toBe('edge');
    expect(getBrowserFamily(UA.edgeAndroid)).toBe('edge');
  });

  it('keeps Opera out of the chrome bucket', () => {
    expect(getBrowserFamily(UA.opera)).toBe('other');
  });

  it('reports other for a non-Chromium UA and for an empty one', () => {
    expect(getBrowserFamily(UA.firefox)).toBe('other');
    expect(getBrowserFamily('')).toBe('other');
  });
});
