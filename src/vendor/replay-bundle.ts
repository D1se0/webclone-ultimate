/**
 * Bundle independiente del reproductor rrweb.
 * Se compila como IIFE con globalName "WCReplay" y se copia dentro de cada ZIP
 * exportado para que replay.html funcione sin la extensión instalada.
 */
import { Replayer } from '@rrweb/replay';

export { Replayer };
