/**
 * Content script: ejecuta la captura en la página y gestiona la grabación.
 * No modifica el DOM de la página salvo el mínimo necesario; la grabación usa rrweb.
 */

import { onRuntimeMessage, runtimeSend } from '../shared/ext';
import type { AssetResolveRequest, AssetResolveResponse } from '../shared/messages';
import {
  DEFAULT_CAPTURE_OPTIONS,
  DEFAULT_RECORDING_OPTIONS,
  type CaptureOptions,
  type CaptureReport,
  type RecordingOptions,
} from '../shared/types';
import { captureInstantClone, computeFidelity, type NetworkSnapshotEntry, type SourceFetchResult } from '../core/capture';
import { captureSessionState } from '../core/session-state';
import { inventoryDocument, inventoryToRequests } from '../core/assets';
import { SessionRecorder } from './recorder';
import { rewriteRrwebAssets } from '../shared/rrweb-rewrite';
import { detectBrowser } from '../shared/ext';

interface ActiveRecording {
  sessionId: string;
  recorder: SessionRecorder;
  sent: number;
  flushTimer: number;
  limitTimer: number | null;
  startUrl: string;
  startTitle: string;
  options: RecordingOptions;
}

interface ActiveFull {
  sessionId: string;
  startedAt: number;
  startUrl: string;
  startTitle: string;
  options: Partial<CaptureOptions>;
  requests: number;
}

let activeRecording: ActiveRecording | null = null;
let activeFull: ActiveFull | null = null;
let captureInFlight = false;
let fullInteractions = 0;
const fullNavigations: string[] = [];

// ------------------------------------------------------------------ red
// El MAIN world mantiene un journal de fetch/XHR. Aquí se recibe por postMessage,
// se completa con Resource Timing y se entrega al pipeline de captura.
let networkJournal: NetworkSnapshotEntry[] = [];
const commandWaiters = new Map<string, (payload: { entries?: NetworkSnapshotEntry[] }) => void>();

function rememberNetwork(entry: NetworkSnapshotEntry): void {
  if (!entry?.url || /^(data|blob|about|javascript):/i.test(entry.url)) return;
  if (networkJournal.some((existing) => existing.url === entry.url && existing.method === entry.method)) return;
  networkJournal.push(entry);
  if (networkJournal.length > 1200) networkJournal.shift();
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data as { __webclone?: boolean; payload?: Record<string, unknown> } | null;
  if (!data || data.__webclone !== true || !data.payload) return;
  const payload = data.payload as { type?: string; requestId?: string; entries?: NetworkSnapshotEntry[]; entry?: NetworkSnapshotEntry; to?: string } & Record<string, unknown>;
  if (payload.type === 'network') {
    rememberNetwork({
      url: String(payload.url ?? ''),
      method: String(payload.method ?? 'GET'),
      status: Number(payload.status ?? 0),
      mime: String(payload.mime ?? ''),
      resourceType: String(payload.resourceType ?? 'other'),
    });
    if (activeFull) {
      activeFull.requests++;
      void runtimeSend({ type: 'WC_FULL_STATS', count: activeFull.requests }).catch(() => undefined);
    }
    return;
  }
  if (payload.type === 'navigation' && activeFull) {
    fullNavigations.push(String(payload.to ?? location.href));
    return;
  }
  if (payload.type === 'network-entry' && activeFull && payload.entry) {
    void runtimeSend({ type: 'WC_NETWORK_ENTRY', sessionId: activeFull.sessionId, entry: payload.entry }).catch(() => undefined);
    return;
  }
  if ((payload.type === 'journal' || payload.type === 'armed' || payload.type === 'cleared') && payload.requestId) {
    const waiter = commandWaiters.get(payload.requestId);
    if (waiter) {
      commandWaiters.delete(payload.requestId);
      waiter(payload);
    }
  }
});

function postPageCommand(command: 'arm' | 'snapshot' | 'clear'): Promise<{ entries?: NetworkSnapshotEntry[] }> {
  const requestId = `wc_${command}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      commandWaiters.delete(requestId);
      resolve({ entries: [] });
    }, 1800);
    commandWaiters.set(requestId, (payload) => {
      window.clearTimeout(timer);
      resolve(payload);
    });
    try {
      window.postMessage({ __webclone: true, command, requestId }, '*');
    } catch {
      window.clearTimeout(timer);
      commandWaiters.delete(requestId);
      resolve({ entries: [] });
    }
  });
}

function performanceNetworkEntries(): NetworkSnapshotEntry[] {
  const out: NetworkSnapshotEntry[] = [];
  try {
    for (const raw of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      if (!raw.name || /^(data|blob|about|javascript):/i.test(raw.name)) continue;
      out.push({
        url: raw.name,
        method: 'GET',
        status: 0,
        mime: '',
        resourceType: raw.initiatorType || 'other',
      });
    }
  } catch {
    /* Resource Timing no disponible */
  }
  return out;
}

async function snapshotNetwork(): Promise<{ entries: NetworkSnapshotEntry[] }> {
  const journal = await postPageCommand('snapshot');
  const merged: NetworkSnapshotEntry[] = [];
  const seen = new Set<string>();
  // El journal del MAIN world conserva todas las ocurrencias (POST repetidos).
  for (const entry of journal.entries ?? []) {
    merged.push(entry);
    // Resource Timing puede etiquetar el mismo endpoint como GET. El journal
    // con método/cuerpo tiene prioridad y evita una ocurrencia falsa.
    seen.add(entry.url);
  }
  const addFallback = (entry: NetworkSnapshotEntry): void => {
    if (seen.has(entry.url)) return;
    seen.add(entry.url);
    merged.push(entry);
  };
  for (const entry of networkJournal) addFallback(entry);
  for (const entry of performanceNetworkEntries()) addFallback(entry);
  return { entries: merged };
}

async function armNetwork(): Promise<void> {
  await postPageCommand('arm');
}

function reportProgress(sessionId: string | undefined, phase: string, message: string, percent: number): void {
  void runtimeSend({
    type: 'WC_PROGRESS',
    sessionId,
    progress: { phase, message, percent },
  }).catch(() => undefined);
}

function reportFailure(sessionId: string, error: unknown, phase: string): void {
  void runtimeSend({
    type: 'WC_CAPTURE_FAILED',
    sessionId,
    error: error instanceof Error ? error.message : String(error),
    phase,
  }).catch(() => undefined);
}

async function handleCaptureClone(message: { sessionId?: string; options?: Partial<CaptureOptions> }): Promise<unknown> {
  if (captureInFlight || activeRecording || activeFull) {
    return { ok: false, error: 'Ya hay una captura, grabación o Clon Completo en curso en esta pestaña' };
  }
  const sessionId = message.sessionId ?? `clone_${Date.now().toString(36)}`;
  captureInFlight = true;
  networkJournal = [];
  const options: Partial<CaptureOptions> = message.options ?? {};

  // Se ejecuta en segundo plano para responder de inmediato al background:
  // así el popup puede mostrar progreso real sin bloquear el canal de mensajes.
  void (async () => {
    try {
      reportProgress(sessionId, 'serializing', 'Serializando DOM', 5);
      const result = await captureInstantClone(document, {
        sessionId,
        options,
        resolveAssets: async (requests: AssetResolveRequest[], networkEntries?: NetworkSnapshotEntry[]) => {
          const response = await runtimeSend<AssetResolveResponse>({
            type: 'WC_RESOLVE_ASSETS',
            sessionId,
            requests,
            options,
            network: networkEntries,
          });
          if (!response || !response.ok) {
            throw new Error(response?.error ?? 'el background no pudo resolver los recursos');
          }
          return response;
        },
        progress: (msg, percent) => reportProgress(sessionId, 'assets', msg, percent),
        fetchSource: async (url: string) => {
          const response = await runtimeSend<SourceFetchResult>({
            type: 'WC_FETCH_SOURCE',
            url,
            options,
          });
          return response ?? { ok: false, error: 'sin respuesta del background' };
        },
        network: { arm: armNetwork, snapshot: snapshotNetwork },
        networkSeen: async () => {
          try {
            const response = await runtimeSend<{ ok: boolean; entries?: { url: string; method: string; resourceType: string }[] }>({
              type: 'WC_GET_NETWORK_SEEN',
              sessionId,
            });
            return response?.entries ?? [];
          } catch {
            return [];
          }
        },
      });
      reportProgress(sessionId, 'saving', 'Guardando paquete', 95);
      const saved = await runtimeSend<{ ok: boolean; error?: string }>({
        type: 'WC_SAVE_CLONE',
        sessionId,
        html: result.html,
        state: result.state,
        report: result.report,
        extraFiles: result.extraFiles,
        network: result.network,
      });
      if (!saved?.ok) throw new Error(saved?.error ?? 'no se pudo guardar el clon');
      reportProgress(sessionId, 'done', 'Captura completada', 100);
    } catch (error) {
      reportFailure(sessionId, error, 'capture');
    } finally {
      captureInFlight = false;
    }
  })();

  return { ok: true, sessionId, accepted: true };
}

async function startFullSession(message: { sessionId: string; options: Partial<CaptureOptions> }): Promise<unknown> {
  if (captureInFlight || activeRecording || activeFull) {
    return { ok: false, error: 'Ya hay una operación en curso en esta pestaña' };
  }
  activeFull = {
    sessionId: message.sessionId,
    startedAt: Date.now(),
    startUrl: location.href,
    startTitle: document.title,
    options: message.options ?? {},
    requests: 0,
  };
  fullInteractions = 0;
  fullNavigations.length = 0;
  networkJournal = [];
  try {
    await postPageCommand('clear');
    await armNetwork();
  } catch {
    activeFull = null;
    return { ok: false, error: 'No se pudieron activar los hooks de red de la página' };
  }
  reportProgress(message.sessionId, 'analyzing', 'Clon Completo activo: interactúa con la página', 2);
  return { ok: true, sessionId: message.sessionId, startedAt: activeFull.startedAt };
}

async function attachFullSession(message: { sessionId: string; startedAt: number; options: Partial<CaptureOptions> }): Promise<unknown> {
  if (activeFull) return { ok: true, sessionId: activeFull.sessionId, attached: false };
  if (captureInFlight || activeRecording) return { ok: false, error: 'Hay otra captura en curso' };
  activeFull = {
    sessionId: message.sessionId,
    startedAt: Number(message.startedAt) || Date.now(),
    startUrl: location.href,
    startTitle: document.title,
    options: message.options ?? {},
    requests: 0,
  };
  fullInteractions = 0;
  fullNavigations.length = 0;
  networkJournal = [];
  try {
    await postPageCommand('clear');
    await armNetwork();
  } catch {
    activeFull = null;
    return { ok: false, error: 'No se pudieron reactivar los hooks tras la navegación' };
  }
  reportProgress(message.sessionId, 'analyzing', 'Clon Completo reenganchado tras la navegación', 2);
  return { ok: true, sessionId: message.sessionId, attached: true };
}

async function stopFullSession(): Promise<unknown> {
  const current = activeFull;
  if (!current) return { ok: false, error: 'No hay un Clon Completo activo' };
  activeFull = null;
  captureInFlight = true;
  const sessionId = current.sessionId;
  void (async () => {
    try {
      reportProgress(sessionId, 'analyzing', 'Recogiendo red y estado de la sesión', 8);
      const remote = await runtimeSend<{ ok: boolean; entries?: NetworkSnapshotEntry[] }>({
        type: 'WC_GET_NETWORK_CAPTURED',
        sessionId,
      }).catch(() => null);
      const snapshot = await snapshotNetwork();
      const merged: NetworkSnapshotEntry[] = [];
      const seen = new Set<string>();
      const add = (entry: NetworkSnapshotEntry): void => {
        const key = entry.id || `${entry.method} ${entry.url} ${entry.requestBodyBase64 ?? ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(entry);
      };
      for (const entry of remote?.entries ?? []) add(entry);
      for (const entry of snapshot.entries) add(entry);
      const session = captureSessionState(document, {
        startedAt: current.startedAt,
        interactions: fullInteractions,
        navigations: fullNavigations,
      });
      const options: Partial<CaptureOptions> = {
        ...current.options,
        dynamic: true,
        captureNetwork: true,
        keepScripts: true,
        fullSession: true,
        captureStorage: true,
        settleMs: 0,
      };
      const result = await captureInstantClone(document, {
        sessionId,
        options,
        session,
        preArmedNetwork: merged,
        resolveAssets: async (requests: AssetResolveRequest[], networkEntries?: NetworkSnapshotEntry[]) => {
          const response = await runtimeSend<AssetResolveResponse>({
            type: 'WC_RESOLVE_ASSETS',
            sessionId,
            requests,
            options,
            network: networkEntries,
          });
          if (!response || !response.ok) throw new Error(response?.error ?? 'el background no pudo resolver los recursos');
          return response;
        },
        progress: (msg, percent) => reportProgress(sessionId, 'assets', msg, percent),
        fetchSource: async (url: string) => {
          const response = await runtimeSend<SourceFetchResult>({ type: 'WC_FETCH_SOURCE', url, options });
          return response ?? { ok: false, error: 'sin respuesta del background' };
        },
        networkSeen: async () => {
          try {
            const response = await runtimeSend<{ ok: boolean; entries?: { url: string; method: string; resourceType: string }[] }>({
              type: 'WC_GET_NETWORK_SEEN',
              sessionId,
            });
            return response?.entries ?? [];
          } catch {
            return [];
          }
        },
      });
      reportProgress(sessionId, 'saving', 'Guardando clon completo', 95);
      const saved = await runtimeSend<{ ok: boolean; error?: string }>({
        type: 'WC_SAVE_CLONE',
        sessionId,
        html: result.html,
        state: result.state,
        report: result.report,
        extraFiles: result.extraFiles,
        network: result.network,
      });
      if (!saved?.ok) throw new Error(saved?.error ?? 'no se pudo guardar el clon completo');
      reportProgress(sessionId, 'done', 'Clon completo reconstruido', 100);
    } catch (error) {
      reportFailure(sessionId, error, 'full');
    } finally {
      captureInFlight = false;
    }
  })();
  return { ok: true, sessionId, accepted: true };
}

function fullState(): unknown {
  if (!activeFull) return { ok: true, full: false };
  return {
    ok: true,
    full: true,
    sessionId: activeFull.sessionId,
    startedAt: activeFull.startedAt,
    count: activeFull.requests,
    elapsedMs: Date.now() - activeFull.startedAt,
  };
}

// Contabiliza interacciones sin interceptar ni alterar los eventos de la página.
for (const name of ['click', 'input', 'change', 'submit', 'keydown']) {
  document.addEventListener(name, () => {
    if (activeFull) fullInteractions++;
  }, true);
}

function flushRecording(): void {
  if (!activeRecording) return;
  const { recorder, sessionId } = activeRecording;
  const fresh = recorder.drainFrom(activeRecording.sent);
  if (fresh.length === 0) return;
  activeRecording.sent += fresh.length;
  void runtimeSend({ type: 'WC_RECORDING_CHUNK', sessionId, events: fresh }).catch(() => undefined);
}

async function finalizeRecording(sessionId: string, recording: SessionRecorder, startUrl: string, startTitle: string): Promise<{ eventCount: number; assetCount: number }> {
  const snapshot = recording.snapshot();
  reportProgress(sessionId, 'assets', 'Resolviendo recursos de la grabación', 40);

  const inventory = inventoryDocument(document);
  const requests: AssetResolveRequest[] = inventoryToRequests(inventory).map(({ url, kind }) => ({
    url,
    kind: kind as AssetResolveRequest['kind'],
    inline: url.startsWith('data:'),
  }));

  let resolveResponse: AssetResolveResponse | null = null;
  try {
    resolveResponse = await runtimeSend<AssetResolveResponse>({
      type: 'WC_RESOLVE_ASSETS',
      sessionId,
      requests,
      options: { captureAssets: true },
    });
  } catch {
    resolveResponse = null;
  }

  const map = resolveResponse?.map ?? {};
  const captured = (resolveResponse?.assets ?? []).filter((a) => a.status === 'captured');
  reportProgress(sessionId, 'assets', 'Reescribiendo eventos', 70);
  const rewritten = rewriteRrwebAssets(snapshot.events, startUrl, (abs) => map[abs] ?? null);

  const browser = detectBrowser();
  const canvasCount = inventory.counts.canvases;
  const failures = resolveResponse?.failures ?? [];
  const counts = {
    elements: inventory.counts.elements,
    shadowRoots: 0,
    iframes: inventory.counts.iframes,
    framesCaptured: 0,
    stylesheets: inventory.counts.stylesheets,
    stylesheetsInlined: 0,
    assetsCaptured: captured.length,
    assetsFailed: failures.length,
    canvases: canvasCount,
    canvasesUnsupported: 0,
    media: inventory.counts.media,
    mediaCaptured: 0,
    forms: 0,
    scriptsStripped: 0,
  };
  const eventsBytes = new TextEncoder().encode(JSON.stringify(rewritten.events)).byteLength;
  const fidelity = computeFidelity(captured.length, failures, counts);
  const report: CaptureReport = {
    version: 1,
    sessionId,
    kind: 'recording',
    url: startUrl,
    title: startTitle || document.title,
    startedAt: new Date(snapshot.startedAt).toISOString(),
    finishedAt: new Date(snapshot.endedAt).toISOString(),
    durationMs: snapshot.endedAt - snapshot.startedAt,
    browser: { name: browser.name, version: browser.version, userAgent: browser.userAgent },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY),
      devicePixelRatio: window.devicePixelRatio || 1,
    },
    counts,
    bytes: { html: eventsBytes, assets: resolveResponse?.totalBytes ?? 0, total: eventsBytes + (resolveResponse?.totalBytes ?? 0) },
    fidelity,
    failures,
    unsupported: [
      'rrweb reconstruye el DOM observado; no reproduce lógica de la aplicación ni llamadas de red posteriores.',
      'Los iframes de origen cruzado no se graban salvo que el sitio lo permita (recordCrossOriginIframes).',
      'El contenido de canvas WebGL puede no registrarse si el contexto no es legible.',
    ],
    options: { ...DEFAULT_CAPTURE_OPTIONS },
  };

  const meta = recording.buildMeta({
    url: startUrl,
    title: startTitle || document.title,
    assetCount: captured.length,
    assetBytes: resolveResponse?.totalBytes ?? 0,
  });
  meta.id = sessionId;
  if (rewritten.stats.missed.length > 0) {
    meta.errors.push({
      t: Date.now(),
      type: 'resource',
      message: `${rewritten.stats.missed.length} recursos no encontrados al reescribir eventos (p.ej. ${rewritten.stats.missed[0]})`,
    });
  }

  reportProgress(sessionId, 'saving', 'Guardando grabación', 95);
  await runtimeSend({
    type: 'WC_SAVE_RECORDING',
    sessionId,
    events: rewritten.events,
    report,
    recordingMeta: meta,
  });
  reportProgress(sessionId, 'done', 'Grabación guardada', 100);
  return { eventCount: snapshot.events.length, assetCount: captured.length };
}

async function startRecording(message: { sessionId?: string; options?: Partial<RecordingOptions> }): Promise<unknown> {
  if (activeRecording) return { ok: false, error: 'Ya hay una grabación en curso' };
  if (captureInFlight) return { ok: false, error: 'Hay una captura en curso' };
  if (activeFull) return { ok: false, error: 'Hay un Clon Completo activo' };
  const sessionId = message.sessionId ?? `rec_${Date.now().toString(36)}`;
  const options: RecordingOptions = { ...DEFAULT_RECORDING_OPTIONS, ...(message.options ?? {}) };
  const recorder = new SessionRecorder(options);
  recorder.start();
  const flushTimer = window.setInterval(flushRecording, 3000);
  let limitTimer: number | null = null;
  if (options.maxDurationMs > 0) {
    limitTimer = window.setTimeout(() => {
      void stopRecording().catch(() => undefined);
    }, options.maxDurationMs);
  }
  activeRecording = {
    sessionId,
    recorder,
    sent: 0,
    flushTimer,
    limitTimer,
    startUrl: location.href,
    startTitle: document.title,
    options,
  };
  reportProgress(sessionId, 'analyzing', 'Grabando sesión', 2);
  return { ok: true, sessionId, startedAt: Date.now() };
}

async function stopRecording(): Promise<unknown> {
  const current = activeRecording;
  if (!current) return { ok: false, error: 'No hay grabación activa' };
  window.clearInterval(current.flushTimer);
  if (current.limitTimer !== null) window.clearTimeout(current.limitTimer);
  activeRecording = null;
  const recording = current.recorder;
  // El snapshot debe tomarse antes de stop() para conservar los eventos finales.
  const beforeStop = recording.eventCount;
  const result = await finalizeRecording(current.sessionId, recording, current.startUrl, current.startTitle);
  recording.stop();
  return { ok: true, sessionId: current.sessionId, eventCount: Math.max(beforeStop, result.eventCount), assetCount: result.assetCount };
}

function recordingState(): unknown {
  if (!activeRecording) return { ok: true, recording: false };
  return {
    ok: true,
    recording: true,
    sessionId: activeRecording.sessionId,
    startedAt: Date.now() - activeRecording.recorder.elapsedMs,
    eventCount: activeRecording.recorder.eventCount,
    elapsedMs: activeRecording.recorder.elapsedMs,
  };
}

onRuntimeMessage(async (message: { type?: string }) => {
  switch (message?.type) {
    case 'WC_PING':
      return { ok: true, url: location.href, title: document.title, recording: !!activeRecording };
    case 'WC_CAPTURE_CLONE':
      return handleCaptureClone(message as never);
    case 'WC_START_FULL':
      return startFullSession(message as never);
    case 'WC_FULL_ATTACH':
      return attachFullSession(message as never);
    case 'WC_STOP_FULL':
      return stopFullSession();
    case 'WC_FULL_STATE':
      return fullState();
    case 'WC_START_RECORDING':
      return startRecording(message as never);
    case 'WC_STOP_RECORDING':
      return stopRecording();
    case 'WC_RECORDING_STATE':
      return recordingState();
    default:
      return { ok: false, error: `mensaje no soportado en content: ${message?.type}` };
  }
});

// Volcado final al cerrar/ocultar la pestaña (el background conserva los chunks previos).
window.addEventListener('pagehide', () => flushRecording());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushRecording();
});
