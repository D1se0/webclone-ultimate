/** Inventario de recursos del documento (para grabaciones y para el informe). */

import { absolutize, classifyAsset, rewriteSrcset } from '../shared/url';
import { collectCssUrls, scanCss } from '../shared/css';

export interface AssetInventory {
  /** URL absoluta -> tipo detectado. */
  urls: Map<string, string>;
  /** Hojas de estilo no accesibles por CSSOM (hay que pedirlas por red). */
  externalSheets: string[];
  counts: { elements: number; stylesheets: number; images: number; media: number; iframes: number; canvases: number };
  truncated: boolean;
}

const MAX_ELEMENTS = 40_000;
const URL_ATTRS = ['src', 'poster', 'data', 'xlink:href'];

function addUrl(map: Map<string, string>, raw: string | null, base: string, kind?: string): void {
  if (!raw) return;
  const abs = absolutize(raw, base);
  if (!abs || /^(javascript|about):/i.test(abs)) return;
  if (!map.has(abs)) map.set(abs, kind ?? classifyAsset(abs));
}

function addSrcset(map: Map<string, string>, value: string | null, base: string): void {
  if (!value) return;
  const rewritten = rewriteSrcset(value, (abs) => {
    addUrl(map, abs, base, 'image');
    return abs;
  }, base);
  void rewritten;
}

function addCssUrls(map: Map<string, string>, css: string, base: string, externalSheets: string[]): void {
  for (const raw of collectCssUrls(css)) {
    if (raw.startsWith('#')) continue;
    const abs = absolutize(raw, base);
    if (abs) addUrl(map, abs, base, classifyAsset(abs));
  }
  for (const imp of scanCss(css).imports) {
    const abs = absolutize(imp.href, base);
    if (!abs) continue;
    addUrl(map, abs, base, 'css');
    if (!externalSheets.includes(abs)) externalSheets.push(abs);
  }
}

/** Recorre el documento vivo y devuelve todas las URLs referenciadas. */
export function inventoryDocument(doc: Document): AssetInventory {
  const urls = new Map<string, string>();
  const externalSheets: string[] = [];
  const base = doc.baseURI;
  const counts = { elements: 0, stylesheets: 0, images: 0, media: 0, iframes: 0, canvases: 0 };
  let truncated = false;

  const elements = doc.querySelectorAll('*');
  counts.elements = elements.length;
  if (elements.length > MAX_ELEMENTS) truncated = true;

  for (let i = 0; i < Math.min(elements.length, MAX_ELEMENTS); i++) {
    const el = elements[i];
    const tag = el.tagName.toLowerCase();
    const inlineStyle = el.getAttribute('style');
    if (inlineStyle) addCssUrls(urls, inlineStyle, base, externalSheets);

    if (tag === 'style') {
      counts.stylesheets++;
      const sheet = (el as HTMLStyleElement).sheet;
      let css = '';
      if (sheet) {
        try {
          for (let r = 0; r < sheet.cssRules.length; r++) css += `${sheet.cssRules[r].cssText}\n`;
        } catch {
          css = el.textContent ?? '';
        }
      } else {
        css = el.textContent ?? '';
      }
      addCssUrls(urls, css, base, externalSheets);
      continue;
    }

    if (tag === 'link') {
      const rel = (el.getAttribute('rel') || '').toLowerCase();
      if (rel.includes('stylesheet')) {
        counts.stylesheets++;
        const sheet = (el as HTMLLinkElement).sheet;
        if (sheet) {
          try {
            let css = '';
            for (let r = 0; r < sheet.cssRules.length; r++) css += `${sheet.cssRules[r].cssText}\n`;
            addCssUrls(urls, css, (el as HTMLLinkElement).href || base, externalSheets);
          } catch {
            addUrl(urls, el.getAttribute('href'), base, 'css');
          }
        } else {
          addUrl(urls, el.getAttribute('href'), base, 'css');
          const abs = absolutize(el.getAttribute('href'), base);
          if (abs && !externalSheets.includes(abs)) externalSheets.push(abs);
        }
      } else if (rel.includes('icon') || rel.includes('apple-touch')) {
        addUrl(urls, el.getAttribute('href'), base, 'image');
      }
      continue;
    }

    if (tag === 'img' || tag === 'picture' || tag === 'source') {
      counts.images++;
      const current = (el as HTMLImageElement).currentSrc;
      if (current) addUrl(urls, current, base, 'image');
      addSrcset(urls, el.getAttribute('srcset'), base);
      addSrcset(urls, el.getAttribute('data-srcset'), base);
      for (const attr of ['data-src', 'data-original', 'data-lazy-src']) {
        addUrl(urls, el.getAttribute(attr), base, 'image');
      }
    }

    if (tag === 'video' || tag === 'audio') {
      counts.media++;
      addUrl(urls, (el as HTMLMediaElement).currentSrc || null, base);
      addUrl(urls, el.getAttribute('poster'), base, 'image');
    }

    if (tag === 'iframe') counts.iframes++;
    if (tag === 'canvas') counts.canvases++;

    for (const attr of URL_ATTRS) {
      const value = el.getAttribute(attr);
      if (value) addUrl(urls, value, base);
    }
    if (tag === 'object') addUrl(urls, el.getAttribute('data'), base);
  }

  return { urls, externalSheets, counts, truncated };
}

export function inventoryToRequests(inventory: AssetInventory): { url: string; kind: string }[] {
  return Array.from(inventory.urls.entries()).map(([url, kind]) => ({ url, kind }));
}
