/** True while the e2e suite drives the app: nothing may pop up over the developer's work (windows go off-screen and inactive, no sounds, no notifications, no Dock icon). JAFFLOOP_E2E_VISIBLE=1 turns it off to watch a test run. */
export const quiet = process.env.JAFFLOOP_E2E === '1' && process.env.JAFFLOOP_E2E_VISIBLE !== '1';
