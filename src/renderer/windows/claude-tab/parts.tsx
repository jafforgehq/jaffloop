// Small layout pieces for the Claude tab. Same markup and classes as the ones in settings.tsx (they are private there).
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Info } from '../../components/info';

export const Group = ({ title, info, children }: { title?: string; info?: string; children: ComponentChildren }) => (
  <>{title && <h3 class="set-h">{title}{info && <Info text={info} label="More about this section" />}</h3>}<div class="form-group">{children}</div></>
);

/** A settings row: label with its (i), optional hint under it, the control on the right. */
export const Row = ({ label, info, hint, children }: { label: string; info: string; hint?: ComponentChildren; children?: ComponentChildren }) => (
  <div class="form-row">
    <div><div>{label}<Info text={info} label="More about this setting" /></div>{hint && <div class="dim" style={{ fontSize: 11.5, marginTop: 2 }}>{hint}</div>}</div>
    <div class="row-flex gap8">{children}</div>
  </div>
);

export const Note = ({ children }: { children: ComponentChildren }) => <p class="dim set-note">{children}</p>;

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} class={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><span /></button>;
}

/** Copies through the main process and shows "Copied" for a moment. */
export function useCopied(): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  return [copied, () => { setCopied(true); setTimeout(() => setCopied(false), 1800); }];
}
