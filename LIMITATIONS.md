# Limitaciones técnicas — WebClone Ultimate

Este documento separa lo que **no se puede** hacer por restricciones del navegador de lo que
**no se ha implementado** por alcance. Nada de lo listado se presenta como funcionalidad terminada.

## Instant Clone

| Limitación | Motivo real | Qué hace la extensión |
|---|---|---|
| En modo estático la página clonada no ejecuta su JavaScript | Es el modo seguro y el fallback de hidratación | Se eliminan los `<script>`; un bootstrap propio restaura estado (scroll, formularios, media, popovers). El modo dinámico sí ejecuta JS local |
| Cambios posteriores al instante de captura no aparecen | Es una instantánea | Para eso existe Full Session Recording |
| El estado interno de frameworks (React/Vue/Angular/Svelte) no se conserva | El árbol de componentes y el estado de la app viven en la memoria del framework | Se conserva el **DOM resultante**, el CSSOM y los valores de formulario; los componentes que no han renderizado nada no existen en el DOM |
| Iframes de origen cruzado no se serializan | Same-origin policy: `contentDocument` es inaccesible | Se sustituyen por un marcador, se conserva la URL original saneada y se registra el fallo con alternativa |
| Shadow DOM cerrado (`mode: 'closed'`) no se captura | No hay referencia accesible al root | Los abiertos se serializan como Declarative Shadow DOM |
| Canvas WebGL puede salir en blanco | `preserveDrawingBuffer` se fija al crear el contexto; no se puede activar después | Se captura 2D; WebGL se marca `unsupported` con motivo y se recomienda grabar con rrweb |
| Canvas contaminado por CORS no se puede leer | `toDataURL` lanza `SecurityError` | Se registra como fallo; no se inventa contenido |
| `input[type=file]` no se restaura | El navegador no expone la ruta ni los bytes del archivo | Se registra `excludedReason` |
| Contraseñas, campos ocultos y datos de pago se excluyen | Privacidad por diseño | Se guarda el motivo, nunca el valor; el campo queda vacío |
| Las cookies no se guardan en el paquete | Privacidad: no se exporta la cookie ni el storage sensible | El Instant Clone descarga sin credenciales por defecto; el Clon Completo permite importar una cookie, la usa para el HTML/server functions y no la escribe en la sesión ni en el ZIP |
| Vídeo/audio con DRM o autenticación no se captura | DRM y tokens no se eluden | Se registra el fallo; el clon conserva `<video>`/`<audio>` y la posición observada |
| HLS/DASH no se reconstruyen | Requiere descargar y recomponer segmentos (FFmpeg) y respetar la autorización del sitio | Se capturan manifiestos accesibles si están permitidos; no se descargan segmentos |
| Las animaciones CSS se reproducen desde el inicio, no desde el fotograma exacto | El CSS capturado define keyframes; el tiempo de animación pertenece al navegador y no se congela con el DOM | El Clon Completo conserva y ejecuta la animación (comprobado `playState=running`); la fase visual puede diferir |
| Fuentes locales y CSP estricta pueden necesitar servidor | `file://` restringe fuentes y algunos recursos | El ZIP incluye `abrir-clon.mjs` (servidor + navegador) y `serve-clone.mjs`; la apertura directa se verificó con fuentes del sistema |
| Ancho/alto del viewport distinto al de captura cambia el layout | El clon es responsive como el original | Se registra resolución y DPR en el informe |

## Clon dinámico y red

| Limitación | Motivo real | Qué hace la extensión |
|---|---|---|
| React 18/Next, Nuxt, Remix y frameworks similares pueden fallar al rehidratar | El HTML serializado no reproduce el estado interno ni el orden exacto de hidratación; React lanza hydration mismatch y puede vaciar la vista | Se detectan marcadores y bundles; se usa la instantánea estática automáticamente y se explica en el informe. «Forzar JS en frameworks» permite intentarlo, sin garantía |
| Solo se capturan cuerpos de respuestas `fetch`/XHR observadas | Los hooks se instalan al iniciar la captura; no hay acceso retroactivo a peticiones anteriores ni a cuerpos de navegaciones ya completadas | El Clon Completo mantiene el journal armado durante la sesión, acumula ocurrencias en background y guarda cuerpos de texto/JSON/binarios; las peticiones no capturadas responden 504 offline |
| Las respuestas POST son deterministas, no un backend vivo | No hay servidor ni base de datos del sitio; una respuesta capturada no puede calcular el siguiente estado de una operación | Se conservan método, URL, cuerpo de petición y respuesta por ocurrencia; peticiones nuevas dan 504 y se cuentan en `misses` |
| El journal de sesión vive en memoria del service worker | MV3 puede descargar el worker; el content script conserva el del documento actual, pero no todo el histórico | El popup recupera la sesión activa y `tabs.onUpdated` reengancha; para una garantía total, evita reiniciar el worker en mitad de una navegación |
| WebSocket, EventSource, `sendBeacon` y service workers no funcionan en el clon | No hay servidor ni canal bidireccional offline; un SW podría intentar red real | El runtime los bloquea y los registra; la UI capturada se conserva, los datos en vivo no |
| Los módulos ESM requieren el servidor local incluido | `file://` aplica CORS y los módulos no se cargan desde el sistema de ficheros | `abrir-clon.mjs` sirve el paquete por HTTP y abre el navegador; `serve-clone.mjs` permite elegir puerto manualmente. Los scripts clásicos sí funcionan desde `file://` |
| El clon dinámico no reproduce estado interno ni lógica no observable | Solo se ejecuta el JS descargado y las respuestas grabadas; el estado de un store en memoria no viaja en el HTML | Se conserva el DOM/HTML y el estado de formularios, scroll y media; para la evolución temporal se usa Full Session Recording |
| `Forzar JS en frameworks` puede producir una página rota | La hidratación no es determinista fuera de su entorno | Es una opción avanzada y explícita; el modo automático prioriza fidelidad visual |

## Clon Completo

| Limitación | Motivo real | Qué hace la extensión |
|---|---|---|
| No reconstruye el estado interno de un framework | El store y el árbol de componentes no son serializables desde el DOM | Conserva HTML fuente, JS, red, ruta y storage; si detecta hidratación usa fallback estático. No se declara interactivo en React 18 |
| Un backend que cambia con cada POST no se simula | Offline no hay servidor ni lógica de negocio | Reproduce la respuesta observada por método+URL+cuerpo; las peticiones no vistas reciben 504 |
| La restauración de storage omite claves sensibles | Privacidad: tokens, cookies, auth, password, secret, jwt, api_key, tarjetas… | Se listan en `omittedKeys` y no se escriben en el ZIP |
| El clon autenticado puede contener datos visibles de la cuenta | La captura reproduce el HTML y la red observados, incluido el contenido al que accedió la sesión | La cookie no se guarda, pero el nombre, correo, avatar y respuestas privadas pueden aparecer en el HTML/ZIP; revísalo antes de compartirlo |
| La ruta se restaura con `history.replaceState` | El paquete se sirve en `/index.html`, no en el dominio original | Se aplica solo al documento superior y se omite en `file://`; los iframes mantienen su URL local |
| Navegar fuera del sitio o recargar antes de finalizar puede dejar la sesión incompleta | No se capturan documentos de otros orígenes ni peticiones posteriores al cierre | El journal se reengancha en el mismo tab; finaliza antes de salir del sitio |
| WebSocket/SSE no se convierten en un flujo offline | No hay canal bidireccional | Se bloquean y se registran; los datos ya renderizados permanecen |

## Full Session Recording

| Limitación | Motivo | Alternativa |
|---|---|---|
| Reconstrúyelo lo observado, no la lógica de la app | rrweb graba mutaciones y eventos, no ejecuta la aplicación | Instant Clone + grabación cubren el estado y su evolución |
| Iframes de origen cruzado no se graban por defecto | rrweb necesita acceso al documento; el sitio debe cooperar | `recordCrossOriginIframes` existe, pero depende del sitio |
| La grabación no guarda cuerpos de respuesta HTTP | No se usa `chrome.debugger`/CDP para no pedir ese permiso; el journal de cuerpos es del Instant Clone dinámico, no del grabador rrweb | Se registran URL, método, estado y duración; para cuerpos, usar el clon dinámico |
| Posible pérdida de hasta 3 s | Los eventos se vuelcan cada 3 s para no bloquear la página | Si la pestaña se cierra, se guarda una sesión `partial` con lo recibido |
| `maxEvents` y `maxDurationMs` limitan la grabación | Evitar agotar memoria | Configurables; al superarse se anota en el informe |
| Canvas WebGL puede no registrarse | Contexto no legible | Se avisa en el informe; `recordCanvas` puede desactivarse |
| La reproducción no es una grabación de pantalla | Es reconstrucción estructural | Para vídeo literal, usar herramientas de captura de pantalla |


## Empaquetado y reproducción

| Limitación | Detalle |
|---|---|
| ZIP en memoria + base64 | El canal de mensajes de Chrome es JSON; base64 añade ~33 %. Sesiones de decenas de MB funcionan; por encima del límite práctico del canal la exportación puede fallar |
| `metadata.json` no incluye el tamaño comprimido del ZIP | Se conoce después de comprimir; el popup muestra el tamaño final |
| Reproducción de audio/vídeo | Puede requerir gesto del usuario por la política de autoplay |
| Enlaces y formularios desactivados en el clon estático | Evitan que la instantánea navegue fuera o envíe datos |
| En el clon dinámico la navegación externa y los envíos de formulario se bloquean | No deben escapar del paquete ni depender de la red | El JS local sí se ejecuta; `fetch`/XHR solo responde desde el manifiesto y el resto da 504 |
| `python3` y `unzip` solo para validar | No son necesarios para usar la extensión ni para abrir el paquete |

## Diferencias entre navegadores

| Capacidad | Chrome/Chromium | Firefox |
|---|---|---|
| Captura y grabación | Sí | Sí (no automatizado en esta suite) |
| Hooks de red/navegación en MAIN world | Sí (content script `world: MAIN` en `document_start`) | Se inyectan al iniciar la captura con `scripting.executeScript`; el runtime no está cubierto por tests automáticos |
| Declarative Shadow DOM | 111+ | 123+ |
| Instalación | Descomprimida | Complemento temporal (se pierde al cerrar) |
| `web-ext lint` | No aplica | 0 errores, 9 warnings: 7 de `innerHTML` en código propio, 1 de `data_collection_permissions` y 1 de API no soportada |

## Páginas no capturables

- `chrome://`, `edge://`, `about:`, `view-source:` y páginas internas del navegador: sin content script.
- Chrome Web Store y algunas páginas con políticas especiales.
- PDFs y visores nativos integrados.
- Páginas con `X-Frame-Options`/CSP que impidan insertar contenido: aplica a iframes, no al documento
  superior.

## Lo que no se hace (por decisión de alcance)

- No se usa CDP/`chrome.debugger` (evita un permiso intrusivo; no hay HAR completo). Los cuerpos
  disponibles son los de `fetch`/XHR observados por los hooks, no los de todas las peticiones.
- No se usa FFmpeg ni se reempaquetan streams.
- No se implementa sincronización en la nube ni compartición.
- No se almacenan cookies, `Authorization` ni credenciales en el paquete. El Instant Clone no guarda
  storage; el Clon Completo permite importar una cookie solo para autenticar la captura y guarda
  `localStorage`/`sessionStorage` con claves no sensibles, declarándolo en `session/session.json` y
  `metadata.json`. El HTML y las respuestas capturadas pueden contener datos privados de la cuenta.
- No se reproduce el estado interno de frameworks ni se ejecuta código que no estuviera en la página
  o en sus recursos capturados.
