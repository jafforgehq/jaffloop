// 5. Run on a schedule: a launchd job on this Mac that runs a sweep prompt with `claude -p`.
import { useState } from 'preact/hooks';
import { renderPrompt } from '../../../shared/prompts';
import { sweepCommand } from '../../../shared/schedule';
import { GhostButton, PrimaryButton } from '../../components/ui';
import { Info } from '../../components/info';
import { api, customPrompts, info, reloadClaude, schedules } from '../../model';
import { Group, Note, useCopied } from './parts';
import { DEFAULT_WEEKDAYS, WEEKDAYS, missingRequired, parseTime, schedulable, setArgs, whenLabel } from './logic';

export function Schedule() {
  const options = schedulable(customPrompts.value);
  const [promptId, setPromptId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [time, setTime] = useState('08:30');
  const [days, setDays] = useState<number[]>(DEFAULT_WEEKDAYS);
  const [extra, setExtra] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [copied, mark] = useCopied();

  const chosen = options.find((o) => o.id === promptId) ?? options[0];
  const hm = parseTime(time);
  const missing = chosen ? missingRequired(chosen.arguments, values) : [];
  const command = chosen ? sweepCommand(renderPrompt(chosen.prompt, setArgs(values)), extra) : '';
  const mac = info.value.platform === 'darwin';
  const canInstall = mac && chosen != null && hm != null && days.length > 0 && missing.length === 0;

  const install = async () => {
    if (!chosen || !hm) return;
    setError(null); setDone(null);
    const r = await api.saveSchedule({ promptId: chosen.id, args: setArgs(values), hour: hm[0], minute: hm[1], weekdays: days, extraAllowedTools: extra.trim() });
    if (r.error) { setError(r.error); return; }
    setDone(`Installed: ${chosen.title}, ${whenLabel({ hour: hm[0], minute: hm[1], weekdays: days })}.`);
    await reloadClaude();
  };

  return (
    <Group title="Run on a schedule" info="Makes your Mac run a sweep by itself, for example every weekday at 08:30, by starting Claude Code with the prompt. Items it finds arrive in your Inbox. Needs Claude Code installed.">
      <div class="form-row stack">
        <label class="ct-field"><span class="ct-label">Prompt<Info text="Which prompt to run. Only prompts that read other systems and write to Jaffloop are offered, plus custom prompts you approved." label="About choosing the prompt" /></span>
          <select class="input" aria-label="Prompt to schedule" value={chosen?.id ?? ''} onChange={(e) => { setPromptId((e.target as HTMLSelectElement).value); setValues({}); setDone(null); }}>
            {options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
          </select>
        </label>
        {chosen?.arguments.map((a) => (
          <label key={`${chosen.id}-${a.name}`} class="ct-field"><span class="ct-label">{a.name}{a.required ? ' (required)' : ''}<Info text={`${a.description}${a.default ? `. Left empty it uses "${a.default}".` : '.'}`} label={`About the ${a.name} value`} /></span>
            <input class="input" aria-label={`Argument ${a.name}`} placeholder={a.default ?? ''} value={values[a.name] ?? ''} onInput={(e) => setValues({ ...values, [a.name]: (e.target as HTMLInputElement).value })} />
          </label>
        ))}
        <div class="ct-field">
          <span class="ct-label">Time and days<Info text="When the job starts. Your Mac must be awake and you logged in; a missed run does not start later." label="About the run time" /></span>
          <div class="row-flex gap8" style={{ flexWrap: 'wrap' }}>
            <input type="time" class="input time" aria-label="Run at" value={time} onInput={(e) => setTime((e.target as HTMLInputElement).value)} />
            <div class="segmented" role="group" aria-label="Weekdays">
              {WEEKDAYS.map((d) => (
                <button type="button" key={d.value} aria-pressed={days.includes(d.value)} onClick={() => setDays(days.includes(d.value) ? days.filter((x) => x !== d.value) : [...days, d.value])}>{d.label}</button>
              ))}
            </div>
          </div>
        </div>
        <label class="ct-field"><span class="ct-label">Extra tools Claude may use<Info text="Runs are headless, so Claude cannot ask before using a connector. List the connector tools it may use, separated by spaces, for example mcp__outlook__*. Jaffloop's own tools are always allowed." label="About allowing connector tools" /></span>
          <input class="input mono" aria-label="Extra tools Claude may use" placeholder="mcp__outlook__* mcp__teams__*" value={extra} onInput={(e) => setExtra((e.target as HTMLInputElement).value)} />
          <span class="dim" style={{ fontSize: 11.5 }}>Run <span class="mono">claude mcp list</span> to see your connector names, then add them as <span class="mono">mcp__&lt;name&gt;__*</span></span>
        </label>
        <div class="ct-field">
          <span class="ct-label">Command<Info text="Exactly what the job runs. You can paste it into a terminal to test it." label="About the command line" /></span>
          <code class="mcp-cmd ct-cmd" data-testid="sweep-cmd">{command}</code>
          <span class="row-flex"><GhostButton disabled={!chosen} onClick={() => { void api.copyText(command); mark(); }}>{copied ? 'Copied' : 'Copy command'}</GhostButton><Info text="Copies the command to the clipboard." label="About copying the sweep command" /></span>
        </div>
        <Note>Run the command once in a terminal first to check that Claude can reach your connectors without asking.</Note>
        <div class="row-flex gap8">
          <PrimaryButton disabled={!canInstall} onClick={() => { void install(); }}>Install on this Mac</PrimaryButton>
          <Info text="Creates a launchd job in ~/Library/LaunchAgents that runs the command at the chosen time. Installing again for the same prompt replaces the job." label="About installing the schedule" />
          {!mac && <span class="dim" style={{ fontSize: 11.5 }}>Scheduling is only available on macOS.</span>}
          {missing.length > 0 && <span class="dim" style={{ fontSize: 11.5 }}>Fill in {missing.join(', ')} first.</span>}
          {days.length === 0 && <span class="dim" style={{ fontSize: 11.5 }}>Pick at least one day.</span>}
        </div>
        {error && <div class="tpl-err" role="alert" data-testid="schedule-error">{error}</div>}
        {done && <div class="dim" style={{ fontSize: 11.5 }} data-testid="schedule-done">{done}</div>}
      </div>
      <div class="form-row stack">
        <div class="row-flex"><h4 class="ct-sub">Installed on this Mac</h4><Info text="Jobs Jaffloop installed. The job file in ~/Library/LaunchAgents is the source of truth." label="About installed schedules" /></div>
        {schedules.value.length === 0 && <div class="dim pr-desc">Nothing scheduled.</div>}
        {schedules.value.map((s) => (
          <div key={s.promptId} class="pr-card" data-testid="schedule-row" data-prompt={s.promptId}>
            <div class="row-flex gap8">
              <span class="pr-title grow">{options.find((o) => o.id === s.promptId)?.title ?? s.promptId}</span>
              <span class="dim tnum">{whenLabel(s)}</span>
              <GhostButton label={`Remove schedule: ${s.promptId}`} onClick={() => { void api.removeSchedule(s.promptId).then(reloadClaude); }}>Remove</GhostButton>
              <Info text="Stops the job and deletes its file. The prompt itself stays." label={`About removing the ${s.promptId} schedule`} />
            </div>
            <div class="dim pr-desc">Log: <span class="mono" style={{ wordBreak: 'break-all' }}>{s.logPath}</span><Info text="Everything Claude printed during the last runs. Open it when a sweep found nothing and you want to know why." label="About the log file" /></div>
          </div>
        ))}
      </div>
    </Group>
  );
}

