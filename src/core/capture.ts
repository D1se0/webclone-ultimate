/**
 * Pipeline de Instant Clone en el content script.
 *
 * Dos modos:
 *  - Estático (compatibilidad): serializa el DOM vivo y elimina los scripts.
 *  - Dinámico (por defecto): parte del HTML original, conserva y ejecuta el JS de
 *    la página, captura las respuestas de red y las sirve desde el paquete para
 *    que la aplicación funcione sin conexión.
 *
 * Orquesta: escucha de red -> HTML fuente -> serialización -> resolución de
 * recursos (con pasadas adicionales para CSS) -> reescritura -> informe.
 */

import type {
  AssetDescriptor,
  CaptureCounts,
  CaptureOptions,
  CaptureReport,
  CapturedNetworkEntry,
  CapturedSessionState,
  FailedResource,
  PageState,
} from '../shared/types';
import { DEFAULT_CAPTURE_OPTIONS } from '../shared/types';
import type { AssetResolveRequest, AssetResolveResponse } from '../shared/messages';
import { absolutize, classifyAsset, isSameOrigin, relativePath, sanitizeUrlForReport } from '../shared/url';
import { collectCssUrls, replaceImports, rewriteCssUrls, scanCss } from '../shared/css';
import { rewriteJsSpecifiers, rewriteJsStringLiterals } from '../shared/js-rewrite';
import { detectBrowser } from '../shared/ext';
import { serializeDocument, type SerializeOutcome } from './serializer';
import { RUNTIME_HEAD_TOKEN, serializeSourceDocument, type SourceStyleBlock } from './source-serializer';
import { captureLiveState } from './state-capture';
import { detectHydrationFramework } from './framework';
import { sessionStateScript } from './session-state';
import { DYNAMIC_RUNTIME_JS } from './dynamic-runtime';
import { CLONE_BOOTSTRAP_JS } from './bootstrap';

export interface CloneResult {
  html: string;
  state: PageState;
  report: CaptureReport;
  extraFiles: { path: string; text: string }[];
  network: CapturedNetworkEntry[];
}

export interface SourceFetchResult {
  ok: boolean;
  html?: string;
  finalUrl?: string;
  status?: number;
  error?: string;
}

export interface NetworkSnapshotEntry {
  id?: string;
  t?: number;
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
  note?: string;
}

export interface CloneDeps {
  sessionId: string;
  options: Partial<CaptureOptions>;
  resolveAssets: (requests: AssetResolveRequest[], network?: NetworkSnapshotEntry[]) => Promise<AssetResolveResponse>;
  progress: (message: string, percent: number) => void;
  /** Descarga el HTML original (GET) desde el background. */
  fetchSource?: (url: string) => Promise<SourceFetchResult>;
  /** Journal de red de la página (hooks en MAIN world + Resource Timing). */
  network?: {
    arm: () => Promise<void>;
    snapshot: () => Promise<{ entries: NetworkSnapshotEntry[] }>;
  };
  /** Journal ya armado por una sesión completa; evita rearmar y esperar settle. */
  preArmedNetwork?: NetworkSnapshotEntry[];
  /** Estado de sesión (storage, ruta, interacciones) para un clon completo. */
  session?: CapturedSessionState;
  /** URLs observadas por webRequest en el background. */
  networkSeen?: () => Promise<{ url: string; method: string; resourceType: string }[]>;
}

interface Frame {
  path: string;
  html: string;
  url: string;
}

interface StyleBlock extends SourceStyleBlock {
  token: string;
}

interface JsBlock {
  token: string;
  code: string;
  baseUrl: string;
}

const escapeAttr = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const inlineJson = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

const API_TYPES = new Set(['fetch', 'xhr', 'xmlhttprequest', 'beacon', 'ping']);

function isApiResourceType(type: string | undefined): boolean {
  return API_TYPES.has((type || '').toLowerCase());
}

function buildCounts(outcome: SerializeOutcome): CaptureCounts {
  return { ...outcome.counts };
}

export function computeFidelity(
  captured: number,
  failed: FailedResource[],
  counts: CaptureCounts,
): { resourceScore: number; assetTotal: number; assetCaptured: number; notes: string[] } {
  const affecting = failed.filter((f) => f.affectsFidelity).length;
  const total = captured + affecting;
  const resourceScore = total === 0 ? 100 : Math.round((captured / total) * 100);
  const notes: string[] = [
    'Puntuación heurística basada en recursos capturados; NO es una comparación visual.',
  ];
  if (counts.canvasesUnsupported > 0) notes.push(`${counts.canvasesUnsupported} canvas sin contenido legible`);
  if (counts.iframes > counts.framesCaptured) notes.push(`${counts.iframes - counts.framesCaptured} iframes no serializados`);
  if ((counts.scriptsKept ?? 0) > 0) notes.push(`${counts.scriptsKept} scripts conservados y ejecutados (clon dinámico)`);
  if (counts.scriptsStripped > 0) notes.push(`${counts.scriptsStripped} scripts eliminados del clon (comportamiento estático)`);
  if ((counts.responsesCaptured ?? 0) > 0) notes.push(`${counts.responsesCaptured} respuestas de red reproducidas offline`);
  return { resourceScore, assetTotal: total, assetCaptured: captured, notes };
}

function stateScript(state: PageState): string {
  return `<script type="application/json" id="wc-page-state">${inlineJson(state)}</script>\n<script>${CLONE_BOOTSTRAP_JS}</script>`;
}

export async function captureInstantClone(doc: Document, deps: CloneDeps): Promise<CloneResult> {
  const options: CaptureOptions = { ...DEFAULT_CAPTURE_OPTIONS, ...deps.options };
  const startedAt = Date.now();
  const requestedDynamic = options.dynamic;
  // Un Clon Completo necesita la aplicación viva: no se degrada a una
  // instantánea estática aunque detecte React/Vue. Para Instant Clone se
  // mantiene la protección de hidratación.
  const framework = requestedDynamic && !options.forceDynamic && !options.fullSession ? detectHydrationFramework(doc) : null;
  const dynamic = requestedDynamic && !framework;
  const effectiveOptions: CaptureOptions = { ...options, dynamic };
  deps.progress(dynamic ? 'Preparando clon dinámico' : 'Serializando DOM', 3);

  // ---------------------------------------------------------- escucha de red
  let networkEntries: NetworkSnapshotEntry[] = [];
  if (dynamic && options.captureNetwork) {
    if (deps.preArmedNetwork) {
      networkEntries = deps.preArmedNetwork;
      deps.progress(`${networkEntries.length} peticiones de la sesión`, 5);
    } else {
      try {
        deps.progress('Activando escucha de red', 5);
        await deps.network?.arm();
      } catch {
        /* los hooks son opcionales */
      }
      await delay(options.settleMs);
      try {
        const snapshot = await deps.network?.snapshot();
        networkEntries = snapshot?.entries ?? [];
      } catch {
        networkEntries = [];
      }
    }
    try {
      const seen = await deps.networkSeen?.();
      for (const entry of seen ?? []) {
        if (!networkEntries.some((n) => n.url === entry.url && n.method === entry.method)) {
          networkEntries.push({
            url: entry.url,
            method: entry.method || 'GET',
            status: 0,
            mime: '',
            resourceType: entry.resourceType || 'other',
          });
        }
      }
    } catch {
      /* webRequest opcional */
    }
  }

  // ------------------------------------------------------------ HTML fuente
  let source: SourceFetchResult | null = null;
  if (dynamic && deps.fetchSource) {
    deps.progress('Obteniendo HTML original', 12);
    try {
      source = await deps.fetchSource(doc.URL);
    } catch (error) {
      source = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  const sourceOk = !!(dynamic && options.dynamicBase !== 'live' && source?.ok && source.html && source.html.trim().length > 0);
  if (framework) {
    deps.progress(`Hidratación detectada (${framework}); usando instantánea estática`, 24);
  }

  // -------------------------------------------------------- tokens y bloques
  const tokenByUrl = new Map<string, string>();
  const urlByToken = new Map<string, { url: string; kind: string }>();
  let tokenCounter = 0;

  const intern = (url: string, kind = ''): string => {
    const existing = tokenByUrl.get(url);
    if (existing) return existing;
    const token = `__WC_ASSET_${tokenCounter++}__`;
    tokenByUrl.set(url, token);
    urlByToken.set(token, { url, kind });
    return token;
  };

  const blocks: StyleBlock[] = [];
  const jsBlocks: JsBlock[] = [];
  const frames: Frame[] = [];

  const styleBlock = (block: SourceStyleBlock): string => {
    const token = `__WC_STYLE_${blocks.length}__`;
    blocks.push({ token, ...block });
    return token;
  };
  const jsInline = (code: string, baseUrl: string): string => {
    const token = `__WC_JS_${jsBlocks.length}__`;
    jsBlocks.push({ token, code, baseUrl });
    return token;
  };
  const registerFrame = (html: string, url: string): string => {
    const path = `snapshot/frames/frame-${frames.length + 1}.html`;
    frames.push({ path, html, url });
    return path;
  };

  const sharedDeps = {
    options,
    assetToken: (url: string, kindHint?: string) => intern(url, kindHint ?? ''),
    styleBlock,
    jsInline,
    registerFrame,
    // El serializador del DOM vivo también debe insertar el runtime de red.
    headPrefix: RUNTIME_HEAD_TOKEN,
  };

  // ---------------------------------------------------- serialización (árbol)
  deps.progress(sourceOk ? 'Serializando HTML original' : 'Serializando DOM vivo', 20);

  const serializeSourceTree = async (
    html: string,
    pageUrl: string,
    depth: number,
  ): Promise<{
    html: string;
    counts: CaptureCounts;
    failures: FailedResource[];
    unsupported: string[];
    assets: { url: string; kind: string }[];
  }> => {
    const framePaths = new Map<string, string>();
    if (options.captureFrames && depth < options.maxFrameDepth && deps.fetchSource) {
      let parsed: Document | null = null;
      try {
        parsed = new DOMParser().parseFromString(html, 'text/html');
      } catch {
        parsed = null;
      }
      if (parsed) {
        const urls: string[] = [];
        for (const frame of Array.from(parsed.querySelectorAll('iframe[src], frame[src]'))) {
          const raw = frame.getAttribute('src') || '';
          const abs = absolutize(raw, pageUrl);
          if (!abs || !/^https?:/i.test(abs) || urls.includes(abs)) continue;
          if (!isSameOrigin(abs, pageUrl)) continue;
          urls.push(abs);
        }
        for (const url of urls.slice(0, 24)) {
          try {
            const fetched = await deps.fetchSource(url);
            if (!fetched?.ok || !fetched.html) continue;
            const nested = await serializeSourceTree(fetched.html, fetched.finalUrl || url, depth + 1);
            framePaths.set(url, registerFrame(nested.html, url));
          } catch {
            /* frame no capturado */
          }
        }
      }
    }
    return serializeSourceDocument(html, {
      ...sharedDeps,
      pageUrl,
      framePath: (abs) => framePaths.get(abs) ?? null,
    });
  };

  let outcome: SerializeOutcome;
  let state: PageState;

  if (sourceOk && source?.html) {
    const tree = await serializeSourceTree(source.html, source.finalUrl || doc.URL, 0);
    outcome = {
      html: tree.html,
      state: captureLiveState(doc, { dynamic: true }),
      counts: tree.counts,
      failures: tree.failures,
      unsupported: tree.unsupported,
      frames: [],
      styleBlocks: [],
      assets: tree.assets,
    };
    state = outcome.state;
  } else {
    const serializeOptions: CaptureOptions = {
      ...effectiveOptions,
      keepScripts: dynamic,
      dynamic,
    };
    outcome = serializeDocument(doc, {
      ...sharedDeps,
      options: serializeOptions,
    });
    state = outcome.state;
    if (dynamic) {
      state.dynamic = true;
      if (source && !source.ok) {
        outcome.unsupported.push(
          `No se pudo obtener el HTML original (${source.error ?? `HTTP ${source.status ?? 0}`}); se serializó el DOM vivo. Los scripts pueden volver a aplicar mutaciones.`,
        );
      }
    }
  }

  // --------------------------------------- URLs de CSS inline y red observada
  for (const block of blocks) {
    if (block.external) continue;
    for (const raw of collectCssUrls(block.css)) {
      if (raw.startsWith('#')) continue;
      const abs = absolutize(raw, block.baseUrl);
      if (abs) intern(abs, classifyAsset(abs));
    }
    for (const imp of scanCss(block.css).imports) {
      const abs = absolutize(imp.href, block.baseUrl);
      if (abs) intern(abs, 'css');
    }
  }

  const networkByUrl = new Map<string, NetworkSnapshotEntry>();
  for (const entry of networkEntries) {
    if (!entry.url || /^(data|blob|about|javascript):/i.test(entry.url)) continue;
    if (!isApiResourceType(entry.resourceType)) continue;
    const existing = networkByUrl.get(entry.url);
    if (!existing || (!existing.bodyBase64 && entry.bodyBase64) || (!existing.status && entry.status)) {
      networkByUrl.set(entry.url, entry);
    }
    intern(entry.url, classifyAsset(entry.url));
  }
  for (const entry of networkEntries) {
    if (!entry.url || /^(data|blob|about|javascript):/i.test(entry.url)) continue;
    if (isApiResourceType(entry.resourceType)) continue;
    intern(entry.url, classifyAsset(entry.url));
  }

  // Los manifiestos SSR (TanStack/Vite) enumeran rutas perezosas solo como
  // literales dentro de scripts inline. Se registran para descargarlas y que
  // el router pueda navegar sin conexión.
  if (sourceOk && source?.html) {
    const jsRef = /["'`]([^"'`\s]{1,320}?\/assets\/[^"'`\s]+?\.(?:js|mjs|css)(?:\?[^"'`\s]*)?)["'`]/g;
    let match: RegExpExecArray | null;
    while ((match = jsRef.exec(source.html))) {
      const abs = absolutize(match[1], source.finalUrl || doc.URL);
      if (abs && /^https?:/i.test(abs)) intern(abs, classifyAsset(abs));
    }
  }

  deps.progress(`Resolviendo ${urlByToken.size} recursos`, 30);

  // ------------------------------------------------------ peticiones de assets
  const requests: AssetResolveRequest[] = [];
  const localUrls = new Map<string, string>();
  const earlyFailures: FailedResource[] = [];

  for (const [, entry] of urlByToken) {
    if (entry.url.startsWith('blob:')) {
      try {
        const response = await fetch(entry.url);
        const buffer = await response.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
        }
        const mime = response.headers.get('content-type') || 'application/octet-stream';
        localUrls.set(entry.url, `data:${mime};base64,${btoa(binary)}`);
      } catch {
        earlyFailures.push({
          url: sanitizeUrlForReport(entry.url),
          kind: classifyAsset(entry.url),
          reason: 'blob URL no accesible',
          restriction: 'blob de la página no exportable',
          affectsFidelity: true,
          alternative: 'Grabar la sesión con rrweb',
        });
      }
      continue;
    }
    const meta = networkByUrl.get(entry.url);
    requests.push({
      url: entry.url,
      kind: classifyAsset(entry.url, entry.kind || undefined),
      inline: entry.url.startsWith('data:'),
      network: meta
        ? {
            method: meta.method || 'GET',
            status: meta.status || 0,
            mime: meta.mime || '',
            resourceType: meta.resourceType || 'other',
            requestBodyBase64: meta.requestBodyBase64,
            requestMime: meta.requestMime,
            requestHeaders: meta.requestHeaders,
            responseHeaders: meta.responseHeaders,
            bodyBase64: meta.bodyBase64,
          }
        : undefined,
    });
  }

  // ---------------------------------------------------------- resolver assets
  const allFailures: FailedResource[] = [...earlyFailures, ...outcome.failures];
  const allAssets: AssetDescriptor[] = [];
  const allNetwork: CapturedNetworkEntry[] = [];
  const allCssTexts: Record<string, string> = {};
  let totalBytes = 0;
  let cssTexts: Record<string, string> = {};
  const attempted = new Set<string>();

  const applyBatch = (batch: AssetResolveResponse): void => {
    for (const [url, path] of Object.entries(batch.map ?? {})) localUrls.set(url, path);
    Object.assign(allCssTexts, batch.cssTexts ?? {});
    allFailures.push(...(batch.failures ?? []));
    allAssets.push(...(batch.assets ?? []));
    allNetwork.push(...(batch.network ?? []));
    totalBytes += batch.totalBytes ?? 0;
    cssTexts = { ...allCssTexts };
  };

  const firstRequests = requests.filter((request) => {
    if (attempted.has(request.url)) return false;
    attempted.add(request.url);
    return true;
  });
  applyBatch(await deps.resolveAssets(firstRequests, networkEntries));

  const localFor = (abs: string): string | null => localUrls.get(abs) ?? null;

  // Las hojas externas solo revelan sus url()/@import después de descargarlas.
  for (let round = 0; round < 3; round++) {
    const missing = new Map<string, string>();
    const registerCss = (text: string, baseUrl: string): void => {
      for (const raw of collectCssUrls(text)) {
        if (raw.startsWith('#')) continue;
        const abs = absolutize(raw, baseUrl);
        if (abs && !localFor(abs) && !attempted.has(abs)) missing.set(abs, classifyAsset(abs));
      }
      for (const imp of scanCss(text).imports) {
        const abs = absolutize(imp.href, baseUrl);
        if (abs && !localFor(abs) && !attempted.has(abs)) missing.set(abs, 'css');
      }
    };
    for (const block of blocks) {
      const local = localFor(block.baseUrl);
      const text = local ? allCssTexts[local] : undefined;
      if (text) registerCss(text, block.baseUrl);
    }
    for (const [path, text] of Object.entries(allCssTexts)) {
      const url = Object.entries(localUrls).find(([, local]) => local === path)?.[0];
      if (url) registerCss(text, url);
    }
    if (missing.size === 0) break;
    const extra = Array.from(missing.entries()).map(([url, kind]) => {
      attempted.add(url);
      return { url, kind: kind as AssetResolveRequest['kind'], inline: url.startsWith('data:') } satisfies AssetResolveRequest;
    });
    deps.progress(`Resolviendo ${extra.length} recursos de CSS`, 38 + round * 4);
    applyBatch(await deps.resolveAssets(extra));
  }

  for (const failure of allNetwork) {
    if (failure.captured) continue;
    if (/^(data|blob|about):/i.test(failure.url)) continue;
    allFailures.push({
      url: sanitizeUrlForReport(failure.url),
      kind: 'other',
      reason: 'respuesta de red no capturada',
      restriction: failure.note ?? 'petición no observada o sin cuerpo reproducible',
      affectsFidelity: true,
      alternative: 'Repetir la interacción durante la captura o habilitar cookies',
    });
  }

  deps.progress('Reescribiendo HTML, CSS y JavaScript', 62);

  // --------------------------------------------------------------- finalizar
  const prefixFor = (path: string): string => '../'.repeat(path.split('/').length - 1);

  const finalizeCss = (css: string, baseUrl: string, prefix: string, depth = 0): string => {
    if (!css) return css;
    let output = css;
    if (depth < 5) {
      output = replaceImports(output, (href) => {
        const abs = absolutize(href, baseUrl);
        if (!abs) return null;
        const local = localFor(abs);
        if (!local) return null;
        const text = allCssTexts[local];
        if (!text) return null;
        return { css: finalizeCss(text, abs, prefix, depth + 1), media: '' };
      });
    }
    return rewriteCssUrls(output, (raw) => {
      if (raw.startsWith('#')) return raw;
      const abs = absolutize(raw, baseUrl);
      if (!abs) return raw;
      const local = localFor(abs);
      if (local) return `${prefix}${local}`;
      return abs;
    });
  };

  const localHref = (local: string, prefix: string): string =>
    prefix ? `${prefix}${local}` : options.fullSession ? `/${local}` : local;
  // En los manifiestos, TanStack/Vite añaden la raíz por su cuenta.
  const localLiteral = (local: string, prefix: string): string =>
    prefix ? `${prefix}${local}` : local;

  const finalizeInlineJs = (block: JsBlock, prefix: string): string => {
    const imported = rewriteJsSpecifiers(block.code, (specifier) => {
      if (!/^[./]|^https?:/i.test(specifier)) return null;
      const abs = absolutize(specifier, block.baseUrl);
      if (!abs) return null;
      const local = localFor(abs);
      return local ? localHref(local, prefix) : null;
    });
    // TanStack Start serializa su manifiesto de rutas y preloads en un script
    // inline. Esos literales /assets/* también deben apuntar al ZIP.
    return rewriteJsStringLiterals(imported.code, (literal) => {
      if (!/^(?:\.{1,2}\/|\/|assets\/|https?:)/i.test(literal)) return null;
      const abs = absolutize(literal, block.baseUrl);
      if (!abs) return null;
      const local = localFor(abs);
      return local ? localLiteral(local, prefix) : null;
    }).code;
  };

  const sessionHead =
    dynamic && deps.session
      ? `<script type="application/json" id="wc-session">${sessionStateScript(deps.session)}</script>\n`
      : '';
  const runtimeHead =
    dynamic && (options.captureNetwork || deps.session)
      ? `${sessionHead}<script type="application/json" id="wc-network">${inlineJson(allNetwork.filter((entry) => entry.captured))}</script>\n<script>${DYNAMIC_RUNTIME_JS}</script>`
      : '';

  const finalizeHtml = (html: string, prefix: string, injectState: boolean): string => {
    let output = html;
    for (const block of blocks) {
      if (!output.includes(block.token)) continue;
      let css = block.css;
      if (block.external) {
        const local = localFor(block.baseUrl);
        css = local ? allCssTexts[local] ?? '' : '';
        if (!css) css = `/* WebClone: CSS no capturado ${sanitizeUrlForReport(block.baseUrl)} */`;
      }
      output = output.split(block.token).join(finalizeCss(css, block.baseUrl, prefix));
    }
    for (const block of jsBlocks) {
      if (!output.includes(block.token)) continue;
      output = output.split(block.token).join(finalizeInlineJs(block, prefix));
    }
    for (const [token, entry] of urlByToken) {
      if (!output.includes(token)) continue;
      const local = localFor(entry.url);
      output = output.split(token).join(escapeAttr(local ? localHref(local, prefix) : sanitizeUrlForReport(entry.url)));
    }
    if (output.includes(RUNTIME_HEAD_TOKEN)) output = output.split(RUNTIME_HEAD_TOKEN).join(runtimeHead);
    if (injectState && dynamic && output.includes('</body>')) {
      output = output.replace('</body>', `${stateScript(state)}\n</body>`);
    }
    return output;
  };

  let html = finalizeHtml(outcome.html, '', sourceOk);
  // El HTML fuente es un SSR genérico (forest). Si la sesión estaba en otro
  // tema, arrancamos con él para no parpadear ni provocar más desajustes.
  const capturedTheme = deps.session?.storage.local?.['protocol-explorer:theme'];
  if (capturedTheme === 'light' || capturedTheme === 'dark') {
    html = html.replace(/(<html\b[^>]*\bdata-theme=")[^"]*(")/i, `$1${capturedTheme}$2`);
  }
  const extraFiles = frames.map((frame) => ({
    path: frame.path,
    text: finalizeHtml(frame.html, prefixFor(frame.path), sourceOk),
  }));
  if (deps.session) {
    extraFiles.push({ path: 'session/session.json', text: JSON.stringify(deps.session, null, 2) });
  }

  deps.progress('Generando informe', 90);

  const capturedAssets = allAssets.filter((asset) => asset.status === 'captured');
  const counts = buildCounts(outcome);
  counts.assetsCaptured = capturedAssets.length;
  counts.assetsFailed = allFailures.length;
  counts.responsesCaptured = allNetwork.filter((entry) => entry.captured).length;
  if (dynamic) counts.scriptsKept = counts.scriptsKept ?? 0;
  if (sourceOk) counts.scriptsStripped = 0;

  const deduped: FailedResource[] = [];
  const seen = new Set<string>();
  for (const failure of allFailures) {
    const key = `${failure.url}|${failure.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(failure);
  }

  const htmlBytes = new TextEncoder().encode(html).byteLength;
  const assetBytes = totalBytes;
  const fidelity = computeFidelity(capturedAssets.length, deduped, counts);
  const browser = detectBrowser();
  const finishedAt = Date.now();

  const unsupported = Array.from(new Set(outcome.unsupported));
  if (framework) {
    unsupported.push(
      `Framework de hidratación detectado (${framework}); se usó la instantánea estática para evitar un hydration mismatch. Activa «Forzar dinámico» si quieres intentar ejecutar el JS de todos modos.`,
    );
  }
  if (dynamic) {
    unsupported.push(
      'El clon ejecuta JavaScript local; las peticiones no capturadas se responden con HTTP 504 y nunca salen a Internet.',
      'WebSocket, EventSource y service workers se desactivan en la reproducción offline.',
      'Las respuestas de red capturadas se reproducen por URL, método y cuerpo; una petición nunca observada devuelve HTTP 504.',
    );
    if (!sourceOk) unsupported.push('Se usó el DOM vivo como base: los scripts pueden reaplicar mutaciones ya serializadas.');
  }

  const reportStartedAt = deps.session ? Date.parse(deps.session.startedAt) || startedAt : startedAt;
  const report: CaptureReport = {
    version: 1,
    sessionId: deps.sessionId,
    kind: 'clone',
    url: doc.URL,
    title: doc.title,
    startedAt: new Date(reportStartedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - reportStartedAt,
    browser: { name: browser.name, version: browser.version, userAgent: browser.userAgent },
    viewport: state.viewport,
    counts,
    bytes: { html: htmlBytes, assets: assetBytes, total: htmlBytes + assetBytes },
    fidelity,
    failures: deduped,
    unsupported,
    options: effectiveOptions,
    session: deps.session,
  };

  return { html, state, report, extraFiles, network: allNetwork };
}
