/**
 * Runtime que se incrusta al principio del <head> del clon dinámico, antes de
 * cualquier script de la página.
 *
 * Responsabilidades:
 *  - Restaurar la ruta y el almacenamiento de una sesión completa.
 *  - Servir desde el propio paquete las respuestas capturadas (fetch y XHR),
 *    incluidas peticiones POST con cuerpo y cuerpos grandes.
 *  - Bloquear conexiones persistentes y llamadas no capturadas para que el clon
 *    sea 100 % offline (WebSocket, EventSource, sendBeacon, service workers).
 *  - Evitar navegaciones externas accidentales y explicar el motivo.
 *
 * Debe ser JavaScript autocontenido (se inserta como texto en el HTML).
 */

export const DYNAMIC_RUNTIME_JS = String.raw`(function () {
  'use strict';
  if (window.__webcloneDynamic) return;
  var script = document.getElementById('wc-network');
  var entries = [];
  if (script) {
    try { entries = JSON.parse(script.textContent || '[]') || []; } catch (e) { entries = []; }
  }
  var session = null;
  var sessionScript = document.getElementById('wc-session');
  if (sessionScript) {
    try { session = JSON.parse(sessionScript.textContent || 'null'); } catch (e) { session = null; }
  }
  var misses = [];
  var served = 0;
  var buckets = {};
  var cursors = {};
  var bodyCache = {};
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;

  function normalize(url) {
    try { return new URL(url, location.href).href; } catch (e) { return String(url); }
  }
  function pathKey(url) {
    try { var u = new URL(url, location.href); return u.pathname + u.search; } catch (e) { return String(url); }
  }
  function keyFor(method, url) {
    return String(method || 'GET').toUpperCase() + ' ' + normalize(url);
  }
  function pathKeyFor(method, url) {
    return String(method || 'GET').toUpperCase() + ' ' + pathKey(url);
  }
  function addBucket(key, entry) {
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(entry);
  }
  (entries || []).forEach(function (entry) {
    if (!entry || !entry.url || entry.captured === false) return;
    var method = (entry.method || 'GET').toUpperCase();
    addBucket(keyFor(method, entry.url), entry);
    var fallback = pathKeyFor(method, entry.url);
    if (fallback !== keyFor(method, entry.url)) addBucket(fallback, entry);
  });

  function decodeBase64(base64) {
    var binary = atob(base64 || '');
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  function textOfBase64(base64) {
    try { return new TextDecoder().decode(decodeBase64(base64)); } catch (e) { return ''; }
  }
  function bodySignature(value) {
    if (value == null) return '';
    try {
      if (typeof value === 'string') return value;
      if (value instanceof URLSearchParams) return value.toString();
      if (value instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(value));
      if (ArrayBuffer.isView(value)) return new TextDecoder().decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    } catch (e) { return ''; }
  }
  function entrySignature(entry) {
    if (!entry || !entry.requestBodyBase64) return '';
    return textOfBase64(entry.requestBodyBase64);
  }
  function choose(key, signature) {
    var list = buckets[key];
    if (!list || list.length === 0) return null;
    var exact = [];
    for (var i = 0; i < list.length; i++) {
      var sig = entrySignature(list[i]);
      if (signature ? sig === signature : !sig) exact.push(list[i]);
    }
    var pool = exact.length ? exact : list;
    var cursorKey = key + '|' + signature;
    var index = cursors[cursorKey] || 0;
    cursors[cursorKey] = index + 1;
    return pool[index % pool.length];
  }
  function find(method, url, signature) {
    var m = String(method || 'GET').toUpperCase();
    var exact = keyFor(m, url);
    var found = choose(exact, signature || '');
    if (found) return found;
    var fallback = pathKeyFor(m, url);
    if (fallback !== exact) return choose(fallback, signature || '');
    return null;
  }
  function isLocal(url) {
    if (location.protocol === 'file:') return !/^https?:/i.test(url);
    return url.indexOf(location.origin) === 0;
  }
  function safeStatus(status) {
    var value = Number(status) || 200;
    if (value < 200 || value > 599) return 200;
    return value;
  }
  function headersFor(entry) {
    var headers = { 'content-type': entry.mime || 'application/octet-stream', 'x-webclone': 'replayed' };
    var extra = entry.responseHeaders || {};
    for (var key in extra) {
      if (!Object.prototype.hasOwnProperty.call(extra, key)) continue;
      if (/^(set-cookie|cookie|authorization|proxy-authorization)$/i.test(key)) continue;
      try { headers[String(key).toLowerCase()] = String(extra[key]); } catch (e) {}
    }
    return headers;
  }
  function loadBody(entry) {
    if (!entry) return Promise.resolve(new Uint8Array(0));
    if (entry.bodyBase64 != null) return Promise.resolve(decodeBase64(entry.bodyBase64));
    if (entry.bodyPath) {
      var cacheKey = entry.bodyPath;
      if (bodyCache[cacheKey]) return bodyCache[cacheKey];
      var bodyUrl = entry.bodyPath;
      try {
        bodyUrl = new URL(entry.bodyPath, location.protocol === 'file:' ? location.href : location.origin + '/').href;
      } catch (e) { bodyUrl = normalize(entry.bodyPath); }
      bodyCache[cacheKey] = (nativeFetch ? nativeFetch(bodyUrl) : Promise.reject(new Error('sin fetch nativo')))
        .then(function (response) { return response.arrayBuffer(); })
        .then(function (buffer) { return new Uint8Array(buffer); })
        .catch(function () { return new Uint8Array(0); });
      return bodyCache[cacheKey];
    }
    return Promise.resolve(new Uint8Array(0));
  }
  function responseFor(entry) {
    return loadBody(entry).then(function (bytes) {
      var status = safeStatus(entry.status);
      var hasBody = status !== 204 && status !== 205 && status !== 304;
      try {
        return new Response(hasBody ? bytes : null, {
          status: status,
          statusText: status === 200 ? 'OK' : '',
          headers: headersFor(entry)
        });
      } catch (e) {
        return new Response(hasBody ? bytes : null, { status: 200, headers: headersFor(entry) });
      }
    });
  }
  function missingResponse(url, method) {
    misses.push({ url: url, method: method });
    var payload = JSON.stringify({
      error: 'WebClone: respuesta no capturada',
      url: url,
      method: method,
      hint: 'Esta petición no se observó durante la captura. El clon nunca sale a Internet.'
    });
    try {
      return new Response(payload, { status: 504, statusText: 'Gateway Timeout', headers: { 'content-type': 'application/json', 'x-webclone': 'missing' } });
    } catch (e) {
      return new Response(payload, { status: 200, headers: { 'content-type': 'application/json', 'x-webclone': 'missing' } });
    }
  }

  function toast(message) {
    try {
      var existing = document.getElementById('wc-toast');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      var box = document.createElement('div');
      box.id = 'wc-toast';
      box.textContent = message;
      box.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;' +
        'background:#111114;color:#f4f4f5;border:1px solid #ef4444;border-radius:10px;padding:8px 14px;' +
        'font:12px/1.4 system-ui,sans-serif;box-shadow:0 10px 30px #0008;max-width:80vw;text-align:center';
      document.documentElement.appendChild(box);
      setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 3200);
    } catch (e) { /* ignore */ }
  }

  // ------------------------------------------ storage y ruta de la sesión
  if (session && window.top === window) {
    try {
      var local = session.storage && session.storage.local ? session.storage.local : {};
      for (var lk in local) {
        if (Object.prototype.hasOwnProperty.call(local, lk)) localStorage.setItem(lk, String(local[lk]));
      }
      var sess = session.storage && session.storage.session ? session.storage.session : {};
      for (var sk in sess) {
        if (Object.prototype.hasOwnProperty.call(sess, sk)) sessionStorage.setItem(sk, String(sess[sk]));
      }
    } catch (e) { /* storage bloqueado */ }
    try {
      if (session.route && location.protocol !== 'file:') {
        var current = location.pathname + location.search + location.hash;
        if (current !== session.route) history.replaceState(history.state, '', session.route);
      }
    } catch (e) { /* ruta no modificable */ }
    document.documentElement.setAttribute('data-wc-full', 'true');

    // La app puede reaplicar el tema SSR al hidratar. Restauramos el tema
    // capturado a través de su propio control (actualiza también aria-pressed),
    // pero dejamos de hacerlo en cuanto el usuario elige un tema.
    var preferredTheme = null;
    try { preferredTheme = localStorage.getItem('protocol-explorer:theme'); } catch (e) { preferredTheme = null; }
    if (preferredTheme === 'light' || preferredTheme === 'dark') {
      var themeChosenByUser = false;
      document.addEventListener('click', function (event) {
        if (!event.isTrusted || !event.target || !event.target.closest) return;
        if (event.target.closest('[data-theme-choice]')) themeChosenByUser = true;
      }, true);
      var applyCapturedTheme = function () {
        if (themeChosenByUser) return false;
        var root = document.documentElement;
        if (root.dataset.theme !== preferredTheme) root.dataset.theme = preferredTheme;
        var choice = document.querySelector('[data-theme-choice="' + preferredTheme + '"]');
        if (choice && choice.getAttribute('aria-pressed') !== 'true') choice.click();
        return true;
      };
      applyCapturedTheme();
      var themeTimer = setInterval(function () {
        if (!applyCapturedTheme()) clearInterval(themeTimer);
      }, 120);
      setTimeout(function () { clearInterval(themeTimer); }, 3200);
    }
  }

  // ---------------------------------------------------------------- fetch
  if (nativeFetch) {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
      var method = (init && init.method) || (input && input.method) || 'GET';
      var signature = Promise.resolve('');
      if (init && init.body != null) signature = Promise.resolve(bodySignature(init.body));
      else if (input && typeof input.clone === 'function' && !input.bodyUsed) {
        try { signature = input.clone().text().catch(function () { return ''; }); } catch (e) { signature = Promise.resolve(''); }
      }
      return signature.then(function (bodyText) {
        var entry = find(method, url, bodyText);
        if (entry) {
          served++;
          return responseFor(entry);
        }
        var abs = normalize(url);
        if (isLocal(abs)) return nativeFetch(input, init);
        return Promise.resolve(missingResponse(abs, String(method).toUpperCase()));
      });
    };
  }

  // ---------------------------------------------------------------- XHR
  var XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    var nativeOpen = XHR.prototype.open;
    var nativeSend = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      this.__wc = { method: String(method || 'GET').toUpperCase(), url: normalize(url), simulated: false };
      return nativeOpen.apply(this, arguments);
    };
    XHR.prototype.send = function (body) {
      var xhr = this;
      var meta = xhr.__wc || { method: 'GET', url: '' };
      var signature = bodySignature(body);
      var entry = find(meta.method, meta.url, signature);
      var abs = meta.url;
      if (!entry && isLocal(abs)) return nativeSend.apply(this, arguments);
      var effective = entry || null;
      if (effective) served++;
      loadBody(effective).then(function (bytes) {
        var status = effective ? safeStatus(effective.status) : 504;
        var mime = effective ? effective.mime || 'application/octet-stream' : 'application/json';
        if (!effective) misses.push({ url: abs, method: meta.method });
        var responseBytes = effective ? bytes : new TextEncoder().encode(JSON.stringify({ error: 'WebClone: respuesta no capturada', url: abs }));
        function define(name, value) {
          try { Object.defineProperty(xhr, name, { value: value, configurable: true, enumerable: true }); } catch (e) { /* ignore */ }
        }
        define('readyState', 4);
        define('status', status);
        define('statusText', status === 200 ? 'OK' : status === 504 ? 'Gateway Timeout' : '');
        define('responseURL', abs);
        var text = '';
        try { text = new TextDecoder().decode(responseBytes); } catch (e) { text = ''; }
        var response = text;
        if (xhr.responseType === 'json') {
          try { response = JSON.parse(text); } catch (e) { response = null; }
        } else if (xhr.responseType === 'arraybuffer') {
          response = responseBytes.buffer;
        } else if (xhr.responseType === 'blob') {
          response = new Blob([responseBytes], { type: mime });
        } else if (xhr.responseType === 'document') {
          try { response = new DOMParser().parseFromString(text, mime.indexOf('xml') >= 0 ? 'application/xml' : 'text/html'); } catch (e) { response = null; }
        }
        define('response', response);
        define('responseText', xhr.responseType === '' || xhr.responseType === 'text' ? text : '');
        define('getAllResponseHeaders', function () {
          var lines = ['content-type: ' + mime, 'x-webclone: replayed'];
          var extra = effective && effective.responseHeaders ? effective.responseHeaders : {};
          for (var key in extra) {
            if (!Object.prototype.hasOwnProperty.call(extra, key)) continue;
            if (/^(set-cookie|cookie|authorization)$/i.test(key)) continue;
            lines.push(key + ': ' + extra[key]);
          }
          return lines.join('\r\n') + '\r\n';
        });
        define('getResponseHeader', function (name) {
          var key = String(name || '').toLowerCase();
          if (key === 'content-type') return mime;
          if (key === 'x-webclone') return 'replayed';
          var extra = effective && effective.responseHeaders ? effective.responseHeaders : {};
          return extra[key] != null ? String(extra[key]) : null;
        });
        setTimeout(function () {
          try {
            xhr.dispatchEvent(new Event('readystatechange'));
            xhr.dispatchEvent(new ProgressEvent('load'));
            xhr.dispatchEvent(new ProgressEvent('loadend'));
          } catch (e) {
            if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange();
            if (typeof xhr.onload === 'function') xhr.onload();
            if (typeof xhr.onloadend === 'function') xhr.onloadend();
          }
        }, 0);
      });
    };
  }

  // ------------------------------------------------ conexiones persistentes
  function StubSocket(url) {
    this.url = String(url || '');
    this.readyState = 3;
    this.bufferedAmount = 0;
    this.extensions = '';
    this.protocol = '';
    this.onopen = null; this.onclose = null; this.onerror = null; this.onmessage = null;
    misses.push({ url: this.url, method: 'WS' });
  }
  StubSocket.prototype.send = function () {};
  StubSocket.prototype.close = function () {};
  StubSocket.prototype.addEventListener = function () {};
  StubSocket.prototype.removeEventListener = function () {};
  StubSocket.prototype.dispatchEvent = function () { return true; };
  if (window.WebSocket) window.WebSocket = StubSocket;
  if (window.EventSource) window.EventSource = StubSocket;

  if (navigator.sendBeacon) {
    navigator.sendBeacon = function (url) {
      misses.push({ url: normalize(url), method: 'BEACON' });
      return true;
    };
  }
  if (navigator.serviceWorker && navigator.serviceWorker.register) {
    try {
      navigator.serviceWorker.register = function () {
        return Promise.reject(new Error('WebClone: los service workers están desactivados en el clon offline'));
      };
    } catch (e) { /* ignore */ }
  }

  // --------------------------------------------------------- navegación
  var nativeOpenWindow = window.open;
  window.open = function (url) {
    var abs = url ? normalize(url) : '';
    if (abs && !isLocal(abs)) {
      toast('Navegación externa desactivada en el clon: ' + abs);
      misses.push({ url: abs, method: 'OPEN' });
      return null;
    }
    return nativeOpenWindow ? nativeOpenWindow.apply(window, arguments) : null;
  };
  document.addEventListener('click', function (event) {
    var target = event.target;
    var anchor = target && target.closest ? target.closest('a[href]') : null;
    if (!anchor) return;
    var href = anchor.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || /^javascript:/i.test(href) || /^mailto:|^tel:/i.test(href)) return;
    var abs = normalize(href);
    if (!isLocal(abs)) {
      event.preventDefault();
      event.stopPropagation();
      toast('Enlace externo desactivado: ' + abs);
    }
  }, true);
  document.addEventListener('submit', function (event) {
    // Se deja correr primero el handler de la página (SPA) y se evita el envío real.
    event.preventDefault();
    toast('Envío de formulario desactivado en el clon offline');
  }, false);

  var runtimeState = {
    entries: entries.length,
    misses: misses,
    full: !!session,
    session: session ? { route: session.route, interactions: session.interactions } : null,
    version: 2
  };
  Object.defineProperty(runtimeState, 'served', { get: function () { return served; }, enumerable: true });
  window.__webcloneDynamic = runtimeState;
  document.documentElement.setAttribute('data-wc-dynamic', 'true');
})();`;
