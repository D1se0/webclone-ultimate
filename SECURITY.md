# Seguridad

## Versiones soportadas

La rama `main` y la última release reciben correcciones de seguridad.

## Reportar una vulnerabilidad

No publiques detalles explotables en un issue. Usa **Security → Report a vulnerability** en GitHub
para abrir un aviso privado. Incluye:

- Versión y navegador.
- Pasos mínimos para reproducir.
- Impacto esperado.
- Prueba de concepto sin datos reales.

Intentaremos confirmar el aviso y coordinar una corrección. No se promete un plazo comercial.

## Modelo de amenaza

WebClone Ultimate procesa páginas de terceros y genera paquetes que pueden contener datos sensibles.
Los límites importantes:

- La extensión no envía capturas a Internet.
- No se guardan cookies, `Authorization` ni contraseñas en el ZIP.
- El HTML y la red capturados **pueden contener datos privados visibles**; el usuario debe revisar el
  paquete antes de compartirlo.
- Los enlaces y formularios del clon estático se desactivan; el clon dinámico bloquea WebSocket,
  EventSource, service workers y navegación externa.
- El paquete exportado es contenido no confiable: ábrelo en un navegador actualizado y no ejecutes
  copias de sitios que no conozcas.

## Secretos

Nunca commitees `deploy.env`, claves privadas, `.env`, cookies ni tokens. El `.gitignore` cubre los
casos habituales, pero la responsabilidad final es del contribuyente. Si un secreto llega a un commit,
revócalo y reescribe el historial antes de hacerlo público.
