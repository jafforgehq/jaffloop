// End-of-day card: once a weekday, after the end-of-day time, while the main window is open. Never shown twice a day.
import { useEffect, useState } from 'preact/hooks';
import { api, go, overdueCount, settings, ui } from '../model';
import { localDay, wrapupDue, wrapupText } from '../reports-logic';
import { startOfDay } from '../ui-logic';
import { tip } from '../help';
import { Help } from './info';
import { GhostButton, PrimaryButton } from './ui';

export function WrapupCard() {
  const [stats, setStats] = useState<{ closed: number } | null>(null);

  useEffect(() => {
    let busy = false;
    const check = async () => {
      if (busy) return;
      const now = Date.now();
      if (!wrapupDue(now, settings.value.eodTime, ui.value.wrapupDay)) return;
      busy = true;
      try {
        const events = await api.activity(startOfDay(now), 500);
        await api.setUiState({ wrapupDay: localDay(now) }); // shown counts as done for the day, even when the window closes before a click
        setStats({ closed: events.filter((e) => e.event === 'completed').length });
      } catch { /* try again in a minute */ } finally { busy = false; }
    };
    void check();
    const t = setInterval(() => { void check(); }, 60_000);
    return () => clearInterval(t);
  }, []);

  if (!stats) return null;
  const dismiss = () => setStats(null);
  return (
    <div class="wrapup pillbar" role="status" aria-live="polite" data-testid="wrapup">
      <div class="wrapup-msg">{wrapupText(stats.closed, overdueCount.value)}<Help id="wrapup.card" /></div>
      <div class="row-flex gap8">
        <PrimaryButton title={tip('wrapup.open')} onClick={() => { go('review'); dismiss(); }}>Open review</PrimaryButton>
        <GhostButton onClick={dismiss}>Dismiss</GhostButton>
      </div>
    </div>
  );
}
