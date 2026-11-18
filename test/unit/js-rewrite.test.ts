import { describe, expect, it } from 'vitest';
import { rewriteJsSpecifiers } from '../../src/shared/js-rewrite';

const resolver = (specifier: string): string | null => {
  const map: Record<string, string> = {
    './lazy-module.mjs': './assets/js/lazy.mjs',
    '../shared/util.js': './assets/js/util.js',
    'https://cdn.example.test/lib.js': './assets/js/lib.js',
    '/static/app.js': './assets/js/app.js',
  };
  return map[specifier] ?? null;
};

describe('rewriteJsSpecifiers', () => {
  it('reescribe imports estáticos y reexports', () => {
    const input = `import { a } from './lazy-module.mjs';\nexport { b } from '../shared/util.js';\nimport 'https://cdn.example.test/lib.js';`;
    const { code, rewritten } = rewriteJsSpecifiers(input, resolver);
    expect(rewritten).toBe(3);
    expect(code).toContain("from './assets/js/lazy.mjs'");
    expect(code).toContain("from './assets/js/util.js'");
    expect(code).toContain("import './assets/js/lib.js'");
  });

  it('reescribe import dinámico, require, workers e importScripts', () => {
    const input = [
      "const lazy = import('./lazy-module.mjs');",
      "const legacy = require('/static/app.js');",
      "new Worker('./lazy-module.mjs', { type: 'module' });",
      "importScripts('https://cdn.example.test/lib.js');",
    ].join('\n');
    const { code } = rewriteJsSpecifiers(input, resolver);
    expect(code).toContain("import('./assets/js/lazy.mjs')");
    expect(code).toContain("require('./assets/js/app.js')");
    expect(code).toContain("new Worker('./assets/js/lazy.mjs'");
    expect(code).toContain("importScripts('./assets/js/lib.js')");
  });

  it('reescribe new URL con import.meta.url', () => {
    const input = `const wasm = new URL('./lazy-module.mjs', import.meta.url);`;
    const { code } = rewriteJsSpecifiers(input, resolver);
    expect(code).toContain("new URL('./assets/js/lazy.mjs', import.meta.url)");
  });

  it('no toca cadenas normales, comentarios ni plantillas', () => {
    const input = [
      "const text = \"import x from './lazy-module.mjs'\";",
      "// import y from './lazy-module.mjs'",
      "const tpl = `import('./lazy-module.mjs')`;",
      "obj.from('./lazy-module.mjs');",
    ].join('\n');
    const { code, rewritten } = rewriteJsSpecifiers(input, resolver);
    expect(rewritten).toBe(0);
    expect(code).toBe(input);
  });

  it('deja intactos los especificadores bare y elimina sourcemaps', () => {
    const input = `import React from 'react';\n//# sourceMappingURL=app.js.map\n`;
    const { code } = rewriteJsSpecifiers(input, resolver);
    expect(code).toContain("from 'react'");
    expect(code).not.toContain('sourceMappingURL');
  });
});
