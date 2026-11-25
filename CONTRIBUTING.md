# Contributing

欢迎改进 magpie-DaFeiYu。请保持 Magpie 接入只读、可断连降级，不发送模型请求。

本项目是单一共享代码库，同时服务 Windows 10+ x64 与 Apple Silicon Mac（macOS 12+）。主界面、动画、请求灯泡、额度面板与 Magpie 本地读取都在同一份 `lib/` Dart 代码里；平台差异只允许出现在很窄的范围（数据目录、托盘/菜单外观、打开 Magpie 的路径、打包与签名）。不要创建平台分支或分叉，也不要在共享逻辑里散落平台判断——`test/distribution_test.dart` 会检查这一点。

## 提交问题

请提供操作系统与版本（Windows 10+ x64，或 macOS 版本与芯片架构）、Magpie 版本、复现步骤和预期效果。截图请遮盖账号信息；不要上传设置文件、密钥、聊天内容、原始路由响应或整个 `qa/` 目录。

## 本地开发

需要 Flutter 3.50+（Dart 3.14+）与 Git；Windows 需要 Visual Studio 的「使用 C++ 的桌面开发」，macOS 只需要 Xcode（插件全部走 Swift Package Manager，不需要 CocoaPods）。两端命令一致：

```bash
flutter pub get
flutter analyze
flutter test
flutter run -d windows   # macOS 用 -d macos
```

仓库没有 Node、npm、Zig 步骤，也没有 JavaScript / TypeScript 源文件需要构建。`windows/` 与 `macos/` 是 `flutter create` 生成的最小宿主外壳，只在确需平台能力时修改，不要往里复制共享逻辑。

## 提交代码

1. Fork 仓库，创建功能分支。
2. 修改 `lib/` 下的共享代码；为账号匹配、调度、边界等行为补充有意义的测试（`test/`）。
3. 运行 `flutter analyze` 与 `flutter test`；界面或打包方式的改动，在你手头的操作系统上实际验证，并在 PR 里注明验证过的系统。
4. CI 在 Windows、macOS、Linux 上运行 `flutter analyze` 与 `flutter test`，并在 macOS 打包 Apple Silicon、Windows 打包 x64；打包产物以 CI 为准。不要声称在没实际运行过的系统上做过界面验证。
5. PR 写明问题、改动与验证结果；不要提交 `build/`、`.dart_tool/`、`qa/` 或私人运行报告。

## 冒烟测试

先构建调试版，再带参数运行：

```powershell
flutter build windows --debug
.\build\windows\x64\runner\Debug\BlueDaFeiYu.exe --smoke-test
```

截图与 `smoke.json` 写入 `DAFEIYU_QA_DIR` 指定的目录，未设置时写入应用 userData 的 `qa/`，不写入应用安装目录，也不要提交进仓库。冒烟模式使用临时用户目录，不会和正在运行的桌宠抢单实例锁。

## 分发约定

Windows 压缩包解压后直接运行 `BlueDaFeiYu.exe`，不包含安装器，不写安装目录；macOS 产物为 Apple Silicon arm64 的「蓝色大肥鱼.app」，仅 ad-hoc 签名、未公证。Windows 版未签名。

发布仍限定在 `0.1.x`。同时更新 `pubspec.yaml` 的 `version:` 与 `lib/core/version.dart` 的 `appVersion`，添加对应的 `docs/releases/v0.1.x.md` 后推送到 `main`；发布流程会先确认版本尚未发布，在两种系统完成构建后创建标签和 Release。也支持推送匹配版本的标签或手动运行工作流；已有标签或版本不会被覆盖。

素材来自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，禁止商用。若修改或添加视觉素材，请说明来源与授权，并保留作者致谢。
