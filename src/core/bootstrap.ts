/**
 * Script que se inyecta en el clon (index.html / frames).
 * No forma parte del bundle de la extensión: se inserta como texto en el HTML exportado,
 * por lo que debe ser JS ES5/ES2015 autocontenido y no usar módulos.
 *
 * Objetivo: restaurar el estado observado (scroll, formularios, multimedia, popovers) sin
 * ejecutar jamás JavaScript de la página original.
 */
export const CLONE_BOOTSTRAP_JS = String.raw`(function () {
  var STATE_ID = 'wc-page-state';
  var errors = [];
  function byId(id) {
    try { return document.querySelector('[data-wc-id="' + id + '"]'); } catch (e) { return null; }
  }
  // En clones dinámicos el estado se captura con selectores CSS sobre el HTML original.
  function elFor(ref) {
    var el = byId(ref);
    if (el) return el;
    try { return document.querySelector(ref); } catch (e) { return null; }
  }
  function safe(fn, label) {
    try { fn(); } catch (e) { errors.push(label + ': ' + (e && e.message ? e.message : String(e))); }
  }
  var node = document.getElementById(STATE_ID);
  if (!node) return;
  var state;
  try { state = JSON.parse(node.textContent || '{}'); } catch (e) {
    console.warn('[WebClone] estado ilegible', e);
    return;
  }

  if (state.dynamic) document.documentElement.setAttribute('data-wc-dynamic', 'true');

  // 1. Scroll de ventana y de contenedores.
  safe(function () {
    var v = state.viewport || {};
    window.scrollTo(v.scrollX || 0, v.scrollY || 0);
  }, 'window-scroll');
  (state.scrollables || []).forEach(function (s) {
    safe(function () {
      var el = elFor(s.wcId);
      if (el) { el.scrollTop = s.top; el.scrollLeft = s.left; }
    }, 'scroll:' + s.wcId);
  });

  // 2. Formularios.
  (state.forms || []).forEach(function (f) {
    safe(function () {
      var el = elFor(f.wcId);
      if (!el || f.redacted) return;
      var tag = (el.tagName || '').toLowerCase();
      if (tag === 'select') {
        if (typeof f.selectedIndex === 'number') el.selectedIndex = f.selectedIndex;
        if (f.selectedValues) {
          for (var i = 0; i < el.options.length; i++) {
            el.options[i].selected = f.selectedValues.indexOf(el.options[i].value) !== -1;
          }
        }
        return;
      }
      if (tag === 'input') {
        if (f.type === 'checkbox' || f.type === 'radio') { el.checked = !!f.checked; return; }
        if (typeof f.value === 'string') el.value = f.value;
        return;
      }
      if (tag === 'textarea' && typeof f.value === 'string') el.value = f.value;
    }, 'form:' + f.wcId);
  });

  // 3. Popovers abiertos (API nativa, sin JS de la página).
  (state.popovers || []).forEach(function (p) {
    safe(function () {
      var el = elFor(p.wcId);
      if (p.open && el && typeof el.showPopover === 'function' && !el.matches(':popover-open')) el.showPopover();
    }, 'popover:' + p.wcId);
  });

  // 4. Multimedia: posición y estado de reproducción observados.
  (state.media || []).forEach(function (m) {
    safe(function () {
      var el = elFor(m.wcId);
      if (!el) return;
      el.volume = typeof m.volume === 'number' ? m.volume : 1;
      el.muted = !!m.muted;
      try { el.playbackRate = m.playbackRate || 1; } catch (e) {}
      var seek = function () {
        try { if (m.currentTime > 0) el.currentTime = m.currentTime; } catch (e) {}
      };
      if (el.readyState >= 1) seek();
      else el.addEventListener('loadedmetadata', seek, { once: true });
      if (m.paused !== false) {
        try { el.pause(); } catch (e) {}
      }
    }, 'media:' + m.wcId);
  });

  // 5. Navegación: el clon estático no es un navegador. En modo dinámico el
  // runtime de red solo bloquea los enlaces externos y deja funcionar la SPA.
  if (!state.dynamic) {
    document.addEventListener('click', function (ev) {
      var target = ev.target;
      var anchor = target && target.closest ? target.closest('a[href]') : null;
      if (!anchor) return;
      var href = anchor.getAttribute('href') || '';
      if (href.charAt(0) === '#' || /^javascript:/i.test(href)) return;
      ev.preventDefault();
      ev.stopPropagation();
      console.info('[WebClone] enlace desactivado en la instantánea:', href);
    }, true);
    document.addEventListener('submit', function (ev) {
      ev.preventDefault();
      console.info('[WebClone] envío de formulario desactivado en la instantánea');
    }, true);
  }

  // 6. Diagnóstico de recursos que faltan.
  function markBroken() {
    var images = document.querySelectorAll('img');
    var broken = 0;
    for (var i = 0; i < images.length; i++) {
      var img = images[i];
      if (img.complete && img.naturalWidth === 0) {
        img.setAttribute('data-wc-missing', 'true');
        img.title = 'Recurso no capturado (ver reports/capture-report.json)';
        broken++;
      }
    }
    if (broken) console.warn('[WebClone] ' + broken + ' imágenes no disponibles en la instantánea');
  }
  if (document.readyState === 'complete') markBroken();
  else window.addEventListener('load', markBroken, { once: true });

  window.__webclone = { ready: true, state: state, errors: errors, dynamic: !!state.dynamic };
  document.documentElement.setAttribute('data-wc-ready', 'true');
})();`;

/** HTML mínimo de error cuando un frame no pudo capturarse. */
export function framePlaceholderHtml(url: string, reason: string): string {
  const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>Frame no capturado</title>
<style>body{font:13px/1.5 ui-monospace,monospace;background:#0b0b0d;color:#e5e5e5;padding:16px;margin:0}
code{color:#ff5a5f;word-break:break-all}</style></head>
<body><strong>Iframe no capturado</strong><p>El contenido de este frame no es accesible desde la extensión (restricción de origen cruzado).</p>
<p><code>${escape(url)}</code></p><p>Motivo: ${escape(reason)}</p></body></html>`;
}
