import { chromium, type BrowserContext, type Page, type Route } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { unzipSync } from 'fflate';

export const OUT_DIR = path.resolve('reports/out');

export interface ExtensionSession {
  context: BrowserContext;
  popup: Page;
  extensionId: string;
  close: () => Promise<void>;
}

/** Lanza Chromium con la extensión desempaquetada cargada (headless=new). */
export async function launchExtension(extensionPath: string): Promise<ExtensionSession> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'wc-profile-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
    ],
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'es-ES',
  });
  let workers = context.serviceWorkers();
  if (workers.length === 0) {
    try {
      await context.waitForEvent('serviceworker', { timeout: 30_000 });
    } catch {
      /* seguimos: el popup puede despertar el SW */
    }
    workers = context.serviceWorkers();
  }
  const popup = await context.newPage();
  let extensionId = workers[0] ? new URL(workers[0].url()).host : '';
  if (!extensionId) {
    // Espera a que el SW arranque tras abrir una página de extensión conocida.
    extensionId = process.env.WC_EXTENSION_ID ?? '';
    if (!extensionId) throw new Error('No se pudo determinar el ID de la extensión');
  }
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
  await popup.waitForSelector('#btn-clone');
  return {
    context,
    popup,
    extensionId,
    close: async () => {
      await context.close();
    },
  };
}

export async function callPopup<T = unknown>(popup: Page, message: Record<string, unknown>): Promise<T> {
  return (await popup.evaluate(
    (msg: unknown) => (globalThis as unknown as { chrome: { runtime: { sendMessage: (m: unknown) => Promise<unknown> } } }).chrome.runtime.sendMessage(msg),
    message,
  )) as T;
}

export async function findTabId(popup: Page, urlPrefix: string): Promise<number> {
  const id = await popup.evaluate(async (prefix: string) => {
    const chromeApi = (globalThis as unknown as { chrome: any }).chrome;
    const tabs = await chromeApi.tabs.query({});
    const tab = tabs.find((t: { url?: string }) => (t.url ?? '').startsWith(prefix));
    return tab?.id as number | undefined;
  }, urlPrefix);
  if (!id) throw new Error(`No se encontró la pestaña ${urlPrefix}`);
  return id;
}

/** Trae la página al frente, la deja como pestaña activa y devuelve su tabId. */
export async function activeTabId(popup: Page, page: Page, urlPrefix: string): Promise<number> {
  await page.bringToFront();
  await sleep(250);
  const id = await popup.evaluate(async () => {
    const chromeApi = (globalThis as unknown as { chrome: any }).chrome;
    const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
    return tab?.id as number | undefined;
  });
  if (!id) throw new Error('No hay pestaña activa');
  const url = await popup.evaluate(async (tabId: number) => {
    const chromeApi = (globalThis as unknown as { chrome: any }).chrome;
    const tab = await chromeApi.tabs.get(tabId);
    return (tab?.url ?? '') as string;
  }, id);
  if (!url.startsWith(urlPrefix)) throw new Error(`La pestaña activa (${url}) no coincide con ${urlPrefix}`);
  return id;
}

export interface TabStatus {
  ok: boolean;
  tabId?: number;
  recording: boolean;
  busy: boolean;
  sessionId?: string;
  progress?: { phase: string; message: string; percent: number };
  eventCount: number;
  elapsedMs: number;
  error?: string;
  url?: string;
  title?: string;
}

export async function waitForCapture(popup: Page, tabId: number, timeoutMs = 180_000): Promise<TabStatus> {
  const started = Date.now();
  let last: TabStatus | null = null;
  while (Date.now() - started < timeoutMs) {
    const status = await callPopup<TabStatus>(popup, { type: 'WC_GET_TAB_STATUS', tabId });
    last = status;
    if (status?.progress?.phase === 'done' || status?.progress?.phase === 'error') return status;
    await sleep(400);
  }
  throw new Error(`Timeout esperando la captura. Último estado: ${JSON.stringify(last)}`);
}

export async function startClone(popup: Page, tabId: number, options: Record<string, unknown> = {}): Promise<string> {
  const response = await callPopup<{ ok: boolean; sessionId?: string; error?: string }>(popup, {
    type: 'WC_START_CAPTURE',
    tabId,
    options: {
      captureAssets: true,
      captureCanvas: true,
      captureFrames: true,
      maskSensitive: true,
      keepScripts: false,
      // Los tests históricos validan el modo estático; el dinámico se solicita explícitamente.
      dynamic: false,
      captureNetwork: false,
      maxAssetBytes: 15 * 1024 * 1024,
      maxTotalAssetBytes: 80 * 1024 * 1024,
      ...options,
    },
  });
  if (!response?.ok || !response.sessionId) throw new Error(response?.error ?? 'captura no iniciada');
  return response.sessionId;
}

export async function startFull(popup: Page, tabId: number, options: Record<string, unknown> = {}): Promise<string> {
  const response = await callPopup<{ ok: boolean; sessionId?: string; error?: string }>(popup, {
    type: 'WC_START_FULL_CAPTURE',
    tabId,
    options: {
      captureAssets: true,
      captureCanvas: true,
      captureFrames: true,
      maskSensitive: true,
      dynamic: true,
      captureNetwork: true,
      keepScripts: true,
      maxAssetBytes: 15 * 1024 * 1024,
      maxTotalAssetBytes: 80 * 1024 * 1024,
      ...options,
    },
  });
  if (!response?.ok || !response.sessionId) throw new Error(response?.error ?? 'Clon Completo no iniciado');
  return response.sessionId;
}

export async function stopFull(popup: Page, tabId: number): Promise<void> {
  const response = await callPopup<{ ok: boolean; error?: string }>(popup, { type: 'WC_STOP_FULL_CAPTURE', tabId });
  if (!response?.ok) throw new Error(response?.error ?? 'no se pudo finalizar el Clon Completo');
}

export async function startRecording(popup: Page, tabId: number): Promise<string> {
  const response = await callPopup<{ ok: boolean; sessionId?: string; error?: string }>(popup, { type: 'WC_START_RECORD', tabId });
  if (!response?.ok || !response.sessionId) throw new Error(response?.error ?? 'grabación no iniciada');
  return response.sessionId;
}

export async function stopRecording(popup: Page, tabId: number): Promise<void> {
  const response = await callPopup<{ ok: boolean; error?: string }>(popup, { type: 'WC_STOP_RECORD', tabId });
  if (!response?.ok) throw new Error(response?.error ?? 'no se pudo detener');
}

export async function waitForSession(popup: Page, sessionId: string, timeoutMs = 180_000): Promise<any> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await callPopup<{ ok: boolean; session?: any; error?: string }>(popup, { type: 'WC_SESSION_GET', id: sessionId });
    if (response?.ok && response.session) return response.session;
    await sleep(500);
  }
  throw new Error(`Timeout esperando la sesión ${sessionId}`);
}

export async function exportZip(popup: Page, sessionId: string, outPath: string): Promise<number> {
  const base64 = await popup.evaluate(async (id: string) => {
    const chromeApi = (globalThis as unknown as { chrome: any }).chrome;
    const response = await chromeApi.runtime.sendMessage({ type: 'WC_SESSION_EXPORT', id });
    if (!response?.ok) throw new Error(response?.error ?? 'export falló');
    return response.base64 as string;
  }, sessionId);
  const buffer = Buffer.from(base64, 'base64');
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, buffer);
  return buffer.byteLength;
}

export async function unzipTo(zipPath: string, dir: string): Promise<string[]> {
  await rm(dir, { recursive: true, force: true });
  const entries = unzipSync(new Uint8Array(await readFile(zipPath)));
  const names: string[] = [];
  for (const [name, data] of Object.entries(entries)) {
    const target = path.join(dir, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    names.push(name);
  }
  return names;
}

export interface StaticServer {
  url: string;
  port: number;
  stop: () => void;
}

export async function startServer(root: string, port?: number): Promise<StaticServer> {
  const chosen = port ?? 8400 + Math.floor(Math.random() * 400);
  const child: ChildProcess = spawn(process.execPath, [path.resolve('scripts/serve-clone.mjs'), root, String(chosen)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = `http://127.0.0.1:${chosen}`;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout esperando al servidor estático')), 15_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('sirviendo')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('error', reject);
  });
  return { url, port: chosen, stop: () => child.kill('SIGTERM') };
}

export async function screenshot(page: Page, outPath: string): Promise<void> {
  await mkdir(path.dirname(outPath), { recursive: true });
  await page.evaluate(async () => {
    await (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
  });
  await page.waitForTimeout(350);
  await page.screenshot({ path: outPath, animations: 'disabled', caret: 'hide' });
}

/** Abre una página aplicando bloqueo de red externa (simula "offline"). */
export async function blockExternal(page: Page, localOrigin: string): Promise<string[]> {
  const blocked: string[] = [];
  await page.route('**/*', (route: Route) => {
    const url = route.request().url();
    if (url.startsWith(localOrigin) || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) {
      return route.continue();
    }
    blocked.push(url);
    return route.abort();
  });
  return blocked;
}

export interface CompareResult {
  width: number;
  height: number;
  mismatchedPixels: number;
  totalPixels: number;
  percent: number;
  dimensionMismatch: boolean;
}

/** Comparación pixel a pixel con pixelmatch + imágenes de diff y superposición. */
export async function compareScreenshots(
  originalPath: string,
  clonePath: string,
  outDir: string,
  label: string,
): Promise<CompareResult> {
  const original = PNG.sync.read(await readFile(originalPath));
  const clone = PNG.sync.read(await readFile(clonePath));
  const width = Math.min(original.width, clone.width);
  const height = Math.min(original.height, clone.height);
  const dimensionMismatch = original.width !== clone.width || original.height !== clone.height;

  const normalize = (png: PNG): Buffer => {
    if (png.width === width && png.height === height) return png.data as Buffer;
    const out = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const src = (png.width * y + x) << 2;
        const dst = (width * y + x) << 2;
        out[dst] = png.data[src];
        out[dst + 1] = png.data[src + 1];
        out[dst + 2] = png.data[src + 2];
        out[dst + 3] = png.data[src + 3];
      }
    }
    return out;
  };

  const a = normalize(original);
  const b = normalize(clone);
  const diff = new PNG({ width, height });
  const mismatchedPixels = pixelmatch(a, b, diff.data as Buffer, width, height, {
    threshold: 0.1,
    includeAA: false,
    alpha: 0.35,
    diffMask: false,
  });

  const overlay = new PNG({ width, height });
  for (let i = 0; i < width * height * 4; i += 4) {
    overlay.data[i] = Math.round((a[i] * 0.5 + b[i] * 0.5));
    overlay.data[i + 1] = Math.round((a[i + 1] * 0.5 + b[i + 1] * 0.5));
    overlay.data[i + 2] = Math.round((a[i + 2] * 0.5 + b[i + 2] * 0.5));
    overlay.data[i + 3] = 255;
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `${label}-diff.png`), PNG.sync.write(diff));
  await writeFile(path.join(outDir, `${label}-overlay.png`), PNG.sync.write(overlay));

  const totalPixels = width * height;
  return {
    width,
    height,
    mismatchedPixels,
    totalPixels,
    percent: totalPixels > 0 ? (mismatchedPixels / totalPixels) * 100 : 0,
    dimensionMismatch,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
