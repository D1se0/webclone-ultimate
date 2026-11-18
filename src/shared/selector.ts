/** Selectores CSS estables para restaurar estado en clones dinámicos. */

function escapeIdent(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/([^\w-])/g, '\\$1');
}

function isUnique(doc: Document, selector: string): boolean {
  try {
    return doc.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

/**
 * Devuelve un selector que localiza el elemento en el documento.
 * Prioriza `#id` y `[name]`; si no son únicos, construye una ruta con
 * `:nth-of-type`, que es estable para el DOM serializado.
 */
export function buildSelector(el: Element): string {
  const doc = el.ownerDocument;
  if (!doc) return '';
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute('id');
  if (id) {
    const selector = `#${escapeIdent(id)}`;
    if (isUnique(doc, selector)) return selector;
  }
  const name = el.getAttribute('name');
  if (name) {
    const selector = `${tag}[name="${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
    if (isUnique(doc, selector)) return selector;
  }
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== doc.body && current !== doc.documentElement) {
    let part = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (parent) {
      let index = 1;
      for (let sibling = current.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        if (sibling.tagName === current.tagName) index++;
      }
      part += `:nth-of-type(${index})`;
    }
    parts.unshift(part);
    const candidate = parts.join(' > ');
    if (isUnique(doc, candidate)) return candidate;
    current = parent;
  }
  return parts.length ? `body > ${parts.join(' > ')}` : tag;
}
