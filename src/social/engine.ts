import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PetSettings, SocialDraft, SocialPlatformStatus, SocialReport } from '../core/types.ts';
import { sanitizeBridgeUrl } from '../core/settings.ts';
import { SOCIAL_PLATFORMS, platformDescriptor, platformLabel } from './registry.ts';
import { buildDigest } from './digest.ts';
import { dedupeKey, evaluateWrite, sanitizeText } from './policy.ts';
import type { ReadContext, SocialAdapter, SocialItem } from './types.ts';
import { bilibiliAdapter } from './adapters/bilibili.ts';
import { tiebaAdapter } from './adapters/tieba.ts';
import { douyinAdapter, xiaoheiheAdapter } from './adapters/bridged.ts';
import type { CredentialVault } from './vault.ts';

const ADAPTERS: Record<string, SocialAdapter> = {
  bilibili: bilibiliAdapter,
  tieba: tiebaAdapter,
  douyin: douyinAdapter,
  xiaoheihe: xiaoheiheAdapter,
};

export interface SocialEngineOptions {
  directory: string;
  vault: CredentialVault;
  getSettings: () => PetSettings;
  patchSocial: (mutate: (social: PetSettings['social']) => void) => void;
  fetcher?: typeof fetch;
  now?: () => number;
  logger?: (message: string) => void;
}

interface PlatformState {
  lastReadAt: number | null;
  error: string | null;
}

const MAX_DRAFTS = 10;

function clip(text: string, limit: number): string {
  const chars = [...text];
  return chars.length <= limit ? text : chars.slice(0, limit - 1).join('') + '…';
}

export class SocialEngine {
  private readonly options: SocialEngineOptions;
  private items: SocialItem[] = [];
  private drafts: SocialDraft[] = [];
  private draftKeys = new Map<string, string>();
  private writes: number[] = [];
  private writeKeys: string[] = [];
  private state = new Map<string, PlatformState>();
  private timer: NodeJS.Timeout | null = null;
  private refreshing: Promise<SocialReport> | null = null;
  private reportValue: SocialReport;
  private counter = 0;

  constructor(options: SocialEngineOptions) {
    this.options = options;
    this.reportValue = {
      enabled: false,
      allowWrites: false,
      generatedAt: null,
      summary: '社交模块尚未启用。',
      bullet: '社交：未启用',
      highlights: [],
      platforms: this.platformStatuses(),
      drafts: [],
    };
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private context(platform: { id: string; requires: string }, bridgeUrl?: string): ReadContext {
    return {
      fetcher: this.options.fetcher ?? fetch,
      ...(bridgeUrl ? { bridgeUrl } : {}),
      credentials: this.options.vault.get(platform.id),
      interests: this.options.getSettings().interests,
      now: this.now(),
      timeoutMs: 8000,
    };
  }

  platformStatuses(): SocialPlatformStatus[] {
    const social = this.options.getSettings().social;
    return SOCIAL_PLATFORMS.map(platform => {
      const config = social.platforms[platform.id];
      const state = this.state.get(platform.id);
      const configured = platform.requires === 'bridge'
        ? Boolean(config?.bridgeUrl)
        : platform.requires === 'credentials' ? this.options.vault.has(platform.id) : true;
      const enabled = Boolean(config?.enabled) && configured;
      return {
        id: platform.id,
        label: platform.label,
        configured,
        reads: platform.reads && enabled,
        writes: platform.writes && enabled && Boolean(social.allowWrites),
        bridged: platform.requires === 'bridge',
        note: configured ? platform.note : platform.requires === 'bridge' ? '需要桥接：请填写你本机的桥接地址' : '需要凭据',
        lastReadAt: state?.lastReadAt ?? null,
        error: state?.error ?? null,
      };
    });
  }

  status(): SocialReport {
    const social = this.options.getSettings().social;
    return {
      ...this.reportValue,
      enabled: social.enabled,
      allowWrites: social.allowWrites,
      platforms: this.platformStatuses(),
      drafts: [...this.drafts],
    };
  }

  setEnabled(enabled: boolean): SocialReport {
    this.options.patchSocial(social => { social.enabled = enabled; });
    this.schedule();
    if (enabled) void this.refresh(true);
    return this.status();
  }

  setAllowWrites(allowWrites: boolean): SocialReport {
    this.options.patchSocial(social => { social.allowWrites = allowWrites; });
    if (!allowWrites) this.drafts = [];
    return this.status();
  }

  configurePlatform(platform: string, patch: { enabled?: unknown; bridgeUrl?: unknown; credentials?: unknown; clear?: unknown }): SocialReport {
    const descriptor = platformDescriptor(platform);
    if (!descriptor) throw new Error(`未知平台：${platform}`);
    this.options.patchSocial(social => {
      const entry = social.platforms[platform] ?? { enabled: false };
      if (typeof patch.enabled === 'boolean') entry.enabled = patch.enabled;
      const bridgeUrl = sanitizeBridgeUrl(patch.bridgeUrl);
      if (bridgeUrl) entry.bridgeUrl = bridgeUrl;
      else if (patch.bridgeUrl === null || patch.bridgeUrl === '') delete entry.bridgeUrl;
      social.platforms[platform] = entry;
    });
    if (patch.clear === true) this.options.vault.clear(platform);
    else if (patch.credentials && typeof patch.credentials === 'object' && !Array.isArray(patch.credentials)) {
      this.options.vault.set(platform, patch.credentials as Record<string, unknown>);
    }
    this.audit({ action: 'configure', platform, ok: true, reason: descriptor.label });
    this.reportValue = { ...this.reportValue, platforms: this.platformStatuses() };
    return this.status();
  }

  schedule(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const social = this.options.getSettings().social;
    if (!social.enabled) return;
    const interval = Math.min(180, Math.max(5, social.intervalMinutes)) * 60_000;
    this.timer = setInterval(() => { void this.refresh(); }, interval);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  refresh(force = false): Promise<SocialReport> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.runRefresh(force).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async runRefresh(force: boolean): Promise<SocialReport> {
    const social = this.options.getSettings().social;
    const now = this.now();
    if (!social.enabled) {
      this.reportValue = {
        enabled: false,
        allowWrites: social.allowWrites,
        generatedAt: now,
        summary: '社交模块已关闭。打开它以后，桌宠会按兴趣关键词读取公开动态。',
        bullet: '社交：已关闭',
        highlights: [],
        platforms: this.platformStatuses(),
        drafts: [],
      };
      return this.reportValue;
    }
    const collected: SocialItem[] = [];
    for (const platform of SOCIAL_PLATFORMS) {
      const config = social.platforms[platform.id];
      const adapter = ADAPTERS[platform.id];
      const previous = this.state.get(platform.id) ?? { lastReadAt: null, error: null };
      if (!adapter || !config?.enabled) {
        this.state.set(platform.id, previous);
        continue;
      }
      if (platform.requires === 'bridge' && !config.bridgeUrl) {
        this.state.set(platform.id, { lastReadAt: previous.lastReadAt, error: '需要桥接' });
        continue;
      }
      try {
        const result = await adapter.read(this.context(platform, config.bridgeUrl));
        if (result.ok) {
          collected.push(...result.items);
          this.state.set(platform.id, { lastReadAt: now, error: null });
        } else {
          this.state.set(platform.id, { lastReadAt: previous.lastReadAt, error: result.error || result.note });
        }
      } catch (error) {
        this.state.set(platform.id, { lastReadAt: previous.lastReadAt, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const deduped = new Map<string, SocialItem>();
    for (const item of collected) deduped.set(`${item.platform}:${item.id}`, item);
    this.items = [...deduped.values()];
    const digest = buildDigest(this.items, this.options.getSettings().interests, now);
    this.proposeDrafts();
    this.reportValue = {
      enabled: true,
      allowWrites: social.allowWrites,
      generatedAt: now,
      summary: digest.summary,
      bullet: digest.bullet,
      highlights: digest.highlights,
      platforms: this.platformStatuses(),
      drafts: [...this.drafts],
    };
    this.audit({ action: 'refresh', ok: true, reason: `${this.items.length} items`, ...(force ? { forced: true } : {}) });
    return this.reportValue;
  }

  private proposeDrafts(): void {
    const social = this.options.getSettings().social;
    if (!social.allowWrites || this.drafts.length >= MAX_DRAFTS) return;
    for (const platform of SOCIAL_PLATFORMS) {
      if (!platform.writes) continue;
      if (!social.platforms[platform.id]?.enabled) continue;
      const candidate = this.items.find(item => item.platform === platform.id && item.url);
      if (!candidate?.url) continue;
      const text = sanitizeText(`分享：《${clip(candidate.title, 40)}》 ${candidate.url}`);
      const target = candidate.url;
      const key = dedupeKey(platform.id, target, text);
      if (this.writeKeys.includes(key)) continue;
      if ([...this.draftKeys.values()].includes(key)) continue;
      const id = `draft-${this.now().toString(36)}-${++this.counter}`;
      this.draftKeys.set(id, key);
      this.drafts.push({ id, platform: platform.id, target, text, createdAt: this.now(),
        reason: `${platformLabel(platform.id)}·分享草稿，发送前请确认` });
      if (this.drafts.length >= MAX_DRAFTS) break;
    }
  }

  draftKey(id: string): string | null {
    return this.draftKeys.get(id) ?? null;
  }

  reject(id: string): SocialReport {
    const draft = this.drafts.find(entry => entry.id === id);
    if (draft) {
      this.drafts = this.drafts.filter(entry => entry.id !== id);
      this.draftKeys.delete(id);
      this.audit({ action: 'reject', platform: draft.platform, target: draft.target, ok: true, reason: 'user rejected' });
    }
    return this.status();
  }

  async approve(id: string): Promise<{ report: SocialReport; ok: boolean; note: string }> {
    const draft = this.drafts.find(entry => entry.id === id);
    if (!draft) return { report: this.status(), ok: false, note: '草稿不存在或已被处理' };
    const social = this.options.getSettings().social;
    const verdict = evaluateWrite({
      platform: draft.platform,
      target: draft.target,
      text: draft.text,
      now: this.now(),
      allowWrites: social.allowWrites,
      quietHours: social.quietHours,
      recentWrites: this.writes,
      recentKeys: this.writeKeys,
    });
    if (!verdict.allowed) {
      this.audit({ action: 'approve-denied', platform: draft.platform, target: draft.target, ok: false, reason: verdict.reason });
      return { report: this.status(), ok: false, note: verdict.reason };
    }
    const adapter = ADAPTERS[draft.platform];
    if (!adapter?.write) {
      this.audit({ action: 'approve-denied', platform: draft.platform, target: draft.target, ok: false, reason: 'draft only' });
      return { report: this.status(), ok: false, note: '该平台只能生成草稿，请复制后手动发布' };
    }
    const config = social.platforms[draft.platform];
    const result = await adapter.write(this.context({ id: draft.platform, requires: 'bridge' }, config?.bridgeUrl), {
      target: draft.target,
      text: verdict.text,
    });
    this.audit({ action: 'write', platform: draft.platform, target: draft.target, chars: verdict.text.length, ok: result.ok, reason: result.error || result.note });
    if (!result.ok) return { report: this.status(), ok: false, note: result.error || result.note };
    this.writes.push(this.now());
    this.writeKeys.push(verdict.key);
    this.drafts = this.drafts.filter(entry => entry.id !== id);
    this.draftKeys.delete(id);
    return { report: this.status(), ok: true, note: result.note };
  }

  private audit(entry: Record<string, unknown> & { action: string }): void {
    try {
      mkdirSync(this.options.directory, { recursive: true });
      appendFileSync(join(this.options.directory, 'social-audit.jsonl'),
        JSON.stringify({ at: this.now(), ...entry, text: undefined }) + '\n');
    } catch (error) {
      this.options.logger?.(`audit failed: ${String(error)}`);
    }
  }
}
