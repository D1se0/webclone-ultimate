# Arquitectura — WebClone Ultimate

## 1. Vista general

```
┌───────────────────────────── Navegador ─────────────────────────────┐
│                                                                     │
│  ┌──────────┐   mensajes   ┌────────────────────┐   tabs.sendMessage │
│  │  Popup   │ ───────────► │ Background (SW)    │ ─────────────────► │
│  │  (UI)    │ ◄─────────── │ sesiones · ZIP     │ ◄───────────────── │
│  └──────────┘              │ IndexedDB · fetch  │                    │
│        │                   └────────────────────┘                    │
│        │ chrome-extension://…/replay/index.html                     │
│        ▼                                                            │
│  ┌──────────┐              ┌──────────────────────────────────────┐ │
│  │ Replay   │              │ Content script (frame 0 + subframes) │ │
│  │ (rrweb)  │              │  serializer · assets · recorder      │ │
│  └──────────┘              └──────────────────────────────────────┘ │
│                                        │ world: MAIN               │
│                                        ▼                           │
│                            hooks de página: errores, red, SPA       │
└─────────────────────────────────────────────────────────────────────┘
```

Cuatro contextos con responsabilidades separadas:

1. **Popup** (documento de extensión): UI, ajustes, lista de sesiones, inspector, descarga/importación.
2. **Background** (service worker en Chrome, `scripts` en Firefox): orquestación, almacenamiento,
   descarga de recursos con privilegios de host, construcción del ZIP, importación.
3. **Content script**: captura y grabación en la página; nunca escribe en la página salvo lo mínimo.
4. **Replay page**: reproductor rrweb y timeline, dentro de la extensión.

## 2. Por qué esta arquitectura

- **Chrome serializa los mensajes como JSON.** Los `ArrayBuffer` se pierden; por eso los binarios
  viajan como **base64** (`src/shared/base64.ts`) y los recursos nunca cruzan el canal como objetos.
- **El content script no puede saltarse CORS**, el background sí (con `host_permissions`). Toda
  descarga de recursos se hace en el background (`src/core/asset-fetcher.ts`). `blob:` se resuelve
  en la página porque el worker no puede leer el registro de blobs del origen.
- **`tabs.sendMessage` llega a todos los frames**, y gana la primera respuesta. Todas las órdenes se
  envían con `{frameId: 0}` para garantizar que captura el documento superior.
- **El service worker puede morir**: los recursos se escriben en IndexedDB al resolverlos y los
  eventos de grabación se vuelcan cada 3 s. Si la pestaña se cierra, `tabs.onRemoved` finaliza una
  sesión `partial`.
- **Sin permiso `debugger`**: se evita CDP para no solicitar un permiso intrusivo. La red se observa
  con hooks `fetch`/XHR en MAIN world (que sí aportan cuerpos de texto/JSON), `webRequest` pasivo
  para metadatos y Resource Timing como respaldo. No hay HAR completo ni cuerpos retroactivos.

## 3. Pipeline de Instant Clone

```
serializeDocument(doc)          ← síncrono, produce HTML con tokens
   ├── elementos, atributos (sin on*, nonce, integrity)
   ├── <style>/<link> → bloque CSS registrado (token __WC_STYLE_n__)
   ├── shadowRoot → <template shadowrootmode="open">
   ├── canvas → toDataURL → token de recurso
   ├── iframe same-origin → snapshot/frames/frame-N.html
   ├── formularios → atributos + state.forms
   └── media → atributos + state.media
assets (tokens __WC_ASSET_n__)
   ├── CSS: url(), @import, @font-face
   ├── DOM: src, srcset, poster, href de iconos/objetos
   └── data: y blob: (decodificados una sola vez y deduplicados)
resolveAssets (background)
   ├── fetch sin credenciales, límites por recurso y totales
   ├── SHA-256 → nombre de fichero → deduplicación por contenido
   └── devuelve map url→ruta, fallos tipificados y textos CSS
finalize
   ├── CSS: inlinar @import (hasta 4 niveles) + reescribir url() a rutas locales
   ├── HTML: sustituir tokens por rutas (o URL original si falló)
   ├── frames: rutas con prefijo ../../ correcto
   └── informe: contadores, bytes, fallos, capacidades no soportadas
```

### Modo dinámico

El modo dinámico sustituye la base `dom.json` por el **HTML fuente** descargado en el background
(`source-serializer.ts`) y conserva los `<script>` locales. El pipeline es:

```
HTML fuente + scripts locales + CSS externo inlinado
   ├── comentarios conservados (marcadores <!--$--> de React 18)
   ├── state-capture.ts: estado por selectores CSS (formularios, scroll, media, popovers)
   ├── network/responses.json: journal fetch/XHR (método, URL, estado, MIME, cuerpo)
   └── runtime offline inyectado ANTES de los scripts de la página
         ├── fetch/XHR → respuesta grabada por método+URL (o por ruta)
         ├── no capturado → HTTP 504; nunca sale a Internet
         └── WebSocket/EventSource/sendBeacon/SW/navegación externa bloqueados
```

- Los hooks viven en `src/content/main-world.ts` (journal con cuerpos armables y snapshot por
  `postMessage`); el content script los arma y pide el snapshot al terminar el settle.
- Los cuerpos pequeños de texto/JSON se incrustan en base64; los grandes o binarios van a
  `assets/network/` y se referencian desde `responses.json`.
- Los scripts descargados se reescriben (`src/shared/js-rewrite.ts`): `import`, `export from`,
  `import()`, `require`, `importScripts`, `new Worker` y `new URL(..., import.meta.url)`. Las rutas
  usan el hash de la URL para poder reescribir antes de conocer el hash final.
- `framework.ts` detecta React 18/Next/Nuxt/Remix/TanStack por marcadores de Suspense, estado SSR y
  bundles. Salvo `forceDynamic`, se usa la instantánea estática para evitar hydration mismatch.
- `dynamic-runtime.ts` es el bootstrap que aplica el estado, sirve la red y bloquea capacidades no
  reproducibles; se inyecta como `headPrefix` tanto en la base de HTML fuente como en el fallback de
  DOM vivo.

### Clon Completo (sesión interactiva)

El Clon Completo reutiliza el pipeline dinámico, pero separa la captura en dos fases:

```
INICIO (usuario)
  └── hooks armados + journal vacío; el usuario navega y genera tráfico
        ├── fetch/XHR con método, cabeceras seguras, request body y response body
        ├── journal acumulado en background (sobrevive a navegación entre documentos)
        └── WC_FULL_ATTACH reengancha la sesión al cargar el documento nuevo
FINAL (usuario)
  └── snapshot actual + journal de background + storage/ruta
        ├── HTML fuente, assets y JS locales
        ├── network/responses.json con todas las ocurrencias
        ├── session/session.json + <script id="wc-session">
        └── runtime: restaura storage/ruta y sirve fetch/XHR por método+URL+cuerpo
```

- `src/core/session-state.ts` captura `localStorage`/`sessionStorage` con lista de claves sensibles
  omitidas, límite de tamaño y ruta sin parámetros de autenticación.
- `WC_FULL_STATE` permite al popup recuperar una sesión activa aunque el service worker se haya
  reiniciado; `tabs.onUpdated` reengancha tras una navegación completa.
- Los cuerpos de petición y respuesta se guardan en el mismo journal; el runtime elige la ocurrencia
  por cuerpo y mantiene un cursor para peticiones repetidas. Una petición no observada devuelve 504.
- La restauración de ruta usa `history.replaceState` solo en el documento superior y nunca en
  `file://`; el iframe conserva su propia URL local.

### Sistema de tokens

El serializador es síncrono y determinista: no descarga nada. Cada recurso se sustituye por
`__WC_ASSET_n__` y cada bloque CSS por `__WC_STYLE_n__`. El pipeline resuelve y sustituye al final.
Ventajas: el serializador es testeable, la deduplicación es trivial y los fallos no rompen el HTML
(se conserva la URL remota y se anota el motivo).

### CSS

- Hojas same-origin: se leen de **CSSOM** (`cssRules`), así se incluyen reglas inyectadas con
  `insertRule` por frameworks CSS-in-JS, no solo el `textContent` del `<style>`.
- Hojas cross-origin: se piden por red y se inlinan si es posible.
- `@import` se resuelve recursivamente; `url()` se reescribe; los fragmentos (`url(#grad)`) no se tocan.
- Se eliminan `meta CSP`, `meta refresh` y `<base>`: romperían el clon offline.
- Orden de cascada: cada hoja se emite en su posición original del documento.

### Estado (`state.json`)

- `viewport`: tamaño, scroll, DPR.
- `forms`: valor/checked/selectedIndex por `data-wc-id`; campos sensibles con `excludedReason`.
- `scrollables`, `details`, `dialogs`, `popovers`, `media` (tiempo, pausa, volumen, rate).
- `canvases`: modo `image` o `unsupported` con motivo.
- Un script propio (`CLONE_BOOTSTRAP_JS`) aplica el estado sin ejecutar JavaScript de la página y
  desactiva navegación/envío de formularios para que la instantánea no se escape.

### Shadow DOM e iframes

- Shadow roots abiertos → Declarative Shadow DOM (`<template shadowrootmode="open">`), incluidos
  `adoptedStyleSheets`. Los roots cerrados no son accesibles: se documentan como no soportados.
- Iframes same-origin → documento completo serializado, con su propio estado y bootstrap.
- Iframes cross-origin → marcador + entrada en el informe (restricción: same-origin policy).

## 4. Grabación de sesión

- `@rrweb/record` 2.2.x con `inlineStylesheet`, `collectFonts`, `recordCanvas` opcional,
  `maskInputOptions.password` y muestreo de movimiento configurable.
- Eventos en memoria + volcado incremental al background (chunks en IndexedDB) cada 3 s.
- Hooks en MAIN world (inyectados con `scripting.executeScript({world:'MAIN'})`):
  - `error`, `unhandledrejection`, errores de recursos, `console.error/warn`.
  - `fetch` y `XMLHttpRequest` (URL, método, estado, duración); en la grabación no se guardan
    cuerpos, mientras que el Instant Clone dinámico tiene su propio journal con cuerpos.
  - `pushState`/`replaceState`/`popstate`/`hashchange` → navegación SPA.
  - eventos de media (`play`, `pause`, `seeked`, `volumechange`, `ratechange`).
- Resource Timing como red de seguridad cuando los hooks no están disponibles.
- Al detener: inventario de recursos del DOM → resolución en background → reescritura de URLs dentro
  del árbol serializado de rrweb (`rewriteRrwebAssets`) → timeline → almacenamiento.
- Timeline: duración observada, marcas de snapshot/navegación/error/red/consola e índice cada 64
  eventos para búsquedas O(log n).

## 5. Almacenamiento (IndexedDB `webclone-ultimate`, v2)

| Store | Clave | Contenido |
|---|---|---|
| `sessions` | `id` | metadatos, informe, HTML o eventos referenciados, timeline, frames |
| `assets` | `sessionId::path` | bytes del recurso + MIME (índice por `sessionId`) |
| `events` | `sessionId::seq` | chunks de eventos rrweb (índice por `sessionId`) |

- Límites configurables: por recurso (25 MB por defecto) y totales (300 MB).
- `navigator.storage.estimate()` alimenta la barra de almacenamiento del popup.
- Exportación en memoria (base64 con +33 % de overhead): sesiones de decenas de MB son viables;
  por encima del límite práctico del canal de mensajes puede fallar (documentado).

## 6. Exportación e importación

- `buildExportFiles` es puro respecto al navegador: recibe sesión + assets y devuelve la lista de
  ficheros del ZIP. Se testea en Node.
- ZIP con fflate: UTF-8, CRC-32, rutas validadas; assets ya comprimidos se almacenan sin recomprimir.
- `metadata.json` incluye SHA-256, CRC-32, bytes y MIME de cada entrada.
- `replay.html` incrusta los eventos como JSON y carga `assets/js/wc-replay.js` (bundle IIFE de
  rrweb), por lo que funciona sin la extensión y sin red.
- Importación: lee el ZIP con fflate, valida `tool.name`, recalcula SHA-256 de cada entrada y marca
  `integrity: ok|broken` sin bloquear la sesión.

## 7. Diferencias Chrome / Firefox

| Aspecto | Chrome / Chromium | Firefox |
|---|---|---|
| Background | `service_worker` (MV3) | `background.scripts` (MV3) |
| Hooks MAIN world | Content script `world: MAIN` en `document_start` | Inyección con `scripting.executeScript` al iniciar la captura; runtime no automatizado |
| Declarative Shadow DOM | 111+ | 123+ |
| Instalación | Cargar descomprimida | Complemento temporal (`about:debugging`) |
| Validación automática | Playwright + Chromium (8 tests) | `web-ext lint` (0 errores) |

La extensión detecta capacidades en tiempo de ejecución y no fuerza una implementación única.

## 8. Dependencias y alternativas evaluadas

| Necesidad | Elegido | Alternativas y motivo |
|---|---|---|
| Grabación de sesión | `@rrweb/record` / `@rrweb/replay` 2.2.2 | Implementar snapshots incrementales + replayer es inviable en alcance y calidad; rrweb cubre mutaciones, shadow DOM, canvas, media y fuentes |
| Empaquetado | `fflate` | JSZip es válido pero más pesado; fflate es sincrónico, rápido y con CRC-32/UTF-8; validado con python y unzip |
| Build | `esbuild` | Vite evaluado: añade dev server/HMR innecesarios y complica bundles IIFE por contexto; esbuild genera 6 bundles deterministas y rápidos |
| Automatización | Playwright + Chromium | Requisito del proyecto; permite cargar la extensión real, HAR-like observation, screenshots y descarga de artefactos |
| Diferencias visuales | Pixelmatch + pngjs | SSIM sería otra opción; Pixelmatch da diff por píxel y umbral de antialiasing suficiente y determinista |
| ZIP de verificación | `python3 zipfile` + `unzip -t` | Independencia de la implementación JS |
| Tipos | TypeScript estricto | Sin `any` en el núcleo; comprobación en CI local con `tsc --noEmit` |

No se añadieron FFmpeg, CDP ni librerías de ZIP adicionales: no eran necesarios para los objetivos y
habrían añadido peso, permisos o dependencias nativas.

## 9. Manejo de errores

- Todo fallo de recurso se registra con `url`, `kind`, `reason`, `restriction`, `affectsFidelity` y
  `alternative`; nunca se convierte silenciosamente en un recurso "capturado".
- El pipeline de captura captura excepciones y emite `WC_CAPTURE_FAILED`; el popup muestra el error y
  libera el estado de la pestaña.
- El informe de compatibilidad (HTML y JSON) enumera recursos fallidos, canvas no legibles, iframes
  no serializados, scripts eliminados/conservados, respuestas de red y el fallback de hidratación.
- La integridad de la sesión (`ok`/`broken`/`unknown`) se calcula en captura, importación y exportación.
