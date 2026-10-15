// An item title with Jira keys and URLs as links. A plain click opens the link; everything else on the title keeps its behaviour.
import { linkify } from '../core';
import { api, settings } from '../model';

export function LinkedTitle({ text }: { text: string }) {
  const segs = linkify(text, settings.value.jiraBaseUrl);
  if (!segs.some((s) => s.href)) return <>{text}</>;
  return (
    <>
      {segs.map((s, i) => s.href ? (
        <a key={i} class="tlink" href={s.href} draggable={false} title={s.href}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); void api.openExternal(s.href!); }}
          onDblClick={(e) => e.stopPropagation()}>{s.text}</a>
      ) : s.text)}
    </>
  );
}

/** The links of a title as a list (the drawer title is a text field, so it cannot hold links itself). */
export function TitleLinks({ text }: { text: string }) {
  const links = linkify(text, settings.value.jiraBaseUrl).filter((s) => s.href);
  if (!links.length) return null;
  return (
    <div class="drawer-links" aria-label="Links in the title">
      {links.map((s, i) => (
        <a key={i} class="tlink" href={s.href} title={s.href} onClick={(e) => { e.preventDefault(); void api.openExternal(s.href!); }}>{s.text}</a>
      ))}
    </div>
  );
}
