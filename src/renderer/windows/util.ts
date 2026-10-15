// Small hooks shared by the window components in this folder.
import { useEffect } from 'preact/hooks';

/** The main process smoke test waits for body[data-ready]. */
export function useReady() {
  useEffect(() => { document.body.dataset.ready = '1'; }, []);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
