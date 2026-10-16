// Settings → Claude (MCP): the ready-made prompts (src/shared/prompts.ts), each with a Copy button.
import { useState } from 'preact/hooks';
import { PROMPTS, renderPrompt, type JaffloopPrompt } from '../../shared/prompts';
import { argumentHint } from '../oneonone-logic';
import { Chip, GhostButton } from '../components/ui';
import { api } from '../model';

function PromptCard({ p }: { p: JaffloopPrompt }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const text = renderPrompt(p, {});
  return (
    <div class="pr-card" data-testid="prompt-card" data-prompt={p.id}>
      <div class="row-flex gap8">
        <span class="pr-title grow">{p.title}</span>
        <GhostButton label={`Copy prompt: ${p.title}`} onClick={() => { void api.copyText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>{copied ? 'Copied' : 'Copy prompt'}</GhostButton>
      </div>
      <div class="dim pr-desc">{p.description}</div>
      <div class="pr-meta">
        {p.needs.length === 0 ? <span class="dim">No other connector needed</span> : <><span class="dim">Needs</span>{p.needs.map((n) => <Chip key={n}>{n}</Chip>)}</>}
      </div>
      {p.arguments.length > 0 && <div class="pr-args dim">{p.arguments.map((a) => <span key={a.name}>{argumentHint(a)}</span>)}</div>}
      <button type="button" class="link pr-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide text' : 'Show text'}</button>
      {open && <pre class="pr-text">{text}</pre>}
    </div>
  );
}

export function ClaudePrompts() {
  return (
    <>
      <p class="dim set-note" style={{ marginTop: 0 }}>
        With Jaffloop connected, these run from Claude: in Claude Code they appear as slash commands named <span class="mono">/mcp__jaffloop__&lt;id&gt;</span>, in Claude Desktop under the + menu.
        Or copy one and paste it into any chat. Imported items carry an id, so running a sweep twice never creates copies.
      </p>
      <div class="pr-list">{PROMPTS.map((p) => <PromptCard key={p.id} p={p} />)}</div>
    </>
  );
}
