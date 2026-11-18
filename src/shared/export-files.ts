/**
 * Ensamblado del paquete exportable (ZIP) a partir de una sesión almacenada.
 * Módulo puro respecto al navegador: puede testearse en Node.
 */

import type {
  CaptureReport,
  CapturedNetworkEntry,
  FailedResource,
  PageState,
  RecordingMeta,
  SessionKind,
  SessionMeta,
} from './types';
import { mimeFromExtension, sanitizeUrlForReport } from './url';
import { crc32, sha256Hex } from './hash';
import { textFile, type ZipInputFile } from './zip';
import { buildTimeline, type RrwebEvent, type Timeline } from './timeline';
import { buildPlayerHtml, buildIndexFallbackHtml } from './player-html';
import { SERVE_CLONE_SOURCE } from './serve-clone-source';

export interface ExportAsset {
  path: string;
  data: Uint8Array;
}

export interface ExportInput {
  session: SessionMeta;
  kind: SessionKind;
  report: CaptureReport;
  html?: string;
  state?: PageState;
  events?: unknown[];
  recordingMeta?: RecordingMeta;
  timeline?: Timeline;
  assets: ExportAsset[];
  /** Ficheros ya resueltos (frames same-origin serializados, etc.). */
  extraFiles?: { path: string; text: string }[];
  /** Respuestas de red capturadas (clon dinámico). */
  network?: CapturedNetworkEntry[];
  /** Código JS del reproductor rrweb empaquetado (ventana.WCReplay). */
  playerBundle?: string;
  screenshot?: { dataUrl: string; width: number; height: number };
  toolVersion: string;
}

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  json: 'application/json',
  css: 'text/css',
  js: 'text/javascript',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  gif: 'image/gif',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  md: 'text/markdown',
};

function mimeForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? mimeFromExtension(path) ?? 'application/octet-stream';
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Escapa JSON para incrustarlo dentro de <script type="application/json">. */
export function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const BASE_CSS = `:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0b0b0d;color:#e8e8ea;font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:#ff5a5f}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.wrap{max-width:1080px;margin:0 auto;padding:32px 24px 64px}
header.top{display:flex;align-items:center;gap:12px;border-bottom:1px solid #232329;padding-bottom:16px;margin-bottom:24px}
.badge{display:inline-flex;align-items:center;gap:6px;border:1px solid #33333b;border-radius:999px;padding:2px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#a1a1aa}
.badge.red{border-color:#7f1d1d;background:#2a0d0f;color:#ff8f92}
h1{font-size:22px;margin:0;font-weight:650}
h2{font-size:15px;margin:28px 0 10px;text-transform:uppercase;letter-spacing:.1em;color:#a1a1aa}
p{margin:8px 0;color:#c7c7cd}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #1e1e24;vertical-align:top}
th{color:#8b8b96;font-weight:500;text-transform:uppercase;font-size:11px;letter-spacing:.08em}
.mono{font-family:ui-monospace,monospace;font-size:12px;color:#a5a5b0;word-break:break-all}
.ok{color:#4ade80}.warn{color:#fbbf24}.bad{color:#f87171}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.card{background:#111114;border:1px solid #232329;border-radius:10px;padding:14px}
.card .k{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#8b8b96}
.card .v{font-size:18px;font-weight:600;margin-top:4px}
footer{margin-top:40px;border-top:1px solid #232329;padding-top:16px;color:#6b6b76;font-size:12px}`;

export function buildCompatibilityReportHtml(report: CaptureReport, session: SessionMeta): string {
  const failures = report.failures ?? [];
  const rows = failures
    .map(
      (f: FailedResource) => `<tr>
      <td class="mono">${esc(sanitizeUrlForReport(f.url))}</td>
      <td>${esc(f.kind)}</td>
      <td>${esc(f.reason)}</td>
      <td class="mono">${esc(f.restriction)}</td>
      <td>${f.affectsFidelity ? '<span class="bad">sí</span>' : '<span class="ok">no</span>'}</td>
      <td>${esc(f.alternative)}</td></tr>`,
    )
    .join('\n');

  const unsupported = (report.unsupported ?? []).map((u) => `<li>${esc(u)}</li>`).join('\n');
  const counts = Object.entries(report.counts)
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>Informe de compatibilidad — ${esc(session.title)}</title>
<style>${BASE_CSS}</style></head>
<body><div class="wrap">
<header class="top"><span class="badge red">WebClone Ultimate</span><h1>Informe de compatibilidad</h1></header>
<p class="mono">${esc(sanitizeUrlForReport(report.url))}</p>
<p>Capturado: ${esc(report.startedAt)} · Duración de la captura: ${report.durationMs} ms · Navegador: ${esc(report.browser.name)} ${esc(report.browser.version)}</p>

<h2>Resumen</h2>
<div class="grid">
  <div class="card"><div class="k">Recursos capturados</div><div class="v ok">${report.counts.assetsCaptured}</div></div>
  <div class="card"><div class="k">Recursos fallidos</div><div class="v ${report.counts.assetsFailed ? 'bad' : 'ok'}">${report.counts.assetsFailed}</div></div>
  <div class="card"><div class="k">Elementos</div><div class="v">${report.counts.elements}</div></div>
  <div class="card"><div class="k">Shadow roots</div><div class="v">${report.counts.shadowRoots}</div></div>
  <div class="card"><div class="k">Iframes capturados</div><div class="v">${report.counts.framesCaptured}/${report.counts.iframes}</div></div>
  <div class="card"><div class="k">Canvas no soportados</div><div class="v ${report.counts.canvasesUnsupported ? 'warn' : 'ok'}">${report.counts.canvasesUnsupported}/${report.counts.canvases}</div></div>
  <div class="card"><div class="k">Peso de recursos</div><div class="v">${formatBytes(report.bytes.assets)}</div></div>
  <div class="card"><div class="k">Peso del HTML</div><div class="v">${formatBytes(report.bytes.html)}</div></div>
</div>

<h2>Recursos no capturados</h2>
${rows ? `<table><thead><tr><th>URL</th><th>Tipo</th><th>Motivo</th><th>Restricción</th><th>Afecta</th><th>Alternativa</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="ok">Ninguno: todos los recursos localizados se descargaron correctamente.</p>'}

${unsupported ? `<h2>Capacidades no soportadas</h2><ul>${unsupported}</ul>` : ''}

<h2>Contadores</h2><table><tbody>${counts}</tbody></table>

<h2>Metodología</h2>
<p>Esta captura se ha realizado con la extensión WebClone Ultimate, que serializa el DOM vivo, inyecta el CSS resuelto (incluido el generado por CSSOM), sustituye canvas por imágenes y descarga los recursos accesibles. Los scripts de la página se eliminan por defecto: la instantánea es estática pero conserva el estado observado mediante un script propio de restauración.</p>
<footer>WebClone Ultimate · informe generado automáticamente · datos 100% locales</footer>
</div></body></html>`;
}

export function buildReadmeHtml(input: ExportInput): string {
  const isRecording = input.kind === 'recording';
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>WebClone Ultimate — ${esc(input.session.title)}</title>
<style>${BASE_CSS}</style></head>
<body><div class="wrap">
<header class="top"><span class="badge red">WebClone Ultimate</span><h1>${esc(input.session.title || 'Captura web')}</h1></header>
<p class="mono">${esc(sanitizeUrlForReport(input.session.url))}</p>
<div class="grid">
  <div class="card"><div class="k">Tipo</div><div class="v">${isRecording ? 'Grabación de sesión' : 'Instant Clone'}</div></div>
  <div class="card"><div class="k">Fecha</div><div class="v" style="font-size:14px">${esc(input.session.createdAt)}</div></div>
  <div class="card"><div class="k">Duración</div><div class="v">${isRecording ? formatDuration(input.session.durationMs) : `${input.report.durationMs} ms de captura`}</div></div>
  <div class="card"><div class="k">Tamaño de recursos</div><div class="v">${formatBytes(input.session.assetBytes)}</div></div>
</div>

<h2>Cómo abrir esta captura</h2>
<ol>
  <li><strong>Abrir directamente:</strong> haz doble clic en <code>${isRecording ? 'replay.html' : 'index.html'}</code>. Funciona sin servidor en Chrome, Edge y Firefox.</li>
  <li><strong>Con servidor local (recomendado si hay módulos, fuentes o CSP):</strong>
    <pre>node serve-clone.mjs .      # o: python3 -m http.server 8080</pre>
    y visita <code>http://localhost:8080/${isRecording ? 'replay.html' : 'index.html'}</code>.</li>
</ol>

<h2>Contenido del paquete</h2>
<table><tbody>
<tr><th>index.html</th><td>${isRecording ? 'Reproductor de la sesión (idéntico a replay.html)' : 'Instantánea estática de la página'}</td></tr>
<tr><th>replay.html</th><td>${isRecording ? 'Reproductor de la sesión' : 'Visor de la instantánea con información de la captura'}</td></tr>
<tr><th>metadata.json</th><td>Metadatos, checksums SHA-256 y límites de la captura</td></tr>
<tr><th>snapshot/</th><td>DOM serializado (${isRecording ? 'snapshot inicial de rrweb' : 'html + estado'})</td></tr>
<tr><th>recording/</th><td>Eventos rrweb y línea temporal${isRecording ? '' : ' (vacío en un Instant Clone)'}</td></tr>
<tr><th>assets/</th><td>Imágenes, fuentes, CSS, JS, vídeo y audio capturados</td></tr>
<tr><th>screenshots/</th><td>Capturas del original y del clon (si se generaron)</td></tr>
<tr><th>reports/</th><td>Informe de captura y de compatibilidad</td></tr>
</tbody></table>

<h2>Privacidad</h2>
<p>Los datos de esta captura se han generado y guardado localmente. No se han enviado a ningún servidor. Los campos de contraseña, ocultos y de pago se han excluido. No se almacenan cookies de sesión ni tokens de autenticación. Si se importó una cookie para el Clon Completo, solo se usó durante la captura y no se incluye en este paquete; el HTML y la red capturados sí pueden contener datos visibles de la cuenta.</p>

<h2>Limitaciones conocidas</h2>
<ul>
  <li>Los scripts de la página original no se ejecutan en la reproducción: la instantánea es estática. Las grabaciones reconstruyen los cambios observados, no ejecutan la aplicación original.</li>
  <li>Iframes de origen cruzado no se serializan; se sustituyen por un marcador y quedan registrados en el informe.</li>
  <li>Canvas WebGL sin <code>preserveDrawingBuffer</code> no puede leerse; se registra como no soportado.</li>
  <li>Recursos con DRM, autenticación obligatoria o bloqueo por CORS/hotlink pueden faltar; se listan en <code>reports/capture-report.json</code>.</li>
  <li>La reproducción de audio/vídeo depende de que el navegador permita la reproducción sin gesto del usuario.</li>
</ul>
<footer>Generado por WebClone Ultimate v${esc(input.toolVersion)} · formato v1</footer>
</div></body></html>`;
}

export async function buildExportFiles(input: ExportInput): Promise<ZipInputFile[]> {
  const files: ZipInputFile[] = [];
  const isRecording = input.kind === 'recording';
  const events = (input.events ?? []) as RrwebEvent[];
  const timeline =
    input.timeline ??
    (isRecording
      ? buildTimeline(events, {
          startedAt: Date.parse(input.session.createdAt) || Date.now(),
          endedAt: (Date.parse(input.session.createdAt) || Date.now()) + input.session.durationMs,
          durationMs: input.session.durationMs,
        })
      : undefined);

  // 1. Contenido principal.
  if (isRecording) {
    const playerHtml = buildPlayerHtml({
      events,
      timeline: timeline as Timeline,
      recordingMeta: input.recordingMeta,
      report: input.report,
      session: input.session,
      hasPlayerBundle: !!input.playerBundle,
    });
    files.push({ path: 'index.html', data: textFile(playerHtml) });
    files.push({ path: 'replay.html', data: textFile(playerHtml) });
    files.push({ path: 'recording/events.json', data: textFile(json(events)) });
    files.push({ path: 'recording/timeline.json', data: textFile(json(timeline)) });
    if (input.recordingMeta) files.push({ path: 'recording/meta.json', data: textFile(json(input.recordingMeta)) });
    const snapshot = events.find((e) => e.type === 2 && (e as { data?: { node?: unknown } }).data?.node);
    files.push({
      path: 'snapshot/dom.json',
      data: textFile(
        json({
          source: 'rrweb-full-snapshot',
          capturedAt: input.session.createdAt,
          node: snapshot ? (snapshot as { data: { node: unknown } }).data.node : null,
        }),
      ),
    });
    files.push({
      path: 'snapshot/state.json',
      data: textFile(json({ note: 'El estado completo de una grabación está en recording/events.json (incremental snapshots).', timeline: timeline ? { durationMs: timeline.durationMs, marks: timeline.marks.length } : null })),
    });
  } else {
    const html = input.html ?? buildIndexFallbackHtml(input.session, 'No se encontró el HTML de la instantánea.');
    files.push({ path: 'index.html', data: textFile(html) });
    files.push({
      path: 'replay.html',
      data: textFile(
        buildCloneViewerHtml({
          htmlFile: 'index.html',
          session: input.session,
          report: input.report,
          failures: input.report.failures ?? [],
        }),
      ),
    });
    const htmlHash = await sha256Hex(new TextEncoder().encode(html));
    files.push({
      path: 'snapshot/dom.json',
      data: textFile(
        json({
          version: 1,
          url: input.session.url,
          title: input.session.title,
          htmlFile: 'index.html',
          htmlBytes: html.length,
          htmlSha256: htmlHash,
          elements: input.report.counts.elements,
        }),
      ),
    });
    files.push({ path: 'snapshot/state.json', data: textFile(json(input.state ?? {})) });
    files.push({ path: 'recording/events.json', data: textFile('[]') });
    files.push({
      path: 'recording/timeline.json',
      data: textFile(json({ version: 1, durationMs: 0, eventCount: 0, note: 'Un Instant Clone no contiene línea temporal; usa Full Session Recording.' })),
    });
  }

  // 2. Ficheros extra (frames same-origin capturados).
  for (const extra of input.extraFiles ?? []) {
    files.push({ path: extra.path, data: textFile(extra.text) });
  }

  // 3. Recursos.
  for (const asset of input.assets) files.push({ path: asset.path, data: asset.data });
  if (input.network && input.network.length > 0) {
    files.push({
      path: 'network/responses.json',
      data: textFile(
        json({
          version: 1,
          note: 'Respuestas observadas durante la captura. El clon las reproduce por método+URL y bloquea el resto.',
          responses: input.network.map((entry) => ({
            url: sanitizeUrlForReport(entry.url),
            method: entry.method,
            status: entry.status,
            mime: entry.mime,
            resourceType: entry.resourceType,
            captured: entry.captured,
            requestBodyInlined: !!entry.requestBodyBase64,
            requestMime: entry.requestMime,
            bodyInlined: !!entry.bodyBase64,
            bodyPath: entry.bodyPath,
            note: entry.note,
          })),
        }),
      ),
    });
  }
  if (input.playerBundle) files.push({ path: 'assets/js/wc-replay.js', data: textFile(input.playerBundle) });

  // 3. Capturas.
  if (input.screenshot?.dataUrl) {
    const base64 = input.screenshot.dataUrl.split(',')[1];
    if (base64) {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      files.push({ path: 'screenshots/original.png', data: bytes });
    }
  }

  // 4. Informes.
  files.push({ path: 'reports/capture-report.json', data: textFile(json(input.report)) });
  files.push({ path: 'reports/compatibility-report.html', data: textFile(buildCompatibilityReportHtml(input.report, input.session)) });
  files.push({ path: 'README.html', data: textFile(buildReadmeHtml(input)) });
  files.push({ path: 'serve-clone.mjs', data: textFile(SERVE_CLONE_SOURCE) });

  // 5. metadata.json con checksums de todo lo anterior.
  const fileEntries = [];
  for (const file of files) {
    fileEntries.push({
      path: file.path,
      bytes: file.data.byteLength,
      crc32: crc32(file.data).toString(16).padStart(8, '0'),
      sha256: await sha256Hex(file.data),
      mime: mimeForPath(file.path),
    });
  }
  const metadata = {
    tool: { name: 'WebClone Ultimate', version: input.toolVersion, formatVersion: 1 },
    session: {
      id: input.session.id,
      kind: input.kind,
      url: sanitizeUrlForReport(input.session.url),
      title: input.session.title,
      createdAt: input.session.createdAt,
      durationMs: input.session.durationMs,
      status: input.session.status,
      integrity: input.session.integrity,
    },
    counts: input.report.counts,
    bytes: { ...input.report.bytes, zipUncompressed: fileEntries.reduce((acc, f) => acc + f.bytes, 0) },
    privacy: {
      localOnly: true,
      credentialsIncluded: input.report.options?.includeCredentials ?? false,
      passwordFieldsMasked: true,
      cookiesStored: false,
      scriptsExecutedOnReplay: isRecording
        ? 'rrweb replay (solo eventos observados)'
        : !!input.report.options?.dynamic,
    },
    mode: input.report.options?.fullSession ? 'full' : input.report.options?.dynamic ? 'dynamic' : 'static',
    networkResponses: input.network?.filter((entry) => entry.captured).length ?? 0,
    limitations: [
      input.report.options?.dynamic
        ? 'El clon ejecuta el JavaScript capturado; las peticiones no capturadas se bloquean (HTTP 504).'
        : 'Los scripts de la página no se ejecutan en la instantánea.',
      'Iframes de origen cruzado se sustituyen por marcadores.',
      'Canvas WebGL sin preserveDrawingBuffer no es legible.',
      'Recursos con DRM o autenticación obligatoria no se capturan.',
      'WebSocket, EventSource y service workers no se reproducen offline.',
    ],
    files: fileEntries,
  };
  files.push({ path: 'metadata.json', data: textFile(json(metadata)) });

  // Orden estable y legible dentro del ZIP.
  return files.sort((a, b) => {
    const priority = (path: string) =>
      path === 'index.html' ? 0 : path === 'replay.html' ? 1 : path === 'metadata.json' ? 2 : path.startsWith('README') ? 3 : 4;
    const diff = priority(a.path) - priority(b.path);
    return diff !== 0 ? diff : a.path.localeCompare(b.path);
  });
}

function buildCloneViewerHtml(args: {
  htmlFile: string;
  session: SessionMeta;
  report: CaptureReport;
  failures: FailedResource[];
}): string {
  const { session, report } = args;
  const failureRows = args.failures
    .slice(0, 200)
    .map(
      (f) => `<tr><td class="mono">${esc(sanitizeUrlForReport(f.url))}</td><td>${esc(f.kind)}</td><td class="mono">${esc(f.restriction)}</td></tr>`,
    )
    .join('');
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>Visor — ${esc(session.title)}</title>
<style>${BASE_CSS}
html,body{height:100%}
body{display:flex;flex-direction:column;overflow:hidden}
.bar{display:flex;align-items:center;gap:12px;padding:8px 14px;background:#111114;border-bottom:1px solid #232329;font-size:12px}
.bar strong{font-size:13px}
.bar .url{color:#8b8b96;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.frame{flex:1;border:0;width:100%;background:#fff}
.panel{position:fixed;inset:auto 16px 16px auto;width:min(520px,90vw);max-height:60vh;overflow:auto;background:#0b0b0dee;border:1px solid #33333b;border-radius:12px;padding:14px;display:none;z-index:10;box-shadow:0 20px 60px #000a}
.panel.open{display:block}
button{background:#1b1b20;color:#e8e8ea;border:1px solid #33333b;border-radius:8px;padding:6px 10px;font:inherit;cursor:pointer}
button:hover{border-color:#ff5a5f;color:#ff8f92}</style></head>
<body>
<div class="bar"><span class="badge red">Instant Clone</span><strong>${esc(session.title)}</strong><span class="url">${esc(sanitizeUrlForReport(session.url))}</span>
<button id="toggle">Inspector de captura</button>
<a href="${esc(args.htmlFile)}" target="_blank" rel="noreferrer"><button>Pantalla completa</button></a></div>
<iframe class="frame" src="${esc(args.htmlFile)}" title="Clon"></iframe>
<div class="panel" id="panel">
  <h2 style="margin-top:0">Inspector</h2>
  <div class="grid">
    <div class="card"><div class="k">Elementos</div><div class="v">${report.counts.elements}</div></div>
    <div class="card"><div class="k">Recursos</div><div class="v">${report.counts.assetsCaptured}</div></div>
    <div class="card"><div class="k">Fallidos</div><div class="v ${report.counts.assetsFailed ? 'bad' : 'ok'}">${report.counts.assetsFailed}</div></div>
    <div class="card"><div class="k">Peso</div><div class="v">${formatBytes(report.bytes.total)}</div></div>
  </div>
  ${failureRows ? `<h2>Recursos no capturados</h2><table><thead><tr><th>URL</th><th>Tipo</th><th>Restricción</th></tr></thead><tbody>${failureRows}</tbody></table>` : '<p class="ok">Sin recursos fallidos.</p>'}
</div>
<script>
document.getElementById('toggle').addEventListener('click', function () {
  document.getElementById('panel').classList.toggle('open');
});
</script>
</body></html>`;
}
