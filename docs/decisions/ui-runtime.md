# 决策记录：界面运行时为什么保留 Electron

状态：已采纳（2026-11）

## 背景

有提议把界面整体迁移到 Flutter，理由是动画与窗口交互会更顺滑，同时希望窗口的最小化 / 最大化 / 关闭按钮不再使用系统标题栏，而是自绘一套更贴合角色画风的控件。

## 决策

1. 两个需求分开处理。**自绘窗口按钮立刻做**，因为它是纯前端改动，两个平台共用一份代码。
2. **不整体迁移到 Flutter**。改为在 Electron 里做定点性能优化，并把可验证的优化项写进本文档，方便后续逐条推进。

## 为什么不是 Flutter

- 仓库红线是「单一共享代码库，源码语言只有 TypeScript + Zig」。`tests/distribution.test.ts` 会扫描整个仓库，出现 `.dart` 等扩展名即失败。迁移 Flutter 等于推翻这条已落地的约束，并把两端打包、签名、托盘、Magpie 读取路径全部重写。
- Magpie 页面是纯 HTML + CSS 静态页，由 Magpie 宿主直接加载。宠物窗口与面板窗口也共用同一套 DOM/CSS 视觉资产（角色动画是 WebM，按 CSS 滤镜调色）。
- 脚本插件 ABI（`sdk/dfy.zig` + `src/plugins/script/*`）以 WebView/Worker 侧 JSON 意图为契约，宿主负责全部 I/O。换渲染引擎要重新定义这一层契约并重写插件生态。
- Windows x64 与 macOS arm64 的 CI 打包流程（`scripts/package.ts`、`verify-archives.ts`）是按 Electron 产物写的。
- 结论：迁移成本远超收益，且会同时破坏「两端同一份 UI」这条产品前提。

## 顺滑度改进清单（电子方案内）

已做：

- 拖拽 / 惯性循环改为按需启动：静止时不再每 16 ms 轮询一次鼠标位置，减少后台唤醒。
- 面板滚动条改为细滚动条，避免与自绘标题栏在视觉上打架。
- 标题栏拖拽区使用 `-webkit-app-region: drag`，按钮区 `no-drag`，拖动由合成器处理而不是 JS 逐帧 `setPosition`。

待评估（需实测帧时间后再决定，不写在发布说明里当已完成的成果）：

- 宠物窗口的 `transparent: true` + 每帧重绘 WebM 的合成开销：评估是否给视频层加 `will-change: opacity`、避免触发布局抖动。
- 面板 `backdrop-filter` 在低端机上的代价：必要时降级为纯色背景。
- 高频 `executeJavaScript` 诊断只在 smoke 测试中启用，运行时不保留。

## 影响

- 用户可见的变化是自绘标题栏与更安静的拖拽，不需要新的运行时依赖。
- 后续若真要评估 Flutter，应先改仓库红线与 CI，而不是先写 UI。
