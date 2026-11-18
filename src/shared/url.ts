import type { AssetKind } from './types';

const INLINE_PROTOCOLS = /^(data|blob|javascript|about|mailto|tel|chrome-extension|moz-extension):/i;

/** Resuelve una referencia relativa contra una base. Devuelve null si no es resoluble. */
export function absolutize(href: string | null | undefined, base: string): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed) return null;
  if (INLINE_PROTOCOLS.test(trimmed)) return trimmed;
  try {
    return new URL(trimmed, base).href;
  } catch {
    return null;
  }
}

export function isInlineUrl(url: string): boolean {
  return INLINE_PROTOCOLS.test(url.trim());
}

export function isDataUrl(url: string): boolean {
  return /^data:/i.test(url.trim());
}

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

export function isSameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export interface SrcsetEntry {
  url: string;
  descriptor: string;
}

export function parseSrcset(srcset: string): SrcsetEntry[] {
  const out: SrcsetEntry[] = [];
  if (!srcset) return out;
  // Separación por comas fuera de URLs (las URLs no llevan espacios ni comas sin escapar).
  const parts = srcset.split(',');
  for (const part of parts) {
    const value = part.trim();
    if (!value) continue;
    const match = /^(\S+)(?:\s+(.+))?$/.exec(value);
    if (!match) continue;
    out.push({ url: match[1], descriptor: (match[2] || '').trim() });
  }
  return out;
}

export function rewriteSrcset(
  srcset: string,
  resolve: (url: string) => string,
  base: string,
): string {
  return parseSrcset(srcset)
    .map(({ url, descriptor }) => {
      const abs = absolutize(url, base) ?? url;
      const replacement = resolve(abs);
      return descriptor ? `${replacement} ${descriptor}` : replacement;
    })
    .join(', ');
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp', 'apng', 'jxl']);
const FONT_EXT = new Set(['woff', 'woff2', 'ttf', 'otf', 'eot', 'sfnt']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'ogv', 'ogg', 'mov', 'm4v', 'm3u8', 'mpd', 'ts', 'mkv']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba']);

export function extensionOf(url: string): string {
  try {
    const path = new URL(url, 'https://x.invalid').pathname;
    const last = path.split('/').pop() || '';
    const dot = last.lastIndexOf('.');
    if (dot < 0) return '';
    return last.slice(dot + 1).toLowerCase();
  } catch {
    return '';
  }
}

export function classifyAsset(url: string, hint?: string): AssetKind {
  const normalizedHint = hint === 'style' ? 'css' : hint === 'script' ? 'js' : hint;
  if (normalizedHint === 'css' || normalizedHint === 'js') return normalizedHint;
  if (hint === 'style') return 'css';
  if (hint === 'script') return 'js';
  if (hint === 'video' || hint === 'audio' || hint === 'image' || hint === 'font') return hint;
  const ext = extensionOf(url);
  if (IMAGE_EXT.has(ext)) return 'image';
  if (FONT_EXT.has(ext)) return 'font';
  if (ext === 'css') return 'css';
  if (ext === 'js' || ext === 'mjs') return 'js';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (url.startsWith('data:image/')) return 'image';
  if (url.startsWith('data:font/')) return 'font';
  return 'other';
}

const KIND_DIR: Record<AssetKind, string> = {
  image: 'images',
  font: 'fonts',
  css: 'css',
  js: 'js',
  video: 'video',
  audio: 'audio',
  other: 'other',
};

export function assetDir(kind: AssetKind): string {
  return `assets/${KIND_DIR[kind]}`;
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  mp4: 'video/mp4',
  webm: 'video/webm',
  m3u8: 'application/vnd.apple.mpegurl',
  mpd: 'application/dash+xml',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  json: 'application/json',
  html: 'text/html',
  txt: 'text/plain',
};

export function mimeFromExtension(url: string): string | null {
  return MIME_BY_EXT[extensionOf(url)] ?? null;
}

export function extensionFromMime(mime: string): string {
  const clean = mime.split(';')[0].trim().toLowerCase();
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/svg+xml': 'svg',
    'image/x-icon': 'ico',
    'font/woff': 'woff',
    'font/woff2': 'woff2',
    'font/ttf': 'ttf',
    'font/otf': 'otf',
    'text/css': 'css',
    'text/javascript': 'js',
    'application/javascript': 'js',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
  };
  return map[clean] ?? 'bin';
}

const SENSITIVE_PARAM = /^(token|access_token|id_token|api_key|apikey|key|sig|signature|auth|authorization|session|sessionid|sid|password|passwd|pwd|secret|code|jwt|bearer|tk|_t|x-amz-signature|x-amz-credential|x-amz-security-token|expires)$/i;

/**
 * URL apta para informes/manifiestos: elimina parámetros con pinta de credencial y
 * credenciales embebidas en el userinfo. No se usa para descargar.
 */
export function sanitizeUrlForReport(url: string): string {
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    const keep: [string, string][] = [];
    for (const [k, v] of u.searchParams.entries()) {
      if (SENSITIVE_PARAM.test(k)) continue;
      if (/^[A-Za-z0-9._~-]{32,}$/.test(v)) continue; // token opaco largo
      keep.push([k, v]);
    }
    u.search = '';
    for (const [k, v] of keep) u.searchParams.append(k, v);
    return u.href;
  } catch {
    return url;
  }
}

export function shortUrl(url: string, max = 90): string {
  const clean = sanitizeUrlForReport(url);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

/** Ruta relativa desde un fichero del paquete hasta otro (ambos con `/`). */
export function relativePath(fromFile: string, toFile: string): string {
  const from = fromFile.split('/');
  from.pop();
  const to = toFile.split('/');
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common++;
  const up = from.length - common;
  const rest = to.slice(common).join('/');
  const prefix = up > 0 ? '../'.repeat(up) : './';
  return `${prefix}${rest}`;
}

export function joinPath(...parts: string[]): string {
  return parts
    .filter((p) => p !== '')
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .join('/');
}

export function slugify(input: string, max = 48): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (slug || 'page').slice(0, max);
}
