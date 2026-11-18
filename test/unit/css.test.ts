import { describe, expect, it } from 'vitest';
import { collectCssUrls, replaceImports, rewriteCssUrls, scanCss, stripCssComments } from '../../src/shared/css';

describe('css', () => {
  it('detecta url() con y sin comillas y respeta comentarios y cadenas', () => {
    const css = `
      /* url(no-cuenta.png) */
      .a { background: url(fondo.png) }
      .b { background: url("con espacio.png") }
      .c { content: "url(falso.png)"; }
      .d { mask: url(#gradiente); }
      .e { background-image: image-set(url(a.webp) 1x, url(b.webp) 2x); }
    `;
    const { urls } = scanCss(css);
    const raws = urls.map((u) => u.raw);
    expect(raws).toEqual(['fondo.png', 'con espacio.png', '#gradiente', 'a.webp', 'b.webp']);
    expect(urls[2].isFragment).toBe(true);
  });

  it('recoge urls sin fragmentos', () => {
    expect(collectCssUrls('.a{background:url(a.png)}.b{mask:url(#x)}')).toEqual(['a.png']);
  });

  it('reescribe urls conservando el resto del CSS', () => {
    const css = '@media (min-width: 10px){.a{background:url("a b.png") no-repeat}}';
    const out = rewriteCssUrls(css, (raw) => `assets/images/${raw.replace(/\s/g, '-')}`);
    expect(out).toBe('@media (min-width: 10px){.a{background:url("assets/images/a-b.png") no-repeat}}');
  });

  it('no toca fragmentos', () => {
    expect(rewriteCssUrls('.a{fill:url(#p)}', () => 'X')).toBe('.a{fill:url(#p)}');
  });

  it('detecta @import en ambas formas y conserva media', () => {
    const css = '@import "base.css";\n@import url(print.css) print;\n.a{color:red}';
    const { imports } = scanCss(css);
    expect(imports.map((i) => i.href)).toEqual(['base.css', 'print.css']);
    const output = replaceImports(css, (href) => (href === 'base.css' ? { css: '.x{color:blue}', media: '' } : null));
    expect(output).toContain('.x{color:blue}');
    expect(output).toContain('@import url(print.css) print;');
  });

  it('envuelve en @media cuando el import lo exige', () => {
    const css = '@import "a.css" screen and (max-width: 10px);';
    const output = replaceImports(css, () => ({ css: '.x{}', media: '' }));
    expect(output).toBe('@media screen and (max-width: 10px) {\n.x{}\n}');
  });

  it('elimina comentarios', () => {
    expect(stripCssComments('/* a */ .b{/*c*/color:red}')).toBe(' .b{color:red}');
  });
});
