/**
 * Descarga de recursos desde el background (tiene privilegios de host, así que evita
 * la mayoría de restricciones CORS que sufriría el content script).
 */

import { classifyAsset, extensionFromMime, mimeFromExtension } from '../shared/url';

export interface FetchOptions {
  maxBytes: number;
  includeCredentials: boolean;
  timeoutMs?: number;
}

export interface FetchResult {
  ok: boolean;
  url: string;
  data?: Uint8Array;
  mime?: string;
  reason?: string;
  restriction?: string;
  bytes?: number;
}

function decodeDataUrl(url: string): { data: Uint8Array; mime: string } | null {
  const match = /^data:([^,]*),([\s\S]*)$/.exec(url);
  if (!match) return null;
  const meta = match[1];
  const isBase64 = /;base64/i.test(meta);
  const mime = meta.split(';')[0] || 'application/octet-stream';
  const payload = match[2];
  try {
    if (isBase64) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { data: bytes, mime };
    }
    const decoded = decodeURIComponent(payload);
    return { data: new TextEncoder().encode(decoded), mime };
  } catch {
    return null;
  }
}

export async function fetchAsset(url: string, options: FetchOptions): Promise<FetchResult> {
  if (url.startsWith('data:')) {
    const decoded = decodeDataUrl(url);
    if (!decoded) return { ok: false, url, reason: 'data URL ilegible', restriction: 'formato no soportado' };
    if (decoded.data.byteLength > options.maxBytes) {
      return { ok: false, url, reason: 'recurso mayor que el límite', restriction: `> ${options.maxBytes} bytes` };
    }
    return { ok: true, url, data: decoded.data, mime: decoded.mime, bytes: decoded.data.byteLength };
  }

  if (url.startsWith('blob:')) {
    return {
      ok: false,
      url,
      reason: 'blob URL no accesible desde el service worker',
      restriction: 'blob URLs viven en el origen de la página',
    };
  }

  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, url, reason: 'protocolo no soportado', restriction: url.split(':')[0] ?? 'desconocido' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: options.includeCredentials ? 'include' : 'omit',
      cache: 'force-cache',
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        url,
        reason: `HTTP ${response.status}`,
        restriction: response.status === 403 ? 'acceso denegado (posible hotlink/CSP)' : `estado HTTP ${response.status}`,
      };
    }
    const declared = Number(response.headers.get('content-length') || '0');
    if (declared > options.maxBytes) {
      return {
        ok: false,
        url,
        reason: 'recurso mayor que el límite configurado',
        restriction: `${declared} bytes > ${options.maxBytes}`,
      };
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > options.maxBytes) {
      return {
        ok: false,
        url,
        reason: 'recurso mayor que el límite configurado',
        restriction: `${buffer.byteLength} bytes > ${options.maxBytes}`,
      };
    }
    const headerMime = (response.headers.get('content-type') || '').split(';')[0].trim();
    const mime = headerMime || mimeFromExtension(url) || 'application/octet-stream';
    return { ok: true, url, data: new Uint8Array(buffer), mime, bytes: buffer.byteLength };
  } catch (error) {
    const aborted = (error as Error)?.name === 'AbortError';
    return {
      ok: false,
      url,
      reason: aborted ? 'timeout de descarga' : 'fallo de red/CORS',
      restriction: aborted ? 'sin respuesta en 20s' : String((error as Error)?.message ?? error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function assetFileName(url: string, mime: string, hash: string): { dir: string; file: string } {
  const kind = classifyAsset(url, undefined);
  const ext = mime && mime.includes('/') ? extensionFromMime(mime) : 'bin';
  return { dir: kind, file: `${hash}.${ext}` };
}
