// The tray popover: today's list and a quick-add line.
import { useState } from 'preact/hooks';
import { AllClosed } from '../components/all-closed';
import { Icon } from '../components/icons';
import { Help } from '../components/info';
import { ItemRow } from '../components/item-row';
import { IconButton } from '../components/ui';
import { tip } from '../help';
import { api, save, snapshot } from '../model';
import { useReady } from './util';

export function PopoverWindow() {
  useReady();
  const [quick, setQuick] = useState('');
  const t = snapshot.value.today;
  const list = [...t.slipping, ...t.overdue, ...t.today, ...t.waitingStale];
  const add = () => { const line = quick; if (!line.trim()) return; setQuick(''); void save(line); };

  return (
    <div class="pop-root">
      <div class="pop-head">
        <span class="title sm">Today</span>
        <Help id="pop.today" />
        <span class="grow" />
        <IconButton title={tip('pop.capture')} label="Capture" onClick={() => void api.openCapture()}><Icon name="plus" size={15} /></IconButton>
        <IconButton title={tip('pop.open')} label="Open Jaffloop" onClick={() => void api.openMain()}><Icon name="window" size={15} /></IconButton>
      </div>
      <hr class="hairline" />
      {list.length === 0 && t.inbox.length === 0 ? (
        <div class="pop-empty"><div style={{ transform: 'scale(0.8)', transformOrigin: 'top center' }}><AllClosed /></div></div>
      ) : (
        <div class="pop-list">
          <div class="rows">
            {list.map((i, idx) => <ItemRow key={i.id} item={i} index={idx} showPerson showKind={false} compact />)}
          </div>
          {t.inbox.length > 0 && (
            <button type="button" class="pop-inbox" title={tip('pop.inbox')} onClick={() => void api.openMain('inbox')}>
              <Icon name="tray" size={13} /><span>{t.inbox.length} in Inbox</span>
            </button>
          )}
        </div>
      )}
      <hr class="hairline" />
      <div class="pop-add">
        <span class="dim" style={{ display: 'inline-flex' }}><Icon name="plus" size={13} /></span>
        <input value={quick} placeholder="Quick add — owe @sara review RFC fri" spellcheck={false} aria-label="Quick add"
          onInput={(e) => setQuick((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.isComposing) add(); }} />
        <Help id="pop.quick" />
      </div>
    </div>
  );
}
