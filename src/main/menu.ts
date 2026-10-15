import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import type { ApiEvents, Nav } from '../shared/api';

export interface MenuActions {
  newCapture(): void;
  openSettings(): void;
  checkForUpdates(): void;
  openMorningBrief(): void;
  openMain(): void;
  /** show the main window and go to `nav` */
  navigate(nav: Nav): void;
  /** show the main window and send a command to it */
  command(c: ApiEvents['command']): void;
}

/** Same menus, labels and accelerators as AppDelegate.buildMenu in the Swift app. */
export function buildMenuTemplate(a: MenuActions, sendToFocused: (c: ApiEvents['command']) => boolean): MenuItemConstructorOptions[] {
  return [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: 'About Jaffloop' },
        { label: 'Check for Updates…', click: () => a.checkForUpdates() },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => a.openSettings() },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Jaffloop' },
        { role: 'hideOthers' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Jaffloop' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Capture', accelerator: 'Cmd+N', click: () => a.newCapture() },
        { label: 'Search…', accelerator: 'Cmd+K', click: () => a.command('search') },
        { label: 'Morning Brief', accelerator: 'Cmd+B', click: () => a.openMorningBrief() },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        // the renderer undoes the last action while its toast shows, and otherwise falls back to the text undo
        { label: 'Undo', accelerator: 'Cmd+Z', click: () => { if (!sendToFocused('undo')) a.command('undo'); } },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Today', accelerator: 'Cmd+1', click: () => a.navigate('today') },
        { label: 'Promise Ledger', accelerator: 'Cmd+2', click: () => a.navigate('ledger') },
        { label: 'Inbox', accelerator: 'Cmd+3', click: () => a.navigate('inbox') },
        { label: 'People', accelerator: 'Cmd+4', click: () => a.navigate('people') },
        { type: 'separator' },
        { label: 'Back', accelerator: 'Cmd+[', click: () => a.command('back') },
        { label: 'Forward', accelerator: 'Cmd+]', click: () => a.command('forward') },
        { label: 'Hide or Show Sidebar', accelerator: 'Cmd+\\', click: () => a.command('toggle-sidebar') },
        ...(app.isPackaged ? [] : [{ type: 'separator' } as const, { role: 'toggleDevTools' } as const]),
      ],
    },
    {
      label: 'Window',
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { label: 'Jaffloop', accelerator: 'Cmd+0', click: () => a.openMain() },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
    {
      label: 'Help',
      role: 'help',
      submenu: [
        { label: 'Keyboard Shortcuts', accelerator: 'Cmd+/', click: () => a.command('shortcuts') },
        { label: "What's New and Roadmap", click: () => a.navigate('releases') },
      ],
    },
  ];
}

export function installMenu(a: MenuActions): void {
  // Undo goes to the window that has focus (a capture field, say); a window that is not an app window falls through to the main one
  const sendToFocused = (c: ApiEvents['command']): boolean => {
    const w = BrowserWindow.getFocusedWindow();
    if (!w || w.isDestroyed()) return false;
    w.webContents.send('evt:command', c);
    return true;
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(a, sendToFocused)));
}
