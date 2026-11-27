# AGENTS.md

面向维护 magpie-DaFeiYu 的编码代理。Windows 与 macOS 上的代理共同维护这一个共享仓库。

## 跨平台红线

- 单一共享代码库，同时服务 Windows 10+ x64 与 Apple Silicon Mac（macOS 12+）；禁止平台分支或分叉。
- 主界面、动画、请求灯泡、额度面板与 Magpie 本地读取共用同一份 `lib/` 代码；平台差异只允许集中在应用数据目录、托盘图标/菜单外观、打开 Magpie 的路径查找、打包与签名。
- `Platform.is…` / `defaultTargetPlatform` 只允许出现在 `lib/app/app_paths.dart`、`lib/app/tray_service.dart`、`lib/app/app_controller.dart`（查找并打开 Magpie）；`test/distribution_test.dart` 会扫描其余共享代码并在越界时失败。
- Magpie 本地配置沿用官方同一路径 `~/.config/magpie/settings.json`（遵循 `XDG_CONFIG_HOME`），Windows 与 macOS 一致；不要按平台拆配置路径。
- 「打开 Magpie」在 Windows 依次查找 `%LOCALAPPDATA%\Programs\magpie\magpie.exe`、`%LOCALAPPDATA%\magpie\magpie.exe` 与 Program Files；macOS 查找 `/Applications/magpie.app` 与 `~/Applications/magpie.app`。
- 托盘图标：Windows 用 PNG，macOS 沿用 emoji 标题。
- 两端都不显示系统标题栏：窗口按钮、标题栏拖拽区与托盘菜单外观都由共享的 Flutter 控件绘制，不要退回系统原生按钮。

## 语言约定

- 全仓库最多三种编程语言，分工固定：**Dart**（`lib/`、`test/`，界面与全部共享逻辑）、**Zig**（需要脱离 Flutter 运行时的原生能力与 WASM 插件）、**TypeScript**（工具脚本、桥接示例、构建辅助）。除这三种之外不要引入任何语言：JavaScript（含 `.cjs` / `.mjs`）、Python、PowerShell、Shell / 批处理、Rust、C#、Kotlin、Ruby、Lua 一律不允许。
- 当前主应用是纯 Dart。`lib/` 里没有 Zig / TypeScript，构建、测试、打包也只需要 `flutter` 一条工具链；只有在确实需要跨出 Dart 能力边界时才引入 Zig 或 TypeScript，并且要在同一次改动里补上 CI 步骤（`setup-zig` / `setup-node`）与 `test/distribution_test.dart` 的期望。
- `windows/` 与 `macos/` 里的 C++ / Swift 是 `flutter create` 生成的最小宿主外壳，是唯一允许出现第三种语言的代码，只做窗口与打包胶水：不许往里面塞共享逻辑，也不许出现 `.dart` / `.zig` / `.ts` 文件。宿主外壳出现其他语言时，先确认它是不是 `flutter create` 的产物。
- Magpie 页面只有 `index.html` + `page.css`（`magpie/`）：这是 Magpie 宿主按原样加载的静态页面格式，属于接口约定而不是第四种源语言，语言用单选按钮配合 CSS 切换，默认中文。页面不得出现 `<script`、内联事件、`javascript:` 或任何脚本产物；Magpie 页面不参与应用打包。
- `test/distribution_test.dart` 以 `git ls-files`（受版本控制的文件）为基准检查语言红线：出现 `.js` / `.cjs` / `.mjs` / `.py` / `.ps1` / `.sh` / `.bat` / `.rs` / `.cs` / `.kt` / `.rb` / `.swift` / `.c` / `.cpp` 等第四种语言、宿主外壳里出现 Dart / Zig / TypeScript、Magpie 页面出现脚本、CI 的 Node / Zig 步骤与仓库实际语言不一致、文档没写明三种语言上限，或 `pubspec.yaml` 与 `lib/core/version.dart` 版本不同步，都会失败。
- 同级插件仓库 `DaFeiYu-Max-Plugins` 共用这条上限，只用 Zig 与 TypeScript，并由它自己的 `scripts/check-languages.ts` 在 CI 里守住。
- 完整取舍、现状盘点与例外清单见 `docs/decisions/languages.md`。

## 命令

```bash
flutter pub get
flutter analyze
flutter test
flutter run -d windows        # 或 -d macos
flutter build windows --debug # 或 --release
flutter build macos --debug   # 或 --release
```

- 冒烟测试：`.\build\windows\x64\runner\Debug\BlueDaFeiYu.exe --smoke-test`（macOS 用 `flutter build macos --debug` 后打开 `build/macos/Build/Products/Debug/BlueDaFeiYu.app`）。截图与 `smoke.json` 写入 `DAFEIYU_QA_DIR` 或应用 userData 的 `qa/`，不写入应用安装目录，也不提交进仓库。

## 发布与安装约定

- 产物命名：`magpie-DaFeiYu-vX.Y.Z-Windows-x64.zip`（解压后直接运行 `BlueDaFeiYu.exe`，不含安装器）、`magpie-DaFeiYu-vX.Y.Z-macOS-arm64.zip`（内含「蓝色大肥鱼.app」）。
- Windows 版为便携应用；不安装、不创建快捷方式、无需管理员权限且不设开机启动。
- macOS 仅 ad-hoc 签名，Windows 未签名；文档里如实说明，不得声称做了未执行的签名、公证或验证。
- 版本保持 `0.1.x`；`pubspec.yaml` 的 `version:` 与 `lib/core/version.dart` 的 `appVersion` 必须一致。版本号与发布说明一起推送到 main 后，两端构建全部通过才会自动创建标签和 Release；也支持匹配的标签触发。已发布版本不覆盖。

## 验证与诚实性

- 单元测试由 CI 在 Windows / macOS / Linux 运行；打包由 CI 在 macOS（Apple Silicon）与 Windows（x64）完成。
- 只在代理实际运行过的操作系统上描述界面验证；发布说明只写计划中的改动，不写未执行的测试结果。
- 便携运行方式如有出入，由主线维护者统一后再改文档，避免文档自相矛盾。

## 文案与素材

- 保持中文语气与现有视觉资产；角色动画来自 PC2005-cloud/dsh-pet，非商用，展示与分发须保留来源。
- Magpie 页面必须保留「不会自动安装或启动桌宠」说明与 `releases/latest` 链接；压缩包要与系统匹配。
- 脚本插件运行时与插件市场尚未迁移到 Flutter 版本：面板文案要如实说明当前限制，不要描述本仓库已经删掉的 Zig / WASM 能力。
- 插件侧源码（Zig 插件、`sdk/dfy.zig`、TypeScript 工具脚本）维护在同级的 `DaFeiYu-Max-Plugins` 仓库；那是 Zig + TypeScript，本仓库不复制它的源码，也不因此引入新的语言。
