#!/usr/bin/env node
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist');
const htmlPath = path.join(root, 'index.html');
let html;
try {
  html = await readFile(htmlPath, 'utf8');
} catch {
  console.error('✗ No existe dist/index.html. Ejecuta vite build antes de validar.');
  process.exit(1);
}

const failures = [];
const check = (ok, message) => {
  if (ok) console.log(`  ✓ ${message}`);
  else failures.push(message);
};

const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
const styles = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((match) => match[1]);
const assets = [...scripts, ...styles];

check(html.includes('WebClone Ultimate'), 'el título del proyecto está presente');
check(assets.length > 0, 'el HTML referencia al menos un asset compilado');
check(assets.every((asset) => asset.startsWith('./')), 'todos los assets usan rutas relativas');
check(!html.includes('/src/main.tsx'), 'el HTML no apunta al entry de desarrollo');
check(html.includes('./favicon.svg'), 'el favicon está enlazado');
check(html.includes('og:title'), 'los metadatos sociales están presentes');

for (const asset of assets) {
  const file = path.join(root, asset.replace(/^\.\//, ''));
  const info = await stat(file).catch(() => null);
  check(Boolean(info?.isFile() && info.size > 0), `asset presente: ${asset}`);
}

const jsFiles = (await readdir(path.join(root, 'assets')).catch(() => []))
  .filter((name) => name.endsWith('.js'));
const js = (await Promise.all(jsFiles.map((name) => readFile(path.join(root, 'assets', name), 'utf8')))).join('\n');
for (const marker of ['laboratorio', 'compatibilidad', 'Instant Clone', 'metadata.json']) {
  check(js.includes(marker), `contenido compilado contiene “${marker}”`);
}

check(jsFiles.length > 0, 'hay bundles JavaScript');
check(html.length > 1_200, 'el HTML final tiene contenido suficiente');
if (failures.length) {
  console.error(`\n${failures.length} comprobaciones fallidas:`);
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}
console.log('\nBuild estático válido para GitHub Pages.');
