import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildExportFiles, inlineJson } from '../../src/shared/export-files';
import { buildZip, readZip, zipEntryNames } from '../../src/shared/zip';
import { sha256Hex } from '../../src/shared/hash';
import type { CaptureReport, PageState, SessionMeta } from '../../src/shared/types';
import { rewriteRrwebAssets } from '../../src/shared/rrweb-rewrite';

const session: SessionMeta = {
  id: 'clone_test_1',
  kind: 'clone',
  url: 'https://example.test/pagina?token=xyz',
  title: 'Página de prueba ñ',
  createdAt: '2026-01-02T03:04:05.000Z',
  updatedAt: '2026-01-02T03:04:06.000Z',
  durationMs: 1234,
  eventCount: 0,
  assetCount: 2,
  assetBytes: 10,
  status: 'complete',
  integrity: 'ok',
  errorCount: 0,
  fingerprint: 'abc',
};

const report: CaptureReport = {
  version: 1,
  sessionId: session.id,
  kind: 'clone',
  url: session.url,
  title: session.title,
  startedAt: session.createdAt,
  finishedAt: session.updatedAt,
  durationMs: 1234,
  browser: { name: 'Chrome', version: '999', userAgent: 'ua' },
  viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
  counts: {
    elements: 42, shadowRoots: 1, iframes: 1, framesCaptured: 1, stylesheets: 2, stylesheetsInlined: 2,
    assetsCaptured: 2, assetsFailed: 1, canvases: 1, canvasesUnsupported: 0, media: 1, mediaCaptured: 1,
    forms: 3, scriptsStripped: 4,
  },
  bytes: { html: 100, assets: 10, total: 110 },
  fidelity: { resourceScore: 66, assetTotal: 3, assetCaptured: 2, notes: ['heurística'] },
  failures: [
    { url: 'https://cdn.test/font.woff2', kind: 'font', reason: 'HTTP 403', restriction: 'hotlink', affectsFidelity: true, alternative: 'usar fuente del sistema' },
  ],
  unsupported: ['iframe cross-origin'],
  options: {
    captureAssets: true, maxAssetBytes: 1, maxTotalAssetBytes: 2, includeCredentials: false, keepScripts: false,
    dynamic: false, captureNetwork: false, settleMs: 0, maxResponseBytes: 1, maxNetworkEntries: 10,
    captureFrames: true, maxFrameDepth: 2, captureCanvas: true, maskSensitive: true, excludeSelectors: [],
  },
};

const state: PageState = {
  version: 1, url: session.url, title: session.title, capturedAt: session.createdAt,
  viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 120, devicePixelRatio: 1 },
  forms: [], scrollables: [], media: [], canvases: [], details: [], dialogs: [], popovers: [], missing: [],
};

describe('export-files (Instant Clone)', () => {
  it('genera la estructura completa y metadata verificable', async () => {
    const files = await buildExportFiles({
      session,
      kind: 'clone',
      report,
      html: '<!DOCTYPE html><html><body><h1>hola</h1><script>/* bootstrap */</script></body></html>',
      state,
      assets: [{ path: 'assets/images/abc.png', data: new Uint8Array([1, 2, 3]) }],
      toolVersion: '1.0.0',
    });
    const paths = files.map((f) => f.path);
    for (const required of [
      'index.html', 'replay.html', 'metadata.json', 'snapshot/dom.json', 'snapshot/state.json',
      'recording/events.json', 'recording/timeline.json', 'reports/capture-report.json',
      'reports/compatibility-report.html', 'README.html', 'serve-clone.mjs', 'assets/images/abc.png',
    ]) {
      expect(paths).toContain(required);
    }

    const metadata = JSON.parse(new TextDecoder().decode(files.find((f) => f.path === 'metadata.json')!.data));
    expect(metadata.tool.name).toBe('WebClone Ultimate');
    expect(metadata.privacy.cookiesStored).toBe(false);
    expect(metadata.privacy.credentialsIncluded).toBe(false);
    expect(metadata.session.url).not.toContain('xyz');
    const htmlEntry = metadata.files.find((f: { path: string }) => f.path === 'index.html');
    expect(htmlEntry.bytes).toBeGreaterThan(10);
    expect(htmlEntry.sha256).toMatch(/^[0-9a-f]{64}$/);
    for (const entry of metadata.files) {
      const file = files.find((f) => f.path === entry.path)!;
      expect(await sha256Hex(file.data)).toBe(entry.sha256);
    }

    const replayHtml = new TextDecoder().decode(files.find((f) => f.path === 'replay.html')!.data);
    expect(replayHtml).toContain('index.html');
    expect(replayHtml).toContain('Inspector');

    const readme = new TextDecoder().decode(files.find((f) => f.path === 'README.html')!.data);
    expect(readme).toContain('serve-clone.mjs');
    expect(readme).toContain('Privacidad');
  });

  it('produce un ZIP que python zipfile y unzip aceptan', async () => {
    const files = await buildExportFiles({
      session,
      kind: 'clone',
      report,
      html: '<!DOCTYPE html><html><body>ok</body></html>',
      state,
      assets: [{ path: 'assets/fonts/x.woff2', data: new TextEncoder().encode('fuente') }],
      toolVersion: '1.0.0',
    });
    const zip = buildZip(files);
    expect(zipEntryNames(zip).length).toBe(files.length);

    const dir = mkdtempSync(join(tmpdir(), 'wc-zip-'));
    const file = join(dir, 'test.zip');
    writeFileSync(file, zip);
    const output = execFileSync('python3', ['-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip() is None, len(z.namelist()))', file], { encoding: 'utf8' });
    expect(output.trim().startsWith('True')).toBe(true);
    const unzipOut = execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
    expect(unzipOut).toContain('No errors detected');
    expect(readZip(readFileSync(file)).get('metadata.json')).toBeTruthy();
  });
});

describe('export-files (grabación)', () => {
  it('incluye eventos inline y timeline en el reproductor', async () => {
    const events = [
      { type: 4, timestamp: 1000, data: { href: 'https://x.test/' } },
      { type: 2, timestamp: 1001, data: { node: { type: 0, childNodes: [] } } },
      { type: 3, timestamp: 2000, data: { source: 2 } },
    ];
    const files = await buildExportFiles({
      session: { ...session, kind: 'recording', eventCount: 3, durationMs: 1000 },
      kind: 'recording',
      report: { ...report, kind: 'recording' },
      events,
      recordingMeta: {
        id: session.id, url: session.url, title: session.title, startedAt: session.createdAt,
        endedAt: '2026-01-02T03:04:06.000Z', durationMs: 1000, eventCount: 3, assetCount: 0, assetBytes: 0,
        errors: [{ t: 1500, type: 'error', message: 'boom' }], navigations: [], network: [], console: [],
        options: { recordCanvas: true, samplingMss: 100, recordCrossOriginIframes: false, maxEvents: 10, maxDurationMs: 0, captureAssets: true, captureNetwork: true },
      },
      assets: [],
      playerBundle: 'window.WCReplay = window.WCReplay || {};',
      toolVersion: '1.0.0',
    });
    const replay = new TextDecoder().decode(files.find((f) => f.path === 'replay.html')!.data);
    const index = new TextDecoder().decode(files.find((f) => f.path === 'index.html')!.data);
    expect(replay).toContain('assets/js/wc-replay.js');
    expect(replay).toContain('wc-events');
    expect(replay).toContain('boom');
    expect(index).toBe(replay);
    const timeline = JSON.parse(new TextDecoder().decode(files.find((f) => f.path === 'recording/timeline.json')!.data));
    expect(timeline.durationMs).toBe(1000);
    const dom = JSON.parse(new TextDecoder().decode(files.find((f) => f.path === 'snapshot/dom.json')!.data));
    expect(dom.source).toBe('rrweb-full-snapshot');
    expect(dom.node).toBeTruthy();
  });

  it('inlineJson evita cerrar el script', () => {
    const escaped = inlineJson({ a: '</script><img onerror=x>' });
    expect(escaped).not.toContain('</script>');
    expect(escaped).toContain('\\u003c');
  });
});

describe('rrweb rewrite', () => {
  it('reescribe src, srcset y estilos de los snapshots', () => {
    const events = [
      {
        type: 2,
        timestamp: 1,
        data: {
          node: {
            type: 2,
            tagName: 'html',
            attributes: {},
            childNodes: [
              { type: 2, tagName: 'img', attributes: { src: '/a.png', srcset: '/a.png 1x, /b.png 2x' }, childNodes: [] },
              { type: 2, tagName: 'div', attributes: { style: 'background:url("/c.png")' }, childNodes: [] },
            ],
          },
        },
      },
      { type: 3, timestamp: 2, data: { source: 0, adds: [{ parentId: 1, node: { type: 2, tagName: 'img', attributes: { src: 'https://x.test/d.png' }, childNodes: [] } }] } },
    ];
    const map: Record<string, string> = {
      'https://x.test/a.png': 'assets/images/a.png',
      'https://x.test/b.png': 'assets/images/b.png',
      'https://x.test/c.png': 'assets/images/c.png',
      'https://x.test/d.png': 'assets/images/d.png',
    };
    const { events: out, stats } = rewriteRrwebAssets(events, 'https://x.test/pagina', (abs) => map[abs] ?? null);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('https://x.test/a.png');
    expect(serialized).toContain('assets/images/a.png');
    expect(serialized).toContain('assets/images/b.png 2x');
    expect(serialized).toContain('url(\\"assets/images/c.png\\")');
    expect(serialized).toContain('assets/images/d.png');
    expect(stats.attributes).toBeGreaterThanOrEqual(4);
  });
});
