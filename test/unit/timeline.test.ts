import { describe, expect, it } from 'vitest';
import { buildTimeline, eventTypeLabel, formatDuration, incrementalLabel, seekIndex, type RrwebEvent } from '../../src/shared/timeline';

const events: RrwebEvent[] = [
  { type: 4, data: { href: 'https://x.test/' }, timestamp: 1000 },
  { type: 2, data: { node: {} }, timestamp: 1001 },
  { type: 3, data: { source: 2 }, timestamp: 1500 },
  { type: 3, data: { source: 3 }, timestamp: 3000 },
];

describe('timeline', () => {
  it('construye duración, marcas e índice', () => {
    const timeline = buildTimeline(events, {
      startedAt: 900,
      endedAt: 4000,
      navigations: [{ t: 3200, from: 'https://x.test/', to: 'https://x.test/b', kind: 'push' }],
      errors: [{ t: 2000, type: 'error', message: 'boom' }],
    });
    expect(timeline.durationMs).toBe(3000);
    expect(timeline.eventCount).toBe(4);
    expect(timeline.marks.some((m) => m.type === 'navigation')).toBe(true);
    expect(timeline.marks.some((m) => m.type === 'error' && m.detail === 'boom')).toBe(true);
    expect(timeline.marks.some((m) => m.type === 'snapshot')).toBe(true);
    expect(timeline.marks.map((m) => m.at)).toEqual([...timeline.marks.map((m) => m.at)].sort((a, b) => a - b));
    expect(timeline.index[0]).toEqual({ t: 0, i: 0 });
  });

  it('busca el índice temporal', () => {
    expect(seekIndex(events, 0)).toBe(0);
    expect(seekIndex(events, 400)).toBe(1);
    expect(seekIndex(events, 500)).toBe(2);
    expect(seekIndex(events, 999999)).toBe(3);
    expect(seekIndex([], 10)).toBe(-1);
  });

  it('formatea duración', () => {
    expect(formatDuration(0)).toBe('0:00.0');
    expect(formatDuration(65_400)).toBe('1:05.4');
  });

  it('etiqueta tipos de evento', () => {
    expect(eventTypeLabel(2)).toBe('FullSnapshot');
    expect(eventTypeLabel(3)).toBe('Incremental');
    expect(eventTypeLabel(99)).toBe('Tipo 99');
    expect(incrementalLabel(2)).toBe('interacción');
    expect(incrementalLabel(undefined)).toBe('');
  });
});
