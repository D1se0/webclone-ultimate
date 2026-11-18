/**
 * Tipos compartidos entre content script, background, popup y player.
 * Este módulo debe permanecer libre de APIs de navegador para poder testearse en Node.
 */

export type SessionKind = 'clone' | 'recording';
export type AssetKind = 'image' | 'font' | 'css' | 'js' | 'video' | 'audio' | 'other';
export type AssetStatus = 'captured' | 'failed' | 'skipped';

export interface AssetDescriptor {
  /** Ruta relativa dentro del paquete, p.ej. assets/images/ab12cd.png */
  path: string;
  /** URL absoluta original (saneada para el informe). */
  url: string;
  /** URL absoluta real usada para descargar (puede llevar query sensible, no se exporta). */
  fetchUrl?: string;
  kind: AssetKind;
  mime: string;
  bytes: number;
  sha256: string;
  status: AssetStatus;
  reason?: string;
  affectsFidelity: boolean;
  alternative?: string;
}

export interface CapturedAssetBlob {
  path: string;
  data: ArrayBuffer;
}

export interface FailedResource {
  url: string;
  kind: AssetKind;
  reason: string;
  /** Restricción técnica encontrada (CORS, DRM, 403, timeout, tamaño...). */
  restriction: string;
  affectsFidelity: boolean;
  alternative: string;
}

export interface FormFieldState {
  wcId: string;
  tag: string;
  type?: string;
  value?: string;
  checked?: boolean;
  selectedIndex?: number;
  selectedValues?: string[];
  redacted?: boolean;
  /** Motivo por el que un campo no se ha guardado (p.ej. password, autocomplete=cc-number). */
  excludedReason?: string;
}

export interface ScrollState {
  wcId: string;
  target: 'window' | 'element';
  top: number;
  left: number;
}

export interface MediaState {
  wcId: string;
  tag: 'video' | 'audio';
  currentTime: number;
  paused: boolean;
  volume: number;
  muted: boolean;
  playbackRate: number;
  duration: number | null;
  loop: boolean;
  poster?: string;
  /** false si el medio no pudo descargarse (p.ej. streaming DRM). */
  captured: boolean;
  note?: string;
}

export interface CanvasState {
  wcId: string;
  width: number;
  height: number;
  mode: 'image' | 'unsupported';
  assetPath?: string;
  reason?: string;
}

export interface OpenState {
  wcId: string;
  open: boolean;
}

export interface PageState {
  version: 1;
  url: string;
  title: string;
  capturedAt: string;
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
    devicePixelRatio: number;
  };
  forms: FormFieldState[];
  scrollables: ScrollState[];
  media: MediaState[];
  canvases: CanvasState[];
  details: OpenState[];
  dialogs: OpenState[];
  popovers: OpenState[];
  /** Recursos presentes en el DOM pero no capturados, para avisar en el clon. */
  missing: FailedResource[];
  /** true si el clon ejecuta el JavaScript original. */
  dynamic?: boolean;
}

/** Respuesta de red capturada y reproducible desde el clon. */
export interface CapturedNetworkEntry {
  /** Identificador de la ocurrencia (permite repetir la misma petición). */
  id?: string;
  /** Momento de la respuesta respecto a la captura. */
  t?: number;
  url: string;
  method: string;
  status: number;
  mime: string;
  resourceType: string;
  /** Cuerpo de la petición en base64 (POST/PUT/PATCH). */
  requestBodyBase64?: string;
  /** MIME del cuerpo enviado. */
  requestMime?: string;
  /** Cabeceras de petición no sensibles. */
  requestHeaders?: Record<string, string>;
  /** Cabeceras de respuesta no sensibles. */
  responseHeaders?: Record<string, string>;
  /** Cuerpo de respuesta en base64 (texto/JSON/binario pequeño). */
  bodyBase64?: string;
  /** Ruta local del cuerpo dentro del paquete (respuestas grandes o binarias). */
  bodyPath?: string;
  captured: boolean;
  note?: string;
}

/** Estado de una sesión interactiva que se restaura al abrir el clon. */
export interface CapturedSessionState {
  startedAt: string;
  endedAt: string;
  url: string;
  /** Ruta y query que la aplicación espera al arrancar. */
  route: string;
  storage: {
    local: Record<string, string>;
    session: Record<string, string>;
  };
  /** Claves omitidas por privacidad o tamaño. */
  omittedKeys: string[];
  truncated: boolean;
  interactions: number;
  navigations: string[];
}

export interface CaptureCounts {
  elements: number;
  shadowRoots: number;
  iframes: number;
  framesCaptured: number;
  stylesheets: number;
  stylesheetsInlined: number;
  assetsCaptured: number;
  assetsFailed: number;
  canvases: number;
  canvasesUnsupported: number;
  media: number;
  mediaCaptured: number;
  forms: number;
  scriptsStripped: number;
  /** Scripts conservados/ejecutados (modo dinámico). */
  scriptsKept?: number;
  /** Respuestas de red capturadas con cuerpo reproducible. */
  responsesCaptured?: number;
}

export interface FidelityBreakdown {
  /** Heurística basada en recursos y capacidades, NO es una comparación visual. */
  resourceScore: number;
  assetTotal: number;
  assetCaptured: number;
  notes: string[];
}

export interface CaptureReport {
  version: 1;
  sessionId: string;
  kind: SessionKind;
  url: string;
  title: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  browser: { name: string; version: string; userAgent: string };
  viewport: PageState['viewport'];
  counts: CaptureCounts;
  bytes: { html: number; assets: number; total: number; zip?: number };
  fidelity: FidelityBreakdown;
  failures: FailedResource[];
  unsupported: string[];
  options: CaptureOptions;
  /** Presente en un clon completo con sesión interactiva. */
  session?: CapturedSessionState;
}

export interface CaptureOptions {
  /** Captura recursos binarios (imágenes, fuentes, media). */
  captureAssets: boolean;
  /** Tamaño máximo por recurso en bytes. */
  maxAssetBytes: number;
  /** Tamaño máximo total de recursos en bytes. */
  maxTotalAssetBytes: number;
  /** Incluye credenciales al descargar recursos (cookies). Desactivado por defecto. */
  includeCredentials: boolean;
  /** Conserva etiquetas <script> de la página en el clon (compatibilidad). */
  keepScripts: boolean;
  /** Clon dinámico: conserva y ejecuta el JavaScript de la página (recomendado). */
  dynamic: boolean;
  /** Base del clon dinámico: HTML fuente original o DOM ya hidratado. */
  dynamicBase?: 'source' | 'live';
  /** Intenta ejecutar JS incluso en frameworks de hidratación (puede fallar). */
  forceDynamic?: boolean;
  /** Escucha la red y captura cuerpos de respuesta para reproducirlos offline. */
  captureNetwork: boolean;
  /** Modo completo: sesión iniciada por el usuario, con storage y ruta restaurables. */
  fullSession?: boolean;
  /** Restaura localStorage/sessionStorage no sensibles en el clon. */
  captureStorage?: boolean;
  /** Tiempo de asentamiento antes de serializar (recoge red y mutaciones tardías). */
  settleMs: number;
  /** Tamaño máximo de un cuerpo de respuesta de red en bytes. */
  maxResponseBytes: number;
  /** Número máximo de entradas de red que se conservan. */
  maxNetworkEntries: number;
  /** Captura iframes del mismo origen de forma recursiva. */
  captureFrames: boolean;
  /** Profundidad máxima de iframes anidados. */
  maxFrameDepth: number;
  /** Sustituye canvas por imagen del contenido actual. */
  captureCanvas: boolean;
  /** Enmascara valores de campos sensibles. */
  maskSensitive: boolean;
  /** Patrón adicional de selectores a excluir (privacidad). */
  excludeSelectors: string[];
}

export const DEFAULT_CAPTURE_OPTIONS: CaptureOptions = {
  captureAssets: true,
  maxAssetBytes: 25 * 1024 * 1024,
  maxTotalAssetBytes: 300 * 1024 * 1024,
  includeCredentials: false,
  keepScripts: false,
  dynamic: true,
  captureNetwork: true,
  fullSession: false,
  captureStorage: false,
  settleMs: 900,
  maxResponseBytes: 4 * 1024 * 1024,
  maxNetworkEntries: 600,
  captureFrames: true,
  maxFrameDepth: 2,
  captureCanvas: true,
  maskSensitive: true,
  excludeSelectors: ['[data-webclone-exclude]'],
};

export interface RecordingOptions {
  /** Captura de canvas (puede ser costoso en páginas con muchos canvas). */
  recordCanvas: boolean;
  /** Muestreo de movimiento del ratón (ms). */
  samplingMss: number;
  /** Captura de iframes same-origin por rrweb. */
  recordCrossOriginIframes: boolean;
  /** Máximo de eventos en memoria antes de forzar volcado. */
  maxEvents: number;
  /** Límite de duración en ms (0 = sin límite). */
  maxDurationMs: number;
  /** Captura recursos binarios de la página al iniciar. */
  captureAssets: boolean;
  /** Incluye cabeceras/cuerpos de red accesibles. */
  captureNetwork: boolean;
}

export const DEFAULT_RECORDING_OPTIONS: RecordingOptions = {
  recordCanvas: true,
  samplingMss: 100,
  recordCrossOriginIframes: false,
  maxEvents: 400000,
  maxDurationMs: 30 * 60 * 1000,
  captureAssets: true,
  captureNetwork: true,
};

export interface RecordingMeta {
  id: string;
  url: string;
  title: string;
  startedAt: string;
  endedAt?: string;
  durationMs: number;
  eventCount: number;
  assetCount: number;
  assetBytes: number;
  errors: RecordedError[];
  navigations: NavigationEvent[];
  network: NetworkEntry[];
  console: ConsoleEntry[];
  options: RecordingOptions;
}

export interface RecordedError {
  t: number;
  message: string;
  source?: string;
  line?: number;
  column?: number;
  stack?: string;
  type: 'error' | 'unhandledrejection' | 'resource' | 'console';
}

export interface NavigationEvent {
  t: number;
  from: string;
  to: string;
  kind: 'push' | 'replace' | 'pop' | 'load' | 'hash';
}

export interface NetworkEntry {
  t: number;
  url: string;
  method: string;
  status: number;
  resourceType: string;
  durationMs: number;
  transferSize: number;
  failed: boolean;
  sameOrigin: boolean;
}

export interface ConsoleEntry {
  t: number;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

export interface SessionMeta {
  id: string;
  kind: SessionKind;
  url: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  durationMs: number;
  eventCount: number;
  assetCount: number;
  assetBytes: number;
  status: 'capturing' | 'complete' | 'partial' | 'failed';
  integrity: 'unknown' | 'ok' | 'broken';
  errorCount: number;
  fingerprint: string;
}

/** Contenido completo de un clon listo para exportar. */
export interface ClonePackage {
  html: string;
  state: PageState;
  report: CaptureReport;
  assets: CapturedAssetBlob[];
  /** Ficheros extra ya resueltos (frames, css sueltos...). */
  extraFiles: { path: string; text: string }[];
  /** Respuestas de red capturadas (para informes y auditoría). */
  network?: CapturedNetworkEntry[];
  screenshot?: { dataUrl: string; width: number; height: number };
}

export interface RecordingPackage {
  meta: RecordingMeta;
  events: unknown[];
  assets: CapturedAssetBlob[];
  report: CaptureReport;
  screenshot?: { dataUrl: string; width: number; height: number };
}

export type SessionPayload = ClonePackage | RecordingPackage;

export interface StoredSession {
  meta: SessionMeta;
  payload: SessionPayload;
}

export interface CaptureProgress {
  phase:
    | 'idle'
    | 'analyzing'
    | 'serializing'
    | 'styles'
    | 'assets'
    | 'frames'
    | 'compressing'
    | 'saving'
    | 'done'
    | 'error';
  message: string;
  percent: number;
  detail?: string;
}

export function isClonePackage(p: SessionPayload): p is ClonePackage {
  return (p as ClonePackage).html !== undefined;
}

export function isRecordingPackage(p: SessionPayload): p is RecordingPackage {
  return (p as RecordingPackage).events !== undefined;
}
