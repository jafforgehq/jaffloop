import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { quiet } from './quiet';

const DIR = '/System/Library/Sounds';
let names: Set<string> | null = null;

/** Plays a macOS system sound by name ("Tink", "Glass", ...); anything that is not an installed system sound is ignored. */
export function playSound(name: string): void {
  if (quiet || process.platform !== 'darwin' || !/^[A-Za-z]{2,24}$/.test(name)) return;
  names ??= new Set((() => { try { return fs.readdirSync(DIR).filter((f) => f.endsWith('.aiff')).map((f) => f.slice(0, -5)); } catch { return []; } })());
  if (!names.has(name)) return;
  execFile('/usr/bin/afplay', [`${DIR}/${name}.aiff`], () => undefined).unref();
}
