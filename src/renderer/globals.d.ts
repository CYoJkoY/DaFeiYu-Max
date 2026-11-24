/**
 * The preload bridge (src/preload.ts) is the only way the renderer windows
 * reach the main process, so its surface is declared once here and shared by
 * both bundles.
 */
import type {
  Activity, Catalog, CatalogUpdate, InstalledScriptPlugin, MarketIndex, PetSettings,
  PluginSnapshot, Quota, SocialReport, Snapshot, Theme,
} from '../core/types.ts';

export interface PetApi {
  getSnapshot(): Promise<Snapshot>;
  play(name: string): void;
  menu(): void;
  panel(): void;
  refreshQuota(): Promise<Quota>;
  setting(key: string, value: unknown): void;
  drag(phase: 'start' | 'end'): void;
  interactive(value: boolean): void;
  openMagpie(): void;
  openRepository(): void;
  resize(height: number): void;
  socialStatus(): Promise<SocialReport | null>;
  socialRefresh(): Promise<SocialReport | null>;
  socialToggle(key: 'enabled' | 'allowWrites', value: boolean): Promise<SocialReport | null>;
  socialConfigure(platform: string, patch: Record<string, unknown>): Promise<SocialReport | null>;
  socialApprove(id: string): Promise<{ report: SocialReport; ok: boolean; note: string } | null>;
  socialReject(id: string): Promise<SocialReport | null>;
  pluginsRuntimeStatus(): Promise<PluginsRuntimeStatus | null>;
  marketRefresh(): Promise<PluginsRuntimeStatus | null>;
  marketInstall(id: string): Promise<{ ok: boolean; error?: string } | null>;
  marketUninstall(id: string): Promise<{ ok: boolean; error?: string } | null>;
  pluginToggle(id: string, enabled: boolean): Promise<boolean>;
  pluginOption(id: string, key: string, value: unknown): Promise<boolean>;
  pluginCommand(id: string, name: string): Promise<boolean>;
  pluginInstallLocal(): Promise<{ ok: boolean; error?: string; detail?: string; id?: string; note?: string } | null>;
  on(channel: 'snapshot' | 'activity' | 'quota' | 'play' | 'cursor' | 'settings' | 'social' | 'catalog' | 'plugins-runtime', callback: (value: any) => void): void;
}

export interface MarketProvenanceEntry {
  version: string;
  sha256: string;
  installedAt: number;
}

export interface PluginsRuntimeStatus {
  market: {
    repo: string;
    ref: string;
    lastSync: number | null;
    error: string | null;
    index: MarketIndex | null;
    installed: Record<string, MarketProvenanceEntry>;
  } | null;
  installed: InstalledScriptPlugin[];
  issues: string[];
}

export interface PetDiagnostics {
  loaded: boolean;
  errors: string[];
  played: string[];
  transparent: boolean;
  video?: { width: number; height: number; duration: number };
  alpha?: { clear: number; opaque: number };
}

declare global {
  interface Window {
    pet: PetApi;
    petDiagnostics: PetDiagnostics;
  }
}

export type {
  Activity, Catalog, CatalogUpdate, InstalledScriptPlugin, MarketIndex, PetSettings,
  PluginSnapshot, Quota, SocialReport, Snapshot, Theme,
};
