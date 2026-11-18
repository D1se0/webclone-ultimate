# Changelog

Todas las fechas usan el formato AAAA-MM-DD.

## [1.2.0] — 2026-11-18

### Añadido

- Repositorio limpio y portable con la extensión, tests, documentación y web separadas del portal y
  de los artefactos de desarrollo.
- Web React + Vite con laboratorio de captura, comparador, pipeline, cuatro modos, ejemplos, anatomía
  del ZIP, documentación, privacidad, compatibilidad y FAQ.
- GitHub Actions para CI, Pages, release, suite externa y Dependabot.
- Documentación de instalación, pruebas, publicación, seguridad y arquitectura de la web.
- Clave RSA de despliegue y guía de deploy key.
- Release v1.2.0 con notas específicas para Chrome/Firefox y checksums SHA-256 adjuntos.

### Conservado

- Instant Clone, clon dinámico, Clon Completo y Full Session Recording.
- ZIP con checksums SHA-256, reproductor autónomo y servidor local.
- Suite de 48 unitarios y 8 E2E de extensión.

### Verificado

- `npm run typecheck` y `npm test` de la extensión.
- Build Chrome/Firefox y `web-ext lint` con 0 errores.
- 8 E2E de extensión, incluidas dos capturas reales.
- 6 unitarios y 12 E2E de la web en Chromium escritorio y móvil.
- Build estático con rutas relativas válidas para GitHub Pages.
