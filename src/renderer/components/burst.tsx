// The ring closes, then small dots fly out and fade (about 1.4 s). Plays when Overdue, Slipping and Inbox all reach zero.
import { useEffect } from 'preact/hooks';
import { burstDots } from '../speed-logic';

const DOTS = burstDots();

export function Burst({ onDone }: { onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 1700); return () => clearTimeout(t); }, []);
  return (
    <div class="burst" aria-hidden="true" data-testid="burst">
      <svg width="84" height="84" viewBox="0 0 84 84">
        <circle cx="42" cy="42" r="38" fill="none" stroke="var(--hairline)" stroke-width="3" />
        <circle class="burst-ring" cx="42" cy="42" r="38" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" pathLength={100} />
      </svg>
      {DOTS.map((d, i) => <span key={i} class="burst-dot" style={{ '--dx': `${d.dx}px`, '--dy': `${d.dy}px`, animationDelay: `${520 + d.delay}ms` } as never} />)}
    </div>
  );
}
