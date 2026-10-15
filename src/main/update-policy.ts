// Pure rules for self-updates (ported from Jaffer): what the prompt says, when to ask, which builds may update themselves.
import type { UpdateState } from '../shared/api';

const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

/** The feed's version string, or null when it is not a plain version (it ends up in a dialog, so nothing else gets through). */
export function cleanVersion(v: unknown): string | null {
  return typeof v === 'string' && v.length <= 40 && VERSION.test(v) ? v : null;
}

export interface PromptText {
  message: string;
  detail: string;
  buttons: [string, string];
  /** The default button is Later, and Esc means Later: someone typing when the prompt appears must not accept it by accident. */
  defaultId: number;
  cancelId: number;
}

export function promptText(o: { version: string }): PromptText {
  return {
    message: `Jaffloop ${o.version} is ready`,
    detail: 'Jaffloop restarts to finish the update. Your promises and notes stay where they are.\n\nChoose Later to keep working: the update installs when you quit Jaffloop.',
    buttons: ['Update and restart', 'Later'],
    defaultId: 1,
    cancelId: 1,
  };
}

/** A background check does not nag about a version the user already put off; a manual check always answers. */
export function shouldAsk(o: { manual: boolean; declined: string | null; version: string }): boolean {
  return o.manual || o.declined !== o.version;
}

/** Reads `codesign -dvv` output. Only a Developer ID signature can be updated in place (Squirrel checks the next one against it). */
export function signerKind(codesignOutput: string): 'developer-id' | 'adhoc' | 'unsigned' {
  if (/^Authority=Developer ID Application:/m.test(codesignOutput)) return 'developer-id';
  if (/^Signature=adhoc/m.test(codesignOutput)) return 'adhoc';
  return 'unsigned';
}

/** True when `version` is a higher x.y.z than `current` (a dev build, or any text that is not a version, is never updated). */
export function isNewer(version: string, current: string): boolean {
  if (!cleanVersion(version) || !cleanVersion(current)) return false;
  const a = (version.split('-')[0] ?? '').split('.').map(Number);
  const b = (current.split('-')[0] ?? '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export const RELEASES_URL = 'https://github.com/jafforgehq/jaffloop/releases/latest';

/** What the dialog after Check for Updates… says, or null when the update prompt itself is the answer. */
export function manualResult(s: UpdateState): { message: string; detail: string; releases: boolean } | null {
  switch (s.status) {
    case 'uptodate':
      return { message: 'Jaffloop is up to date', detail: `You have ${s.current}, the latest version.`, releases: false };
    case 'downloading':
      return { message: `Downloading Jaffloop ${s.version ?? 'update'}`, detail: 'Jaffloop will ask when it is ready to install.', releases: false };
    case 'unavailable':
      return { message: 'Updates are off in this build', detail: s.error ?? 'Only the signed release downloaded from GitHub updates itself. The latest version is always on the releases page.', releases: true };
    case 'error':
      return { message: 'Could not check for updates', detail: s.error ?? 'Unknown error.', releases: true };
    default:
      return null;
  }
}

/** The test-only feed override (JAFFLOOP_UPDATE_FEED): https anywhere, plain http only to this machine. */
export function isAllowedFeedUrl(u: string): boolean {
  return /^https:\/\/\S+$/i.test(u) || /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?(\/\S*)?$/i.test(u);
}

/** Why an app that cannot replace itself should not check for updates (null when it can). */
export function bundleProblem(bundlePath: string, writableParent: boolean): string | null {
  if (bundlePath.includes('/AppTranslocation/')) return 'Jaffloop is running from a temporary location. Move it to your Applications folder and open it again to turn updates on.';
  if (!writableParent) return 'Jaffloop cannot replace itself where it is installed (a disk image, or a folder you cannot write to). Copy it to your Applications folder to turn updates on.';
  return null;
}
