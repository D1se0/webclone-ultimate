/**
 * Hooks que se ejecutan en el MAIN world de la página (mismo contexto que su JS).
 * Se inyectan con chrome.scripting.executeScript({ world: 'MAIN' }) o como
 * content script `world: "MAIN"` y se comunican con el content script por
 * window.postMessage. El código debe ser autocontenido.
 *
 * Mantiene un journal de peticiones (fetch/XHR) con metadatos, cuerpos de
 * petición/respuesta y cabeceras no sensibles. En una sesión completa el
 * journal permanece armado mientras el usuario interactúa.
 */

export function installPageHooks(): void {
  const w = window as unknown as { __webcloneHooked?: boolean };
  if (w.__webcloneHooked) return;
  w.__webcloneHooked = true;

  const post = (payload: unknown) => {
    try {
      window.postMessage({ __webclone: true, payload }, '*');
    } catch {
      /* ignore */
    }
  };

  const now = () => Date.now();

  interface JournalEntry {
    id: string;
    t: number;
    url: string;
    method: string;
    status: number;
    mime: string;
    resourceType: string;
    durationMs: number;
    failed: boolean;
    requestBodyBase64?: string;
    requestMime?: string;
    requestHeaders?: Record<string, string>;
    responseHeaders?: Record<string, string>;
    bodyBase64?: string;
    note?: string;
  }

  interface BodyCapture {
    base64: string;
    mime: string;
    bytes: number;
    truncated?: boolean;
  }

  const MAX_ENTRIES = 1200;
  const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
  const MAX_REQUEST_BYTES = 1024 * 1024;
  const MAX_TOTAL_BODY_BYTES = 16 * 1024 * 1024;
  const SENSITIVE_HEADER = /authorization|cookie|set-cookie|proxy-authorization|x-api-key|api-key|token|secret/i;

  const journal: JournalEntry[] = [];
  const pending: Promise<void>[] = [];
  let armed = false;
  let totalBodyBytes = 0;
  let sequence = 0;

  const normalize = (url: string | URL): string => {
    try {
      return new URL(String(url), location.href).href;
    } catch {
      return String(url);
    }
  };

  const toBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
    }
    return btoa(binary);
  };

  const safeHeaders = (headers?: HeadersInit | null): Record<string, string> | undefined => {
    if (!headers) return undefined;
    const out: Record<string, string> = {};
    try {
      const normalized = new Headers(headers);
      normalized.forEach((value, key) => {
        if (SENSITIVE_HEADER.test(key)) return;
        if (value.length > 2048) return;
        out[key.toLowerCase()] = value;
      });
    } catch {
      return undefined;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };

  const contentTypeOf = (headers?: HeadersInit | null): string => {
    if (!headers) return '';
    try {
      return new Headers(headers).get('content-type') || '';
    } catch {
      return '';
    }
  };

  const decodeRequestHeaders = (input: RequestInfo | URL, init?: RequestInit): Record<string, string> | undefined => {
    if (init?.headers) return safeHeaders(init.headers);
    if (input instanceof Request) return safeHeaders(input.headers);
    return undefined;
  };

  const describeBody = async (value: unknown, mimeHint = ''): Promise<BodyCapture | null> => {
    if (value == null) return null;
    try {
      let bytes: Uint8Array;
      let mime = mimeHint || '';
      if (typeof value === 'string') {
        bytes = new TextEncoder().encode(value);
      } else if (value instanceof URLSearchParams) {
        bytes = new TextEncoder().encode(value.toString());
        mime = mime || 'application/x-www-form-urlencoded';
      } else if (value instanceof Blob) {
        bytes = new Uint8Array(await value.arrayBuffer());
        mime = mime || value.type || 'application/octet-stream';
      } else if (value instanceof FormData) {
        const pairs: string[] = [];
        value.forEach((item, key) => {
          if (typeof item === 'string') pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(item)}`);
          else pairs.push(`${encodeURIComponent(key)}=[file:${item.name || 'archivo'}]`);
        });
        bytes = new TextEncoder().encode(pairs.join('&'));
        mime = mime || 'multipart/form-data';
      } else if (value instanceof ArrayBuffer) {
        bytes = new Uint8Array(value);
      } else if (ArrayBuffer.isView(value)) {
        bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      } else {
        bytes = new TextEncoder().encode(JSON.stringify(value));
        mime = mime || 'application/json';
      }
      if (bytes.byteLength > MAX_REQUEST_BYTES || totalBodyBytes + bytes.byteLength > MAX_TOTAL_BODY_BYTES) {
        return { base64: '', mime, bytes: bytes.byteLength, truncated: true };
      }
      totalBodyBytes += bytes.byteLength;
      return { base64: toBase64(bytes), mime, bytes: bytes.byteLength };
    } catch {
      return null;
    }
  };

  const requestBody = async (input: RequestInfo | URL, init?: RequestInit): Promise<BodyCapture | null> => {
    if (!armed) return null;
    if (init && init.body != null) {
      return describeBody(init.body, contentTypeOf(init.headers));
    }
    if (input instanceof Request && !input.bodyUsed) {
      try {
        const clone = input.clone();
        const mime = clone.headers.get('content-type') || '';
        const buffer = await clone.arrayBuffer();
        if (buffer.byteLength === 0) return null;
        if (buffer.byteLength > MAX_REQUEST_BYTES || totalBodyBytes + buffer.byteLength > MAX_TOTAL_BODY_BYTES) {
          return { base64: '', mime, bytes: buffer.byteLength, truncated: true };
        }
        totalBodyBytes += buffer.byteLength;
        return { base64: toBase64(new Uint8Array(buffer)), mime, bytes: buffer.byteLength };
      } catch {
        return null;
      }
    }
    return null;
  };

  const responseBody = async (response: Response): Promise<BodyCapture | null> => {
    if (!armed) return null;
    try {
      const declared = Number(response.headers.get('content-length') || 0);
      const mime = response.headers.get('content-type') || 'application/octet-stream';
      if (declared > MAX_RESPONSE_BYTES || totalBodyBytes + declared > MAX_TOTAL_BODY_BYTES) {
        return { base64: '', mime, bytes: declared, truncated: true };
      }
      const buffer = await response.clone().arrayBuffer();
      if (buffer.byteLength > MAX_RESPONSE_BYTES || totalBodyBytes + buffer.byteLength > MAX_TOTAL_BODY_BYTES) {
        return { base64: '', mime, bytes: buffer.byteLength, truncated: true };
      }
      totalBodyBytes += buffer.byteLength;
      return { base64: toBase64(new Uint8Array(buffer)), mime, bytes: buffer.byteLength };
    } catch {
      return null;
    }
  };

  const xhrBody = async (xhr: XMLHttpRequest): Promise<BodyCapture | null> => {
    if (!armed) return null;
    try {
      const mime = xhr.getResponseHeader('content-type') || 'application/octet-stream';
      let buffer: ArrayBuffer;
      if (xhr.responseType === '' || xhr.responseType === 'text') {
        buffer = new TextEncoder().encode(xhr.responseText).buffer;
      } else if (xhr.responseType === 'json') {
        buffer = new TextEncoder().encode(JSON.stringify(xhr.response)).buffer;
      } else if (xhr.responseType === 'arraybuffer') {
        buffer = xhr.response as ArrayBuffer;
      } else if (xhr.responseType === 'blob') {
        buffer = await (xhr.response as Blob).arrayBuffer();
      } else {
        return null;
      }
      if (!buffer) return { base64: '', mime, bytes: 0 };
      if (buffer.byteLength > MAX_RESPONSE_BYTES || totalBodyBytes + buffer.byteLength > MAX_TOTAL_BODY_BYTES) {
        return { base64: '', mime, bytes: buffer.byteLength, truncated: true };
      }
      totalBodyBytes += buffer.byteLength;
      return { base64: toBase64(new Uint8Array(buffer)), mime, bytes: buffer.byteLength };
    } catch {
      return null;
    }
  };

  const record = (entry: JournalEntry): void => {
    if (!/^https?:/i.test(entry.url)) return;
    journal.push(entry);
    if (journal.length > MAX_ENTRIES) journal.shift();
  };

  const shouldCaptureBody = (mime: string): boolean =>
    /json|text|javascript|ecmascript|xml|graphql|x-www-form-urlencoded|octet-stream/i.test(mime);

  const nextId = (): string => `n${now().toString(36)}_${sequence++}`;

  const responseHeadersOf = (xhr: XMLHttpRequest): Record<string, string> | undefined => {
    try {
      const out: Record<string, string> = {};
      for (const line of xhr.getAllResponseHeaders().split(/\r?\n/)) {
        const index = line.indexOf(':');
        if (index <= 0) continue;
        const key = line.slice(0, index).trim().toLowerCase();
        if (!key || SENSITIVE_HEADER.test(key)) continue;
        out[key] = line.slice(index + 1).trim();
      }
      return Object.keys(out).length > 0 ? out : undefined;
    } catch {
      return undefined;
    }
  };

  // Órdenes desde el content script (armar / limpiar / snapshot).
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as { __webclone?: boolean; command?: string; requestId?: string } | null;
    if (!data || data.__webclone !== true) return;
    if (data.command === 'arm') {
      armed = true;
      post({ type: 'armed', t: now(), requestId: data.requestId });
    } else if (data.command === 'clear') {
      journal.length = 0;
      pending.length = 0;
      totalBodyBytes = 0;
      armed = false;
      post({ type: 'cleared', t: now(), requestId: data.requestId });
    } else if (data.command === 'snapshot') {
      const wait = pending.slice();
      void Promise.all(wait)
        .catch(() => undefined)
        .then(() => {
          const entries = journal.map((entry) => ({ ...entry }));
          post({ type: 'journal', t: now(), requestId: data.requestId, entries });
        });
    }
  });

  // Errores no capturados.
  window.addEventListener(
    'error',
    (event) => {
      const target = event.target as HTMLElement | null;
      if (target && target !== (window as unknown as HTMLElement) && (target as HTMLImageElement).tagName) {
        const tag = (target as HTMLImageElement).tagName.toLowerCase();
        if (['img', 'script', 'link', 'video', 'audio', 'source'].includes(tag)) {
          post({
            type: 'resource-error',
            t: now(),
            url: (target as HTMLImageElement).src || (target as HTMLLinkElement).href || '',
            tag,
          });
          return;
        }
      }
      post({
        type: 'error',
        t: now(),
        message: String(event.message || 'Error desconocido'),
        source: event.filename,
        line: event.lineno,
        column: event.colno,
        stack: (event.error && event.error.stack) || '',
      });
    },
    true,
  );

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    post({
      type: 'unhandledrejection',
      t: now(),
      message: reason && reason.message ? String(reason.message) : String(reason),
      stack: (reason && reason.stack) || '',
    });
  });

  // Consola de errores (sin interceptar logs normales).
  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      post({ type: 'console', t: now(), level: 'error', message: args.map((a) => (typeof a === 'string' ? a : safeJson(a))).join(' ') });
    } catch {
      /* ignore */
    }
    originalError(...args);
  };
  const originalWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    try {
      post({ type: 'console', t: now(), level: 'warn', message: args.map((a) => (typeof a === 'string' ? a : safeJson(a))).join(' ') });
    } catch {
      /* ignore */
    }
    originalWarn(...args);
  };

  function safeJson(value: unknown): string {
    try {
      return JSON.stringify(value)?.slice(0, 500) ?? String(value);
    } catch {
      return String(value);
    }
  }

  // Navegación SPA.
  const notifyNavigation = (kind: string) => {
    post({ type: 'navigation', t: now(), kind, to: location.href });
  };
  const wrapHistory = (name: 'pushState' | 'replaceState') => {
    const original = history[name].bind(history);
    history[name] = function (data: unknown, unused: string, url?: string | URL | null) {
      const result = original(data, unused, url as string);
      notifyNavigation(name === 'pushState' ? 'push' : 'replace');
      return result;
    } as typeof history.pushState;
  };
  wrapHistory('pushState');
  wrapHistory('replaceState');
  window.addEventListener('popstate', () => notifyNavigation('pop'));
  window.addEventListener('hashchange', () => notifyNavigation('hash'));

  // Red: fetch.
  const originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      const started = performance.now();
      const input = args[0];
      const init = args[1];
      const url = normalize(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const inputMethod = typeof input === 'object' && input !== null && 'method' in input ? (input as Request).method : 'GET';
      const method = String((init && init.method) || inputMethod || 'GET').toUpperCase();
      const requestHeaders = decodeRequestHeaders(input, init);
      const requestMime = contentTypeOf(init?.headers) || (input instanceof Request ? contentTypeOf(input.headers) : '');
      const requestPromise = requestBody(input, init);
      return originalFetch.apply(this, args).then(
        (response) => {
          const mime = response.headers.get('content-type') || '';
          const finalUrl = normalize(response.url || url);
          const entry: JournalEntry = {
            id: nextId(),
            t: now(),
            url: finalUrl,
            method,
            status: response.status,
            mime,
            resourceType: 'fetch',
            durationMs: Math.round(performance.now() - started),
            failed: !response.ok,
            requestMime: requestMime || undefined,
            requestHeaders,
            responseHeaders: safeHeaders(response.headers),
          };
          record(entry);
          post({
            type: 'network',
            id: entry.id,
            t: now(),
            url: finalUrl,
            method,
            status: response.status,
            durationMs: entry.durationMs,
            resourceType: 'fetch',
            failed: !response.ok,
          });
          const work = (async () => {
            const [req, resp] = await Promise.all([requestPromise, responseBody(response)]);
            if (req && !req.truncated) {
              entry.requestBodyBase64 = req.base64;
              entry.requestMime = req.mime || entry.requestMime;
            } else if (req?.truncated) {
              entry.note = 'cuerpo de petición omitido por tamaño';
            }
            if (resp && !resp.truncated) {
              entry.bodyBase64 = resp.base64;
              entry.mime = resp.mime || entry.mime;
            } else if (resp?.truncated) {
              entry.note = 'cuerpo de respuesta omitido por tamaño';
            }
          })();
          pending.push(
            work
              .then(() => post({ type: 'network-entry', entry: { ...entry } }))
              .catch(() => undefined),
          );
          return response;
        },
        (error) => {
          const failedEntry: JournalEntry = {
            id: nextId(),
            t: now(),
            url,
            method,
            status: 0,
            mime: '',
            resourceType: 'fetch',
            durationMs: Math.round(performance.now() - started),
            failed: true,
            requestMime: requestMime || undefined,
            requestHeaders,
            note: String(error),
          };
          record(failedEntry);
          post({ type: 'network-entry', entry: { ...failedEntry } });
          post({
            type: 'network',
            t: now(),
            url,
            method,
            status: 0,
            durationMs: Math.round(performance.now() - started),
            resourceType: 'fetch',
            failed: true,
            error: String(error),
          });
          throw error;
        },
      );
    } as typeof fetch;
  }

  // Red: XMLHttpRequest.
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
    const meta = (this as unknown as { __wc?: { headers?: Record<string, string> } }).__wc;
    if (meta) {
      if (!meta.headers) meta.headers = {};
      if (!SENSITIVE_HEADER.test(name)) meta.headers[name.toLowerCase()] = String(value);
    }
    return originalSetRequestHeader.apply(this, [name, value]);
  } as typeof XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    (this as unknown as { __wc: { method: string; url: string; started: number; headers?: Record<string, string> } }).__wc = {
      method: String(method || 'GET').toUpperCase(),
      url: normalize(url),
      started: 0,
      headers: {},
    };
    return originalOpen.apply(this, [method, url, ...rest] as unknown as Parameters<typeof originalOpen>);
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: unknown[]) {
    const meta = (this as unknown as { __wc?: { method: string; url: string; started: number; headers?: Record<string, string> } }).__wc;
    if (meta) {
      meta.started = performance.now();
      const bodyPromise = armed ? describeBody(args[0], meta.headers?.['content-type'] || '') : Promise.resolve(null);
      this.addEventListener('loadend', () => {
        const mime = this.getResponseHeader('content-type') || '';
        const finalUrl = normalize(this.responseURL || meta.url);
        const entry: JournalEntry = {
          id: nextId(),
          t: now(),
          url: finalUrl,
          method: meta.method,
          status: this.status,
          mime,
          resourceType: 'xhr',
          durationMs: Math.round(performance.now() - meta.started),
          failed: this.status === 0 || this.status >= 400,
          requestMime: meta.headers?.['content-type'],
          requestHeaders: meta.headers && Object.keys(meta.headers).length > 0 ? { ...meta.headers } : undefined,
          responseHeaders: responseHeadersOf(this),
        };
        record(entry);
        post({
          type: 'network',
          id: entry.id,
          t: now(),
          url: finalUrl,
          method: meta.method,
          status: this.status,
          durationMs: entry.durationMs,
          resourceType: 'xhr',
          failed: entry.failed,
        });
        const work = (async () => {
          const [req, resp] = await Promise.all([bodyPromise, xhrBody(this)]);
          if (req && !req.truncated) {
            entry.requestBodyBase64 = req.base64;
            entry.requestMime = req.mime || entry.requestMime;
          } else if (req?.truncated) {
            entry.note = 'cuerpo de petición omitido por tamaño';
          }
          if (resp && !resp.truncated) {
            entry.bodyBase64 = resp.base64;
            entry.mime = resp.mime || entry.mime;
          } else if (resp?.truncated) {
            entry.note = 'cuerpo de respuesta omitido por tamaño';
          }
        })();
        pending.push(
          work
            .then(() => post({ type: 'network-entry', entry: { ...entry } }))
            .catch(() => undefined),
        );
      });
    }
    return originalSend.apply(this, args as Parameters<typeof originalSend>);
  } as typeof XMLHttpRequest.prototype.send;

  // Estado de vídeos/audio accesible desde la página.
  const mediaEvents = ['play', 'pause', 'seeked', 'volumechange', 'ratechange'] as const;
  for (const name of mediaEvents) {
    document.addEventListener(
      name,
      (event) => {
        const el = event.target as HTMLMediaElement;
        if (!el || !el.tagName || !/^(VIDEO|AUDIO)$/.test(el.tagName)) return;
        post({
          type: 'media',
          t: now(),
          tag: el.tagName.toLowerCase(),
          event: name,
          currentTime: el.currentTime,
          paused: el.paused,
          volume: el.volume,
          muted: el.muted,
          src: el.currentSrc || el.src || '',
        });
      },
      true,
    );
  }

  post({ type: 'ready', t: now(), url: location.href });
}
