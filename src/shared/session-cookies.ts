/**
 * Parser de cookies de sesión para el Clon Completo.
 *
 * Acepta formatos habituales de exportación:
 *  - Cabecera `Cookie: a=1; b=2`
 *  - Pares `nombre=valor` separados por `;` o por saltos de línea
 *  - Líneas `nombre valor dominio ruta` (formato de la cookie que copia el usuario)
 *  - Netscape cookies.txt (7 columnas separadas por tabuladores)
 *  - Arrays/objetos JSON exportados por extensiones de cookies
 *
 * Es un módulo puro: no toca el navegador ni guarda nada. Los mensajes de error
 * solo mencionan nombres de cookie, nunca sus valores.
 */

export type CookieSameSite = 'no_restriction' | 'lax' | 'strict' | 'unspecified';

export interface SessionCookieSpec {
  name: string;
  value: string;
  domain?: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: CookieSameSite;
  /** Segundos desde epoch, como exige chrome.cookies.set. */
  expirationDate?: number;
  /** URL de destino para la API de cookies. */
  url: string;
}

export interface ParsedSessionCookies {
  cookies: SessionCookieSpec[];
  errors: string[];
}

interface RawCookie {
  name?: unknown;
  value?: unknown;
  domain?: unknown;
  path?: unknown;
  secure?: unknown;
  httpOnly?: unknown;
  sameSite?: unknown;
  expirationDate?: unknown;
  expires?: unknown;
}

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function normalizePath(value: unknown): string {
  const raw = String(value ?? '/').trim();
  if (!raw) return '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function normalizeDomain(value: unknown): string | undefined {
  let raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return undefined;
  // Formato Netscape: #HttpOnly_.example.com
  if (raw.startsWith('#httponly_')) raw = raw.slice('#httponly_'.length);
  if (raw.endsWith('.')) raw = raw.slice(0, -1);
  if (!raw || /\s/.test(raw)) return undefined;
  return raw;
}

function normalizeSameSite(value: unknown): CookieSameSite {
  const raw = String(value ?? '').trim().toLowerCase().replace(/[_-]/g, '');
  if (raw === 'none' || raw === 'norestriction') return 'no_restriction';
  if (raw === 'strict') return 'strict';
  if (raw === 'lax') return 'lax';
  return 'unspecified';
}

function normalizeExpiration(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  let seconds = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(seconds)) {
    const parsed = Date.parse(String(value));
    if (!Number.isFinite(parsed)) return undefined;
    seconds = parsed / 1000;
  }
  // Algunos exportadores usan milisegundos.
  if (seconds > 10_000_000_000) seconds /= 1000;
  return seconds > 0 ? Math.floor(seconds) : undefined;
}

function fromJson(value: unknown): RawCookie[] | null {
  if (Array.isArray(value)) return value as RawCookie[];
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.cookies)) return record.cookies as RawCookie[];
  if (typeof record.name === 'string' && 'value' in record) return [record as RawCookie];
  const entries = Object.entries(record);
  if (entries.length && entries.every(([, item]) => typeof item === 'string')) {
    return entries.map(([name, item]) => ({ name, value: item }));
  }
  return null;
}

function isStructuredLine(line: string): boolean {
  if (line.includes('\t')) return line.split('\t').length >= 7;
  const parts = line.trim().split(/\s+/);
  return (
    parts.length === 4 &&
    !parts[0].includes('=') &&
    parts[3].startsWith('/') &&
    /[.:]/.test(parts[2])
  );
}

function parseStructured(lines: string[]): RawCookie[] {
  const out: RawCookie[] = [];
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const tabbed = line.split('\t');
    if (tabbed.length >= 7) {
      const [domain, , path, secure, expiry, name, ...rest] = tabbed;
      out.push({
        domain,
        path,
        secure: String(secure).toUpperCase() === 'TRUE',
        expirationDate: expiry,
        name,
        value: rest.join('\t'),
      });
      continue;
    }
    const parts = line.trim().split(/\s+/);
    out.push({
      name: parts[0],
      value: parts[1],
      domain: parts[2],
      path: parts[3],
    });
  }
  return out;
}

function parseHeader(text: string): RawCookie[] {
  const out: RawCookie[] = [];
  const pairs = text.replace(/\r?\n/g, ';').split(';');
  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (!trimmed || trimmed.startsWith('$')) continue;
    const equals = trimmed.indexOf('=');
    if (equals <= 0) continue;
    const name = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (name) out.push({ name, value });
  }
  return out;
}

function parseRaw(input: string): RawCookie[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = fromJson(JSON.parse(trimmed));
      if (parsed) return parsed;
    } catch {
      /* se intenta como cabecera */
    }
  }
  let text = trimmed.replace(/^cookie\s*:\s*/i, '');
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 0 && lines.every(isStructuredLine)) return parseStructured(lines);
  return parseHeader(text);
}

function cookieUrl(domain: string | undefined, path: string, secure: boolean, page: URL): string | null {
  if (!domain) {
    try {
      return new URL(path, page.origin).href;
    } catch {
      return null;
    }
  }
  const host = domain.replace(/^\./, '');
  if (!host) return null;
  const protocol = secure ? 'https:' : page.protocol === 'http:' ? 'http:' : 'https:';
  try {
    return new URL(path, `${protocol}//${host}`).href;
  } catch {
    return null;
  }
}

/**
 * Convierte texto libre en cookies listas para `chrome.cookies.set`.
 * No devuelve el texto original ni los valores en `errors`.
 */
export function parseCookieInput(input: string, pageUrl: string): ParsedSessionCookies {
  const errors: string[] = [];
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return { cookies: [], errors: ['La pestaña no tiene una URL http(s) válida'] };
  }
  if (!/^https?:$/.test(page.protocol)) {
    return { cookies: [], errors: ['Solo se pueden importar cookies en páginas http(s)'] };
  }

  let raw: RawCookie[];
  try {
    raw = parseRaw(input);
  } catch {
    return { cookies: [], errors: ['No se pudo interpretar el texto de cookies'] };
  }
  if (raw.length === 0) {
    return { cookies: [], errors: ['No se encontró ninguna cookie en el texto'] };
  }

  const cookies: SessionCookieSpec[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const name = String(item.name ?? '').trim();
    if (!name || !COOKIE_NAME.test(name)) {
      errors.push('Nombre de cookie no válido');
      continue;
    }
    const value = String(item.value ?? '');
    if (!value) {
      errors.push(`${name}: valor vacío`);
      continue;
    }
    const domain = normalizeDomain(item.domain);
    if (item.domain !== undefined && !domain) {
      errors.push(`${name}: dominio no válido`);
      continue;
    }
    const path = normalizePath(item.path);
    const isHostPrefix = name.startsWith('__Host-');
    const isSecurePrefix = name.startsWith('__Secure-') || isHostPrefix;
    const secure = item.secure === undefined ? page.protocol === 'https:' : Boolean(item.secure);
    if (isSecurePrefix && (!secure || page.protocol !== 'https:')) {
      errors.push(`${name}: el prefijo exige HTTPS y una cookie Secure`);
      continue;
    }
    if (isHostPrefix && (domain || path !== '/')) {
      errors.push(`${name}: el prefijo __Host- exige Path=/ y ningún dominio`);
      continue;
    }
    const httpOnly = item.httpOnly === undefined ? isSecurePrefix : Boolean(item.httpOnly);
    const url = cookieUrl(domain, path, secure, page);
    if (!url) {
      errors.push(`${name}: no se pudo construir la URL de la cookie`);
      continue;
    }
    const key = `${name}|${domain ?? ''}|${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cookies.push({
      name,
      value,
      domain,
      path,
      secure,
      httpOnly,
      sameSite: normalizeSameSite(item.sameSite ?? (item as { sameSite?: unknown }).sameSite),
      expirationDate: normalizeExpiration(item.expirationDate ?? item.expires),
      url,
    });
  }

  return { cookies, errors };
}
