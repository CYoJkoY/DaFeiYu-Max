# AGENTS.md

面向维护 magpie-DaFeiYu 的编码代理。Windows 与 macOS 上的代理共同维护这一个共享仓库。

## 跨平台红线

- 单一共享代码库，同时服务 Windows 10+ x64 与 Apple Silicon Mac（macOS 12+）；禁止平台分支或分叉。
- 主界面、动画、请求灯泡、额度面板与 Magpie 本地读取共用同一份 `src/` 代码；平台差异只允许集中在应用数据目录、托盘图标/菜单外观、打包与签名。
- Magpie 本地配置沿用官方同一路径 `~/.config/magpie/settings.json`（遵循 `XDG_CONFIG_HOME`），Windows 与 macOS 一致；不要按平台拆配置路径。
- 「打开 Magpie」在 Windows 依次查找 `%LOCALAPPDATA%\Programs\magpie\magpie.exe`、`%LOCALAPPDATA%\magpie\magpie.exe` 与 Program Files；macOS 查找 `/Applications/magpie.app` 与 `~/Applications/magpie.app`。
- 托盘图标：Windows 用 PNG，macOS 沿用 emoji 标题。

## 命令

- npm 脚本两个平台一致：`npm run build`、`npm test`、`npm run check`、`npm start`。
- 工具链只用 TypeScript（`node scripts/*.ts`）与 Zig；不要引入 Python、`.mjs`/`.cjs` 源脚本等额外语言。构建产物里的 `.cjs` 仅是 Electron 主进程/预加载的运行时格式，不是源码。
- 仓库不保留任何 JavaScript 源文件或生成物：Magpie 页面是纯 HTML + CSS（`magpie/index.html`、`magpie/page.css`），语言用单选按钮配合 CSS 切换，默认中文；宿主直接加载这些静态文件，不参与打包，也不要再引入脚本。`tests/distribution.test.ts` 会扫描全仓库，出现 `.js`/`.cjs`/`.mjs`/`.py`/`.ps1` 等禁用扩展名，或语言集合不再是 TypeScript + Zig，都会失败。
- 冒烟测试：`npm start -- --smoke-test`；产物写入 `DAFEIYU_QA_DIR` 或应用 userData 的 `qa/`，不写入应用安装目录，也不提交进仓库。

## 发布与安装约定

- 产物命名：`magpie-DaFeiYu-vX.Y.Z-Windows-x64.zip`（解压后直接运行 `BlueDaFeiYu.exe`，不含安装器）、`magpie-DaFeiYu-vX.Y.Z-macOS-arm64.zip`。
- Windows 版为便携应用；不安装、不创建快捷方式、无需管理员权限且不设开机启动。
- macOS 仅 ad-hoc 签名，Windows 未签名；文档里如实说明，不得声称做了未执行的签名、公证或验证。
- 版本保持 `0.1.x`；版本号与发布说明一起推送到 main 后，两端构建全部通过才会自动创建标签和 Release；也支持匹配的标签触发。已发布版本不覆盖。

## 验证与诚实性

- 单元测试由 CI 在 Windows / macOS / Linux 运行；打包由 CI 在 macOS（Apple Silicon）与 Windows（x64）完成。
- 只在代理实际运行过的操作系统上描述界面验证；发布说明只写计划中的改动，不写未执行的测试结果。
- 便携运行方式如有出入，由主线维护者统一后再改文档，避免文档自相矛盾。

## 文案与素材

- 保持中文语气与现有视觉资产；角色动画来自 PC2005-cloud/dsh-pet，非商用，展示与分发须保留来源。
- Magpie 页面必须保留「不会自动安装或启动桌宠」说明与 `releases/latest` 链接；压缩包要与系统匹配。
