# Cómo funciona la clonación de WebClone Ultimate

Este documento explica, paso por paso, qué hace la extensión para pasar de una pestaña real a un
paquete autónomo que se puede abrir sin la extensión y sin conexión.

La idea central es sencilla: **no se guarda una captura de pantalla ni un simple “Guardar como”**. Se
serializa el DOM vivo, se descargan y reescriben sus recursos, se conserva la red que la propia
página ha generado y se inyecta un runtime que reproduce ese estado. La extensión separa tres
productos distintos:

| Producto | Qué conserva | Para qué sirve |
|---|---|---|
| Instant Clone | El estado visual y estructural de un instante | Archivar una página tal y como se ve |
| Clon dinámico | HTML fuente, JS local y respuestas fetch/XHR observadas | Reproducir una página que se hidrata o pide datos |
| Clon Completo | Todo lo anterior + una sesión interactiva (ruta, storage y red acumulada) | Reproducir un recorrido con formularios y navegación |
| Full Session Recording | Eventos rrweb de lo que ocurrió | Ver la evolución temporal de la sesión |


---

## 1. Flujo completo, de la pestaña al paquete

```
Pestaña real
  │
  ├─ 1. El popup pide capturar (mensaje WC_CAPTURE / WC_START_FULL_CAPTURE)
  │
  ├─ 2. El background resuelve la pestaña, aplica la cookie opcional y recarga si hace falta
  │
  ├─ 3. El content script pide el documento al MAIN world
  │      └─ el MAIN world mantiene el journal de fetch/XHR y puede devolver un snapshot
  │
  ├─ 4. Se serializa el DOM (estático) o se descarga el HTML fuente (dinámico)
  │
  ├─ 5. Se descubren y descargan recursos: CSS, imágenes, fuentes, JS, media, iframes…
  │      └─ se deduplican por SHA-256 y se guardan con rutas locales
  │
  ├─ 6. Se reescriben CSS, HTML, JS, srcset, URLs de red y rutas de iframes
  │
  ├─ 7. Se inyecta el runtime offline y el estado (scroll, formularios, media, popovers)
  │
  ├─ 8. Se genera metadata.json, informes, reproductor y servidor local opcional
  │
  └─ 9. Se comprime el ZIP en memoria y se guarda en IndexedDB o se descarga
```

Cada fase es verificable por separado. El ZIP contiene `metadata.json` con el SHA-256 de cada
fichero, de modo que una importación puede detectar corrupción sin abrir la página.

---

## 2. Qué ocurre al pulsar “INSTANT CLONE”

### 2.1. El popup no captura: delega

El popup construye las opciones (`dynamic`, `captureNetwork`, `keepScripts`, `settleMs`, etc.) y
envía un mensaje al background. El background localiza la pestaña activa, comprueba que la URL es
capturable y llama al content script del **frame principal** (`frameId: 0`). Esto evita que un iframe
responda en lugar del documento que el usuario está viendo.

Si el usuario ha pegado una cookie de sesión, se aplica solo a esa pestaña y se recarga para que el
HTML del servidor se genere ya autenticado. La cookie no se escribe en la sesión ni en el ZIP.

### 2.2. Serialización del DOM

El serializador es **síncrono y determinista**: no descarga nada mientras recorre el árbol. Para cada
nodo:

- Elementos y atributos: se copian los atributos visuales y funcionales, pero se eliminan `on*`,
  `nonce`, `integrity` y otros que no deben ejecutarse en el paquete.
- CSS: cada `<style>` o `<link>` se convierte en un bloque registrado y en el HTML queda un token
  `__WC_STYLE_n__`. Las hojas same-origin se leen del **CSSOM** (`cssRules`), no solo del texto, para
  incluir reglas inyectadas por CSS-in-JS. Las hojas cross-origin se piden por red cuando es posible.
- Recursos: `src`, `srcset`, `poster`, iconos, `object` y `url()` de CSS se sustituyen por tokens
  `__WC_ASSET_n__`. Los `data:` y `blob:` se decodifican una sola vez y se deduplican.
- Shadow DOM abierto: se serializa como Declarative Shadow DOM
  (`<template shadowrootmode="open">`), incluyendo `adoptedStyleSheets`. Un shadow root cerrado no
  es accesible y se documenta como no soportado.
- Canvas 2D: se convierte a imagen con `toDataURL`. Un canvas WebGL sin
  `preserveDrawingBuffer`, o contaminado por CORS, se marca como no legible y se explica el motivo.
- iframes same-origin: se serializa el documento completo en `snapshot/frames/frame-N.html`, con su
  propio estado. Un iframe cross-origin se sustituye por un marcador y se registra el fallo.
- Formularios y media: se guarda el valor, `checked`, `selectedIndex`, tiempo, pausa, volumen y
  velocidad en `state.json`. Las contraseñas, campos ocultos y datos de pago se excluyen y solo se
  guarda el motivo.

### 2.3. Resolución de recursos

El background recibe la lista de URLs y las descarga **sin credenciales por defecto**. Cada recurso
tiene límites de tamaño y tiempo; los fallos no rompen el HTML: se conserva la URL original y se
anota el error tipificado.

El contenido se deduplica por SHA-256. Si dos URLs devuelven los mismos bytes, se guarda un único
fichero y ambas referencias apuntan a él. Después:

1. Se inlinan los `@import` de CSS (hasta cuatro niveles).
2. Se reescriben los `url()` a rutas locales; los fragmentos como `url(#gradiente)` no se tocan.
3. Se sustituyen los tokens del HTML por las rutas definitivas.
4. Se ajustan las rutas de los frames con el prefijo `../../` correcto.

### 2.4. Estado y bootstrap

`state.json` guarda viewport, scroll, formularios, elementos desplazables, `<details>`, diálogos,
popovers y media. En modo estático se eliminan los scripts de la página y se inyecta un bootstrap
propio (`CLONE_BOOTSTRAP_JS`) que aplica ese estado y desactiva navegación y envío de formularios.
Así la instantánea no puede “escaparse” a Internet ni enviar datos.

El resultado es un HTML con CSS inlinado, recursos locales, estado restaurado y un informe de
compatibilidad. El test del fixture mide **0.00 % de diferencia visual**; en protocolexplorer.org,
**0.02 %** (antialiasing de iconos y texto).

---

## 3. Modo dinámico: ejecutar el JavaScript sin red

El modo estático es fiel, pero una página que se hidrata con React/Vue puede necesitar su JS. El modo
dinámico cambia la base:

- En lugar de serializar el DOM renderizado, el background descarga el **HTML fuente** y lo procesa
  con `source-serializer.ts`. Se conservan los comentarios `<!--$-->` de React 18.
- Se conservan los `<script>` locales y se descargan; los módulos ESM se reescriben para apuntar a
  rutas locales.
- `state-capture.ts` guarda el estado por selectores CSS (formularios, scroll, media, popovers).
- El MAIN world mantiene un journal de `fetch`/XHR con método, URL, cabeceras seguras, cuerpo de
  petición y cuerpo de respuesta. Los cuerpos pequeños se incrustan en base64; los grandes o
  binarios van a `assets/network/` y se referencian desde `network/responses.json`.
- El runtime offline se inyecta **antes** que los scripts de la página. Su `fetch`/XHR busca una
  respuesta grabada por método + URL (y por ruta cuando procede). Si no la encuentra, devuelve
  **HTTP 504** y suma un `miss`. Nunca sale a Internet.
- WebSocket, EventSource, `sendBeacon`, service workers y navegación externa se bloquean y se
  registran.

La reescritura de JS (`src/shared/js-rewrite.ts`) cubre `import`, `export from`, `import()`,
`require`, `importScripts`, `new Worker` y `new URL(..., import.meta.url)`. No toca URLs externas ni
comentarios.

### Protección de hidratación

React 18/Next, Nuxt, Remix y frameworks similares pueden fallar al rehidratar un HTML serializado.
La extensión detecta marcadores de Suspense, estado SSR y bundles. Salvo que el usuario active
“Forzar JS en frameworks”, usa automáticamente la instantánea estática y lo declara en el informe.
Es preferible una página fiel y estable a una página rota con hydration mismatch.

---

## 4. Clon Completo: capturar una sesión, no solo un instante

El Clon Completo reutiliza el pipeline dinámico, pero separa el trabajo en dos fases.

### Fase A: inicio

1. El popup envía `WC_START_FULL_CAPTURE`.
2. El background crea la sesión, aplica la cookie opcional y recarga la pestaña si es necesario.
3. El content script arma los hooks del MAIN world con un journal vacío.
4. El usuario navega, rellena formularios, pulsa botones y provoca POST reales.
5. Cada `fetch`/XHR se registra con método, URL, cabeceras seguras, cuerpo de petición, estado,
   MIME, cuerpo de respuesta y duración. Se conservan **todas las ocurrencias**, no solo la última.
6. El journal se acumula en background, por lo que sobrevive a una navegación entre documentos.
   `WC_FULL_ATTACH` reengancha la sesión cuando se carga el documento nuevo.

### Fase B: finalizar y reconstruir

1. El usuario pulsa “FINALIZAR Y RECONSTRUIR”.
2. Se toma el snapshot actual: HTML fuente, assets, JS local, storage no sensible y ruta.
3. Se fusiona el journal acumulado y se escribe `network/responses.json`.
4. Se escribe `session/session.json` y un `<script id="wc-session">` con ruta, storage,
   navegaciones e interacciones.
5. El runtime restaura el storage y la ruta con `history.replaceState` (solo en el documento
   superior y nunca en `file://`).
6. Cada petición nueva busca una ocurrencia por método + URL + cuerpo y mantiene un cursor para
   peticiones repetidas. Una petición no observada devuelve 504.

Esto es lo que permite que un POST repetido reciba la respuesta correcta y que la aplicación siga
funcionando offline. **No se simula el backend**: se reproducen las respuestas observadas. Un
servidor que calcule algo nuevo no se puede inventar.

### Límites reales

- El journal vive en memoria del service worker. MV3 puede descargarlo; el content script conserva
  el documento actual, pero no garantiza todo el histórico si el worker se reinicia en mitad de una
  navegación.
- Las respuestas son deterministas. Las peticiones nuevas no existen en el manifiesto y dan 504.
- El estado interno de un store de React/Vue no viaja en el HTML. Se conserva el DOM resultante y el
  estado de formularios/scroll/media, no el árbol de componentes.
- WebSocket y SSE no se convierten en un flujo bidireccional offline.

---

## 5. Grabación de sesión (rrweb)

La grabación es un producto distinto del clon. `@rrweb/record` captura snapshots incrementales,
mutaciones, scroll, clics, formularios, canvas y media. Los eventos se guardan en memoria y se
vuelcan al background en trozos cada 3 segundos; el background los almacena en IndexedDB y genera
`recording/events.json`, `timeline.json` y `meta.json`.

Al exportar, las URLs de los eventos se reescriben a recursos locales. `replay.html` monta el
reproductor con rrweb y la línea temporal. La grabación **reconstruye lo observado**, no ejecuta la
aplicación.

---

## 6. Estructura del ZIP y por qué cada pieza está ahí

```
webclone-export/
├── index.html                     # entrada del clon o reproductor
├── replay.html                    # reproductor rrweb
├── metadata.json                  # SHA-256 por fichero, contadores y privacidad
├── README.html                    # guía del paquete
├── abrir-clon.mjs                 # lanzador: puerto libre + navegador
├── ABRIR-CLON.cmd                 # doble clic en Windows
├── serve-clone.mjs                # servidor estático manual
├── snapshot/
│   ├── dom.json                   # snapshot serializado
│   ├── state.json                 # scroll, formularios, media, canvas, popovers
│   └── frames/frame-N.html        # iframes same-origin
├── session/session.json           # ruta, storage e interacciones del Clon Completo
├── recording/                     # eventos, timeline y metadatos de rrweb
├── assets/
│   ├── images/ fonts/ css/ js/ video/ audio/ other/
│   └── network/                   # cuerpos de red no incrustados
├── network/responses.json         # manifiesto fetch/XHR
├── screenshots/original.png       # captura de la pestaña
└── reports/                       # capture-report.json y compatibilidad
```

`metadata.json` permite verificar la integridad en la importación: se recalcula el SHA-256 de cada
entrada y se marca `ok` o `broken` sin descartar la sesión. Las rutas se validan contra traversal
(`..`, rutas absolutas).


---

---

## 7. Seguridad y privacidad del paquete

Protege:

- Contraseñas, campos ocultos y datos de pago: se excluyen y se registra el motivo; nunca se guarda el valor.
- Cookies, `Authorization` y credenciales: no se escriben en la sesión ni en el ZIP.
- Claves de storage sensibles: se omiten y se listan en `omittedKeys`.
- URLs de informe: se eliminan tokens, firmas y userinfo.
- Integridad: cada entrada lleva SHA-256 y CRC-32; la importación recalcula los hashes.

No protege:

- El HTML y las respuestas capturadas pueden contener datos visibles de la cuenta. Revisa el ZIP antes de compartirlo.
- El navegador pertenece al usuario: puede inspeccionar su propio DOM, storage o descargas.
- DRM, same-origin policy y lógica de backend no se eluden.

---

## 8. Cómo reproducirlo desde cero

```bash
npm install
npm run build
npm run typecheck
npm test
npm run test:e2e
```

El fixture determinista vive en `test/fixtures/site`. Los tests E2E cargan `dist/chrome` en Chromium y
comparan el clon con el original; los artefactos quedan en `reports/`.

### Recorrido manual recomendado

1. Captura el fixture y observa el informe de recursos.
2. Abre el ZIP con `node abrir-clon.mjs` (o `serve-clone.mjs` si necesitas el puerto manual).
3. Repite con el modo dinámico y comprueba `network/responses.json`.
4. Inicia un Clon Completo, envía un formulario y navega antes de finalizar.
5. Graba una sesión y revisa el timeline del reproductor exportado.

---

---

## 9. Preguntas frecuentes

**¿La clonación es “perfecta”?**
Es fiel al DOM, CSS, recursos y estado observados. Los tests del fixture dan 0.00 % de diferencia
visual y 0.02 % en protocolexplorer.org por antialiasing. No puede conservar estado interno de un
framework ni un backend que calcule respuestas nuevas.

**¿Por qué una petición devuelve 504?**
Porque no se observó durante la captura. El runtime es determinista: no inventa un backend y nunca
abre una conexión real.

**¿Puedo abrir el clon sin la extensión?**
Sí. El ZIP incluye `index.html`, `abrir-clon.mjs`, `serve-clone.mjs` y todos los recursos. Para
módulos ESM usa el lanzador automático; para scripts clásicos también funciona `file://`.

**¿Se guarda la cookie de sesión de la captura?**
No se guarda en la sesión, el storage ni el ZIP. Se usa solo durante la captura. El HTML y las
respuestas capturadas pueden contener datos visibles de la cuenta; revísalos antes de compartir.

**¿Funciona en Firefox?**
Sí, con las diferencias de manifiesto y hooks documentadas. La suite E2E automatiza Chromium; Firefox
se valida con `web-ext lint` y se prueba manualmente.
