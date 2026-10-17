// Settings → Claude (MCP). Sections, top to bottom: Connect, What Claude may do (+ tools), Make a prompt, Prompts, Run on a schedule, Sync health, Recent calls.
import { useEffect } from 'preact/hooks';
import { api, reloadClaude } from '../../model';
import { Connect } from './connect';
import { Health } from './health';
import { MakePrompt } from './make-prompt';
import { Permissions, RecentCalls } from './permissions';
import { Prompts } from './prompts';
import { Schedule } from './schedule';

export function ClaudeTab() {
  useEffect(() => {
    void reloadClaude();
    // Claude saves prompts and imports items from another process: reload whenever the data changes
    return api.on('data-changed', () => { void reloadClaude(); });
  }, []);
  return (
    <>
      <Connect />
      <Permissions />
      <MakePrompt />
      <Prompts />
      <Schedule />
      <Health />
      <RecentCalls />
    </>
  );
}
