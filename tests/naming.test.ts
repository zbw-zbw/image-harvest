// Unit tests for shared/naming

import { describe, it, expect } from 'vitest';
import {
  getOriginalName,
  sanitizeFilename,
  buildVariables,
  applyNamingTemplate,
} from '../shared/naming';

describe('getOriginalName', () => {
  it('strips path and extension', () => {
    expect(getOriginalName('https://x.com/foo/bar.png')).toBe('bar');
    expect(getOriginalName('https://x.com/a/b/c.tar.gz')).toBe('c.tar');
  });

  it('handles trailing slash and empty pathname', () => {
    expect(getOriginalName('https://x.com/')).toBe('image');
    expect(getOriginalName('https://x.com')).toBe('image');
  });

  it('returns "image" for unparseable URLs', () => {
    expect(getOriginalName('not a url')).toBe('image');
  });
});

describe('sanitizeFilename', () => {
  it('replaces forbidden filesystem characters with _', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('trims whitespace and leading/trailing dots', () => {
    expect(sanitizeFilename('  ..hello..  ')).toBe('hello');
  });

  it('caps length at 200', () => {
    expect(sanitizeFilename('x'.repeat(300))).toHaveLength(200);
  });

  it('returns "image" for empty / non-string input', () => {
    expect(sanitizeFilename('')).toBe('image');
    expect(sanitizeFilename(null as unknown as string)).toBe('image');
    expect(sanitizeFilename(undefined as unknown as string)).toBe('image');
    expect(sanitizeFilename(42 as unknown as string)).toBe('image');
    expect(sanitizeFilename('   ')).toBe('image');
  });
});

describe('buildVariables', () => {
  it('returns all variables with sane defaults', () => {
    const vars = buildVariables({});
    expect(vars).toMatchObject({
      index: '0',
      original: 'image',
      pageTitle: 'image',
      pageDomain: '',
      width: '0',
      height: '0',
      format: 'png',
      date: '',
      timestamp: '0',
      year: '',
      month: '',
      day: '',
    });
  });

  it('parses date into year/month/day parts', () => {
    const vars = buildVariables({ date: '2026-04-30' });
    expect(vars.year).toBe('2026');
    expect(vars.month).toBe('04');
    expect(vars.day).toBe('30');
  });

  it('strips the leading subdomain from pageDomain', () => {
    expect(buildVariables({ pageDomain: 'www.example.com' }).pageDomain).toBe('example.com');
    expect(buildVariables({ pageDomain: 'cdn.images.example.com' }).pageDomain).toBe(
      'images.example.com'
    );
  });

  it('extracts and sanitizes original name from URL', () => {
    const vars = buildVariables({ url: 'https://x.com/path/photo.jpg' });
    expect(vars.original).toBe('photo');
  });
});

describe('applyNamingTemplate', () => {
  const vars = {
    index: '5',
    original: 'photo',
    pageDomain: 'example.com',
    width: '800',
    height: '600',
    format: 'webp',
    date: '2026-04-30',
  };

  it('substitutes all matching {placeholders}', () => {
    expect(applyNamingTemplate('img_{index}_{original}.{format}', vars)).toBe('img_5_photo.webp');
  });

  it('leaves unknown placeholders empty (substituted with empty string)', () => {
    const result = applyNamingTemplate('a_{unknown}_b.{format}', vars);
    expect(result.endsWith('.webp')).toBe(true);
    expect(result.includes('a_')).toBe(true);
  });

  it('appends .png if no extension in result', () => {
    expect(applyNamingTemplate('justname', vars)).toBe('justname.png');
  });

  it('returns "image.png" for empty / invalid template', () => {
    expect(applyNamingTemplate('', vars)).toBe('image.png');
    expect(applyNamingTemplate(null as unknown as string, vars)).toBe('image.png');
    expect(applyNamingTemplate(undefined as unknown as string, vars)).toBe('image.png');
  });

  it('sanitizes forbidden characters from substituted output', () => {
    const result = applyNamingTemplate('{original}.{format}', {
      ...vars,
      original: 'bad/name:here',
    });
    expect(result).toBe('bad_name_here.webp');
  });
});
