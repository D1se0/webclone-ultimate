import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  OUT_DIR,
  activeTabId,
  blockExternal,
  callPopup,
  compareScreenshots,
  exportZip,
  findTabId,
  launchExtension,
  screenshot,
  startClone,
  startFull,
  startRecording,
  stopFull,
  startServer,
  stopRecording,
  unzipTo,
  waitForCapture,
  waitForSession,
  type ExtensionSession,
  type StaticServer,
} from './helpers';

const EXTENSION_PATH = path.resolve('dist/chrome');
const FIXTURE_PATH = path.resolve('test/fixtures/site');

let ext: ExtensionSession;
let fixtureServer: StaticServer;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await mkdir(OUT_DIR, { recursive: true });
  fixtureServer = await startServer(FIXTURE_PATH);
  ext = await launchExtension(EXTENSION_PATH);
});

test.afterAll(async () => {
  await ext?.close().catch(() => undefined);
  fixtureServer?.stop();
});

test('Instant Clone del fixture: estructura, estado, offline y paridad visual', async () => {
  test.setTimeout(240_000);
  const targetUrl = `${fixtureServer.url}/index.html`;
  const page = await ext.context.newPage();
  await page.goto(targetUrl);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(250);

  const tabId = await activeTabId(ext.popup, page, targetUrl);
  const sessionId = await startClone(ext.popup, tabId);
  const status = await waitForCapture(ext.popup, tabId);
  expect(status.progress?.phase, `error de captura: ${JSON.stringify(status)}`).toBe('done');

  const session = await waitForSession(ext.popup, sessionId);
  const report = session.report;
  console.log(`  captura: ${report.counts.elements} elementos · ${report.counts.assetsCaptured} recursos · ${report.counts.assetsFailed} fallidos · iframes ${report.counts.framesCaptured}/${report.counts.iframes} · canvas ${report.counts.canvases} · shadow ${report.counts.shadowRoots}`);
  if (report.failures.length) console.log('  fallos:', JSON.stringify(report.failures.slice(0, 6)));
  expect(report.counts.assetsCaptured).toBeGreaterThan(0);
  expect(report.counts.shadowRoots).toBeGreaterThanOrEqual(1);
  expect(report.counts.framesCaptured).toBeGreaterThanOrEqual(1);
  expect(report.counts.canvases).toBeGreaterThanOrEqual(1);
  expect(report.counts.forms).toBeGreaterThanOrEqual(4);
  expect(report.counts.media).toBeGreaterThanOrEqual(1);

  // Screenshot del original en condiciones reproducibles (scroll 0, misma ventana).
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  const originalShot = path.join(OUT_DIR, 'fixture-original.png');
  await screenshot(page, originalShot);

  // Exportación real a ZIP desde el background.
  const zipPath = path.join(OUT_DIR, 'fixture-clone.zip');
  const zipBytes = await exportZip(ext.popup, sessionId, zipPath);
  console.log(`  ZIP del fixture: ${(zipBytes / 1024).toFixed(1)} KB`);
  const validation = execFileSync(process.execPath, ['scripts/validate-zip.mjs', zipPath], { encoding: 'utf8' });
  console.log(validation.trim().split('\n').map((line) => `  ${line}`).join('\n'));
  expect(validation).toContain('ZIP válido');

  const cloneDir = path.join(OUT_DIR, 'fixture-clone');
  const entries = await unzipTo(zipPath, cloneDir);
  expect(entries).toContain('index.html');
  expect(entries).toContain('snapshot/frames/frame-1.html');
  const frameHtml = await readFile(path.join(cloneDir, 'snapshot/frames/frame-1.html'), 'utf8');
  expect(frameHtml).toContain('Iframe same-origin');
  expect(frameHtml).toContain('wc-page-state');

  const cloneHtml = await readFile(path.join(cloneDir, 'index.html'), 'utf8');
  const cloneState = await readFile(path.join(cloneDir, 'snapshot', 'state.json'), 'utf8');
  expect(cloneState).toContain('excludedReason');
  expect(cloneState).not.toContain('super-secreta');
  expect(cloneHtml).toContain('data-wc-id');
  expect(cloneHtml).toContain('shadowrootmode="open"');
  expect(cloneHtml).toContain('data-wc-canvas="true"');
  expect(cloneHtml).toContain('wc-page-state');
  expect(cloneHtml).not.toContain('super-secreta-123');
  expect(cloneHtml).not.toContain('http-equiv="refresh"');
  expect(cloneHtml).toContain('assets/audio/');
  expect(cloneHtml).toContain('snapshot/frames/frame-1.html');
  expect(cloneHtml.match(/<script/g)?.length).toBe(2); // estado + bootstrap propio

  const cloneServer = await startServer(cloneDir);
  const clonePage = await ext.context.newPage();
  const blocked = await blockExternal(clonePage, cloneServer.url);
  await clonePage.goto(`${cloneServer.url}/index.html`);
  await clonePage.waitForLoadState('load');
  const restoredScroll = await clonePage.evaluate(() => window.scrollY);
  expect(restoredScroll).toBeGreaterThan(300);

  // Estado de formularios restaurado sin JS de la página.
  const formState = await clonePage.evaluate(() => ({
    nombre: (document.querySelector('#nombre') as HTMLInputElement | null)?.value ?? null,
    pais: (document.querySelector('#pais') as HTMLSelectElement | null)?.selectedIndex ?? null,
    acepto: (document.querySelector('#acepto') as HTMLInputElement | null)?.checked ?? null,
    password: (document.querySelector('#clave') as HTMLInputElement | null)?.value ?? null,
  }));
  expect(formState.nombre).toBe('Ada Lovelace');
  expect(formState.pais).toBe(1);
  expect(formState.acepto).toBe(true);
  expect(formState.password).toBe('');
  expect(blocked, `recursos externos solicitados por el clon: ${blocked.join(', ')}`).toEqual([]);

  await clonePage.evaluate(() => window.scrollTo(0, 0));
  await clonePage.waitForTimeout(300);
  const cloneShot = path.join(OUT_DIR, 'fixture-clone.png');
  await screenshot(clonePage, cloneShot);

  const comparison = await compareScreenshots(originalShot, cloneShot, OUT_DIR, 'fixture');
  await writeFile(path.join(OUT_DIR, 'fixture-comparison.json'), JSON.stringify(comparison, null, 2));
  console.log(`  Diferencia visual del fixture: ${comparison.percent.toFixed(2)}% (${comparison.mismatchedPixels} px)`);
  expect(comparison.percent).toBeLessThan(3);

  // Apertura directa desde file:// (sin servidor): CSS, assets y bootstrap propio.
  const filePage = await ext.context.newPage();
  const fileErrors: string[] = [];
  filePage.on('pageerror', (error) => fileErrors.push(error.message));
  await filePage.goto(`file://${path.join(cloneDir, 'index.html')}`);
  await filePage.waitForTimeout(500);
  const fileState = await filePage.evaluate(() => ({
    ready: document.documentElement.getAttribute('data-wc-ready'),
    sticky: getComputedStyle(document.querySelector('.site-header') as Element).position,
    background: getComputedStyle(document.body).backgroundColor,
    brokenImages: Array.from(document.images).filter((img) => !img.complete || img.naturalWidth === 0).length,
    scrollY: window.scrollY,
  }));
  expect(fileState.ready).toBe('true');
  expect(fileState.sticky).toBe('sticky');
  expect(fileState.background).toBe('rgb(255, 255, 255)');
  expect(fileState.brokenImages).toBe(0);
  expect(fileErrors).toEqual([]);
  await filePage.screenshot({ path: path.join(OUT_DIR, 'fixture-file-protocol.png') });
  await filePage.close();

  await cloneServer.stop();
  await clonePage.close();
  await page.close();
});

test('Full Session Recording del fixture: eventos, mutaciones y reproductor exportado', async () => {
  test.setTimeout(240_000);
  const t0 = Date.now();
  const mark = (step: string) => console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${step}`);
  const targetUrl = `${fixtureServer.url}/index.html`;
  const page = await ext.context.newPage();
  await page.goto(targetUrl);
  await page.waitForLoadState('networkidle');
  const tabId = await findTabId(ext.popup, targetUrl);
  mark('página lista');

  const sessionId = await startRecording(ext.popup, tabId);
  mark('grabación iniciada');
  await page.click('#toggle-details');
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(900);
  await page.selectOption('#pais', 'it');
  await page.waitForTimeout(600);
  await stopRecording(ext.popup, tabId);
  mark('grabación detenida');

  const session = await waitForSession(ext.popup, sessionId, 120_000);
  mark(`sesión guardada (${session.events.length} eventos)`);
  expect(session.kind).toBe('recording');
  expect(session.events.length).toBeGreaterThan(5);
  expect(session.timeline.durationMs).toBeGreaterThan(500);

  const zipPath = path.join(OUT_DIR, 'fixture-recording.zip');
  await exportZip(ext.popup, sessionId, zipPath);
  mark('ZIP exportado');
  const validation = execFileSync(process.execPath, ['scripts/validate-zip.mjs', zipPath], { encoding: 'utf8' });
  expect(validation).toContain('ZIP válido');

  const recDir = path.join(OUT_DIR, 'fixture-recording');
  await unzipTo(zipPath, recDir);
  mark('ZIP descomprimido');
  const replayHtml = await readFile(path.join(recDir, 'replay.html'), 'utf8');
  expect(replayHtml).toContain('assets/js/wc-replay.js');
  expect(replayHtml).toContain('wc-events');
  expect(replayHtml).toContain('Tarjeta añadida');
  expect(replayHtml.length).toBeGreaterThan(2000);

  const recServer = await startServer(recDir);
  const player = await ext.context.newPage();
  // Observación (no interceptación): el iframe sandbox de rrweb no convive bien con page.route.
  const external: string[] = [];
  player.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(recServer.url) && !url.startsWith('data:') && !url.startsWith('about:') && !url.startsWith('blob:')) external.push(url);
  });
  await player.goto(`${recServer.url}/replay.html`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await player.waitForSelector('.replayer-wrapper', { timeout: 30_000 });
  const playerState = await player.evaluate(() => ({
    events: document.getElementById('events-count')?.textContent,
    marks: document.querySelectorAll('#marks-body tr').length,
    hasBundle: !!(window as unknown as { WCReplay?: unknown }).WCReplay,
  }));
  expect(playerState.hasBundle).toBe(true);
  expect(Number(playerState.events)).toBeGreaterThan(5);
  expect(playerState.marks).toBeGreaterThan(0);
  expect(external, `peticiones externas: ${external.join(', ')}`).toEqual([]);
  await screenshot(player, path.join(OUT_DIR, 'fixture-replay.png'));
  await recServer.stop();
  await player.close();
  await page.close();
});

test('Clon dinámico: JS, módulos ESM, fetch/XHR, offline y paridad visual', async () => {
  test.setTimeout(300_000);
  const targetUrl = `${fixtureServer.url}/dynamic.html`;
  const page = await ext.context.newPage();
  await page.goto(targetUrl);
  await page.waitForFunction(() => document.getElementById('module-status')?.textContent === 'módulo cargado', undefined, { timeout: 20_000 });
  await page.waitForFunction(() => document.getElementById('status')?.textContent === 'datos cargados', undefined, { timeout: 20_000 });
  await page.waitForFunction(() => document.getElementById('extra-status')?.textContent === 'extra cargado', undefined, { timeout: 20_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const originalShot = path.join(OUT_DIR, 'dynamic-original.png');
  await screenshot(page, originalShot);

  const tabId = await activeTabId(ext.popup, page, targetUrl);
  const sessionId = await startClone(ext.popup, tabId, {
    dynamic: true,
    captureNetwork: true,
    keepScripts: true,
    settleMs: 1200,
    maxAssetBytes: 15 * 1024 * 1024,
    maxTotalAssetBytes: 80 * 1024 * 1024,
  });
  const status = await waitForCapture(ext.popup, tabId);
  expect(status.progress?.phase, `error de captura: ${JSON.stringify(status)}`).toBe('done');
  const session = await waitForSession(ext.popup, sessionId);
  const report = session.report;
  console.log(
    `  dinámico: ${report.counts.elements} elementos · ${report.counts.assetsCaptured} recursos · ${report.counts.scriptsKept ?? 0} scripts · ${report.counts.responsesCaptured ?? 0} respuestas`,
  );
  expect(report.options.dynamic).toBe(true);
  expect(report.counts.scriptsKept ?? 0).toBeGreaterThanOrEqual(2);
  expect(report.counts.responsesCaptured ?? 0).toBeGreaterThanOrEqual(2);
  expect(report.counts.framesCaptured).toBeGreaterThanOrEqual(1);

  const zipPath = path.join(OUT_DIR, 'dynamic-clone.zip');
  const zipBytes = await exportZip(ext.popup, sessionId, zipPath);
  const validation = execFileSync(process.execPath, ['scripts/validate-zip.mjs', zipPath], { encoding: 'utf8' });
  expect(validation).toContain('ZIP válido');
  const cloneDir = path.join(OUT_DIR, 'dynamic-clone');
  const entries = await unzipTo(zipPath, cloneDir);
  expect(entries).toContain('network/responses.json');
  const jsEntries = entries.filter((entry) => entry.startsWith('assets/js/') && entry.endsWith('.js'));
  expect(jsEntries.length).toBeGreaterThanOrEqual(2);

  const cloneHtml = await readFile(path.join(cloneDir, 'index.html'), 'utf8');
  expect(cloneHtml).toContain('id="wc-network"');
  expect(cloneHtml).toContain('__webcloneDynamic');
  expect(cloneHtml).toContain('snapshot/frames/frame-1.html');
  const scriptSources = Array.from(cloneHtml.matchAll(/<script[^>]+src="([^"]+)"/g)).map((match) => match[1]);
  expect(scriptSources.length).toBeGreaterThanOrEqual(2);
  expect(scriptSources.every((src) => src.startsWith('assets/js/'))).toBe(true);

  const jsText = (
    await Promise.all(jsEntries.map((entry) => readFile(path.join(cloneDir, entry), 'utf8')))
  ).join('\n');
  expect(jsText).not.toContain("from './lazy-module.mjs'");
  expect(jsText).toContain('import(');

  const cloneServer = await startServer(cloneDir);
  const clonePage = await ext.context.newPage();
  const blocked = await blockExternal(clonePage, cloneServer.url);
  const pageErrors: string[] = [];
  clonePage.on('pageerror', (error) => pageErrors.push(error.message));
  await clonePage.goto(`${cloneServer.url}/index.html`, { waitUntil: 'load', timeout: 60_000 });
  await clonePage.waitForFunction(() => document.getElementById('module-status')?.textContent === 'módulo cargado', undefined, { timeout: 20_000 });
  await clonePage.waitForFunction(() => document.getElementById('status')?.textContent === 'datos cargados', undefined, { timeout: 20_000 });
  await clonePage.waitForFunction(() => document.getElementById('extra-status')?.textContent === 'extra cargado', undefined, { timeout: 20_000 });

  const cloneState = await clonePage.evaluate(() => {
    const canvas = document.getElementById('lienzo') as HTMLCanvasElement | null;
    return {
      status: document.getElementById('status')?.textContent ?? '',
      module: document.getElementById('module-status')?.textContent ?? '',
      extra: document.getElementById('extra-status')?.textContent ?? '',
      apiItems: document.querySelectorAll('#api-list li').length,
      input: (document.getElementById('nombre') as HTMLInputElement | null)?.value ?? '',
      shadow: document.getElementById('host')?.shadowRoot?.textContent?.includes('Shadow DOM') ?? false,
      canvasPainted: canvas ? canvas.toDataURL('image/png').length > 1000 : false,
      dynamic: document.documentElement.getAttribute('data-wc-dynamic'),
      misses: (window as unknown as { __webcloneDynamic?: { misses?: unknown[] } }).__webcloneDynamic?.misses?.length ?? -1,
    };
  });
  expect(cloneState.status).toBe('datos cargados');
  expect(cloneState.module).toBe('módulo cargado');
  expect(cloneState.extra).toBe('extra cargado');
  expect(cloneState.apiItems).toBe(3);
  expect(cloneState.input).toBe('Grace Hopper');
  expect(cloneState.shadow).toBe(true);
  expect(cloneState.canvasPainted).toBe(true);
  expect(cloneState.dynamic).toBe('true');
  expect(cloneState.misses, `peticiones no capturadas: ${cloneState.misses}`).toBe(0);

  await clonePage.evaluate(() => window.scrollTo(0, 0));
  await clonePage.waitForTimeout(500);
  const cloneShot = path.join(OUT_DIR, 'dynamic-clone.png');
  await screenshot(clonePage, cloneShot);
  const comparison = await compareScreenshots(originalShot, cloneShot, OUT_DIR, 'dynamic');
  await writeFile(path.join(OUT_DIR, 'dynamic-comparison.json'), JSON.stringify({ ...comparison, zipBytes }, null, 2));
  console.log(`  diferencia visual dinámica: ${comparison.percent.toFixed(2)}% (${comparison.mismatchedPixels} px)`);
  expect(comparison.percent).toBeLessThan(2.5);

  await clonePage.click('#add-row');
  expect(await clonePage.textContent('#count')).toBe('1');
  expect(await clonePage.locator('#interactive-list li').count()).toBe(1);
  expect(blocked, `peticiones externas: ${blocked.join(', ')}`).toEqual([]);
  expect(pageErrors).toEqual([]);

  await cloneServer.stop();
  await clonePage.close();
  await page.close();
});

test('Clon Completo: sesión interactiva, POST offline, storage y animaciones', async () => {
  test.setTimeout(300_000);
  const targetUrl = `${fixtureServer.url}/dynamic.html`;
  const page = await ext.context.newPage();
  await page.goto(targetUrl);
  await page.waitForFunction(() => document.getElementById('module-status')?.textContent === 'módulo cargado', undefined, { timeout: 20_000 });
  await page.waitForFunction(() => document.getElementById('status')?.textContent === 'datos cargados', undefined, { timeout: 20_000 });
  await page.evaluate(() => {
    localStorage.removeItem('wc-full-count');
    localStorage.removeItem('wc-full-items');
  });
  await page.reload();
  await page.waitForFunction(() => document.getElementById('module-status')?.textContent === 'módulo cargado', undefined, { timeout: 20_000 });

  const tabId = await activeTabId(ext.popup, page, targetUrl);
  const sessionId = await startFull(ext.popup, tabId);
  await page.click('#session-add');
  await page.waitForFunction(() => document.getElementById('session-count')?.textContent === '1', undefined, { timeout: 10_000 });
  await page.click('#session-add');
  await page.waitForFunction(() => document.getElementById('session-count')?.textContent === '2', undefined, { timeout: 10_000 });
  // Navegación real entre documentos: el journal de background debe conservar los POST.
  await page.goto(`${targetUrl}?step=2`);
  await page.waitForFunction(() => document.getElementById('module-status')?.textContent === 'módulo cargado', undefined, { timeout: 20_000 });
  await page.waitForFunction(() => document.getElementById('session-count')?.textContent === '2', undefined, { timeout: 20_000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const originalShot = path.join(OUT_DIR, 'full-original.png');
  await screenshot(page, originalShot);

  await stopFull(ext.popup, tabId);
  const status = await waitForCapture(ext.popup, tabId);
  expect(status.progress?.phase, `error de captura: ${JSON.stringify(status)}`).toBe('done');
  const session = await waitForSession(ext.popup, sessionId);
  const report = session.report;
  console.log(
    `  clon completo: ${report.counts.responsesCaptured ?? 0} respuestas · ${report.counts.scriptsKept ?? 0} scripts · ${report.options.fullSession ? 'sesión' : 'sin sesión'}`,
  );
  expect(report.options.fullSession).toBe(true);
  expect(report.options.dynamic).toBe(true);
  expect(report.counts.responsesCaptured ?? 0).toBeGreaterThanOrEqual(2);
  expect(report.session?.storage.local['wc-full-count']).toBe('2');

  const zipPath = path.join(OUT_DIR, 'full-clone.zip');
  const zipBytes = await exportZip(ext.popup, sessionId, zipPath);
  const validation = execFileSync(process.execPath, ['scripts/validate-zip.mjs', zipPath], { encoding: 'utf8' });
  expect(validation).toContain('ZIP válido');
  const cloneDir = path.join(OUT_DIR, 'full-clone');
  const entries = await unzipTo(zipPath, cloneDir);
  expect(entries).toContain('session/session.json');
  expect(entries).toContain('network/responses.json');
  const cloneHtml = await readFile(path.join(cloneDir, 'index.html'), 'utf8');
  expect(cloneHtml).toContain('id="wc-session"');
  expect(cloneHtml).toContain('id="wc-network"');
  const networkManifest = JSON.parse(await readFile(path.join(cloneDir, 'network/responses.json'), 'utf8'));
  const postEntry = networkManifest.responses.find((entry: { method: string }) => entry.method === 'POST');
  expect(postEntry, 'el POST debe estar en responses.json').toBeTruthy();
  expect(postEntry.requestBodyInlined).toBe(true);

  const cloneServer = await startServer(cloneDir);
  const clonePage = await ext.context.newPage();
  const blocked = await blockExternal(clonePage, cloneServer.url);
  const pageErrors: string[] = [];
  clonePage.on('pageerror', (error) => pageErrors.push(error.message));
  await clonePage.goto(`${cloneServer.url}/index.html`, { waitUntil: 'load', timeout: 60_000 });
  await clonePage.waitForFunction(() => document.getElementById('session-count')?.textContent === '2', undefined, { timeout: 20_000 });
  await clonePage.waitForFunction(() => document.getElementById('module-status')?.textContent === 'módulo cargado', undefined, { timeout: 20_000 });
  const state = await clonePage.evaluate(() => ({
    count: document.getElementById('session-count')?.textContent ?? '',
    items: document.querySelectorAll('#session-list li').length,
    full: document.documentElement.getAttribute('data-wc-full'),
    route: location.pathname + location.search,
    storage: localStorage.getItem('wc-full-count'),
    animations: (document.getElementById('pulse') as HTMLElement | null)?.getAnimations().length ?? 0,
    playState: (document.getElementById('pulse') as HTMLElement | null)?.getAnimations()[0]?.playState ?? '',
    misses: (window as unknown as { __webcloneDynamic?: { misses?: unknown[] } }).__webcloneDynamic?.misses?.length ?? -1,
    served: (window as unknown as { __webcloneDynamic?: { served?: number } }).__webcloneDynamic?.served ?? -1,
  }));
  expect(state.count).toBe('2');
  expect(state.items).toBe(2);
  expect(state.full).toBe('true');
  expect(state.route).toBe('/dynamic.html?step=2');
  expect(state.storage).toBe('2');
  expect(state.animations).toBeGreaterThan(0);
  expect(state.playState).toBe('running');
  expect(state.misses, `peticiones no capturadas: ${state.misses}`).toBe(0);
  expect(state.served).toBeGreaterThanOrEqual(2);

  await clonePage.evaluate(() => window.scrollTo(0, 0));
  await clonePage.waitForTimeout(400);
  const cloneShot = path.join(OUT_DIR, 'full-clone.png');
  await screenshot(clonePage, cloneShot);
  const comparison = await compareScreenshots(originalShot, cloneShot, OUT_DIR, 'full');
  await writeFile(path.join(OUT_DIR, 'full-comparison.json'), JSON.stringify({ ...comparison, zipBytes }, null, 2));
  console.log(`  diferencia visual clon completo: ${comparison.percent.toFixed(2)}% (${comparison.mismatchedPixels} px)`);
  expect(comparison.percent).toBeLessThan(2.5);

  await clonePage.click('#session-add');
  await clonePage.waitForFunction(() => document.getElementById('session-count')?.textContent === '3', undefined, { timeout: 10_000 });
  expect(await clonePage.textContent('#session-count')).toBe('3');
  expect(await clonePage.locator('#session-list li').count()).toBe(3);
  expect(blocked, `peticiones externas: ${blocked.join(', ')}`).toEqual([]);
  expect(pageErrors).toEqual([]);

  await cloneServer.stop();
  await clonePage.close();
  await page.close();
});

test('Popup: dashboard, estados y session manager', async () => {
  await ext.popup.reload();
  await ext.popup.waitForSelector('#btn-clone');
  const state = await ext.popup.evaluate(() => ({
    title: document.getElementById('page-title')?.textContent ?? '',
    browser: document.getElementById('browser')?.textContent ?? '',
    sessions: document.querySelectorAll('.session').length,
    version: document.getElementById('version')?.textContent ?? '',
  }));
  expect(state.version).toBe('1.2.0');
  expect(state.browser.length).toBeGreaterThan(2);
  expect(state.sessions).toBeGreaterThanOrEqual(1);
  await ext.popup.screenshot({ path: path.join(OUT_DIR, 'popup.png') });
});

test('Importación de un ZIP exportado: integridad verificada y round-trip', async () => {
  test.setTimeout(180_000);
  const targetUrl = `${fixtureServer.url}/index.html`;
  const page = await ext.context.newPage();
  await page.goto(targetUrl);
  await page.waitForLoadState('networkidle');
  const tabId = await activeTabId(ext.popup, page, targetUrl);
  const sessionId = await startClone(ext.popup, tabId);
  await waitForCapture(ext.popup, tabId);

  const sourceZip = path.join(OUT_DIR, 'import-source.zip');
  await exportZip(ext.popup, sessionId, sourceZip);
  const base64 = Buffer.from(await readFile(sourceZip)).toString('base64');
  const imported = await ext.popup.evaluate(
    async (payload: string) => {
      const chromeApi = (globalThis as unknown as { chrome: any }).chrome;
      return (await chromeApi.runtime.sendMessage({ type: 'WC_IMPORT_SESSION', name: 'import-test.zip', dataBase64: payload })) as {
        ok: boolean;
        id?: string;
        integrity?: string;
        mismatches?: number;
        error?: string;
      };
    },
    base64,
  );
  expect(imported.ok, imported.error).toBe(true);
  expect(imported.integrity).toBe('ok');
  expect(imported.id).toBeTruthy();

  const restored = await callPopup<{ ok: boolean; session?: { meta: { title: string }; html?: string; assetPaths?: string[] } }>(ext.popup, {
    type: 'WC_SESSION_GET',
    id: imported.id,
  });
  expect(restored.session?.html?.length ?? 0).toBeGreaterThan(500);
  expect((restored.session?.assetPaths ?? []).length).toBeGreaterThan(0);

  // Round-trip: se puede volver a exportar y sigue siendo un ZIP válido.
  const roundTrip = path.join(OUT_DIR, 'import-roundtrip.zip');
  await exportZip(ext.popup, imported.id!, roundTrip);
  const validation = execFileSync(process.execPath, ['scripts/validate-zip.mjs', roundTrip], { encoding: 'utf8' });
  expect(validation).toContain('ZIP válido');

  await callPopup(ext.popup, { type: 'WC_SESSION_DELETE', id: imported.id });
  await page.close();
});

test('protocolexplorer.org — clon dinámico: JS, red, offline y visual', async () => {
  test.setTimeout(600_000);
  const targetUrl = 'https://protocolexplorer.org/es?p=http';
  const page = await ext.context.newPage();
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => undefined);
  await page.waitForTimeout(1500);

  const tabId = await activeTabId(ext.popup, page, 'https://protocolexplorer.org');
  const sessionId = await startClone(ext.popup, tabId, {
    dynamic: true,
    captureNetwork: true,
    keepScripts: true,
    settleMs: 1500,
    maxAssetBytes: 20 * 1024 * 1024,
    maxTotalAssetBytes: 150 * 1024 * 1024,
  });
  const status = await waitForCapture(ext.popup, tabId, 300_000);
  expect(status.progress?.phase, `error: ${JSON.stringify(status)}`).toBe('done');
  const session = await waitForSession(ext.popup, sessionId);
  const report = session.report;
  console.log(
    `  proto dinámico: ${report.counts.assetsCaptured} recursos · ${report.counts.scriptsKept ?? 0} scripts · ${report.counts.responsesCaptured ?? 0} respuestas · ${report.counts.assetsFailed} fallidos`,
  );
  // React 18 con hidratación: el modo automático debe proteger la fidelidad.
  expect(report.options.dynamic).toBe(false);
  expect(report.counts.scriptsStripped).toBeGreaterThan(0);
  expect(report.counts.scriptsKept ?? 0).toBe(0);
  expect(report.unsupported.join(' ')).toContain('Framework de hidratación detectado');

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const originalShot = path.join(OUT_DIR, 'proto-dynamic-original.png');
  await screenshot(page, originalShot);

  const zipPath = path.join(OUT_DIR, 'proto-dynamic-clone.zip');
  const zipBytes = await exportZip(ext.popup, sessionId, zipPath);
  const validation = execFileSync(process.execPath, ['scripts/validate-zip.mjs', zipPath], { encoding: 'utf8' });
  expect(validation).toContain('ZIP válido');
  const cloneDir = path.join(OUT_DIR, 'proto-dynamic-clone');
  await unzipTo(zipPath, cloneDir);
  const cloneServer = await startServer(cloneDir);
  const clonePage = await ext.context.newPage();
  const blocked = await blockExternal(clonePage, cloneServer.url);
  const pageErrors: string[] = [];
  clonePage.on('pageerror', (error) => pageErrors.push(error.message));
  await clonePage.goto(`${cloneServer.url}/index.html`, { waitUntil: 'load', timeout: 90_000 });
  await clonePage.waitForTimeout(2500);
  await clonePage.evaluate(() => window.scrollTo(0, 0));
  await clonePage.waitForTimeout(500);
  const cloneShot = path.join(OUT_DIR, 'proto-dynamic-clone.png');
  await screenshot(clonePage, cloneShot);
  const comparison = await compareScreenshots(originalShot, cloneShot, OUT_DIR, 'proto-dynamic');
  const runtimeState = await clonePage.evaluate(() => ({
    misses: (window as unknown as { __webcloneDynamic?: { misses?: unknown[] } }).__webcloneDynamic?.misses?.length ?? -1,
    dynamic: document.documentElement.getAttribute('data-wc-dynamic'),
    title: document.title,
    text: (document.body?.innerText ?? '').slice(0, 200),
  }));
  await writeFile(
    path.join(OUT_DIR, 'proto-dynamic-report.json'),
    JSON.stringify(
      {
        url: targetUrl,
        capturedAt: new Date().toISOString(),
        zipBytes,
        report: {
          counts: report.counts,
          bytes: report.bytes,
          fidelity: report.fidelity,
          failures: report.failures.slice(0, 60),
          unsupported: report.unsupported,
          durationMs: report.durationMs,
        },
        visual: comparison,
        runtimeState,
        pageErrors: pageErrors.slice(0, 30),
        externalRequestsBlocked: blocked.slice(0, 100),
      },
      null,
      2,
    ),
  );
  console.log(`  proto dinámico — fallback estático por hidratación; diferencia visual: ${comparison.percent.toFixed(2)}%`);
  console.log(`  peticiones externas del clon bloqueadas: ${blocked.length}`);
  expect(report.counts.elements).toBeGreaterThan(50);
  expect(zipBytes).toBeGreaterThan(1000);
  expect(comparison.percent).toBeLessThan(2);
  expect(blocked).toEqual([]);

  await cloneServer.stop();
  await clonePage.close();
  await page.close();
});

test('protocolexplorer.org: captura real, ZIP, visual y limitaciones', async () => {
  test.setTimeout(600_000);
  const targetUrl = 'https://protocolexplorer.org/es?p=http';
  const page = await ext.context.newPage();
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => undefined);
  await page.waitForTimeout(1500);

  const tabId = await activeTabId(ext.popup, page, 'https://protocolexplorer.org');
  const sessionId = await startClone(ext.popup, tabId, {
    maxAssetBytes: 20 * 1024 * 1024,
    maxTotalAssetBytes: 120 * 1024 * 1024,
  });
  const status = await waitForCapture(ext.popup, tabId, 300_000);
  expect(status.progress?.phase, `error: ${JSON.stringify(status)}`).toBe('done');
  const session = await waitForSession(ext.popup, sessionId);
  const report = session.report;

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const originalShot = path.join(OUT_DIR, 'proto-original.png');
  await screenshot(page, originalShot);

  const zipPath = path.join(OUT_DIR, 'proto-clone.zip');
  const zipBytes = await exportZip(ext.popup, sessionId, zipPath);
  const validation = execFileSync(process.execPath, ['scripts/validate-zip.mjs', zipPath], { encoding: 'utf8' });
  expect(validation).toContain('ZIP válido');

  const cloneDir = path.join(OUT_DIR, 'proto-clone');
  await unzipTo(zipPath, cloneDir);
  const cloneServer = await startServer(cloneDir);
  const clonePage = await ext.context.newPage();
  const blocked = await blockExternal(clonePage, cloneServer.url);
  await clonePage.goto(`${cloneServer.url}/index.html`, { waitUntil: 'load', timeout: 60_000 });
  await clonePage.evaluate(() => window.scrollTo(0, 0));
  await clonePage.waitForTimeout(700);
  const cloneShot = path.join(OUT_DIR, 'proto-clone.png');
  await screenshot(clonePage, cloneShot);

  const comparison = await compareScreenshots(originalShot, cloneShot, OUT_DIR, 'proto');
  const summary = {
    url: targetUrl,
    capturedAt: new Date().toISOString(),
    zipBytes,
    report: {
      counts: report.counts,
      bytes: report.bytes,
      fidelity: report.fidelity,
      failures: report.failures.slice(0, 50),
      unsupported: report.unsupported,
      durationMs: report.durationMs,
    },
    visual: comparison,
    externalRequestsBlocked: blocked.slice(0, 100),
  };
  await writeFile(path.join(OUT_DIR, 'proto-report.json'), JSON.stringify(summary, null, 2));
  console.log(`  protocolexplorer.org — diferencia visual: ${comparison.percent.toFixed(2)}%`);
  console.log(`  recursos capturados: ${report.counts.assetsCaptured}, fallidos: ${report.counts.assetsFailed}, peso: ${(zipBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  peticiones externas del clon bloqueadas: ${blocked.length}`);
  await cloneServer.stop();

  expect(report.counts.elements).toBeGreaterThan(50);
  expect(zipBytes).toBeGreaterThan(1000);
  expect(comparison.percent).toBeLessThan(40);
});
