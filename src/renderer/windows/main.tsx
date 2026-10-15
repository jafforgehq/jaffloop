// The main window: sidebar | page | drawer, overlays (search, shortcuts, welcome), toast and bulk bar.
// Ported from MainView.swift MainView. The top 34px are a window drag region (traffic lights sit at x=14, y=14).
import { useSignalEffect } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { ItemDrawer } from '../components/drawer';
import { Icon } from '../components/icons';
import { Sidebar } from '../components/sidebar';
import { BulkBar, ToastBar } from '../components/toast';
import {
  api, drawerItem, drawerItemId, nav, navTitle, openItems, refreshDrawerItem, showSearch, showShortcuts, showWelcome, summaries, ui,
} from '../model';
import { SearchPalette } from '../overlays/search';
import { ShortcutsView } from '../overlays/shortcuts';
import { WelcomeView } from '../overlays/welcome';
import { DonePage } from '../pages/done';
import { FilterPage } from '../pages/filter';
import { InboxPage } from '../pages/inbox';
import { LedgerPage } from '../pages/ledger';
import { PeoplePage } from '../pages/people';
import { PersonPage } from '../pages/person';
import { ReleasesPage } from '../pages/releases';
import { SnoozedPage } from '../pages/snoozed';
import { TagPage } from '../pages/tag';
import { TodayPage } from '../pages/today';

function CurrentPage() {
  const n = nav.value;
  if (n === 'ledger') return <LedgerPage />;
  if (n === 'inbox') return <InboxPage />;
  if (n === 'people') return <PeoplePage />;
  if (n === 'releases') return <ReleasesPage />;
  if (n === 'done') return <DonePage />;
  if (n === 'snoozed') return <SnoozedPage />;
  if (n.startsWith('filter:')) return <FilterPage key={n} query={n.slice(7)} />;
  if (n.startsWith('person:')) return <PersonPage key={n} personId={n.slice(7)} />;
  if (n.startsWith('tag:')) return <TagPage key={n} tag={n.slice(4)} />;
  return <TodayPage />;
}

export function MainWindow() {
  // the OS window title follows the screen (and the person's name once the summaries are loaded)
  useSignalEffect(() => { document.title = navTitle(nav.value); void summaries.value; });
  // keep the drawer's item fresh while it is open (it may be done or dropped, so it is fetched when it is not open)
  useSignalEffect(() => { void drawerItemId.value; void openItems.value; void refreshDrawerItem(); });

  useEffect(() => {
    document.body.dataset.ready = '1';
    // Esc closes the drawer when no list handled it (lists clear marks and selection first)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (showShortcuts.value || showSearch.value || showWelcome.value) return; // the overlays close themselves
      if (drawerItemId.value) { drawerItemId.value = null; e.preventDefault(); }
    };
    // a mouse click must not leave focus on a button, or Enter/space would activate it instead of the list keys
    const onClick = (e: MouseEvent) => { if (e.detail > 0) (e.target as HTMLElement | null)?.closest?.('button')?.blur(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('click', onClick); };
  }, []);

  const hidden = ui.value.sidebarHidden;
  const item = drawerItem.value;

  return (
    <div class="app">
      {!hidden && <><Sidebar /><div class="vline" /></>}
      <main class="main">
        <div class="drag page-drag" />
        <CurrentPage />
      </main>
      {item && drawerItemId.value === item.id && <><div class="vline" /><ItemDrawer key={item.id} item={item} /></>}

      {hidden && (
        <button type="button" class="btn quiet icon nodrag show-sidebar" aria-label="Show sidebar" title="Show sidebar  ⌘\" onClick={() => { void api.setUiState({ sidebarHidden: false }); }}>
          <Icon name="sidebar" size={14} />
        </button>
      )}

      {showSearch.value && <SearchPalette />}
      {showShortcuts.value && <ShortcutsView />}
      {showWelcome.value && <WelcomeView />}

      <div class="toast-wrap"><ToastBar /><BulkBar /></div>
    </div>
  );
}
