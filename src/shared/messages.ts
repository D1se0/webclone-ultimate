/** Mensajes entre popup, background y content scripts. */

import type {
  AssetDescriptor,
  AssetKind,
  CapturedNetworkEntry,
  CaptureOptions,
  CaptureProgress,
  CaptureReport,
  FailedResource,
  PageState,
  RecordingMeta,
  RecordingOptions,
  SessionKind,
  SessionMeta,
} from './types';

export interface AssetResolveRequest {
  url: string;
  kind: AssetKind;
  /** true si la URL es data: y debe decodificarse en el background. */
  inline?: boolean;
  /** Metadatos de una petición observada por los hooks de red de la página. */
  network?: {
    method: string;
    status: number;
    mime: string;
    resourceType: string;
    requestBodyBase64?: string;
    requestMime?: string;
    requestHeaders?: Record<string, string>;
    responseHeaders?: Record<string, string>;
    bodyBase64?: string;
  };
}

export interface AssetResolveResponse {
  ok: boolean;
  assets: AssetDescriptor[];
  /** url original -> ruta local dentro del paquete */
  map: Record<string, string>;
  failures: FailedResource[];
  /** path -> texto CSS (para poder inlinear @import) */
  cssTexts: Record<string, string>;
  totalBytes: number;
  /** Respuestas de red listas para el runtime del clon. */
  network?: CapturedNetworkEntry[];
  error?: string;
}

export type ContentRequest =
  | { type: 'WC_PING' }
  | { type: 'WC_CAPTURE_CLONE'; options?: Partial<CaptureOptions> }
  | { type: 'WC_START_RECORDING'; options?: Partial<RecordingOptions> }
  | { type: 'WC_STOP_RECORDING' }
  | { type: 'WC_RECORDING_STATE' }
  | { type: 'WC_RESOLVE_ASSETS'; sessionId: string; requests: AssetResolveRequest[]; options: Partial<CaptureOptions>; network?: unknown[] }
  | { type: 'WC_FETCH_SOURCE'; url: string; options?: Partial<CaptureOptions> }
  | { type: 'WC_START_FULL'; sessionId: string; options: Partial<CaptureOptions> }
  | { type: 'WC_FULL_ATTACH'; sessionId: string; startedAt: number; options: Partial<CaptureOptions> }
  | { type: 'WC_STOP_FULL' }
  | { type: 'WC_FULL_STATE' }
  | { type: 'WC_NETWORK_ENTRY'; sessionId: string; entry: unknown }
  | { type: 'WC_GET_NETWORK_CAPTURED'; sessionId: string }
  | { type: 'WC_GET_NETWORK_SEEN'; sessionId: string }
  | { type: 'WC_SAVE_CLONE'; sessionId: string; html: string; state: PageState; report: CaptureReport; extraFiles: { path: string; text: string }[]; network?: CapturedNetworkEntry[] }
  | { type: 'WC_SAVE_RECORDING'; sessionId: string; events: unknown[]; report: CaptureReport; recordingMeta: RecordingMeta }
  | { type: 'WC_CAPTURE_FAILED'; sessionId: string; error: string; phase: string }
  | { type: 'WC_PROGRESS'; sessionId?: string; progress: CaptureProgress }
  | { type: 'WC_RECORDING_CHUNK'; sessionId: string; events: unknown[] }
  | { type: 'WC_CAPTURE_SCREENSHOT'; sessionId: string; dataUrl: string; width: number; height: number };

export type BackgroundRequest =
  | { type: 'WC_SESSION_LIST' }
  | { type: 'WC_SESSION_GET'; id: string }
  | { type: 'WC_SESSION_DELETE'; id: string }
  | { type: 'WC_SESSION_EXPORT'; id: string }
  | { type: 'WC_IMPORT_SESSION'; name: string; dataBase64: string }
  | { type: 'WC_STORAGE_INFO' }
  | { type: 'WC_START_CAPTURE'; tabId?: number; options?: Partial<CaptureOptions> }
  | { type: 'WC_START_RECORD'; tabId?: number; options?: Partial<RecordingOptions> }
  | { type: 'WC_START_FULL_CAPTURE'; tabId?: number; options?: Partial<CaptureOptions>; sessionCookie?: string }
  | { type: 'WC_STOP_FULL_CAPTURE'; tabId?: number }
  | { type: 'WC_STOP_RECORD'; tabId?: number }
  | { type: 'WC_GET_TAB_STATUS'; tabId?: number }
  | { type: 'WC_FETCH_SOURCE'; url: string }
  | { type: 'WC_CANCEL_CAPTURE' }
  | { type: 'WC_OPEN_REPLAY'; id: string }
  | { type: 'WC_EXPORT_SESSION_TO_DOWNLOAD'; id: string };

export interface SessionListResponse {
  ok: boolean;
  sessions: SessionMeta[];
  error?: string;
}

export interface SessionGetResponse {
  ok: boolean;
  session?: {
    meta: SessionMeta;
    kind: SessionKind;
    html?: string;
    state?: PageState;
    report?: CaptureReport;
    events?: unknown[];
    recordingMeta?: unknown;
    assetPaths?: string[];
    timeline?: unknown;
  };
  error?: string;
}

export interface RecordingStateResponse {
  ok: boolean;
  recording: boolean;
  sessionId?: string;
  startedAt?: number;
  eventCount?: number;
  assetBytes?: number;
  elapsedMs?: number;
}

export interface TabStatusResponse {
  ok: boolean;
  tabId?: number;
  url?: string;
  title?: string;
  recording: boolean;
  full?: boolean;
  fullRequests?: number;
  busy: boolean;
  sessionId?: string;
  progress?: CaptureProgress;
  eventCount?: number;
  elapsedMs?: number;
  assetBytes?: number;
  error?: string;
}

export interface StorageInfoResponse {
  ok: boolean;
  usage: number;
  quota: number;
  sessions: number;
  error?: string;
}

export type AnyRequest = ContentRequest | BackgroundRequest;

export function isBackgroundRequest(message: unknown): message is BackgroundRequest {
  const type = (message as { type?: string } | null)?.type ?? '';
  return type.startsWith('WC_SESSION') || type === 'WC_IMPORT_SESSION' || type === 'WC_STORAGE_INFO';
}
