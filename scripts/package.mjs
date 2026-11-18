#!/usr/bin/env node
/** Empaqueta las builds en `artifacts/` (ZIP cargable/instalable manualmente). */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));

async function walk(dir, base = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await walk(path.join(dir, entry.name), rel)));
    else files.push({ path: rel, data: new Uint8Array(await readFile(path.join(dir, entry.name))) });
  }
  return files;
}

await mkdir('artifacts', { recursive: true });
for (const target of ['chrome', 'firefox']) {
  const dir = path.join('dist', target);
  if (!existsSync(dir)) {
    console.error(`Falta ${dir}. Ejecuta antes: npm run build`);
    process.exit(1);
  }
  const files = await walk(dir);
  const bag = {};
  for (const file of files) bag[file.path] = file.data;
  const zip = zipSync(bag, { level: 6, mtime: new Date() });
  const name = `webclone-ultimate-${target}-${pkg.version}.zip`;
  await writeFile(path.join('artifacts', name), zip);
  console.log(`  ✓ artifacts/${name} — ${(zip.byteLength / 1024).toFixed(1)} KB, ${files.length} ficheros`);
}
console.log('Empaquetado completado. Chrome: cargar descomprimido. Firefox: cargar dist/firefox/manifest.json como complemento temporal.');
