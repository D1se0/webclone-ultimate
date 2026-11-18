# WebClone Ultimate

**La memoria visual de la web.** Una extensión Manifest V3 para capturar, reconstruir y reproducir
páginas complejas sin depender del servidor original.

[![CI](https://github.com/D1se0/webclone-ultimate/actions/workflows/ci.yml/badge.svg)](https://github.com/D1se0/webclone-ultimate/actions/workflows/ci.yml)
[![Pages](https://github.com/D1se0/webclone-ultimate/actions/workflows/pages.yml/badge.svg)](https://d1se0.github.io/webclone-ultimate/)
[![License: MIT](https://img.shields.io/badge/license-MIT-d8ff5f.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome%20%7C%20Firefox-MV3-ff6b57.svg)](#compatibilidad)

[**Abrir la web del proyecto**](https://d1se0.github.io/webclone-ultimate/) ·
[**Documentación técnica**](docs/CLONACION-COMPLETA.md) ·
[**Arquitectura**](ARCHITECTURE.md) ·
[**Limitaciones**](LIMITATIONS.md)

---

## Qué es

WebClone Ultimate no guarda una imagen ni un «Guardar como». Serializa el DOM vivo y el CSSOM,
descarga y reescribe los recursos, conserva la red que la página ha generado y construye un paquete
autónomo con checksums SHA-256.

| Modo | Qué conserva | Cuándo usarlo |
|---|---|---|
| **Instant Clone** | DOM, CSS, imágenes, fuentes, formularios, scroll, canvas, shadow DOM e iframes same-origin | Archivar una página tal y como se ve |
| **Clon dinámico** | HTML fuente, JS local y respuestas `fetch`/XHR observadas | Reproducir una página que se hidrata o pide datos |
| **Clon Completo** | Todo lo anterior + ruta, storage no sensible y journal de red de una sesión interactiva | Reproducir un recorrido con formularios y navegación |
| **Full Session Recording** | Eventos rrweb, timeline, errores, navegación SPA y red | Ver la evolución temporal de lo ocurrido |

**Todo queda en local.** La extensión no sube las capturas a ningún servicio. El ZIP exportado se
puede abrir sin la extensión, sin servidor y sin conexión.

## Demo visual

La web del repositorio incluye un laboratorio interactivo, ejemplos de código, anatomía del ZIP,
matriz de compatibilidad, documentación y preguntas frecuentes:

```text
https://d1se0.github.io/webclone-ultimate/
```

Se construye con **React + Vite + TypeScript** y se publica con **GitHub Pages** desde un workflow.
El código de la web está en [`website/`](website/).

## Instalación rápida

Requisitos: **Node.js 20+** (probado con 22 y 26) y Chrome/Chromium 116+ o Firefox 128+.

```bash
git clone https://github.com/D1se0/webclone-ultimate.git
cd webclone-ultimate
npm install
npm run build
```

### Chrome / Chromium / Edge

1. Abre `chrome://extensions`.
2. Activa **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida** y selecciona `dist/chrome`.

### Firefox

1. Abre `about:debugging#/runtime/this-firefox`.
2. Pulsa **Cargar complemento temporal**.
3. Selecciona `dist/firefox/manifest.json`.

> Firefox carga la extensión como complemento temporal y la pierde al cerrar. El manifiesto se valida
> con `web-ext lint`; el runtime de Firefox no está automatizado en esta suite.

## Uso en 60 segundos

1. Abre una página y pulsa el icono de WebClone Ultimate.
2. Pulsa **INSTANT CLONE**.
3. Observa las fases reales: DOM → recursos → red → ZIP.
4. La captura aparece en **Sessions**. Descarga el ZIP o ábrelo con el reproductor incluido.

Para una sesión que evoluciona:

1. Pulsa **CLON COMPLETO**.
2. Interactúa, envía formularios y navega.
3. Pulsa **FINALIZAR Y RECONSTRUIR**.
4. El paquete arranca en la ruta, el storage y la red capturados.

Para grabar la evolución visual:

1. Pulsa **START RECORDING**.
2. Interactúa con la página.
3. Pulsa **STOP RECORDING** y revisa el timeline o exporta el ZIP.

## Qué contiene el ZIP

```text
webclone-export/
├── index.html                  # Clon o reproductor autónomo
├── replay.html                 # Reproductor rrweb
├── metadata.json               # SHA-256, CRC-32, contadores y privacidad
├── README.html                 # Guía incluida en el paquete
├── abrir-clon.mjs              # Lanzador: puerto libre + navegador
├── ABRIR-CLON.cmd              # Atajo de doble clic para Windows
├── serve-clone.mjs             # Servidor local manual
├── snapshot/
│   ├── dom.json
│   ├── state.json
│   └── frames/frame-N.html
├── session/session.json        # Ruta y storage no sensible
├── recording/                  # Eventos, timeline y metadatos
├── assets/
│   ├── images/ fonts/ css/ js/ video/ audio/ other/
│   └── network/
├── network/responses.json
├── screenshots/original.png
└── reports/
```

Cada entrada tiene checksum. Al importar se recalcula y se marca `ok` o `broken` sin descartar la
sesión. Las rutas se validan contra traversal.

Abrir un paquete:

```bash
# Opción 1 (recomendada): servidor en un puerto libre + navegador automático
node abrir-clon.mjs
# En Windows también puedes hacer doble clic en ABRIR-CLON.cmd

# Opción 2: servidor manual
node serve-clone.mjs . 8080
# http://127.0.0.1:8080/index.html
```

El lanzador no necesita `npm install`: solo requiere Node.js 20 o superior, ya necesario para el
servidor incluido. Escucha únicamente en `127.0.0.1` y muestra la URL si el navegador no se abre.

## Arquitectura

```text
Popup (UI) ──mensajes──► Background (service worker)
                              │  IndexedDB · fetch con host permissions · ZIP
                              ▼
Content script (frame 0 + iframes) ◄── órdenes con frameId: 0
      │
      ├─ serializador DOM/CSSOM
      ├─ captura de estado y recursos
      ├─ grabador rrweb
      └─ MAIN world: hooks de fetch/XHR, errores, SPA y media
                              │
                              ▼
                       Replay (rrweb) / paquete autónomo
```

Decisiones clave:

- **Base64** en el canal de mensajes porque Chrome serializa JSON y pierde `ArrayBuffer`.
- **Background** descarga recursos para saltarse CORS con `host_permissions`.
- **Service worker efímero**: los assets se escriben en IndexedDB y los eventos se vuelcan cada 3 s.
- **Sin `debugger`/CDP**: la red se observa con hooks en MAIN world y `webRequest` pasivo.
- **Tokens deterministas** (`__WC_ASSET_n__`, `__WC_STYLE_n__`) para serializar sin red y resolver después.

Más detalles en [`ARCHITECTURE.md`](ARCHITECTURE.md) y
[`docs/CLONACION-COMPLETA.md`](docs/CLONACION-COMPLETA.md).

## Privacidad

- Contraseñas, campos ocultos, `cc-*`, `one-time-code` y datos de pago se excluyen y se registra el
  motivo; nunca se guarda el valor.
- No se guardan cookies, `Authorization` ni credenciales en el paquete.
- El Clon Completo permite pegar una cookie **solo para autenticar la captura**; no se escribe en el
  ZIP.
- Se omiten claves de storage sensibles (`token`, `auth`, `password`, `secret`, `jwt`, `api_key`,
  tarjetas…) y se listan en `omittedKeys`.
- El HTML y la red capturados pueden contener datos visibles de la cuenta. **Revisa el ZIP antes de
  compartirlo.**
- Todo el procesamiento ocurre en el navegador; no hay telemetría ni subida de datos.

## Compatibilidad

| Capacidad | Chrome/Chromium | Firefox |
|---|---|---|
| Instant Clone | ✅ | ✅ |
| Clon dinámico + red | ✅ | ✅ (runtime no automatizado) |
| Clon Completo | ✅ | ✅ |
| Full Session Recording | ✅ | ✅ |
| Declarative Shadow DOM | 111+ | 123+ |
| Instalación | Descomprimida | Complemento temporal |
| Suite E2E | Chromium 159 | Solo `web-ext lint` |

No se pueden capturar páginas internas (`chrome://`, `about:`), PDFs nativos, la Chrome Web Store ni
iframes cross-origin. Consulta [`LIMITATIONS.md`](LIMITATIONS.md) para la lista honesta y completa.

## Desarrollo

```bash
npm install
npm run typecheck     # TypeScript estricto
npm test              # 48 tests unitarios
npm run build         # Chrome + Firefox
npm run test:e2e      # 8 tests con Chromium real
npm run package       # ZIPs en artifacts/
```

### Web del proyecto

```bash
npm --prefix website install
npm run website:dev
npm run website:test
npm run website:build
npm run website:e2e
```

La web usa React 19, Vite, TypeScript y Playwright. El build se valida con un script Node que
comprueba assets, secciones y rutas antes de publicar.

## Estructura del repositorio

```text
.
├── .github/                 # CI, Pages, release, plantillas y Dependabot
├── docs/                    # Documentación técnica y de publicación
├── scripts/                 # Build, empaquetado, servidor y validadores Node
├── src/                     # Extensión: background, content, popup, replay y shared
├── test/                    # Unitarios, E2E y fixtures deterministas
├── website/                 # Landing/documentación React + Vite
├── ARCHITECTURE.md
├── LIMITATIONS.md
├── LICENSE
└── README.md
```

## Publicación

- **CI** ejecuta typecheck, unitarios, build y E2E de la extensión y de la web.
- **Pages** construye `website/` y publica `website/dist` en GitHub Pages.
- **Release** usa las notas de `docs/releases/<tag>.md` y adjunta los ZIP de Chrome/Firefox y
  `SHA256SUMS.txt`.

La guía paso a paso, incluida la configuración de Pages y las claves, está en
[`docs/PUBLICAR.md`](docs/PUBLICAR.md).

## Licencia

MIT © 2026 D1se0. Consulta [`LICENSE`](LICENSE).
