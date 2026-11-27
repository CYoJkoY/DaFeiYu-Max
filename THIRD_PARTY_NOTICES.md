# 素材与代码来源

动画、动作分类与动作选择逻辑来自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，固定版本 242fac13053ca6d7a5d316124df499013c2494a1。

上游代码采用 MIT 许可，完整文本见 licenses/dsh-pet-MIT.txt。动画、提示词和源视频的上游声明：允许开源使用，禁止商用；任何介绍、展示、分发衍生作品的地方须附上原作者 GitHub 地址。此应用保留原始动画文件，逐个验证 Git blob SHA-1。

动画清单见 `assets/catalog.json`；动作分类与选择逻辑按同一固定提交移植到 `lib/core/catalog.dart` 与 `lib/core/animation.dart`，之后只维护这份 Dart 实现。素材由上游取得后按透明 WebP 阶段随仓库提交，源视频不进 Git。README 和其他包含角色的演示截图也遵循上游素材要求。

Magpie 接口与集成文档：[yetone/magpie](https://github.com/yetone/magpie)。本项目仅通过其本地只读接口交互，不包含 Magpie 二进制，也不复制用户配置或凭据。请求和额度适配器是本项目的实现。`assets/provider-icons/` 中的 Cursor、Codex、DeepSeek 与 Volcengine 品牌 SVG 取自 Magpie 的 MIT 仓库，用于在额度面板和桌宠徽章中帮助识别供应商。

早期 Codex 只读状态适配的设计参考 [bianbian-666/Codex-dafeiyu](https://github.com/bianbian-666/Codex-dafeiyu)，最初的宠物安装思路参考 [yifanlu0227/DaFeiYu-codex-pet](https://github.com/yifanlu0227/DaFeiYu-codex-pet)。当前版本已移除 Codex 适配；没有采用后者的 spritesheet。两者在此作为参考来源致谢，不表示其作者直接参与提交或为本项目背书。

运行时与构建工具包括 [Flutter](https://flutter.dev) 与 [Dart](https://dart.dev)（界面运行时与语言）、[window_manager](https://pub.dev/packages/window_manager)、[tray_manager](https://pub.dev/packages/tray_manager)、[flutter_acrylic](https://pub.dev/packages/flutter_acrylic)、[flutter_svg](https://pub.dev/packages/flutter_svg) 与 [archive](https://pub.dev/packages/archive) 等 pub 包。依赖保留各自许可证，完整清单见 `pubspec.lock`；Electron、esbuild 与 Zig 工具链已随 Flutter 重写移除，本仓库不再分发它们的运行时。

## 品牌与图标

应用图标与托盘图标的母版是本项目使用的 1024px PNG 角色插画（`assets/brand/app-icon.png` 与 `assets/brand/tray-icon.png`）。形象沿用上游 dsh-pet 蓝发角色与「大肥鱼」主题，并带有鲸鱼尾元素；**不是** DeepSeek 官方标志，也不代表 DeepSeek 的授权、合作或背书。`.png`、`.ico`、`.icns` 以及 `magpie/icon.png` 都由这些 PNG 母版手工导出并随仓库提交，仓库内不引用任何官方品牌源文件。

此项目为独立社区工具，与 OpenAI、DeepSeek、Magpie 无官方隶属关系。仓库新增代码的 MIT 许可不覆盖第三方角色与动画素材。

