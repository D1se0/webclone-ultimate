import { zipSync, unzipSync, strToU8 } from 'fflate';

export interface ZipInputFile {
  /** Ruta dentro del ZIP, siempre con `/` y sin `..`. */
  path: string;
  data: Uint8Array;
}

export interface ZipBuildOptions {
  /** Nivel de compresión para texto/CSS/HTML/JSON (0-9). */
  level?: number;
  /** Fecha fija para builds reproducibles. */
  mtime?: Date;
}

const ALREADY_COMPRESSED = /\.(png|jpe?g|gif|webp|avif|woff2?|ttf|otf|mp4|webm|mp3|m4a|ogg|zip|br|gz)$/i;

export function assertSafeZipPath(path: string): void {
  if (!path || path.startsWith('/') || path.includes('..') || path.includes('\\')) {
    throw new Error(`Ruta de ZIP inválida: ${path}`);
  }
}

/** Construye un ZIP válido (UTF-8, CRC-32 y offsets calculados por fflate). */
export function buildZip(files: ZipInputFile[], options: ZipBuildOptions = {}): Uint8Array {
  const bag: Record<string, [Uint8Array, { level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }]> = {};
  for (const file of files) {
    assertSafeZipPath(file.path);
    const level = (ALREADY_COMPRESSED.test(file.path) ? 0 : (options.level ?? 6)) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    bag[file.path] = [file.data, { level }];
  }
  return zipSync(bag, { mtime: options.mtime ?? new Date(), level: 6 });
}

export function textFile(text: string): Uint8Array {
  return strToU8(text);
}

export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const entries = unzipSync(bytes);
  for (const [name, data] of Object.entries(entries)) out.set(name, data);
  return out;
}

export function zipEntryNames(bytes: Uint8Array): string[] {
  // Lectura directa del directorio central para validar sin descomprimir.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 65558; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP sin EOCD');
  const total = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const names: string[] = [];
  for (let i = 0; i < total; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('Directorio central corrupto');
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    names.push(new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen)));
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
