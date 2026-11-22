import type { SocialPlatformId } from './types.js';

export interface PlatformDescriptor {
  id: SocialPlatformId;
  label: string;
  /** Public read path (no private credentials required). */
  reads: boolean;
  /** Write path exists at all — drafts are always allowed, sending is gated. */
  writes: boolean;
  requires: 'none' | 'bridge' | 'credentials';
  note: string;
}

/**
 * The platforms the pet can watch. Reads are public pages/APIs where possible;
 * Douyin and Xiaoheihe have no public read API, so they only work through a
 * user-run local bridge that the user configures themselves.
 */
export const SOCIAL_PLATFORMS: readonly PlatformDescriptor[] = [
  {
    id: 'bilibili',
    label: '哔哩哔哩',
    reads: true,
    writes: false,
    requires: 'none',
    note: '读取公开热门视频；评论草稿需要你复制到网页手动发布，桌宠不代为登录。',
  },
  {
    id: 'tieba',
    label: '百度贴吧',
    reads: true,
    writes: false,
    requires: 'none',
    note: '按你的兴趣关键词读取吧内新帖标题；回复需要你手动复制草稿。',
  },
  {
    id: 'douyin',
    label: '抖音',
    reads: true,
    writes: true,
    requires: 'bridge',
    note: '需要你本机运行的桥接服务（桥接地址由你填写），桌宠不自行登录。',
  },
  {
    id: 'xiaoheihe',
    label: '小黑盒',
    reads: true,
    writes: true,
    requires: 'bridge',
    note: '需要你本机运行的桥接服务；没有桥接时只显示为“需要桥接”。',
  },
];

export const PLATFORM_IDS: readonly string[] = SOCIAL_PLATFORMS.map(platform => platform.id);

export function platformDescriptor(id: string): PlatformDescriptor | undefined {
  return SOCIAL_PLATFORMS.find(platform => platform.id === id);
}

export function platformLabel(id: string): string {
  return platformDescriptor(id)?.label ?? id;
}
