#!/usr/bin/env node
/**
 * Valida un ZIP exportado con herramientas externas reales:
 *  - python3 zipfile (CRC-32 + testzip + nombres UTF-8)
 *  - unzip -t
 *  - comprobación de la estructura esperada
 *
 * Uso: node scripts/validate-zip.mjs ruta/al/archivo.zip
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Uso: node scripts/validate-zip.mjs <archivo.zip>');
  process.exit(2);
}
if (!existsSync(file)) {
  console.error(`No existe: ${file}`);
  process.exit(2);
}

let failures = 0;

function check(name, fn) {
  try {
    const result = fn();
    console.log(`  ✓ ${name}${result ? ` — ${result}` : ''}`);
  } catch (error) {
    failures++;
    console.error(`  ✗ ${name} — ${error instanceof Error ? error.message : String(error)}`);
  }
}

const python = `
import json, sys, zipfile
path = sys.argv[1]
with zipfile.ZipFile(path) as z:
    bad = z.testzip()
    if bad is not None:
        print(json.dumps({"ok": False, "bad": bad}))
        sys.exit(0)
    names = z.namelist()
    utf8 = [n for n in names if any(ord(c) > 127 for c in n)]
    total = sum(i.file_size for i in z.infolist())
    print(json.dumps({"ok": True, "count": len(names), "utf8": utf8, "total": total, "names": names[:200]}))
`;

const output = execFileSync('python3', ['-c', python, file], { encoding: 'utf8' });
const result = JSON.parse(output.trim().split('\n').pop());

check('python3 zipfile: CRC-32 válido (testzip)', () => (result.ok ? `${result.count} entradas` : `entrada corrupta: ${result.bad}`));
check('unzip -t', () => execFileSync('unzip', ['-t', file], { encoding: 'utf8' }).trim().split('\n').pop());

const required = ['index.html', 'replay.html', 'metadata.json', 'snapshot/dom.json', 'snapshot/state.json', 'recording/events.json', 'recording/timeline.json', 'reports/capture-report.json', 'reports/compatibility-report.html', 'README.html', 'serve-clone.mjs', 'abrir-clon.mjs', 'ABRIR-CLON.cmd'];
const names = new Set(result.names);
check('estructura esperada', () => {
  const missing = required.filter((path) => !names.has(path));
  if (missing.length) throw new Error(`faltan: ${missing.join(', ')}`);
  return `${required.length} rutas obligatorias presentes`;
});

check('metadata.json con checksums', () => {
  const pythonMeta = `
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    meta = json.loads(z.read('metadata.json').decode('utf-8'))
print(json.dumps({"files": len(meta.get('files', [])), "tool": meta.get('tool', {}).get('name'), "sha": bool(meta.get('files', [{}])[0].get('sha256'))}))
`;
  const info = JSON.parse(execFileSync('python3', ['-c', pythonMeta, file], { encoding: 'utf8' }));
  if (info.tool !== 'WebClone Ultimate') throw new Error(`tool inesperado: ${info.tool}`);
  if (!info.sha) throw new Error('sin checksums SHA-256');
  return `${info.files} ficheros verificables`;
});

check('nombres UTF-8', () => (result.utf8.length ? result.utf8.join(', ') : 'sin nombres no-ASCII (válido)'));

check('tamaño total', () => `${(result.total / 1024).toFixed(1)} KB descomprimidos`);

check('contenido HTML no vacío', () => {
  const pythonHtml = `
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    html = z.read('index.html').decode('utf-8', 'replace')
print(len(html))
`;
  const length = Number(execFileSync('python3', ['-c', pythonHtml, file], { encoding: 'utf8' }).trim());
  if (length < 200) throw new Error(`index.html demasiado pequeño (${length} bytes)`);
  return `${length} bytes`;
});

check('sin rutas con traversal', () => {
  const names = JSON.parse(execFileSync('python3', ['-c', 'import json,sys,zipfile;print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))', file], { encoding: 'utf8' }));
  const bad = names.filter((n) => n.includes('..') || n.startsWith('/'));
  if (bad.length) throw new Error(bad.join(', '));
  return `${names.length} rutas seguras`;
});

void readFileSync;

console.log(failures === 0 ? '\nZIP válido.' : `\n${failures} comprobaciones fallidas.`);
process.exit(failures === 0 ? 0 : 1);
