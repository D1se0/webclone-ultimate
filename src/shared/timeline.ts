import type { NavigationEvent, RecordedError, ConsoleEntry } from './types';

export interface RrwebEvent {
  type: number;
  data: unknown;
  timestamp: number;
  delay?: number;
}

export interface TimelineMark {
  t: number;
  at: number;
  type: 'navigation' | 'error' | 'network' | 'console' | 'snapshot' | 'marker';
  label: string;
  detail?: string;
}

export interface Timeline {
  version: 1;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  eventCount: number;
  firstEventAt: number;
  lastEventAt: number;
  marks: TimelineMark[];
  /** Índice de offsets de eventos para búsquedas rápidas (cada N eventos). */
  index: { t: number; i: number }[];
}

export const RRWEB = {
  DomContentLoaded: 0,
  Load: 1,
  FullSnapshot: 2,
  IncrementalSnapshot: 3,
  Meta: 4,
  Custom: 5,
  Plugin: 6,
} as const;

export const INCREMENTAL = {
  Mutation: 0,
  MouseMove: 1,
  MouseInteraction: 2,
  Scroll: 3,
  ViewportResize: 4,
  Input: 5,
  TouchMove: 6,
  MediaInteraction: 7,
  StyleSheetRule: 8,
  CanvasMutation: 9,
  Font: 10,
  Log: 11,
  Drag: 12,
  StyleDeclaration: 13,
  Selection: 14,
  AdoptedStyleSheet: 15,
  CustomElement: 16,
} as const;

const INDEX_STEP = 64;

export function buildTimeline(
  events: RrwebEvent[],
  extras: {
    startedAt: number;
    endedAt: number;
    /** Duración observada de la grabación; si existe manda sobre endedAt - primer evento. */
    durationMs?: number;
    navigations?: NavigationEvent[];
    errors?: RecordedError[];
    console?: ConsoleEntry[];
    network?: { t: number; url: string; status: number; resourceType: string; failed: boolean }[];
  },
): Timeline {
  const first = events[0]?.timestamp ?? extras.startedAt;
  const last = events[events.length - 1]?.timestamp ?? extras.endedAt;
  const marks: TimelineMark[] = [];
  const push = (t: number, type: TimelineMark['type'], label: string, detail?: string) => {
    const at = Math.max(0, t - first);
    marks.push(detail === undefined ? { t, at, type, label } : { t, at, type, label, detail });
  };

  for (const nav of extras.navigations ?? []) push(nav.t, 'navigation', `Navegación (${nav.kind})`, nav.to);
  for (const err of extras.errors ?? []) push(err.t, 'error', `Error: ${err.type}`, err.message.slice(0, 200));
  for (const entry of extras.console ?? []) {
    if (entry.level === 'error' || entry.level === 'warn') push(entry.t, 'console', `console.${entry.level}`, entry.message.slice(0, 200));
  }
  for (const net of extras.network ?? []) {
    if (net.failed || net.status >= 400) push(net.t, 'network', `${net.status} ${net.resourceType}`, net.url);
  }
  for (const event of events) {
    if (event.type === RRWEB.FullSnapshot) push(event.timestamp, 'snapshot', 'Snapshot completo');
    else if (event.type === RRWEB.Meta) push(event.timestamp, 'snapshot', 'Meta inicial');
    else if (event.type === RRWEB.Load) push(event.timestamp, 'marker', 'Load');
    else if (event.type === RRWEB.DomContentLoaded) push(event.timestamp, 'marker', 'DOMContentLoaded');
  }
  marks.sort((a, b) => a.at - b.at);

  const index: { t: number; i: number }[] = [];
  for (let i = 0; i < events.length; i += INDEX_STEP) index.push({ t: events[i].timestamp - first, i });

  return {
    version: 1,
    startedAt: extras.startedAt,
    endedAt: extras.endedAt,
    durationMs: Math.max(0, extras.durationMs ?? extras.endedAt - first),
    eventCount: events.length,
    firstEventAt: first,
    lastEventAt: last,
    marks,
    index,
  };
}

/** Índice del último evento con timestamp <= t (ms desde el inicio). */
export function seekIndex(events: RrwebEvent[], tFromStart: number): number {
  if (events.length === 0) return -1;
  const target = events[0].timestamp + Math.max(0, tFromStart);
  let lo = 0;
  let hi = events.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].timestamp <= target) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`;
}

export function eventTypeLabel(type: number): string {
  switch (type) {
    case RRWEB.DomContentLoaded: return 'DOMContentLoaded';
    case RRWEB.Load: return 'Load';
    case RRWEB.FullSnapshot: return 'FullSnapshot';
    case RRWEB.IncrementalSnapshot: return 'Incremental';
    case RRWEB.Meta: return 'Meta';
    case RRWEB.Custom: return 'Custom';
    case RRWEB.Plugin: return 'Plugin';
    default: return `Tipo ${type}`;
  }
}

export function incrementalLabel(kind: number | undefined): string {
  if (kind === undefined) return '';
  const names: Record<number, string> = {
    0: 'mutación DOM',
    1: 'movimiento',
    2: 'interacción',
    3: 'scroll',
    4: 'resize',
    5: 'input',
    6: 'touch',
    7: 'media',
    8: 'styleSheet',
    9: 'canvas',
    10: 'font',
    11: 'log',
    12: 'drag',
    13: 'styleDeclaration',
    14: 'selection',
    15: 'adoptedStyleSheet',
    16: 'customElement',
  };
  return names[kind] ?? String(kind);
}
