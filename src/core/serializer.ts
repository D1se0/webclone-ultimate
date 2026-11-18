/**
 * Serializador de DOM a HTML autónomo.
 *
 * Estrategia:
 *  - Recorre el DOM vivo una sola vez y produce HTML con tokens para cada recurso.
 *  - Los tokens se resuelven después (asíncrono) contra el Asset Manager; así el
 *    serializador es síncrono y determinista, y fácil de probar.
 *  - Shadow DOM abierto se convierte en Declarative Shadow DOM.
 *  - Canvas se sustituye por una imagen PNG del contenido observado.
 *  - Los scripts de la página se eliminan por defecto (seguridad + offline).
 */

import type {
  CaptureCounts,
  CaptureOptions,
  CanvasState,
  FailedResource,
  FormFieldState,
  MediaState,
  OpenState,
  PageState,
  ScrollState,
} from '../shared/types';
import { absolutize, rewriteSrcset, sanitizeUrlForReport, shortUrl } from '../shared/url';
import { rewriteCssUrls } from '../shared/css';
import { isDangerousAttribute, isExcludedElement, maskValue, shouldRedactField } from '../shared/redact';
import { CLONE_BOOTSTRAP_JS } from './bootstrap';

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const LAZY_SRC_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-url', 'data-echo', 'data-hi-res-src'];

export interface SerializeDeps {
  options: CaptureOptions;
  /** Devuelve el token de un recurso (URL absoluta o data:). */
  assetToken: (absoluteUrl: string, kindHint?: string) => string;
  /** Registra un bloque de CSS y devuelve el token que lo sustituye en el HTML. */
  styleBlock: (block: { css: string; baseUrl: string; source: string; external?: boolean }) => string;
  /** Registra un script inline para reescribir sus imports después. */
  jsInline?: (code: string, baseUrl: string) => string;
  /** Token que se sustituye por el runtime de red en el <head>. */
  headPrefix?: string;
  /** Registra un frame capturado y devuelve su ruta relativa dentro del paquete. */
  registerFrame: (html: string, url: string) => string;
  /** Permite informar de progreso. */
  onProgress?: (message: string) => void;
}

export interface SerializeOutcome {
  html: string;
  state: PageState;
  counts: CaptureCounts;
  failures: FailedResource[];
  unsupported: string[];
  frames: { path: string; html: string; url: string }[];
  styleBlocks: { token: string; css: string; baseUrl: string; source: string }[];
  /** Recursos referenciados que deben resolverse (url -> kind). */
  assets: { url: string; kind: string }[];
}

function emptyCounts(): CaptureCounts {
  return {
    elements: 0,
    shadowRoots: 0,
    iframes: 0,
    framesCaptured: 0,
    stylesheets: 0,
    stylesheetsInlined: 0,
    assetsCaptured: 0,
    assetsFailed: 0,
    canvases: 0,
    canvasesUnsupported: 0,
    media: 0,
    mediaCaptured: 0,
    forms: 0,
    scriptsStripped: 0,
  };
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');

const escapeAttr = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function rulesToText(sheet: CSSStyleSheet): string | null {
  try {
    const parts: string[] = [];
    const rules = sheet.cssRules;
    for (let i = 0; i < rules.length; i++) parts.push(rules[i].cssText);
    return parts.join('\n');
  } catch {
    return null;
  }
}

class PageSerializer {
  private deps: SerializeDeps;
  private state: PageState;
  private counts = emptyCounts();
  private failures: FailedResource[] = [];
  private unsupported = new Set<string>();
  private frames: { path: string; html: string; url: string }[] = [];
  private blocks: { token: string; css: string; baseUrl: string; source: string }[] = [];
  private assets = new Map<string, string>();
  private idCounter = 0;
  private frameCounter = 0;
  private docBase = '';

  constructor(deps: SerializeDeps) {
    this.deps = deps;
    this.state = {
      version: 1,
      url: '',
      title: '',
      capturedAt: new Date().toISOString(),
      viewport: { width: 0, height: 0, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
      forms: [],
      scrollables: [],
      media: [],
      canvases: [],
      details: [],
      dialogs: [],
      popovers: [],
      missing: [],
      dynamic: !!deps.options.dynamic,
    };
  }

  serialize(doc: Document, depth = 0): SerializeOutcome {
    this.docBase = doc.baseURI;
    const win = doc.defaultView;
    if (win && depth === 0) {
      this.state.url = doc.URL;
      this.state.title = doc.title;
      this.state.viewport = {
        width: win.innerWidth,
        height: win.innerHeight,
        scrollX: Math.round(win.scrollX),
        scrollY: Math.round(win.scrollY),
        devicePixelRatio: win.devicePixelRatio || 1,
      };
    }

    const htmlEl = doc.documentElement;
    const headEl = doc.head;
    const bodyEl = doc.body;
    const htmlAttrs = htmlEl ? this.serializeAttributes(htmlEl, { skipStyleRewrite: false }) : '';
    const bodyAttrs = bodyEl ? this.serializeAttributes(bodyEl, { skipStyleRewrite: false }) : '';

    const headInner = headEl ? this.serializeChildren(headEl, depth) : '';
    const bodyInner = bodyEl ? this.serializeChildren(bodyEl, depth) : '';

    const stateJson = JSON.stringify(this.state).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');
    const html = [
      '<!DOCTYPE html>',
      `<html${htmlAttrs}>`,
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      this.deps.headPrefix ?? '',
      headInner,
      '</head>',
      `<body${bodyAttrs}>`,
      bodyInner,
      `<script type="application/json" id="wc-page-state">${stateJson}</script>`,
      `<script>${CLONE_BOOTSTRAP_JS}</script>`,
      '</body>',
      '</html>',
    ].join('\n');

    return {
      html,
      state: this.state,
      counts: this.counts,
      failures: this.failures,
      unsupported: Array.from(this.unsupported),
      frames: this.frames,
      styleBlocks: this.blocks,
      assets: Array.from(this.assets.entries()).map(([url, kind]) => ({ url, kind })),
    };
  }

  // ---------------------------------------------------------------- nodos

  private serializeChildren(parent: Node, depth: number): string {
    let out = '';
    const children = parent.childNodes;
    for (let i = 0; i < children.length; i++) out += this.serializeNode(children[i], depth);
    return out;
  }

  private serializeNode(node: Node, depth: number): string {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.nodeValue ?? '');
    if (node.nodeType === Node.COMMENT_NODE) {
      if (this.deps.options.dynamic) return `<!--${(node.nodeValue ?? '').replace(/--/g, '- -')}-->`;
      return '';
    }
    if (node.nodeType === Node.DOCUMENT_TYPE_NODE) return '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as Element;
    if (this.deps.options.excludeSelectors.length && isExcludedElement(el, this.deps.options.excludeSelectors)) {
      return `<!-- elemento excluido por privacidad: ${escapeHtml(el.tagName.toLowerCase())} -->`;
    }

    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case 'script':
        if (this.deps.options.dynamic || this.deps.options.keepScripts) {
          this.counts.scriptsKept = (this.counts.scriptsKept ?? 0) + 1;
          return this.serializeScript(el);
        }
        this.counts.scriptsStripped++;
        return '';
      case 'noscript':
        return '';
      case 'base':
        return '';
      case 'meta':
        return this.serializeMeta(el);
      case 'link':
        return this.serializeLink(el, depth);
      case 'style':
        return this.serializeStyle(el, depth);
      case 'canvas':
        return this.serializeCanvas(el, depth);
      case 'iframe':
      case 'frame':
        return this.serializeIframe(el, depth);
      case 'video':
      case 'audio':
        this.recordMedia(el as HTMLMediaElement);
        break;
      case 'input':
      case 'select':
      case 'textarea':
        this.recordFormField(el as HTMLInputElement);
        break;
      case 'details':
        this.recordOpenState(el, 'details');
        break;
      case 'dialog':
        this.recordOpenState(el, 'dialog');
        break;
      case 'img':
        this.checkImage(el as HTMLImageElement);
        break;
      default:
        break;
    }

    if (el.hasAttribute?.('popover')) this.recordPopover(el);
    this.recordScroll(el);

    return this.serializeElement(el, depth);
  }

  private serializeElement(el: Element, depth: number): string {
    const tag = el.tagName.toLowerCase();
    const id = `e${++this.idCounter}`;
    this.counts.elements++;
    const attrs = this.serializeAttributes(el, { wcId: id });
    const open = `<${tag}${attrs}>`;
    if (VOID_ELEMENTS.has(tag)) return open;

    let inner = '';
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) {
      this.counts.shadowRoots++;
      // En modo dinámico el script original vuelve a crear el shadow root;
      // serializarlo además provocaría un attachShadow duplicado.
      if (!this.deps.options.dynamic) inner += this.serializeShadowRoot(shadow, depth);
    }
    inner += this.serializeChildren(el, depth);
    return `${open}${inner}</${tag}>`;
  }

  private serializeScript(el: Element): string {
    const tag = 'script';
    const id = `e${++this.idCounter}`;
    this.counts.elements++;
    const attrs = this.serializeAttributes(el, { wcId: id });
    const src = el.getAttribute('src');
    if (src) return `<${tag}${attrs}></${tag}>`;
    const code = (el as HTMLScriptElement).text ?? el.textContent ?? '';
    if (this.deps.options.dynamic && this.deps.jsInline) {
      const token = this.deps.jsInline(code, this.docBase);
      return `<${tag}${attrs}>${token}</${tag}>`;
    }
    return `<${tag}${attrs}>${code}</${tag}>`;
  }

  private serializeShadowRoot(root: ShadowRoot, depth: number): string {
    let head = '';
    const adopted = (root as unknown as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [];
    for (const sheet of adopted) {
      const css = rulesToText(sheet);
      if (css) head += `<style>${this.styleToken(css, this.docBase, 'adopted-style-sheet')}</style>`;
    }
    const content = this.serializeChildren(root, depth);
    // Declarative Shadow DOM: se renderiza sin JavaScript en Chrome/Edge 111+ y Firefox 123+.
    return `<template shadowrootmode="open">${head}${content}</template>`;
  }

  private serializeAttributes(
    el: Element,
    opts: { wcId?: string; skipStyleRewrite?: boolean } = {},
  ): string {
    let out = '';
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name;
      if (name === 'data-wc-id') continue;
      if (isDangerousAttribute(name)) {
        // En modo dinámico los handlers inline forman parte del comportamiento original.
        if (!(this.deps.options.dynamic && /^on/i.test(name))) continue;
      }
      if (name === 'srcdoc') continue; // se sustituye por el iframe serializado cuando es accesible
      let value = attr.value;
      if (name === 'style') value = this.rewriteInlineStyle(value);
      else if (name === 'srcset' || name === 'data-srcset') {
        value = rewriteSrcset(value, (abs) => this.assetToken(abs, 'image'), this.docBase);
      } else if (this.isUrlAttribute(name, el)) {
        const abs = absolutize(value, this.docBase);
        if (abs && !/^javascript:/i.test(abs)) value = this.assetToken(abs, this.attrKindHint(name, el));
      } else if (name === 'loading') {
        value = 'eager';
      }
      out += ` ${name}="${escapeAttr(value)}"`;
    }
    if (opts.wcId) out += ` data-wc-id="${opts.wcId}"`;
    return out;
  }

  private isUrlAttribute(name: string, el: Element): boolean {
    const urlAttrs = new Set(['src', 'href', 'poster', 'data', 'xlink:href', 'background', 'data-src', 'data-original', 'data-lazy-src', 'action']);
    if (!urlAttrs.has(name)) return false;
    const tag = el.tagName.toLowerCase();
    // El src del iframe se sustituye por el snapshot del frame (no se descarga como recurso).
    if ((tag === 'iframe' || tag === 'frame') && name === 'src') return false;
    if (name === 'href') {
      const tag = el.tagName.toLowerCase();
      if (tag === 'a' || tag === 'area') return false;
      return true;
    }
    if (name === 'action') return false;
    return true;
  }

  private attrKindHint(name: string, el: Element): string | undefined {
    const tag = el.tagName.toLowerCase();
    if (name === 'poster') return 'image';
    if (tag === 'video' || tag === 'source' || tag === 'audio' || tag === 'track') {
      return name === 'src' ? undefined : undefined;
    }
    if (tag === 'img' || tag === 'image') return 'image';
    return undefined;
  }

  private rewriteInlineStyle(css: string): string {
    if (!css || css.indexOf('url(') === -1) return css;
    return rewriteCssUrls(css, (raw) => {
      const abs = absolutize(raw, this.docBase);
      return abs ? this.assetToken(abs) : raw;
    });
  }

  private serializeMeta(el: Element): string {
    const httpEquiv = (el.getAttribute('http-equiv') || '').toLowerCase();
    if (httpEquiv === 'content-security-policy' || httpEquiv === 'refresh' || httpEquiv === 'x-frame-options') {
      return `<!-- meta ${httpEquiv} eliminado en el clon -->`;
    }
    if (el.getAttribute('charset')) return '<meta charset="utf-8">';
    const name = el.getAttribute('name');
    if (name === 'viewport') return '';
    return this.serializeElement(el, 0);
  }

  private serializeLink(el: Element, depth: number): string {
    const rel = (el.getAttribute('rel') || '').toLowerCase();
    if (rel.includes('preconnect') || rel.includes('dns-prefetch') || rel.includes('prefetch') || rel.includes('preload') || rel.includes('modulepreload')) {
      return '';
    }
    const href = el.getAttribute('href') || '';
    if (rel.includes('stylesheet')) {
      this.counts.stylesheets++;
      const sheet = (el as HTMLLinkElement).sheet;
      const cssFromRules = sheet ? rulesToText(sheet) : null;
      if (cssFromRules !== null && cssFromRules !== '') {
        this.counts.stylesheetsInlined++;
        return this.styleTag(cssFromRules, this.docBase, href);
      }
      const abs = absolutize(href, this.docBase);
      if (!abs) return '';
      return this.styleTag('', abs, abs, href);
    }
    if (rel.includes('icon')) {
      const abs = absolutize(href, this.docBase);
      if (!abs) return '';
      return `<link rel="icon" href="${escapeAttr(this.assetToken(abs, 'image'))}">`;
    }
    return this.serializeElement(el, depth);
  }

  private serializeStyle(el: Element, depth: number): string {
    this.counts.stylesheets++;
    const styleEl = el as HTMLStyleElement;
    const sheetText = styleEl.sheet ? rulesToText(styleEl.sheet) : null;
    const css = sheetText && sheetText.length > 0 ? sheetText : (el.textContent ?? '');
    if (!css.trim()) return '';
    this.counts.stylesheetsInlined++;
    const media = el.getAttribute('media');
    const token = this.styleToken(css, this.docBase, 'inline-style');
    return `<style${media ? ` media="${escapeAttr(media)}"` : ''}>${token}</style>`;
  }

  private styleTag(css: string, baseUrl: string, source: string, displaySource?: string): string {
    const token = this.styleToken(css, baseUrl, source);
    const label = displaySource ? ` data-wc-source="${escapeAttr(shortUrl(displaySource, 80))}"` : '';
    return `<style${label}>${token}</style>`;
  }

  /**
   * Registra un bloque de CSS y devuelve el token que lo sustituye.
   * El registro real vive en el pipeline (deps.styleBlock): aquí solo se guarda una copia
   * para escanear sus url()/@import durante la fase de recursos.
   */
  private styleToken(css: string, baseUrl: string, source: string): string {
    const token = this.deps.styleBlock({ css, baseUrl, source });
    this.blocks.push({ token, css, baseUrl, source });
    return token;
  }

  private serializeCanvas(el: Element, depth: number): string {
    this.counts.canvases++;
    const canvas = el as HTMLCanvasElement;
    const width = canvas.width || Math.round(canvas.clientWidth) || 300;
    const height = canvas.height || Math.round(canvas.clientHeight) || 150;
    const id = `e${++this.idCounter}`;
    const attrs = this.serializeAttributes(el, { wcId: id });
    const styleAttr = ` style="width:${canvas.clientWidth || width}px;height:${canvas.clientHeight || height}px${el.getAttribute('style') ? `;${el.getAttribute('style')}` : ''}"`;

    if (this.deps.options.dynamic) {
      // El script original vuelve a dibujar el canvas; se conserva el elemento.
      this.state.canvases.push({ wcId: id, width, height, mode: 'image' });
      return `<canvas${attrs}${styleAttr}></canvas>`;
    }

    if (!this.deps.options.captureCanvas) {
      this.counts.canvasesUnsupported++;
      const record: CanvasState = { wcId: id, width, height, mode: 'unsupported', reason: 'captura de canvas desactivada' };
      this.state.canvases.push(record);
      return `<canvas${attrs}${styleAttr}></canvas>`;
    }

    let dataUrl = '';
    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch {
      dataUrl = '';
    }
    const blank = !dataUrl || dataUrl === 'data:,' || dataUrl.endsWith(',');
    if (blank) {
      this.counts.canvasesUnsupported++;
      const context = (() => {
        try {
          if (canvas.getContext('2d')) return '2d';
          if (canvas.getContext('webgl2')) return 'webgl2';
          if (canvas.getContext('webgl')) return 'webgl';
          return 'desconocido';
        } catch {
          return 'desconocido';
        }
      })();
      this.state.canvases.push({
        wcId: id,
        width,
        height,
        mode: 'unsupported',
        reason: `contenido no accesible (${context}); WebGL sin preserveDrawingBuffer o canvas contaminado por CORS`,
      });
      this.unsupported.add(`Canvas ${context} sin contenido legible (${width}x${height})`);
      this.failures.push({
        url: `canvas:${id}`,
        kind: 'other',
        reason: 'canvas no serializable',
        restriction: context === 'webgl' || context === 'webgl2' ? 'WebGL sin preserveDrawingBuffer' : 'canvas contaminado o vacío',
        affectsFidelity: true,
        alternative: 'Grabar la sesión con rrweb (recordCanvas) o usar una captura de pantalla del viewport',
      });
      return `<canvas${attrs}${styleAttr}></canvas>`;
    }
    const token = this.assetToken(dataUrl, 'image');
    this.state.canvases.push({ wcId: id, width, height, mode: 'image' });
    return `<img${attrs} src="${escapeAttr(token)}" width="${width}" height="${height}"${styleAttr} data-wc-canvas="true" alt="">`;
  }

  private serializeIframe(el: Element, depth: number): string {
    this.counts.iframes++;
    const frame = el as HTMLIFrameElement;
    const src = frame.getAttribute('src') || 'about:blank';
    const absSrc = absolutize(src, this.docBase) || src;
    const id = `e${++this.idCounter}`;
    const attrs = this.serializeAttributes(el, { wcId: id });

    let frameDoc: Document | null = null;
    try {
      frameDoc = frame.contentDocument;
      if (frameDoc && !frameDoc.documentElement) frameDoc = null;
    } catch {
      frameDoc = null;
    }

    const canCapture = this.deps.options.captureFrames && frameDoc && depth < this.deps.options.maxFrameDepth;
    if (canCapture && frameDoc) {
      try {
        const nested = new PageSerializer(this.deps).serialize(frameDoc, depth + 1);
        this.counts.framesCaptured++;
        // Los frames comparten registro de tokens: se fusionan sus bloques y assets.
        for (const block of nested.styleBlocks) {
          if (!this.blocks.some((b) => b.token === block.token)) this.blocks.push(block);
        }
        for (const asset of nested.assets) this.assets.set(asset.url, asset.kind);
        this.failures.push(...nested.failures);
        for (const capability of nested.unsupported) this.unsupported.add(capability);
        for (const [key, value] of Object.entries(nested.counts)) {
          if (typeof value === 'number') {
            const counter = this.counts as unknown as Record<string, number>;
            counter[key] = (counter[key] ?? 0) + value;
          }
        }
        const path = this.deps.registerFrame(nested.html, absSrc || `frame-${++this.frameCounter}`);
        const withAttrs = attrs.replace(/ src="[^"]*"/, '');
        return `<iframe${withAttrs} src="${escapeAttr(path)}" data-wc-frame="captured"></iframe>`;
      } catch (error) {
        this.failures.push({
          url: sanitizeUrlForReport(absSrc),
          kind: 'other',
          reason: 'error serializando iframe',
          restriction: error instanceof Error ? error.message : String(error),
          affectsFidelity: true,
          alternative: 'Abrir el frame original directamente',
        });
      }
    }

    const placeholderPath = this.deps.registerFrame(
      `<!DOCTYPE html><html><body style="font:13px ui-monospace,monospace;background:#0b0b0d;color:#bbb;padding:16px;margin:0">Iframe no capturado: ${escapeHtml(shortUrl(absSrc, 120))}</body></html>`,
      absSrc,
    );
    this.failures.push({
      url: sanitizeUrlForReport(absSrc),
      kind: 'other',
      reason: 'iframe de origen cruzado o no accesible',
      restriction: 'Same-origin policy / X-Frame-Options / CSP frame-ancestors',
      affectsFidelity: true,
      alternative: 'Abrir el iframe original en su propia pestaña o grabarlo con rrweb (cross-origin iframes no soportado)',
    });
    this.unsupported.add('Iframes de origen cruzado no se serializan (se deja un marcador)');
    const withAttrs = attrs.replace(/ src="[^"]*"/, '');
    return `<iframe${withAttrs} src="${escapeAttr(placeholderPath)}" data-wc-frame="unsupported" data-wc-original-src="${escapeAttr(sanitizeUrlForReport(absSrc))}"></iframe>`;
  }

  // ------------------------------------------------------------- estado

  private recordFormField(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
    const tag = el.tagName.toLowerCase();
    this.counts.forms++;
    const id = el.getAttribute('data-wc-id') || `e${this.idCounter + 1}`;
    const type = (el as HTMLInputElement).type?.toLowerCase();
    const autocomplete = el.getAttribute('autocomplete') || undefined;
    const redaction = shouldRedactField(tag, type, autocomplete);

    if (tag === 'select') {
      const select = el as HTMLSelectElement;
      const values = Array.from(select.selectedOptions ?? []).map((o) => o.value);
      this.state.forms.push({
        wcId: id,
        tag,
        selectedIndex: select.selectedIndex,
        selectedValues: values,
      });
      for (const option of Array.from(select.options)) {
        if (option.selected) option.setAttribute('selected', '');
        else option.removeAttribute('selected');
      }
      return;
    }

    if (tag === 'textarea') {
      const area = el as HTMLTextAreaElement;
      if (redaction.redact) {
        this.state.forms.push({ wcId: id, tag, redacted: true, excludedReason: redaction.reason });
        return;
      }
      this.state.forms.push({ wcId: id, tag, value: area.value });
      return;
    }

    const input = el as HTMLInputElement;
    if (type === 'checkbox' || type === 'radio') {
      this.state.forms.push({ wcId: id, tag, type, checked: input.checked });
      if (input.checked) input.setAttribute('checked', '');
      else input.removeAttribute('checked');
      return;
    }
    if (type === 'file') {
      this.state.forms.push({ wcId: id, tag, type, excludedReason: 'input file (no se puede reconstruir por seguridad)' });
      return;
    }
    if (redaction.redact) {
      this.state.forms.push({ wcId: id, tag, type, redacted: true, excludedReason: redaction.reason });
      el.setAttribute('data-wc-redacted', 'true');
      if (this.deps.options.maskSensitive && type === 'password') {
        el.setAttribute('placeholder', maskValue(input.value || 'password'));
        el.setAttribute('value', '');
      } else {
        el.setAttribute('value', '');
      }
      return;
    }
    this.state.forms.push({ wcId: id, tag, type, value: input.value });
    el.setAttribute('value', input.value);
  }

  private recordOpenState(el: Element, kind: 'details' | 'dialog'): void {
    const id = el.getAttribute('data-wc-id') || `e${this.idCounter + 1}`;
    const open = el.hasAttribute('open');
    const record: OpenState = { wcId: id, open };
    if (kind === 'details') this.state.details.push(record);
    else this.state.dialogs.push(record);
    if (open) el.setAttribute('open', '');
  }

  private recordPopover(el: Element): void {
    const id = el.getAttribute('data-wc-id') || `e${this.idCounter + 1}`;
    let open = false;
    try {
      open = el.matches(':popover-open');
    } catch {
      open = false;
    }
    this.state.popovers.push({ wcId: id, open });
  }

  private recordScroll(el: Element): void {
    const id = el.getAttribute('data-wc-id') || `e${this.idCounter + 1}`;
    const scrollTop = el.scrollTop;
    const scrollLeft = el.scrollLeft;
    if (scrollTop > 0 || scrollLeft > 0) {
      this.state.scrollables.push({ wcId: id, target: 'element', top: Math.round(scrollTop), left: Math.round(scrollLeft) });
    }
  }

  private recordMedia(el: HTMLMediaElement): void {
    this.counts.media++;
    const id = el.getAttribute('data-wc-id') || `e${this.idCounter + 1}`;
    const tag = el.tagName.toLowerCase() === 'audio' ? 'audio' : 'video';
    const record: MediaState = {
      wcId: id,
      tag,
      currentTime: Number.isFinite(el.currentTime) ? Math.round(el.currentTime * 100) / 100 : 0,
      paused: el.paused,
      volume: el.volume,
      muted: el.muted,
      playbackRate: el.playbackRate,
      duration: Number.isFinite(el.duration) ? el.duration : null,
      loop: el.loop,
      captured: false,
    };
    const poster = el.getAttribute('poster');
    if (poster) record.poster = sanitizeUrlForReport(absolutize(poster, this.docBase) || poster);
    if (el.currentSrc) {
      record.captured = true;
    } else {
      record.note = 'sin recurso cargado en el momento de la captura';
    }
    this.state.media.push(record);
    el.removeAttribute('autoplay');
    el.setAttribute('preload', 'metadata');
  }

  private checkImage(img: HTMLImageElement): void {
    const src = img.currentSrc || img.getAttribute('src') || '';
    if (!src) {
      for (const attr of LAZY_SRC_ATTRS) {
        const lazy = img.getAttribute(attr);
        if (lazy) img.setAttribute('src', lazy);
      }
      return;
    }
    if (img.complete && img.naturalWidth === 0) {
      const abs = absolutize(src, this.docBase) || src;
      this.failures.push({
        url: sanitizeUrlForReport(abs),
        kind: 'image',
        reason: 'la imagen no se cargó en la página original',
        restriction: '404 / bloqueo / lazy loading no resuelto',
        affectsFidelity: true,
        alternative: 'Revisar la URL original; el clon conserva el atributo src',
      });
      img.setAttribute('data-wc-missing', 'true');
    }
  }

  private assetToken(absoluteUrl: string, kindHint?: string): string {
    const existing = this.assets.get(absoluteUrl);
    if (existing) return this.deps.assetToken(absoluteUrl, existing ?? kindHint);
    if (kindHint) this.assets.set(absoluteUrl, kindHint);
    else this.assets.set(absoluteUrl, '');
    return this.deps.assetToken(absoluteUrl, kindHint);
  }
}

export function serializeDocument(doc: Document, deps: SerializeDeps): SerializeOutcome {
  const serializer = new PageSerializer(deps);
  return serializer.serialize(doc, 0);
}
