// The capture panel: one line in, live highlighting, chips and a preview of the row that will be saved.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Item, ParsedCapture, TokenRole } from '../../shared/types';
import { Icon } from '../components/icons';
import { Avatar, Chip, Dot, Kbd, KIND_VAR, KindLabel, LoopRing } from '../components/ui';
import { Fmt, expandTemplate, parseCapture } from '../core';
import { api, openItems, recentPeople, settings, summaries } from '../model';
import { ambientContext } from '../speed-logic';
import { atQuery, capitalize, completeAt, highlightSegments, hm, suggestionsFor } from './capture-logic';
import { sleep, useReady } from './util';

/** Survives hiding and showing the panel: Up on an empty field brings it back. */
let lastCapture = '';

const roleColor = (role: TokenRole, kind: ParsedCapture['kind']): string => {
  switch (role) {
    case 'kind': return KIND_VAR[kind];
    case 'person': return 'var(--text)';
    case 'date': case 'remind': return 'var(--k-wait)';
    case 'recurrence': return 'var(--k-bring)';
    case 'tag': case 'quote': return 'var(--k-said)';
    case 'pin': return 'var(--clay)';
  }
};

function dueText(d: number, time: boolean): string {
  const day0 = (ms: number) => { const x = new Date(ms); return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
  const days = Math.round((day0(d) - day0(Date.now())) / 864e5);
  const day = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : Fmt.short(d, 'EEE d MMM');
  return time ? `${day} ${Fmt.short(d, 'HH:mm')}` : day;
}

function KeyHint({ k, children }: { k: string; children: string }) {
  return <span class="row-flex gap6"><Kbd>{k}</Kbd><span class="dim" style={{ fontSize: 11.5 }}>{children}</span></span>;
}
function KindHint({ k, children }: { k: string; children: string }) {
  return <span class="row-flex gap6"><span class="mono">{k}</span><span class="dim" style={{ fontSize: 11.5 }}>{children}</span></span>;
}

export function CaptureWindow() {
  useReady();
  const [text, setText] = useState('');
  const [shown, setShown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sel, setSel] = useState(0);
  const [toEnd, setToEnd] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const syncScroll = () => { if (input.current && mirror.current) mirror.current.scrollLeft = input.current.scrollLeft; };
  const focus = () => { input.current?.focus(); };

  useEffect(() => {
    focus();
    requestAnimationFrame(() => setShown(true));
    const off = api.on('capture-shown', () => {
      busy.current = false;
      setText(''); setSaving(false); setSel(0); setShown(false);
      requestAnimationFrame(() => { setShown(true); focus(); });
    });
    window.addEventListener('focus', focus);
    return () => { off(); window.removeEventListener('focus', focus); };
  }, []);

  // after a programmatic text change: caret to the end, mirror scrolled with it
  useEffect(() => {
    const el = input.current;
    if (el) { el.setSelectionRange(el.value.length, el.value.length); syncScroll(); }
  }, [toEnd]);

  const parsed = useMemo(() => parseCapture(text, { eod: hm(settings.value.eodTime) }), [text, settings.value.eodTime]);
  const q = atQuery(text);
  const suggestions = suggestionsFor(q, recentPeople.value);
  const empty = text === '';
  // a template (`prep @sara`) saves several items: main expands it, we only show what will happen
  const expanded = useMemo(() => (empty ? null : expandTemplate(text, settings.value.captureTemplates)), [text, settings.value.captureTemplates]);
  const expandedParsed = useMemo(() => (expanded ?? []).map((l) => parseCapture(l, { eod: hm(settings.value.eodTime) })), [expanded, settings.value.eodTime]);

  const submit = async (stay: boolean) => {
    const line = text;
    if (!line.trim() || busy.current) return;
    busy.current = true;
    lastCapture = line; // the save sound is played by the main process in captureSubmit
    if (stay) {
      setText(''); setSel(0); setToEnd((n) => n + 1);
      await api.captureSubmit(line, true);
      busy.current = false;
      return;
    }
    setSaving(true);
    await sleep(150);
    await api.captureSubmit(line, false);
  };

  const complete = () => {
    const p = suggestions[Math.min(sel, suggestions.length - 1)];
    if (!p) return;
    setText(completeAt(text, p)); setSel(0); setToEnd((n) => n + 1);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); void submit(e.metaKey); }
    else if (e.key === 'Escape') { e.preventDefault(); void api.captureHide(); }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (empty) { if (lastCapture) { setText(lastCapture); setToEnd((n) => n + 1); } } else setSel((i) => Math.max(0, i - 1));
    }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(Math.max(0, suggestions.length - 1), i + 1)); }
    else if (e.key === 'Tab') { e.preventDefault(); complete(); }
  };

  const who = parsed.personHandle ? summaries.value.find((s) => s.person.handle === parsed.personHandle)?.person : undefined;
  // under the field (not for templates: the window is only 380 high): what you know about the person once the @handle is complete (not while it is being typed)
  const ambient = q === null && who && !expanded ? ambientContext(summaries.value.find((s) => s.person.id === who.id), openItems.value) : null;
  const preview: Item = {
    id: 'preview', kind: parsed.kind, title: parsed.title || 'Untitled', body: null, quote: parsed.quote, personId: who?.id ?? null, status: 'open',
    dueAt: parsed.dueAt, dueHasTime: parsed.dueHasTime, remindAt: null, snoozedUntil: null, snoozeCount: 0, recurRule: null, pinned: parsed.pinned,
    inbox: parsed.inbox, source: 'hotkey', createdAt: Date.now(), updatedAt: Date.now(), completedAt: null, lastTouchedAt: Date.now(),
    externalId: null, sourceLabel: null, sourceUrl: null, interactionId: null,
  };

  return (
    <div class="cap-wrap">
      <div class={`cap-card ${shown ? '' : 'pre'} ${saving ? 'saving' : ''}`}>
        <div class="cap-input-row">
          <span style={{ opacity: 0.7, display: 'inline-flex' }}><LoopRing size={20} line={2} /></span>
          <div class="cap-field">
            <div class="cap-mirror" ref={mirror} aria-hidden="true">
              {highlightSegments(text, parsed.tokens).map((s, i) => (
                <span key={i} style={s.role ? { color: roleColor(s.role, parsed.kind), textDecoration: s.role === 'person' ? 'underline' : undefined } : undefined}>{s.text}</span>
              ))}
            </div>
            <input ref={input} value={text} placeholder="owe @sara review RFC fri" spellcheck={false} autocomplete="off" autofocus aria-label="Capture"
              onInput={(e) => { setText((e.target as HTMLInputElement).value); setSel(0); requestAnimationFrame(syncScroll); }}
              onKeyDown={onKeyDown} onKeyUp={syncScroll} onClick={syncScroll} onScroll={syncScroll} onSelect={syncScroll} />
          </div>
        </div>
        <hr class="hairline" />
        {empty ? (
          <div class="cap-hints">
            <div class="row-flex gap14">
              <KindHint k="owe">you promised</KindHint><KindHint k="wait">they promised</KindHint><KindHint k="bring">talking point</KindHint>
              <KindHint k="todo">your task</KindHint><KindHint k="said">log a quote</KindHint><KindHint k="note">a fact</KindHint>
            </div>
            <div class="mono dim" style={{ fontWeight: 400 }}>fri · 3pm · in 2h · every mon · remind 1h · #tag · !</div>
          </div>
        ) : (
          <>
            <div class="cap-chips">
              <Chip><Dot kind={parsed.kind} /><span class="mono">{parsed.kind}</span></Chip>
              {expanded && <Chip title="Capture template"><Icon name="list" size={11} />template: {text.trim().split(/\s+/)[0]!.toLowerCase()}, {expanded.length} item{expanded.length === 1 ? '' : 's'}</Chip>}
              {parsed.personHandle && (who
                ? <Chip><Avatar person={who} size={14} />{who.name}</Chip>
                : <Chip><Icon name="plus" size={10} />create {capitalize(parsed.personHandle)}</Chip>)}
              {parsed.dueAt != null && <Chip><Icon name="calendar" size={11} /><span class="tnum">{dueText(parsed.dueAt, parsed.dueHasTime)}</span></Chip>}
              {parsed.recurRule && <Chip><Icon name="repeat" size={11} />{Fmt.recurrenceText(parsed.recurRule)}</Chip>}
              {parsed.remindAt != null && <Chip><Icon name="bell" size={11} />{Fmt.short(parsed.remindAt, 'EEE HH:mm')}</Chip>}
              {parsed.tags.map((t) => <Chip key={t}>#{t}</Chip>)}
              {parsed.pinned && <Chip><Icon name="pin" size={10} />pinned</Chip>}
              {parsed.inbox && <Chip><span class="dim row-flex gap6"><Icon name="tray" size={11} />inbox</span></Chip>}
            </div>
            <hr class="hairline" />
            {expanded ? expandedParsed.slice(0, 3).map((e, i) => (
              <div key={i} class="cap-prev" aria-label={`Template item ${i + 1}: ${e.title}, ${e.kind}`}>
                <span style={{ opacity: 0.7, display: 'inline-flex' }}><LoopRing size={14} line={1.4} /></span>
                <span class="grow cap-prev-title">{e.title || 'Untitled'}</span>
                <span class="c-kind" style={{ width: 'var(--col-kind)' }}><KindLabel kind={e.kind} /></span>
                <span class="c-date" style={{ width: 'var(--col-date)' }}>{Fmt.due({ dueAt: e.dueAt, dueHasTime: e.dueHasTime }) ?? (e.inbox ? 'Inbox' : '')}</span>
              </div>
            )) : <div class="cap-prev" aria-label={`Preview: ${preview.title}, ${parsed.kind}`}>
              <span style={{ opacity: 0.7, display: 'inline-flex' }}><LoopRing size={14} line={1.4} /></span>
              <span class="grow cap-prev-title">{preview.title}</span>
              {parsed.pinned && <span class="dim" style={{ display: 'inline-flex' }}><Icon name="pin" size={10} /></span>}
              <span class="c-kind" style={{ width: 'var(--col-kind)' }}><KindLabel kind={parsed.kind} /></span>
              <span class="c-person" style={{ width: 'var(--col-person)' }}>
                {who && <><Avatar person={who} size={16} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{who.name.split(/\s+/)[0]}</span></>}
              </span>
              <span class="c-date" style={{ width: 'var(--col-date)' }}>{Fmt.due(preview) ?? (parsed.inbox ? 'Inbox' : '')}</span>
            </div>}
            {ambient && (
              <>
                <hr class="hairline" />
                <div class="cap-ambient" aria-label={`About ${who!.name}`}>
                  {ambient.notes && <div class="cap-notes ellipsis" title={who!.notes}>{ambient.notes}</div>}
                  <div class="cap-ambient-line">
                    {ambient.owes.map((o) => (
                      <span key={o.id} class="cap-owe"><Dot kind="owe" /><span class="ellipsis">{o.title}</span>{Fmt.due(o) && <span class="dim">{Fmt.due(o)}</span>}</span>
                    ))}
                    <span class="grow" />
                    <span class="mono dim">{ambient.last}</span>
                  </div>
                </div>
              </>
            )}
            {q !== null && (suggestions.length > 0 || q !== '') && (
              <>
                <hr class="hairline" />
                {q === '' && <div class="caps" style={{ padding: '8px 18px 2px' }}>Recent</div>}
                {suggestions.map((p, i) => (
                  <div key={p.id} class={`cap-sug ${i === Math.min(sel, suggestions.length - 1) ? 'on' : ''}`}>
                    <Avatar person={p} size={20} /><span>{p.name}</span><span class="mono dim">@{p.handle}</span>
                    <span class="grow" />{i === Math.min(sel, suggestions.length - 1) && <Kbd>tab</Kbd>}
                  </div>
                ))}
                {suggestions.length === 0 && q !== '' && (
                  <div class="cap-sug"><span class="dim" style={{ display: 'inline-flex' }}><Icon name="plus" size={14} /></span><span>Create {capitalize(q)}</span><span class="grow" /><Kbd>⏎</Kbd></div>
                )}
              </>
            )}
          </>
        )}
        <hr class="hairline" />
        <div class="cap-keys">
          <KeyHint k="⏎">save</KeyHint><KeyHint k="⌘⏎">save and keep open</KeyHint><KeyHint k="esc">cancel</KeyHint>
          {empty && <KeyHint k="↑">repeat last</KeyHint>}
        </div>
      </div>
    </div>
  );
}
