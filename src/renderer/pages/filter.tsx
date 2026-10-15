// Saved filter: the search query run against the store (api.search accepts @person kind:owe before:... status:...).
import { AllClosed } from '../components/all-closed';
import { ItemList } from '../components/item-row';
import { Page } from '../components/page';
import { QuietButton } from '../components/ui';
import { useFetched } from '../hooks/use-fetched';
import { useItemKeys } from '../hooks/use-item-keys';
import { api, removeFilter } from '../model';

export function FilterPage({ query }: { query: string }) {
  const items = useFetched(() => api.search(query, 200), [query]);
  useItemKeys(items ?? []);
  const header = (
    <div class="row-flex gap8" style={{ marginTop: 12 }}>
      <span class="dim" style={{ fontSize: 12.5 }}>{items ? `${items.length} match${items.length === 1 ? '' : 'es'}` : ''}</span>
      <QuietButton onClick={() => removeFilter(query)}>Remove filter</QuietButton>
    </div>
  );
  return (
    <Page title="Filter" subtitle={query} header={header}>
      {items && items.length === 0 && <AllClosed title="No matches" message="Nothing matches this search right now." showCapture={false} />}
      {items && <div style={{ marginTop: 8 }}><ItemList items={items} /></div>}
    </Page>
  );
}
