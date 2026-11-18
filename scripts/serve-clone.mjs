#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const server = createServer(async (request, response) => {
  // El cuerpo POST se lee en el endpoint de prueba antes del servido estático.
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    let pathname = decodeURIComponent(url.pathname);
    // Endpoint de prueba para generar tráfico POST durante el Clon Completo.
    if (request.method === 'POST' && pathname.endsWith('/api/session-add.json')) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      let payload = {};
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { payload = {}; }
      const body = JSON.stringify({ label: 'Servidor · ' + String(payload.label || 'sin etiqueta'), ok: true });
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
      response.end(body);
      return;
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    let filePath = normalize(join(root, pathname));
    if (!filePath.startsWith(root + sep) && filePath !== root) {
      response.writeHead(403).end('403 forbidden');
      return;
    }
    let info = await stat(filePath).catch(() => null);
    // Fallback SPA: una ruta como /es?p=http no existe como fichero, pero debe
    // devolver el index para que la aplicación restaure su router offline.
    const acceptsHtml = String(request.headers.accept || '').includes('text/html');
    if ((!info || info.isDirectory()) && request.method === 'GET' && acceptsHtml && !extname(pathname)) {
      filePath = join(root, 'index.html');
      info = await stat(filePath).catch(() => null);
    }
    if (!info || info.isDirectory()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 not found');
      return;
    }
    const data = await readFile(filePath);
    response.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'content-length': data.byteLength,
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    response.end(data);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('500 ' + String(error));
  }
});

server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.log('WebClone Ultimate — sirviendo ' + root);
  console.log('  http://127.0.0.1:' + actualPort + '/index.html');
  console.log('  http://127.0.0.1:' + actualPort + '/replay.html');
});
