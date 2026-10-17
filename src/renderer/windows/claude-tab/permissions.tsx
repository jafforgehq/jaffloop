// 2. What Claude may do: the switches, people hidden from Claude, and every tool Claude can call.
import { Info } from '../../components/info';
import { TOOL_INFO } from '../../../shared/tool-info';
import { Fmt } from '../../core';
import { saveSettings, savePerson, settings, snapshot, summaries } from '../../model';
import { Group, Note, Row, Switch } from './parts';

export function Permissions() {
  const s = settings.value;
  return (
    <>
      <Group title="What Claude may do" info="Three switches and a list of people that decide what Claude can see and change. They apply at once, to every tool and prompt.">
        <Row label="Review what Claude adds first" info="Items Claude adds wait in your Inbox until you accept them. Until then they stay out of Today, counts and notifications." hint="Recommended: you see everything before it counts.">
          <Switch label="Review what Claude adds first" on={s.reviewClaudeItems} onChange={(v) => void saveSettings({ reviewClaudeItems: v })} />
        </Row>
        <Row label="Read-only: block all write tools" info="Claude can still read and search, but every tool that adds, changes or saves something is refused.">
          <Switch label="Read-only" on={s.mcpReadOnly} onChange={(v) => void saveSettings({ mcpReadOnly: v })} />
        </Row>
        <Row label="Share 1:1 notes with Claude" info="When on, Claude can read what you wrote in past 1:1 notes (get_person and prep_brief). When off, the notes are left out; logging a 1:1 still saves the notes you pass." hint="Notes are often the most private thing in the app.">
          <Switch label="Share 1:1 notes with Claude" on={s.shareOneOnOneNotes} onChange={(v) => void saveSettings({ shareOneOnOneNotes: v })} />
        </Row>
        {summaries.value.map((x) => (
          <Row key={x.person.id} label={x.person.name} info={`Hides ${x.person.name} from Claude: no tool or resource returns them, their items or their notes.`}>
            <Switch label={`Hide ${x.person.name} from Claude`} on={x.person.hiddenFromClaude} onChange={(v) => void savePerson({ ...x.person, hiddenFromClaude: v })} />
          </Row>
        ))}
        <div class="form-row"><Note>People toggled on are hidden from Claude: excluded from every tool and resource.</Note></div>
      </Group>
      <Group title="What Claude can do" info="Every tool Claude has in Jaffloop. Read tools only look; write tools change your data (and stop working in read-only mode).">
        {Object.entries(TOOL_INFO).map(([name, t]) => (
          <div key={name} class="form-row ct-tool" data-testid="tool-row" data-tool={name}>
            <span class="mono ct-tool-name">{name}</span>
            <span class="grow">{t.title}</span>
            <span class={`ct-badge ${t.writes ? 'write' : ''}`}>{t.writes ? 'writes' : 'read'}</span>
            <Info text={t.what} label={`About ${name}`} />
          </div>
        ))}
      </Group>
    </>
  );
}

export function RecentCalls() {
  const log = snapshot.value.auditLog.slice(0, 8);
  return (
    <Group title="Recent MCP calls" info="The last things Claude did in Jaffloop, newest first. 'wrote' marks calls that changed data.">
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
  );
}
