#!/usr/bin/env node
/**
 * Verificador de exportaciones: sirve un paquete descomprimido, lo abre en Chromium
 * y reporta errores de consola/página y peticiones fallidas.
 *
 * Uso: node scripts/verify-export.mjs <directorio> [index.html|replay.html]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = path.resolve(process.argv[2] || '.');
const entry = process.argv[3] || 'index.html';
if (!existsSync(path.join(dir, entry))) {
  console.error(`No existe ${path.join(dir, entry)}`);
  process.exit(2);
}

const port = 8900 + Math.floor(Math.random() * 90);
const server = spawn(process.execPath, [path.resolve('scripts/serve-clone.mjs'), dir, String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('servidor no arrancó')), 10_000);
  server.stdout.on('data', (chunk) => {
    if (chunk.toString().includes('sirviendo')) {
      clearTimeout(timer);
      resolve();
    }
  });
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
const failed = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') errors.push(`console.${message.type()}: ${message.text().slice(0, 300)}`);
});
page.on('requestfailed', (request) => failed.push(`${request.url()} — ${request.failure()?.errorText}`));

const started = Date.now();
try {
  await page.goto(`http://127.0.0.1:${port}/${entry}`, { waitUntil: 'load', timeout: 25_000 });
} catch (error) {
  console.error(`FALLO al cargar ${entry}: ${error.message}`);
}
console.log(`carga: ${Date.now() - started} ms`);
await page.waitForTimeout(1500);

const info = await page.evaluate(() => {
  const player = document.querySelector('.replayer-wrapper');
  return {
    title: document.title,
    hasPlayer: !!player,
    events: document.getElementById('events-count')?.textContent ?? null,
    marks: document.querySelectorAll('#marks-body tr').length,
    hasBundle: typeof window.WCReplay !== 'undefined',
    bodyLength: document.body.innerHTML.length,
  };
});
console.log(JSON.stringify(info, null, 2));
if (failed.length) console.log('peticiones fallidas:\n  ' + failed.join('\n  '));
if (errors.length) console.log('errores:\n  ' + errors.slice(0, 20).join('\n  '));

await page.screenshot({ path: `reports/out/verify-${path.basename(dir)}-${entry.replace(/\W/g, '_')}.png` });
await browser.close();
server.kill('SIGTERM');
process.exit(info.hasPlayer || entry !== 'replay.html' ? (errors.length ? 1 : 0) : 1);
