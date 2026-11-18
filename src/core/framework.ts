/**
 * Detección de frameworks que hidratan HTML del servidor (React 18/Next,
 * Nuxt/Vue, Remix, TanStack Start...).
 *
 * Re-ejecutar estos bundles sobre un HTML serializado puede provocar un
 * hydration mismatch y sustituir la página por un error boundary. Cuando se
 * detectan, el modo automático prefiere una instantánea estática fiel y lo
 * documenta en el informe. El usuario puede forzar el modo dinámico.
 */

const REACT_MARKER = /^\$|^\/\$|^\$[?!]/;

export function detectHydrationFramework(doc: Document): string | null {
  try {
    const walker = doc.createTreeWalker(doc, 128 /* NodeFilter.SHOW_COMMENT */);
    let node: Node | null = walker.nextNode();
    let inspected = 0;
    while (node && inspected < 5000) {
      const value = node.nodeValue ?? '';
      if (REACT_MARKER.test(value)) return 'React 18 (marcadores de Suspense)';
      node = walker.nextNode();
      inspected++;
    }
  } catch {
    /* TreeWalker no disponible */
  }

  const html = doc.documentElement?.outerHTML ?? '';
  if (/__NEXT_DATA__|__NUXT__|__TSR__|__remixContext|data-reactroot|hydrateRoot|ReactDOM\.hydrate/i.test(html)) {
    return 'framework de hidratación (estado SSR embebido)';
  }

  const root = doc.querySelector('#__next, #__nuxt, #root, #app, [data-v-app]');
  if (root) {
    const scriptSources = Array.from(doc.scripts)
      .map((script) => script.src || '')
      .join(' ');
    if (/(_next|_nuxt|\/assets\/index-|react|vue|svelte|remix|tanstack)/i.test(scriptSources)) {
      return 'bundle de framework con raíz de hidratación';
    }
  }
  return null;
}
