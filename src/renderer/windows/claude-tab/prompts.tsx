// 4. Prompts: the built-ins and the custom ones (written in the app or saved by Claude), with approve, edit, delete, copy and a form.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { PROMPTS, renderPrompt, type JaffloopPrompt } from '../../../shared/prompts';
import type { CustomPrompt } from '../../../shared/types';
import { argumentHint } from '../../oneonone-logic';
import { Chip, GhostButton, PrimaryButton } from '../../components/ui';
import { Info } from '../../components/info';
import { api, customPrompts, reloadClaude } from '../../model';
import { Group, useCopied } from './parts';
import { asPrompt, draftError, emptyArg, emptyDraft, slugify, toDraft, toInput, type PromptDraft } from './logic';

function Needs({ needs }: { needs: string[] }) {
  return (
    <div class="pr-meta">
      {needs.length === 0 ? <span class="dim">No other connector needed</span> : <><span class="dim">Needs</span>{needs.map((n) => <Chip key={n}>{n}</Chip>)}</>}
    </div>
  );
}

function BuiltinCard({ p }: { p: JaffloopPrompt }) {
  const [copied, mark] = useCopied();
  const [open, setOpen] = useState(false);
  const text = renderPrompt(p, {});
  return (
    <div class="pr-card" data-testid="prompt-card" data-prompt={p.id}>
      <div class="row-flex gap8">
        <span class="pr-title grow">{p.title}</span>
        <GhostButton label={`Copy prompt: ${p.title}`} onClick={() => { void api.copyText(text); mark(); }}>{copied ? 'Copied' : 'Copy prompt'}</GhostButton>
        <Info text="Copies the prompt text so you can paste it into any Claude chat. In Claude Code you can also run it as a slash command." label={`About copying ${p.title}`} />
      </div>
      <div class="dim pr-desc">{p.description}</div>
      <Needs needs={p.needs} />
      {p.arguments.length > 0 && <div class="pr-args dim">{p.arguments.map((a) => <span key={a.name}>{argumentHint(a)}</span>)}</div>}
      <span class="row-flex">
        <button type="button" class="link pr-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide text' : 'Show text'}</button>
        <Info text="Shows exactly what Claude is told when this prompt runs." label={`About the text of ${p.title}`} />
      </span>
      {open && <pre class="pr-text">{text}</pre>}
    </div>
  );
}

function CustomCard({ c, onEdit }: { c: CustomPrompt; onEdit: () => void }) {
  const [copied, mark] = useCopied();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const shown = open || !c.approved; // an unapproved prompt is shown in full: read it before you approve it
  const text = renderPrompt(asPrompt(c), {});
  return (
    <div class="pr-card" data-testid="custom-prompt-card" data-prompt={c.id} data-approved={c.approved ? '1' : '0'}>
      <div class="row-flex gap8">
        <span class="pr-title grow">{c.title}</span>
        <span class={`ct-badge ${c.approved ? '' : 'write'}`} data-testid="prompt-status">{c.approved ? 'Approved' : 'Needs approval'}</span>
        <Info text={c.approved ? 'Approved: Claude can run this prompt as a slash command.' : 'Not approved yet: Claude saved this prompt and it is hidden from Claude until you read the text and approve it.'} label={`About the status of ${c.title}`} />
      </div>
      {c.description && <div class="dim pr-desc">{c.description}</div>}
      <Needs needs={c.needs} />
      {c.arguments.length > 0 && <div class="pr-args dim">{c.arguments.map((a) => <span key={a.name}>{argumentHint(a)}</span>)}</div>}
      <span class="row-flex">
        {c.approved && <button type="button" class="link pr-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide text' : 'Show text'}</button>}
        {c.approved && <Info text="Shows exactly what Claude is told when this prompt runs." label={`About the text of ${c.title}`} />}
      </span>
      {shown && <pre class="pr-text" data-testid="prompt-text">{text}</pre>}
      {!c.approved && <div class="dim pr-desc">Read the text above. Approving lets Claude run it as the slash command <span class="mono">/mcp__jaffloop__{c.id}</span>.</div>}
      <div class="row-flex gap8 ct-actions">
        {!c.approved && (
          <>
            <PrimaryButton label={`Approve prompt: ${c.title}`} onClick={() => { void api.approveCustomPrompt(c.id).then(reloadClaude); }}>Approve</PrimaryButton>
            <Info text="Lets Claude use this prompt. Read the text first: it is what Claude will do on your behalf." label={`About approving ${c.title}`} />
          </>
        )}
        <GhostButton label={`Edit prompt: ${c.title}`} onClick={onEdit}>Edit</GhostButton>
        <Info text="Change the title, description, connectors, arguments or text. Saving here counts as approved, because you wrote or reviewed it." label={`About editing ${c.title}`} />
        <GhostButton label={`Copy prompt: ${c.title}`} onClick={() => { void api.copyText(text); mark(); }}>{copied ? 'Copied' : 'Copy'}</GhostButton>
        <Info text="Copies the prompt text so you can paste it into any Claude chat." label={`About copying ${c.title}`} />
        {confirm ? (
          <>
            <span class="dim">Delete this prompt?</span>
            <GhostButton label={`Confirm delete: ${c.title}`} onClick={() => { void api.deleteCustomPrompt(c.id).then(reloadClaude); }}>Delete</GhostButton>
            <GhostButton onClick={() => setConfirm(false)}>Cancel</GhostButton>
          </>
        ) : (
          <>
            <GhostButton label={`Delete prompt: ${c.title}`} onClick={() => setConfirm(true)}>Delete</GhostButton>
            <Info text="Removes the prompt for good. Schedules that use it stop working." label={`About deleting ${c.title}`} />
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, info, children }: { label: string; info: string; children: ComponentChildren }) {
  return <label class="ct-field"><span class="ct-label">{label}<Info text={info} label="More about this field" /></span>{children}</label>;
}

/** Create (existing = undefined) or edit a custom prompt. Validates live with the same rules the store and the MCP server use. */
function PromptForm({ existing, onDone }: { existing?: CustomPrompt; onDone: () => void }) {
  const isNew = !existing;
  const [d, setD] = useState<PromptDraft>(existing ? toDraft(existing) : emptyDraft());
  const [idTouched, setIdTouched] = useState(!isNew);
  const [saveError, setSaveError] = useState<string | null>(null);
  const set = (patch: Partial<PromptDraft>) => { setD({ ...d, ...patch }); setSaveError(null); };
  const error = draftError(d, isNew, customPrompts.value.map((c) => c.id));
  const text = (k: 'title' | 'description' | 'needs' | 'id') => (e: Event) => {
    const v = (e.target as HTMLInputElement).value;
    set(k === 'title' && !idTouched ? { title: v, id: slugify(v) } : { [k]: v });
  };
  const setArg = (i: number, patch: Partial<PromptDraft['args'][number]>) => set({ args: d.args.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const save = async () => {
    const r = await api.saveCustomPrompt(toInput(d));
    if (r.error) { setSaveError(r.error); return; }
    await reloadClaude();
    onDone();
  };
  return (
    <div class="pr-card ct-form" data-testid="prompt-form">
      <Field label="Title" info="The name people see in the list and in Claude's slash-command menu."><input class="input" aria-label="Prompt title" value={d.title} onInput={text('title')} /></Field>
      <Field label="Id" info="Lower case letters, digits and dashes. It becomes the slash command /mcp__jaffloop__<id> and cannot change later."><input class="input mono" aria-label="Prompt id" value={d.id} disabled={!isNew} onInput={(e) => { setIdTouched(true); text('id')(e); }} /></Field>
      <Field label="Description" info="One sentence about what the prompt does. Shown in the list and in Claude's menu."><input class="input" aria-label="Prompt description" value={d.description} onInput={text('description')} /></Field>
      <Field label="Needs" info="The connectors Claude needs besides Jaffloop, separated by commas, for example Outlook mail, Teams. Shown as chips so you know what to switch on."><input class="input" aria-label="Prompt needs" value={d.needs} onInput={text('needs')} placeholder="Teams, Outlook mail" /></Field>
      <div class="ct-field">
        <span class="ct-label">Arguments<Info text="Values that change between runs, such as a start date. Write {{name}} in the text where the value goes." label="About arguments" /></span>
        {d.args.map((a, i) => (
          <div key={i} class="ct-arg" data-testid="arg-row">
            <input class="input mono" aria-label={`Argument ${i + 1} name`} placeholder="name" value={a.name} onInput={(e) => setArg(i, { name: (e.target as HTMLInputElement).value })} />
            <input class="input" aria-label={`Argument ${i + 1} description`} placeholder="description" value={a.description} onInput={(e) => setArg(i, { description: (e.target as HTMLInputElement).value })} />
            <input class="input" aria-label={`Argument ${i + 1} default`} placeholder="default" value={a.default} onInput={(e) => setArg(i, { default: (e.target as HTMLInputElement).value })} />
            <label class="row-flex gap6 dim" style={{ fontSize: 11.5 }}><input type="checkbox" checked={a.required} onChange={(e) => setArg(i, { required: (e.target as HTMLInputElement).checked })} />required</label>
            <GhostButton label={`Remove argument ${i + 1}`} onClick={() => set({ args: d.args.filter((_, j) => j !== i) })}>Remove</GhostButton>
          </div>
        ))}
        <span class="row-flex"><GhostButton disabled={d.args.length >= 8} onClick={() => set({ args: [...d.args, emptyArg()] })}>Add argument</GhostButton><Info text="Adds a value Claude (or you, when scheduling) fills in each time. At most 8." label="About adding an argument" /></span>
      </div>
      <Field label="Text" info="What Claude is told to do. Be specific: what to read, which Jaffloop tools to call, what to skip. Use {{name}} for arguments."><textarea class="input ct-textarea mono" rows={9} aria-label="Prompt text" value={d.text} onInput={(e) => set({ text: (e.target as HTMLTextAreaElement).value })} /></Field>
      {(error || saveError) && <div class="tpl-err" role="alert" data-testid="prompt-error">{saveError ?? error}</div>}
      <div class="row-flex gap8 ct-actions">
        <PrimaryButton disabled={error != null} onClick={() => { void save(); }}>{isNew ? 'Create prompt' : 'Save prompt'}</PrimaryButton>
        <Info text="Saves the prompt as approved: you wrote or reviewed it here, so it is served to Claude straight away." label="About saving the prompt" />
        <GhostButton onClick={onDone}>Cancel</GhostButton>
      </div>
    </div>
  );
}

export function Prompts() {
  // editing: undefined = closed, null = new prompt, otherwise the id being edited
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const custom = customPrompts.value;
  return (
    <Group title="Prompts" info="Ready-made prompts, plus your own. In Claude Code they appear as slash commands; in Claude Desktop under the + menu. Prompts that Claude saved stay hidden from Claude until you approve them.">
      <div class="form-row stack">
        <p class="dim set-note" style={{ marginTop: 0 }}>
          With Jaffloop connected, these run from Claude: in Claude Code they appear as slash commands named <span class="mono">/mcp__jaffloop__&lt;id&gt;</span>, in Claude Desktop under the + menu.
          Or copy one and paste it into any chat. Imported items carry an id, so running a sweep twice never creates copies.
        </p>
        <div class="pr-list">{PROMPTS.map((p) => <BuiltinCard key={p.id} p={p} />)}</div>
        <div class="row-flex"><h4 class="ct-sub">Your prompts</h4><Info text="Prompts you wrote or Claude saved for you. Claude's wait for your approval." label="About your prompts" /></div>
        <div class="pr-list" data-testid="custom-prompts">
          {custom.length === 0 && editing !== null && <div class="dim pr-desc">None yet. Ask Claude to make one above, or write your own.</div>}
          {custom.map((c) => (editing === c.id
            ? <PromptForm key={c.id} existing={c} onDone={() => setEditing(undefined)} />
            : <CustomCard key={c.id} c={c} onEdit={() => setEditing(c.id)} />))}
          {editing === null && <PromptForm onDone={() => setEditing(undefined)} />}
        </div>
        {editing !== null && (
          <span class="row-flex"><GhostButton onClick={() => setEditing(null)}>New prompt</GhostButton><Info text="Write a prompt yourself instead of asking Claude. It is saved as approved." label="About creating a prompt" /></span>
        )}
      </div>
    </Group>
  );
}
