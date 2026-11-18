# Pruebas y verificación

El repositorio separa las pruebas de la extensión, las de la web y las comprobaciones de publicación.
No se declara una función como terminada sin una prueba que la respalde.

## Comandos

| Comando | Qué comprueba |
|---|---|
| `npm run typecheck` | TypeScript estricto de la extensión |
| `npm test` | 48 tests unitarios |
| `npm run build` | Build de Chrome y Firefox con manifiestos e iconos |
| `npm run test:e2e` | 8 pruebas con Chromium real y la extensión cargada |
| `npm run validate:zip -- <zip>` | CRC-32 con Python, `unzip -t`, estructura y checksums |
| `npm --prefix website test` | Tests de componentes React |
| `npm --prefix website run typecheck` | TypeScript de la web |
| `npm --prefix website run build` | Build estático + validación Node |
| `npm --prefix website run test:e2e` | Navegación, demo, tema, docs y responsive |
| `npx web-ext lint --source-dir dist/firefox` | Manifiesto Firefox |

## Extensión

La suite unitaria cubre URLs, CSS, hashes, ZIP, timeline, redacción, reescritura de JS, estado de
sesión y cookies. Los E2E cargan la extensión real en Chromium y prueban:

1. Instant Clone del fixture con paridad visual, estado, offline y `file://`.
2. Full Session Recording con mutaciones y reproductor exportado.
3. Clon dinámico con módulos ESM, `fetch`/XHR y cero peticiones externas.
4. Clon Completo con POST, navegación, storage y animaciones.
5. Popup y session manager.
6. Importación con integridad y round-trip.
7. Captura real de `protocolexplorer.org`.
8. Fallback de hidratación en la misma página.

Los dos últimos tests dependen de un sitio externo y pueden variar si cambia. En CI se ejecutan en un
job separado y no bloquean la publicación de la web.

### Requisitos E2E

```bash
npx playwright install chromium
npm run build
npm run test:e2e
```

Los artefactos quedan en `reports/artifacts/` y `reports/out/`. Están ignorados por Git.

## Web

La web se prueba en dos capas:

- **Vitest + Testing Library**: render, navegación, tema, demo, tabs, copiar, FAQ y enlaces.
- **Playwright**: carga real, secciones, menú móvil, tema persistente, laboratorio, documentación,
  responsive y ausencia de errores de consola.

El build ejecuta `website/scripts/verify-build.mjs`, que comprueba que existen los assets, que las
referencias son relativas —válidas para GitHub Pages— y que el HTML no apunta a `src/` sin compilar.

## CI de GitHub

`.github/workflows/ci.yml` ejecuta en cada push y pull request:

- Extensión: Node 22, `npm ci`, typecheck, unitarios, build y auditoría de manifiestos.
- Web: Node 22, `npm ci`, typecheck, unitarios, build y E2E.
- Firefox: `web-ext lint`.

`.github/workflows/pages.yml` construye la web y la publica. `.github/workflows/release.yml` crea los
ZIP de Chrome y Firefox al publicar un tag `v*`.

## Criterio de fidelidad

Los tests visuales del fixture exigen menos del 3 % de diferencia y los del clon dinámico menos del
2,5 %; el objetivo medido es 0,00 %. La captura externa usa un umbral más laxo para no ser frágil ante
cambios del sitio. Los umbrales no ocultan una regresión grave: un fallo de CSS produce diferencias
muy superiores.

## Limitaciones de la suite

- Firefox no se automatiza: Playwright no carga extensiones en su build de Firefox. Se valida el
  manifiesto y se documenta la instalación manual.
- La web objetivo externa puede cambiar y alterar los números de referencia.
- Los tests visuales cubren un viewport principal y no todos los breakpoints.
- No se simulan todas las condiciones de red lentas.
- La web se prueba en Chromium; no se ejecuta una matriz completa de navegadores.
