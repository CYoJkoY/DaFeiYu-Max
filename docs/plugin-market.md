# 脚本插件与插件市场

这是「自己写、直接跑」的那一半：你用 Zig 写一段代码，在面板里选文件，应用用
本机的 Zig 编译成 WASM，装进本地插件目录立即运行。**整个过程不上传任何东西。**

想要别人也能用，再把插件提交到独立的云端仓库
[DaFeiYu-Max-Plugins](https://github.com/CYoJkoY/DaFeiYu-Max-Plugins)，面板里刷新
市场即可安装。

## 两层来源

| 层 | 代码在哪 | 怎么装 | 有没有联网 |
| --- | --- | --- | --- |
| 本地编写 | 你的磁盘 | 面板「安装本地插件」→ 选 `main.zig` → 本机编译 | 无 |
| 云端市场 | `DaFeiYu-Max-Plugins` 仓库 | 面板「插件市场」→ 刷新 → 安装 | 只下载清单与模块 |

两种安装方式落到同一个目录 `plugins/<id>/`，区别只在来源标签（`本地` / `市场`）
和是否有市场来源记录（`plugin-market.json`）。

## 本地编写：从源码到运行

1. 写一个 `main.zig`，开头 `const dfy = @import("dfy.zig");`，结尾
   `comptime { dfy.install(onEvent); }`。
2. 面板点「安装本地插件」，选中这个文件。
3. 应用把它和内置 SDK（`dist/sdk/dfy.zig`）一起放进临时目录，运行：

   ```
   zig build-exe -O ReleaseSmall -target wasm32-freestanding -fno-entry \
     --export=dfy_abi_version --export=dfy_alloc --export=dfy_free --export=dfy_invoke \
     main.zig
   ```

4. 编译产物先回灌进沙箱，模拟一次 `install` 事件；模块答不上来就拒绝安装。
5. 通过后写入 `plugins/<id>/plugin.wasm`，并生成/沿用清单 `plugin.json`：

   - 源码同目录若有 `plugin.json`（`kind: "script"`），就采用它的 `id`、`name`、
     `settings`、`commands`、权限；
   - 没有就从目录名推 `id`（kebab-case，推不出则用 `local-plugin`），只申请
     `pet` 权限；
   - 两种情况下 `script.entry` 都固定为 `plugin.wasm`，因为那正是刚写下的文件。
6. 重新扫描插件目录，脚本引擎加载模块并派发 `install`。

需要 Zig 0.17 或更新版本，且 `zig` 在 `PATH` 里。找不到编译器时面板直接报错，
不会安装半个插件。

## 脚本能做什么，不能做什么

插件**不碰**网络、窗口、磁盘。它返回一份 JSON「意图清单」，由主应用审查后执行：

| 意图 | 权限 | 说明 |
| --- | --- | --- |
| `say` / `play` / `notify` | `pet` | 让桌宠说话、播动作、弹提示 |
| `status` | — | 更新面板里的状态行、进度与计数 |
| `schedule` | — | 约多久后再收到 `tick`（0.5 秒到 1 小时）；不排期就不会再收到 |
| `http` | `bridge` / `net` | 请求桥接地址，或清单 `allowHosts` 里的主机 |
| `state` | — | 读写自己的 JSON 状态（≤ 48 KB）；回包的 `state` 与旧状态**合并**，没写的键保留，`stateRemove` 删键 |

每一次副作用都会先检查权限：没有 `net` 就不能请求任意地址，`net` 的主机名必须
在清单里列全。模块在独立的 `worker_threads` 线程里运行，超时 5 秒即终止，崩溃
只影响它自己。

## 云端市场

市场是普通 GitHub 仓库，应用按 `https://raw.githubusercontent.com/<repo>/<ref>/<path>`
拉取，默认仓库 `CYoJkoY/DaFeiYu-Max-Plugins`、分支 `main`，可在设置里改。
请求走 Electron 的 Chromium 网络栈，因此跟随系统代理；开着代理的机器也能刷新市场。

安装一个插件要连过三道校验：

1. `index.json` 必须能解析，每个字段都在范围内，路径不许越过仓库；
2. 清单必须解析成功，且 `id` / `version` 与索引一致；
3. 模块字节数必须等于索引记录，SHA-256 必须逐字节吻合。

校验通过才落盘；落盘先写临时目录再整体换入，安装记录（版本、哈希、时间）写在
`plugin-market.json`。市场里有更新版本时，面板会显示「有更新」，但不会自动装。

## 刷抖音插件

仓库里随附一个现成例子：`douyin-scroll`（刷抖音）。它从本机桥接读取推荐流，
按兴趣挑一条念给桌宠听，隔一段时间再来一次；不点赞、不评论、不发送。

桥接服务需由你自己运行，实现 `GET /feed?limit=20`（返回 `{ items: [...] }`），
`GET /status`、`POST /message` 可选。插件不联网，桥接地址由你在面板里填写。

市场仓库自带一个零依赖示例桥接：在市场仓库根目录运行
`node tools/bridge.ts`（默认 `http://127.0.0.1:8787`，读 `tools/feed.json`），
再把面板里的桥接地址填成同一地址即可试跑；换成你自己的数据源只要保持
`/feed` 的返回形状不变。

## 数据放在哪

| 内容 | 路径 |
| --- | --- |
| 插件目录 | `plugins/`（Windows：`%APPDATA%\BlueDaFeiYu-Codex\plugins\`；macOS：`~/Library/Application Support/BlueDaFeiYu-Codex/plugins/`） |
| 插件状态 | `plugin-state/<id>.json` |
| 市场来源记录 | `plugin-market.json` |

删除 `plugins/<id>/` 或点面板「卸载」即可移除；状态文件随插件删除。
