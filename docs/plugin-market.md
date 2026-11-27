# 插件市场契约

插件市场不是一台服务器，而是一个普通 GitHub 仓库：[`CYoJkoY/DaFeiYu-Max-Plugins`](https://github.com/CYoJkoY/DaFeiYu-Max-Plugins)。

- 「发布插件」= 往仓库提交一个目录。
- 「浏览市场」= 从 `raw.githubusercontent.com` 读一次 `index.json`。

所以主应用不需要后端，也不需要 token；只要仓库地址和分支可访问就能工作。默认值在 `lib/core/settings.dart`（`defaultMarketRepo` / `defaultMarketRef`），已经落盘的 `settings.json` 里的 `plugins.market.repo` / `.ref` 可以覆盖它。

## 一次安装的完整顺序

| 步骤 | 做的是什么 | 失败会怎样 |
| --- | --- | --- |
| 1 | `GET https://raw.githubusercontent.com/<repo>/<ref>/index.json` | 面板显示 HTTP 状态码，保留上一次成功的列表 |
| 2 | 索引超过 512 KB 或解析失败 → 整份拒绝 | 一条坏条目就会让整份索引失效，不会只信一半 |
| 3 | 校验每个条目：`id` 为 kebab-case、`version` 为 `x.y.z`、`kind` 必须是 `script`、`permissions` 只能取 `pet`/`bridge`/`net`、`size` 在 1 字节到 4 MB 之间、`sha256` 是 64 位小写十六进制、`manifest`/`wasm` 是仓库内相对路径 | 拒绝，并指出出错的条目 |
| 4 | 下载条目里的 `manifest` 路径 | 面板显示原因，不写盘 |
| 5 | 清单的 `id` 与 `version` 必须与索引一致，`kind` 必须是 `script`，`script.entry` 必须是以 `.wasm` 结尾的安全文件名 | 拒绝，不写盘 |
| 6 | 下载 `wasm` 路径，长度必须等于索引里的 `size`，SHA-256 必须等于索引里的 `sha256` | 拒绝，不写盘 |
| 7 | 两个文件先写进 `plugins/.staging-<id>/`，成功后整目录改名为 `plugins/<id>/`，旧的同名目录一起替换 | 失败时删掉暂存目录，磁盘上不会出现半个插件 |
| 8 | 在 `plugin-market.json` 里记下来源：版本、SHA-256、安装时间 | 记录失败只在提示里说明，插件本身已经装好 |

路径校验（`sanitizeMarketPath`）拒绝绝对路径、`..`、反斜杠、URL scheme 和空段，所以一份被篡改的索引没法把文件写到插件目录之外。

## 磁盘上的东西

| 路径 | 内容 |
| --- | --- |
| `<应用数据目录>/plugins/<id>/plugin.json` | 插件清单，原样保存下载到的那份 |
| `<应用数据目录>/plugins/<id>/<script.entry>` | WASM 模块 |
| `<应用数据目录>/plugins/.staging-<id>/` | 安装中的暂存目录，永远不会被当成插件加载 |
| `<应用数据目录>/plugin-market.json` | 本应用自己装的插件及其版本、SHA-256、安装时间 |

`plugin-market.json` 的作用是「只更新、只删除自己装的东西」：手工拷进 `plugins/` 的插件可以正常显示，但不会被市场误当成自己的记录，也不会在没有确认的情况下被覆盖。

## 面板如实说明的边界

Flutter 版的插件市场**只做到数据面**：读取索引、校验、安装、卸载。**没有接入脚本插件运行时**，因此：

- 已安装的脚本插件会出现在「外观与插件」里，标注「已安装 · 运行时未接入」，不会被加载或执行。
- 面板不会声称插件「启用后生效」，也不提供启用开关。
- 市场里的模块是未签名的，接入运行时之前仍需在启用前确认来源。

这条边界是刻意的：先把「能从仓库安全取到并校验文件」做对，执行能力等内容回来时再单独加，不假装已经跑起来了。

## 校验入口

- `lib/core/market.dart`：纯函数，索引/来源记录的解析与校验，不碰网络和磁盘，因此全部可以单元测试（`test/core/market_test.dart`）。
- `lib/app/market_client.dart`：唯一发起 HTTP 请求的地方，注入 `http.Client`，测试用 `package:http/testing.dart` 的 `MockClient`（`test/app/market_install_test.dart`）。
- `lib/app/plugin_registry.dart`：把 `plugins/` 下的清单读进面板，跳过 `.staging-*`，并把读取失败如实列进面板的「未加载」提示。
- `lib/ui/panel_view.dart`：`_marketCard()` 负责展示与按钮；卡片底部的说明必须与上面的边界保持一致。

改索引格式时同步提高 `marketSchemaVersion`，不要单方面放宽校验：旧版应用会直接拒绝新版本索引，这比悄悄接受一份没见过的结构安全。

## 插件仓库一侧

契约的另一半在 [`DaFeiYu-Max-Plugins`](https://github.com/CYoJkoY/DaFeiYu-Max-Plugins)，它不需要知道 Dart，
只需要守住同一份文档形状：

- `index.json` 由 `scripts/build-index.ts` 从各 `plugins/<id>/plugin.json` 重建，`size` 与 `sha256` 现算现写。
- `scripts/validate.ts` 复刻本文件这一节的接受规则（体积上限、`schemaVersion`、字段长度、权限取值、
  `manifest` / `wasm` 必须是 `plugins/<id>/…` 相对路径、索引版本要与清单一致），CI 里再把它和 Zig 重编译结果比对。
- 仓库的 `README.md` 写明了「Flutter 版只做安装与校验、运行时未接入」，与面板文案保持一致。

所以「发布插件」= 在那边提交一个目录并让 `Validate plugins` 变绿；「本应用能装」= 这边的解析器接受那份
`index.json`。两边任一放宽都必须同时改，否则会出现「仓库自检通过、应用拒收」。
