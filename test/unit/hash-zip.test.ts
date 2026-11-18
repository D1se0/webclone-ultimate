import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { crc32, sha256Hex, sha256HexSync, shortHash } from '../../src/shared/hash';
import { assertSafeZipPath, buildZip, readZip, textFile, zipEntryNames, formatBytes } from '../../src/shared/zip';

const enc = (text: string) => new TextEncoder().encode(text);

describe('hash', () => {
  it('SHA-256 puro coincide con node:crypto', () => {
    for (const sample of ['', 'abc', 'hola mundo', 'a'.repeat(1000), 'ñandarú-ü']) {
      const expected = createHash('sha256').update(sample).digest('hex');
      expect(sha256HexSync(enc(sample))).toBe(expected);
    }
  });

  it('SHA-256 async coincide con node:crypto', async () => {
    const sample = 'WebClone Ultimate — ñ';
    expect(await sha256Hex(enc(sample))).toBe(createHash('sha256').update(sample).digest('hex'));
  });

  it('CRC-32 coincide con el valor de referencia', () => {
    expect(crc32(enc('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
    expect(crc32(new Uint8Array([0]))).toBe(0xd202ef8d);
  });

  it('shortHash es estable', () => {
    expect(shortHash('a.png')).toBe(shortHash('a.png'));
    expect(shortHash('a.png')).toHaveLength(12);
  });
});

describe('zip', () => {
  it('genera un ZIP legible con nombres unicode y sin comprimir de más', () => {
    const files = [
      { path: 'index.html', data: textFile('<html></html>') },
      { path: 'assets/other/añejo-ü.txt', data: textFile('unicode') },
      { path: 'assets/images/foto.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
    ];
    const zip = buildZip(files, { mtime: new Date('2026-01-01T00:00:00Z') });
    expect(zip.byteLength).toBeGreaterThan(100);
    const names = zipEntryNames(zip);
    expect([...names].sort()).toEqual(['assets/images/foto.png', 'assets/other/añejo-ü.txt', 'index.html']);
    const back = readZip(zip);
    expect(new TextDecoder().decode(back.get('index.html')!)).toBe('<html></html>');
    expect(new TextDecoder().decode(back.get('assets/other/añejo-ü.txt')!)).toBe('unicode');
  });

  it('rechaza rutas inseguras', () => {
    expect(() => buildZip([{ path: '../evil', data: textFile('x') }])).toThrow(/Ruta de ZIP inválida/);
    expect(() => assertSafeZipPath('/abs')).toThrow();
    expect(() => assertSafeZipPath('a\\b')).toThrow();
  });

  it('formatea tamaños', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(-1)).toBe('—');
  });
});
