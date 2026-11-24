import { contextBridge, ipcRenderer } from 'electron';

const CHANNELS = ['snapshot', 'activity', 'quota', 'play', 'cursor', 'settings', 'social', 'catalog', 'plugins-runtime', 'window-state'] as const;

contextBridge.exposeInMainWorld('pet', {
  platform: process.platform,
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
  windowControl: (action: 'minimize' | 'maximize' | 'close') => ipcRenderer.send('window-control', action),
  windowState: () => ipcRenderer.invoke('window-state'),
  resize: (height: number) => ipcRenderer.send('resize', height),
  socialStatus: () => ipcRenderer.invoke('social-status'),
  socialRefresh: () => ipcRenderer.invoke('social-refresh'),
  socialToggle: (key: string, value: boolean) => ipcRenderer.invoke('social-toggle', key, value),
  socialConfigure: (platform: string, patch: unknown) => ipcRenderer.invoke('social-configure', platform, patch),
  socialApprove: (id: string) => ipcRenderer.invoke('social-approve', id),
  socialReject: (id: string) => ipcRenderer.invoke('social-reject', id),
  pluginsRuntimeStatus: () => ipcRenderer.invoke('plugins-runtime-status'),
  marketRefresh: () => ipcRenderer.invoke('market-refresh'),
  marketInstall: (id: string) => ipcRenderer.invoke('market-install', id),
  marketUninstall: (id: string) => ipcRenderer.invoke('market-uninstall', id),
  pluginToggle: (id: string, enabled: boolean) => ipcRenderer.invoke('plugin-toggle', id, enabled),
  pluginOption: (id: string, key: string, value: unknown) => ipcRenderer.invoke('plugin-option', id, key, value),
  pluginCommand: (id: string, name: string) => ipcRenderer.invoke('plugin-command', id, name),
  pluginInstallLocal: () => ipcRenderer.invoke('plugin-install-local'),
  on: (channel: string, callback: (value: any) => void) => {
    if (!(CHANNELS as readonly string[]).includes(channel)) return;
    ipcRenderer.on(channel, (_event, value) => callback(value));
  },
});
