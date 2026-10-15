import { Fmt } from '../core';
import { dismissWelcome, settings, showWelcome } from '../model';
import { GhostButton, LoopRing, PrimaryButton } from '../components/ui';

/** First run: a short welcome that can be skipped. */
export function WelcomeView() {
  if (!showWelcome.value) return null;
  const key = Fmt.hotkeyLabel(settings.value.hotkey);
  const step = (n: string, title: string, body: string) => (
    <div class="wl-step">
      <span class="wl-n">{n}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div>
        <div class="dim" style={{ fontSize: 12.5 }}>{body}</div>
      </div>
    </div>
  );
  return (
    <div class="overlay center">
      <div class="card wl-card" role="dialog" aria-label="Welcome to Jaffloop">
        <div class="row-flex gap10" style={{ gap: 12 }}>
          <LoopRing size={26} line={2.2} />
          <h2 class="title" style={{ fontSize: 22 }}>Welcome to Jaffloop</h2>
        </div>
        <div class="dim" style={{ fontSize: 13 }}>Track what you owe people, what they owe you, what to bring up, and what you told them. Everything stays on this Mac.</div>
        {step('1', 'Capture from anywhere', `Press ${key}, type owe @sara review RFC fri, press ⏎. Change the shortcut in Settings.`)}
        {step('2', 'Work the list with the keyboard', 'j and k to move, ⏎ to complete, s to snooze, space for details. Press ? any time for the full list.')}
        {step('3', 'Let Claude help', 'Settings → Claude (MCP) has the one command that connects Claude to your data. Nothing is shared until you do.')}
        {step('4', 'See what changes', "What's new and the roadmap are at the bottom of the sidebar.")}
        <div class="row-flex gap10" style={{ justifyContent: 'flex-end' }}>
          <GhostButton onClick={() => dismissWelcome(true)}>Add an example item</GhostButton>
          <PrimaryButton onClick={() => dismissWelcome()}>Start</PrimaryButton>
        </div>
      </div>
    </div>
  );
}
