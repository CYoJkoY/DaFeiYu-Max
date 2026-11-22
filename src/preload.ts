import { contextBridge, ipcRenderer } from 'electron';

const CHANNELS = ['snapshot', 'activity', 'quota', 'play', 'cursor', 'settings', 'social'] as const;

contextBridge.exposeInMainWorld('pet', {
  getSnapshot: () => ipcRenderer.invoke('snapshot'),
  play: (name: string) => ipcRenderer.send('play', name),
  menu: () => ipcRenderer.send('menu'),
  panel: () => ipcRenderer.send('panel'),
  refreshQuota: () => ipcRenderer.invoke('quota-refresh'),
  setting: (key: string, value: unknown) => ipcRenderer.send('setting', key, value),
  drag: (phase: string) => ipcRenderer.send('drag', phase),
  interactive: (value: boolean) => ipcRenderer.send('interactive', value),
  openMagpie: () => ipcRenderer.send('open-magpie'),
  openRepository: () => ipcRenderer.send('open-repository'),
  resize: (height: number) => ipcRenderer.send('resize', height),
  socialStatus: () => ipcRenderer.invoke('social-status'),
  socialRefresh: () => ipcRenderer.invoke('social-refresh'),
  socialToggle: (key: string, value: boolean) => ipcRenderer.invoke('social-toggle', key, value),
  socialConfigure: (platform: string, patch: unknown) => ipcRenderer.invoke('social-configure', platform, patch),
  socialApprove: (id: string) => ipcRenderer.invoke('social-approve', id),
  socialReject: (id: string) => ipcRenderer.invoke('social-reject', id),
  on: (channel: string, callback: (value: any) => void) => {
    if (!(CHANNELS as readonly string[]).includes(channel)) return;
    ipcRenderer.on(channel, (_event, value) => callback(value));
  },
});
