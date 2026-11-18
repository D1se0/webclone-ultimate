/**
 * Reescritura de recursos dentro de los eventos de rrweb.
 * Los eventos de snapshot contienen un árbol serializado con atributos; aquí se
 * sustituyen las URLs remotas por rutas locales del paquete exportado.
 */

import { absolutize, rewriteSrcset } from '../shared/url';
import { rewriteCssUrls } from '../shared/css';

interface SerializedNode {
  type?: number;
  tagName?: string;
  attributes?: Record<string, string | number | boolean | null>;
  childNodes?: SerializedNode[];
  shadowRoot?: SerializedNode | null;
  isSVG?: boolean;
  [key: string]: unknown;
}

const URL_ATTRS = new Set(['src', 'href', 'poster', 'data', 'xlink:href', 'data-src', 'data-original', 'data-lazy-src']);

export interface RewriteStats {
  attributes: number;
  cssTexts: number;
  missed: string[];
}

function rewriteStyleText(css: string, baseUrl: string, resolve: (abs: string) => string | null, stats: RewriteStats): string {
  return rewriteCssUrls(css, (raw) => {
    if (raw.startsWith('#')) return raw;
    const abs = absolutize(raw, baseUrl);
    if (!abs) return raw;
    const local = resolve(abs);
    if (!local) return raw;
    stats.attributes++;
    return local;
  });
}

function rewriteAttributes(
  node: SerializedNode,
  baseUrl: string,
  resolve: (abs: string) => string | null,
  stats: RewriteStats,
): void {
  const attributes = node.attributes;
  if (!attributes) return;
  for (const [name, rawValue] of Object.entries(attributes)) {
    if (typeof rawValue !== 'string') continue;
    if (name === '_cssText') {
      attributes[name] = rewriteStyleText(rawValue, baseUrl, resolve, stats);
      stats.cssTexts++;
      continue;
    }
    if (name === 'style') {
      attributes[name] = rewriteStyleText(rawValue, baseUrl, resolve, stats);
      continue;
    }
    if (name === 'srcset' || name === 'data-srcset') {
      attributes[name] = rewriteSrcset(rawValue, (abs) => resolve(abs) ?? abs, baseUrl);
      stats.attributes++;
      continue;
    }
    if (!URL_ATTRS.has(name)) continue;
    if (rawValue.startsWith('data:')) continue;
    const abs = absolutize(rawValue, baseUrl);
    if (!abs) continue;
    const local = resolve(abs);
    if (local) {
      attributes[name] = local;
      stats.attributes++;
    } else {
      stats.missed.push(abs);
    }
  }
}

function walkNode(
  node: SerializedNode,
  baseUrl: string,
  resolve: (abs: string) => string | null,
  stats: RewriteStats,
  depth = 0,
): void {
  if (!node || depth > 500) return;
  rewriteAttributes(node, baseUrl, resolve, stats);
  if (node.shadowRoot) walkNode(node.shadowRoot, baseUrl, resolve, stats, depth + 1);
  if (Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) walkNode(child, baseUrl, resolve, stats, depth + 1);
  }
}

interface RrwebLikeEvent {
  type: number;
  timestamp: number;
  data?: Record<string, any>;
  [key: string]: unknown;
}

/**
 * Devuelve una copia de los eventos con las URLs reescritas.
 * `resolve` recibe la URL absoluta y devuelve la ruta local o null.
 */
export function rewriteRrwebAssets(
  events: unknown[],
  pageUrl: string,
  resolve: (absoluteUrl: string) => string | null,
): { events: unknown[]; stats: RewriteStats } {
  const stats: RewriteStats = { attributes: 0, cssTexts: 0, missed: [] };
  const out: unknown[] = [];
  for (const raw of events) {
    const event = raw as RrwebLikeEvent;
    if (!event || typeof event !== 'object') {
      out.push(raw);
      continue;
    }
    const clone: RrwebLikeEvent = { ...event, data: event.data ? { ...event.data } : event.data };
    const data = clone.data;
    if (data) {
      if (data.node) walkNode(data.node as SerializedNode, pageUrl, resolve, stats);
      if (Array.isArray(data.adds)) {
        for (const add of data.adds) if (add?.node) walkNode(add.node as SerializedNode, pageUrl, resolve, stats);
      }
      if (Array.isArray(data.attributes)) {
        for (const attr of data.attributes) {
          if (attr?.name === 'style' || attr?.name === '_cssText') {
            attr.value = rewriteStyleText(String(attr.value ?? ''), pageUrl, resolve, stats);
          }
        }
      }
      if (typeof data.href === 'string') {
        const abs = absolutize(data.href, pageUrl);
        const local = abs ? resolve(abs) : null;
        if (local) data.href = local;
      }
      if (Array.isArray(data.payload)) {
        for (const item of data.payload) {
          if (!item || typeof item !== 'object') continue;
          if (Array.isArray(item.adds)) {
            for (const add of item.adds) if (add?.node) walkNode(add.node as SerializedNode, pageUrl, resolve, stats);
          }
        }
      }
    }
    out.push(clone);
  }
  stats.missed = Array.from(new Set(stats.missed)).slice(0, 200);
  return { events: out, stats };
}
