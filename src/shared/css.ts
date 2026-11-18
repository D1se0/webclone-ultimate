/**
 * Reescritura de CSS sin dependencias.
 * No es un parser completo de CSS: maneja con precisión url(), @import, cadenas y
 * comentarios, que es exactamente lo que necesita el Asset Manager. Todo lo demás se
 * conserva byte a byte (lo que preserva media queries, custom properties y anidamientos).
 */

export interface CssUrlRef {
  raw: string;
  /** Posición del inicio de `url(` en el texto original. */
  start: number;
  /** Posición inmediatamente después del `)` de cierre. */
  end: number;
  isFragment: boolean;
}

export interface CssImportRef {
  href: string;
  start: number;
  end: number;
  /** Texto completo de la regla @import sin el `;`. */
  media: string;
}

export interface CssScanResult {
  urls: CssUrlRef[];
  imports: CssImportRef[];
}

function isIdentChar(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9_\-]/.test(ch);
}

/** Recorre el CSS y devuelve todas las referencias url() (incluidas las de @import url()). */
export function scanCss(css: string): CssScanResult {
  const urls: CssUrlRef[] = [];
  let i = 0;
  const n = css.length;
  while (i < n) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < n) {
        if (css[i] === '\\') {
          i += 2;
          continue;
        }
        if (css[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if ((ch === 'u' || ch === 'U') && /^url\(/i.test(css.slice(i, i + 4)) && !isIdentChar(css[i - 1])) {
      const start = i;
      let j = i + 4;
      while (j < n && /\s/.test(css[j])) j++;
      let quote = '';
      if (css[j] === '"' || css[j] === "'") quote = css[j];
      if (quote) {
        j++;
        let value = '';
        while (j < n) {
          if (css[j] === '\\') {
            value += css[j + 1] ?? '';
            j += 2;
            continue;
          }
          if (css[j] === quote) break;
          value += css[j];
          j++;
        }
        j++; // cierre de comilla
        while (j < n && /\s/.test(css[j])) j++;
        if (css[j] === ')') j++;
        urls.push({ raw: value.trim(), start, end: j, isFragment: value.trim().startsWith('#') });
        i = j;
        continue;
      }
      let value = '';
      while (j < n && css[j] !== ')') {
        if (css[j] === '\\') {
          value += css[j + 1] ?? '';
          j += 2;
          continue;
        }
        value += css[j];
        j++;
      }
      j++; // )
      urls.push({ raw: value.trim(), start, end: j, isFragment: value.trim().startsWith('#') });
      i = j;
      continue;
    }
    i++;
  }

  // @import puede escribirse como @import "x.css" o @import url("x.css")
  const imports: CssImportRef[] = [];
  const importRe = /@import\s+([^;]+);/gi;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(css))) {
    const body = m[1].trim();
    const quoted = /^(["'])(.+?)\1\s*(.*)$/.exec(body);
    const urlFn = /^url\(\s*(['"]?)(.+?)\1\s*\)\s*(.*)$/i.exec(body);
    const href = quoted ? quoted[2] : urlFn ? urlFn[2] : null;
    if (!href) continue;
    imports.push({
      href,
      start: m.index,
      end: m.index + m[0].length,
      media: quoted ? quoted[3].trim() : urlFn ? urlFn[3].trim() : '',
    });
  }
  return { urls, imports };
}

export function collectCssUrls(css: string): string[] {
  const { urls } = scanCss(css);
  const out: string[] = [];
  for (const ref of urls) {
    if (ref.isFragment || !ref.raw) continue;
    if (!out.includes(ref.raw)) out.push(ref.raw);
  }
  return out;
}

/**
 * Reescribe todas las url() del CSS.
 * @param resolve recibe la referencia tal cual aparece; debe devolver el reemplazo
 *                (ruta local, token o la URL original si no se pudo capturar).
 */
export function rewriteCssUrls(css: string, resolve: (rawUrl: string) => string): string {
  const { urls } = scanCss(css);
  if (urls.length === 0) return css;
  let out = '';
  let cursor = 0;
  for (const ref of urls) {
    out += css.slice(cursor, ref.start);
    if (ref.isFragment) {
      out += css.slice(ref.start, ref.end);
    } else {
      const replacement = resolve(ref.raw);
      out += `url("${escapeCssString(replacement)}")`;
    }
    cursor = ref.end;
  }
  out += css.slice(cursor);
  return out;
}

export function escapeCssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\A ');
}

/** Sustituye una regla @import por el contenido CSS indicado, conservando el media query. */
export function inlineImport(importedCss: string, media: string): string {
  if (!media) return importedCss;
  return `@media ${media} {\n${importedCss}\n}`;
}

/** Devuelve el CSS con todos los @import sustituidos por el CSS resuelto. */
export function replaceImports(
  css: string,
  resolve: (href: string) => { css: string; media: string } | null,
): string {
  const { imports } = scanCss(css);
  if (imports.length === 0) return css;
  let out = '';
  let cursor = 0;
  for (const imp of imports) {
    out += css.slice(cursor, imp.start);
    const resolved = resolve(imp.href);
    out += resolved ? inlineImport(resolved.css, imp.media) : css.slice(imp.start, imp.end);
    cursor = imp.end;
  }
  out += css.slice(cursor);
  return out;
}

/** Normaliza comentarios de licencia que puedan romper el CSS al inlinear. */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

export function cssSizeKb(css: string): number {
  return Math.round((new TextEncoder().encode(css).byteLength / 1024) * 10) / 10;
}
