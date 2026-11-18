/* Wrapper mínimo sobre WebExtensions para Chrome/Chromium y Firefox. */

export type ExtAny = any;

export const ext: ExtAny =
  (globalThis as ExtAny).browser ?? (globalThis as ExtAny).chrome;

export const isFirefox = typeof (globalThis as ExtAny).browser !== 'undefined';

export function runtimeSend<T = unknown>(message: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      if (isFirefox) {
        const ret = ext.runtime.sendMessage(message);
        if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
        else resolve(ret as T);
        return;
      }
      let done = false;
      const ret = ext.runtime.sendMessage(message, (response: T) => {
        done = true;
        const err = ext.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(response);
      });
      if (ret && typeof ret.then === 'function') {
        ret.then(
          (value: T) => {
            if (!done) resolve(value);
          },
          (error: unknown) => {
            if (!done) reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      }
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function onRuntimeMessage(
  handler: (message: any, sender: any, sendResponse: (response?: unknown) => void) => boolean | void | Promise<unknown>,
): void {
  ext.runtime.onMessage.addListener((message: any, sender: any, sendResponse: (response?: unknown) => void) => {
    const result = handler(message, sender, sendResponse);
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<unknown>).then(
        (value) => sendResponse(value),
        (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
      return true;
    }
    return result === true;
  });
}

export interface BrowserInfo {
  name: 'Chrome' | 'Edge' | 'Chromium' | 'Firefox' | 'Safari' | 'Unknown';
  version: string;
  userAgent: string;
  supports: {
    debugger: boolean;
    offscreen: boolean;
    serviceWorker: boolean;
    declarativeShadowDom: boolean;
  };
}

export function detectBrowser(): BrowserInfo {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  let name: BrowserInfo['name'] = 'Unknown';
  let version = '';
  if (/Firefox\/([\d.]+)/.test(ua)) {
    name = 'Firefox';
    version = RegExp.$1;
  } else if (/Edg\/([\d.]+)/.test(ua)) {
    name = 'Edge';
    version = RegExp.$1;
  } else if (/Chrome\/([\d.]+)/.test(ua)) {
    name = /Chromium\//.test(ua) ? 'Chromium' : 'Chrome';
    version = RegExp.$1;
  } else if (/Safari\/([\d.]+)/.test(ua)) {
    name = 'Safari';
    version = RegExp.$1;
  }
  return {
    name,
    version,
    userAgent: ua,
    supports: {
      debugger: typeof ext?.debugger !== 'undefined',
      offscreen: typeof ext?.offscreen !== 'undefined',
      serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
      declarativeShadowDom: typeof Element !== 'undefined' && 'setHTMLUnsafe' in Element.prototype,
    },
  };
}

export function extensionUrl(path: string): string {
  return ext.runtime.getURL(path);
}

export async function queryActiveTab(): Promise<{ id?: number; url?: string; title?: string; windowId?: number } | null> {
  const tabs = await ext.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0] ? tabs[0] : null;
}

export async function storageGet<T = unknown>(key: string): Promise<T | undefined> {
  try {
    const result = await ext.storage.local.get(key);
    return result ? (result[key] as T) : undefined;
  } catch {
    return undefined;
  }
}

export async function storageSet(key: string, value: unknown): Promise<void> {
  await ext.storage.local.set({ [key]: value });
}

export async function downloadBytes(bytes: Uint8Array, filename: string): Promise<number | undefined> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  try {
    if (ext.downloads?.download) {
      const id = await ext.downloads.download({ url, filename, saveAs: false });
      return typeof id === 'number' ? id : undefined;
    }
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    return undefined;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
