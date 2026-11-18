export type Phase = {
  label: string;
  detail: string;
  meta: string;
};

export type Capability = {
  id: 'instant' | 'dynamic' | 'full' | 'record';
  eyebrow: string;
  title: string;
  short: string;
  description: string;
  bullets: string[];
  snippet: string;
  accent: string;
  stat: string;
  statLabel: string;
};

export type Example = {
  id: string;
  label: string;
  title: string;
  description: string;
  language: string;
  code: string;
};

export type ZipNode = {
  id: string;
  path: string;
  kind: 'folder' | 'html' | 'json' | 'js' | 'asset';
  label: string;
  description: string;
  content: string;
};

export type DocArticle = {
  id: string;
  title: string;
  kicker: string;
  paragraphs: string[];
  code?: { label: string; value: string };
  points?: string[];
};

export type CompatRow = {
  feature: string;
  chrome: string;
  firefox: string;
  note: string;
};

export type FaqItem = {
  question: string;
  answer: string;
};

export const NAV_ITEMS = [
  { id: 'laboratorio', label: 'Laboratorio' },
  { id: 'capacidades', label: 'Capacidades' },
  { id: 'pipeline', label: 'Motor' },
  { id: 'ejemplos', label: 'Ejemplos' },
  { id: 'formato', label: 'Formato' },
  { id: 'docs', label: 'Documentación' },
  { id: 'compatibilidad', label: 'Compatibilidad' },
];

export const PHASES: Phase[] = [
  {
    label: 'Serializando el DOM',
    detail: 'Nodos, CSSOM, formularios, scroll, canvas y shadow DOM.',
    meta: '04.504 nodos',
  },
  {
    label: 'Resolviendo recursos',
    detail: 'Imágenes, fuentes y hojas de estilo, deduplicadas por SHA-256.',
    meta: '36 assets',
  },
  {
    label: 'Capturando la red',
    detail: 'Respuestas fetch/XHR y journal de una sesión interactiva.',
    meta: '0 requests externas',
  },
  {
    label: 'Empaquetando el ZIP',
    detail: 'Checksums, reproductor autónomo y servidor local incluido.',
    meta: '1.26 MB',
  },
];

export const CAPABILITIES: Capability[] = [
  {
    id: 'instant',
    eyebrow: '01 · Instant Clone',
    title: 'Un instante, con toda su textura.',
    short: 'La página tal y como la ves.',
    description:
      'Serializa el DOM vivo y el CSSOM, conserva el estado de los formularios, el scroll, los canvas y los shadow roots abiertos. El resultado se abre sin la extensión y sin red.',
    bullets: [
      'DOM, CSS inyectado y recursos locales',
      'Formularios, scroll, media, details, dialogs y popovers',
      'Iframes same-origin y canvas 2D',
      'Contraseñas y datos de pago excluidos por diseño',
    ],
    snippet: `const clone = await chrome.runtime.sendMessage({
  type: 'WC_START_CAPTURE',
  tabId,
  options: { dynamic: false, captureAssets: true }
});`,
    accent: 'lime',
    stat: '0.00%',
    statLabel: 'diferencia visual en el fixture',
  },
  {
    id: 'dynamic',
    eyebrow: '02 · Dynamic Clone',
    title: 'El JavaScript sigue vivo. La red, no.',
    short: 'JS local y respuestas grabadas.',
    description:
      'Parte del HTML fuente, conserva los scripts y captura las respuestas fetch/XHR observadas. El runtime las sirve desde el paquete; lo que no se capturó devuelve 504 y nunca sale a Internet.',
    bullets: [
      'Módulos ESM e imports reescritos',
      'Journal por método, URL y cuerpo',
      'WebSocket, SSE y service workers bloqueados',
      'Fallback automático si detecta hidratación incompatible',
    ],
    snippet: `// El runtime offline responde desde el paquete
const res = await fetch('/api/products');
// Si no fue observado: HTTP 504, misses += 1
// Nunca se abre una conexión real.`,
    accent: 'cyan',
    stat: '504',
    statLabel: 'respuesta segura para lo no capturado',
  },
  {
    id: 'full',
    eyebrow: '03 · Full Clone',
    title: 'Una sesión completa, no una foto.',
    short: 'Ruta, storage y POST offline.',
    description:
      'Inicia la captura, interactúa con la aplicación y finaliza. El paquete arranca en la ruta y el storage capturados, y reproduce los POST que generaste, incluso después de navegar.',
    bullets: [
      'Journal acumulado entre documentos',
      'Método, URL, request body y response body',
      'localStorage/sessionStorage no sensible',
      'Reenganche al cargar una nueva página',
    ],
    snippet: `# El paquete reconstruye la sesión
node serve-clone.mjs ./full-clone 8080
# abre http://127.0.0.1:8080/index.html
# ruta: /dynamic.html?step=2
# storage: wc-full-count=2`,
    accent: 'coral',
    stat: '2 POST',
    statLabel: 'reproducidos sin backend',
  },
  {
    id: 'record',
    eyebrow: '04 · Session Recording',
    title: 'La evolución también se conserva.',
    short: 'Eventos, timeline y reproductor.',
    description:
      'rrweb registra mutaciones, clics, scroll, formularios, navegación SPA y errores. Al detener, los recursos se resuelven y el reproductor exportado funciona sin la extensión.',
    bullets: [
      'Timeline con marcas de navegación y error',
      'Velocidades 0.25×–4× y salto temporal',
      'Errores, consola y red en el inspector',
      'Volcado incremental para no bloquear la página',
    ],
    snippet: `# Exporta una grabación y ábrela
node serve-clone.mjs ./recording 8080
# replay.html incluye rrweb y los eventos
# sin CDN, sin red y sin la extensión`,
    accent: 'violet',
    stat: '11',
    statLabel: 'eventos en la prueba de referencia',
  },
];

export const PIPELINE = [
  {
    id: 'capture',
    number: '01',
    title: 'Capturar',
    summary: 'El popup delega en el background y el content script del frame principal.',
    detail:
      'Se evita que un iframe responda en lugar del documento superior. Si hay cookie de sesión, se aplica solo a esa pestaña y se recarga para que el HTML del servidor se genere autenticado.',
    output: `WC_START_CAPTURE
  tabId: 42
  frameId: 0
  dynamic: true
  settleMs: 1200`,
  },
  {
    id: 'serialize',
    number: '02',
    title: 'Serializar',
    summary: 'DOM vivo, CSSOM y estado, sin descargar nada durante el recorrido.',
    detail:
      'Los recursos se sustituyen por tokens deterministas. Las hojas same-origin se leen del CSSOM para incluir CSS-in-JS; los data: y blob: se decodifican una sola vez.',
    output: `__WC_STYLE_1__
__WC_ASSET_1__
__WC_ASSET_2__
data-wc-id="f3a9"`,
  },
  {
    id: 'resolve',
    number: '03',
    title: 'Resolver',
    summary: 'El background descarga con permisos de host y deduplica por contenido.',
    detail:
      'Cada recurso se guarda con su hash. Los fallos se registran con URL saneada, tipo, motivo, restricción y alternativa; nunca se convierten en un éxito silencioso.',
    output: `assets/images/a3f1.webp
assets/css/bf1e.css
assets/js/5dd9.js
sha256: 9c2e…`,
  },
  {
    id: 'replay',
    number: '04',
    title: 'Reconstruir',
    summary: 'Runtime offline, estado y reproductor dentro de un ZIP verificable.',
    detail:
      'El paquete incluye metadata con SHA-256 por fichero, informe de compatibilidad, README y un servidor estático opcional para módulos ESM.',
    output: `index.html
metadata.json
network/responses.json
serve-clone.mjs
reports/capture-report.json`,
  },
];

export const EXAMPLES: Example[] = [
  {
    id: 'build',
    label: 'Instalar',
    title: 'De cero a la extensión cargada',
    description:
      'Clona, instala, compila y carga dist/chrome desde chrome://extensions. El mismo build genera Firefox.',
    language: 'bash',
    code: `git clone https://github.com/D1se0/webclone-ultimate.git
cd webclone-ultimate
npm install
npm run build

# Chrome: chrome://extensions → Cargar descomprimida → dist/chrome
# Firefox: about:debugging → Cargar complemento → dist/firefox/manifest.json`,
  },
  {
    id: 'package',
    label: 'Empaquetar',
    title: 'Artefactos listos para distribuir',
    description:
      'Genera los ZIP de Chrome y Firefox y valida que el manifiesto y los bundles existen.',
    language: 'bash',
    code: `npm run package
# artifacts/webclone-ultimate-chrome-1.2.0.zip
# artifacts/webclone-ultimate-firefox-1.2.0.zip

npx web-ext lint --source-dir dist/firefox
# 0 errores · 0 notices`,
  },
  {
    id: 'serve',
    label: 'Abrir',
    title: 'Abrir un clon sin la extensión',
    description:
      'Los scripts clásicos funcionan desde file://. Para módulos ESM, usa el servidor incluido en el ZIP.',
    language: 'bash',
    code: `# Opción directa
open index.html

# Módulos ESM y rutas SPA
node serve-clone.mjs . 8080
# http://127.0.0.1:8080/index.html

# Validación independiente
node scripts/validate-zip.mjs paquete.zip`,
  },
  {
    id: 'api',
    label: 'Mensajes',
    title: 'La API interna del popup',
    description:
      'La UI habla con el background mediante mensajes. Este es el contrato que usan los tests E2E.',
    language: 'ts',
    code: `const status = await chrome.runtime.sendMessage({
  type: 'WC_GET_TAB_STATUS',
  tabId
});

if (status.progress?.phase === 'done') {
  const session = await chrome.runtime.sendMessage({
    type: 'WC_SESSION_GET',
    id: status.sessionId
  });
}`,
  },
  {
    id: 'test',
    label: 'Verificar',
    title: 'La suite que respalda cada afirmación',
    description:
      'TypeScript estricto, 48 unitarios, 8 E2E reales y validación externa del ZIP con Python y unzip.',
    language: 'bash',
    code: `npm run typecheck
npm test
npm run test:e2e
npm run validate:zip -- reports/out/fixture-clone.zip

npm --prefix website test
npm --prefix website run build
npm --prefix website run test:e2e`,
  },
];

export const ZIP_NODES: ZipNode[] = [
  {
    id: 'index',
    path: 'index.html',
    kind: 'html',
    label: 'El clon',
    description:
      'Documento autónomo. Incluye el estado capturado, el CSS resuelto y el runtime offline cuando corresponde.',
    content: `<!doctype html>
<html data-wc-ready="true" data-wc-dynamic="true">
  <head>
    <style>/* CSS resuelto y reescrito */</style>
    <script id="wc-network">
      window.__webcloneDynamic = { misses: [], served: 0 };
    </script>
  </head>
  <body>
    <!-- DOM serializado + bootstrap de estado -->
  </body>
</html>`,
  },
  {
    id: 'metadata',
    path: 'metadata.json',
    kind: 'json',
    label: 'La prueba de integridad',
    description:
      'Declara herramienta, versión, privacidad y SHA-256 de cada entrada. La importación recalcula los hashes.',
    content: `{
  "tool": { "name": "WebClone Ultimate", "version": "1.2.0" },
  "privacy": {
    "localOnly": true,
    "cookiesStored": false,
    "credentialsIncluded": false
  },
  "files": [
    {
      "path": "index.html",
      "bytes": 30565,
      "sha256": "9c2e…",
      "crc32": "41af…"
    }
  ]
}`,
  },
  {
    id: 'network',
    path: 'network/responses.json',
    kind: 'json',
    label: 'La red congelada',
    description:
      'Journal de respuestas observadas. El runtime elige por método, URL y cuerpo, y mantiene un cursor para repetidas.',
    content: `{
  "responses": [
    {
      "method": "POST",
      "url": "/api/session-add.json",
      "status": 200,
      "mime": "application/json",
      "requestBodyInlined": true,
      "body": "{\\"label\\":\\"Servidor · dos\\",\\"ok\\":true}"
    }
  ]
}`,
  },
  {
    id: 'state',
    path: 'snapshot/state.json',
    kind: 'json',
    label: 'El estado restaurado',
    description:
      'Scroll, formularios, media, details, dialogs, popovers y canvas. Los campos sensibles guardan el motivo, nunca el valor.',
    content: `{
  "viewport": { "width": 1280, "height": 800, "scrollY": 400 },
  "forms": [
    { "selector": "#nombre", "value": "Ada Lovelace" },
    { "selector": "#clave", "excludedReason": "password" }
  ],
  "media": [{ "selector": "audio", "time": 2.4, "paused": true }]
}`,
  },
  {
    id: 'session',
    path: 'session/session.json',
    kind: 'json',
    label: 'La sesión interactiva',
    description:
      'Ruta y storage no sensible del Clon Completo. Las claves sensibles se omiten y se listan.',
    content: `{
  "route": "/dynamic.html?step=2",
  "storage": {
    "local": { "wc-full-count": "2" },
    "session": {}
  },
  "omittedKeys": ["token", "auth", "password", "secret", "jwt"]
}`,
  },
  {
    id: 'replay',
    path: 'replay.html',
    kind: 'html',
    label: 'El reproductor',
    description:
      'Contiene los eventos rrweb y carga el bundle local. Timeline, velocidades y salto temporal sin CDN.',
    content: `<!doctype html>
<html>
  <body>
    <div id="player"></div>
    <script>window.__WC_EVENTS__ = [/* eventos rrweb */];</script>
    <script src="assets/js/wc-replay.js"></script>
  </body>
</html>`,
  },
  {
    id: 'report',
    path: 'reports/capture-report.json',
    kind: 'json',
    label: 'La verdad del informe',
    description:
      'Contadores, bytes, fallos tipificados, capacidades no soportadas y motivo del fallback de hidratación.',
    content: `{
  "counts": {
    "elements": 4504,
    "assetsCaptured": 36,
    "assetsFailed": 0,
    "scriptsKept": 0,
    "responsesCaptured": 0
  },
  "unsupported": [
    "Framework de hidratación detectado; se usó la instantánea estática."
  ],
  "fidelity": { "visualDiff": 0.0002 }
}`,
  },
  {
    id: 'server',
    path: 'serve-clone.mjs',
    kind: 'js',
    label: 'Cero dependencias',
    description:
      'Servidor estático de Node que sirve el paquete con MIME correctos y fallback SPA. No necesita instalar nada.',
    content: `import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// Sirve index.html, assets y módulos ESM
// con MIME correctos y fallback para rutas SPA.
const server = createServer(async (req, res) => {
  // …
});
server.listen(8080, '127.0.0.1');`,
  },
];

export const DOC_ARTICLES: DocArticle[] = [
  {
    id: 'instalar',
    title: 'Instalar en el navegador',
    kicker: 'Empieza aquí',
    paragraphs: [
      'Clona el repositorio, instala las dependencias y ejecuta el build. Se generan dos carpetas independientes: dist/chrome con service worker y dist/firefox con background.scripts y gecko id.',
      'En Chrome, activa el modo de desarrollador y carga dist/chrome como extensión descomprimida. En Firefox, abre about:debugging y selecciona dist/firefox/manifest.json como complemento temporal.',
    ],
    code: {
      label: 'terminal',
      value: `git clone https://github.com/D1se0/webclone-ultimate.git
cd webclone-ultimate
npm install
npm run build
# chrome://extensions → Cargar descomprimida → dist/chrome`,
    },
    points: [
      'Node.js 20+; probado con 22 y 26.',
      'Chrome/Chromium 116+ o Firefox 128+.',
      'Firefox pierde el complemento temporal al cerrar.',
    ],
  },
  {
    id: 'capturar',
    title: 'Capturar una página',
    kicker: 'Uso diario',
    paragraphs: [
      'Abre la página, pulsa el icono y elige INSTANT CLONE. La barra muestra las fases reales: serialización, recursos, red y empaquetado. Al terminar, la sesión aparece en Sessions.',
      'El modo estático es el más fiel y seguro para archivar. El modo dinámico conserva los scripts locales y reproduce las respuestas fetch/XHR que la página generó durante la captura.',
    ],
    code: {
      label: 'ajustes recomendados',
      value: `captureAssets: true
captureCanvas: true
captureFrames: true
dynamic: true
captureNetwork: true
settleMs: 1200`,
    },
    points: [
      'Los campos password y de pago nunca se guardan.',
      'Un iframe cross-origin se marca como no capturado, no se inventa.',
      'El informe explica cada fallo y su alternativa.',
    ],
  },
  {
    id: 'sesion',
    title: 'Clon Completo y grabación',
    kicker: 'Cuando la página evoluciona',
    paragraphs: [
      'El Clon Completo está pensado para un recorrido: inicias, interactúas, navegas y finalizas. Conserva la ruta, el storage no sensible y todas las ocurrencias de red observadas, incluidos POST con cuerpo.',
      'Full Session Recording graba la evolución con rrweb. El reproductor exportado incluye timeline, eventos, errores, red y controles de velocidad, sin depender de la extensión ni de un CDN.',
    ],
    code: {
      label: 'flujo',
      value: `1. CLON COMPLETO
2. interactúa / envía formularios / navega
3. FINALIZAR Y RECONSTRUIR
4. descarga el ZIP
5. node serve-clone.mjs . 8080`,
    },
    points: [
      'La cookie de sesión se usa solo durante la captura y no se exporta.',
      'Las peticiones no observadas devuelven 504 y se cuentan como misses.',
      'El journal vive en el service worker; finaliza antes de salir del sitio.',
    ],
  },
  {
    id: 'privacidad',
    title: 'Privacidad y datos',
    kicker: 'Qué se guarda y qué no',
    paragraphs: [
      'La extensión procesa todo en local. No hay telemetría, no hay subida de capturas y no se guardan cookies, Authorization ni contraseñas en el paquete.',
      'El HTML y las respuestas capturadas pueden contener datos visibles de la cuenta: nombre, correo, avatar o contenido privado. El ZIP es tan sensible como la página que capturaste; revísalo antes de compartirlo.',
    ],
    code: {
      label: 'metadata.json',
      value: `"privacy": {
  "localOnly": true,
  "cookiesStored": false,
  "credentialsIncluded": false
}`,
    },
    points: [
      'Claves de storage sensibles omitidas y listadas.',
      'URLs de informe saneadas: tokens, firmas y userinfo fuera.',
      'Sin servidor, sin cuenta y sin telemetría.',
    ],
  },
  {
    id: 'limites',
    title: 'Límites que debes conocer',
    kicker: 'Ingeniería honesta',
    paragraphs: [
      'Un clon no es un backend vivo. Las respuestas POST se reproducen de forma determinista; una petición nueva que no se observó devuelve 504. WebSocket, EventSource y service workers se bloquean por diseño.',
      'React 18/Next y frameworks similares pueden fallar al rehidratar. El modo automático detecta marcadores y usa la instantánea estática para no entregar una vista rota. Forzar JS es una opción avanzada.',
    ],
    code: {
      label: 'respuesta offline',
      value: `HTTP/1.1 504 Gateway Timeout
x-webclone: not-captured
// No se abre ninguna conexión real.`,
    },
    points: [
      'Iframes cross-origin no son accesibles por same-origin policy.',
      'Canvas WebGL puede no ser legible; canvas 2D sí.',
      'Las animaciones se ejecutan desde el inicio, no desde el fotograma exacto.',
    ],
  },
  {
    id: 'problemas',
    title: 'Solución de problemas',
    kicker: 'Diagnóstico',
    paragraphs: [
      'El Capture Inspector es la primera parada: muestra qué se capturó, qué falló y por qué. El informe de compatibilidad del ZIP conserva esa información para revisarla después.',
      'Si faltan estilos o imágenes, revisa CORS, autenticación y límites de tamaño. Si el clon dinámico falla, prueba el modo estático o el fallback automático antes de forzar JS.',
    ],
    code: {
      label: 'validar el paquete',
      value: `node scripts/validate-zip.mjs paquete.zip
# python3 zipfile: CRC-32 válido
# unzip -t: No errors detected
# metadata.json: checksums SHA-256`,
    },
    points: [
      'Un ZIP incompleto se detecta al importar y se marca broken.',
      'Los módulos ESM necesitan serve-clone.mjs, no file://.',
      'El reproductor requiere que el ZIP se haya descomprimido completo.',
    ],
  },
];

export const COMPATIBILITY: CompatRow[] = [
  {
    feature: 'Instant Clone',
    chrome: 'Completo',
    firefox: 'Completo',
    note: 'DOM, CSSOM, estado, canvas 2D y shadow DOM abierto.',
  },
  {
    feature: 'Clon dinámico',
    chrome: 'Completo',
    firefox: 'Completo',
    note: 'Firefox inyecta los hooks al iniciar; runtime no automatizado.',
  },
  {
    feature: 'Clon Completo',
    chrome: 'Completo',
    firefox: 'Completo',
    note: 'Ruta, storage no sensible y journal de red.',
  },
  {
    feature: 'Session Recording',
    chrome: 'Completo',
    firefox: 'Completo',
    note: 'rrweb dentro de la extensión y reproductor exportado.',
  },
  {
    feature: 'Declarative Shadow DOM',
    chrome: '111+',
    firefox: '123+',
    note: 'Solo shadow roots abiertos; los cerrados no son accesibles.',
  },
  {
    feature: 'Suite E2E',
    chrome: 'Chromium 159',
    firefox: 'Solo lint',
    note: 'Playwright no carga extensiones en su build de Firefox.',
  },
  {
    feature: 'Instalación',
    chrome: 'Descomprimida',
    firefox: 'Temporal',
    note: 'Firefox pierde el complemento al cerrar; AMO requeriría firma.',
  },
];

export const FAQ: FaqItem[] = [
  {
    question: '¿Esto sube mis páginas a algún servidor?',
    answer:
      'No. La captura, el empaquetado y la reproducción ocurren en tu navegador. No hay telemetría ni cuenta. El ZIP se queda en tu equipo hasta que tú decidas compartirlo.',
  },
  {
    question: '¿Puedo abrir un clon sin instalar la extensión?',
    answer:
      'Sí. El ZIP contiene index.html, todos los recursos y, cuando hace falta, un reproductor. Los scripts clásicos funcionan desde file://; para módulos ESM usa el serve-clone.mjs incluido.',
  },
  {
    question: '¿Por qué una petición devuelve 504 en el clon?',
    answer:
      'Porque esa petición no se observó durante la captura. El runtime es determinista y no inventa un backend: responde 504, lo cuenta en misses y nunca sale a Internet.',
  },
  {
    question: '¿Funciona con React, Next.js o Vue?',
    answer:
      'El DOM resultante se conserva. La rehidratación puede fallar porque el estado interno del framework no es serializable; el modo automático detecta React 18/Next/Nuxt/Remix y usa la instantánea estática. Forzar JS existe, pero no garantiza el resultado.',
  },
  {
    question: '¿Guarda contraseñas o cookies?',
    answer:
      'No guarda contraseñas, campos ocultos, datos de pago, cookies ni Authorization en el paquete. La cookie opcional del Clon Completo se usa solo para autenticar la captura y no se escribe en la sesión ni en el ZIP.',
  },
  {
    question: '¿Puedo capturar un vídeo con DRM o un iframe de otro dominio?',
    answer:
      'No. El DRM y la same-origin policy no se eluden. El iframe cross-origin se sustituye por un marcador y se registra el motivo; el vídeo protegido se documenta como no capturado.',
  },
  {
    question: '¿La web del repositorio se publica sola?',
    answer:
      'Sí. El workflow pages.yml construye website/ con Node.js y React, valida el resultado y lo despliega en GitHub Pages cuando hay cambios en main.',
  },
];

export const STATS = [
  { value: '0.00%', label: 'diferencia visual', detail: 'fixture determinista' },
  { value: '4.504', label: 'nodos serializados', detail: 'captura real' },
  { value: '48', label: 'tests unitarios', detail: 'sin mocks de navegador' },
  { value: '100%', label: 'local por diseño', detail: 'sin telemetría' },
];

export const REPO = 'https://github.com/D1se0/webclone-ultimate';
export const PAGES = 'https://d1se0.github.io/webclone-ultimate/';
