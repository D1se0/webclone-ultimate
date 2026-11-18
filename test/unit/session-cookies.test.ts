import { describe, expect, it } from 'vitest';
import { parseCookieInput } from '../../src/shared/session-cookies';

const PAGE = 'https://protocolexplorer.org/es?p=http';

describe('parseCookieInput', () => {
  it('parsea una cabecera Cookie con varios pares', () => {
    const parsed = parseCookieInput('Cookie: a=1; b=valor%3D', PAGE);
    expect(parsed.errors).toEqual([]);
    expect(parsed.cookies.map((cookie) => [cookie.name, cookie.value])).toEqual([
      ['a', '1'],
      ['b', 'valor%3D'],
    ]);
    expect(parsed.cookies[0].domain).toBeUndefined();
    expect(parsed.cookies[0].url).toBe('https://protocolexplorer.org/');
    expect(parsed.cookies[0].secure).toBe(true);
  });

  it('parsea líneas nombre valor dominio ruta como las de la cookie de ejemplo', () => {
    const parsed = parseCookieInput(
      '__Secure-better-auth.session_data eyJhbGciOi protocolexplorer.org /\n__Secure-better-auth.session_token token.abc%3D protocolexplorer.org /',
      PAGE,
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.cookies).toHaveLength(2);
    expect(parsed.cookies[1]).toMatchObject({
      name: '__Secure-better-auth.session_token',
      value: 'token.abc%3D',
      domain: 'protocolexplorer.org',
      path: '/',
      secure: true,
      httpOnly: true,
    });
  });

  it('parsea JSON exportado por una extensión de cookies', () => {
    const parsed = parseCookieInput(
      JSON.stringify([
        {
          name: 'session',
          value: 'abc',
          domain: '.example.test',
          path: '/app',
          secure: true,
          httpOnly: true,
          sameSite: 'strict',
          expirationDate: 2_000_000_000,
        },
      ]),
      'https://example.test/',
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.cookies[0]).toMatchObject({
      name: 'session',
      domain: '.example.test',
      path: '/app',
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      expirationDate: 2_000_000_000,
      url: 'https://example.test/app',
    });
  });

  it('rechaza los prefijos seguros en una página HTTP sin filtrar el valor', () => {
    const parsed = parseCookieInput('__Secure-session=super-secreto', 'http://example.test/');
    expect(parsed.cookies).toEqual([]);
    expect(parsed.errors[0]).toContain('__Secure-session');
    expect(parsed.errors.join(' ')).not.toContain('super-secreto');
  });

  it('acepta varias líneas de pares sin prefijo Cookie:', () => {
    const parsed = parseCookieInput('a=1\nb=2\n', PAGE);
    expect(parsed.errors).toEqual([]);
    expect(parsed.cookies.map((cookie) => cookie.name)).toEqual(['a', 'b']);
  });
});
