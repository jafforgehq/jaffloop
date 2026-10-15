// Builds window.jaffloop for the renderer: every Api method over ipcRenderer.invoke('api:<name>'), events on 'evt:<name>'.
import { contextBridge, ipcRenderer } from 'electron';
import { API_METHODS, type ApiEventName, type WindowKind } from '../shared/api';

const q = new URLSearchParams(window.location.search);
const params: Record<string, string> = {};
q.forEach((v, k) => { if (k !== 'view') params[k] = v; });

const bridge: Record<string, unknown> = {
  view: (q.get('view') ?? 'main') as WindowKind,
  params,
  on: (event: ApiEventName, cb: (payload: unknown) => void) => {
    const channel = `evt:${event}`;
    const h = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, h);
    return () => { ipcRenderer.removeListener(channel, h); };
  },
};
for (const name of API_METHODS) bridge[name] = (...args: unknown[]) => ipcRenderer.invoke(`api:${name}`, ...args);

contextBridge.exposeInMainWorld('jaffloop', bridge);
