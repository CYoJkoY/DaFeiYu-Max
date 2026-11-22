// 纯数据类型：供 vendor/pickers.ts 与共享核心使用，不引入任何运行时依赖。

/** 动画分类：id 用于菜单与诊断，actions 为该分类下的动画名。 */
export interface Category {
  id: string;
  name?: string;
  weight: number;
  noMirror?: boolean;
  actions: string[];
}

/** 事件槽位：字符串表示固定动画，数组表示档内候选。 */
export type EventSlot = string | string[];

/** 事件池：键为事件名，值为若干槽位。 */
export type Events = Record<string, EventSlot[]>;

/** 掷骰权重（百分比，三者之和可小于 100，余量归入 action）。 */
export interface Weights {
  idle: number;
  turn: number;
  move: number;
}
