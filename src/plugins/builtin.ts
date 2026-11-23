import { PLUGIN_SCHEMA_VERSION, type PluginManifest } from './manifest.ts';

/** Built-in plugins use the same declarative manifest contract as extensions. */
export const BUILTIN_PLUGINS: readonly PluginManifest[] = [
  {
    schemaVersion: PLUGIN_SCHEMA_VERSION,
    id: 'bilibili-popular',
    version: '1.0.0',
    kind: 'social',
    name: 'Bilibili popular',
    labels: { zh: '哔哩哔哩热门', en: 'Bilibili popular' },
    description: '读取哔哩哔哩公开热门视频，只读、无需登录。',
    social: { implementation: 'bilibili', platform: 'bilibili', requires: 'none', reads: true, writes: false },
  },
  {
    schemaVersion: PLUGIN_SCHEMA_VERSION,
    id: 'tieba-forum',
    version: '1.0.0',
    kind: 'social',
    name: 'Tieba forum',
    labels: { zh: '百度贴吧', en: 'Tieba forum' },
    description: '按兴趣关键词读取贴吧公开帖子标题。',
    social: { implementation: 'tieba', platform: 'tieba', requires: 'none', reads: true, writes: false },
  },
  {
    schemaVersion: PLUGIN_SCHEMA_VERSION,
    id: 'douyin-bridge',
    version: '1.0.0',
    kind: 'social',
    name: 'Douyin bridge',
    labels: { zh: '抖音（桥接）', en: 'Douyin (bridge)' },
    description: '通过你本机运行的桥接服务读取并可选发送，桌宠不自行登录。',
    requiresTrust: true,
    social: { implementation: 'bridge', platform: 'douyin', requires: 'bridge', reads: true, writes: true, feedPath: '/feed', messagePath: '/message' },
  },
  {
    schemaVersion: PLUGIN_SCHEMA_VERSION,
    id: 'xiaoheihe-bridge',
    version: '1.0.0',
    kind: 'social',
    name: 'Xiaoheihe bridge',
    labels: { zh: '小黑盒（桥接）', en: 'Xiaoheihe (bridge)' },
    description: '通过你本机运行的桥接服务读取并可选发送，桌宠不自行登录。',
    requiresTrust: true,
    social: { implementation: 'bridge', platform: 'xiaoheihe', requires: 'bridge', reads: true, writes: true, feedPath: '/feed', messagePath: '/message' },
  },
  {
    schemaVersion: PLUGIN_SCHEMA_VERSION,
    id: 'classic-finish',
    version: '1.0.0',
    kind: 'appearance',
    name: 'Classic finish',
    labels: { zh: '經典外觀', en: 'Classic finish' },
    description: '默认外观：沿用内置动画与蓝色调色板。',
    appearance: { accent: '#2f6fe0' },
  },
  {
    schemaVersion: PLUGIN_SCHEMA_VERSION,
    id: 'spring-festival',
    version: '1.0.0',
    kind: 'festival',
    name: 'Spring Festival',
    labels: { zh: '春节装扮', en: 'Spring Festival' },
    description: '春节期间让桌宠披上节日的红色调，并说一句新年好。',
    festival: {
      window: { start: '01-20', end: '02-20', greeting: '新春快乐，恭喜发财！', accent: '#d5373c', accessories: ['🧧', '🏮'] },
    },
  },
  {
    schemaVersion: PLUGIN_SCHEMA_VERSION,
    id: 'mid-autumn',
    version: '1.0.0',
    kind: 'festival',
    name: 'Mid-Autumn',
    labels: { zh: '中秋装扮', en: 'Mid-Autumn' },
    description: '中秋前后换成暖金色调，配一块月饼。',
    festival: {
      window: { start: '09-10', end: '10-10', greeting: '中秋快乐，月圆人团圆！', accent: '#c98a2b', accessories: ['🥮', '🌕'] },
    },
  },
];

export function builtinPlugins(): PluginManifest[] {
  return BUILTIN_PLUGINS.map(manifest => structuredClone(manifest));
}
