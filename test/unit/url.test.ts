import { describe, expect, it } from 'vitest';
import {
  absolutize,
  assetDir,
  classifyAsset,
  extensionFromMime,
  extensionOf,
  isInlineUrl,
  isSameOrigin,
  joinPath,
  parseSrcset,
  rewriteSrcset,
  sanitizeUrlForReport,
  slugify,
} from '../../src/shared/url';

describe('url', () => {
  it('resuelve relativas contra la base', () => {
    expect(absolutize('/a/b.png', 'https://x.test/page')).toBe('https://x.test/a/b.png');
    expect(absolutize('img/c.png?v=1', 'https://x.test/dir/page')).toBe('https://x.test/dir/img/c.png?v=1');
    expect(absolutize('//cdn.test/x.png', 'https://x.test/')).toBe('https://cdn.test/x.png');
  });

  it('conserva protocolos inline y rechaza basura', () => {
    expect(absolutize('data:image/png;base64,AAA', 'https://x.test')).toBe('data:image/png;base64,AAA');
    expect(absolutize('javascript:void(0)', 'https://x.test')).toBe('javascript:void(0)');
    expect(absolutize('', 'https://x.test')).toBeNull();
    expect(absolutize('   ', 'https://x.test')).toBeNull();
    expect(isInlineUrl('blob:https://x.test/1')).toBe(true);
    expect(isInlineUrl('https://x.test/a.png')).toBe(false);
  });

  it('compara orígenes', () => {
    expect(isSameOrigin('https://a.test/x', 'https://a.test/y')).toBe(true);
    expect(isSameOrigin('https://a.test/x', 'http://a.test/y')).toBe(false);
    expect(isSameOrigin('no-es-url', 'https://a.test')).toBe(false);
  });

  it('parsea y reescribe srcset', () => {
    expect(parseSrcset('a.png 1x, b.png 2x')).toEqual([
      { url: 'a.png', descriptor: '1x' },
      { url: 'b.png', descriptor: '2x' },
    ]);
    expect(rewriteSrcset('a.png 1x, b.png 2x', (u) => `assets/${u.split('/').pop()}`, 'https://x.test/')).toBe(
      'assets/a.png 1x, assets/b.png 2x',
    );
  });

  it('clasifica recursos por extensión y pista', () => {
    expect(classifyAsset('https://x.test/a.WOFF2')).toBe('font');
    expect(classifyAsset('https://x.test/a.webp?x=1')).toBe('image');
    expect(classifyAsset('https://x.test/v.m3u8')).toBe('video');
    expect(classifyAsset('https://x.test/a.mp3')).toBe('audio');
    expect(classifyAsset('https://x.test/estilo', 'css')).toBe('css');
    expect(classifyAsset('https://x.test/raro.bin')).toBe('other');
    expect(assetDir('font')).toBe('assets/fonts');
    expect(extensionOf('https://x.test/a/b.PNG?x=1')).toBe('png');
    expect(extensionFromMime('image/jpeg')).toBe('jpg');
  });

  it('sanea credenciales en URLs de informe', () => {
    const clean = sanitizeUrlForReport('https://user:pass@x.test/a?token=abc&id=7&access_token=zzz&x=1');
    expect(clean).not.toContain('pass');
    expect(clean).not.toContain('abc');
    expect(clean).not.toContain('zzz');
    expect(clean).toContain('id=7');
    expect(sanitizeUrlForReport('https://x.test/a?q=' + 'a'.repeat(48))).not.toContain('a'.repeat(48));
  });

  it('utilidades de ruta', () => {
    expect(joinPath('snapshot/', '/frames/', 'f.html')).toBe('snapshot/frames/f.html');
    expect(slugify('  ¡Hola Múndo! 2026 ')).toBe('hola-mundo-2026');
  });
});
