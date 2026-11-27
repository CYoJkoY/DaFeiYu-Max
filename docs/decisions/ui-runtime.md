# 决策记录：界面运行时改为 Flutter

状态：已采纳（2026-11-25）。取代本文末尾 2026-11 早些时候「保留 Electron」的结论。

## 决策

界面运行时整体迁移到 Flutter：桌宠窗口、面板、动画播放、请求灯泡、额度徽章与窗口按钮由同一份 Dart 代码绘制，Windows x64 与 Apple Silicon macOS 共用 `lib/`，平台差异只留在应用数据目录、托盘外观、打开 Magpie 的路径与打包签名。

## 为什么改

- 自绘窗口按钮是明确的产品要求。Electron 要做到「标题栏、最小化、最大化、关闭全由应用画」仍要绕开系统窗口装饰，而 Flutter 的 `window_manager` + 自绘标题栏是清爽的原生路径，两个平台行为一致。
- 透明桌宠窗口与逐帧动画对合成路径敏感。Flutter 直接给出 `RepaintBoundary` 截图与稳定的 Skia 合成，不必再担心 CSS 滤镜、`backdrop-filter` 与视频层透明带来的边缘杂色。
- 迁移后仓库同时少掉 Node 与 Zig 两套工具链：构建、测试、打包都只剩 `flutter`，CI 配置与本地环境大幅变短。
- 插件生态（WASM 沙箱、市场、社交摘要）本来就没有在用户侧形成依赖，迁移期先收敛这部分能力，代价可控。

## 代价

- Flutter 桌面端需要 Visual Studio（Windows）与 Xcode（macOS，插件全部是 Swift Package，不需要 CocoaPods）才能打包；CI 的两个打包任务因此更重。
- 迁移初期脚本插件运行时、插件市场与社交摘要都还没迁：面板保留入口但标注「未开放」/「未启用」，仓库不再附带 Zig SDK 与 WASM 示例。插件市场随后用 Dart 重新接上（见 [plugin-market.md](../plugin-market.md)），只做读取索引、校验与安装/卸载；脚本插件运行时与社交摘要仍未迁移。
- 上一版按 DOM/CSS 写成的视觉细节需要在 Dart 里逐项重画，包括 106 段 WebP 动画的播放与调色。
- 仓库红线从「TypeScript + Zig」先收紧到「Dart + 静态 HTML/CSS」，随后在 `languages.md` 里定稿为「Dart + Zig + TypeScript，至多三种」；`test/distribution_test.dart` 相应重写，`windows/`、`macos/` 的宿主外壳单独按生成物检查。

## 历史：当初为什么保留 Electron

2026-11 早些时候的结论是「自绘按钮立刻做，整体迁移不做」。当时的理由是：仓库红线限定 TypeScript + Zig；Magpie 页面与两个窗口共用 DOM/CSS 视觉资产；脚本插件 ABI 以 WebView/JSON 意图为契约；打包流程按 Electron 产物写成。这四条都成立，只是产品把「界面流畅度与窗口控件可定制」排到了更高优先级，因此用一次完整迁移换掉这些约束，而不是在 Electron 里做局部优化。

## 影响

- 用户可见变化：窗口按钮与标题栏完全由应用绘制，面板与桌宠的透明边缘更干净，安装包不再携带 Electron 运行时。
- 维护者需要按 `AGENTS.md` 的新命令工作；发布流程改为 `flutter build` 产出同样的两个 ZIP 名称。
