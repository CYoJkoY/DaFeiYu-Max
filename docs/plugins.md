# 插件（schema v1）

蓝色大肥鱼的插件分两层，共用同一个插件目录：

- **声明式插件**（本文）：清单是**数据**，应用只读取 JSON，再交给已随应用编译
  好的运行时去解释；不会加载、执行或 `import` 任何插件文件。
- **脚本插件**（[plugin-market.md](plugin-market.md)）：清单指向一个 Zig 编译出的
  WASM 模块，模块跑在独立 worker 沙箱里，只能「申请」桌宠动作、桥接请求与
  状态，由应用逐条审查后执行。

两层都不含平台分支：Windows 与 macOS 共用同一份 `src/plugins/` 代码。

## 插件放在哪里

- 内置插件随应用发布，无需安装。
- 外部插件放在应用数据目录的 `plugins/` 下：
  - Windows：`%APPDATA%\BlueDaFeiYu-Codex\plugins\`
  - macOS：`~/Library/Application Support/BlueDaFeiYu-Codex/plugins/`
- 声明式插件的文件名必须以 `.plugin.json` 结尾，例如 `my-skin.plugin.json`。
- 脚本插件是 `plugins/<id>/` 子目录，内含 `plugin.json` 与 `.wasm` 模块；两种
  形态可以放在同一目录下互不干扰。
- 启动时按文件名顺序扫描；单个文件解析失败只会被跳过，并在面板「外观与插件」
  一栏列出问题，不影响其他插件或主程序。

## 清单结构

```json
{
  "schemaVersion": 1,
  "id": "my-skin",
  "version": "1.0.0",
  "kind": "appearance",
  "name": "My skin",
  "description": "一句话说明。",
  "labels": { "zh": "我的外观", "en": "My skin" },
  "appearance": { "accent": "#2f6fe0" }
}
```

公共字段：

| 字段 | 必填 | 约束 |
| --- | --- | --- |
| `schemaVersion` | 是 | 必须等于 `1`。 |
| `id` | 是 | kebab-case，小写字母/数字/连字符，最长 64；全局唯一。 |
| `version` | 是 | `x.y.z`，可带 `-`/`+` 预发布或构建后缀。 |
| `kind` | 是 | `social` / `appearance` / `festival` / `script` 之一。 |
| `name` | 是 | 非空，≤ 80 字。 |
| `description` | 是 | 非空，≤ 240 字。 |
| `labels` | 否 | `zh` / `en` 显示名，各 ≤ 80 字。 |
| `requiresTrust` | 否 | 布尔；声明放宽能力时置 `true`，面板会显式提示。 |

与 `kind` 对应的段（`social` / `appearance` / `festival` / `script`）必须存在且
通过校验；`script` 段的格式见 [plugin-market.md](plugin-market.md)。

## 三类插件

### 1. 社交（`social`）

外部清单**只能选择已编译进本应用的适配器**，不能声明新平台或新代码：

| `platform` | 允许的 `implementation` | `requires` | 读取 | 写入 |
| --- | --- | --- | --- | --- |
| `bilibili` | `bilibili` | `none` | 是 | 否 |
| `tieba` | `tieba` | `none` | 是 | 否 |
| `douyin` | `bridge` | `bridge` | 是 | 是 |
| `xiaoheihe` | `bridge` | `bridge` | 是 | 是 |

`reads` / `writes` 必须与上表一致；声明 `writes: true` 时必须同时设置
`requiresTrust: true`。桥接实现可自定义 `feedPath` / `messagePath`，但必须是
以 `/` 开头、不含 `..`、`?`、`#` 或空白的相对路径。

**写入不是隐式授权。** 即使插件声明了写入能力，应用仍需：

1. 用户打开「社交摘要」；
2. 用户单独允许「生成待确认草稿」；
3. 对每条草稿逐条确认后才会发出。

插件无法提高这些门槛，也无法让应用静默发帖。

### 2. 外观（`appearance`）

```json
{
  "appearance": {
    "accent": "#d5373c",
    "idle": ["悠闲哼歌", "照镜子"],
    "states": { "thinking": ["深度思考碎碎念"] },
    "categories": [{ "id": "tea-time", "weight": 1, "actions": ["小幅度原地360度旋转展示"] }]
  }
}
```

- 至少要声明 `accent` / `idle` / `states` / `categories` 之一。
- `accent` 为 `#RGB` 或 `#RRGGBB`，用作界面强调色。
- 动作名必须**已存在于随应用发布的动画清单**；不认识的片段在合并时被丢弃，
  插件无法引入应用没有的素材。
- 与内置分类同名的 `categories` 会被忽略，不会覆盖原有条目。

### 3. 节日（`festival`）

```json
{
  "festival": {
    "window": {
      "start": "12-28",
      "end": "01-03",
      "greeting": "新年快乐！",
      "accent": "#c02c38",
      "accessories": ["🎉", "🏮"]
    }
  }
}
```

- `start` / `end` 为 `MM-DD`，闭区间；`start > end` 时表示跨年窗口。
- 同一天命中多个节日装扮时，按 `id` 排序取第一个；用户可在面板中停用某个装扮。
- `accessories` 最多 8 个短符号，作为节日点缀显示。

## 加载与生命周期

1. 启动时注册内置插件。
2. 扫描应用数据目录的 `plugins/`，逐个解析 `.plugin.json`。
3. 校验失败或 `id` 重复的文件被跳过并记录问题。
4. 合并已选外观、当前节日装扮，生成运行时的动画目录、配色与面板列表。
5. 用户切换外观或启停节日时重新合并并持久化选择。

保存的选择若指向已不存在或不适用的插件，会在启动时被清除并写回设置，
不会长期保留无效 id。

## 安全边界

- 声明式插件不执行代码，不加载插件资源文件，不解析插件提供的 URL 端点（桥接
  路径除外，且经白名单校验）。
- 脚本插件在无网络的 WASM 沙箱里运行，只有显式声明的 `pet` / `bridge` / `net`
  意图会被执行；清单和模块的大小、字段长度都有上限，未知字段被忽略。
- 社交写入始终经过上述三道用户确认。
