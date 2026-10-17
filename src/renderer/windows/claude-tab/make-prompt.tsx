// 3. Make a prompt: copy an instruction that makes Claude write and save a new prompt.
import { useState } from 'preact/hooks';
import { GhostButton } from '../../components/ui';
import { Info } from '../../components/info';
import { api } from '../../model';
import { Group, useCopied } from './parts';
import { makePromptInstruction } from './logic';

export function MakePrompt() {
  const [request, setRequest] = useState('');
  const [copied, mark] = useCopied();
  return (
    <Group title="Make a prompt" info="Describe a routine in your own words. Claude writes the prompt, saves it here with save_prompt, and it waits for your approval below before it becomes a slash command.">
      <div class="form-row stack">
        <label class="ct-label" for="ct-make">What should the prompt do?<Info text="For example: every Monday read my Teams chats from the weekend and add what I promised. Mention the systems it should read." label="Examples for the description" /></label>
        <textarea id="ct-make" class="input ct-textarea" rows={3} value={request} onInput={(e) => setRequest((e.target as HTMLTextAreaElement).value)} placeholder="Read my Teams chats from the weekend and add what I promised" />
      </div>
      <div class="form-row" style={{ justifyContent: 'flex-start' }}>
        <GhostButton disabled={request.trim() === ''} onClick={() => { void api.copyText(makePromptInstruction(request)); mark(); }}>{copied ? 'Copied' : 'Copy instruction for Claude'}</GhostButton>
        <Info text="Copies a ready-made instruction that includes your description. Paste it into Claude Code: Claude writes the prompt and saves it here, unapproved, so nothing runs until you approve it." label="About copying the instruction" />
      </div>
    </Group>
  );
}
