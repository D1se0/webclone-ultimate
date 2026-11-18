# La web del proyecto

La web de `website/` es una landing y manual interactivo de WebClone Ultimate. No es una página
estática de plantilla: incluye un laboratorio que simula el pipeline, comparador original/clon,
pestañas de capacidades, árbol del ZIP, ejemplos copiables, documentación, matriz de compatibilidad,
FAQ y animaciones con `prefers-reduced-motion`.

## Stack

| Pieza | Uso |
|---|---|
| React 19 | Componentes y estado de la demo |
| Vite 8 | Build estático y servidor de desarrollo |
| TypeScript estricto | Contratos de contenido y componentes |
| CSS propio | Sistema visual, animaciones y responsive |
| Lucide React | Iconos de interfaz |
| Fontsource | Space Grotesk y JetBrains Mono locales, sin CDN |
| Vitest + Testing Library | Componentes, tema, demo y FAQ |
| Playwright | Navegación real en escritorio y móvil |

No hay backend ni base de datos: GitHub Pages sirve archivos estáticos. Node.js participa en el build
y en el validador `scripts/verify-build.mjs`.

## Estructura

```text
website/
├── public/               # favicon, OG, robots, .nojekyll
├── scripts/verify-build.mjs
├── src/
│   ├── components/
│   │   ├── Nav.tsx       # navegación, progreso, menú, footer
│   │   ├── Hero.tsx      # portada, visual, stats y ticker
│   │   ├── Lab.tsx       # captura simulada y comparador
│   │   ├── Sections.tsx  # capacidades, pipeline, ejemplos, ZIP
│   │   ├── Docs.tsx      # documentación, privacidad, compat, FAQ
│   │   └── GithubMark.tsx
│   ├── data/content.ts   # contenido editorial tipado
│   ├── hooks.ts          # tema, reveal, scrollspy, copiar
│   ├── test/setup.ts
│   ├── App.tsx
│   ├── App.test.tsx
│   ├── main.tsx
│   └── styles.css
├── tests/e2e/site.spec.ts
├── index.html
├── playwright.config.ts
├── vite.config.ts
└── tsconfig.json
```

## Secciones

1. **Hero**: titular editorial, visual de navegador con órbitas, chips flotantes y prueba de que todo
   es local.
2. **Laboratorio**: botón de captura, cuatro fases reales, progreso, informe JSON y comparador con
   slider. El clon se superpone con `clip-path`.
3. **Capacidades**: cuatro pestañas (Instant, Dynamic, Full, Recording), cada una con bullets,
   métrica, mock visual y snippet copiable.
4. **Pipeline**: cuatro fases clicables, detalle técnico y terminal de salida.
5. **Ejemplos**: instalación, empaquetado, apertura, API de mensajes y verificación.
6. **Formato**: árbol del ZIP y visor de archivos con contenido realista.
7. **Documentación**: seis artículos con instalación, captura, sesiones, privacidad, límites y
   diagnóstico.
8. **Privacidad**: órbita local y garantías; sin cuenta ni telemetría.
9. **Compatibilidad**: tabla honesta Chrome/Firefox y límites.
10. **FAQ**: acordeón accesible y enlaces a issues/seguridad.
11. **CTA y footer**: instalación, licencia y enlaces técnicos.

## Animaciones

- Aparición por `IntersectionObserver` con `data-reveal` y delays escalonados.
- Órbitas, flotación, gradientes, brillo y marquesinas con CSS.
- Barra de progreso de lectura.
- Scan line durante la captura simulada.
- Transición de pestañas, panel y acordeón.
- Tema claro/oscuro persistido en `localStorage`.
- Respeto de `prefers-reduced-motion`: se desactivan animaciones y se muestran los bloques.

No se usa una librería de animación pesada; el movimiento está en CSS y el estado en React.

## Accesibilidad

- Skip link, landmarks, `aria-selected`, `aria-controls`, `aria-expanded` y `aria-live`.
- Navegación con teclado y foco visible.
- El slider del comparador tiene etiqueta.
- Contraste alto en ambos temas.
- El contenido no depende de hover.
- Los iconos decorativos son `aria-hidden`.

## Pruebas

```bash
npm --prefix website install
npm --prefix website run typecheck
npm --prefix website test
npm --prefix website run build
npm --prefix website run test:e2e
```

- **6 unitarios**: render, pestañas, captura, tema, ZIP/ejemplos y FAQ.
- **12 E2E**: 6 flujos × 2 proyectos (Chromium escritorio y Pixel 7). Cubren errores de página,
  laboratorio, tema persistente, navegación, ZIP, FAQ, menú móvil y desbordamiento horizontal.
- **verify-build**: comprueba que el HTML compilado usa rutas relativas y que existen los assets, el
  favicon, los metadatos y los marcadores de contenido.

## Build para Pages

`vite.config.ts` usa `base: './'` para que los assets funcionen bajo
`https://d1se0.github.io/webclone-ultimate/`. No se usan rutas absolutas `/assets/...`, que romperían
un project page.

```bash
npm --prefix website run build
# website/dist/index.html
# website/dist/assets/*.js
# website/dist/assets/*.css
```

El workflow `pages.yml` sube `website/dist` con `actions/upload-pages-artifact` y publica con
`actions/deploy-pages`.

## Editar contenido

Todo el texto principal vive en `src/data/content.ts`. Para añadir una FAQ, una capacidad, un ejemplo
o un archivo del ZIP se edita el array correspondiente; TypeScript valida la forma. Los artículos de
documentación se renderizan automáticamente y el índice lateral se genera desde el mismo array.

Si se cambia la sección visible, actualiza también las pruebas de `src/App.test.tsx` y
`tests/e2e/site.spec.ts` para que sigan cubriendo el comportamiento real.
