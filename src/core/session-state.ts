/** Captura del estado de sesión que hace que una SPA arranque en el mismo punto. */

import type { CapturedSessionState } from '../shared/types';

// Detecta snake_case, kebab-case y camelCase (p. ej. authToken, apiKey).
const SENSITIVE_KEY = /(?:token|password|passwd|secret|session|jwt|api[_-]?key|access[_-]?key|refresh|credit|card|cookie|authorization)/i;
const SENSITIVE_BARE_AUTH = /(?:^|[_.-])auth(?:$|[_.-])/i;
const MAX_KEYS = 250;
const MAX_VALUE_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const SENSITIVE_QUERY = /^(?:token|access_token|refresh_token|id_token|api_?key|auth|authorization|password|secret|session|jwt|code|state)$/i;

function safeRoute(href: string): string {
  try {
    const url = new URL(href);
    const params = new URLSearchParams(url.search);
    for (const key of Array.from(params.keys())) {
      if (SENSITIVE_QUERY.test(key)) params.delete(key);
    }
    const search = params.toString();
    return `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
  } catch {
    return href;
  }
}

function collect(storage: Storage | undefined, omitted: Set<string>): Record<string, string> {
  const values: Record<string, string> = {};
  if (!storage) return values;
  let total = 0;
  try {
    for (let i = 0; i < storage.length && i < MAX_KEYS; i++) {
      const key = storage.key(i);
      if (!key || SENSITIVE_KEY.test(key) || SENSITIVE_BARE_AUTH.test(key)) {
        if (key) omitted.add(key);
        continue;
      }
      const value = storage.getItem(key);
      if (typeof value !== 'string') continue;
      const bytes = new TextEncoder().encode(value).byteLength;
      if (bytes > MAX_VALUE_BYTES || total + bytes > MAX_TOTAL_BYTES) {
        omitted.add(key);
        continue;
      }
      values[key] = value;
      total += bytes;
    }
  } catch {
    /* storage bloqueado o no disponible */
  }
  return values;
}

/**
 * Captura storage y ruta sin cookies, tokens ni credenciales.
 * Solo se usa al finalizar un Clon Completo (captureStorage=true).
 */
export function captureSessionState(
  doc: Document,
  info: {
    startedAt: number;
    interactions: number;
    navigations: string[];
  },
): CapturedSessionState {
  const win = doc.defaultView;
  const omitted = new Set<string>();
  let local: Record<string, string> = {};
  let session: Record<string, string> = {};
  try {
    local = collect(win?.localStorage, omitted);
    session = collect(win?.sessionStorage, omitted);
  } catch {
    /* acceso bloqueado */
  }
  const totalBytes =
    Object.values(local).reduce((sum, value) => sum + new TextEncoder().encode(value).byteLength, 0) +
    Object.values(session).reduce((sum, value) => sum + new TextEncoder().encode(value).byteLength, 0);
  return {
    startedAt: new Date(info.startedAt).toISOString(),
    endedAt: new Date().toISOString(),
    url: doc.URL,
    route: safeRoute(doc.URL),
    storage: { local, session },
    omittedKeys: Array.from(omitted),
    truncated: totalBytes >= MAX_TOTAL_BYTES,
    interactions: info.interactions,
    navigations: Array.from(new Set(info.navigations)).slice(-80).map(safeRoute),
  };
}

export function sessionStateScript(state: CapturedSessionState): string {
  return JSON.stringify(state)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
