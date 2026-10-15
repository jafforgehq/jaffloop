// Fetch async data for a view and refetch whenever the snapshot changes (every data-changed event produces a new snapshot).
import { useEffect, useState } from 'preact/hooks';
import { snapshot } from '../model';

/** null until the first answer; keeps the previous answer while a refetch runs. */
export function useFetched<T>(fn: () => Promise<T>, deps: unknown[] = []): T | null {
  const [value, setValue] = useState<T | null>(null);
  const tick = snapshot.value;
  useEffect(() => {
    let live = true;
    fn().then((r) => { if (live) setValue(r); }).catch(() => {});
    return () => { live = false; };
  }, [...deps, tick]);
  return value;
}
