import { ext, runtimeSend, detectBrowser, storageGet, storageSet, downloadBytes } from '../shared/ext';
import { formatBytes } from '../shared/zip';
import { base64ToBytes, bytesToBase64 } from '../shared/base64';
import { DEFAULT_CAPTURE_OPTIONS, type CaptureOptions, type SessionMeta } from '../shared/types';
import type { SessionGetResponse, SessionListResponse, StorageInfoResponse, TabStatusResponse } from '../shared/messages';

interface Settings {
  captureAssets: boolean;
  includeCredentials: boolean;
  captureCanvas: boolean;
  captureFrames: boolean;
  dynamic: boolean;
  forceDynamic: boolean;
  captureNetwork: boolean;
  maxAssetMB: number;
  maxTotalMB: number;
}

const DEFAULT_SETTINGS: Settings = {
  captureAssets: true,
  includeCredentials: false,
  captureCanvas: true,
  captureFrames: true,
  dynamic: true,
  forceDynamic: false,
  captureNetwork: true,
  maxAssetMB: Math.round(DEFAULT_CAPTURE_OPTIONS.maxAssetBytes / 1024 / 1024),
  maxTotalMB: Math.round(DEFAULT_CAPTURE_OPTIONS.maxTotalAssetBytes / 1024 / 1024),
};

const settingsKey = 'wc:settings';

const state = {
  settings: { ...DEFAULT_SETTINGS },
  tabId: undefined as number | undefined,
  tabUrl: '',
  tabTitle: '',
  tabWidth: 0,
  tabHeight: 0,
  status: null as TabStatusResponse | null,
  sessions: [] as SessionMeta[],
  selectedId: '' as string,
  lastProgressPhase: '',
  busy: false,
  tickBase: 0,
  tickAt: 0,
};

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector(selector) as T;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showBanner(message: string, kind: 'error' | 'ok' = 'error'): void {
  const banner = $<HTMLDivElement>('#banner');
  banner.textContent = message;
  banner.className = `banner${kind === 'ok' ? ' ok' : ''}`;
  banner.hidden = false;
  window.setTimeout(() => {
    banner.hidden = true;
  }, 6000);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function domainOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url || '—';
  }
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function setBusy(busy: boolean): void {
  state.busy = busy;
  const full = !!state.status?.full;
  ($('#btn-clone') as HTMLButtonElement).disabled = busy || full || !canCapture();
  ($('#btn-record') as HTMLButtonElement).disabled = busy || full || !canCapture();
  ($('#btn-full') as HTMLButtonElement).disabled = busy || full || !canCapture();
}

function canCapture(): boolean {
  if (!state.tabId) return false;
  return !/^(chrome|edge|about|moz-extension|chrome-extension|view-source):/i.test(state.tabUrl);
}

function captureOptions(): Partial<CaptureOptions> {
  return {
    captureAssets: state.settings.captureAssets,
    includeCredentials: state.settings.includeCredentials,
    captureCanvas: state.settings.captureCanvas,
    captureFrames: state.settings.captureFrames,
    dynamic: state.settings.dynamic,
    forceDynamic: state.settings.forceDynamic,
    captureNetwork: state.settings.captureNetwork,
    settleMs: 900,
    maxAssetBytes: Math.max(1, state.settings.maxAssetMB) * 1024 * 1024,
    maxTotalAssetBytes: Math.max(1, state.settings.maxTotalMB) * 1024 * 1024,
    maskSensitive: true,
    keepScripts: false,
  };
}

// ---------------------------------------------------------------- render

function renderHeader(): void {
  const browser = detectBrowser();
  $('#version').textContent = ext.runtime.getManifest().version;
  const statusEl = $('#engine-status');
  if (state.status?.full) {
    statusEl.className = 'status busy';
    statusEl.querySelector('span')!.textContent = 'Sesión completa';
  } else if (state.status?.busy) {
    statusEl.className = 'status busy';
    statusEl.querySelector('span')!.textContent = 'Capturando';
  } else if (state.status?.recording) {
    statusEl.className = 'status busy';
    statusEl.querySelector('span')!.textContent = 'Grabando';
  } else {
    statusEl.className = 'status';
    statusEl.querySelector('span')!.textContent = 'Listo';
  }
  $('#browser').textContent = `${browser.name} ${browser.version.split('.')[0]}`;
  void browser;
}

function renderPage(): void {
  $('#page-title').textContent = state.tabTitle || 'Pestaña sin título';
  $('#page-url').textContent = state.tabUrl || '—';
  $('#tab-kind').textContent = canCapture() ? 'Pestaña web' : 'No capturable';
  $('#viewport-chip').textContent = state.tabWidth ? `${state.tabWidth}×${state.tabHeight}` : '—';
  const recChip = $('#rec-chip');
  recChip.hidden = !state.status?.recording;
  recChip.className = 'chip live';
}

function renderProgress(): void {
  const wrap = $('#progress-wrap');
  const progress = state.status?.progress;
  if (state.status?.full || !progress || (!state.status?.busy && progress.phase === 'idle')) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  $('#progress-msg').textContent = progress.message;
  $('#progress-pct').textContent = `${Math.round(progress.percent)}%`;
  $('#progress-bar').style.width = `${Math.min(100, progress.percent)}%`;
}

function renderRecording(): void {
  const panel = $('#rec-panel');
  const recording = !!state.status?.recording || (state.status?.busy && state.status?.sessionId?.startsWith('rec_'));
  panel.hidden = !recording;
  if (!recording) return;
  const elapsed = state.status?.elapsedMs ?? 0;
  const extra = state.tickBase ? Math.max(0, Date.now() - state.tickAt) : 0;
  $('#rec-timer').textContent = formatDuration(elapsed + extra);
  $('#rec-events').textContent = String(state.status?.eventCount ?? 0);
  $('#rec-size').textContent = formatBytes(state.status?.assetBytes ?? 0);
}

function renderFull(): void {
  const panel = $('#full-panel');
  const full = !!state.status?.full;
  panel.hidden = !full;
  if (!full) return;
  const elapsed = state.status?.elapsedMs ?? 0;
  const extra = state.tickBase ? Math.max(0, Date.now() - state.tickAt) : 0;
  $('#full-timer').textContent = formatDuration(elapsed + extra);
  $('#full-requests').textContent = String(state.status?.fullRequests ?? 0);
}

function renderSessions(): void {
  const container = $('#sessions');
  if (state.sessions.length === 0) {
    container.innerHTML = '<div class="empty">Sin capturas todavía. Pulsa INSTANT CLONE para empezar.</div>';
    return;
  }
  container.innerHTML = state.sessions
    .map((session) => {
      const integrity =
        session.integrity === 'ok'
          ? '<span class="badge-ok">íntegra</span>'
          : session.integrity === 'broken'
            ? '<span class="badge-bad">dañada</span>'
            : '<span class="badge-warn">sin verificar</span>';
      return `<div class="session${session.id === state.selectedId ? ' active' : ''}" data-id="${escapeHtml(session.id)}">
        <div class="session-top">
          <span class="session-kind ${session.kind}">${session.kind === 'clone' ? 'clone' : 'rec'}</span>
          <span class="session-title" title="${escapeHtml(session.title)}">${escapeHtml(session.title || 'Sin título')}</span>
          <span class="session-actions">
            ${session.kind === 'recording' ? `<button class="icon-btn" data-action="play" title="Reproducir"><svg><use href="#i-play"/></svg></button>` : ''}
            <button class="icon-btn" data-action="export" title="Exportar ZIP"><svg><use href="#i-download"/></svg></button>
            <button class="icon-btn" data-action="delete" title="Eliminar"><svg><use href="#i-trash"/></svg></button>
          </span>
        </div>
        <div class="session-stats">
          <span title="Dominio">${escapeHtml(domainOf(session.url))}</span>
          <span>${escapeHtml(formatDate(session.createdAt))}</span>
          <span>${session.kind === 'recording' ? formatDuration(session.durationMs) : `${session.durationMs} ms`}</span>
          <span>${formatBytes(session.assetBytes)}</span>
          ${session.kind === 'recording' ? `<span>${session.eventCount} ev.</span>` : ''}
          <span>${integrity}</span>
        </div>
      </div>`;
    })
    .join('');
}

async function renderInspector(): Promise<void> {
  const container = $('#inspector');
  const label = $('#inspector-id');
  if (!state.selectedId) {
    container.innerHTML = '<div class="empty">Selecciona una sesión.</div>';
    label.textContent = '';
    return;
  }
  label.textContent = state.selectedId;
  const response = await runtimeSend<SessionGetResponse>({ type: 'WC_SESSION_GET', id: state.selectedId });
  if (!response?.ok || !response.session) {
    container.innerHTML = '<div class="empty">No se pudo cargar la sesión.</div>';
    return;
  }
  const { report, meta, kind } = response.session;
  if (!report) {
    container.innerHTML = '<div class="empty">Sesión sin informe.</div>';
    return;
  }
  const failures = report.failures.slice(0, 5);
  const stats: [string, string][] = [
    ['Elementos', String(report.counts.elements)],
    ['Recursos', String(report.counts.assetsCaptured)],
    ['Fallidos', String(report.counts.assetsFailed)],
    ['CSS', String(report.counts.stylesheetsInlined)],
    ['Canvas', `${report.counts.canvases - report.counts.canvasesUnsupported}/${report.counts.canvases}`],
    ['Iframes', `${report.counts.framesCaptured}/${report.counts.iframes}`],
    ['Shadow DOM', String(report.counts.shadowRoots)],
    ['Media', String(report.counts.media)],
    ['Peso', formatBytes(report.bytes.total)],
  ];
  container.innerHTML =
    stats.map(([k, v]) => `<div class="stat"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div></div>`).join('') +
    (failures.length
      ? `<ul class="fail-list">${failures
          .map((f) => `<li title="${escapeHtml(f.restriction)}">${escapeHtml(f.kind)}: ${escapeHtml(f.url.slice(0, 60))} — ${escapeHtml(f.reason)}</li>`)
          .join('')}</ul>`
      : '<p class="note badge-ok">Sin recursos fallidos.</p>') +
    `<p class="note">${kind === 'recording' ? `${meta.eventCount} eventos · ${formatDuration(meta.durationMs)}` : report.fidelity.notes[0]}</p>`;
}

function renderStorage(info: StorageInfoResponse | null): void {
  const fill = $('#storage-fill');
  const text = $('#storage-text');
  if (!info?.ok) {
    text.textContent = '—';
    return;
  }
  const pct = info.quota > 0 ? Math.min(100, (info.usage / info.quota) * 100) : 0;
  fill.style.width = `${pct.toFixed(1)}%`;
  text.textContent = `${formatBytes(info.usage)} / ${formatBytes(info.quota)} · ${info.sessions} sesiones`;
}

// ---------------------------------------------------------------- acciones

async function refresh(): Promise<void> {
  try {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      state.tabId = tab.id;
      state.tabUrl = tab.url ?? '';
      state.tabTitle = tab.title ?? '';
      state.tabWidth = tab.width ?? 0;
      state.tabHeight = tab.height ?? 0;
    }
    const status = await runtimeSend<TabStatusResponse>({ type: 'WC_GET_TAB_STATUS', tabId: state.tabId });
    if (status?.ok) {
      state.status = status;
      if (status.elapsedMs && status.recording) {
        state.tickBase = status.elapsedMs;
        state.tickAt = Date.now();
      }
      const phase = status.progress?.phase ?? '';
      if (phase === 'done' && state.lastProgressPhase !== 'done') {
        await loadSessions();
      }
      if (phase === 'error' && state.lastProgressPhase !== 'error') {
        showBanner(status.progress?.message ?? 'Error de captura');
      }
      state.lastProgressPhase = phase;
      if (status.error && phase === 'error') setBusy(false);
      if (!status.busy) setBusy(false);
    }
    const list = await runtimeSend<SessionListResponse>({ type: 'WC_SESSION_LIST' });
    if (list?.ok) {
      state.sessions = list.sessions;
      if (!state.selectedId && state.sessions[0]) state.selectedId = state.sessions[0].id;
    }
    const storage = await runtimeSend<StorageInfoResponse>({ type: 'WC_STORAGE_INFO' });
    renderHeader();
    renderPage();
    renderProgress();
    renderRecording();
    renderFull();
    renderSessions();
    renderStorage(storage);
    await renderInspector();
  } catch (error) {
    showBanner(error instanceof Error ? error.message : String(error));
  }
}

async function loadSessions(): Promise<void> {
  const list = await runtimeSend<SessionListResponse>({ type: 'WC_SESSION_LIST' });
  if (list?.ok) {
    state.sessions = list.sessions;
    if (list.sessions[0]) state.selectedId = list.sessions[0].id;
    renderSessions();
    await renderInspector();
  }
}

async function startClone(): Promise<void> {
  if (!state.tabId) return showBanner('No hay pestaña activa');
  if (!canCapture()) return showBanner('Esta pestaña no permite capturas (página del navegador)');
  setBusy(true);
  try {
    const response = await runtimeSend<{ ok: boolean; error?: string; sessionId?: string }>({
      type: 'WC_START_CAPTURE',
      tabId: state.tabId,
      options: captureOptions(),
    });
    if (!response?.ok) throw new Error(response?.error ?? 'no se pudo iniciar la captura');
    if (response.sessionId) state.selectedId = response.sessionId;
    showBanner('Captura iniciada…', 'ok');
  } catch (error) {
    setBusy(false);
    showBanner(error instanceof Error ? error.message : String(error));
  }
}

async function startFull(): Promise<void> {
  if (!state.tabId) return showBanner('No hay pestaña activa');
  if (!canCapture()) return showBanner('Esta pestaña no permite capturas');
  setBusy(true);
  try {
    const sessionCookie = ($('#session-cookie') as HTMLTextAreaElement).value.trim();
    const response = await runtimeSend<{ ok: boolean; error?: string; sessionId?: string }>({
      type: 'WC_START_FULL_CAPTURE',
      tabId: state.tabId,
      options: captureOptions(),
      ...(sessionCookie ? { sessionCookie } : {}),
    });
    if (!response?.ok) throw new Error(response?.error ?? 'no se pudo iniciar el Clon Completo');
    state.selectedId = response.sessionId ?? state.selectedId;
    state.lastProgressPhase = '';
    showBanner('Clon Completo activo. Interactúa con la página y vuelve para finalizar.', 'ok');
    await refresh();
  } catch (error) {
    setBusy(false);
    showBanner(error instanceof Error ? error.message : String(error));
  }
}

async function stopFull(): Promise<void> {
  if (!state.tabId) return;
  setBusy(true);
  try {
    const response = await runtimeSend<{ ok: boolean; error?: string }>({ type: 'WC_STOP_FULL_CAPTURE', tabId: state.tabId });
    if (!response?.ok) throw new Error(response?.error ?? 'no se pudo finalizar el Clon Completo');
    showBanner('Reconstruyendo el clon completo…', 'ok');
    await refresh();
  } catch (error) {
    setBusy(false);
    showBanner(error instanceof Error ? error.message : String(error));
  }
}

async function startRecording(): Promise<void> {
  if (!state.tabId) return showBanner('No hay pestaña activa');
  if (!canCapture()) return showBanner('Esta pestaña no permite capturas');
  setBusy(true);
  try {
    const response = await runtimeSend<{ ok: boolean; error?: string; sessionId?: string }>({
      type: 'WC_START_RECORD',
      tabId: state.tabId,
    });
    if (!response?.ok) throw new Error(response?.error ?? 'no se pudo iniciar la grabación');
    state.selectedId = response.sessionId ?? state.selectedId;
    showBanner('Grabación en curso. Interactúa con la página.', 'ok');
  } catch (error) {
    setBusy(false);
    showBanner(error instanceof Error ? error.message : String(error));
  }
}

async function stopRecording(): Promise<void> {
  if (!state.tabId) return;
  setBusy(true);
  try {
    const response = await runtimeSend<{ ok: boolean; error?: string }>({ type: 'WC_STOP_RECORD', tabId: state.tabId });
    if (!response?.ok) throw new Error(response?.error ?? 'no se pudo detener la grabación');
    showBanner('Grabación detenida. Generando paquete…', 'ok');
  } catch (error) {
    showBanner(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

async function exportSession(id: string): Promise<void> {
  try {
    const response = await runtimeSend<{ ok: boolean; base64: string; filename: string; size: number; error?: string }>({
      type: 'WC_SESSION_EXPORT',
      id,
    });
    if (!response?.ok) throw new Error(response?.error ?? 'exportación fallida');
    await downloadBytes(base64ToBytes(response.base64), response.filename);
    showBanner(`ZIP generado: ${response.filename} (${formatBytes(response.size)})`, 'ok');
  } catch (error) {
    showBanner(error instanceof Error ? error.message : String(error));
  }
}

async function deleteSession(id: string): Promise<void> {
  if (!window.confirm('¿Eliminar esta sesión y sus recursos descargados?')) return;
  await runtimeSend({ type: 'WC_SESSION_DELETE', id });
  if (state.selectedId === id) state.selectedId = '';
  await loadSessions();
  showBanner('Sesión eliminada', 'ok');
}

async function importSession(file: File): Promise<void> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const response = await runtimeSend<{ ok: boolean; id?: string; integrity?: string; error?: string; mismatches?: number }>({
      type: 'WC_IMPORT_SESSION',
      name: file.name,
      dataBase64: bytesToBase64(bytes),
    });
    if (!response?.ok) throw new Error(response?.error ?? 'importación fallida');
    state.selectedId = response.id ?? state.selectedId;
    await loadSessions();
    showBanner(
      response.integrity === 'ok' ? 'Sesión importada y verificada' : `Sesión importada con ${response.mismatches} discrepancias de integridad`,
      response.integrity === 'ok' ? 'ok' : 'error',
    );
  } catch (error) {
    showBanner(error instanceof Error ? error.message : String(error));
  }
}

// ---------------------------------------------------------------- ajustes

function updateSessionChip(): void {
  const chip = $('#session-chip');
  const hasCookie = ($('#session-cookie') as HTMLTextAreaElement).value.trim().length > 0;
  chip.textContent = hasCookie ? 'Se aplicará al clon' : 'Sin sesión';
  chip.className = hasCookie ? 'chip live' : 'chip';
}

function applySettingsToUi(): void {
  ($('#s-assets') as HTMLInputElement).checked = state.settings.captureAssets;
  ($('#s-cred') as HTMLInputElement).checked = state.settings.includeCredentials;
  ($('#s-canvas') as HTMLInputElement).checked = state.settings.captureCanvas;
  ($('#s-frames') as HTMLInputElement).checked = state.settings.captureFrames;
  ($('#s-dynamic') as HTMLInputElement).checked = state.settings.dynamic;
  ($('#s-force') as HTMLInputElement).checked = state.settings.forceDynamic;
  ($('#s-network') as HTMLInputElement).checked = state.settings.captureNetwork;
  ($('#s-max') as HTMLInputElement).value = String(state.settings.maxAssetMB);
  ($('#s-total') as HTMLInputElement).value = String(state.settings.maxTotalMB);
}

async function saveSettings(): Promise<void> {
  state.settings = {
    captureAssets: ($('#s-assets') as HTMLInputElement).checked,
    includeCredentials: ($('#s-cred') as HTMLInputElement).checked,
    captureCanvas: ($('#s-canvas') as HTMLInputElement).checked,
    captureFrames: ($('#s-frames') as HTMLInputElement).checked,
    dynamic: ($('#s-dynamic') as HTMLInputElement).checked,
    forceDynamic: ($('#s-force') as HTMLInputElement).checked,
    captureNetwork: ($('#s-network') as HTMLInputElement).checked,
    maxAssetMB: Math.max(1, Number(($('#s-max') as HTMLInputElement).value) || DEFAULT_SETTINGS.maxAssetMB),
    maxTotalMB: Math.max(1, Number(($('#s-total') as HTMLInputElement).value) || DEFAULT_SETTINGS.maxTotalMB),
  };
  await storageSet(settingsKey, state.settings);
}

// ---------------------------------------------------------------- wiring

async function init(): Promise<void> {
  const stored = await storageGet<Settings>(settingsKey);
  if (stored) state.settings = { ...DEFAULT_SETTINGS, ...stored };
  applySettingsToUi();

  $('#btn-clone').addEventListener('click', () => void startClone());
  $('#btn-full').addEventListener('click', () => void startFull());
  $('#btn-full-stop').addEventListener('click', () => void stopFull());
  $('#btn-record').addEventListener('click', () => void startRecording());
  $('#btn-stop').addEventListener('click', () => void stopRecording());
  $('#btn-refresh').addEventListener('click', () => void refresh());
  $('#btn-settings').addEventListener('click', () => {
    const panel = $('#settings-panel');
    panel.hidden = !panel.hidden;
  });

  $('#session-cookie').addEventListener('input', updateSessionChip);
  updateSessionChip();

  $('#sessions').addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const card = target.closest('.session') as HTMLElement | null;
    if (!card) return;
    const id = card.dataset.id ?? '';
    const action = (target.closest('[data-action]') as HTMLElement | null)?.dataset.action;
    if (action === 'export') return void exportSession(id);
    if (action === 'delete') return void deleteSession(id);
    if (action === 'play') {
      state.selectedId = id;
      renderSessions();
      void runtimeSend({ type: 'WC_OPEN_REPLAY', id }).catch(() => showBanner('No se pudo abrir el reproductor'));
      return;
    }
    state.selectedId = id;
    renderSessions();
    void renderInspector();
  });

  $('#import-input').addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void importSession(file);
    input.value = '';
  });

  for (const id of ['#s-assets', '#s-cred', '#s-canvas', '#s-frames', '#s-dynamic', '#s-force', '#s-network', '#s-max', '#s-total']) {
    $(id).addEventListener('change', () => void saveSettings());
  }

  await refresh();
  window.setInterval(() => {
    void refresh();
  }, 1200);
}

void init();
