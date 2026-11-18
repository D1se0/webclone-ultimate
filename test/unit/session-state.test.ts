import { describe, expect, it } from 'vitest';
import { captureSessionState } from '../../src/core/session-state';

function makeDoc(storage: Record<string, string>, href = 'https://example.test/app?p=http&token=secret#top') {
  const values = { ...storage };
  const localStorage = {
    get length() {
      return Object.keys(values).length;
    },
    key(index: number) {
      return Object.keys(values)[index] ?? null;
    },
    getItem(key: string) {
      return values[key] ?? null;
    },
  };
  const sessionStorage = { length: 0, key: () => null, getItem: () => null };
  return {
    URL: href,
    defaultView: { localStorage, sessionStorage },
  } as unknown as Document;
}

describe('captureSessionState', () => {
  it('restaura storage no sensible y elimina tokens de la ruta', () => {
    const state = captureSessionState(makeDoc({ 'app:count': '2', authToken: 'nope', theme: 'dark' }), {
      startedAt: Date.parse('2026-01-01T00:00:00Z'),
      interactions: 3,
      navigations: ['https://example.test/app?p=http&api_key=secret'],
    });
    expect(state.storage.local).toEqual({ 'app:count': '2', theme: 'dark' });
    expect(state.route).toBe('/app?p=http#top');
    expect(state.omittedKeys).toContain('authToken');
    expect(state.interactions).toBe(3);
    expect(state.navigations[0]).toBe('/app?p=http');
  });

  it('tolera storage bloqueado y documentos sin defaultView', () => {
    const doc = { URL: 'https://example.test/', defaultView: null } as unknown as Document;
    const state = captureSessionState(doc, { startedAt: Date.now(), interactions: 0, navigations: [] });
    expect(state.storage).toEqual({ local: {}, session: {} });
    expect(state.route).toBe('/');
  });

  it('trunca valores demasiado grandes y los marca como omitidos', () => {
    const state = captureSessionState(makeDoc({ huge: 'x'.repeat(70 * 1024), small: 'ok' }), {
      startedAt: Date.now(),
      interactions: 1,
      navigations: [],
    });
    expect(state.storage.local.small).toBe('ok');
    expect(state.storage.local.huge).toBeUndefined();
    expect(state.omittedKeys).toContain('huge');
  });
});
