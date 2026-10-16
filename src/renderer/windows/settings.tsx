// Settings: General, Notifications, Claude (MCP), Data, About.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AccentChoice, AppearanceChoice, Density, SettingsTab, UiState } from '../../shared/api';
import type { CaptureTemplate, Item, Settings } from '../../shared/types';
import { Icon } from '../components/icons';
import { ItemRow } from '../components/item-row';
import { GhostButton, IconButton, Segmented } from '../components/ui';
import { ThemePicker } from '../components/theme-picker';
import { UpdatePanel } from '../components/update-panel';
import { Fmt } from '../core';
import { api, info, pauseNotifications, saveSettings, savePerson, settings, snapshot, summaries, ui } from '../model';
import { normalizeJiraBase, pausedUntilLabel, savableTemplates, templateLines, toDraft, tomorrowAt9, validateTemplateName, type TemplateDraft } from '../speed-logic';
import { ClaudePrompts } from './claude-prompts';
import { accentFor } from '../themes';
import { HotkeyRecorder } from './hotkey-recorder';
import { useReady } from './util';

const TABS: Array<{ id: SettingsTab; label: string; icon: string }> = [
  { id: 'general', label: 'General', icon: 'gear' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'mcp', label: 'Claude (MCP)', icon: 'sparkles' },
  { id: 'data', label: 'Data', icon: 'drive' },
  { id: 'about', label: 'About', icon: 'info' },
];
const SOUNDS = ['None', 'Tink', 'Glass', 'Pop', 'Purr', 'Ping', 'Morse', 'Hero', 'Bottle', 'Funk'];
const ACCENTS: Array<{ id: AccentChoice; label: string; color: string }> = [
  { id: 'graphite', label: 'Graphite', color: '#76736c' }, { id: 'blue', label: 'Blue', color: '#4a7fc0' }, { id: 'green', label: 'Green', color: '#4d8d63' },
  { id: 'violet', label: 'Violet', color: '#7c66bd' }, { id: 'amber', label: 'Amber', color: '#c08a2e' },
];
const DENSITIES: Array<{ value: Density; label: string }> = [{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }, { value: 'spacious', label: 'Spacious' }];
const isTab = (s: unknown): s is SettingsTab => TABS.some((t) => t.id === s);

// ---- small controls ----

const Row = ({ label, children, hint }: { label: ComponentChildren; children?: ComponentChildren; hint?: ComponentChildren }) => (
  <div class="form-row"><div><div>{label}</div>{hint && <div class="dim" style={{ fontSize: 11.5, marginTop: 2 }}>{hint}</div>}</div><div class="row-flex gap8">{children}</div></div>
);
const Group = ({ title, children }: { title?: string; children: ComponentChildren }) => (
  <>{title && <h3 class="set-h">{title}</h3>}<div class="form-group">{children}</div></>
);
const Note = ({ children }: { children: ComponentChildren }) => <p class="dim set-note">{children}</p>;

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} class={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><span /></button>;
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <span class="stepper">
      <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
      <span class="tnum">{value}</span>
      <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
    </span>
  );
}

function TimeField({ k, label }: { k: 'eodTime' | 'workStart' | 'workEnd' | 'morningBrief'; label: string }) {
  return <input type="time" class="input time" aria-label={label} value={settings.value[k]} onChange={(e) => { const v = (e.target as HTMLInputElement).value; if (v) void saveSettings({ [k]: v } as Partial<Settings>); }} />;
}

function sample(): Item {
  const t = new Date();
  const tomorrow = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1).getTime();
  return {
    id: 'sample', kind: 'owe', title: 'Review RFC for the on-call rotation', body: 'Sara asked for comments before Friday', quote: null, personId: null, status: 'open',
    dueAt: tomorrow, dueHasTime: false, remindAt: null, snoozedUntil: null, snoozeCount: 0, recurRule: null, pinned: false, inbox: false, source: 'hotkey',
    createdAt: Date.now(), updatedAt: Date.now(), completedAt: null, lastTouchedAt: Date.now(),
    externalId: null, sourceLabel: null, sourceUrl: null, interactionId: null, proposed: false,
  };
}

function SoundRow({ label, k }: { label: string; k: 'soundSave' | 'soundComplete' | 'soundUndo' }) {
  const v = ui.value[k];
  return (
    <Row label={label}>
      <select class="input" style={{ width: 120 }} aria-label={`${label} sound`} value={v} onChange={(e) => void api.setUiState({ [k]: (e.target as HTMLSelectElement).value } as Partial<UiState>)}>
        {SOUNDS.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <IconButton title="Preview" label={`Preview ${label} sound`} onClick={() => { if (v !== 'None') void api.playSound(v); }}><Icon name="sound" size={14} /></IconButton>
    </Row>
  );
}

// ---- tabs ----

function General() {
  const s = settings.value, u = ui.value;
  const density = u.density;
  return (
    <>
      <Group>
        <Row label="Capture hotkey"><HotkeyRecorder /></Row>
        <div class="form-row stack"><div>Theme</div><ThemePicker /></div>
        <Row label="Appearance" hint={u.theme !== 'classic' ? 'Classic follows macOS; other themes are always light or dark' : undefined}>
          <select class="input" style={{ width: 120 }} aria-label="Appearance" disabled={u.theme !== 'classic'} value={u.appearance} onChange={(e) => void api.setUiState({ appearance: (e.target as HTMLSelectElement).value as AppearanceChoice })}>
            <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
          </select>
        </Row>
        <Row label="Accent">
          <span class="row-flex gap10">
            {ACCENTS.map((a) => (
              <button type="button" key={a.id} class={`swatch ${u.accent === a.id ? 'on' : ''}`} style={{ background: accentFor(u.theme, a.id, matchMedia('(prefers-color-scheme: dark)').matches) }} title={a.label} aria-label={`${a.label} accent`} aria-pressed={u.accent === a.id} onClick={() => void api.setUiState({ accent: a.id })} />
            ))}
          </span>
        </Row>
        <Row label="Row density"><Segmented label="Row density" value={density} options={DENSITIES} onChange={(d) => void api.setUiState({ density: d })} /></Row>
        <div class="density-previews">
          {DENSITIES.map((d) => (
            <div key={d.value} class={`density-preview ${density === d.value ? 'on' : ''}`}>
              <div class="caps" style={{ fontSize: 11, padding: '4px 8px 0' }}>{d.label}</div>
              <div style={{ pointerEvents: 'none' }}><ItemRow item={sample()} showPerson={false} densityOverride={d.value} /></div>
            </div>
          ))}
        </div>
        <Row label="Sounds"><Switch label="Sounds" on={s.sound} onChange={(v) => void saveSettings({ sound: v })} /></Row>
        {s.sound && <><SoundRow label="Save" k="soundSave" /><SoundRow label="Complete" k="soundComplete" /><SoundRow label="Undo" k="soundUndo" /></>}
        <Row label="Menu bar shows">
          <select class="input" style={{ width: 150 }} aria-label="Menu bar shows" value={u.trayText} onChange={(e) => void api.setUiState({ trayText: (e.target as HTMLSelectElement).value as UiState['trayText'] })}>
            <option value="count">Overdue count</option><option value="next">Next item due</option>
          </select>
        </Row>
        <Row label="Show anniversaries and birthdays" hint="A reminder under Check in on Today"><Switch label="Show anniversaries and birthdays" on={u.showDates} onChange={(v) => void api.setUiState({ showDates: v })} /></Row>
        <JiraField />
        <Row label="End of day (eod)"><TimeField k="eodTime" label="End of day" /></Row>
        <Row label={`Stale wait: ${s.staleDaysAfterDue} days after due`}><Stepper label="stale wait days" value={s.staleDaysAfterDue} min={1} max={30} onChange={(v) => void saveSettings({ staleDaysAfterDue: v })} /></Row>
        <Row label={`Stale undated wait: ${s.staleDaysNoDue} days after creation`}><Stepper label="stale undated wait days" value={s.staleDaysNoDue} min={1} max={30} onChange={(v) => void saveSettings({ staleDaysNoDue: v })} /></Row>
      </Group>
      <Group title="People">
        <Row label="People" hint="Add your team one person at a time: position, birthday, 1:1 cadence."><GhostButton onClick={() => void api.openMain('add-people')}>Add people…</GhostButton></Row>
      </Group>
      <Templates />
    </>
  );
}

function JiraField() {
  const [v, setV] = useState(settings.value.jiraBaseUrl);
  const bad = normalizeJiraBase(v) == null;
  const commit = () => { const n = normalizeJiraBase(v); if (n != null && n !== settings.value.jiraBaseUrl) { setV(n); void saveSettings({ jiraBaseUrl: n }); } };
  return (
    <Row label="Jira base URL" hint={<>Keys like ABC-123 in titles become links to this address + the key. Leave empty for no key links. {bad && <span class="tpl-err">Start with https://</span>}</>}>
      <input class="input wide" aria-label="Jira base URL" placeholder="https://yourcompany.atlassian.net/browse/" spellcheck={false} value={v}
        onInput={(e) => setV((e.target as HTMLInputElement).value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </Row>
  );
}

function Templates() {
  const [drafts, setDrafts] = useState<TemplateDraft[]>(() => settings.value.captureTemplates.map(toDraft));
  const save = (d: TemplateDraft[]) => { void saveSettings({ captureTemplates: savableTemplates(d, Fmt.isPrefix) as CaptureTemplate[] }); };
  const latest = useRef(drafts);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const change = (next: TemplateDraft[]) => { latest.current = next; setDrafts(next); clearTimeout(timer.current); timer.current = setTimeout(() => save(next), 400); };
  const flush = () => { clearTimeout(timer.current); save(latest.current); };
  const edit = (i: number, patch: Partial<TemplateDraft>) => change(drafts.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <>
      <Group title="Capture templates">
        {drafts.map((d, i) => {
          const err = validateTemplateName(d.name, drafts.filter((_, j) => j !== i).map((x) => x.name), Fmt.isPrefix) ?? (templateLines(d.text).length ? null : 'Add at least one line.');
          return (
            <div class="form-row stack" key={i}>
              <div class="tpl-card">
                <div class="row-flex gap8">
                  <input class="input" style={{ width: 150 }} aria-label={`Template ${i + 1} name`} placeholder="prep" spellcheck={false} value={d.name}
                    onInput={(e) => edit(i, { name: (e.target as HTMLInputElement).value.trim() })} onBlur={flush} />
                  <span class="grow" />
                  <GhostButton label={`Remove template ${d.name || i + 1}`} onClick={() => { const n = drafts.filter((_, j) => j !== i); latest.current = n; setDrafts(n); flush(); }}>Remove</GhostButton>
                </div>
                <textarea class="input" aria-label={`Template ${i + 1} lines`} rows={3} spellcheck={false} placeholder={'bring @{person} how are things going\nbring @{person} career goals'}
                  value={d.text} onInput={(e) => edit(i, { text: (e.target as HTMLTextAreaElement).value })} onBlur={flush} />
                {err && <div class="tpl-err">{err}</div>}
              </div>
            </div>
          );
        })}
        <div class="form-row" style={{ justifyContent: 'flex-start' }}>
          <GhostButton onClick={() => change([...drafts, { name: '', text: '' }])}>Add template</GhostButton>
        </div>
        <div class="form-row"><Note>One capture line per line. Use {'{person}'} for the @handle and {'{rest}'} for the text after it. Typing <span class="mono">prep @sara</span> in the capture bar creates every line of the <span class="mono">prep</span> template for Sara.</Note></div>
      </Group>
    </>
  );
}

function Notifications() {
  const u = ui.value;
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);
  const now = Date.now();
  const paused = u.pauseUntil != null && u.pauseUntil > now;
  return (
    <>
    <Group title="Pause">
      <Row label={paused ? <span data-testid="pause-status">Notifications are paused until {pausedUntilLabel(u.pauseUntil!, now, Fmt.short)}</span> : 'Notifications are on'}>
        {paused && <GhostButton onClick={() => void pauseNotifications(null)}>Resume</GhostButton>}
        <GhostButton onClick={() => void pauseNotifications(Date.now() + 3_600_000)}>Pause 1 hour</GhostButton>
        <GhostButton onClick={() => void pauseNotifications(tomorrowAt9(Date.now()))}>Pause until tomorrow</GhostButton>
      </Row>
    </Group>
    <Group title="Schedule">
      <Row label="Working hours start"><TimeField k="workStart" label="Working hours start" /></Row>
      <Row label="Working hours end"><TimeField k="workEnd" label="Working hours end" /></Row>
      <Row label="Morning brief (weekdays)"><TimeField k="morningBrief" label="Morning brief" /></Row>
      <div class="form-row"><Note>No notifications outside working hours or on weekends, except reminders you set explicitly. At most one notification every 10 minutes; items in the same window are batched.</Note></div>
    </Group>
    </>
  );
}

function Mcp() {
  const [copied, setCopied] = useState(false);
  const cmd = info.value.mcpCommand;
  const log = snapshot.value.auditLog.slice(0, 8);
  return (
    <>
      <Group title="Connect">
        <div class="form-row" style={{ display: 'block' }}><code class="mcp-cmd">{cmd}</code></div>
        <div class="form-row" style={{ justifyContent: 'flex-start' }}>
          <GhostButton onClick={() => { void api.copyText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>{copied ? 'Copied' : 'Copy command'}</GhostButton>
          <span class="dim" style={{ fontSize: 11 }}>Claude Code. For Claude Desktop add the same binary as a stdio server.</span>
        </div>
      </Group>
      <h3 class="set-h">Ready-made prompts</h3>
      <ClaudePrompts />
      <Group title="Review">
        <Row label="Review what Claude adds first" hint="Items Claude adds wait in your Inbox until you accept them. Until then they stay out of Today, counts and notifications.">
          <Switch label="Review what Claude adds first" on={settings.value.reviewClaudeItems} onChange={(v) => void saveSettings({ reviewClaudeItems: v })} />
        </Row>
      </Group>
      <Group title="Privacy">
        <Row label="Read-only: block all write tools"><Switch label="Read-only" on={settings.value.mcpReadOnly} onChange={(v) => void saveSettings({ mcpReadOnly: v })} /></Row>
        {summaries.value.map((x) => (
          <Row key={x.person.id} label={x.person.name}><Switch label={`Hide ${x.person.name} from Claude`} on={x.person.hiddenFromClaude} onChange={(v) => void savePerson({ ...x.person, hiddenFromClaude: v })} /></Row>
        ))}
        <div class="form-row"><Note>People toggled on are hidden from Claude: excluded from every tool and resource.</Note></div>
      </Group>
      <Group title="Recent MCP calls">
        {log.length === 0 && <div class="form-row dim">None yet.</div>}
        {log.map((e) => (
          <div key={e.id} class="form-row audit">
            <span class="dim tnum" style={{ fontSize: 11 }}>{Fmt.short(e.at, 'd MMM HH:mm')}</span>
            <span class="mono">{e.tool}</span>
            <span class="dim grow" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.summary}</span>
            {e.wrote && <span class="mono clay" style={{ fontSize: 10 }}>wrote</span>}
          </div>
        ))}
      </Group>
    </>
  );
}

function Data() {
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <Group>
      <Row label="Database"><span class="dim mono db-path" title={info.value.dbPath}>{info.value.dbPath}</span></Row>
      <div class="form-row" style={{ justifyContent: 'flex-start' }}>
        <GhostButton onClick={() => void api.revealDatabase()}>Reveal in Finder</GhostButton>
        <GhostButton onClick={() => void api.exportData().then(setSaved)}>Export everything as JSON…</GhostButton>
        {saved && <span class="dim" style={{ fontSize: 11.5 }}>Saved to {saved}</span>}
      </div>
      <div class="form-row"><Note>Everything stays on this Mac. The only network use is checking GitHub for new versions.</Note></div>
    </Group>
  );
}

function About() {
  return (
    <>
      <Group title="Updates"><div class="form-row" style={{ display: 'block' }}><UpdatePanel /></div></Group>
      <Group title="Release notes"><Row label="What's new and roadmap"><GhostButton onClick={() => void api.openMain('releases')}>Open</GhostButton></Row></Group>
    </>
  );
}

export function SettingsWindow() {
  useReady();
  const [tab, setTab] = useState<SettingsTab>(isTab(api.params.tab) ? api.params.tab : 'general');
  useEffect(() => api.on('navigate', (n) => { if (isTab(n)) setTab(n); }), []);
  return (
    <div class="set-root">
      <div class="set-tabs" role="tablist">
        {TABS.map((t) => (
          <button type="button" key={t.id} role="tab" aria-selected={tab === t.id} class={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={16} /><span>{t.label}</span>
          </button>
        ))}
      </div>
      <div class="set-body" role="tabpanel">
        {tab === 'general' && <General />}{tab === 'notifications' && <Notifications />}{tab === 'mcp' && <Mcp />}{tab === 'data' && <Data />}{tab === 'about' && <About />}
      </div>
    </div>
  );
}
