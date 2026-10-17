import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../components/icons';
import { Page } from '../components/page';
import { Chip, SectionHeader, Segmented } from '../components/ui';
import { UpdatePanel } from '../components/update-panel';
import { info, markVersionSeen, updatedFrom } from '../model';
import { releaseNotes, roadmap, type ReleaseNote } from '../releases-data';

export function ReleasesPage() {
  const [tab, setTab] = useState<'new' | 'road'>('new');
  const version = info.value.version;
  useEffect(() => { markVersionSeen(); }, []);

  const header = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 14, marginTop: 14 }}>
      {updatedFrom.value && (
        <div class="update-banner"><Icon name="sparkles" size={14} />Updated from {updatedFrom.value} to {version}. Here is what changed.</div>
      )}
      <Segmented label="Page" value={tab} onChange={setTab} options={[{ value: 'new', label: "What's new" }, { value: 'road', label: 'Roadmap' }]} />
      <UpdatePanel />
    </div>
  );

  return (
    <Page title="What's new" help="page.releases" subtitle={`Installed: version ${version}`} header={header}>
      {tab === 'new'
        ? releaseNotes.map((n) => <ReleaseCard key={n.version} note={n} installed={n.version === version} />)
        : (
          <>
            <div class="dim" style={{ fontSize: 12.5, paddingTop: 14 }}>Plans change. Nothing here is a promise.</div>
            {roadmap.map((g) => (
              <div key={g.title} class="section">
                <SectionHeader title={g.title} />
                <div class="dim" style={{ fontSize: 12, paddingBottom: 4 }}>{g.blurb}</div>
                {g.items.map((item) => <div key={item} class="bullet" style={{ fontSize: 13 }}><span class="bdot" />{item}</div>)}
              </div>
            ))}
          </>
        )}
    </Page>
  );
}

function ReleaseCard({ note, installed }: { note: ReleaseNote; installed: boolean }) {
  return (
    <section class="release-card">
      <div class="row-flex gap8">
        <h2 class="release-title">Version {note.version}</h2>
        {installed && <Chip>installed</Chip>}
        <span class="grow" />
        <span class="dim tnum" style={{ fontSize: 11.5 }}>{note.date}</span>
      </div>
      <div class="dim" style={{ fontSize: 13, fontWeight: 500, margin: '8px 0' }}>{note.title}</div>
      {note.highlights.map((h) => <div key={h} class={`bullet ${installed ? 'hot' : ''}`} style={{ fontSize: 12.5 }}><span class="bdot" />{h}</div>)}
    </section>
  );
}
