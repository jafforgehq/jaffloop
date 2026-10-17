// 6. Sync health: what Claude imported per source and when it last wrote.
import { Info } from '../../components/info';
import { Fmt } from '../../core';
import { syncHealth } from '../../model';
import { Group } from './parts';
import { ageLabel, isQuiet } from './logic';

export function Health() {
  const h = syncHealth.value;
  const now = Date.now();
  return (
    <Group title="Sync health" info="Shows whether your sweeps keep working: per source (outlook, teams, jira, ...) how many items Claude imported and when the last one arrived.">
      {(!h || h.sources.length === 0) && <div class="form-row dim" data-testid="health-empty">Nothing imported by Claude yet</div>}
      {h && h.sources.length > 0 && (
        <table class="ct-table" data-testid="health-table">
          <thead><tr>
            <th>Source</th>
            <th class="num">Total<Info text="Every item Claude ever imported from this source, whatever its status now." label="About the total" /></th>
            <th class="num">Last 7 days<Info text="Items imported in the past week. A source with none is marked quiet: its sweep may have stopped." label="About the weekly count" /></th>
            <th>Last import<Info text="When the newest item from this source arrived." label="About the last import" /></th>
          </tr></thead>
          <tbody>
            {h.sources.map((r) => (
              <tr key={r.source} data-testid="health-row" data-source={r.source}>
                <td class="mono">{r.source}{isQuiet(r) && <span class="ct-quiet" data-testid="quiet">quiet</span>}</td>
                <td class="num tnum">{r.total}</td>
                <td class="num tnum">{r.last7Days}</td>
                <td class="dim">{ageLabel(r.lastAt, now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div class="form-row">
        <span>Last write by Claude<Info text="The last time Claude added or changed anything in Jaffloop, from the log of MCP calls." label="About the last Claude write" /></span>
        <span class="dim" data-testid="last-write" title={h?.lastClaudeWriteAt ? Fmt.short(h.lastClaudeWriteAt, 'd MMM HH:mm') : undefined}>{ageLabel(h?.lastClaudeWriteAt ?? null, now)}</span>
      </div>
    </Group>
  );
}
