import { contextBridge, ipcRenderer } from 'electron';
import type { Settings, UpdatePayload } from './shared/types';

const api = {
  onUpdate(cb: (payload: UpdatePayload) => void) {
    ipcRenderer.on('update', (_e, payload: UpdatePayload) => cb(payload));
  },
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:set', patch),
  benchSwap: (championId: number): Promise<void> => ipcRenderer.invoke('action:benchSwap', championId),
  requestTrade: (cellId: number): Promise<void> => ipcRenderer.invoke('action:trade', cellId),
  demoToggle: (): Promise<boolean> => ipcRenderer.invoke('demo:toggle'),
  demoShuffle: (): Promise<void> => ipcRenderer.invoke('demo:shuffle'),
  closeWindow: () => ipcRenderer.send('window:close'),
  minimize: () => ipcRenderer.send('window:minimize'),
};

export type Api = typeof api;
contextBridge.exposeInMainWorld('api', api);
