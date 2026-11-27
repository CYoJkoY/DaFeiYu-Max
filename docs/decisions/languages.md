# 决策记录：编程语言收敛到 Dart + Zig + TypeScript

状态：已采纳（2026-11-27）。取代 `ui-runtime.md` 里「仓库红线 = Dart + 静态 HTML/CSS」这条临时结论。

## 决策

主应用仓库与同级插件仓库 `DaFeiYu-Max-Plugins`，**最多三种编程语言**：

| 语言 | 只负责什么 | 出现在哪 |
| --- | --- | --- |
| Dart | 全部界面、动画调度、额度与请求模型、Magpie 本地读取、设置与插件清单 | 主应用 `lib/`、`test/` |
| Zig | 需要脱离 Flutter 运行时或跑在 WASM 沙箱里的原生能力 | 插件仓库的 `plugins/*/src/*.zig` 与 `sdk/dfy.zig` |
| TypeScript | 工具脚本、桥接示例、索引与校验等构建辅助 | 插件仓库 `scripts/*.ts`、`tools/bridge.ts` |

除此之外不再引入任何语言。JavaScript（含 `.cjs` / `.mjs`）、Python、PowerShell、Shell / 批处理、Rust、C#、Kotlin、Ruby、Lua 都不允许以源文件、脚本或生成物形式进入仓库。

## 为什么

- **职责不重叠。** Flutter 已经用 Dart 提供界面、状态与本地 IO；Zig 负责 Dart 够不到的原生/WASM 边界；TypeScript 负责工程化脚本。三者恰好覆盖全部需求，第四种语言只会重复其中一件事。
- **一种能力只写一遍。** 上一代 Electron 版本里动画调度、Magpie 适配和面板视觉在 TypeScript 与 Zig 之间来回搬运，同一逻辑有过两份实现；Flutter 重写后这些全部归 Dart，`lib/core/animation.dart` 只是 `src/core/animation.ts` 的一次性移植结果，之后不再并行维护。
- **门槛与成本成正比。** 每多一种语言就多一套工具链、依赖锁、CI 步骤、代码审查标准与贡献者前置知识。现在主应用的构建、测试、打包只需要 `flutter` 一条命令链。
- **迁移有路可走。** 插件运行时将来回到主应用时，走的是已经存在的 Zig + TypeScript 通道，不需要再引入第四种语言。

## 现状盘点（2026-11-27）

| 范围 | 语言 | 现状 |
| --- | --- | --- |
| 主应用 `lib/`、`test/` | Dart | 32 个文件，界面、模型、测试全部在这里 |
| 主应用 `magpie/` | HTML + CSS | 2 个文件，Magpie 宿主按原样加载的静态页面 |
| 主应用 `windows/` | C++ / CMake | `flutter create` 生成的宿主外壳 |
| 主应用 `macos/` | Swift | `flutter create` 生成的宿主外壳 |
| 主应用 CI | YAML + 少量 shell 片段 | 只调用 `flutter`；打包用 `pwsh` / `bash` 一行命令 |
| 插件仓库 | Zig | `plugins/douyin-scroll/src/main.zig`、`sdk/dfy.zig` |
| 插件仓库 | TypeScript | `scripts/*.ts`、`tools/bridge.ts` |

主应用目前是**纯 Dart**：仓库里没有任何 `.zig` / `.ts` 文件，构建与 CI 也不需要 Node 或 Zig。也就是说，三种语言是上限而不是配额，够用就不加。

## 不可避免的例外

这些不算「第四种语言」，因为它们不是我们写的逻辑，替换不了也无需替换：

1. **`windows/` 的 C++ 与 `macos/` 的 Swift。** Flutter 桌面端必须由这两个宿主外壳启动引擎，官方模板就是这两种语言。约定是：只留 `flutter create` 生成的内容，不写共享逻辑，也不在里面出现 `.dart` / `.zig` / `.ts`。
2. **`magpie/index.html` 与 `page.css`。** Magpie 的页面插件就是静态 HTML，宿主要求的接口格式。页面保持零脚本，因此不需要 JavaScript 或 TypeScript 参与。
3. **构建与打包配置。** `CMakeLists.txt`、`pubspec.yaml`、`.github/workflows/*.yml`、`Info.plist`、`Runner.rc`、`*.xcconfig` 等是声明式配置，不是编程语言；CI 里为了打包 macOS 压缩包和签名写的几行 `bash` / `pwsh` 属于工作流编辑器本身的要求，不单独成为项目语言。

## 如何执行

- `test/distribution_test.dart` 用 `git ls-files` 取受版本控制的文件作为契约，逐条检查扩展名：只允许 `.dart` / `.zig` / `.ts`，其余编程语言扩展名一律报错并列出文件名。
- 同一份测试检查宿主外壳里没有 Dart / Zig / TypeScript（防止有人把共享逻辑塞进 `windows/` 或 `macos/`），检查 CI 的 `setup-node` / `setup-zig` 与仓库里实际的 `.ts` / `.zig` 文件一致（不出现空转的工具链，也不出现缺少工具链的语言）。
- 插件仓库用 `node scripts/check-languages.ts` 做同一件事：只允许 Zig 与 TypeScript，`validate.yml` 每次跑。
- 只有在确实需要跨出 Dart 能力边界时，才在 `AGENTS.md` 约定的位置新增 Zig 或 TypeScript，并在同一次改动里补齐 CI 步骤与测试期望。

## GitHub 语言统计

GitHub 的语言条按 linguist 的默认规则统计，`windows/`、`macos/` 的宿主外壳（C++ / CMake / Swift）与 `magpie/` 的静态页面（HTML / CSS）会照原样计入。此前曾用 `.gitattributes` 的 linguist 规则把它们排除出统计，现已按维护者要求移除这些规则，语言条如实展示仓库的文件构成；`test/distribution_test.dart` 不再检查任何 linguist 排除规则。

## 代价

- 主应用眼下没有 Zig / TypeScript，如果将来要补原生能力，需要同时改 CI 与语言测试，改动面比「随手写个脚本」大。
- Zig 工具链版本被钉在插件仓库（0.17.1），主应用引入时要注意对齐。
- 文档必须跟着语言策略走：清掉「仓库没有 TypeScript / Zig」这类旧表述，否则测试会直接失败。
