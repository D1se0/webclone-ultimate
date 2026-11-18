/** Persistencia local (IndexedDB del origen de la extensión). */

import type {
  CaptureReport,
  CapturedNetworkEntry,
  PageState,
  RecordingMeta,
  SessionKind,
  SessionMeta,
} from '../shared/types';
import type { Timeline } from '../shared/timeline';

const DB_NAME = 'webclone-ultimate';
const DB_VERSION = 2;

export interface SessionRecord {
  id: string;
  kind: SessionKind;
  meta: SessionMeta;
  report: CaptureReport;
  html?: string;
  state?: PageState;
  extraFiles?: { path: string; text: string }[];
  recordingMeta?: RecordingMeta;
  timeline?: Timeline;
  assetPaths: string[];
  network?: CapturedNetworkEntry[];
  screenshot?: { dataUrl: string; width: number; height: number };
}

export interface AssetRecord {
  key: string;
  sessionId: string;
  path: string;
  data: ArrayBuffer;
  bytes: number;
  mime: string;
}

export interface EventsRecord {
  key: string;
  sessionId: string;
  seq: number;
  events: unknown[];
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('sessions')) {
        const store = db.createObjectStore('sessions', { keyPath: 'id' });
        store.createIndex('createdAt', 'meta.createdAt');
        store.createIndex('kind', 'kind');
      }
      if (!db.objectStoreNames.contains('assets')) {
        const store = db.createObjectStore('assets', { keyPath: 'key' });
        store.createIndex('sessionId', 'sessionId');
      }
      if (!db.objectStoreNames.contains('events')) {
        const store = db.createObjectStore('events', { keyPath: 'key' });
        store.createIndex('sessionId', 'sessionId');
      }
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB no disponible'));
    request.onsuccess = () => resolve(request.result);
  });
  return dbPromise;
}

async function tx<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let request: IDBRequest<T> | void;
    try {
      request = fn(store);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => {
      resolve((request as IDBRequest<T> | undefined)?.result as T);
    };
    transaction.onerror = () => reject(transaction.error ?? new Error('transacción IndexedDB fallida'));
    transaction.onabort = () => reject(transaction.error ?? new Error('transacción abortada'));
  });
}

export async function saveSession(record: SessionRecord): Promise<void> {
  await tx('sessions', 'readwrite', (store) => store.put(record));
}

export async function getSession(id: string): Promise<SessionRecord | undefined> {
  return tx<SessionRecord | undefined>('sessions', 'readonly', (store) => store.get(id));
}

export async function listSessions(): Promise<SessionMeta[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('sessions', 'readonly');
    const store = transaction.objectStore('sessions');
    const request = store.getAll();
    request.onsuccess = () => {
      const records = (request.result as SessionRecord[]) ?? [];
      resolve(records.map((r) => r.meta).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
    };
    request.onerror = () => reject(request.error ?? new Error('no se pudo listar sesiones'));
  });
}

export async function deleteSession(id: string): Promise<void> {
  await tx('sessions', 'readwrite', (store) => store.delete(id));
  await deleteAssets(id);
  await tx('events', 'readwrite', (store) => {
    const index = store.index('sessionId');
    const cursorRequest = index.openKeyCursor(IDBKeyRange.only(id));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
  });
}

export async function saveAssets(sessionId: string, assets: { path: string; data: ArrayBuffer; mime: string }[]): Promise<void> {
  if (assets.length === 0) return;
  await tx('assets', 'readwrite', (store) => {
    for (const asset of assets) {
      const record: AssetRecord = {
        key: `${sessionId}::${asset.path}`,
        sessionId,
        path: asset.path,
        data: asset.data,
        bytes: asset.data.byteLength,
        mime: asset.mime,
      };
      store.put(record);
    }
  });
}

export async function deleteAssets(sessionId: string): Promise<void> {
  await tx('assets', 'readwrite', (store) => {
    const index = store.index('sessionId');
    const cursorRequest = index.openKeyCursor(IDBKeyRange.only(sessionId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
  });
}

export async function listAssets(sessionId: string): Promise<AssetRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('assets', 'readonly');
    const index = transaction.objectStore('assets').index('sessionId');
    const request = index.getAll(IDBKeyRange.only(sessionId));
    request.onsuccess = () => resolve((request.result as AssetRecord[]) ?? []);
    request.onerror = () => reject(request.error ?? new Error('no se pudieron leer assets'));
  });
}

export async function appendEvents(sessionId: string, events: unknown[], startSeq: number): Promise<number> {
  if (events.length === 0) return startSeq;
  const record: EventsRecord = { key: `${sessionId}::${startSeq}`, sessionId, seq: startSeq, events };
  await tx('events', 'readwrite', (store) => store.put(record));
  return startSeq + 1;
}

export async function clearEvents(sessionId: string): Promise<void> {
  await tx('events', 'readwrite', (store) => {
    const index = store.index('sessionId');
    const cursorRequest = index.openKeyCursor(IDBKeyRange.only(sessionId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
  });
}

export async function readEvents(sessionId: string): Promise<unknown[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('events', 'readonly');
    const index = transaction.objectStore('events').index('sessionId');
    const request = index.getAll(IDBKeyRange.only(sessionId));
    request.onsuccess = () => {
      const records = (request.result as EventsRecord[]) ?? [];
      records.sort((a, b) => a.seq - b.seq);
      resolve(records.flatMap((r) => r.events));
    };
    request.onerror = () => reject(request.error ?? new Error('no se pudieron leer eventos'));
  });
}

export async function storageInfo(): Promise<{ usage: number; quota: number }> {
  if (navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  }
  return { usage: 0, quota: 0 };
}
