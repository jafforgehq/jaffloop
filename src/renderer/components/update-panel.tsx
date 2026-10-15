import { api, info, ui, updateState } from '../model';
import { Fmt } from '../core';
import { Icon } from './icons';
import { PrimaryButton } from './ui';

/** Version, update status and the auto-check switch. Used by the What's new page and Settings → About. */
export function UpdatePanel() {
  const u = updateState.value;
  const busy = u.status === 'checking' || u.status === 'downloading';
  const check = async () => { updateState.value = await api.checkForUpdates(true); };
  return (
    <div class="update-panel">
      <div class="row-flex gap10" style={{ flexWrap: 'wrap' }}>
        {u.status === 'ready'
          ? <PrimaryButton onClick={() => void api.installUpdate()}>Restart to update</PrimaryButton>
          : <PrimaryButton onClick={() => void check()} disabled={busy || u.status === 'unavailable'}>{u.status === 'checking' ? 'Checking…' : 'Check for updates'}</PrimaryButton>}
        <span class="dim" style={{ fontSize: 12 }}>Version {u.current || info.value.version}</span>
        <Status />
      </div>
      {u.version && u.notes && ['downloading', 'ready'].includes(u.status) && <div class="update-notes dim">{u.notes}</div>}
      <label class="toggle" style={{ fontSize: 12.5 }}>
        <input type="checkbox" checked={ui.value.autoUpdateCheck} onChange={(e) => void api.setUiState({ autoUpdateCheck: (e.target as HTMLInputElement).checked })} />
        Check automatically
      </label>
      <div class="dim" style={{ fontSize: 11.5 }}>Jaffloop contacts GitHub only to look for new versions. Turn automatic checks off here; you can still press Check for updates.</div>
    </div>
  );
}

function Status() {
  const u = updateState.value;
  const small = { fontSize: 12 } as const;
  switch (u.status) {
    case 'checking': return <span class="dim" style={small}>Checking for updates…</span>;
    case 'uptodate': return <span class="dim row-flex gap6" style={small}><Icon name="circlecheck" size={13} />You're up to date</span>;
    case 'downloading': return <span class="row-flex gap6" style={{ ...small, color: 'var(--accent)', fontWeight: 500 }}><Icon name="arrowdown" size={13} />Version {u.version} is available · downloading {Math.round(u.progress ?? 0)}%</span>;
    case 'ready': return <span class="row-flex gap6" style={{ ...small, color: 'var(--accent)', fontWeight: 500 }}><Icon name="arrowdown" size={13} />Version {u.version} is ready</span>;
    case 'error': return <span class="clay" style={small}>{u.error ?? 'Could not check for updates.'}</span>;
    case 'unavailable': return <span class="dim" style={small}>Updates are not available in this build.</span>;
    default: return u.lastChecked ? <span class="dim" style={small}>Last checked {Fmt.short(u.lastChecked, 'd MMM HH:mm')}</span> : null;
  }
}
