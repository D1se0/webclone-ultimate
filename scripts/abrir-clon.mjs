#!/usr/bin/env node
/**
 * Lanzador automático de una captura de WebClone Ultimate.
 *
 * Uso:
 *   node abrir-clon.mjs [--port 8080] [--no-open]
 *
 * Arranca serve-clone.mjs en un puerto libre y abre la captura en el navegador.
 * El servidor escucha únicamente en 127.0.0.1.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log('Uso: node abrir-clon.mjs [--port 8080] [--no-open]');
  console.log('  --port N   Puerto preferido (por defecto, uno libre).');
  console.log('  --no-open  No abrir el navegador automáticamente.');
  process.exit(0);
}

const noOpen = args.includes('--no-open');
const portIndex = args.indexOf('--port');
const requestedPort = portIndex === -1 ? 0 : Number(args[portIndex + 1]);
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
  console.error('Puerto inválido. Usa --port 8080 o deja que se elija uno libre.');
  process.exit(2);
}

const indexPath = join(root, 'index.html');
const serverPath = join(root, 'serve-clone.mjs');
if (!existsSync(indexPath)) {
  console.error('No se encontró index.html junto a abrir-clon.mjs.');
  process.exit(2);
}
if (!existsSync(serverPath)) {
  console.error('Falta serve-clone.mjs. Vuelve a exportar el ZIP.');
  process.exit(2);
}

console.log('WebClone Ultimate — abriendo la captura local');
console.log('  Carpeta: ' + root);
console.log('  Pulsa Ctrl+C para detener el servidor.');

const child = spawn(process.execPath, [serverPath, root, String(requestedPort)], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let output = '';
let browserStarted = false;
let stopping = false;

const timeout = setTimeout(() => {
  if (browserStarted) return;
  console.error('\nEl servidor no respondió en 15 segundos. Comprueba que Node.js 20+ está instalado.');
  stop();
}, 15_000);
timeout.unref?.();

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  if (browserStarted) return;
  output += chunk;
  const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/index\.html/);
  if (!match) return;
  browserStarted = true;
  clearTimeout(timeout);
  const url = match[0];
  console.log('');
  if (noOpen) {
    console.log('Abre esta dirección en el navegador: ' + url);
    return;
  }
  console.log('Abriendo en el navegador: ' + url);
  openInBrowser(url).then((ok) => {
    console.log(
      (ok ? 'Navegador abierto. ' : 'No se pudo abrir el navegador automáticamente. ') +
        'Si hace falta, visita: ' + url,
    );
  });
});
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

function openInBrowser(url) {
  const candidates =
    process.platform === 'win32'
      ? [{ command: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '', url] }]
      : process.platform === 'darwin'
        ? [{ command: 'open', args: [url] }]
        : [
            { command: 'xdg-open', args: [url] },
            { command: 'gio', args: ['open', url] },
            { command: 'sensible-browser', args: [url] },
          ];

  return new Promise((resolve) => {
    let index = 0;
    const tryNext = () => {
      if (index >= candidates.length) {
        resolve(false);
        return;
      }
      const candidate = candidates[index++];
      execFile(candidate.command, candidate.args, { windowsHide: true }, (error) => {
        if (error) tryNext();
        else resolve(true);
      });
    };
    tryNext();
  });
}

function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(timeout);
  if (!child.killed) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', () => {
  console.log('\nDeteniendo servidor...');
  stop();
});
process.on('SIGTERM', stop);

child.on('error', (error) => {
  clearTimeout(timeout);
  console.error('No se pudo iniciar el servidor: ' + error.message);
  process.exit(1);
});
child.on('exit', (code) => {
  clearTimeout(timeout);
  process.exit(code || 0);
});
