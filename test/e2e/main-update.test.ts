import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { cleanup, launchApp, startFeed, type Launched } from './helpers';

const VERSION: string = createRequire(import.meta.url)('../../package.json').version;
let l: Launched | undefined;
afterEach(async () => { await l?.close(); if (l) cleanup(l); l = undefined; });

describe('updates against a local feed', () => {
  it('finds a newer version, downloads it in the background and reports it ready', async () => {
    const feed = await startFeed('9.9.9');
    try {
      l = await launchApp({ env: { JAFFLOOP_NO_UPDATER: '', JAFFLOOP_UPDATE_FEED: feed.url, JAFFLOOP_UPDATE_ANSWER: 'later' } });
      expect(await l.window.evaluate(() => window.jaffloop.updateState())).toMatchObject({ status: 'idle', current: VERSION });
      await l.window.evaluate(() => { (window as any).__states = []; window.jaffloop.on('update-state', (s) => (window as any).__states.push(s.status)); });
      await l.window.evaluate(() => window.jaffloop.checkForUpdates(false));
      await l.window.waitForFunction(() => (window as any).__states.includes('ready'), undefined, { timeout: 20_000 });
      expect(await l.window.evaluate(() => window.jaffloop.updateState())).toMatchObject({ status: 'ready', version: '9.9.9' });
      expect(feed.requests).toContain('latest-mac.yml');
    } finally { await feed.close(); }
  });

  it('is unavailable (with a reason) in a development build', async () => {
    l = await launchApp({ env: { JAFFLOOP_NO_UPDATER: '' } });
    const s = await l.window.evaluate(() => window.jaffloop.updateState());
    expect(s.status).toBe('unavailable');
    expect(s.error).toMatch(/development build/i);
  });
});
