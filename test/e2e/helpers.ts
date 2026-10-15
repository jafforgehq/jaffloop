// Launches the built app (dist/) with a throw-away database and user-data directory. Never touches ~/Library/Application Support/Jaffloop.
import electronPath from 'electron';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface LaunchOptions {
  /** fill the empty database with the demo data (default true) */
  seed?: boolean;
  /** extra environment variables (e.g. JAFFLOOP_UPDATE_FEED) */
  env?: Record<string, string>;
  /** command line flags after the app path (e.g. ['--background']) */
  args?: string[];
  /** reuse these directories (to restart the app against the same data) */
  dir?: string;
  /** do not wait for the main window */
  noMain?: boolean;
}

export interface Launched {
  app: ElectronApplication;
  /** the main window (undefined with noMain) */
  window: Page;
  dir: string;
  dbPath: string;
  userData: string;
  /** find an open window by its ?view= */
  view(name: string): Page | undefined;
  /** wait for a window with ?view=<name> */
  waitView(name: string, timeout?: number): Promise<Page>;
  close(): Promise<void>;
}

export async function launchApp(o: LaunchOptions = {}): Promise<Launched> {
  const dir = o.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'jaffloop-e2e-'));
  const dbPath = path.join(dir, 'jaffloop.sqlite');
  const userData = path.join(dir, 'app-data');
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v; // the GUI must not start as plain Node
  Object.assign(env, { JAFFLOOP_DB: dbPath, JAFFLOOP_USERDATA: userData, JAFFLOOP_NO_UPDATER: '1', JAFFLOOP_E2E: '1', ...(o.seed === false ? {} : { JAFFLOOP_SEED: '1' }), ...o.env });
  const app = await _electron.launch({ executablePath: electronPath as unknown as string, args: [ROOT, ...(o.args ?? [])], env });
  const view = (name: string): Page | undefined => app.windows().find((w) => new URL(w.url() || 'about:blank').searchParams.get('view') === name);
  const waitView = async (name: string, timeout = 15_000): Promise<Page> => {
    const t0 = Date.now();
    for (;;) {
      const w = view(name);
      if (w) { await w.emulateMedia({ colorScheme: null }); /* Playwright pins prefers-color-scheme to light otherwise */ await w.waitForFunction(() => document.body?.dataset.ready === '1' || (document.getElementById('root')?.childElementCount ?? 0) > 0, undefined, { timeout }); return w; }
      if (Date.now() - t0 > timeout) throw new Error(`no ${name} window after ${timeout} ms`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const window = o.noMain ? (undefined as unknown as Page) : await waitView('main');
  return {
    app, window, dir, dbPath, userData, view, waitView,
    close: async () => { await app.close().catch(() => undefined); },
  };
}

/** Removes the temp directory of a finished test. */
export function cleanup(l: Launched): void {
  fs.rmSync(l.dir, { recursive: true, force: true });
}

/** A local update feed (electron-updater "generic" provider) that offers `version`. The "zip" is arbitrary bytes: nothing unpacks it until an install. */
export async function startFeed(version: string): Promise<{ url: string; requests: string[]; close(): Promise<void> }> {
  const { createServer } = await import('node:http');
  const { createHash } = await import('node:crypto');
  const body = Buffer.from(`not really a zip ${version}`);
  const sha = createHash('sha512').update(body).digest('base64');
  const names = [`Jaffloop-${version}-arm64.zip`, `Jaffloop-${version}-x64.zip`];
  const yml = `version: ${version}\nfiles:\n${names.map((n) => `  - url: ${n}\n    sha512: ${sha}\n    size: ${body.length}\n`).join('')}path: ${names[0]}\nsha512: ${sha}\nreleaseDate: '2026-10-15T00:00:00.000Z'\n`;
  const requests: string[] = [];
  const srv = createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '').split('?')[0]!.slice(1));
    requests.push(name);
    if (name === 'latest-mac.yml') res.end(yml);
    else if (names.includes(name)) res.end(body);
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise<void>((r) => srv.close(() => r())) };
}
