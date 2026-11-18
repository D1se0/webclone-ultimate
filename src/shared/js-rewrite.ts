/**
 * Reescritura de especificadores de módulos en JavaScript descargado.
 *
 * Objetivo: que un bundle ESM capturado siga cargando sus dependencias desde el
 * paquete local. Se sustituyen únicamente literales de cadena usados como
 * especificadores (`import ... from`, `import()`, `require()`, workers,
 * `importScripts()` y `new URL(..., import.meta.url)`); los comentarios, las
 * cadenas normales y las plantillas se conservan intactos.
 *
 * No es un parser de JavaScript completo: es un escáner de tokens deliberadamente
 * conservador. Ante la duda no reescribe, porque dejar una URL absoluta es menos
 * dañino que corromper el código.
 */

export interface JsRewriteOutcome {
  code: string;
  rewritten: number;
  missed: string[];
}

type TokenType = 'ident' | 'string' | 'template' | 'punct' | 'number' | 'regex';

interface Token {
  type: TokenType;
  /** Para strings: contenido sin comillas. Para el resto: texto literal. */
  value: string;
  start: number;
  end: number;
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

function isRegexAllowed(previous: Token | undefined): boolean {
  if (!previous) return true;
  if (previous.type === 'punct') return ![')', ']', '}'].includes(previous.value);
  if (previous.type === 'ident') {
    return ['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof'].includes(previous.value);
  }
  return false;
}

function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = code.length;

  const previous = (): Token | undefined => tokens[tokens.length - 1];

  while (i < n) {
    const ch = code[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i++;
      continue;
    }
    if (ch === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i++;
      let value = '';
      while (i < n) {
        if (code[i] === '\\') {
          value += code[i] + (code[i + 1] ?? '');
          i += 2;
          continue;
        }
        if (code[i] === quote) {
          i++;
          break;
        }
        value += code[i];
        i++;
      }
      tokens.push({ type: 'string', value, start, end: i });
      continue;
    }
    if (ch === '`') {
      const start = i;
      i++;
      while (i < n) {
        if (code[i] === '\\') {
          i += 2;
          continue;
        }
        if (code[i] === '`') {
          i++;
          break;
        }
        i++;
      }
      tokens.push({ type: 'template', value: code.slice(start + 1, Math.max(start + 1, i - 1)), start, end: i });
      continue;
    }
    if (IDENT_START.test(ch)) {
      const start = i;
      i++;
      while (i < n && IDENT_PART.test(code[i])) i++;
      tokens.push({ type: 'ident', value: code.slice(start, i), start, end: i });
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const start = i;
      i++;
      while (i < n && /[0-9A-Za-z._]/.test(code[i])) i++;
      tokens.push({ type: 'number', value: code.slice(start, i), start, end: i });
      continue;
    }
    if (ch === '/' && isRegexAllowed(previous())) {
      const start = i;
      i++;
      let inClass = false;
      while (i < n) {
        const c = code[i];
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) {
          i++;
          while (i < n && /[a-z]/i.test(code[i])) i++;
          break;
        } else if (c === '\n') {
          break;
        }
        i++;
      }
      tokens.push({ type: 'regex', value: code.slice(start, i), start, end: i });
      continue;
    }
    tokens.push({ type: 'punct', value: ch, start: i, end: i + 1 });
    i++;
  }
  return tokens;
}

function unescapeSpecifier(value: string): string {
  return value.replace(/\\([\\'"`nrt])/g, (_match, char: string) => {
    if (char === 'n') return '\n';
    if (char === 'r') return '\r';
    if (char === 't') return '\t';
    return char;
  });
}

function escapeForQuote(value: string, quote: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(new RegExp(quote, 'g'), `\\${quote}`)
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

function isSpecifierAt(tokens: Token[], index: number): boolean {
  const token = tokens[index];
  if (token.type !== 'string' && token.type !== 'template') return false;
  if (token.type === 'template' && token.value.includes('${')) return false;
  const prev = tokens[index - 1];
  const prev2 = tokens[index - 2];
  const prev3 = tokens[index - 3];
  const prev4 = tokens[index - 4];

  const dotBefore = (at: number): boolean => tokens[at - 1]?.type === 'punct' && tokens[at - 1]?.value === '.';

  // import 'x' / export ... from 'x'
  if (prev?.type === 'ident' && (prev.value === 'from' || prev.value === 'import') && !dotBefore(index - 1)) return true;
  // obj.from('x') no
  if (prev?.type === 'punct' && prev.value === '(') {
    if (prev2?.type === 'ident' && ['require', 'importScripts', 'import'].includes(prev2.value) && !dotBefore(index - 2)) return true;
    // new Worker('x') / new SharedWorker('x')
    if (prev2?.type === 'ident' && ['Worker', 'SharedWorker'].includes(prev2.value) && prev3?.type === 'ident' && prev3.value === 'new') return true;
    // new URL('x', import.meta.url) — también new URL('x') con base implícita.
    if (prev2?.type === 'ident' && prev2.value === 'URL' && prev3?.type === 'ident' && prev3.value === 'new') {
      return true;
    }
  }
  // import(/* webpackChunkName */ 'x') — el comentario ya se descartó y prev2 no existe
  void prev4;
  return false;
}

/**
 * @param code Código JavaScript original.
 * @param resolveSpecifier Recibe el especificador tal cual y devuelve el reemplazo
 *        (normalmente una ruta relativa local) o null para dejarlo igual.
 */
export function rewriteJsSpecifiers(
  code: string,
  resolveSpecifier: (specifier: string) => string | null,
): JsRewriteOutcome {
  const withoutSourceMaps = code
    .replace(/\/\/[#@]\s*sourceMappingURL=[^\n\r]*/g, '')
    .replace(/\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\//g, '');

  const tokens = tokenize(withoutSourceMaps);
  const replacements: { start: number; end: number; value: string }[] = [];
  const missed = new Set<string>();
  let rewritten = 0;

  for (let index = 0; index < tokens.length; index++) {
    if (!isSpecifierAt(tokens, index)) continue;
    const token = tokens[index];
    const specifier = unescapeSpecifier(token.value);
    if (!specifier || specifier.startsWith('data:')) continue;
    const replacement = resolveSpecifier(specifier);
    if (!replacement || replacement === specifier) {
      if (/^(https?:)?\/\//i.test(specifier) || specifier.startsWith('/')) missed.add(specifier);
      continue;
    }
    const quote = withoutSourceMaps[token.start] || "'";
    replacements.push({
      start: token.start + 1,
      end: token.end - 1,
      value: escapeForQuote(replacement, quote),
    });
    rewritten++;
  }

  let output = '';
  let cursor = 0;
  for (const replacement of replacements.sort((a, b) => a.start - b.start)) {
    output += withoutSourceMaps.slice(cursor, replacement.start) + replacement.value;
    cursor = replacement.end;
  }
  output += withoutSourceMaps.slice(cursor);

  return { code: output, rewritten, missed: Array.from(missed).slice(0, 100) };
}

/**
 * Reescribe literales de cadena que sean exactamente una URL de recurso conocida.
 *
 * Los bundlers (Vite/TanStack, webpack...) guardan sus mapas de chunks como
 * cadenas normales (`"assets/chunk.js"`, `"/assets/chunk.js"`), no como
 * especificadores de `import`. Sin esta pasada esos mapas siguen apuntando al
 * servidor original y los módulos perezosos dan 404 en el clon.
 *
 * Solo se sustituye cuando `resolveLiteral` devuelve una ruta; las cadenas que
 * no son recursos se quedan intactas.
 */
export function rewriteJsStringLiterals(
  code: string,
  resolveLiteral: (literal: string) => string | null,
): JsRewriteOutcome {
  const withoutSourceMaps = code
    .replace(/\/\/[#@]\s*sourceMappingURL=[^\n\r]*/g, '')
    .replace(/\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\//g, '');

  const tokens = tokenize(withoutSourceMaps);
  const replacements: { start: number; end: number; value: string }[] = [];
  const missed = new Set<string>();
  let rewritten = 0;

  for (const token of tokens) {
    // Los imports con plantilla los resuelve rewriteJsSpecifiers; aquí solo
    // se localizan cadenas de manifiestos (mapDeps, preloads).
    if (token.type !== 'string') continue;
    const literal = unescapeSpecifier(token.value);
    if (!literal || literal.startsWith('data:')) continue;
    const replacement = resolveLiteral(literal);
    if (!replacement || replacement === literal) {
      if (/^(https?:)?\/\//i.test(literal) || literal.startsWith('/')) missed.add(literal);
      continue;
    }
    const quote = withoutSourceMaps[token.start] || "'";
    replacements.push({
      start: token.start + 1,
      end: token.end - 1,
      value: escapeForQuote(replacement, quote),
    });
    rewritten++;
  }

  let output = '';
  let cursor = 0;
  for (const replacement of replacements.sort((a, b) => a.start - b.start)) {
    output += withoutSourceMaps.slice(cursor, replacement.start) + replacement.value;
    cursor = replacement.end;
  }
  output += withoutSourceMaps.slice(cursor);

  return { code: output, rewritten, missed: Array.from(missed).slice(0, 100) };
}
