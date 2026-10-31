import { contextBridge, ipcRenderer } from 'electron';
import type { BadgeAnchors, BadgeModel, Settings, UpdatePayload } from './shared/types';

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
  onBadges(cb: (model: BadgeModel) => void) { ipcRenderer.on('badges', (_e, m: BadgeModel) => cb(m)); },
  calibrateStart: (): Promise<void> => ipcRenderer.invoke('badges:calibrate:start'),
  calibrationSave: (anchors: BadgeAnchors): Promise<void> => ipcRenderer.invoke('badges:calibrate:save', anchors),
  calibrationCancel: (): Promise<void> => ipcRenderer.invoke('badges:calibrate:cancel'),
  closeWindow: () => ipcRenderer.send('window:close'),
  minimize: () => ipcRenderer.send('window:minimize'),
};

export type Api = typeof api;
contextBridge.exposeInMainWorld('api', api);
