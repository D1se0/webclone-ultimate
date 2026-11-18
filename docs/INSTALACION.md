# Guía de instalación y uso

Esta guía cubre la instalación desde el repositorio, el uso diario del popup, la exportación y la
solución de problemas. La explicación del motor está en [`CLONACION-COMPLETA.md`](CLONACION-COMPLETA.md)
y la arquitectura en [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## 1. Requisitos

| Componente | Versión | Nota |
|---|---|---|
| Node.js | 20+ | Probado con 22 y 26 |
| npm | 10+ | Incluido con Node |
| Chrome / Chromium / Edge | 116+ | Recomendado para desarrollo |
| Firefox | 128+ | Instalación temporal |
| Python 3 + unzip | Opcional | Solo para validar los ZIP exportados |

## 2. Instalación

```bash
git clone https://github.com/D1se0/webclone-ultimate.git
cd webclone-ultimate
npm install
npm run build
```

El build genera dos carpetas independientes:

```text
dist/chrome/    # manifest con service_worker
dist/firefox/   # manifest con background.scripts y gecko id
```

### Chrome, Chromium o Edge

1. Abre `chrome://extensions`.
2. Activa **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida**.
4. Selecciona la carpeta `dist/chrome`.
5. Fija la extensión en la barra si quieres tenerla a mano.

### Firefox

1. Abre `about:debugging#/runtime/this-firefox`.
2. Pulsa **Cargar complemento temporal**.
3. Selecciona `dist/firefox/manifest.json`.
4. Acepta el permiso de acceso a los sitios que quieras capturar.

Firefox elimina el complemento temporal al cerrar. Para una instalación permanente hace falta
firmarlo en AMO; el proyecto no incluye una build firmada.

## 3. El popup

### Instant Clone

1. Abre la página que quieres conservar.
2. Abre el popup.
3. Pulsa **INSTANT CLONE**.
4. Espera a que terminen las fases.
5. La sesión aparece en **Sessions**.

Opciones relevantes en **Ajustes**:

| Ajuste | Efecto |
|---|---|
| Capturar recursos binarios | Imágenes, fuentes, audio y vídeo accesibles |
| Capturar canvas | Canvas 2D como imagen (WebGL puede no ser legible) |
| Capturar iframes same-origin | Serializa documentos secundarios |
| Clon dinámico | Conserva y ejecuta JS local; captura red |
| Capturar respuestas de red | Guarda cuerpos `fetch`/XHR observados |
| Forzar JS en frameworks | Opción avanzada; puede romper la hidratación |
| Máx. por recurso | Límite de tamaño por asset |
| Máx. total | Límite agregado de la captura |

### Clon Completo

1. Abre la página y, si hace falta, pega una cookie en **Sesión para el Clon Completo**.
2. Pulsa **CLON COMPLETO**.
3. Interactúa: formularios, POST, navegación, SPA…
4. Pulsa **FINALIZAR Y RECONSTRUIR**.
5. Descarga el ZIP y ejecuta `node abrir-clon.mjs` dentro de la carpeta (o `ABRIR-CLON.cmd` en
   Windows) para servirlo y abrirlo automáticamente.

La cookie se aplica a la pestaña y se usa durante la captura. No se guarda en la sesión ni se escribe
en el ZIP. El HTML y las respuestas sí pueden contener datos visibles de la cuenta.

### Full Session Recording

1. Pulsa **START RECORDING**.
2. Interactúa con la página.
3. Pulsa **STOP RECORDING**.
4. Abre el reproductor o exporta el ZIP.

El reproductor incluye timeline, play/pausa, velocidades 0.25×–4×, salto temporal, eventos, errores,
navegación SPA y red.

## 4. Sessions e Inspector

La lista muestra fecha, dominio, duración, tamaño, integridad y recursos. El **Capture Inspector**
resume qué se capturó por tipo y qué falló, con el motivo y la alternativa.

Acciones disponibles:

- Abrir el reproductor.
- Descargar el ZIP.
- Importar un ZIP y verificar checksums.
- Eliminar una sesión.
- Refrescar el estado y el almacenamiento.

## 5. Exportar e importar

Exportar produce un ZIP con `metadata.json`, checksums SHA-256, reproductor autónomo y un lanzador
local. Importar verifica cada entrada y marca la integridad sin descartar la sesión.

```bash
# Validación externa del ZIP
node scripts/validate-zip.mjs ruta/al/paquete.zip

# Abrir el paquete: elige un puerto libre y lanza el navegador
cd paquete
node abrir-clon.mjs

# Servidor manual, si prefieres controlar el puerto
node serve-clone.mjs . 8080
```

`abrir-clon.mjs` solo escucha en `127.0.0.1` y no instala dependencias ni envía datos fuera del
equipo. En Windows se puede ejecutar con doble clic sobre `ABRIR-CLON.cmd`.

## 6. Problemas frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| El clon sale sin CSS | Un recurso cross-origin falló o CSP lo impidió | Revisa el informe; prueba con el servidor local |
| La página React aparece vacía | Hidratación incompatible | Usa el fallback estático (por defecto) |
| Faltan imágenes | CORS, autenticación o límite de tamaño | Ajusta límites; revisa `failures` |
| El reproductor no arranca | El ZIP no se descomprimió completo | Vuelve a exportar y valida el ZIP |
| Firefox no mantiene la extensión | Es temporal | Vuelve a cargarla o firma en AMO |
| El Clon Completo no sirve un POST nuevo | No se observó esa petición | Es determinista por diseño; captura la interacción |
| `file://` no carga módulos | CORS de módulos | Usa `abrir-clon.mjs` o `serve-clone.mjs` |

## 7. Desinstalar

En Chrome: `chrome://extensions` → quitar. En Firefox: `about:addons` → quitar. Los datos de la
extensión viven en IndexedDB del navegador y se eliminan con la extensión. Los ZIP descargados son
tuyos: bórralos manualmente si contienen información sensible.
