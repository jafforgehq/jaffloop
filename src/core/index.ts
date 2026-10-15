// Everything in core. Main process and MCP server import this; the renderer imports ./pure only.
export * from './pure';
export * from './db';
export * from './store';

import { openDatabase } from './db';
import { Store } from './store';

/** Opens (and migrates) the database file and wraps it in a Store. */
export function openStore(path: string): Store {
  return new Store(openDatabase(path));
}
