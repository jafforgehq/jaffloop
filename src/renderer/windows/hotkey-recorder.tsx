// Click, then press the shortcut you want. Needs Ctrl, Alt or Cmd unless it is a function key.
import { useEffect, useState } from 'preact/hooks';
import { Fmt } from '../core';
import { tip } from '../help';
import { api, saveSettings, settings } from '../model';
import { DEFAULT_HOTKEY, recordAccelerator } from './accelerator';

export function HotkeyRecorder() {
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const current = settings.value.hotkey;

  const apply = async (accelerator: string) => {
    if (await api.setHotkey(accelerator)) { setMessage(null); await saveSettings({ hotkey: accelerator }); }
    else setMessage('That shortcut is taken.');
  };

  useEffect(() => {
    if (!recording) return;
    const down = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      const r = recordAccelerator(e);
      if (r.kind === 'wait') return;
      if (r.kind === 'error') { setMessage(r.message); return; }
      setRecording(false);
      if (r.kind === 'ok') void apply(r.accelerator);
    };
    const blur = () => setRecording(false);
    window.addEventListener('keydown', down, true);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('blur', blur); };
  }, [recording]);

  return (
    <div class="row-flex gap10">
      {message && <span class="clay" style={{ fontSize: 11.5 }}>{message}</span>}
      {current !== DEFAULT_HOTKEY && !recording && <button type="button" class="link" title={tip('set.hotkeyReset')} onClick={() => void apply(DEFAULT_HOTKEY)}>Reset</button>}
      <button type="button" class={`hotkey ${recording ? 'rec' : ''}`} aria-label="Capture hotkey" title={tip('set.hotkey')} onClick={() => { setMessage(null); setRecording(!recording); }}>
        {recording ? 'Press shortcut…' : Fmt.hotkeyLabel(current)}
      </button>
    </div>
  );
}
