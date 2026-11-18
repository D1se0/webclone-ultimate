/** Service worker: orquesta capturas, sesiones, recursos, exportación e importación. */

import { ext, onRuntimeMessage } from '../shared/ext';
import { DEFAULT_CAPTURE_OPTIONS, DEFAULT_RECORDING_OPTIONS, type AssetDescriptor, type AssetKind, type CaptureOptions, type CaptureProgress, type CaptureReport, type CapturedNetworkEntry, type FailedResource, type RecordingMeta, type RecordingOptions, type SessionKind, type SessionMeta } from '../shared/types';
import { absolutize, assetDir, classifyAsset, extensionFromMime, relativePath, sanitizeUrlForReport } from '../shared/url';
import { sha256Hex, shortHash } from '../shared/hash';
import { rewriteJsSpecifiers, rewriteJsStringLiterals } from '../shared/js-rewrite';
import { collectCssUrls, rewriteCssUrls, scanCss } from '../shared/css';
import { fetchAsset } from '../core/asset-fetcher';
import { buildExportFiles } from '../shared/export-files';
import { buildZip, readZip } from '../shared/zip';
import { base64ToBytes, bytesToBase64 } from '../shared/base64';
import { parseCookieInput } from '../shared/session-cookies';
import { buildTimeline, type RrwebEvent, type Timeline } from '../shared/timeline';
import * as store from './store';

const VERSION = (() => {
  try {
    return ext.runtime.getManifest().version as string;
  } catch {
    return '1.0.0';
  }
})();

const CONCURRENCY = 6;

interface TabState {
  sessionId?: string;
  kind?: SessionKind;
  busy: boolean;
  recording: boolean;
  full: boolean;
  fullRequests: number;
  progress?: CaptureProgress;
  startedAt?: number;
  eventCount: number;
  assetBytes: number;
  seq: number;
  error?: string;
}

interface Draft {
  sessionId: string;
  tabId: number;
  kind: SessionKind;
  startedAt: number;
  options: CaptureOptions | RecordingOptions;
  assetCount: number;
  assetBytes: number;
  assetPaths: string[];
  networkSeen: { url: string; method: string; resourceType: string }[];
  networkEntries?: CapturedNetworkMeta[];
}

const tabStates = new Map<number, TabState>();
const drafts = new Map<string, Draft>();

// Escucha pasiva de red: cubre peticiones que Resource Timing no expone (redirects,
// iframes, media, etc.). No bloquea ni modifica nada y solo guarda la URL.
try {
  const webRequest = ext.webRequest;
  if (webRequest?.onBeforeRequest) {
    webRequest.onBeforeRequest.addListener(
      (details: { tabId: number; url: string; method: string; type: string }) => {
        if (!details || details.tabId < 0 || !/^https?:/i.test(details.url)) return;
        for (const draft of drafts.values()) {
          if (draft.kind !== 'clone' || draft.tabId !== details.tabId) continue;
          if (draft.networkSeen.length >= 2000) return;
          if (draft.networkSeen.some((entry) => entry.url === details.url && entry.method === details.method)) continue;
          draft.networkSeen.push({ url: details.url, method: details.method, resourceType: details.type });
          return;
        }
      },
      { urls: ['<all_urls>'] },
    );
  }
} catch {
  /* webRequest no disponible en este navegador */
}

function getState(tabId: number): TabState {
  let state = tabStates.get(tabId);
  if (!state) {
    state = { busy: false, recording: false, full: false, fullRequests: 0, eventCount: 0, assetBytes: 0, seq: 0 };
    tabStates.set(tabId, state);
  }
  return state;
}

function newId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

async function setBadge(tabId: number, text: string): Promise<void> {
  try {
    await ext.action.setBadgeText({ tabId, text });
    await ext.action.setBadgeBackgroundColor({ tabId, color: '#7f1d1d' });
  } catch {
    /* ignore */
  }
}

async function ensureContent(tabId: number): Promise<void> {
  try {
    const ping = await ext.tabs.sendMessage(tabId, { type: 'WC_PING' }, { frameId: 0 });
    if (ping?.ok) return;
  } catch {
    /* no inyectado todavía */
  }
  if (!ext.scripting?.executeScript) {
    throw new Error('La pestaña no admite content scripts (¿página interna del navegador?)');
  }
  await ext.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

async function installPageHooks(tabId: number): Promise<boolean> {
  if (!ext.scripting?.executeScript) return false;
  try {
    await ext.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['main-world.js'] });
    return true;
  } catch {
    return false;
  }
}

interface ServerFnProbe {
  url: string;
  ok: boolean;
  status: number;
  mime: string;
  bodyBase64?: string;
}

/** Fetch de server functions desde la página: así Origin y Referer son los del sitio. */
async function fetchServerFnsInPage(tabId: number, urls: string[]): Promise<ServerFnProbe[]> {
  if (!urls.length || !ext.scripting?.executeScript) return [];
  try {
    const result = (await ext.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (list: string[]) => {
        const out: ServerFnProbe[] = [];
        for (const url of list) {
          try {
            const response = await fetch(url, {
              method: 'GET',
              credentials: 'include',
              headers: {
                accept: 'application/x-tss-framed, application/x-ndjson, application/json',
                'x-tsr-serverfn': 'true',
              },
            });
            const bytes = new Uint8Array(await response.arrayBuffer());
            let binary = '';
            for (let i = 0; i < bytes.length; i += 0x8000) {
              binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)) as unknown as number[]);
            }
            out.push({
              url,
              ok: response.ok,
              status: response.status,
              mime: response.headers.get('content-type') || 'application/json',
              bodyBase64: response.ok ? btoa(binary) : undefined,
            });
          } catch {
            out.push({ url, ok: false, status: 0, mime: '' });
          }
        }
        return out;
      },
      args: [urls],
    })) as Array<{ result?: ServerFnProbe[] }>;
    return result?.[0]?.result ?? [];
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------ captura

async function startCapture(tabId: number, options?: Partial<CaptureOptions>): Promise<unknown> {
  const state = getState(tabId);
  if (state.busy || state.recording || state.full) throw new Error('Ya hay una operación en curso en esta pestaña');
  const sessionId = newId('clone');
  const merged: CaptureOptions = { ...DEFAULT_CAPTURE_OPTIONS, ...(options ?? {}) };
  state.sessionId = sessionId;
  state.kind = 'clone';
  state.busy = true;
  state.error = undefined;
  state.progress = { phase: 'analyzing', message: 'Preparando captura', percent: 1 };
  drafts.set(sessionId, {
    sessionId,
    tabId,
    kind: 'clone',
    startedAt: Date.now(),
    options: merged,
    assetCount: 0,
    assetBytes: 0,
    assetPaths: [],
    networkSeen: [],
  });
  await ensureContent(tabId);
  if (merged.dynamic && merged.captureNetwork) await installPageHooks(tabId);
  const response = await ext.tabs.sendMessage(tabId, { type: 'WC_CAPTURE_CLONE', sessionId, options: merged }, { frameId: 0 });
  if (!response?.ok) throw new Error(response?.error ?? 'el content script rechazó la captura');
  await setBadge(tabId, '…');
  return { ok: true, sessionId, accepted: true };
}

async function applySessionCookies(
  tabId: number,
  input: string,
  pageUrl: string,
): Promise<{ count: number; names: string[] }> {
  if (!ext.cookies?.set) throw new Error('El navegador no permite escribir cookies desde la extensión');
  const parsed = parseCookieInput(input, pageUrl);
  if (parsed.errors.length > 0) {
    throw new Error(`Cookies no válidas: ${parsed.errors.slice(0, 3).join('; ')}`);
  }
  if (parsed.cookies.length === 0) throw new Error('No se encontró ninguna cookie válida');

  const names: string[] = [];
  const failed: string[] = [];
  for (const cookie of parsed.cookies) {
    const details: Record<string, unknown> = {
      url: cookie.url,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
    };
    if (cookie.domain) details.domain = cookie.domain;
    if (cookie.sameSite !== 'unspecified') details.sameSite = cookie.sameSite;
    if (cookie.expirationDate) details.expirationDate = cookie.expirationDate;
    try {
      const result = await ext.cookies.set(details);
      if (result) names.push(cookie.name);
      else failed.push(cookie.name);
    } catch {
      // No se incluye el valor ni el error del navegador (podría contener datos).
      failed.push(cookie.name);
    }
  }
  if (failed.length > 0) throw new Error(`No se pudieron aplicar estas cookies: ${failed.join(', ')}`);
  void tabId;
  return { count: names.length, names };
}

/** Espera a que la pestaña recargada esté lista antes de inyectar la sesión completa. */
async function reloadTabAndWait(tabId: number, timeoutMs = 20_000): Promise<boolean> {
  if (!ext.tabs.onUpdated?.addListener) {
    await Promise.resolve(ext.tabs.reload(tabId)).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return true;
  }
  const completed = await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ext.tabs.onUpdated.removeListener(listener);
      } catch {
        /* ignore */
      }
      resolve(value);
    };
    const listener = (id: number, change: { status?: string }): void => {
      if (id === tabId && change.status === 'complete') finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    ext.tabs.onUpdated.addListener(listener);
    Promise.resolve(ext.tabs.reload(tabId)).catch(() => finish(false));
  });
  if (!completed) return false;
  // El documento está completo, pero el content script y los hooks pueden
  // tardar un instante en quedar disponibles.
  await new Promise((resolve) => setTimeout(resolve, 450));
  return true;
}

interface PageSourceProbe {
  ok: boolean;
  html?: string;
  finalUrl?: string;
  status?: number;
  mime?: string;
  error?: string;
}

/** El HTML SSR debe pedirse desde la página para enviar sus cookies HttpOnly. */
async function fetchSourceInPage(tabId: number, url: string, maxBytes: number): Promise<PageSourceProbe | null> {
  if (!ext.scripting?.executeScript) return null;
  try {
    const result = (await ext.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (targetUrl: string, limit: number) => {
        try {
          const response = await fetch(targetUrl, {
            method: 'GET',
            credentials: 'include',
            redirect: 'follow',
            cache: 'no-store',
            headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
          });
          if (!response.ok) return { ok: false, status: response.status, error: `HTTP ${response.status}` };
          const mime = (response.headers.get('content-type') || '').toLowerCase();
          const buffer = await response.arrayBuffer();
          if (buffer.byteLength > limit) return { ok: false, status: response.status, error: 'HTML mayor que el límite' };
          if (mime && !/html|xml/.test(mime)) return { ok: false, status: response.status, error: `contenido no HTML (${mime})` };
          const html = new TextDecoder().decode(buffer);
          if (!html.trim()) return { ok: false, status: response.status, error: 'HTML vacío' };
          return { ok: true, html, finalUrl: response.url || targetUrl, status: response.status, mime };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
      args: [url, maxBytes],
    })) as Array<{ result?: PageSourceProbe }>;
    return result?.[0]?.result ?? null;
  } catch {
    return null;
  }
}

/** Inicia una sesión interactiva: el usuario navega e interactúa y luego finaliza. */
async function startFullCapture(
  tabId: number,
  options?: Partial<CaptureOptions>,
  sessionCookie?: string,
): Promise<unknown> {
  const state = getState(tabId);
  if (state.busy || state.recording || state.full) throw new Error('Ya hay una operación en curso en esta pestaña');
  const sessionId = newId('full');

  let introducedCookies = 0;
  if (sessionCookie?.trim()) {
    state.progress = { phase: 'analyzing', message: 'Aplicando la sesión y recargando la página', percent: 1 };
    const tab = await ext.tabs.get(tabId);
    const pageUrl = tab.url ?? '';
    if (!/^https?:\/\//i.test(pageUrl)) throw new Error('La pestaña actual no admite cookies de sesión');
    const applied = await applySessionCookies(tabId, sessionCookie, pageUrl);
    introducedCookies = applied.count;
    const reloaded = await reloadTabAndWait(tabId);
    if (!reloaded) throw new Error('La página no terminó de recargar tras aplicar la sesión');
  }

  const merged: CaptureOptions = {
    ...DEFAULT_CAPTURE_OPTIONS,
    ...(options ?? {}),
    dynamic: true,
    captureNetwork: true,
    keepScripts: true,
    fullSession: true,
    captureStorage: true,
    // El Clon Completo debe capturar la sesión que el usuario ve en la
    // pestaña, incluso si ya estaba autenticado antes de abrir el popup.
    includeCredentials: true,
    settleMs: 0,
  };
  await ensureContent(tabId);
  const hooksInstalled = await installPageHooks(tabId);
  if (!hooksInstalled) throw new Error('Este navegador no permite instalar los hooks de red en la página');
  const response = await ext.tabs.sendMessage(tabId, { type: 'WC_START_FULL', sessionId, options: merged }, { frameId: 0 });
  if (!response?.ok) throw new Error(response?.error ?? 'el content script rechazó el Clon Completo');
  drafts.set(sessionId, {
    sessionId,
    tabId,
    kind: 'clone',
    startedAt: Date.now(),
    options: merged,
    assetCount: 0,
    assetBytes: 0,
    assetPaths: [],
    networkSeen: [],
  });
  state.sessionId = sessionId;
  state.kind = 'clone';
  state.full = true;
  state.fullRequests = 0;
  state.busy = false;
  state.startedAt = Date.now();
  state.progress = { phase: 'analyzing', message: 'Clon Completo activo: interactúa con la página y pulsa Finalizar', percent: 0 };
  await setBadge(tabId, 'FULL');
  return { ok: true, sessionId, hooksInstalled, sessionCookies: introducedCookies };
}

async function stopFullCapture(tabId: number): Promise<unknown> {
  const state = getState(tabId);
  if (!state.full) throw new Error('No hay un Clon Completo activo en esta pestaña');
  state.busy = true;
  state.full = false;
  state.progress = { phase: 'analyzing', message: 'Reconstruyendo el clon completo', percent: 5 };
  try {
    const response = await ext.tabs.sendMessage(tabId, { type: 'WC_STOP_FULL' }, { frameId: 0 });
    if (!response?.ok) throw new Error(response?.error ?? 'no se pudo finalizar el Clon Completo');
    return response;
  } catch (error) {
    state.busy = false;
    state.progress = { phase: 'error', message: error instanceof Error ? error.message : String(error), percent: 0 };
    await setBadge(tabId, '');
    throw error;
  }
}

interface ResolveRequest {
  url: string;
  kind: string;
  inline?: boolean;
  network?: {
    method: string;
    status: number;
    mime: string;
    resourceType: string;
    bodyBase64?: string;
  };
}

interface DownloadedAsset {
  url: string;
  kind: AssetKind;
  mime: string;
  data: Uint8Array;
}

interface CapturedNetworkMeta {
  url: string;
  method: string;
  status: number;
  mime: string;
  resourceType: string;
  requestBodyBase64?: string;
  requestMime?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  bodyBase64?: string;
  id?: string;
  t?: number;
}

/** Texto legible para decidir si una respuesta se puede incrustar en el manifiesto. */
function isTextMime(mime: string, url: string): boolean {
  if (/json|text|javascript|ecmascript|xml|graphql|svg/i.test(mime)) return true;
  return /\.(json|js|mjs|css|txt|xml|svg|html?)$/i.test(url);
}

/**
 * Resolución de recursos del clon dinámico:
 *  - descarga todo en paralelo y deduplica por contenido;
 *  - reescribe los imports de los módulos para que apunten al paquete;
 *  - guarda los cuerpos de fetch/XHR y devuelve el manifiesto de red.
 */
async function resolveAssetsDynamic(
  sessionId: string,
  requests: ResolveRequest[],
  merged: CaptureOptions,
  capturedNetwork?: CapturedNetworkMeta[],
): Promise<unknown> {
  const draft = drafts.get(sessionId);
  const assets: AssetDescriptor[] = [];
  const failures: FailedResource[] = [];
  const map: Record<string, string> = {};
  const cssTexts: Record<string, string> = {};
  const network: CapturedNetworkEntry[] = [];

  const fail = (url: string, kind: AssetDescriptor['kind'], reason: string, restriction: string, alternative: string): void => {
    failures.push({ url: sanitizeUrlForReport(url), kind, reason, restriction, affectsFidelity: true, alternative });
  };

  if (!merged.captureAssets) {
    for (const request of requests) {
      fail(request.url, classifyAsset(request.url, request.kind), 'captura de recursos desactivada', 'opción captureAssets=false', 'Activar la captura de recursos en ajustes');
    }
    return { ok: true, assets, map, failures, cssTexts, totalBytes: 0, network };
  }

  // Deduplicar URLs para no descargar dos veces el mismo recurso.
  const unique: ResolveRequest[] = [];
  const seen = new Set<string>();
  for (const request of requests) {
    if (!request.url || seen.has(request.url)) continue;
    seen.add(request.url);
    unique.push(request);
    if (unique.length >= 5000) break;
  }

  const downloaded: DownloadedAsset[] = [];
  let cursor = 0;
  let totalBytes = 0;
  let limitReached = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= unique.length) return;
      const request = unique[index];
      if (limitReached || totalBytes >= merged.maxTotalAssetBytes) {
        limitReached = true;
        fail(request.url, classifyAsset(request.url, request.kind), 'límite total de recursos alcanzado', `> ${merged.maxTotalAssetBytes} bytes`, 'Aumentar el límite en ajustes');
        continue;
      }
      const result = await fetchAsset(request.url, {
        maxBytes: Math.min(merged.maxAssetBytes, Math.max(1, merged.maxTotalAssetBytes - totalBytes)),
        includeCredentials: merged.includeCredentials,
      });
      if (!result.ok || !result.data) {
        // Si el cuerpo llegó por los hooks (p. ej. POST), no se pierde la respuesta.
        if (request.network?.bodyBase64) continue;
        fail(
          request.url,
          classifyAsset(request.url, request.kind),
          result.reason ?? 'descarga fallida',
          result.restriction ?? 'desconocida',
          'El clon conserva la URL original; necesita conexión',
        );
        continue;
      }
      const kind = classifyAsset(request.url, request.kind);
      downloaded.push({
        url: request.url,
        kind,
        mime: result.mime ?? 'application/octet-stream',
        data: result.data,
      });
      totalBytes += result.data.byteLength;
    }
  };

  const downloadQueued = async (): Promise<void> => {
    cursor = 0;
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  };
  await downloadQueued();

  // Descubrimiento transitivo: los manifiestos de Vite/TanStack enumeran sus
  // chunks como literales ("assets/chunk.js") o imports con plantilla. Se
  // descargan también los perezosos para que rutas y diálogos funcionen offline.
  const ASSET_REFERENCE = /["'`]([^"'`\s]{1,320}?\.(?:js|mjs|css)(?:\?[^"'`\s]*)?)["'`]/g;
  for (let round = 0; round < 6; round++) {
    const additions: ResolveRequest[] = [];
    for (const item of downloaded) {
      if (item.kind !== 'js' && item.kind !== 'css') continue;
      let text: string;
      try {
        text = new TextDecoder().decode(item.data);
      } catch {
        continue;
      }
      const add = (abs: string | null): void => {
        if (!abs) return;
        // Un literal como assets/assets/x duplica la raíz; se normaliza.
        const normalized = abs.replace(/\/assets\/assets\//g, '/assets/');
        if (!/^https?:/i.test(normalized) || seen.has(normalized)) return;
        seen.add(normalized);
        additions.push({ url: normalized, kind: classifyAsset(normalized) });
      };
      ASSET_REFERENCE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = ASSET_REFERENCE.exec(text))) {
        const literal = match[1];
        if (!literal || /^(data|blob|about|javascript):/i.test(literal)) continue;
        const assetAt = literal.indexOf('assets/');
        if (assetAt >= 0) add(new URL('/' + literal.slice(assetAt), item.url).href);
        add(absolutize(literal, item.url));
      }
      // Los CSS cargados por JS también referencian fuentes e imágenes.
      if (item.kind === 'css') {
        for (const raw of collectCssUrls(text)) {
          if (raw.startsWith('#')) continue;
          add(absolutize(raw, item.url));
        }
        for (const imp of scanCss(text).imports) add(absolutize(imp.href, item.url));
      }
    }
    if (additions.length === 0) break;
    unique.push(...additions);
    await downloadQueued();
  }
  downloaded.sort((a, b) => a.url.localeCompare(b.url));

  // Rutas estables: los JS se nombran por URL (así la reescritura de imports
  // puede referenciarlos antes de conocer su hash final).
  const pathByUrl = new Map<string, string>();
  const shaToPath = new Map<string, string>();
  for (const item of downloaded) {
    let path: string;
    if (item.kind === 'js') {
      const ext = extensionFromMime(item.mime) === 'bin' ? 'js' : extensionFromMime(item.mime);
      path = `${assetDir('js')}/${shortHash(item.url)}.${ext}`;
    } else {
      const sha = (await sha256Hex(item.data)).slice(0, 20);
      const existing = shaToPath.get(sha);
      path = existing ?? `${assetDir(item.kind)}/${sha}.${extensionFromMime(item.mime)}`;
      if (!existing) shaToPath.set(sha, path);
    }
    if (!pathByUrl.has(item.url)) pathByUrl.set(item.url, path);
  }

  // Los CSS que Vite carga desde JS no pasan por el serializador de estilos:
  // se reescriben aquí para que sus fuentes e imágenes sean locales.
  for (const item of downloaded) {
    if (item.kind !== 'css') continue;
    let text: string;
    try {
      text = new TextDecoder().decode(item.data);
    } catch {
      continue;
    }
    const fromPath = pathByUrl.get(item.url) as string;
    const rewrittenCss = rewriteCssUrls(text, (raw) => {
      if (raw.startsWith('#')) return raw;
      const abs = absolutize(raw, item.url);
      const local = abs ? pathByUrl.get(abs) : null;
      if (!local) return raw;
      return merged.fullSession ? `/${local}` : relativePath(fromPath, local);
    });
    if (rewrittenCss !== text) item.data = new TextEncoder().encode(rewrittenCss);
  }

  // Reescritura de imports/workers dentro de los módulos descargados.
  for (const item of downloaded) {
    if (item.kind !== 'js') continue;
    const fromPath = pathByUrl.get(item.url) as string;
    let text: string;
    try {
      text = new TextDecoder().decode(item.data);
    } catch {
      continue;
    }
    const localFor = (abs: string): string | null => pathByUrl.get(abs) ?? null;
    // Los import() pueden ser absolutos (/assets/...). Los mapDeps de Vite, en
    // cambio, pasan por un helper que ya antepone '/': deben ser assets/...
    // (sin slash) o se convertirían en //assets/... (host inválido).
    const specifierFor = (local: string): string =>
      merged.fullSession ? `/${local}` : relativePath(fromPath, local);
    const literalFor = (local: string): string =>
      merged.fullSession ? local : relativePath(fromPath, local);
    const rewritten = rewriteJsSpecifiers(text, (specifier) => {
      if (!/^(?:\.{1,2}\/|\/|https?:)/i.test(specifier)) return null;
      const abs = absolutize(specifier, item.url);
      const local = abs ? localFor(abs) : null;
      return local ? specifierFor(local) : null;
    });
    // Los manifiestos de Vite/TanStack (__vite__mapDeps, preloads) usan
    // cadenas como "assets/chunk.js" en vez de import(). Hay que localizarlas
    // también o los chunks perezosos se piden al servidor original.
    const localized = rewriteJsStringLiterals(rewritten.code, (literal) => {
      if (!/^(?:\.{1,2}\/|\/|assets\/|https?:)/i.test(literal)) return null;
      const assetAt = literal.indexOf('assets/');
      const candidates = assetAt >= 0
        ? [new URL('/' + literal.slice(assetAt), item.url).href, absolutize(literal, item.url)]
        : [absolutize(literal, item.url)];
      for (const abs of candidates) {
        if (!abs) continue;
        const local = localFor(abs);
        if (local) return literalFor(local);
      }
      return null;
    });
    if (rewritten.rewritten > 0 || localized.rewritten > 0) {
      item.data = new TextEncoder().encode(localized.code);
      item.mime = 'text/javascript';
    }
  }

  // Funciones de servidor de TanStack Start: los chunks contienen URLs
  // /_serverFn/<hash> que el router puede invocar al hidratar. Son GET
  // públicos y deterministas; se capturan ahora para que el clon no reciba
  // un 404 del servidor local.
  if (merged.fullSession) {
    const serverFns = new Map<string, string>();
    for (const item of downloaded) {
      if (item.kind !== 'js') continue;
      let text: string;
      try {
        text = new TextDecoder().decode(item.data);
      } catch {
        continue;
      }
      for (const match of text.matchAll(/\/_serverFn\/[a-f0-9]{32,}/g)) {
        try {
          serverFns.set(new URL(match[0], item.url).href, item.url);
        } catch {
          /* URL inválida */
        }
      }
      // TanStack crea la URL como `/_serverFn/` + id; el id aparece solo en
      // handler(`<hash>`). Se recogen los identificadores de 64 hex del chunk.
      for (const match of text.matchAll(/\b[a-f0-9]{64}\b/g)) {
        try {
          serverFns.set(new URL(`/_serverFn/${match[0]}`, item.url).href, item.url);
        } catch {
          /* URL inválida */
        }
      }
    }
    const serverFnUrls = Array.from(serverFns.keys());
    const probes = draft?.tabId ? await fetchServerFnsInPage(draft.tabId, serverFnUrls) : [];
    for (const probe of probes) {
      if (!probe.ok || !probe.bodyBase64) continue;
      if (network.some((entry) => entry.url === probe.url)) continue;
      network.push({
        url: probe.url,
        method: 'GET',
        status: probe.status,
        mime: probe.mime || 'application/json',
        resourceType: 'fetch',
        responseHeaders: { 'content-type': probe.mime || 'application/json', 'x-tss-serialized': 'true' },
        bodyBase64: probe.bodyBase64,
        captured: true,
      });
    }
  }

  const pending = new Map<string, { path: string; data: ArrayBuffer; mime: string }>();
  for (const item of downloaded) {
    const path = pathByUrl.get(item.url) as string;
    map[item.url] = path;
    const sha = (await sha256Hex(item.data)).slice(0, 20);
    assets.push({
      path,
      url: sanitizeUrlForReport(item.url),
      kind: item.kind,
      mime: item.mime,
      bytes: item.data.byteLength,
      sha256: sha,
      status: 'captured',
      affectsFidelity: false,
    });
    if (item.kind === 'css') cssTexts[path] = new TextDecoder().decode(item.data);
    if (pending.has(path)) continue;
    pending.set(path, {
      path,
      data: item.data.buffer.slice(item.data.byteOffset, item.data.byteOffset + item.data.byteLength) as ArrayBuffer,
      mime: item.mime,
    });
  }

  // Cuerpos de red: se procesan todas las ocurrencias, no solo una por URL.
  // Así se pueden reproducir peticiones repetidas y variantes POST con distinto cuerpo.
  const downloadedByUrl = new Map(downloaded.map((item) => [item.url, item]));
  const networkSource: CapturedNetworkMeta[] = [];
  if (capturedNetwork && capturedNetwork.length > 0) {
    for (const item of capturedNetwork) {
      if (!item || !item.url) continue;
      const type = String(item.resourceType || '').toLowerCase();
      // Resource Timing incluye imágenes, CSS y frames; el runtime solo necesita
      // APIs. Un POST/XHR se conserva aunque su tipo sea "other".
      if (!/^(fetch|xhr|xmlhttprequest|beacon|ping)$/.test(type) && /^GET$/i.test(item.method || 'GET')) continue;
      networkSource.push(item);
    }
  } else {
    for (const request of unique) {
      if (request.network) networkSource.push({ url: request.url, ...request.network });
    }
  }
  let inlineBytes = 0;
  for (const meta of networkSource) {
    const item = downloadedByUrl.get(meta.url);
    let body: Uint8Array | undefined;
    if (meta.bodyBase64 !== undefined) {
      try {
        body = base64ToBytes(meta.bodyBase64);
      } catch {
        body = undefined;
      }
    }
    if (body === undefined && item && (!meta.method || /^GET$/i.test(meta.method))) body = item.data;
    const mime = meta.mime || item?.mime || 'application/octet-stream';
    let bodyBase64: string | undefined;
    let bodyPath: string | undefined;
    if (body !== undefined) {
      if (isTextMime(mime, meta.url) && body.byteLength <= 512 * 1024 && inlineBytes + body.byteLength <= 8 * 1024 * 1024) {
        bodyBase64 = bytesToBase64(body);
        inlineBytes += body.byteLength;
      } else {
        const sha = (await sha256Hex(body)).slice(0, 20);
        const ext = extensionFromMime(mime);
        bodyPath = `assets/network/${sha}.${ext}`;
        if (!pending.has(bodyPath)) {
          pending.set(bodyPath, {
            path: bodyPath,
            data: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
            mime,
          });
          totalBytes += body.byteLength;
        }
        if (!map[meta.url]) map[meta.url] = bodyPath;
      }
    }
    network.push({
      id: (meta as { id?: string }).id,
      t: (meta as { t?: number }).t,
      url: meta.url,
      method: (meta.method || 'GET').toUpperCase(),
      status: meta.status || (item ? 200 : 0),
      mime,
      resourceType: meta.resourceType || 'other',
      requestBodyBase64: meta.requestBodyBase64,
      requestMime: meta.requestMime,
      requestHeaders: meta.requestHeaders,
      responseHeaders: meta.responseHeaders,
      bodyBase64,
      bodyPath,
      captured: body !== undefined || meta.status === 204 || meta.status === 205 || meta.status === 304,
      note: body !== undefined ? undefined : 'respuesta sin cuerpo reproducible (p. ej. POST no observado)',
    });
  }

  await store.saveAssets(sessionId, Array.from(pending.values()));
  if (draft) {
    draft.assetCount += assets.length;
    draft.assetBytes += totalBytes;
    draft.assetPaths.push(...pending.keys());
  }
  return { ok: true, assets, map, failures, cssTexts, totalBytes, network };
}

async function fetchSourceHtml(url: string, options: Partial<CaptureOptions>, tabId?: number): Promise<unknown> {
  const merged: CaptureOptions = { ...DEFAULT_CAPTURE_OPTIONS, ...(options ?? {}) };
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'solo se puede obtener HTML de URLs http(s)' };
  if (merged.fullSession && tabId) {
    const pageSource = await fetchSourceInPage(tabId, url, merged.maxAssetBytes);
    if (pageSource?.ok) return pageSource;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: merged.includeCredentials ? 'include' : 'omit',
      redirect: 'follow',
      cache: 'default',
      headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    const mime = (response.headers.get('content-type') || '').toLowerCase();
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > merged.maxAssetBytes) {
      return { ok: false, status: response.status, error: `HTML mayor que el límite (${buffer.byteLength} bytes)` };
    }
    if (mime && !/html|xml/.test(mime)) {
      return { ok: false, status: response.status, error: `contenido no HTML (${mime})` };
    }
    const html = new TextDecoder().decode(buffer);
    if (!html.trim()) return { ok: false, status: response.status, error: 'HTML vacío' };
    return { ok: true, html, finalUrl: response.url || url, status: response.status, mime };
  } catch (error) {
    const aborted = (error as Error)?.name === 'AbortError';
    return { ok: false, error: aborted ? 'timeout al obtener el HTML original' : String((error as Error)?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveAssets(
  sessionId: string,
  requests: ResolveRequest[],
  options: Partial<CaptureOptions>,
  network?: unknown[],
): Promise<unknown> {
  const merged: CaptureOptions = { ...DEFAULT_CAPTURE_OPTIONS, ...(options ?? {}) };
  if (merged.dynamic) return resolveAssetsDynamic(sessionId, requests, merged, network as CapturedNetworkMeta[]);
  const draft = drafts.get(sessionId);
  const assets: AssetDescriptor[] = [];
  const failures: FailedResource[] = [];
  const map: Record<string, string> = {};
  const cssTexts: Record<string, string> = {};
  const hashToPath = new Map<string, string>();
  const pending: { path: string; data: ArrayBuffer; mime: string }[] = [];
  let totalBytes = 0;
  let cursor = 0;
  let limitReached = false;

  const record = (path: string, url: string, kind: AssetDescriptor['kind'], mime: string, bytes: number, sha: string) => {
    assets.push({
      path,
      url: sanitizeUrlForReport(url),
      kind,
      mime,
      bytes,
      sha256: sha,
      status: 'captured',
      affectsFidelity: false,
    });
  };

  const fail = (url: string, kind: AssetDescriptor['kind'], reason: string, restriction: string, alternative: string) => {
    failures.push({ url: sanitizeUrlForReport(url), kind, reason, restriction, affectsFidelity: true, alternative });
  };

  if (!merged.captureAssets) {
    for (const request of requests) fail(request.url, classifyAsset(request.url, request.kind), 'captura de recursos desactivada', 'opción captureAssets=false', 'Activar la captura de recursos en ajustes');
    return { ok: true, assets, map, failures, cssTexts, totalBytes };
  }

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= requests.length) return;
      const request = requests[index];
      if (limitReached) {
        fail(request.url, classifyAsset(request.url, request.kind), 'límite total de recursos alcanzado', `> ${merged.maxTotalAssetBytes} bytes`, 'Aumentar el límite en ajustes o exportar por partes');
        continue;
      }
      if (totalBytes >= merged.maxTotalAssetBytes) {
        limitReached = true;
        fail(request.url, classifyAsset(request.url, request.kind), 'límite total de recursos alcanzado', `> ${merged.maxTotalAssetBytes} bytes`, 'Aumentar el límite en ajustes');
        continue;
      }
      const result = await fetchAsset(request.url, {
        maxBytes: Math.min(merged.maxAssetBytes, Math.max(1, merged.maxTotalAssetBytes - totalBytes)),
        includeCredentials: merged.includeCredentials,
      });
      if (!result.ok || !result.data) {
        fail(
          request.url,
          classifyAsset(request.url, request.kind),
          result.reason ?? 'descarga fallida',
          result.restriction ?? 'desconocida',
          classifyAsset(request.url, request.kind) === 'image' ? 'El clon conserva la URL original; necesita conexión' : 'Recurso omitido; ver informe',
        );
        continue;
      }
      const sha = (await sha256Hex(result.data)).slice(0, 20);
      const kind = classifyAsset(request.url, request.kind);
      const existing = hashToPath.get(sha);
      if (existing) {
        map[request.url] = existing;
        record(existing, request.url, kind, result.mime ?? 'application/octet-stream', result.data.byteLength, sha);
        continue;
      }
      const extName = extensionFromMime(result.mime ?? 'application/octet-stream');
      const path = `${assetDir(kind)}/${sha}.${extName}`;
      hashToPath.set(sha, path);
      map[request.url] = path;
      pending.push({
        path,
        data: result.data.buffer.slice(result.data.byteOffset, result.data.byteOffset + result.data.byteLength) as ArrayBuffer,
        mime: result.mime ?? 'application/octet-stream',
      });
      totalBytes += result.data.byteLength;
      record(path, request.url, kind, result.mime ?? 'application/octet-stream', result.data.byteLength, sha);
      if (kind === 'css') cssTexts[path] = new TextDecoder().decode(result.data);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await store.saveAssets(sessionId, pending);
  if (draft) {
    draft.assetCount += assets.length;
    draft.assetBytes += totalBytes;
    draft.assetPaths.push(...pending.map((p) => p.path));
  } else {
    await store.saveAssets(sessionId, []);
  }
  return { ok: true, assets, map, failures, cssTexts, totalBytes };
}

async function captureScreenshot(tabId: number): Promise<{ dataUrl: string; width: number; height: number } | undefined> {
  try {
    const tab = await ext.tabs.get(tabId);
    const active = await ext.tabs.query({ active: true, windowId: tab.windowId });
    if (!active?.[0] || active[0].id !== tabId) return undefined;
    const dataUrl = await ext.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    if (!dataUrl) return undefined;
    return { dataUrl, width: tab.width ?? 0, height: tab.height ?? 0 };
  } catch {
    return undefined;
  }
}

async function saveClone(message: {
  sessionId: string;
  html: string;
  state: unknown;
  report: CaptureReport;
  extraFiles: { path: string; text: string }[];
  network?: CapturedNetworkEntry[];
}, senderTabId?: number): Promise<unknown> {
  const draft = drafts.get(message.sessionId);
  const tabId = draft?.tabId ?? senderTabId;
  const report = message.report;
  if (!report) throw new Error('informe de captura ausente');
  const fingerprint = (await sha256Hex(new TextEncoder().encode(message.html ?? ''))).slice(0, 16);
  const sessionMeta: SessionMeta = {
    id: message.sessionId,
    kind: 'clone',
    url: report.url,
    title: report.title,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    durationMs: report.durationMs,
    eventCount: 0,
    assetCount: report.counts.assetsCaptured,
    assetBytes: report.bytes.assets,
    status: report.failures.length > 0 ? 'partial' : 'complete',
    integrity: message.html && message.html.length > 200 ? 'ok' : 'broken',
    errorCount: report.failures.length,
    fingerprint,
  };
  const screenshot = tabId ? await captureScreenshot(tabId) : undefined;
  await store.saveSession({
    id: message.sessionId,
    kind: 'clone',
    meta: sessionMeta,
    report,
    html: message.html,
    state: message.state as never,
    extraFiles: message.extraFiles ?? [],
    assetPaths: draft?.assetPaths ?? [],
    network: message.network ?? [],
    screenshot,
  });
  if (tabId) {
    const state = getState(tabId);
    state.busy = false;
    state.full = false;
    state.fullRequests = 0;
    state.progress = { phase: 'done', message: 'Clon completado', percent: 100 };
    state.sessionId = message.sessionId;
    await setBadge(tabId, '');
  }
  if (draft) drafts.delete(message.sessionId);
  return { ok: true, sessionId: message.sessionId };
}

// ---------------------------------------------------------------- grabación

async function startRecording(tabId: number, options?: Partial<RecordingOptions>): Promise<unknown> {
  const state = getState(tabId);
  if (state.recording || state.busy || state.full) throw new Error('Ya hay una operación en curso en esta pestaña');
  const sessionId = newId('rec');
  const merged: RecordingOptions = { ...DEFAULT_RECORDING_OPTIONS, ...(options ?? {}) };
  drafts.set(sessionId, {
    sessionId,
    tabId,
    kind: 'recording',
    startedAt: Date.now(),
    options: merged,
    assetCount: 0,
    assetBytes: 0,
    assetPaths: [],
    networkSeen: [],
  });
  await ensureContent(tabId);
  const hooksInstalled = await installPageHooks(tabId);
  const response = await ext.tabs.sendMessage(tabId, { type: 'WC_START_RECORDING', sessionId, options: merged }, { frameId: 0 });
  if (!response?.ok) throw new Error(response?.error ?? 'no se pudo iniciar la grabación');
  state.recording = true;
  state.sessionId = sessionId;
  state.kind = 'recording';
  state.startedAt = Date.now();
  state.eventCount = 0;
  state.assetBytes = 0;
  state.seq = 0;
  state.progress = { phase: 'analyzing', message: hooksInstalled ? 'Grabando (hooks de red activos)' : 'Grabando (sin hooks de red: navegador sin soporte)', percent: 2 };
  await setBadge(tabId, 'REC');
  return { ok: true, sessionId, hooksInstalled };
}

async function appendRecordingChunk(sessionId: string, events: unknown[], tabId: number): Promise<unknown> {
  const state = getState(tabId);
  state.seq = await store.appendEvents(sessionId, events, state.seq);
  state.eventCount += events.length;
  return { ok: true };
}

function buildRecordingReport(meta: RecordingMeta, sessionId: string, report: CaptureReport): CaptureReport {
  void meta;
  return { ...report, sessionId };
}

async function saveRecording(message: {
  sessionId: string;
  events: unknown[];
  report: CaptureReport;
  recordingMeta: RecordingMeta;
}): Promise<unknown> {
  const draft = drafts.get(message.sessionId);
  const tabId = draft?.tabId ?? -1;
  const events = message.events as RrwebEvent[];
  await store.clearEvents(message.sessionId); // los chunks ya están duplicados en `events`
  await store.appendEvents(message.sessionId, events, 0);

  const meta = message.recordingMeta;
  const startedAt = Date.parse(meta.startedAt) || Date.now();
  const endedAt = Date.parse(meta.endedAt ?? new Date().toISOString()) || Date.now();
  const timeline: Timeline = buildTimeline(events, {
    startedAt,
    endedAt,
    durationMs: meta.durationMs,
    navigations: meta.navigations,
    errors: meta.errors,
    console: meta.console,
    network: meta.network,
  });
  const screenshot = tabId >= 0 ? await captureScreenshot(tabId) : undefined;
  const sessionMeta: SessionMeta = {
    id: message.sessionId,
    kind: 'recording',
    url: meta.url,
    title: meta.title || 'Grabación sin título',
    createdAt: meta.startedAt,
    updatedAt: new Date().toISOString(),
    durationMs: meta.durationMs,
    eventCount: events.length,
    assetCount: meta.assetCount,
    assetBytes: meta.assetBytes,
    status: meta.errors.length > 0 ? 'partial' : 'complete',
    integrity: events.length > 1 && timeline.durationMs >= 0 ? 'ok' : 'broken',
    errorCount: meta.errors.length,
    fingerprint: (await sha256Hex(new TextEncoder().encode(`${meta.url}|${meta.startedAt}|${events.length}`))).slice(0, 16),
  };
  const report = buildRecordingReport(meta, message.sessionId, message.report);
  await store.saveSession({
    id: message.sessionId,
    kind: 'recording',
    meta: sessionMeta,
    report,
    recordingMeta: meta,
    timeline,
    assetPaths: draft?.assetPaths ?? [],
    screenshot,
  });
  if (draft) {
    const state = getState(draft.tabId);
    state.busy = false;
    state.recording = false;
    state.progress = { phase: 'done', message: 'Grabación guardada', percent: 100 };
    state.eventCount = events.length;
    await setBadge(draft.tabId, '');
    drafts.delete(message.sessionId);
  }
  return { ok: true, sessionId: message.sessionId, eventCount: events.length };
}

async function stopRecording(tabId: number): Promise<unknown> {
  const state = getState(tabId);
  if (!state.recording) throw new Error('No hay grabación activa en esta pestaña');
  state.busy = true;
  state.progress = { phase: 'assets', message: 'Deteniendo grabación', percent: 10 };
  const response = await ext.tabs.sendMessage(tabId, { type: 'WC_STOP_RECORDING' }, { frameId: 0 });
  if (!response?.ok) {
    state.busy = false;
    state.recording = false;
    await setBadge(tabId, '');
    throw new Error(response?.error ?? 'no se pudo detener la grabación');
  }
  state.recording = false;
  return response;
}

async function finalizeInterruptedRecording(tabId: number, state: TabState): Promise<void> {
  if (!state.sessionId) return;
  const events = (await store.readEvents(state.sessionId)) as RrwebEvent[];
  if (events.length === 0) return;
  const now = Date.now();
  const startedAt = state.startedAt ?? now;
  const timeline = buildTimeline(events, { startedAt, endedAt: now });
  const syntheticReport: CaptureReport = {
    version: 1,
    sessionId: state.sessionId,
    kind: 'recording',
    url: '',
    title: 'Grabación interrumpida',
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(now).toISOString(),
    durationMs: now - startedAt,
    browser: { name: 'desconocido', version: '', userAgent: '' },
    viewport: { width: 0, height: 0, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    counts: { elements: 0, shadowRoots: 0, iframes: 0, framesCaptured: 0, stylesheets: 0, stylesheetsInlined: 0, assetsCaptured: 0, assetsFailed: 0, canvases: 0, canvasesUnsupported: 0, media: 0, mediaCaptured: 0, forms: 0, scriptsStripped: 0 },
    bytes: { html: 0, assets: state.assetBytes, total: state.assetBytes },
    fidelity: { resourceScore: 0, assetTotal: 0, assetCaptured: 0, notes: ['Grabación cerrada antes de finalizar; los recursos pueden faltar.'] },
    failures: [],
    unsupported: [],
    options: { ...DEFAULT_CAPTURE_OPTIONS },
  };
  const sessionMeta: SessionMeta = {
    id: state.sessionId,
    kind: 'recording',
    url: '',
    title: 'Grabación interrumpida',
    createdAt: new Date(startedAt).toISOString(),
    updatedAt: new Date(now).toISOString(),
    durationMs: now - startedAt,
    eventCount: events.length,
    assetCount: state.assetBytes,
    assetBytes: state.assetBytes,
    status: 'partial',
    integrity: 'unknown',
    errorCount: 1,
    fingerprint: (await sha256Hex(new TextEncoder().encode(state.sessionId))).slice(0, 16),
  };
  await store.saveSession({
    id: state.sessionId,
    kind: 'recording',
    meta: sessionMeta,
    report: syntheticReport,
    recordingMeta: {
      id: state.sessionId,
      url: '',
      title: 'Grabación interrumpida',
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(now).toISOString(),
      durationMs: now - startedAt,
      eventCount: events.length,
      assetCount: 0,
      assetBytes: state.assetBytes,
      errors: [{ t: now, type: 'error', message: 'La pestaña se cerró durante la grabación' }],
      navigations: [],
      network: [],
      console: [],
      options: { ...DEFAULT_RECORDING_OPTIONS },
    },
    timeline,
    assetPaths: [],
  });
}

// ------------------------------------------------------------ exportación

async function exportSession(sessionId: string): Promise<unknown> {
  const record = await store.getSession(sessionId);
  if (!record) throw new Error('Sesión no encontrada');
  const assetRecords = await store.listAssets(sessionId);
  let playerBundle: string | undefined;
  try {
    const response = await fetch(ext.runtime.getURL('vendor/wc-replay.js'));
    if (response.ok) playerBundle = await response.text();
  } catch {
    playerBundle = undefined;
  }
  const events = record.kind === 'recording' ? ((await store.readEvents(sessionId)) as RrwebEvent[]) : undefined;
  const files = await buildExportFiles({
    session: record.meta,
    kind: record.kind,
    report: record.report,
    html: record.html,
    state: record.state,
    events,
    recordingMeta: record.recordingMeta,
    timeline: record.timeline,
    network: record.network,
    assets: assetRecords.map((asset) => ({ path: asset.path, data: new Uint8Array(asset.data) })),
    extraFiles: record.extraFiles,
    playerBundle,
    screenshot: record.screenshot,
    toolVersion: VERSION,
  });
  const zip = buildZip(files);
  const safeTitle = (record.meta.title || 'captura').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60).replace(/^-+|-+$/g, '') || 'captura';
  const filename = `webclone-${record.kind}-${safeTitle}-${new Date(record.meta.createdAt).toISOString().slice(0, 10)}.zip`;
  // Se transporta en base64: chrome.runtime.sendMessage serializa como JSON.
  return { ok: true, base64: bytesToBase64(zip), filename, size: zip.byteLength, entries: files.length };
}

async function importSession(name: string, dataBase64: string): Promise<unknown> {
  const bytes = base64ToBytes(dataBase64);
  const entries = readZip(bytes);
  const metadataRaw = entries.get('metadata.json');
  if (!metadataRaw) throw new Error('ZIP sin metadata.json: no parece una exportación de WebClone Ultimate');
  const metadata = JSON.parse(new TextDecoder().decode(metadataRaw)) as {
    tool?: { name?: string; version?: string };
    session?: { id?: string; kind?: SessionKind; url?: string; title?: string; createdAt?: string; durationMs?: number };
    files?: { path: string; sha256?: string }[];
  };
  if (metadata.tool?.name !== 'WebClone Ultimate') throw new Error('El ZIP no ha sido generado por WebClone Ultimate');

  // Verificación de integridad SHA-256 de cada entrada declarada.
  let mismatches = 0;
  for (const entry of metadata.files ?? []) {
    const data = entries.get(entry.path);
    if (!data || !entry.sha256) {
      mismatches++;
      continue;
    }
    const hash = await sha256Hex(data);
    if (hash !== entry.sha256) mismatches++;
  }

  const decoder = new TextDecoder();
  const kind: SessionKind = metadata.session?.kind === 'recording' ? 'recording' : 'clone';
  const id = newId('imp');
  const indexHtml = entries.get('index.html');
  const stateRaw = entries.get('snapshot/state.json');
  const reportRaw = entries.get('reports/capture-report.json');
  const report = reportRaw ? (JSON.parse(decoder.decode(reportRaw)) as CaptureReport) : null;
  const eventsRaw = entries.get('recording/events.json');
  const events = eventsRaw ? (JSON.parse(decoder.decode(eventsRaw)) as RrwebEvent[]) : [];
  const timelineRaw = entries.get('recording/timeline.json');
  const recordingMetaRaw = entries.get('recording/meta.json');

  const sessionMeta: SessionMeta = {
    id,
    kind,
    url: metadata.session?.url ?? '',
    title: metadata.session?.title ?? name,
    createdAt: metadata.session?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    durationMs: metadata.session?.durationMs ?? 0,
    eventCount: events.length,
    assetCount: Array.from(entries.keys()).filter((k) => k.startsWith('assets/')).length,
    assetBytes: Array.from(entries.entries()).filter(([k]) => k.startsWith('assets/')).reduce((acc, [, v]) => acc + v.byteLength, 0),
    status: 'complete',
    integrity: mismatches === 0 ? 'ok' : 'broken',
    errorCount: mismatches,
    fingerprint: (await sha256Hex(bytes)).slice(0, 16),
  };

  const assets = Array.from(entries.entries())
    .filter(([path]) => path.startsWith('assets/'))
    .map(([path, data]) => ({ path, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, mime: '' }));
  await store.saveAssets(id, assets);
  if (kind === 'recording') {
    await store.appendEvents(id, events, 0);
  }
  const importedExtraFiles = Array.from(entries.entries())
    .filter(([entryPath]) => entryPath.startsWith('snapshot/frames/'))
    .map(([entryPath, data]) => ({ path: entryPath, text: decoder.decode(data) }));

  await store.saveSession({
    id,
    kind,
    meta: sessionMeta,
    extraFiles: importedExtraFiles,
    report:
      report ??
      ({
        version: 1,
        sessionId: id,
        kind,
        url: sessionMeta.url,
        title: sessionMeta.title,
        startedAt: sessionMeta.createdAt,
        finishedAt: sessionMeta.createdAt,
        durationMs: sessionMeta.durationMs,
        browser: { name: 'importado', version: '', userAgent: '' },
        viewport: { width: 0, height: 0, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
        counts: { elements: 0, shadowRoots: 0, iframes: 0, framesCaptured: 0, stylesheets: 0, stylesheetsInlined: 0, assetsCaptured: sessionMeta.assetCount, assetsFailed: 0, canvases: 0, canvasesUnsupported: 0, media: 0, mediaCaptured: 0, forms: 0, scriptsStripped: 0 },
        bytes: { html: 0, assets: sessionMeta.assetBytes, total: sessionMeta.assetBytes },
        fidelity: { resourceScore: 0, assetTotal: 0, assetCaptured: 0, notes: ['Sesión importada sin informe de captura original'] },
        failures: [],
        unsupported: [],
        options: { ...DEFAULT_CAPTURE_OPTIONS },
      } satisfies CaptureReport),
    html: kind === 'clone' && indexHtml ? decoder.decode(indexHtml) : undefined,
    state: stateRaw ? (JSON.parse(decoder.decode(stateRaw)) as never) : undefined,
    recordingMeta: recordingMetaRaw ? (JSON.parse(decoder.decode(recordingMetaRaw)) as RecordingMeta) : undefined,
    timeline: timelineRaw ? (JSON.parse(decoder.decode(timelineRaw)) as Timeline) : undefined,
    assetPaths: Array.from(entries.keys()).filter((k) => k.startsWith('assets/')),
  });

  return { ok: true, id, integrity: mismatches === 0 ? 'ok' : 'broken', mismatches };
}

// ------------------------------------------------------------------ router

const recordingSessionTab = new Map<string, number>();

onRuntimeMessage(async (message: any, sender: any) => {
  const tabId: number | undefined = sender?.tab?.id;
  switch (message?.type) {
    case 'WC_STORAGE_INFO': {
      const info = await store.storageInfo();
      const sessions = await store.listSessions();
      return { ok: true, usage: info.usage, quota: info.quota, sessions: sessions.length };
    }
    case 'WC_SESSION_LIST':
      return { ok: true, sessions: await store.listSessions() };
    case 'WC_SESSION_GET': {
      const record = await store.getSession(message.id);
      if (!record) return { ok: false, error: 'Sesión no encontrada' };
      const events = record.kind === 'recording' ? await store.readEvents(message.id) : undefined;
      return {
        ok: true,
        session: {
          meta: record.meta,
          kind: record.kind,
          html: record.html,
          state: record.state,
          report: record.report,
          events,
          recordingMeta: record.recordingMeta,
          assetPaths: record.assetPaths,
          timeline: record.timeline,
        },
      };
    }
    case 'WC_SESSION_DELETE':
      await store.deleteSession(message.id);
      return { ok: true };
    case 'WC_SESSION_EXPORT':
      return exportSession(message.id);
    case 'WC_IMPORT_SESSION':
      return importSession(message.name, message.dataBase64);
    case 'WC_START_CAPTURE': {
      const target = message.tabId ?? tabId;
      if (!target) throw new Error('no se especificó pestaña');
      return startCapture(target, message.options);
    }
    case 'WC_START_FULL_CAPTURE': {
      const target = message.tabId ?? tabId;
      if (!target) throw new Error('no se especificó pestaña');
      return startFullCapture(target, message.options, message.sessionCookie);
    }
    case 'WC_STOP_FULL_CAPTURE': {
      const target = message.tabId ?? tabId;
      if (!target) throw new Error('no se especificó pestaña');
      return stopFullCapture(target);
    }
    case 'WC_FULL_STATS': {
      const target = tabId;
      if (target) {
        const state = getState(target);
        if (state.full) state.fullRequests = Number(message.count) || 0;
      }
      return { ok: true };
    }
    case 'WC_NETWORK_ENTRY': {
      const draft = drafts.get(message.sessionId) ?? Array.from(drafts.values()).find((item) => item.tabId === tabId && item.kind === 'clone');
      const entry = message.entry as CapturedNetworkMeta | undefined;
      if (draft && entry?.url) {
        if (!draft.networkEntries) draft.networkEntries = [];
        if (draft.networkEntries.length < 1200) draft.networkEntries.push(entry);
      }
      return { ok: true };
    }
    case 'WC_GET_NETWORK_CAPTURED': {
      const draft = drafts.get(message.sessionId);
      return { ok: true, entries: draft?.networkEntries ?? [] };
    }
    case 'WC_START_RECORD': {
      const target = message.tabId ?? tabId;
      if (!target) throw new Error('no se especificó pestaña');
      const result = (await startRecording(target, message.options)) as { sessionId?: string };
      if (result?.sessionId) recordingSessionTab.set(result.sessionId, target);
      return result;
    }
    case 'WC_STOP_RECORD': {
      const target = message.tabId ?? tabId;
      if (!target) throw new Error('no se especificó pestaña');
      return stopRecording(target);
    }
    case 'WC_GET_TAB_STATUS': {
      const target = message.tabId ?? tabId;
      const state = target ? getState(target) : undefined;
      if (target && state && !state.full && !state.busy && !state.recording) {
        try {
          const remote = await ext.tabs.sendMessage(target, { type: 'WC_FULL_STATE' }, { frameId: 0 });
          if (remote?.full && remote.sessionId) {
            state.full = true;
            state.sessionId = String(remote.sessionId);
            state.kind = 'clone';
            state.startedAt = Number(remote.startedAt) || Date.now();
            state.fullRequests = Number(remote.count) || 0;
            if (!drafts.has(state.sessionId)) {
              drafts.set(state.sessionId, {
                sessionId: state.sessionId,
                tabId: target,
                kind: 'clone',
                startedAt: state.startedAt,
                options: { ...DEFAULT_CAPTURE_OPTIONS, dynamic: true, captureNetwork: true, fullSession: true, captureStorage: true },
                assetCount: 0,
                assetBytes: 0,
                assetPaths: [],
                networkSeen: [],
              });
            }
          }
        } catch {
          /* content script no disponible */
        }
      }
      let url = '';
      let title = '';
      if (target) {
        try {
          const tab = await ext.tabs.get(target);
          url = tab.url ?? '';
          title = tab.title ?? '';
        } catch {
          /* ignore */
        }
      }
      return {
        ok: true,
        tabId: target,
        url,
        title,
        recording: !!state?.recording,
        full: !!state?.full,
        fullRequests: state?.fullRequests ?? 0,
        busy: !!state?.busy,
        sessionId: state?.sessionId,
        progress: state?.progress,
        eventCount: state?.eventCount ?? 0,
        elapsedMs: state?.startedAt ? Date.now() - state.startedAt : 0,
        assetBytes: state?.assetBytes ?? 0,
        error: state?.error,
      };
    }
    case 'WC_RESOLVE_ASSETS':
      return resolveAssets(message.sessionId, message.requests ?? [], message.options ?? {}, message.network);
    case 'WC_FETCH_SOURCE':
      return fetchSourceHtml(message.url, message.options ?? {}, tabId);
    case 'WC_GET_NETWORK_SEEN': {
      const draft = drafts.get(message.sessionId);
      return { ok: true, entries: draft?.networkSeen ?? [] };
    }
    case 'WC_SAVE_CLONE':
      return saveClone(message, tabId);
    case 'WC_RECORDING_CHUNK': {
      const target = recordingSessionTab.get(message.sessionId) ?? tabId ?? -1;
      return appendRecordingChunk(message.sessionId, message.events ?? [], target);
    }
    case 'WC_SAVE_RECORDING':
      return saveRecording(message);
    case 'WC_PROGRESS': {
      const target = tabId ?? (message.sessionId ? drafts.get(message.sessionId)?.tabId : undefined);
      if (target && message.progress) {
        const state = getState(target);
        state.progress = message.progress as CaptureProgress;
      }
      return { ok: true };
    }
    case 'WC_CAPTURE_FAILED': {
      const draft = drafts.get(message.sessionId);
      const target = draft?.tabId ?? tabId;
      if (target) {
        const state = getState(target);
        state.busy = false;
        state.recording = false;
        state.full = false;
        state.error = message.error;
        state.progress = { phase: 'error', message: message.error ?? 'error de captura', percent: 0 };
        await setBadge(target, '');
      }
      drafts.delete(message.sessionId);
      return { ok: true };
    }
    case 'WC_OPEN_REPLAY': {
      const url = ext.runtime.getURL(`replay/index.html?id=${encodeURIComponent(message.id)}`);
      await ext.tabs.create({ url });
      return { ok: true };
    }
    case 'WC_EXPORT_SESSION_TO_DOWNLOAD':
      return exportSession(message.id);
    case 'WC_CAPTURE_REPLAY_SCREENSHOT': {
      // Captura la pestaña del reproductor (debe estar activa).
      const target = tabId;
      if (!target) return { ok: false, error: 'sin pestaña' };
      try {
        const tab = await ext.tabs.get(target);
        const dataUrl = await ext.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        return { ok: true, dataUrl };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'WC_SW_INFO':
      return { ok: true, version: VERSION };
    case 'WC_CANCEL_CAPTURE': {
      const target = message.tabId ?? tabId;
      if (target) {
        const state = getState(target);
        state.busy = false;
        state.recording = false;
        state.full = false;
        await setBadge(target, '');
      }
      return { ok: true };
    }
    default:
      return { ok: false, error: `mensaje no soportado: ${message?.type}` };
  }
});

// Reengancha la sesión completa si el usuario navega a otro documento.
ext.tabs.onUpdated?.addListener((tabId: number, changeInfo: { status?: string }) => {
  if (changeInfo.status !== 'complete') return;
  const state = tabStates.get(tabId);
  if (!state?.full || !state.sessionId) return;
  const sessionId = state.sessionId;
  const startedAt = state.startedAt ?? Date.now();
  const options = drafts.get(sessionId)?.options ?? { ...DEFAULT_CAPTURE_OPTIONS, dynamic: true, captureNetwork: true, fullSession: true, captureStorage: true };
  void (async () => {
    await installPageHooks(tabId);
    await ext.tabs.sendMessage(tabId, { type: 'WC_FULL_ATTACH', sessionId, startedAt, options }, { frameId: 0 });
  })().catch(() => undefined);
});

ext.tabs.onRemoved.addListener((tabId: number) => {
  const state = tabStates.get(tabId);
  if (state?.recording && state.sessionId) {
    void finalizeInterruptedRecording(tabId, state).catch(() => undefined);
  }
  if (state?.recording) void setBadge(tabId, '');
  tabStates.delete(tabId);
});

ext.runtime.onInstalled.addListener(() => {
  void ext.action.setBadgeBackgroundColor({ color: '#7f1d1d' });
});
