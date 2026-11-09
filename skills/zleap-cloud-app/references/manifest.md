<!-- 由 zleap-app-kit/scripts/sync-skill-references.mjs 从云开发文档站 reference/manifest.md 生成，请改文档站后重新同步 -->

# Manifest v2 配置

`manifest.json` 是应用包的**唯一声明文件**，必须位于 ZIP 根目录。平台用它来判断：
这个应用叫什么、怎么运行、要什么权限、用哪些数据集合、有哪些后台能力。

本文以服务端 **Go 校验器**为准（`zleap-app check`、`/api/v1/app-dev/manifest/validate`、
应用中心上传使用的是同一套规则）。想拿到当前部署的机器可读契约，可以运行
`zleap-app caps --target <OS 地址>`，或在 MCP 里调用 `app_spec_get`。

> **严格校验**（注意）
>
> 每一层对象都是**严格模式**：出现未定义的字段名一律报错。写错一个字段名，整个应用包就无法通过校验。
> 校验失败时服务端只返回概括原因 `MANIFEST_UNSUPPORTED`（「Manifest v2 结构、引用或执行形态无效」），
> **不会指出是哪个字段**——请对照本文逐字段核对，或先用 `zleap-app check` 在本地检查。

## 最小可用示例

一个纯前台、读写本人数据的待办应用。它能通过当前校验，也能被正常安装：

```json
{
  "schema": "zleap.app/2",
  "appid": "zl3f9a2c7e1b0d4a68",
  "name": "示例待办",
  "version": "1.0.0",
  "description": "保存在 App Cloud 里的个人待办清单。",
  "execution": "foreground",
  "runtime": {
    "ui": { "type": "iframe", "entry": "index.html" },
    "capabilities": {
      "requires": [
        { "id": "cloud.database.read", "reason": "读取本人待办", "scope": "current_user" },
        { "id": "cloud.database.write", "reason": "保存本人待办", "scope": "current_user" }
      ]
    }
  },
  "data": {
    "collections": ["todos"],
    "schemas": {
      "todos": {
        "type": "object",
        "properties": {
          "title": { "type": "string", "minLength": 1, "maxLength": 200 },
          "done": { "type": "boolean" },
          "created_at": { "type": "integer" }
        },
        "required": ["title", "done", "created_at"],
        "additionalProperties": false
      }
    }
  }
}
```

ZIP 根目录还必须有 `index.html`（入口）和**非空的 `LICENSE` 文件**，见 [打包规则](#打包规则)。
`zleap-app init hosted-package` 生成的模板就是这个结构，可以直接从模板开始改。

> **没写的字段用默认值**（提示）
>
> `background`、`triggers`、`events`、`data`、`resources`、`host_api`、`agent` 都有默认值，用不到可以不写。
> 只有 `schema`、`appid`、`name`、`version`、`execution`、`runtime` 是必填的。

## 顶层字段

| 字段            | 必填 | 类型   | 说明                                                                |
| --------------- | ---- | ------ | ------------------------------------------------------------------- |
| `schema`        | ✅   | 字符串 | 固定为 `"zleap.app/2"`，其他值会直接被拒绝                          |
| `appid`         | ✅   | 字符串 | 应用唯一标识，在云开发控制台「创建应用」后由平台生成，见下方说明    |
| `name`          | ✅   | 字符串 | 显示名，1–128 位，**必须有可见字符**                                |
| `version`       | ✅   | 字符串 | 语义化版本（SemVer），≤32 位，如 `1.0.0`、`1.2.0-beta.1`            |
| `description`   |      | 字符串 | ≤2000 位                                                            |
| `icon`          |      | 字符串 | ≤512 位                                                             |
| `execution`     | ✅   | 枚举   | `foreground` / `headless` / `both`，必须与 `runtime` 一致           |
| `runtime`       | ✅   | 对象   | 运行环境声明（见下）                                                |
| `background`    |      | 对象   | 后台运行模式，默认 `{ "on_install": "disabled", "modes": [] }`      |
| `triggers`      |      | 对象   | 触发器声明，默认 `{ "scheduled": [], "events": [] }`                |
| `events`        |      | 对象   | 事件发布与订阅，默认 `{ "publishes": [], "subscribes": [] }`        |
| `data`          |      | 对象   | 数据集合、集合 Schema 与访问规则（见下）                            |
| `resources`     |      | 对象   | 资源限制，默认 `{ "max_concurrency": 1 }`                           |
| `host_api`      |      | 对象   | 宿主能力声明，默认 `{ "profile": "app-runtime/2", "requires": [] }` |
| `agent`         |      | 对象   | Agent 交互声明                                                      |
| `capabilities`  |      | 数组   | 只能是 `["notify.send"]`（应用通知，见下）                          |
| `notifications` |      | 对象   | 通知频道声明（见下）                                                |
| `storage`       |      | 对象   | 宿主 KV / 数据空间声明（见下）                                      |

### `appid`

`appid` 由平台生成，不能自己起：在**云开发控制台**侧栏顶部的应用切换下拉里点「**创建应用**」，填名称（说明可选），
平台生成形如 `zl3f9a2c7e1b0d4a68` 的 `appid`（`zl` + 16 位小写十六进制），创建者成为应用**管理员**。
`appid` 全局唯一，**永不复用**。

```json
{ "appid": "zl3f9a2c7e1b0d4a68" }
```

上传时：

- `appid` 必须已在控制台创建，否则 40400「appid 不存在」（`detail.reason` 为 `APP_NOT_FOUND`，处理：先在云开发控制台「创建应用」）；
- 上传者必须是应用成员（管理员或开发者），否则 40300「你不是这个应用的开发者」（`detail.reason` 为 `NOT_APP_MEMBER`，
  处理：请联系应用管理员在云开发控制台「成员」里把你加为开发者），见 [成员管理](console-members.md)；
- 用 `zleap-app` 登录时，开发会话只限定一个 `appid`（`auth login --app-key <appid>`，参数名是 `--app-key`，填的是 `appid`），包里的 `appid` 必须与登录时的一致；
- 应用被删除后，原 `appid` **不能**再用于上传。

> **CLI / 接口回执里的 `app_key`**（提示）
>
> `zleap-app check`、`publish` 等命令与接口回执 JSON 里的 `app_key` 字段就是这里的 `appid`，只是沿用了旧字段名。

### `version` 与重复上传

同一应用下 `version` 是固定版本的标识：

- 同一版本号、**同样的 ZIP 字节**再次上传，返回已有的包，不会新建；
- 同一版本号、**不同内容**会被拒绝：「该版本已经存在，请更换版本号」。

改了任何文件都要升版本号再上传。

### `execution` 必须与运行形态一致

`execution` 不是自由填写的标签，而是由 `runtime` 里**实际声明了哪些部分**决定的：

| `runtime.ui` | `runtime.backend` | 合法的 `execution` |
| ------------ | ----------------- | ------------------ |
| 有           | 无                | `foreground`       |
| 无           | 有                | `headless`         |
| 有           | 有                | `both`             |
| 无           | 无                | 无效               |

不一致会被拒绝（内部原因：`execution must match nonempty UI/backend runtimes`）。

> **纯后台应用目前基本装不上**（注意）
>
> `headless`（只有 `backend`、没有 `ui`）的应用，只要声明了云函数（`functions`）、
> `managed_function` provider，或者平台动作清单之外的 `builtin` provider，
> 就会被判定为运行环境未开放（`RUNTIME_UNAVAILABLE`）。需要后台能力时请用 `both`：
> 带一个前台界面，再加 `backend`。

## `runtime` — 运行环境

```json
"runtime": {
  "ui": { "type": "iframe", "entry": "web/index.html" },
  "backend": {
    "functions": [ /* 云函数 */ ],
    "providers": [ /* 能力实现 */ ]
  },
  "capabilities": {
    "requires": [ /* 申请的权限 */ ],
    "provides": [ /* 对外提供的能力 */ ]
  }
}
```

### `runtime.ui` — 界面

| 字段           | 说明                                                                |
| -------------- | ------------------------------------------------------------------- |
| `type`         | `iframe` 或 `builtin`；**上传的应用包只支持 `iframe`**              |
| `entry`        | `iframe` 时必填：包内 HTML 文件的相对路径                           |
| `registry_ref` | `builtin` 时必填，与 `entry` 互斥（平台内置应用使用，第三方不可用） |
| `providers`    | UI provider 声明（**见下方警告**），默认空                          |

上传的应用包对 `entry` 的要求：

- 必须是**包内相对路径**，且指向一个**存在的 `.html` / `.htm` 文件**；
- 不能以 `/` 开头，不能含 `\`、`:`、`%`、`?`、`#` 或控制字符；
- 不能有空段、`.`、`..` 段，任何一段都不能以 `.` 或空格结尾；
- 长度 ≤512。

> **这些写法会让应用「暂不可用」**（危险）
>
> 以下声明都能通过结构校验，但运行能力检查会把应用判定为**功能未开放**（`FEATURE_UNAVAILABLE`），
> `zleap-app check` 不通过，应用中心里显示不可用，**无法安装打开**：
>
> - `runtime.ui.providers` 非空；
> - `runtime.capabilities.provides` 里有 `execution: "foreground"` 的能力；
> - 声明了 `agent.interaction`；
> - `runtime.capabilities.requires` 里有[开放清单](#目前开放的能力)之外的**非可选**能力；
> - 没有 `backend` 却非可选地申请 `os.agent.complete`；
> - `host_api.profile` 不是 `app-runtime/2`，或 `host_api.requires` 里有 `clipboard.write`、`workspace.files`、`workspace.images.read`、`credentials.use`、`user.profile`、`user.phone`、`user.email` 之外的值。
>
> 可正常安装的写法：`runtime.ui` 只写 `type` 和 `entry`，`provides` 全部用 `headless`。
> 参考仓库里的 `examples/app-cloud/copilot-studio`。

### `runtime.backend` — 后台

`backend` 一旦出现，就**至少要有一个函数或一个 provider**（「backend runtime must contain a function or provider」）。

**函数** `functions`（最多 32 个）：

```json
{
  "name": "reviewContent",
  "entry": "cloudfunctions/reviewContent",
  "runtime_profile": "node-lts/1",
  "timeout_seconds": 30,
  "memory_mb": 512
}
```

| 字段              | 必填 | 约束                                                              |
| ----------------- | ---- | ----------------------------------------------------------------- |
| `name`            | ✅   | 函数名，`^[a-zA-Z][a-zA-Z0-9_.-]*$`，≤128，用于在 provider 里引用 |
| `entry`           | ✅   | 包内相对路径（文件或目录），≤512，包里必须真的有这个路径          |
| `runtime_profile` | ✅   | 目前只能是 `"node-lts/1"`                                         |
| `timeout_seconds` |      | 整数 1–300，默认 **30**                                           |
| `memory_mb`       |      | 整数 64–4096，默认 **512**                                        |

`entry` 指向的文件或目录在包里不存在时报「云函数制品入口缺失」。函数代码怎么写见 [云函数开发](cloud-functions.md)。

**Provider** `providers`（最多 64 个）——「能力由谁来实现」：

```json
{
  "id": "studio.review",
  "type": "managed_function",
  "function": "reviewContent",
  "permissions": {
    "capabilities": ["cloud.database.read", "cloud.database.write"],
    "data": [
      {
        "collection": "drafts",
        "scope": "current_user",
        "actions": ["get", "query", "update"],
        "fields": ["title", "body", "status"]
      }
    ]
  },
  "retry": { "mode": "none", "max_attempts": 1 }
}
```

| 字段                       | 说明                                                                 |
| -------------------------- | -------------------------------------------------------------------- |
| `id`                       | provider 标识，`^[a-zA-Z][a-zA-Z0-9_.-]*$`，≤128                     |
| `type`                     | `managed_function` / `logic_unit` / `builtin`                        |
| `function`                 | `managed_function` 时必填：引用 `functions[].name`                   |
| `logic_unit`               | `logic_unit` 时必填：包内逻辑单元文件路径，如 `logic/wordCount.json` |
| `action`                   | `builtin` 时必填：平台动作名（见下表）                               |
| `permissions.capabilities` | 该 provider 运行时可用的能力，**必须 ⊆ `requires` 里的 `id`**        |
| `permissions.data`         | 该 provider 可访问哪些集合、哪些操作、哪些字段（最多 64 条）         |
| `retry.mode`               | `none`（默认）或 `idempotent`                                        |
| `retry.max_attempts`       | 整数 1–3，默认 1                                                     |

`type` 与 `function` / `logic_unit` / `action` **三者只能填与 `type` 对应的那一个**，
多填或填错都会被拒绝（「provider must reference exactly its declared implementation」）。

`builtin` 可用的平台动作：

| 动作                                                                                      | 用途                         |
| ----------------------------------------------------------------------------------------- | ---------------------------- |
| `os.agent.complete`                                                                       | 调用系统 Agent 生成文本      |
| `clouddb.document.get`、`clouddb.document.update`                                         | 读/改本应用数据文档          |
| `os.work.query`、`os.work.summarize`                                                      | 工作记录（未在本文档站验证） |
| `os.todos.query`、`os.todos.get`、`os.todos.create`、`os.todos.update`、`os.todos.delete` | 系统待办（未在本文档站验证） |

`permissions.data[]` 每一条：

| 字段         | 必填 | 说明                                                                                                                                                                                                |
| ------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collection` | ✅   | 必须已在 `data.collections` 里声明                                                                                                                                                                  |
| `scope`      | ✅   | `invocation` / `current_user` / `user` / `space` / `organization`                                                                                                                                   |
| `actions`    | ✅   | 从 `get`、`query`、`count`、`add`、`set`、`update`、`remove` 中选，最多 7 个。云函数里 `count` 计数按 `query` 核对，要计数请声明 `query`                                                            |
| `fields`     |      | 允许访问的字段，最多 256 个；**不写时默认为空数组**，即没有按字段授权任何字段（不是「不按字段收窄」）。**云函数经数据网关访问时必须显式列出字段**，空 `fields` 会被拒绝（「云函数数据字段未授权」） |

`permissions` 的含义与授权流程见 [权限与授权](permissions.md)。

### `runtime.capabilities.requires` — 申请的权限

```json
{
  "id": "cloud.database.read",
  "reason": "读取本人待办",
  "scope": "current_user",
  "optional": false
}
```

| 字段               | 必填 | 说明                                                              |
| ------------------ | ---- | ----------------------------------------------------------------- |
| `id`               | ✅   | 能力标识                                                          |
| `reason`           | ✅   | 申请理由，1–512 位，**会在安装确认时展示给用户**                  |
| `scope`            | ✅   | `invocation` / `current_user` / `user` / `space` / `organization` |
| `optional`         |      | 布尔值（必须是 `true`/`false`，不能写字符串），默认 `false`       |
| `contract_version` |      | ≤32 位                                                            |

#### 目前开放的能力

| 能力 ID                | 安装确认时的文案     | 备注                   |
| ---------------------- | -------------------- | ---------------------- |
| `cloud.database.read`  | 读取本应用数据库     |                        |
| `cloud.database.write` | 写入本应用数据库     |                        |
| `cloud.storage.read`   | 读取本应用存储文件   |                        |
| `cloud.storage.write`  | 写入本应用存储文件   |                        |
| `os.agent.complete`    | 调用已授权的助手能力 | 必须同时声明 `backend` |
| `os.work.read`         | —                    | 用法未在本文档站验证   |
| `os.todos.read`        | —                    | 用法未在本文档站验证   |
| `os.todos.write`       | —                    | 用法未在本文档站验证   |

#### `optional` 的作用

`optional` 只影响「应用能不能装」：

- `optional: false`（默认）：这个能力**必须**在上表里，否则应用被判定为不可运行，装不上；
- `optional: true`：平台不检查它是否开放，应用照常可装。但能力没开放时，用到它的调用照样会失败，
  应用要自己处理失败。

> **安装即授予**（提示）
>
> 安装时，平台会把该固定版本声明的 `requires` 一次性授予这次安装（与安装同一事务，卸载时撤销）。
> 安装授权**不等于**云资源已就绪，也不会自动启动后台任务。详见 [权限与授权](permissions.md)。

### `runtime.capabilities.provides` — 对外提供的能力

「能力」（capability）是应用对外公开的一个可调用操作，由某个 provider 实现。
控制台的「后台能力」、触发器、Agent 调用都以能力为单位。

```json
{
  "id": "com.example.todo.cleanup",
  "contract_version": "1.0.0",
  "title": "清理已完成待办",
  "execution": "headless",
  "provider": "todo.cleanup",
  "effect": "write",
  "discoverable": true,
  "input_schema": {
    "type": "object",
    "properties": { "before": { "type": "integer" } },
    "additionalProperties": false
  },
  "output_schema": {
    "type": "object",
    "properties": { "removed": { "type": "integer" } },
    "required": ["removed"],
    "additionalProperties": false
  }
}
```

| 字段                             | 必填 | 说明                                                                                    |
| -------------------------------- | ---- | --------------------------------------------------------------------------------------- |
| `id`                             | ✅   | 能力标识，≤128                                                                          |
| `contract_version`               | ✅   | 语义化版本                                                                              |
| `title`                          | ✅   | 显示名，1–128 位                                                                        |
| `execution`                      | ✅   | `foreground` 或 `headless`（**只用 `headless`**，见上方警告）                           |
| `provider`                       | ✅   | `headless` 时必须是 `backend.providers[].id`；`foreground` 时必须是 `ui.providers[].id` |
| `effect`                         | ✅   | `read` / `write` / `external`                                                           |
| `discoverable`                   |      | 布尔，默认 `false`                                                                      |
| `input_schema` / `output_schema` | ✅   | JSON Schema 对象                                                                        |

`input_schema` / `output_schema` 的限制：

- 必须是合法的 JSON Schema Draft 2020-12；
- 各自 ≤64 KiB，嵌套深度 ≤16，节点数 ≤4096；
- 不能出现 `$id`、`$dynamicRef`；`$ref` 只能是包内相对路径或 `#/...` 形式的 JSON Pointer。

`headless` 能力还会在上传时按 provider 预检一次实现（函数入口、逻辑单元文件等），不通过同样上传失败。

> **两种 Schema 不要混淆**（说明）
>
> `input_schema` / `output_schema` 是**完整 JSON Schema**，可以用 `const`、`pattern` 等关键字；
> 而 `data.schemas` 里的**集合 Schema** 只支持一个很小的子集，见下文。

## `data` — 数据集合

**集合**（collection）是一组采用相同规则的 JSON 文档，例如 `todos` 存放待办事项。
集合由 Manifest 声明，**控制台不能单独新建集合**：开发环境的数据库开通后，平台按声明自动创建；
没有出现时，在控制台点「同步集合」。见 [数据库](console-database.md)。

```json
"data": {
  "collections": ["todos", "board"],
  "default_binding": "current_user",
  "shared_collections": ["board"],
  "schemas": {
    "todos": {
      "type": "object",
      "properties": { "title": { "type": "string", "maxLength": 200 } },
      "required": ["title"]
    },
    "board": {
      "type": "object",
      "properties": {
        "text": { "type": "string", "maxLength": 500 },
        "visible": { "type": "boolean" }
      },
      "required": ["text", "visible"]
    }
  },
  "policies": {
    "board": { "partition": "shared", "read": "doc.visible == true" }
  }
}
```

| 字段                 | 说明                                                          |
| -------------------- | ------------------------------------------------------------- |
| `collections`        | 集合键清单，最多 64 个。**只有列在这里的集合，应用才能访问**  |
| `default_binding`    | 只能是 `"current_user"`，可省略                               |
| `shared_collections` | 哪些集合是「环境共享」；必须是 `collections` 的子集，不能重复 |
| `schemas`            | 按集合键给出集合 Schema；键必须在 `collections` 里            |
| `policies`           | 按集合键给出分区与记录规则；键必须在 `collections` 里         |

### 集合键

Manifest 校验器接受 `^[a-zA-Z][a-zA-Z0-9_.-]*$`（≤128），但**数据库实际创建集合**时要求更严：

- 小写字母开头，只含小写字母、数字、下划线，最长 64 位；
- 不能使用 `sys_`、`ac_`、`t_` 前缀。

请直接按后一条命名（如 `todos`、`review_jobs`），否则 Manifest 能通过、集合却建不出来。

### 集合 Schema（`data.schemas`）

给集合写 Schema 后，集合以 **strict（严格）模式**创建：每条文档都按 Schema 校验，不符合返回 `SCHEMA_INVALID`。
不写 Schema 的集合以 flexible（宽松）模式创建，只做通用的大小与字段名检查。

集合 Schema 只支持下面这些关键字：

| `type`               | 可用关键字                                               |
| -------------------- | -------------------------------------------------------- |
| `object`             | `properties`、`required`、`additionalProperties`（布尔） |
| `array`              | `items`（必填）、`minItems`、`maxItems`                  |
| `string`             | `minLength`、`maxLength`                                 |
| `number` / `integer` | `minimum`、`maximum`                                     |
| `boolean` / `null`   | —                                                        |

另外每一层都可以用 `enum`（1–100 个值）。`integer` 字段可以加 `"x-agentos-value-type": "date_ms"`，
表示「毫秒时间戳日期」。

> **标了 `date_ms` 的字段只能写日期**（注意）
>
> 这类字段写入时必须是**日期**：前端传 `Date` 对象或 `db.serverDate()`，云函数带 `value_types: { '/字段': 'date' }`。
> 直接写 `Date.now()` 这样的毫秒数字会被判 `SCHEMA_INVALID`（错误里不会指出是哪个字段）。读出来是 `Date`。
> 不需要日期语义的时间戳，就不要加这个标记，按普通 `integer` 存。

规则要点：

- 顶层必须是 `"type": "object"`；
- 每一层都**必须写 `type`**，且只能是上表之一；不支持 `const`、`pattern`、`format`、`oneOf` 等；
- 字段名匹配 `^[A-Za-z][A-Za-z0-9_]{0,63}$`，不能是 `__proto__` / `prototype` / `constructor`；
- 每个对象最多 256 个属性，嵌套 ≤16 层；`required` 里的字段必须在 `properties` 里；
- **没写 `additionalProperties` 时按 `false` 处理**——文档里出现 Schema 外的字段会被拒绝。

不符合时 Manifest 被拒，原因 `SCHEMA_INVALID`（「集合 schema 不符合数据面契约」），并带出出错的集合键。

> **集合建好后 Schema 不会自动更新**（注意）
>
> 已经存在的集合，**新版本改了 Schema 也不会应用到它上面**。升级时应用中心会提示
> 「已存在集合的结构不会更新，新版本若依赖新字段可能被旧约束拒绝。」
> 需要改结构时，新建一个集合并迁移数据。

### 数据归属：仅本人 / 环境共享

每个集合有一个**分区**（partition），决定数据归谁：

| 分区      | 控制台显示 | 行为                             | 怎么声明                                                          |
| --------- | ---------- | -------------------------------- | ----------------------------------------------------------------- |
| `private` | 使用者隔离 | 每个用户只读写自己的文档（默认） | 什么都不写                                                        |
| `shared`  | 环境共享   | 同一环境内所有用户共用一份数据   | 列入 `shared_collections`，或 `policies.<键>.partition: "shared"` |

`policies.<集合键>` 的字段：

| 字段        | 说明                                                            |
| ----------- | --------------------------------------------------------------- |
| `partition` | `private`（默认）/ `shared`；`app` 目前**未开放**，写了会被拒绝 |
| `read`      | 记录读取规则表达式，≤2048 字符，可选                            |
| `write`     | 记录写入规则表达式，≤2048 字符，可选                            |

注意：

- 写了 `policies` 的集合以 `policies.partition` 为准，而 `partition` 省略时默认是 `private`。
  所以只写 `read`/`write` 的集合会被当成私有；
- 某个集合列在 `shared_collections` 里又写了 `policies` 时，**必须显式写 `partition: "shared"`**，
  否则按默认 `private` 与 `shared_collections` 冲突，Manifest 被拒；
- 分区是**环境**内的概念（「仅本人／应用内共享」与「开发／生产环境」是两个独立维度）。

> **分区一经创建不可更改**（危险）
>
> 集合建好后，私有 ↔ 共享不能互换（`POLICY_IMMUTABLE`）。新版本改了分区，
> 应用中心升级预检会直接阻断：「集合作用域（私有/共享）不可变更，开通会被数据面拒绝。」
> 共享集合环境内所有人可见，**不要放隐私数据**。

### 记录规则（`read` / `write`）

规则是一个布尔表达式，决定某条文档能否被读/写，例如 `doc.status == 'open'`。

- 操作数：`doc.<字段>`、`auth.uid`、`auth.openid`、`now`、数字、单引号字符串、`true`/`false`/`null`；
- `auth.openid` 是调用者在**本应用数据域**里的身份，等于他写入的文档上的 `_openid`。它和页面里 `zl.auth.getIdentity()`
  拿到的 `openid` **不是同一个值**，不要拿后者去比较或写进规则；
- 规则里**不能引用 `_openid`** 等系统字段（`doc._openid` 会以 `RULE_DENIED` 被拒）：规则只能引用 Schema 里声明的顶层字段，
  而字段名必须以字母开头。要表达「只有创建者能改」，见下方示例；
- 运算：`==`、`!=`、`<`、`<=`、`>`、`>=`、`&&`、`||`、`!`、括号；
- 最多 64 个节点、8 层嵌套；
- 不能两边都是字面量；与 `true`/`false`/`null` 比较时另一边必须是 `doc.<字段>`；
- **使用记录规则的集合必须声明 Schema**，且规则引用的字段必须是 Schema 的**顶层**属性
  （否则报 `RULE_FIELD_UNDECLARED`）。

表达式写错时 Manifest 被拒，原因 `RULE_DENIED`（「集合规则表达式无效」）。

**什么时候求值**：

| 操作 | `write` 规则作用在 | 不满足时 |
| ---- | ------------------ | -------- |
| `add` | 新文档 | `RULE_DENIED`（40300），不写入 |
| `update` / `set` | 修改前的文档**和**修改后的文档 | 修改前不满足：按看不到处理（`DOCUMENT_NOT_FOUND`）；修改后不满足：`RULE_DENIED` |
| `remove` | 删除前的文档 | 按看不到处理（`DOCUMENT_NOT_FOUND`） |

`read` 规则同样作用在查询、计数、`doc().get()` 上，不满足的文档对调用者不可见。控制台（应用发布者）不受记录规则限制。

**示例：共享集合「所有人可读，只有创建者能改 / 删」**

```json
"data": {
  "collections": ["board"],
  "schemas": {
    "board": {
      "type": "object",
      "properties": {
        "author": { "type": "string", "minLength": 1, "maxLength": 64 },
        "text": { "type": "string", "minLength": 1, "maxLength": 500 }
      },
      "required": ["author", "text"]
    }
  },
  "policies": { "board": { "partition": "shared", "write": "doc.author == auth.openid" } }
}
```

页面写入时把自己在本数据域的身份填进 `author`。SDK 没有单独返回它的接口，取法是读回一条**自己写的**文档的 `_openid`
（私有集合里任意一条都行，同一环境内私有、共享集合的 `_openid` 相同），取到后缓存：

```js
const me = db.collection('profile'); // 任意私有集合
const { _id } = await me.add({ data: { created_at: new Date() } });
const { data } = await me.doc(_id).get();
const myId = data._openid; // 写 board 时用作 author
await db.collection('board').add({ data: { author: myId, text: '大家好' } });
```

`author` 写别人的值会被 `RULE_DENIED` 拒绝；别人的帖子对你 `update` / `remove` 时按看不到处理。

## `background` — 后台模式

```json
"background": { "on_install": "disabled", "modes": ["on_demand", "scheduled"] }
```

| 字段         | 说明                                                    |
| ------------ | ------------------------------------------------------- |
| `on_install` | 只能是 `"disabled"`（默认）                             |
| `modes`      | 从 `on_demand` / `scheduled` / `events` 中选，最多 3 个 |

安装应用**不会**自动启动后台任务。后台能力要在安装后由用户在应用窗口「权限」或控制台里单独允许。
**要用定时触发器，`modes` 必须含 `"scheduled"`；事件触发器要含 `"events"`**，否则启用时报 `TRIGGER_MODE_NOT_DECLARED`。

## `triggers` — 触发器

```json
"triggers": {
  "scheduled": [
    {
      "id": "nightly_review",
      "capability": "com.example.todo.cleanup",
      "cron": "0 3 * * *",
      "timezone": "Asia/Shanghai",
      "overlap": "forbid",
      "misfire": "skip",
      "enabled": false,
      "description": "每天 03:00 清理已完成待办"
    }
  ],
  "events": []
}
```

`scheduled` 和 `events` 各最多 32 条。Manifest 校验只检查数量，**条目内容在控制台启用触发器时才逐项比对**：
`id` 与 `capability` 必须对上，`cron`/`timezone`/`event` 必须与提交一致，
`overlap` 只能是 `forbid`、`misfire` 只能是 `skip`（写了别的值报 `TRIGGER_POLICY_UNSUPPORTED`）。
字段说明和错误码见 [触发器](triggers.md)。

触发器加 `"user_configurable": true` 后，线上每个使用者都能在应用窗口「权限」里自己开关，见 [触发器 · 线上定时任务](triggers.md#线上定时任务-使用者自己开关)。

## `events` — 事件

```json
"events": {
  "publishes": [{ "id": "todo.updated" }],
  "subscribes": [{ "id": "todo.updated" }]
}
```

各最多 64 条。事件名匹配 `^[a-z][a-z0-9_.]{0,63}$`（不能含 `-`）。
条目可以用 `id` 或 `name` 表示事件名；两个都写时必须相同，否则报 `EVENT_DECLARATION_AMBIGUOUS`。
事件触发器监听的事件必须在 `subscribes` 里恰好声明一次，否则报 `EVENT_NOT_DECLARED`。

## `resources` — 资源限制

```json
"resources": { "max_concurrency": 4 }
```

`max_concurrency`：整数 1–64，默认 1。

## `host_api` — 宿主能力

**宿主能力**是由 zleapOS 桌面（而不是 App Cloud）提供给应用窗口的能力。

```json
"host_api": { "profile": "app-runtime/2", "requires": ["workspace.files"] }
```

| 字段       | 说明                                                   |
| ---------- | ------------------------------------------------------ |
| `profile`  | 写 `"app-runtime/2"`（默认值）；其他值会让应用不可运行 |
| `requires` | 只能从下表中选                                         |

| 值                      | 安装确认时的文案                                 | 说明                                                                                                             |
| ----------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `clipboard.write`       | 写入剪贴板                                       | 用 `zl.app.setClipboardData({ data })`，须在用户点击时调用，见 SDK · 复制到剪贴板（文档站 /guide/sdk#复制到剪贴板）     |
| `workspace.files`       | 读取及整理选定空间文件夹内的文件                 | 配合模板里的 `sdk/workspace.js` 使用；用户在运行时选择文件夹                                                     |
| `workspace.images.read` | （安装确认显示原始 ID）                          | 读取选定文件夹里的图片：`workspace.readImage(handle, fileId, expectedVersion)`；必须同时声明 `workspace.files`   |
| `credentials.use`       | （安装确认文案未核实）                           | 使用钥匙串里的登录凭据；当前 SDK 未提供封装，本文档站暂不展开用法                                                |
| `user.profile`          | 使用时可能申请你的头像和昵称（由你决定是否同意） | 授权登录 `zl.auth.authorize({ scopes: ['profile'] })`，见[授权登录](app-runtime.md#先在-manifest-里声明) |
| `user.phone`            | 使用时可能申请你的手机号（由你决定是否同意）     | 同上，`scopes` 含 `'phone'`                                                                                      |
| `user.email`            | 使用时可能申请你的邮箱（由你决定是否同意）       | 同上，`scopes` 含 `'email'`                                                                                      |

写了其他值，应用会被判定为不可运行。没用到的能力不要写——每一项都会展示给用户。

## `agent` — Agent 交互

```json
"agent": { "requires_user_confirmation": true }
```

`requires_user_confirmation`：布尔，默认 `true`。

> **不要声明 `agent.interaction`**（注意）
>
> `agent.interaction`（`turn_based/1`）能通过结构校验，但**声明即不可安装**。
> 需要 Agent 生成内容时，用 `builtin` provider + `os.agent.complete`（见 `copilot-studio` 示例）。

## 通知与宿主存储（`capabilities` / `notifications` / `storage`）

这三个字段对应安装级权限里的「发送应用通知」「读写本应用设置」「读取/写入本应用数据空间」，
与 App Cloud 数据库是两套机制，本文档站未展开验证，只列出结构：

| 字段            | 结构                                                                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capabilities`  | 只能是 `["notify.send"]`                                                                                                                                                                                   |
| `notifications` | `{ "channels": [{ "id": "^[a-z][a-z0-9_-]{0,63}$", "name": "1–64 位", "description": "≤256，可选" }] }`，1–20 个，`id` 不能重复                                                                            |
| `storage`       | `policy`（`app-root-with-subject-binding` / `isolated-space`，必填）、`appKey`、`scopes`（`user`/`org`/`shared`）、`quotaBytes`、`kvQuotaBytes`、`capabilities`（`storage.kv`/`space.read`/`space.write`） |

## 预算限制

| 限制          | 值                                                |
| ------------- | ------------------------------------------------- |
| Manifest 大小 | ≤ 1 MiB                                           |
| 嵌套深度      | ≤ 24                                              |
| 节点总数      | ≤ 16384                                           |
| 编码          | UTF-8，**不能带 BOM**，不能有重复键，数字必须有限 |

## 校验规则速查

结构合法之外，还会检查以下**引用关系**，任一不满足即失败：

1. `execution` 与 `runtime` 实际形态一致；
2. `ui.providers`、`backend.providers`、`functions`、`requires`、`provides` 各自的 id/name **不重复**；
3. UI provider 与 backend provider 的 id **互不相同**；
4. `backend.providers[].function` 引用的函数**必须已声明**；
5. `provider.permissions.capabilities` **必须是 `requires` 的子集**；
6. `provider.permissions.data[].collection` **必须在 `data.collections` 里**；
7. `provides[].provider` 必须存在于与其 `execution` 对应的 runtime 里；
8. `agent.interaction` 引用的能力必须已在 `provides` 里声明；
9. `name` 必须含可见字符；
10. `shared_collections`、`schemas`、`policies` 的键必须在 `collections` 里；
11. 集合 Schema、记录规则符合上文子集。

## 打包规则

应用包是一个 ZIP，**根目录**必须有：

- `manifest.json`；
- **非空的 `LICENSE` 文件**（缺少时报「应用包根目录必须包含非空 LICENSE 文件」）；
- `runtime.ui.entry` 指向的 HTML 文件；
- 云函数 `entry`、逻辑单元等 Manifest 引用到的文件。

ZIP 本身的限制见 [平台边界与限制 · 应用包](limits.md#应用包)。另外：

- 只支持 stored / deflate 压缩；不支持加密条目、分卷 ZIP、ZIP64；
- 不能含符号链接或特殊文件；路径大小写不敏感地重复也会被拒；
- 路径规则与 `entry` 相同，且不能有名为 `.packageroot` 的段。

### 用 `zleap-app pack` 打包

`zleap-app pack <目录> --output <zip>` 生成**确定性 ZIP**（文件排序固定、时间戳固定），并自动排除：

| 排除项                                                                                     | 类型 |
| ------------------------------------------------------------------------------------------ | ---- |
| `node_modules`、`.git`、`.zleap`、`.zleap-tmp`、`out`、`__pycache__`、`.openvscode-server` | 目录 |
| 以 `.env` 开头的文件或目录                                                                 | 任意 |
| `*.log`、`*.pem`、`zleap-app.project.json`                                                 | 文件 |

> **`out` 目录会被排除**（注意）
>
> 如果你的构建产物输出到 `out/`，它不会被打进包里。请把构建结果放到别的目录（如 `dist/`），
> 并让 `entry` 指向它。排除规则只覆盖上表，业务文件里内嵌的密钥仍需自己检查。

带 `cloudfunctions/` 目录的包同样可以用 `zleap-app check` / `pack` / `publish`，校验规则与应用中心「上传应用包」一致；
`examples/app-cloud/copilot-studio` 这类带云函数的应用，两条路径都可以上传。

`zleap-app check` 通过只表示 Manifest、资源和可声明的运行能力符合当前契约（回执里 `runtime_test` 为
`not_checked`），**不代表数据读写已经验收**。完整流程见 从开发到上线（文档站 /guide/dev-to-production）。

## 完整示例

前后端结合、带云函数和定时触发器的完整写法，请直接参考仓库里的
`zleap-web/examples/app-cloud/copilot-studio/manifest.json`：

- `execution: "both"`，`ui` 只有 `type` + `entry`；
- 4 个 provider，分别演示 `managed_function`、`logic_unit`、`builtin`（`os.agent.complete`）；
- 4 个 `headless` 能力，`input_schema` / `output_schema` 完整；
- `data.schemas` 为每个集合声明 strict Schema，`review_jobs.updatedAt` 使用 `date_ms`；
- `proposals` 通过 `policies` 设为共享并带记录规则；
- 一个定时触发器，`overlap: forbid`、`misfire: skip`。

## 相关

- 从开发到上线（文档站 /guide/dev-to-production） — 完整流程
- 快速开始（文档站 /guide/quickstart） — 从零走一遍
- [云函数开发](cloud-functions.md) — 怎么写函数
- [权限与授权](permissions.md) — 能力与授权模型
- [触发器](triggers.md) — 触发器的完整说明
- [平台边界与限制](limits.md) — 数值上限
