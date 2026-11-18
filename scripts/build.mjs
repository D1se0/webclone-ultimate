#!/usr/bin/env node
/**
 * Build multi-navegador con esbuild.
 * Genera dist/chrome y dist/firefox con manifiestos adaptados (MV3).
 */
import { build } from 'esbuild';
import { mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const root = process.cwd();
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;

const targetArg = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'all';
const targets = targetArg === 'all' ? ['chrome', 'firefox'] : [targetArg];
if (!['chrome', 'firefox', 'all'].includes(targetArg)) {
  console.error(`Target desconocido: ${targetArg}`);
  process.exit(1);
}

const ESBUILD_TARGET = { chrome: 'chrome116', firefox: 'firefox128' };

function roundedRectDistance(x, y, left, top, right, bottom, radius) {
  const cx = Math.max(left + radius, Math.min(x, right - radius));
  const cy = Math.max(top + radius, Math.min(y, bottom - radius));
  const dx = x - cx;
  const dy = y - cy;
  return Math.sqrt(dx * dx + dy * dy) - radius;
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return Math.sqrt(dx * dx + dy * dy);
}

function drawIcon(size) {
  const png = new PNG({ width: size, height: size });
  const points = [
    [0.24, 0.3],
    [0.36, 0.72],
    [0.5, 0.46],
    [0.64, 0.72],
    [0.76, 0.3],
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;
      const d = roundedRectDistance(nx, ny, 0.04, 0.04, 0.96, 0.96, 0.24);
      if (d > 0.005) {
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 0;
        continue;
      }
      const border = d > -0.055;
      let r = 16;
      let g = 16;
      let b = 19;
      if (border) {
        r = 239;
        g = 68;
        b = 68;
      } else {
        let w = 1;
        for (let i = 0; i < points.length - 1; i++) {
          const dist = segmentDistance(nx, ny, points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
          w = Math.min(w, dist);
        }
        if (w < 0.075) {
          r = 245;
          g = 245;
          b = 245;
        }
      }
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

async function makeIcons(dir) {
  const iconsDir = path.join(dir, 'icons');
  await mkdir(iconsDir, { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    await writeFile(path.join(iconsDir, `icon${size}.png`), drawIcon(size));
  }
}

function manifestFor(target) {
  const base = JSON.parse(JSON.stringify(baseManifest));
  base.version = version;
  if (target === 'firefox') {
    // Firefox no admite `world: MAIN` en content_scripts hasta fechas recientes;
    // los hooks se inyectan con scripting.executeScript al iniciar la captura.
    base.content_scripts = base.content_scripts.filter((entry) => entry.world !== 'MAIN');
    base.background = { scripts: ['background.js'] };
    base.browser_specific_settings = {
      gecko: {
        id: 'webclone-ultimate@localhost',
        strict_min_version: '128.0',
      },
    };
    delete base.minimum_chrome_version;
  } else {
    base.background = { service_worker: 'background.js' };
  }
  return base;
}

const baseManifest = JSON.parse(await readFile(path.join(root, 'src/manifest.base.json'), 'utf8'));

async function bundle(entry, outfile, target, extra = {}) {
  await build({
    entryPoints: [path.join(root, entry)],
    outfile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ESBUILD_TARGET[target],
    legalComments: 'none',
    logLevel: 'warning',
    define: { 'process.env.NODE_ENV': '"production"' },
    ...extra,
  });
}

async function buildTarget(target) {
  const outDir = path.join(root, 'dist', target);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await bundle('src/background/index.ts', path.join(outDir, 'background.js'), target);
  await bundle('src/content/index.ts', path.join(outDir, 'content.js'), target);
  await bundle('src/content/main-world-entry.ts', path.join(outDir, 'main-world.js'), target);
  await bundle('src/popup/popup.ts', path.join(outDir, 'popup/popup.js'), target);
  await bundle('src/replay/replay.ts', path.join(outDir, 'replay/replay.js'), target);
  await bundle('src/vendor/replay-bundle.ts', path.join(outDir, 'vendor/wc-replay.js'), target, {
    globalName: 'WCReplay',
  });

  for (const file of ['popup/index.html', 'popup/popup.css', 'replay/index.html', 'replay/replay.css']) {
    await mkdir(path.dirname(path.join(outDir, file)), { recursive: true });
    await copyFile(path.join(root, 'src', file), path.join(outDir, file));
  }

  await makeIcons(outDir);
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifestFor(target), null, 2));
  await copyFile(path.join(root, 'scripts/serve-clone.mjs'), path.join(outDir, 'serve-clone.mjs'));

  console.log(`  ✓ dist/${target} (${target === 'firefox' ? 'MV3 + background.scripts' : 'MV3 service worker'})`);
}

console.log(`WebClone Ultimate v${version} — build ${targets.join(', ')}`);
for (const target of targets) {
  await buildTarget(target);
}

// Verificación básica de artefactos.
for (const target of targets) {
  const dir = path.join(root, 'dist', target);
  const required = ['manifest.json', 'background.js', 'content.js', 'main-world.js', 'popup/index.html', 'popup/popup.js', 'replay/index.html', 'replay/replay.js', 'vendor/wc-replay.js'];
  for (const file of required) {
    if (!existsSync(path.join(dir, file))) {
      console.error(`FALTA ${target}/${file}`);
      process.exit(1);
    }
  }
}
console.log('Build completado.');
