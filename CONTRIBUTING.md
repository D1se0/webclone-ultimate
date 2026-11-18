# Contribuir

Gracias por querer mejorar WebClone Ultimate. Este repositorio prioriza cambios pequeños, pruebas
reales y documentación honesta.

## Antes de empezar

- Busca un issue existente o abre uno describiendo el problema.
- Para cambios grandes, propone el enfoque antes de escribir código.
- No incluyas capturas con datos personales, cookies, tokens ni contenido privado.

## Entorno

```bash
git clone https://github.com/D1se0/webclone-ultimate.git
cd webclone-ultimate
npm install
npm --prefix website install
npm run build
npm run typecheck
npm test
```

Para los E2E:

```bash
npx playwright install chromium
npm run test:e2e
```

## Estilo

- TypeScript estricto; evita `any` en el núcleo.
- Mantén la separación popup / background / content / replay.
- No añadas dependencias sin justificar peso, permisos y alternativa.
- Los recursos de red se resuelven en background; el content script no debe saltarse CORS.
- Los tests nuevos deben reproducir un defecto real o proteger una garantía del producto.

## Pull request

1. Crea una rama descriptiva.
2. Incluye el cambio y sus pruebas.
3. Ejecuta `npm run check` y, si tocas la web, `npm --prefix website run test:e2e`.
4. Actualiza la documentación afectada.
5. Explica qué cambia, por qué y qué evidencia tienes.

No se aceptan cambios que relajen aserciones, oculten errores o eliminen tests para hacer pasar CI.

## Reportar seguridad

No abras un issue público con un secreto o una vulnerabilidad explotable. Sigue
[`SECURITY.md`](SECURITY.md).
