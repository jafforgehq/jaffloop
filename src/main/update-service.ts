// Wires UpdateController to electron-updater, the dialogs and the windows. Everything testable lives in updates.ts / update-policy.ts.
import { app, BrowserWindow, dialog, Notification, shell } from 'electron';
import { quiet } from './quiet';
import { autoUpdater } from 'electron-updater';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { UpdateState } from '../shared/api';
import { bundleProblem, isAllowedFeedUrl, manualResult, RELEASES_URL, signerKind } from './update-policy';
import { UpdateController, type UpdaterLike } from './updates';

export interface UpdateServiceDeps {
  /** a writable folder for the test feed's config file (the user-data dir) */
  dataDir: string;
  /** ui.autoUpdateCheck */
  auto(): boolean;
  onState(s: UpdateState): void;
  log(msg: string): void;
  /** is one of the app's own windows (not the capture panel or popover) focused? */
  appFocused(): boolean;
  /** bring a window to the front so a dialog has a parent */
  showWindow(): void;
  /** for the prompt's parent */
  parent(): BrowserWindow | null;
  /** the app is about to quit for the install */
  willInstall?(): void;
}

const noUpdater: UpdaterLike = { on: () => undefined, checkForUpdates: async () => null, quitAndInstall: () => undefined };

/** `codesign -dvv` of the running bundle: only a Developer ID signed app can be updated in place. */
function bundleSigner(bundle: string): Promise<ReturnType<typeof signerKind>> {
  return new Promise((resolve) => {
    execFile('/usr/bin/codesign', ['-dvv', bundle], { timeout: 10_000 }, (_err, stdout, stderr) => resolve(signerKind(`${stdout}\n${stderr}`)));
  });
}

export class UpdateService {
  controller: UpdateController;

  private constructor(private d: UpdateServiceDeps, controller: UpdateController) {
    this.controller = controller;
  }

  static async create(d: UpdateServiceDeps): Promise<UpdateService> {
    const bundle = path.resolve(process.execPath, '..', '..', '..');
    const feed = process.env.JAFFLOOP_UPDATE_FEED;
    const feedOk = !!feed && isAllowedFeedUrl(feed);
    let unavailable: string | undefined;
    let eligible = false;
    if (process.env.JAFFLOOP_NO_UPDATER === '1') unavailable = 'Updates are switched off for this run (JAFFLOOP_NO_UPDATER).';
    else if (feedOk) eligible = true; // tests: a local feed, no signature needed
    else if (!app.isPackaged) unavailable = 'This is a development build. Updates work in the signed release downloaded from GitHub.';
    else {
      let writable = true;
      try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); } catch { writable = false; }
      const kind = await bundleSigner(bundle);
      if (kind !== 'developer-id') unavailable = 'This copy of Jaffloop is not signed with a Developer ID, so it cannot update itself. Download the latest release from GitHub.';
      else unavailable = bundleProblem(bundle, writable) ?? undefined;
      eligible = !unavailable;
    }

    if (eligible) {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.allowPrerelease = false;
      autoUpdater.logger = { info: (m: unknown) => d.log(String(m)), warn: (m: unknown) => d.log(`warn ${m}`), error: (m: unknown) => d.log(`error ${m}`), debug: () => undefined };
      if (feedOk) {
        autoUpdater.forceDevUpdateConfig = true;
        // an unpackaged app has no app-update.yml: give the updater one that names the feed and a throw-away cache folder
        const cfg = path.join(d.dataDir, 'dev-app-update.yml');
        fs.mkdirSync(d.dataDir, { recursive: true });
        fs.writeFileSync(cfg, `provider: generic\nurl: ${JSON.stringify(feed)}\nupdaterCacheDirName: jaffloop-updater-test\n`);
        (autoUpdater as unknown as { updateConfigPath: string }).updateConfigPath = cfg;
        autoUpdater.allowDowngrade = true; // a test feed may carry any version; the controller still only accepts newer ones
        autoUpdater.setFeedURL({ provider: 'generic', url: feed });
      } else autoUpdater.allowDowngrade = false;
    }

    let svc!: UpdateService;
    const controller = new UpdateController({
      updater: eligible ? autoUpdater : noUpdater,
      current: app.getVersion(),
      enabled: eligible,
      unavailableReason: unavailable,
      auto: d.auto,
      ask: async (text, version, manual) => {
        const scripted = process.env.JAFFLOOP_UPDATE_ANSWER; // tests: answer the prompt without a dialog ("install" or "later")
        if (scripted) return scripted === 'install';
        if (manual) d.showWindow();
        else await svc.whenFocused(version);
        const t = text();
        const parent = d.parent();
        const opts = { type: 'info' as const, message: t.message, detail: t.detail, buttons: [...t.buttons], defaultId: t.defaultId, cancelId: t.cancelId };
        const r = parent && parent.isVisible() ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
        return r.response === 0;
      },
      prepareInstall: async () => d.willInstall?.(),
      log: d.log,
      onState: d.onState,
    });
    svc = new UpdateService(d, controller);
    controller.start();
    return svc;
  }

  state(): UpdateState { return this.controller.state(); }

  /** The prompt must be seen: when no Jaffloop window is focused, nudge with a notification and ask once one is. */
  private async whenFocused(version: string): Promise<void> {
    if (this.d.appFocused()) return;
    if (Notification.isSupported()) {
      const n = new Notification({ title: `Jaffloop ${version} is ready`, body: 'Click to review the update.', silent: true });
      n.on('click', () => this.d.showWindow());
      if (!quiet) n.show();
    }
    await new Promise<void>((resolve) => {
      const check = () => { if (this.d.appFocused()) { app.off('browser-window-focus', check); resolve(); } };
      app.on('browser-window-focus', check);
    });
  }

  /** Check for Updates...: always answers, with a dialog for up to date / error. The update prompt itself comes from the controller. */
  async check(manual: boolean): Promise<UpdateState> {
    if (!manual) return this.controller.checkBackground();
    const s = await this.controller.checkNow();
    const r = manualResult(s);
    if (!r) return s;
    const parent = this.d.parent();
    const opts = { type: 'info' as const, message: r.message, detail: r.detail, buttons: r.releases ? ['Open releases page', 'OK'] : ['OK'], defaultId: r.releases ? 1 : 0 };
    const res = parent && parent.isVisible() ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
    if (r.releases && res.response === 0) void shell.openExternal(RELEASES_URL);
    return s;
  }

  async install(): Promise<void> { await this.controller.installNow(); }
  dispose(): void { this.controller.stop(); }
}
