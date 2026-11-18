/**
 * Genera el HTML del reproductor autónomo que se incluye en cada exportación.
 * No depende de la extensión: usa un bundle de rrweb copiado al paquete
 * (assets/js/wc-replay.js, que expone window.WCReplay.Replayer).
 */

import type { CaptureReport, RecordingMeta, SessionMeta } from './types';
import type { RrwebEvent, Timeline } from './timeline';
import { sanitizeUrlForReport } from './url';

/** Escapa JSON para incrustarlo dentro de <script type="application/json">. */
export function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export interface PlayerHtmlInput {
  events: RrwebEvent[];
  timeline: Timeline;
  recordingMeta?: RecordingMeta;
  report: CaptureReport;
  session: SessionMeta;
  hasPlayerBundle: boolean;
}

const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLES = `:root{color-scheme:dark}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:#0b0b0d;color:#e8e8ea;font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;flex-direction:column;overflow:hidden}
.top{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid #202026;background:#111114;flex:none}
.badge{display:inline-flex;align-items:center;gap:6px;border:1px solid #7f1d1d;background:#2a0d0f;color:#ff8f92;border-radius:999px;padding:2px 10px;font-size:10px;letter-spacing:.1em;text-transform:uppercase}
.title{font-weight:600;font-size:13px;max-width:34ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.url{color:#7d7d88;font-family:ui-monospace,monospace;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.stage{flex:1;position:relative;overflow:auto;background:#141418;display:flex;justify-content:center;align-items:flex-start;padding:0}
#player{width:100%;height:100%;background:#fff}
/* Reglas que rrweb-player aporta y el core de rrweb no: wrapper relativo y capas absolutas. */
.replayer-wrapper{position:relative}
.replayer-wrapper>iframe{border:0;display:block}
.replayer-mouse,.replayer-mouse-tail{position:absolute;top:0;left:0;pointer-events:none}
.replayer-mouse-tail{z-index:2}
.replayer-mouse{width:20px;height:20px;z-index:3;border-radius:50%;background:rgba(239,68,68,.35);transition:left .05s linear,top .05s linear}
.controls{flex:none;border-top:1px solid #202026;background:#111114;padding:8px 16px 12px;display:flex;flex-direction:column;gap:6px}
.row{display:flex;align-items:center;gap:8px}
button{background:#17171c;border:1px solid #2e2e37;color:#e8e8ea;border-radius:7px;padding:5px 10px;font:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
button:hover{border-color:#ff5a5f;color:#ff9a9d}
button.primary{background:#7f1d1d;border-color:#b91c1c;color:#fff}
button.primary:hover{background:#991b1b;color:#fff}
button.active{border-color:#ff5a5f;color:#ff9a9d}
.speeds{display:flex;gap:4px}
.time{font-family:ui-monospace,monospace;font-size:11px;color:#a1a1aa;min-width:104px}
input[type=range]{flex:1;accent-color:#ef4444;height:18px}
.panel{max-height:38vh;overflow:auto;border-top:1px solid #202026;display:none;flex:none;background:#0e0e11}
.panel.open{display:block}
.panel table{width:100%;border-collapse:collapse;font-size:12px}
.panel th,.panel td{text-align:left;padding:5px 12px;border-bottom:1px solid #1a1a20}
.panel th{color:#8b8b96;font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:.08em}
.mark{cursor:pointer}
.mark:hover{background:#1a1a20}
.tabs{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid #202026;position:sticky;top:0;background:#0e0e11}
.mono{font-family:ui-monospace,monospace;color:#9a9aa5}
.err{color:#f87171}.warn{color:#fbbf24}.ok{color:#4ade80}
.empty{padding:16px;color:#7d7d88}
#missing{display:none;padding:10px 16px;background:#2a1a06;color:#fbbf24;border-bottom:1px solid #5b3b06;font-size:12px}`;

const PLAYER_JS = String.raw`(function () {
  var events = JSON.parse(document.getElementById('wc-events').textContent || '[]');
  var timeline = JSON.parse(document.getElementById('wc-timeline').textContent || '{}');
  var marks = timeline.marks || [];
  var duration = timeline.durationMs || 0;
  var stage = document.getElementById('player');
  var range = document.getElementById('seek');
  var timeLabel = document.getElementById('time');
  var playBtn = document.getElementById('play');
  var speedButtons = Array.prototype.slice.call(document.querySelectorAll('[data-speed]'));
  var player = null;
  var speed = 1;
  var playing = false;
  var current = 0;

  function fmt(ms) {
    var t = Math.max(0, Math.round(ms));
    var m = Math.floor(t / 60000);
    var s = Math.floor((t % 60000) / 1000);
    var d = Math.floor((t % 1000) / 100);
    return m + ':' + (s < 10 ? '0' : '') + s + '.' + d;
  }
  function setLabel(ms) {
    current = ms;
    timeLabel.textContent = fmt(ms) + ' / ' + fmt(duration);
    if (!range.dataset.dragging) range.value = String(Math.min(1000, duration ? (ms / duration) * 1000 : 0));
  }
  function updatePlayButton() {
    playBtn.textContent = playing ? '❚❚ Pause' : '▶ Play';
    playBtn.classList.toggle('active', playing);
  }
  function createPlayer(startAt) {
    if (!window.WCReplay || !window.WCReplay.Replayer) {
      document.getElementById('missing').style.display = 'block';
      return null;
    }
    if (player) { try { player.pause(); } catch (e) {} }
    stage.innerHTML = '';
    player = new window.WCReplay.Replayer(events, {
      root: stage,
      speed: speed,
      showWarning: false,
      skipInactive: false,
      mouseTail: true,
      triggerFocus: false,
      UNSAFE_replayCanvas: true
    });
    player.on('finish', function () { playing = false; updatePlayButton(); });
    // pause(t) pinta el estado en ese instante; sin esto el stage queda en blanco hasta Play.
    if (typeof startAt === 'number' && startAt > 0) player.play(startAt);
    else player.pause(0);
    return player;
  }
  function seek(ms) {
    if (!player) return;
    setLabel(ms);
    if (playing) player.play(ms);
    else player.pause(ms);
  }
  function toggle() {
    if (!player) return;
    if (playing) { player.pause(); playing = false; }
    else { player.play(current >= duration ? 0 : current); playing = true; }
    updatePlayButton();
  }
  function setSpeed(value) {
    speed = value;
    speedButtons.forEach(function (b) { b.classList.toggle('active', Number(b.dataset.speed) === value); });
    var at = current;
    var isPlaying = playing;
    if (player && typeof player.setConfig === 'function') {
      try { player.setConfig({ speed: value }); return; } catch (e) {}
    }
    createPlayer(at);
    if (!player) return;
    if (isPlaying) { player.play(at); } else { player.pause(at); }
  }

  if (events.length === 0) {
    document.getElementById('missing').style.display = 'block';
    document.getElementById('missing').textContent = 'Esta captura no contiene eventos de grabación.';
    return;
  }

  range.addEventListener('input', function () {
    range.dataset.dragging = '1';
    var ms = (Number(range.value) / 1000) * duration;
    setLabel(ms);
  });
  range.addEventListener('change', function () {
    delete range.dataset.dragging;
    seek((Number(range.value) / 1000) * duration);
  });
  playBtn.addEventListener('click', toggle);
  speedButtons.forEach(function (b) {
    b.addEventListener('click', function () { setSpeed(Number(b.dataset.speed)); });
  });

  var marksBody = document.getElementById('marks-body');
  marks.slice(0, 3000).forEach(function (mark) {
    var tr = document.createElement('tr');
    tr.className = 'mark';
    var typeClass = mark.type === 'error' ? 'err' : mark.type === 'navigation' ? 'ok' : mark.type === 'network' ? 'warn' : '';
    tr.innerHTML = '<td class="mono">' + fmt(mark.at) + '</td><td class="' + typeClass + '">' + mark.type + '</td><td></td><td class="mono"></td>';
    tr.children[2].textContent = mark.label || '';
    tr.children[3].textContent = mark.detail || '';
    tr.addEventListener('click', function () { seek(mark.at); });
    marksBody.appendChild(tr);
  });

  document.getElementById('toggle-marks').addEventListener('click', function () {
    document.getElementById('panel').classList.toggle('open');
  });
  document.querySelectorAll('[data-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-pane]').forEach(function (p) {
        p.style.display = p.dataset.pane === btn.dataset.tab ? 'block' : 'none';
      });
    });
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
    if (ev.code === 'Space') { ev.preventDefault(); toggle(); }
    else if (ev.code === 'ArrowRight') { seek(Math.min(duration, current + 5000)); }
    else if (ev.code === 'ArrowLeft') { seek(Math.max(0, current - 5000)); }
    else if (ev.code === 'KeyF') { document.documentElement.requestFullscreen().catch(function () {}); }
  });

  createPlayer(0);
  document.getElementById('events-count').textContent = String(events.length);
  document.getElementById('marks-count').textContent = String(marks.length);
  setLabel(0);
  setInterval(function () {
    if (!player) return;
    try {
      var t = player.getCurrentTime();
      if (typeof t === 'number' && !isNaN(t)) setLabel(t);
    } catch (e) {}
  }, 200);
  setSpeed(1);
})();`;

export function buildPlayerHtml(input: PlayerHtmlInput): string {
  const { session, timeline, recordingMeta, report } = input;
  const errors = recordingMeta?.errors ?? [];
  const navigations = recordingMeta?.navigations ?? [];
  const errorRows = errors
    .slice(0, 500)
    .map(
      (e) => `<tr><td class="mono">${Math.round(e.t - (timeline.firstEventAt || e.t))}ms</td><td class="err">${esc(e.type)}</td><td>${esc(e.message.slice(0, 300))}</td><td class="mono">${esc(e.source ?? '')}</td></tr>`,
    )
    .join('');
  const navRows = navigations
    .map((n) => `<tr><td class="mono">${Math.round(n.t - (timeline.firstEventAt || n.t))}ms</td><td>${esc(n.kind)}</td><td class="mono">${esc(sanitizeUrlForReport(n.to))}</td></tr>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reproducción — ${esc(session.title)}</title>
<style>${STYLES}</style></head>
<body>
<div class="top">
  <span class="badge">● Sesión</span>
  <span class="title">${esc(session.title)}</span>
  <span class="url">${esc(sanitizeUrlForReport(session.url))}</span>
  <span class="mono" style="font-size:11px">${esc(report.browser.name)} ${esc(report.browser.version)}</span>
</div>
<div id="missing"></div>
<div class="stage"><div id="player"></div></div>
<div class="controls">
  <div class="row">
    <button class="primary" id="play">▶ Play</button>
    <span class="time" id="time">0:00.0 / 0:00.0</span>
    <input type="range" id="seek" min="0" max="1000" value="0" step="1" aria-label="Línea temporal">
    <span class="speeds">
      <button data-speed="0.25">0.25×</button>
      <button data-speed="0.5">0.5×</button>
      <button data-speed="1" class="active">1×</button>
      <button data-speed="2">2×</button>
      <button data-speed="4">4×</button>
    </span>
    <button id="toggle-marks">Eventos (<span id="marks-count">0</span>)</button>
    <span class="mono" style="font-size:11px">${esc(String(timeline.eventCount))} eventos · <span id="events-count">0</span> cargados</span>
  </div>
</div>
<div class="panel" id="panel">
  <div class="tabs">
    <button data-tab="marks">Línea temporal</button>
    <button data-tab="errors">Errores (${errors.length})</button>
    <button data-tab="nav">Navegación (${navigations.length})</button>
    <button data-tab="info">Informe</button>
  </div>
  <div data-pane="marks">
    <table><thead><tr><th>Tiempo</th><th>Tipo</th><th>Evento</th><th>Detalle</th></tr></thead><tbody id="marks-body"></tbody></table>
  </div>
  <div data-pane="errors" style="display:none">
    ${errorRows ? `<table><thead><tr><th>Tiempo</th><th>Tipo</th><th>Mensaje</th><th>Origen</th></tr></thead><tbody>${errorRows}</tbody></table>` : '<div class="empty">Sin errores JavaScript registrados durante la grabación.</div>'}
  </div>
  <div data-pane="nav" style="display:none">
    ${navRows ? `<table><thead><tr><th>Tiempo</th><th>Tipo</th><th>URL</th></tr></thead><tbody>${navRows}</tbody></table>` : '<div class="empty">Sin navegaciones registradas.</div>'}
  </div>
  <div data-pane="info" style="display:none">
    <div class="empty">
      <p>Recursos capturados: <strong class="ok">${report.counts.assetsCaptured}</strong> · fallidos: <strong class="${report.counts.assetsFailed ? 'err' : 'ok'}">${report.counts.assetsFailed}</strong></p>
      <p>Peso de recursos: <span class="mono">${report.bytes.assets}</span> bytes · HTML: <span class="mono">${report.bytes.html}</span> bytes</p>
      <p>La reproducción no ejecuta JavaScript de la página original: reconstruye los eventos observados con rrweb.</p>
      <p><a href="reports/compatibility-report.html">Informe de compatibilidad completo</a></p>
    </div>
  </div>
</div>
<script type="application/json" id="wc-events">${inlineJson(input.events)}</script>
<script type="application/json" id="wc-timeline">${inlineJson(timeline)}</script>
${input.hasPlayerBundle ? '<script src="assets/js/wc-replay.js"></script>' : ''}
<script>${PLAYER_JS}</script>
</body></html>`;
}

export function buildIndexFallbackHtml(session: SessionMeta, message: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${esc(session.title)}</title>
<style>body{background:#0b0b0d;color:#e5e5e5;font:14px ui-sans-serif,system-ui;padding:32px}</style></head>
<body><h1>${esc(session.title)}</h1><p>${esc(message)}</p><p class="mono">${esc(sanitizeUrlForReport(session.url))}</p></body></html>`;
}
