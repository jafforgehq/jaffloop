import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Fmt } from '../core';
import { api, settings } from '../model';
import { Kbd } from './ui';

/** "All loops closed": the ring completes. Used by every empty list (override the words per screen). */
export function AllClosed({ title = 'All loops closed', message = 'Nothing owed, nothing slipping.', showCapture = true, children }: { title?: string; message?: string; showCapture?: boolean; children?: ComponentChildren }) {
  const [closed, setClosed] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setClosed(true)); return () => cancelAnimationFrame(t); }, []);
  return (
    <div class="center-col">
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="30" fill="none" stroke="var(--hairline)" stroke-width="3" />
        <circle cx="32" cy="32" r="30" fill="none" stroke="var(--text2)" stroke-width="3" stroke-linecap="round" pathLength={100}
          stroke-dasharray="100" stroke-dashoffset={closed ? 0 : 100} style={{ transform: 'rotate(-90deg)', transformOrigin: 'center', transition: 'stroke-dashoffset 0.9s ease-in-out' }} />
      </svg>
      <div class="title sm">{title}</div>
      <div class="dim" style={{ fontSize: 12.5, maxWidth: 360 }}>{message}</div>
      {children}
      {showCapture && (
        <button type="button" class="btn" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }} onClick={() => void api.openCapture()}>
          New capture <Kbd>{Fmt.hotkeyLabel(settings.value.hotkey)}</Kbd>
        </button>
      )}
    </div>
  );
}
