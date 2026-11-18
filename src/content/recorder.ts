/** Grabación de sesión con rrweb + registro de errores, red, consola y navegación. */

import { record } from '@rrweb/record';
import type {
  ConsoleEntry,
  NavigationEvent,
  NetworkEntry,
  RecordedError,
  RecordingMeta,
  RecordingOptions,
} from '../shared/types';
import { sanitizeUrl } from '../shared/redact';
import { redactMessages } from '../shared/redact';

export interface RecorderSnapshot {
  events: unknown[];
  errors: RecordedError[];
  navigations: NavigationEvent[];
  network: NetworkEntry[];
  console: ConsoleEntry[];
  startedAt: number;
  endedAt: number;
}

export class SessionRecorder {
  private stopFn: (() => void) | null = null;
  private events: unknown[] = [];
  private errors: RecordedError[] = [];
  private navigations: NavigationEvent[] = [];
  private network: NetworkEntry[] = [];
  private consoleEntries: ConsoleEntry[] = [];
  private startedAt = 0;
  private stopped = false;
  private seenResources = new Set<string>();
  private perfObserver: PerformanceObserver | null = null;
  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private pollTimer: number | null = null;

  constructor(private options: RecordingOptions) {}

  start(): void {
    this.startedAt = Date.now();
    this.options = this.options;
    const recordOptions: Record<string, unknown> = {
      emit: (event: unknown) => {
        this.events.push(event);
        if (this.events.length > this.options.maxEvents) {
          this.errors.push({
            t: Date.now(),
            type: 'error',
            message: `Límite de eventos alcanzado (${this.options.maxEvents}); la grabación continuará sin nuevos eventos.`,
          });
        }
      },
      inlineStylesheet: true,
      inlineImages: false,
      collectFonts: true,
      recordCanvas: this.options.recordCanvas,
      recordCrossOriginIframes: this.options.recordCrossOriginIframes,
      maskAllInputs: false,
      maskInputOptions: { password: true },
      maskInputFn: (text: string, element?: HTMLElement) => {
        if (element && element.getAttribute && element.getAttribute('data-webclone-mask') === 'true') {
          return '••••';
        }
        return text;
      },
      sampling: {
        mousemove: this.options.samplingMss,
        mouseInteraction: true,
        scroll: 100,
        media: 500,
        input: 'last' as const,
      },
      recordAfter: 'DOMContentLoaded',
      errorHandler: (error: unknown) => {
        this.errors.push({
          t: Date.now(),
          type: 'error',
          message: redactMessages(error instanceof Error ? error.message : String(error)),
        });
      },
    };
    try {
      this.stopFn = record(recordOptions as never) as unknown as () => void;
    } catch (error) {
      this.errors.push({
        t: Date.now(),
        type: 'error',
        message: `No se pudo iniciar rrweb: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    this.installPerformanceObserver();
    this.installMessageListener();
    this.pollTimer = window.setInterval(() => this.pollResources(), 2500);
  }

  private installPerformanceObserver(): void {
    try {
      this.perfObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
          this.addResourceEntry(entry);
        }
      });
      this.perfObserver.observe({ type: 'resource', buffered: true });
    } catch {
      this.perfObserver = null;
    }
  }

  private addResourceEntry(entry: PerformanceResourceTiming): void {
    const key = `${entry.name}|${Math.round(entry.startTime)}`;
    if (this.seenResources.has(key)) return;
    this.seenResources.add(key);
    this.network.push({
      t: Date.now(),
      url: sanitizeUrl(entry.name),
      method: 'GET',
      status: 200,
      resourceType: entry.initiatorType || 'resource',
      durationMs: Math.round(entry.duration),
      transferSize: entry.transferSize ?? 0,
      failed: false,
      sameOrigin: new URL(entry.name, location.href).origin === location.origin,
    });
    if (this.network.length > 5000) this.network.shift();
  }

  private pollResources(): void {
    try {
      for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
        this.addResourceEntry(entry);
      }
    } catch {
      /* ignore */
    }
  }

  private installMessageListener(): void {
    this.messageHandler = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as { __webclone?: boolean; payload?: Record<string, unknown> } | null;
      if (!data || !data.__webclone || !data.payload) return;
      const payload = data.payload as {
        type: string;
        t: number;
        message?: string;
        source?: string;
        line?: number;
        column?: number;
        stack?: string;
        level?: string;
        url?: string;
        method?: string;
        status?: number;
        durationMs?: number;
        resourceType?: string;
        failed?: boolean;
        kind?: string;
        to?: string;
        tag?: string;
        error?: string;
      };

      switch (payload.type) {
        case 'error':
          this.errors.push({
            t: payload.t,
            type: 'error',
            message: redactMessages(payload.message ?? ''),
            source: payload.source,
            line: payload.line,
            column: payload.column,
            stack: payload.stack ? redactMessages(payload.stack).slice(0, 4000) : undefined,
          });
          break;
        case 'unhandledrejection':
          this.errors.push({
            t: payload.t,
            type: 'unhandledrejection',
            message: redactMessages(payload.message ?? ''),
            stack: payload.stack ? redactMessages(payload.stack).slice(0, 4000) : undefined,
          });
          break;
        case 'resource-error':
          this.errors.push({
            t: payload.t,
            type: 'resource',
            message: `No se pudo cargar ${payload.tag}: ${payload.url ?? ''}`,
            source: payload.url ? sanitizeUrl(payload.url) : undefined,
          });
          break;
        case 'console':
          this.consoleEntries.push({
            t: payload.t,
            level: (payload.level as ConsoleEntry['level']) ?? 'log',
            message: redactMessages(payload.message ?? ''),
          });
          if (this.consoleEntries.length > 5000) this.consoleEntries.shift();
          break;
        case 'navigation':
          this.navigations.push({
            t: payload.t,
            from: this.navigations.at(-1)?.to ?? location.href,
            to: sanitizeUrl(payload.to ?? location.href),
            kind: (payload.kind as NavigationEvent['kind']) ?? 'push',
          });
          break;
        case 'network':
          this.network.push({
            t: payload.t,
            url: sanitizeUrl(payload.url ?? ''),
            method: payload.method ?? 'GET',
            status: payload.status ?? 0,
            resourceType: payload.resourceType ?? 'unknown',
            durationMs: payload.durationMs ?? 0,
            transferSize: 0,
            failed: !!payload.failed,
            sameOrigin: (() => {
              try {
                return new URL(payload.url ?? '', location.href).origin === location.origin;
              } catch {
                return false;
              }
            })(),
          });
          if (this.network.length > 5000) this.network.shift();
          break;
        default:
          break;
      }
    };
    window.addEventListener('message', this.messageHandler);
  }

  get eventCount(): number {
    return this.events.length;
  }

  get elapsedMs(): number {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }

  snapshot(): RecorderSnapshot {
    return {
      events: this.events,
      errors: this.errors,
      navigations: this.navigations,
      network: this.network,
      console: this.consoleEntries,
      startedAt: this.startedAt,
      endedAt: Date.now(),
    };
  }

  drainFrom(index: number): unknown[] {
    return this.events.slice(index);
  }

  stop(): RecorderSnapshot {
    if (!this.stopped) {
      this.stopped = true;
      try {
        this.stopFn?.();
      } catch {
        /* ignore */
      }
      try {
        this.perfObserver?.disconnect();
      } catch {
        /* ignore */
      }
      if (this.messageHandler) window.removeEventListener('message', this.messageHandler);
      if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    return this.snapshot();
  }

  buildMeta(extra: { url: string; title: string; assetCount: number; assetBytes: number }): RecordingMeta {
    const snap = this.snapshot();
    return {
      id: '',
      url: sanitizeUrl(extra.url),
      title: extra.title,
      startedAt: new Date(snap.startedAt).toISOString(),
      endedAt: new Date(snap.endedAt).toISOString(),
      durationMs: snap.endedAt - snap.startedAt,
      eventCount: snap.events.length,
      assetCount: extra.assetCount,
      assetBytes: extra.assetBytes,
      errors: snap.errors,
      navigations: snap.navigations,
      network: snap.network,
      console: snap.console,
      options: this.options,
    };
  }
}
