import { AllClosed } from '../components/all-closed';
import { ItemList } from '../components/item-row';
import { Page } from '../components/page';
import { useFetched } from '../hooks/use-fetched';
import { useItemKeys } from '../hooks/use-item-keys';
import { api } from '../model';

export function TagPage({ tag }: { tag: string }) {
  const items = useFetched(() => api.items({ tag }), [tag]);
  useItemKeys(items ?? []);
  return (
    <Page title={`#${tag}`} help="page.tag" subtitle={items ? `${items.length} open` : ''}>
      {items && items.length === 0 && <AllClosed title={`Nothing tagged #${tag}`} message={`Add #${tag} to a capture to see it here.`} />}
      {items && <div style={{ marginTop: 14 }}><ItemList items={items} /></div>}
    </Page>
  );
}
