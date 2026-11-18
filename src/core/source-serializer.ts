/**
 * Serializador del HTML original (no del DOM ya mutado) para el clon dinámico.
 *
 * El HTML fuente se obtiene de la red y se reescribe para que todos los recursos
 * apunten al paquete local. Así los scripts de la página se ejecutan sobre el
 * marcado que esperan, sin duplicar el DOM que ya habían generado.
 */

import type {
  CaptureCounts,
  CaptureOptions,
  FailedResource,
  PageState,
} from '../shared/types';
import { absolutize, rewriteSrcset, sanitizeUrlForReport, shortUrl } from '../shared/url';
import { rewriteCssUrls } from '../shared/css';
import { isDangerousAttribute, isExcludedElement } from '../shared/redact';

export const RUNTIME_HEAD_TOKEN = '__WC_RUNTIME_HEAD__';

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const LAZY_SRC_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-url', 'data-echo', 'data-hi-res-src'];

export interface SourceStyleBlock {
  css: string;
  baseUrl: string;
  source: string;
  external?: boolean;
}

export interface SourceSerializeDeps {
  pageUrl: string;
  options: CaptureOptions;
  assetToken: (absoluteUrl: string, kindHint?: string) => string;
  styleBlock: (block: SourceStyleBlock) => string;
  jsInline: (code: string, baseUrl: string) => string;
  registerFrame: (html: string, url: string) => string;
  framePath?: (absoluteUrl: string) => string | null;
}

export interface SourceSerializeOutcome {
  html: string;
  counts: CaptureCounts;
  failures: FailedResource[];
  unsupported: string[];
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
    scriptsKept: 0,
    responsesCaptured: 0,
  };
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');

const escapeAttr = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const isSvg = (el: Element): boolean => el.namespaceURI === 'http://www.w3.org/2000/svg';

class SourceSerializer {
  private deps: SourceSerializeDeps;
  private base: string;
  private counts = emptyCounts();
  private failures: FailedResource[] = [];
  private unsupported = new Set<string>();
  private assets = new Map<string, string>();

  constructor(deps: SourceSerializeDeps) {
    this.deps = deps;
    this.base = deps.pageUrl;
  }

  serialize(html: string): SourceSerializeOutcome {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const root = parsed.documentElement;
    if (!root) throw new Error('HTML fuente vacío o ilegible');
    const head = parsed.head;
    const body = parsed.body;

    const htmlAttrs = this.serializeAttributes(root, {});
    const bodyAttrs = body ? this.serializeAttributes(body, {}) : '';
    const headInner = head ? this.serializeChildren(head, 0) : '';
    const bodyInner = body ? this.serializeChildren(body, 0) : '';

    const output = [
      '<!DOCTYPE html>',
      `<html${htmlAttrs}>`,
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      RUNTIME_HEAD_TOKEN,
      headInner,
      '</head>',
      `<body${bodyAttrs}>`,
      bodyInner,
      '</body>',
      '</html>',
    ].join('\n');

    return {
      html: output,
      counts: this.counts,
      failures: this.failures,
      unsupported: Array.from(this.unsupported),
      assets: Array.from(this.assets.entries()).map(([url, kind]) => ({ url, kind })),
    };
  }

  private serializeChildren(parent: Node, depth: number): string {
    let out = '';
    const children = parent.childNodes;
    for (let i = 0; i < children.length; i++) out += this.serializeNode(children[i], depth);
    return out;
  }

  private serializeNode(node: Node, depth: number): string {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.nodeValue ?? '');
    if (node.nodeType === Node.COMMENT_NODE) {
      // React 18 y otros frameworks usan comentarios como marcadores de hidratación.
      return `<!--${(node.nodeValue ?? '').replace(/--/g, '- -')}-->`;
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
        return this.serializeScript(el);
      case 'noscript':
        return `<noscript>${escapeHtml(el.textContent ?? '')}</noscript>`;
      case 'base':
        return '';
      case 'meta':
        return this.serializeMeta(el);
      case 'link':
        return this.serializeLink(el);
      case 'style':
        return this.serializeStyle(el);
      case 'iframe':
      case 'frame':
        return this.serializeIframe(el);
      case 'img':
        this.prepareLazyImage(el as HTMLImageElement);
        break;
      case 'video':
      case 'audio':
        this.counts.media++;
        break;
      case 'canvas':
        this.counts.canvases++;
        break;
      case 'input':
      case 'select':
      case 'textarea':
        this.counts.forms++;
        break;
      case 'template':
        return this.serializeElement(el, depth);
      default:
        break;
    }
    return this.serializeElement(el, depth);
  }

  private serializeElement(el: Element, depth: number): string {
    const tag = el.tagName.toLowerCase();
    const name = isSvg(el) ? el.tagName : tag;
    this.counts.elements++;
    const attrs = this.serializeAttributes(el, {});
    if (VOID_ELEMENTS.has(tag)) return `<${name}${attrs}>`;
    let inner: string;
    if (tag === 'template') {
      const template = el as HTMLTemplateElement;
      inner = this.serializeChildren(template.content, depth);
    } else if (tag === 'textarea' || tag === 'title') {
      inner = escapeHtml(el.textContent ?? '');
    } else {
      inner = this.serializeChildren(el, depth);
    }
    return `<${name}${attrs}>${inner}</${name}>`;
  }

  private serializeScript(el: Element): string {
    const script = el as HTMLScriptElement;
    this.counts.scriptsKept = (this.counts.scriptsKept ?? 0) + 1;
    const attrs = this.serializeAttributes(el, { skipAttrs: new Set(['src', 'integrity', 'nonce', 'crossorigin']) });
    const src = script.getAttribute('src');
    if (src) {
      const abs = absolutize(src, this.base);
      if (!abs) return '';
      const token = this.assetToken(abs, 'js');
      return `<script${attrs} src="${escapeAttr(token)}"></script>`;
    }
    const code = script.textContent ?? '';
    if (!code.trim()) return `<script${attrs}></script>`;
    const token = this.deps.jsInline(code, this.base);
    return `<script${attrs}>${token}</script>`;
  }

  private serializeMeta(el: Element): string {
    const httpEquiv = (el.getAttribute('http-equiv') || '').toLowerCase();
    if (httpEquiv === 'content-security-policy' || httpEquiv === 'refresh' || httpEquiv === 'x-frame-options') {
      return `<!-- meta ${httpEquiv} eliminado en el clon -->`;
    }
    if (el.getAttribute('charset')) return '<meta charset="utf-8">';
    if ((el.getAttribute('name') || '').toLowerCase() === 'viewport') return '';
    return this.serializeElement(el, 0);
  }

  private serializeLink(el: Element): string {
    const rel = (el.getAttribute('rel') || '').toLowerCase();
    if (
      rel.includes('preconnect') ||
      rel.includes('dns-prefetch') ||
      rel.includes('prefetch') ||
      rel.includes('preload') ||
      rel.includes('modulepreload') ||
      rel.includes('manifest') ||
      rel.includes('alternate')
    ) {
      return '';
    }
    const href = el.getAttribute('href') || '';
    if (rel.includes('stylesheet')) {
      this.counts.stylesheets++;
      const abs = absolutize(href, this.base);
      if (!abs) return '';
      this.counts.stylesheetsInlined++;
      const token = this.deps.styleBlock({ css: '', baseUrl: abs, source: `external:${abs}`, external: true });
      const media = el.getAttribute('media');
      const title = el.getAttribute('title');
      return `<style data-wc-source="${escapeAttr(shortUrl(abs, 120))}"${media ? ` media="${escapeAttr(media)}"` : ''}${
        title ? ` title="${escapeAttr(title)}"` : ''
      }>${token}</style>`;
    }
    if (rel.includes('icon') || rel.includes('apple-touch')) {
      const abs = absolutize(href, this.base);
      if (!abs) return '';
      const token = this.assetToken(abs, 'image');
      const type = el.getAttribute('type');
      const sizes = el.getAttribute('sizes');
      return `<link rel="icon" href="${escapeAttr(token)}"${type ? ` type="${escapeAttr(type)}"` : ''}${
        sizes ? ` sizes="${escapeAttr(sizes)}"` : ''
      }>`;
    }
    return this.serializeElement(el, 0);
  }

  private serializeStyle(el: Element): string {
    this.counts.stylesheets++;
    const css = el.textContent ?? '';
    if (!css.trim()) return '';
    this.counts.stylesheetsInlined++;
    const media = el.getAttribute('media');
    const token = this.deps.styleBlock({ css, baseUrl: this.base, source: 'source-style' });
    return `<style${media ? ` media="${escapeAttr(media)}"` : ''}>${token}</style>`;
  }

  private serializeIframe(el: Element): string {
    this.counts.iframes++;
    const src = el.getAttribute('src') || '';
    const abs = absolutize(src, this.base) || '';
    const attrs = this.serializeAttributes(el, { skipAttrs: new Set(['src', 'srcdoc']) });
    if (!abs || /^about:blank/i.test(abs)) {
      return `<iframe${attrs} src="about:blank" data-wc-frame="empty"></iframe>`;
    }
    const captured = this.deps.framePath ? this.deps.framePath(abs) : null;
    if (captured) {
      this.counts.framesCaptured++;
      return `<iframe${attrs} src="${escapeAttr(captured)}" data-wc-frame="captured"></iframe>`;
    }
    const placeholder = this.deps.registerFrame(
      `<!DOCTYPE html><html><body style="font:13px ui-monospace,monospace;background:#0b0b0d;color:#bbb;padding:16px;margin:0">Iframe no capturado: ${escapeHtml(
        shortUrl(abs, 120),
      )}</body></html>`,
      abs,
    );
    this.failures.push({
      url: sanitizeUrlForReport(abs),
      kind: 'other',
      reason: 'iframe no capturado',
      restriction: 'origen cruzado, sin respuesta HTML o límite de profundidad',
      affectsFidelity: true,
      alternative: 'Abrir el iframe original o aumentar maxFrameDepth',
    });
    this.unsupported.add('Iframes de origen cruzado no se serializan (se deja un marcador)');
    return `<iframe${attrs} src="${escapeAttr(placeholder)}" data-wc-frame="unsupported" data-wc-original-src="${escapeAttr(
      sanitizeUrlForReport(abs),
    )}"></iframe>`;
  }

  private prepareLazyImage(img: HTMLImageElement): void {
    if (img.getAttribute('src')) return;
    for (const attr of LAZY_SRC_ATTRS) {
      const lazy = img.getAttribute(attr);
      if (lazy) {
        img.setAttribute('src', lazy);
        return;
      }
    }
  }

  private serializeAttributes(el: Element, opts: { skipAttrs?: Set<string> } = {}): string {
    let out = '';
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name;
      if (opts.skipAttrs?.has(name)) continue;
      if (isDangerousAttribute(name) && !/^on/i.test(name)) continue;
      if (name === 'nonce' || name === 'integrity' || name === 'crossorigin') continue;
      if (name === 'srcdoc' || name === 'ping') continue;
      let value = attr.value;
      if (name === 'style') value = this.rewriteInlineStyle(value);
      else if (name === 'srcset' || name === 'data-srcset') {
        value = rewriteSrcset(value, (abs) => this.assetToken(abs, 'image'), this.base);
      } else if (name === 'loading') {
        value = 'eager';
      } else if (this.isUrlAttribute(name, el)) {
        if (value.startsWith('#')) continue;
        const abs = absolutize(value, this.base);
        if (abs && !/^javascript:|^data:/i.test(abs)) value = this.assetToken(abs, this.attrKindHint(name, el));
      }
      out += ` ${name}="${escapeAttr(value)}"`;
    }
    return out;
  }

  private isUrlAttribute(name: string, el: Element): boolean {
    if (name === 'href' || name === 'xlink:href') {
      const tag = el.tagName.toLowerCase();
      if (tag === 'a' || tag === 'area' || tag === 'link' || tag === 'base') return false;
      return true;
    }
    if (name === 'action' || name === 'formaction') return false;
    return ['src', 'poster', 'data', 'background', 'data-src', 'data-original', 'data-lazy-src'].includes(name);
  }

  private attrKindHint(name: string, el: Element): string | undefined {
    if (name === 'poster') return 'image';
    const tag = el.tagName.toLowerCase();
    if (tag === 'img' || tag === 'image') return 'image';
    if (tag === 'script') return 'js';
    if (tag === 'link') return undefined;
    return undefined;
  }

  private rewriteInlineStyle(css: string): string {
    if (!css || css.indexOf('url(') === -1) return css;
    return rewriteCssUrls(css, (raw) => {
      if (raw.startsWith('#')) return raw;
      const abs = absolutize(raw, this.base);
      return abs ? this.assetToken(abs) : raw;
    });
  }

  private assetToken(abs: string, kind?: string): string {
    if (!this.assets.has(abs)) this.assets.set(abs, kind ?? '');
    return this.deps.assetToken(abs, kind);
  }
}

export function serializeSourceDocument(html: string, deps: SourceSerializeDeps): SourceSerializeOutcome {
  return new SourceSerializer(deps).serialize(html);
}

/** Estado vacío reutilizable para frames que no aportan estado propio. */
export function emptyPageState(): PageState {
  return {
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
  };
}
