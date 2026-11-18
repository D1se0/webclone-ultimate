import { Replayer } from '@rrweb/replay';
import { runtimeSend, downloadBytes } from '../shared/ext';
import type { SessionGetResponse } from '../shared/messages';
import type { CaptureReport, RecordingMeta } from '../shared/types';
import { buildTimeline, eventTypeLabel, formatDuration, incrementalLabel, seekIndex, type Timeline } from '../shared/timeline';
import { formatBytes } from '../shared/zip';
import { base64ToBytes } from '../shared/base64';

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector(selector) as T;

interface ReplayEvent {
  type: number;
  timestamp: number;
  data?: { source?: number; positions?: unknown };
}

const params = new URLSearchParams(location.search);
const sessionId = params.get('id') ?? '';

let player: Replayer | null = null;
let events: ReplayEvent[] = [];
let timeline: Timeline | null = null;
let report: CaptureReport | null = null;
let recordingMeta: RecordingMeta | null = null;
let speed = 1;
let playing = false;
let current = 0;
let duration = 0;
let loading = false;

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function setLabel(ms: number): void {
  current = ms;
  $('#time').textContent = `${formatDuration(ms)} / ${formatDuration(duration)}`;
  const range = $('#seek') as HTMLInputElement;
  if (document.activeElement !== range) range.value = String(duration ? Math.min(1000, (ms / duration) * 1000) : 0);
}

function updatePlayButton(): void {
  $('#btn-play').textContent = playing ? '❚❚ Pause' : '▶ Play';
  $('#btn-play').classList.toggle('active', playing);
}

function seek(ms: number): void {
  if (!player) return;
  const target = Math.max(0, Math.min(duration, ms));
  setLabel(target);
  try {
    if (playing) player.play(target);
    else player.pause(target);
  } catch {
    /* ignore */
  }
}

function togglePlay(): void {
  if (!player) return;
  try {
    if (playing) {
      player.pause();
      playing = false;
    } else {
      player.play(current >= duration ? 0 : current);
      playing = true;
    }
  } catch {
    playing = false;
  }
  updatePlayButton();
}

function setSpeed(value: number): void {
  speed = value;
  document.querySelectorAll('[data-speed]').forEach((button) => {
    button.classList.toggle('active', Number((button as HTMLElement).dataset.speed) === value);
  });
  const at = current;
  const wasPlaying = playing;
  if (player && typeof (player as unknown as { setConfig?: (c: unknown) => void }).setConfig === 'function') {
    try {
      (player as unknown as { setConfig: (c: unknown) => void }).setConfig({ speed: value });
      return;
    } catch {
      /* recreamos el replayer */
    }
  }
  mountPlayer(at);
  if (player && wasPlaying) {
    player.play(at);
    playing = true;
  } else if (player) {
    player.pause(at);
    playing = false;
  }
  updatePlayButton();
}

function mountPlayer(startAt = 0): void {
  const stage = $('#player');
  stage.innerHTML = '';
  player = new Replayer(events as never, {
    root: stage,
    speed,
    showWarning: false,
    skipInactive: false,
    mouseTail: true,
    triggerFocus: false,
    UNSAFE_replayCanvas: true,
  });
  player.on('finish', () => {
    playing = false;
    updatePlayButton();
  });
  // pause(t) renderiza el estado en ese instante (si no, el stage queda vacío al cargar).
  if (startAt > 0) player.play(startAt);
  else player.pause(0);
}

function renderHeader(meta: { title: string; url: string; durationMs: number; eventCount: number; createdAt: string }): void {
  $('#session-title').textContent = meta.title || 'Sesión sin título';
  $('#session-url').textContent = meta.url || '';
  $('#session-meta').textContent = `${new Date(meta.createdAt).toLocaleString('es-ES')} · ${meta.eventCount} eventos · ${formatDuration(meta.durationMs)}`;
  document.title = `WebClone — ${meta.title || 'Reproducción'}`;
}

function renderMarks(): void {
  const body = $('#marks-body');
  if (!timeline) return;
  body.innerHTML = timeline.marks
    .slice(0, 3000)
    .map((mark) => {
      const cls = mark.type === 'error' ? 'err' : mark.type === 'navigation' ? 'ok' : mark.type === 'network' ? 'warn' : '';
      return `<tr class="mark" data-at="${mark.at}"><td class="mono">${formatDuration(mark.at)}</td><td class="${cls}">${escapeHtml(mark.type)}</td><td>${escapeHtml(mark.label)}</td><td class="mono">${escapeHtml((mark.detail ?? '').slice(0, 120))}</td></tr>`;
    })
    .join('');
}

function renderEvents(): void {
  const body = $('#events-body');
  body.innerHTML = events
    .slice(0, 4000)
    .map((event, index) => {
      const kind = event.type === 3 ? incrementalLabel((event.data as { source?: number } | undefined)?.source) : '';
      const at = Math.max(0, event.timestamp - events[0].timestamp);
      return `<tr class="mark" data-index="${index}"><td class="mono">${index}</td><td class="mono">${formatDuration(at)}</td><td>${eventTypeLabel(event.type)}</td><td class="mono">${escapeHtml(kind)}</td></tr>`;
    })
    .join('');
}

function renderErrors(): void {
  const errors = recordingMeta?.errors ?? [];
  $('#errors-body').innerHTML = errors.length
    ? `<table><tbody>${errors
        .slice(0, 500)
        .map(
          (error) =>
            `<tr><td class="mono">${formatDuration(Math.max(0, error.t - (events[0]?.timestamp ?? error.t)))}</td><td class="err">${escapeHtml(error.type)}</td><td>${escapeHtml(error.message.slice(0, 240))}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p class="ok">Sin errores registrados durante la grabación.</p>';
}

function renderNetwork(): void {
  const entries = recordingMeta?.network ?? [];
  $('#network-body').innerHTML = entries.length
    ? `<table><tbody>${entries
        .slice(0, 800)
        .map(
          (entry) =>
            `<tr><td class="mono">${entry.status}</td><td class="${entry.failed ? 'err' : ''}">${escapeHtml(entry.resourceType)}</td><td class="mono">${escapeHtml(entry.url.slice(0, 140))}</td><td class="mono">${entry.durationMs}ms</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p class="muted">Sin peticiones registradas.</p>';
}

function renderInfo(): void {
  if (!report) {
    $('#info-body').innerHTML = '<p class="muted">Sin informe de captura.</p>';
    return;
  }
  const stats: [string, string][] = [
    ['Recursos', String(report.counts.assetsCaptured)],
    ['Fallidos', String(report.counts.assetsFailed)],
    ['Elementos', String(report.counts.elements)],
    ['Eventos', String(events.length)],
    ['Peso recursos', formatBytes(report.bytes.assets)],
    ['Peso datos', formatBytes(report.bytes.html)],
  ];
  const failures = report.failures
    .slice(0, 40)
    .map((failure) => `<p class="mono err">${escapeHtml(failure.kind)} · ${escapeHtml(failure.reason)} · ${escapeHtml(failure.url.slice(0, 100))}</p>`)
    .join('');
  $('#info-body').innerHTML =
    `<div class="grid">${stats.map(([k, v]) => `<div class="stat"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div></div>`).join('')}</div>` +
    `<p class="muted">${escapeHtml(report.fidelity.notes[0] ?? '')}</p>` +
    (failures || '<p class="ok">Sin recursos fallidos.</p>');
}

async function loadSession(): Promise<void> {
  if (!sessionId) {
    $('#notice').hidden = false;
    $('#notice').textContent = 'No se especificó ninguna sesión. Abre el reproductor desde el popup de WebClone Ultimate.';
    return;
  }
  loading = true;
  const response = await runtimeSend<SessionGetResponse>({ type: 'WC_SESSION_GET', id: sessionId });
  loading = false;
  if (!response?.ok || !response.session) {
    $('#notice').hidden = false;
    $('#notice').textContent = response?.error ?? 'Sesión no encontrada.';
    return;
  }
  const session = response.session;
  report = session.report ?? null;
  recordingMeta = (session.recordingMeta as RecordingMeta) ?? null;
  renderHeader(session.meta);

  if (session.kind !== 'recording') {
    $('#notice').hidden = false;
    $('#notice').textContent =
      'Esta sesión es un Instant Clone (instantánea estática). Para verlo con todos sus recursos, expórtalo a ZIP y abre index.html. Aquí puedes consultar el informe de captura.';
    $('#controls').style.display = 'none';
    $('#player').style.display = 'none';
    $('#info-body').innerHTML = '';
    renderInfo();
    showTab('info');
    return;
  }

  events = (session.events ?? []) as ReplayEvent[];
  timeline =
    (session.timeline as Timeline | undefined) ??
    (events.length
      ? buildTimeline(events as never, {
          startedAt: Date.parse(session.meta.createdAt) || Date.now(),
          endedAt: (Date.parse(session.meta.createdAt) || Date.now()) + session.meta.durationMs,
        })
      : null);
  duration = timeline?.durationMs ?? 0;
  if (events.length === 0) {
    $('#notice').hidden = false;
    $('#notice').textContent = 'La grabación no contiene eventos.';
    return;
  }
  mountPlayer(0);
  renderMarks();
  renderEvents();
  renderErrors();
  renderNetwork();
  renderInfo();
  setLabel(0);
  updatePlayButton();
  window.setInterval(() => {
    if (!player) return;
    try {
      const time = player.getCurrentTime();
      if (typeof time === 'number' && !Number.isNaN(time) && document.activeElement !== $('#seek')) setLabel(time);
    } catch {
      /* ignore */
    }
  }, 200);
}

function showTab(name: string): void {
  document.querySelectorAll('.tabs button').forEach((button) => {
    button.classList.toggle('active', (button as HTMLElement).dataset.tab === name);
  });
  document.querySelectorAll('[data-pane]').forEach((pane) => {
    (pane as HTMLElement).hidden = (pane as HTMLElement).dataset.pane !== name;
  });
}

async function saveScreenshot(): Promise<void> {
  const response = await runtimeSend<{ ok: boolean; dataUrl?: string; error?: string }>({
    type: 'WC_CAPTURE_REPLAY_SCREENSHOT',
  });
  if (!response?.ok || !response.dataUrl) return;
  const anchor = document.createElement('a');
  anchor.href = response.dataUrl;
  anchor.download = `webclone-instant-${Date.now()}.png`;
  anchor.click();
}

async function exportSession(): Promise<void> {
  if (!sessionId) return;
  const response = await runtimeSend<{ ok: boolean; base64: string; filename: string; error?: string }>({
    type: 'WC_SESSION_EXPORT',
    id: sessionId,
  });
  if (!response?.ok) return;
  await downloadBytes(base64ToBytes(response.base64), response.filename);
}

function wire(): void {
  $('#btn-play').addEventListener('click', togglePlay);
  $('#btn-export').addEventListener('click', () => void exportSession());
  $('#btn-screenshot').addEventListener('click', () => void saveScreenshot());
  $('#btn-prev').addEventListener('click', () => {
    const index = seekIndex(events as never, current);
    const previous = Math.max(0, index - 1);
    seek(Math.max(0, events[previous].timestamp - events[0].timestamp));
  });
  $('#btn-next').addEventListener('click', () => {
    const index = seekIndex(events as never, current);
    const next = Math.min(events.length - 1, index + 1);
    if (events[next]) seek(Math.max(0, events[next].timestamp - events[0].timestamp));
  });
  $('#btn-full').addEventListener('click', () => {
    const stage = $('.stage');
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.requestFullscreen().catch(() => undefined);
  });
  $('#seek').addEventListener('input', () => {
    const value = Number(($('#seek') as HTMLInputElement).value);
    const ms = (value / 1000) * duration;
    setLabel(ms);
    if (!playing) seek(ms);
  });
  $('#seek').addEventListener('change', () => {
    const value = Number(($('#seek') as HTMLInputElement).value);
    seek((value / 1000) * duration);
  });
  $('#speeds').addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest('[data-speed]') as HTMLElement | null;
    if (target?.dataset.speed) setSpeed(Number(target.dataset.speed));
  });
  document.querySelectorAll('.tabs button').forEach((button) => {
    button.addEventListener('click', () => showTab((button as HTMLElement).dataset.tab ?? 'marks'));
  });
  $('#marks-body').addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest('tr.mark') as HTMLElement | null;
    if (row?.dataset.at) seek(Number(row.dataset.at));
  });
  $('#events-body').addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest('tr.mark') as HTMLElement | null;
    const index = Number(row?.dataset.index ?? -1);
    if (index >= 0 && events[index]) seek(Math.max(0, events[index].timestamp - events[0].timestamp));
  });
  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
    if (event.code === 'Space') {
      event.preventDefault();
      togglePlay();
    } else if (event.code === 'ArrowRight') seek(Math.min(duration, current + 5000));
    else if (event.code === 'ArrowLeft') seek(Math.max(0, current - 5000));
    else if (event.code === 'KeyF') $('#btn-full').click();
  });
  $('#btn-inspector').addEventListener('click', () => showTab('info'));
}

wire();
void loadSession();
void loading;
