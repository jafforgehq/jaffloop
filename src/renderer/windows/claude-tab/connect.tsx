// 1. Connect: the command to add Jaffloop to Claude Code.
import { GhostButton } from '../../components/ui';
import { Info } from '../../components/info';
import { api, info } from '../../model';
import { Group, useCopied } from './parts';
import { unstableInstall } from './logic';

export function Connect() {
  const [copied, mark] = useCopied();
  const cmd = info.value.mcpCommand;
  return (
    <Group title="Connect" info="Adds Jaffloop to Claude Code as a local tool server. After you run the command once, Claude can read and write your promises through the tools listed below.">
      {unstableInstall(info.value.mcpBinary) && (
        <div class="ct-warn" role="alert" data-testid="mcp-warn">
          Move Jaffloop to Applications first: from here the path changes after a restart and Claude loses the connection.
          <Info text="This copy of Jaffloop runs from a disk image or a quarantined download. macOS moves it to a temporary path that changes on every launch, so the command below would stop working." label="About moving Jaffloop to Applications" />
        </div>
      )}
      <div class="form-row" style={{ display: 'block' }}><code class="mcp-cmd" data-testid="mcp-command">{cmd}</code></div>
      <div class="form-row" style={{ justifyContent: 'flex-start' }}>
        <GhostButton onClick={() => { void api.copyText(cmd); mark(); }}>{copied ? 'Copied' : 'Copy command'}</GhostButton>
        <Info text="Copies the command. Paste it into a terminal and Claude Code remembers Jaffloop for every project (user scope)." label="About copying the command" />
        <span class="dim" style={{ fontSize: 11 }}>Claude Code. For Claude Desktop add the same binary as a stdio server.</span>
      </div>
    </Group>
  );
}
