<!-- 由 zleap-app-kit/scripts/sync-skill-references.mjs 从云开发文档站 reference/cloud-function.md 生成，请改文档站后重新同步 -->

# 云函数开发

**云函数**（managed function）是跑在**服务端**的 Node.js 函数。它让应用能在**关掉窗口之后**继续干活，
也让敏感逻辑不必暴露在用户浏览器里。

这一篇讲：怎么声明、怎么写、怎么调用、要满足哪些前置条件才会真正执行，以及常见报错。

## 先搞清三个名词

| 名词                                | 是什么                                                                                                    | 写在哪                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **函数**（function）                | 一段 Node 代码，入口导出一个函数（平台按函数名 / `main` / default 查找）                                  | `runtime.backend.functions[]` + 包里的 `cloudfunctions/` 目录 |
| **Provider**                        | 「由谁来实现」：可以是函数（`managed_function`）、平台逻辑单元（`logic_unit`）或平台内置动作（`builtin`） | `runtime.backend.providers[]`                                 |
| **后台能力**（headless capability） | 对外可调用的一个操作，指向某个 provider，带输入 / 输出 Schema                                             | `runtime.capabilities.provides[]`，`execution: "headless"`    |

调用永远是「调用一个后台能力」，平台再按它的 provider 去执行函数 / 逻辑单元 / 内置动作。
每次调用会产生一个**作业**（job），有自己的 `jobId`、`invocationId`、`operationId` 和状态。

## 什么时候用云函数

| 场景                         | 用什么                                            | 原因                         |
| ---------------------------- | ------------------------------------------------- | ---------------------------- |
| 用户点击按钮后立即更新界面   | 前端 SDK 直接读写数据库                           | 更快，少一次往返             |
| 关窗后还要跑的任务、定时任务 | 云函数 + [触发器](triggers.md)                     | 前端代码随窗口消失           |
| 批量处理数据                 | 云函数                                            | 不受窗口生命周期限制         |
| 只是读一条文档 / 改一条文档  | `logic_unit` 或 `builtin`（`clouddb.document.*`） | 不进函数沙箱，不需要签名发布 |
| 调用大模型                   | `builtin` + `os.agent.complete`                   | 平台持有凭据，应用不接触密钥 |

## 第一步：在 Manifest 里声明

一个同时有界面和云函数的应用，`execution` 要写 **`"both"`**（不是 `hybrid`）。
只有 `backend`、没有 `ui` 的应用一旦声明了函数或 `managed_function`，会被判为不可运行——**云函数应用必须带界面**。
完整字段约束见 [Manifest v2 配置](manifest.md) 的 `runtime.backend` 一节。

```json
{
  "schema": "zleap.app/2",
  "execution": "both",
  "runtime": {
    "ui": { "type": "iframe", "entry": "web/index.html" },
    "backend": {
      "functions": [
        {
          "name": "reviewContent",
          "entry": "cloudfunctions/reviewContent",
          "runtime_profile": "node-lts/1",
          "timeout_seconds": 30,
          "memory_mb": 512
        }
      ],
      "providers": [
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
                "fields": ["title", "body", "status", "revision_note", "updatedAt"]
              }
            ]
          },
          "retry": { "mode": "none", "max_attempts": 1 }
        }
      ]
    },
    "capabilities": {
      "requires": [
        {
          "id": "cloud.database.read",
          "reason": "读取本人的草稿",
          "scope": "current_user",
          "optional": false
        },
        {
          "id": "cloud.database.write",
          "reason": "保存审校结果",
          "scope": "current_user",
          "optional": false
        }
      ],
      "provides": [
        {
          "id": "com.example.studio.review-draft",
          "contract_version": "1.0.0",
          "title": "审校草稿",
          "execution": "headless",
          "provider": "studio.review",
          "effect": "write",
          "discoverable": true,
          "input_schema": {
            "type": "object",
            "properties": { "draft_id": { "type": "string", "minLength": 1, "maxLength": 128 } },
            "required": ["draft_id"],
            "additionalProperties": false
          },
          "output_schema": {
            "type": "object",
            "properties": { "summary": { "type": "string" } },
            "required": ["summary"],
            "additionalProperties": false
          }
        }
      ]
    }
  },
  "background": { "on_install": "disabled", "modes": ["on_demand"] }
}
```

要点：

- `provider.permissions.capabilities` 必须是 `requires` 的子集；`permissions.data[].collection` 必须在 `data.collections` 里——否则上传被拒；
- `input_schema` 会在**提交时**校验（不符返回 `INVOCATION_INPUT_INVALID`），`output_schema` 会约束函数返回值；
- `background.modes` 要含 `"on_demand"` 才能被手动 / 应用调用；定时触发还要含 `"scheduled"`（见 [触发器](triggers.md)）；
- `background.on_install` 固定为 `"disabled"`：**安装不会让任何后台能力自动运行**。

## 第二步：写函数

### 目录与入口

```
my-app/
├── manifest.json
├── cloudfunctions/
│   └── reviewContent/
│       └── index.mjs      ← 入口
└── web/
    └── index.html
```

`functions[].entry` 可以写**目录**或**文件**：

- 写目录时，按 `index.mjs` → `index.js` → `index.cjs` 的顺序找入口；都没有时，目录里必须**恰好只有一个** `.js/.mjs/.cjs` 文件，否则 `FUNCTION_ENTRY_INVALID`；
- 写文件时，必须是 `.js/.mjs/.cjs`；
- 路径不存在时报「云函数制品入口缺失」/ `FUNCTION_ARTIFACT_MISSING`；
- 单个函数目录最多 4096 个文件、合计 20 MiB（`FUNCTION_ARTIFACT_TOO_LARGE`）。

入口的导出由 runner 按 **`module[函数名] ?? module.main ?? module.default`** 查找：导出与 `functions[].name` 同名的函数最稳妥，也支持导出 `main`（或 default）。
调用签名是 **`(event, context)`**，返回值就是作业的 `result`。`event` 是调用时传入的 `input` / `data`；
`context` 带 `invocationId`、`jobId`、`attemptId`、`deadlineAt` 和 `signal`——`signal` 是 `AbortSignal`，到截止时间触发，长任务应当响应取消。

```js
import { zl } from '@zleap/app-cloud-server';

export async function main(event, context) {
  zl.cloud.init({ env: zl.cloud.DYNAMIC_CURRENT_ENV });
  const logger = zl.cloud.getLogger();

  const draftId = typeof event?.draft_id === 'string' ? event.draft_id : '';
  if (!draftId) throw new Error('DRAFT_ID_REQUIRED');

  logger.info('processing draft', { draftId, invocationId: context.invocationId });
  if (context.signal.aborted) throw new Error('CANCELLED');
  return { summary: `已处理 ${draftId}` };
}
```

### 运行环境 `node-lts/1`

| 项                    | 值                                                                                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node 版本             | **以实际部署镜像为准。** `node-lts/1` 画像在 `profile.json` 里登记为 Node 24.21.0（linux / arm64，非 root），但仓库中的沙箱镜像 Dockerfile 目前基于 `node:22-bookworm-slim`，两者尚未对齐。请勿依赖 Node 22 之后才有的特性，也不要写死补丁版本 |
| 网络                  | **无**（`network_policy: none`）——函数里不能 `fetch` 外部地址                                                                                                                                                                                  |
| `timeout_seconds`     | 1–300，默认 30                                                                                                                                                                                                                                 |
| `memory_mb`           | 64–4096，默认 512                                                                                                                                                                                                                              |
| CPU / 进程数 / 临时盘 | 1000 millicore / 64 / 64 MB（固定，不可配置）                                                                                                                                                                                                  |
| 返回值大小            | ≤ 256 KiB                                                                                                                                                                                                                                      |
| 日志                  | 每次调用 ≤ 1 MiB，单行 ≤ 16 KiB                                                                                                                                                                                                                |

`@zleap/app-cloud-server` 由运行时提供，**不需要也不应该**打进包里。第三方 npm 依赖能否随包使用**未验证**；
由于没有网络，任何需要联网的库都用不了。

含 `cloudfunctions/` 目录的包既可以用 `zleap-app check` / `pack` / `publish`，也可以用 应用中心「上传应用包」（文档站 /app-center/publish） 上传，
两条路径的校验规则一致。

## 服务端 SDK

导入来源是 `@zleap/app-cloud-server`（和前端的 `./sdk/index.js` 不是同一个包）。它**只有**下面这些 API：

| API                                                    | 说明                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `zl.cloud.init({ env: zl.cloud.DYNAMIC_CURRENT_ENV })` | 建议第一行调用。只接受 `env: DYNAMIC_CURRENT_ENV` 或不传；写 `'dev'` 等会抛 `ENV_MISMATCH` |
| `zl.cloud.getContext()`                                | 本次调用的上下文（见下表）                                                                 |
| `zl.cloud.getLogger()`                                 | 结构化日志                                                                                 |
| `zl.cloud.os.database.query(args)`                     | 读（只支持 `get` 单条 / `count` 计数）                                                     |
| `zl.cloud.os.database.mutate(args)`                    | 写（`add` / `set` / `update` / `remove`）                                                  |

云函数里**没有** `zl.cloud.database()`、文件存储、`callFunction` 或能力调用，也**没有** `zl.cloud.auth`：`getOpenId()` / `getUserInfo()` 目前不可用。需要 `openid` 时，由页面用 `zl.auth.getIdentity()` 取到后作为输入传入，或使用文档自带的 `_openid`（见下文）。

### `getContext()`

| 字段                                    | 说明                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `invocationId`                          | **调用编号**——日志筛选用它                                                                                                            |
| `jobId`                                 | 作业编号                                                                                                                              |
| `attemptId`                             | 本次尝试编号（重试时不同）                                                                                                            |
| `appId` / `environmentId` / `bindingId` | 应用、环境、数据绑定 ID                                                                                                               |
| `userId`                                | **已废弃**：平台内部用户 ID。当前服务端 SDK 没有 `auth` 命名空间，不要用它区分业务用户；用文档自带的 `_openid`，或由页面传入 `openid` |
| `traceId`                               | 链路追踪 ID                                                                                                                           |
| `deadlineAt`                            | 截止时间（秒级时间戳）；过了之后 SDK 调用抛 `FUNCTION_DEADLINE_EXCEEDED`                                                              |

### `getLogger()`

```js
const logger = zl.cloud.getLogger();
logger.debug('verbose detail', { foo: 1 });
logger.info('normal event', { draftId });
logger.warn('something odd');
logger.error('failed', { reason });
```

日志出现在 云开发控制台 · 日志（文档站 /console/logs），可按调用编号筛选。打**结构化字段**（第二个参数），
不要打印用户凭据或大段原始数据。

> **在命令行看函数日志**（提示）
>
> `zleap-app runtime-logs <app_id> [调用编号] --environment dev` 的 `function_logs` 里是**你本人**发起的云函数调用日志
> （`--environment` 默认 `prod`）；作为发布者想看所有人的调用日志，到控制台日志面板查。
> 日志库刚开通时会暂时返回 `LOG_UNAVAILABLE`，几十秒后再查即可，云函数执行不受影响。

### 读数据

```js
const found = await zl.cloud.os.database.query({
  collection: 'drafts',
  operation: 'get',
  document_key: draftId,
  request_id: `${context.invocationId}:read`.slice(0, 128),
});
const draft = Array.isArray(found?.list) ? found.list[0] : null;
```

```js
const drafts = await zl.cloud.os.database.query({
  collection: 'drafts',
  operation: 'count',
  filter: { op: 'eq', field: 'status', value: 'draft' },
  request_id: `${context.invocationId}:count`.slice(0, 128),
});
```

可用参数：`collection`、`operation`（`get` / `count`，不写按 `get`）、`document_key`、`filter`、`request_id`。

> **`count` 要在 provider 里声明 `query` 动作**（注意）
>
> 数据网关把 `operation: 'count'` 按 **`query`** 动作核对：provider 的 `permissions.data[].actions` 只写了 `"count"` 会被拒
> （「云函数数据动作未在发布声明中授权」）。要计数就写 `"actions": ["query"]`（或同时写 `"count", "query"`）。

> **云函数里只能 `get` 单条或 `count` 计数**（注意）
>
> 函数数据网关只接受 `get` 和 `count` 两种读操作，写 `operation: 'query'` 会被拒（`GATEWAY_QUERY_OPERATION_UNSUPPORTED`）。
> 需要列出多条数据时，在前端用 SDK 查询后把 `document_key` 传给函数逐条 `get`，或改用 `logic_unit` / `builtin` provider。

> **`request_id` 必填**（危险）
>
> `query` 和 `mutate` 都必须带非空的 `request_id`（≤128 字符），缺了会被网关拒绝（`GATEWAY_REQUEST_ID_INVALID`）；
> 函数里没捕获的话，整次调用以 `USER_EXCEPTION` 失败。建议用 `` `${context.invocationId}:用途` `` 派生。

### 写数据

```js
await zl.cloud.os.database.mutate({
  collection: 'drafts',
  operation: 'update',
  document_key: draftId,
  data: { status: 'reviewed' },
  expected_version: draft._version, // 乐观锁：版本不符时被拒，不会静默覆盖
  operation_id: operationIdFor(context, 'review'),
  request_id: `${context.invocationId}:save`.slice(0, 128),
});
```

可用参数：`collection`、`operation`、`document_key`（`add` 以外必填）、`data`、`value_types`、`field_operations`、
`expected_version`（`add` 不接受）、`operation_id`、`request_id`（必填）。`remove` 不接受 `data`。

> **字段命名是 snake_case**（危险）
>
> 服务端 SDK 用 **snake_case**（`document_key`、`expected_version`、`operation_id`），
> 前端 SDK 用 **camelCase**（`documentKey`、`expectedVersion`、`operationId`）。混用会失败。

### 过滤器语法

过滤器是 `{op, field, value}` 结构，**不是** MongoDB 语法：

```js
filter: { op: 'in', field: 'status', value: ['queued', 'in_progress'] }
filter: { op: 'and', filters: [
  { op: 'eq', field: 'status', value: 'draft' },
  { op: 'gte', field: 'updatedAt', value: 1730000000000 },
] }
```

| 操作符                           | 说明                                             |
| -------------------------------- | ------------------------------------------------ |
| `eq` `neq` `gt` `gte` `lt` `lte` | 比较；`value` 为单个字面量                       |
| `in` `nin`                       | `value` 为 1–100 个元素的数组                    |
| `exists`                         | `value` 必须是布尔值                             |
| `and` `or`                       | 只有 `op` 和 `filters` 两个键，`filters` 1–20 项 |

整棵过滤树最多 64 个节点、8 层。写成 `{ status: { $in: [...] } }` 这种 MongoDB 形式会因为没有合法 `op`
被拒（`UNSUPPORTED_OPERATION`），多余的键报 `SCHEMA_INVALID`。

### 日期字段要带 `value_types`

集合 Schema 里标了 `x-agentos-value-type: "date_ms"` 的字段，写入时必须同时打标，否则 `SCHEMA_INVALID`：

```js
await zl.cloud.os.database.mutate({
  collection: 'review_jobs',
  operation: 'add',
  data: { run_id: runId, updatedAt: Date.now() },
  value_types: { '/updatedAt': 'date' }, // 路径带前导斜线
  operation_id: operationIdFor(context, 'report'),
  request_id: `${context.invocationId}:report`.slice(0, 128),
});
```

过滤器里比较日期字段时同理，给条件加 `value_type: 'date'`。

### 函数能碰哪些数据：按 provider 声明逐请求核对

每一次 `query` / `mutate`，平台都会对照**这个 provider** 的 `permissions` 检查：

| 检查                                                                                        | 不满足时                             |
| ------------------------------------------------------------------------------------------- | ------------------------------------ |
| 读要求 `permissions.capabilities` 含 `cloud.database.read`，写要求含 `cloud.database.write` | 「函数数据能力未声明」               |
| `collection` 在 `data.collections` 里                                                       | 「集合未在有效制品中声明」           |
| 操作（`get`/`query`/`add`/…）在该集合的 `actions` 里                                        | 「云函数数据动作未在发布声明中授权」 |
| 该集合条目**写了非空 `fields`**                                                             | 「云函数数据字段未授权」             |
| 写入的 `data` 键、`field_operations` 的 `path` 都在 `fields` 里                             | 「云函数写入字段超出发布声明」等     |
| 读的 `projection`、`order_by` 字段在 `fields` 里（`_id`/`_version`/`_openid` 例外）         | 「云函数读取字段超出发布声明」等     |

> **给云函数用的 provider 一定要写 `fields`**（注意）
>
> Manifest 校验技术上允许省略 `fields`（默认就是空数组），但云函数数据网关会把**空 `fields` 当成没有任何字段授权**而拒绝。

数据范围由平台按调用身份和数据绑定自动限定，函数里传 `user_id` 之类的字段绕不过去。

> **用 openid 区分用户：从输入或 `_openid` 来**（提示）
>
> 当前服务端 SDK **没有** `zl.cloud.auth.getOpenId()` / `getUserInfo()`。需要「谁的数据」这类键时，有两个来源：
>
> - 页面用 `zl.auth.getIdentity()` 拿到 `openid`，作为能力的输入传给函数；
> - 私有集合里读到的文档自带 `_openid`（写入者标识），可以直接用（`examples/moments` 的 `stats` 就是这么做的）。
>
> 由页面传入的 `openid` 只是业务参数，函数无法再向平台核验；手机号 / 邮箱同理，函数拿不到授权登录的信息。
> `getContext().userId` 是平台内部用户 ID，不要用它区分业务用户，也不要存它、返回给前端。

### 读写失败时拿到什么

`query` / `mutate` 失败时抛出的错误：`error.code` 是原因码（如 `INDEX_REQUIRED`、`VERSION_CONFLICT`，或网关自己的
`GATEWAY_*`），`error.message` 是给人看的中文说明，容量类会带上具体数字（如「本应用文档总数：已用 9800，上限 10000」）。
函数可以直接把这段说明放进返回值告诉用户，不用自己维护码表：

```js
try {
  await zl.cloud.os.database.mutate({/* … */});
} catch (error) {
  logger.error('save failed', { code: error.code });
  return { ok: false, code: error.code, message: error.message };
}
```

完整的原因码与说明见 [状态与错误码 · 数据服务原因码](status-codes.md#数据服务原因码) 和
[后台调用与云函数](status-codes.md#后台调用与云函数)。没有捕获的异常会让整次调用以 `USER_EXCEPTION` 失败。

### 操作编号

写操作的 `operation_id` 必须匹配 `^op_[0-9]{10}_[0-9a-f]{32}$`：`op_` + 10 位**秒级**时间戳 + `_` + 恰好 32 位小写十六进制。
时间戳与服务端时间相差超过 300 秒会被拒。

```js
import { createHash } from 'node:crypto';

function operationIdFor(context, purpose) {
  const suffix = createHash('sha256')
    .update(`${context.invocationId}:${purpose}`)
    .digest('hex')
    .slice(0, 32);
  return `op_${Math.floor(Date.now() / 1000)}_${suffix}`;
}
```

> **重试与幂等**（注意）
>
> 后缀从 `invocationId` 派生，同一次调用内是稳定的；但时间戳部分在不同 attempt 里通常不同，
> **跨 attempt 能否被识别为同一写入未验证**。带副作用的写操作建议 `retry.mode: "none"`，
> 或用 `expected_version` 乐观锁兜底，避免重复写入。

## 最小可运行示例：同事圈（moments）

仓库里的 `zleap-app-kit/examples/moments` 是一个完整可运行的示例（React + Vite）：它用一个云函数 `stats` 统计「我的互动」，每 5 分钟由定时触发器跑一次。下面是它的关键声明和函数代码（节选，完整 Manifest 见该目录的 `manifest.json`）。

**1. 声明函数与 provider**（`runtime.backend` 下的两个数组）

```json
"functions": [
  {
    "name": "stats",
    "entry": "cloudfunctions/stats",
    "runtime_profile": "node-lts/1",
    "timeout_seconds": 30,
    "memory_mb": 256
  }
],
"providers": [
  {
    "id": "moments.stats",
    "type": "managed_function",
    "function": "stats",
    "permissions": {
      "capabilities": ["cloud.database.read", "cloud.database.write"],
      "data": [
        { "collection": "me", "scope": "current_user", "actions": ["get"], "fields": ["nickname", "created_at"] },
        { "collection": "posts", "scope": "current_user", "actions": ["query"], "fields": ["author"] },
        { "collection": "likes", "scope": "current_user", "actions": ["query"], "fields": ["post_author", "author"] },
        { "collection": "comments", "scope": "current_user", "actions": ["query"], "fields": ["post_author", "author"] },
        { "collection": "digest", "scope": "current_user", "actions": ["get", "set"], "fields": ["posts", "likes_received", "comments_received", "source", "updated_at"] }
      ]
    },
    "retry": { "mode": "none", "max_attempts": 1 }
  }
]
```

**2. 声明对外能力**（`runtime.capabilities.provides` 里的一项）

```json
{
  "id": "zl7b2843d539ca2df7.stats",
  "contract_version": "1.0.0",
  "title": "统计我的互动",
  "execution": "headless",
  "provider": "moments.stats",
  "effect": "write",
  "discoverable": false,
  "input_schema": {
    "type": "object",
    "properties": { "source": { "type": "string", "enum": ["manual", "scheduled"] } },
    "additionalProperties": false
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "posts": { "type": "integer", "minimum": 0 },
      "likes_received": { "type": "integer", "minimum": 0 },
      "comments_received": { "type": "integer", "minimum": 0 },
      "error": { "type": "string", "maxLength": 300 }
    },
    "additionalProperties": false
  }
}
```

**3. 写函数** — `cloudfunctions/stats/index.mjs`：

```js
// 统计「我的互动」：我发了几条动态、收到多少赞和评论（不算自己给自己的），写进私有集合 digest。
// 云函数里只能 get / count；本人在数据域里的标识从私有集合 me/profile 的 _openid 读出来。
import { createHash } from 'node:crypto';
import { zl } from '@zleap/app-cloud-server';

const opId = (ctx, purpose) =>
  `op_${Math.floor(Date.now() / 1000)}_${createHash('sha256').update(`${ctx.invocationId}:${purpose}`).digest('hex').slice(0, 32)}`;

export async function main(event) {
  zl.cloud.init({ env: zl.cloud.DYNAMIC_CURRENT_ENV });
  const ctx = zl.cloud.getContext();
  const logger = zl.cloud.getLogger();
  const db = zl.cloud.os.database;
  const rid = (purpose) => `${ctx.invocationId}:${purpose}`.slice(0, 128);
  try {
    const found = await db
      .query({ collection: 'me', operation: 'get', document_key: 'profile', request_id: rid('me') })
      .catch((e) => {
        if (e?.code === 'DOCUMENT_NOT_FOUND') return null;
        throw e;
      });
    const me = Array.isArray(found?.list) ? found.list[0] : null;
    if (!me?._openid)
      return {
        posts: 0,
        likes_received: 0,
        comments_received: 0,
        error: '还没打开过同事圈，没有资料',
      };
    const openid = me._openid;
    const count = async (collection, filter, purpose) => {
      const res = await db.query({
        collection,
        operation: 'count',
        filter,
        request_id: rid(purpose),
      });
      return Number(res?.total ?? res?.count ?? 0);
    };
    const others = (field) => ({
      op: 'and',
      filters: [
        { op: 'eq', field, value: openid },
        { op: 'neq', field: 'author', value: openid },
      ],
    });
    const posts = await count('posts', { op: 'eq', field: 'author', value: openid }, 'posts');
    const likes = await count('likes', others('post_author'), 'likes');
    const comments = await count('comments', others('post_author'), 'comments');
    const source = event?.source === 'scheduled' ? 'scheduled' : 'manual';
    await db.mutate({
      collection: 'digest',
      operation: 'set',
      document_key: 'latest',
      data: {
        posts,
        likes_received: likes,
        comments_received: comments,
        source,
        updated_at: Date.now(),
      },
      value_types: { '/updated_at': 'date' },
      operation_id: opId(ctx, 'digest'),
      request_id: rid('digest'),
    });
    logger.info('stats refreshed', { posts, likes, comments, source });
    return { posts, likes_received: likes, comments_received: comments };
  } catch (error) {
    logger.error('stats failed', { code: error?.code });
    return {
      posts: 0,
      likes_received: 0,
      comments_received: 0,
      error: `${error?.code ?? 'ERROR'}: ${error?.message ?? error}`.slice(0, 300),
    };
  }
}
```

几个和声明对应的地方：

- 函数叫 `stats`，`entry` 指向目录 `cloudfunctions/stats`，runner 会在目录里找到 `index.mjs`；
- 函数只 `get` 了 `me`、`count` 了 `posts` / `likes` / `comments`，但 provider 里后三个集合声明的是 `query`——**`count` 按 `query` 动作核对**，只写 `count` 会被拒；
- `data.collections` 必须包含 `me`、`posts`、`likes`、`comments`、`digest`；示例另外还声明了 `photos` 和 `schemas` / `policies`；
- 写 `digest` 用 `set`，所以 `actions` 里要有 `set`（示例同时给了 `get`）。

**4. 构建与上传**

示例的 `vite.config.ts` 里有一个 `zleapPackage` 插件：构建时把项目根的 `manifest.json`、`LICENSE` 和整个 `cloudfunctions/` **原样复制进 `dist/`**（跳过 `node_modules`），并校验 `runtime.ui.entry` 是 `index.html`。所以构建产物 `dist/` 就是应用包根目录，可以直接交给 CLI：

```bash
npx zleap-app check dist
npx zleap-app pack dist --output out/app.zip
npx zleap-app publish dist
```

示例项目已经把这些串成脚本：`npm run deploy`（构建 → 检查 → 上传开发版本 → 装到自己桌面）、`npm run release -- --notes "…"`（发布为线上版本）。

上传时平台已自动签名，装到桌面时自动绑定，包上传后只差使用者本人一步：在应用窗口「权限」里勾选「统计我的互动」这项后台能力。定时触发器 `stats_refresh` 还要在控制台「触发器」里启用，否则只会手动调用时运行。

## 第三步：上传、安装、授权

函数代码写好后，要走完下面这条链才会真正执行。缺任何一步，调用都不会进入函数沙箱：

```
① 上传：npm run deploy / zleap-app publish 或应用中心「上传应用包」
   声明了后台能力的版本，平台在上传时自动签名，得到就绪发布
② 安装（安装即授予声明的 cloud.* 权限；后台能力为「停用」）
   安装、切换版本时平台自动把安装绑定到该版本的就绪发布；还没有就绪发布的版本会当场补签再绑定
③ 开发环境与数据库：声明了集合的应用安装时自动创建并开通（集合按声明自动创建）；否则在控制台「创建开发环境」
④ 应用窗口「权限」→「后台能力（定时任务 / 云函数）」勾选该能力 →「保存并重新加载」
   （或在控制台「后台能力」里点「允许后台运行」）
```

带后台能力的版本在上传时由平台自动签名；安装、切换版本、在「权限」里允许后台运行时会自动绑定，没有单独的签名或绑定步骤。

详细界面见 版本管理（文档站 /console/release）、云函数与后台能力（文档站 /console/functions）、安装与卸载（文档站 /app-center/install），
端到端顺序见 从开发到上线（文档站 /guide/dev-to-production）。

| 少了哪一步                                        | 现象                                                                                                                                                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 没有任何已启用的后台能力                          | 会话里没有 `app-execution/1`，前端 `callFunction` / `capabilities.invoke` **在发请求前**就抛 `BACKGROUND_CAPABILITY_UNAVAILABLE`（旧 SDK 为 `UNSUPPORTED_OPERATION`）                                             |
| 这项能力没被授权                                  | 403「此能力尚未由用户授权」                                                                                                                                                                                       |
| `managed_function` 没绑定就绪发布（正常不会出现） | `FUNCTION_RELEASE_REQUIRED`；「权限」对话框里该项下方提示「该版本还没有可用的签名发布，暂时无法执行。重新保存一次权限会自动补签。」。到「权限」里重新保存一次，或在「版本管理」切换一次版本，平台会自动补签并绑定 |
| 部署没接入函数计算节点 / 调度服务                 | `FUNCTION_RUNTIME_UNAVAILABLE`（平台未开放，不是你写错了）                                                                                                                                                        |

### 开发环境 ≠ 生产发布

上面这条链只让云函数在**开发环境**运行。要让其他使用者在生产环境用上它：

把版本「发布为线上版本」（控制台「版本管理」，或 `zleap-app release`）。任一成员都可以发布任一版本，不要求上传者正在使用这个版本。带云资源的版本**第一次**发布时，平台自动完成**应用级**生产准备：生产环境 → 签发生产发布（归属上传者）→ 生产门禁（签名、审批窗口、信任策略核对）→ 生产库与生产集合，不依赖任何人的安装。生产库还没就绪时返回 40900（`PROD_DATABASE_NOT_READY`），通常 1 分钟内就绪，稍后重新发布即可；上传者账号已停用时返回 40900（`UPLOADER_INACTIVE`），请其他成员重新上传这个版本后再发布。已经发布过的版本再次发布（包括回退）直接复用当时的就绪发布。只用宿主能力的应用直接发布，没有额外的签名步骤。

`zleap-app prepare` 只准备开发环境，不会碰生产；因为上传、安装 / 切换版本时平台会自动签名并绑定，通常不需要，
只在 `zleap-app diagnose` 提示 `next_action: app_prepare` 时兜底使用。准备完成后用
`zleap-app invoke <app_id> --capability <id> --environment dev` 测试。

`logic_unit` 和 `builtin` provider 不进函数沙箱，**不需要**签名发布，授权后台能力即可执行。

> **授权后要重新加载**（提示）
>
> 后台能力的启用状态在打开 Cloud 会话时就算好了。「保存并重新加载」会自动重开；
> 在控制台里改了授权或切换了新版本后，请点应用窗口的「重新加载应用」。
> 切换版本并绑定新发布后旧会话会失效（`RELEASE_UNAVAILABLE`），宿主桥会重开会话并重试一次。

## 调用后台能力（前端 SDK）

以下都在**应用前端**里调用，路径是 `zl.cloud.os.capabilities` / `zl.cloud.os.jobs`（不能省略 `os`）。

### `capabilities.invoke` + `jobs.wait`

```js
const pending = await zl.cloud.os.capabilities.invoke({
  id: 'com.example.studio.review-draft', // provides[].id
  input: { draft_id: 'd-001' }, // ≤ 64 KiB，按 input_schema 校验
  waitSeconds: 25, // 0–25，在服务端等终态；默认 0 立即返回
  // operationId: 'op_…'                 // 可选，不传由 SDK 生成
});

const job = ['accepted', 'queued', 'running', 'cancel_requested'].includes(pending.status)
  ? await zl.cloud.os.jobs.wait({
      jobId: pending.jobId,
      timeoutSeconds: 120,
      pollMilliseconds: 1000,
    })
  : pending;

if (job.status !== 'succeeded')
  throw new Error(`${job.status}: ${job.errorCode}; ${job.operationId}`);
console.log(job.result);
```

`invoke` **不会因为作业失败而抛错**，它返回 `JobResult`，要你自己看 `status`。

### `JobResult`

| 字段                                     | 说明                                   |
| ---------------------------------------- | -------------------------------------- |
| `jobId` / `invocationId` / `operationId` | 可核对的真实调用编号                   |
| `status`                                 | 见下表                                 |
| `result`                                 | 成功时的返回值（符合 `output_schema`） |
| `errorCode`                              | 失败原因码                             |
| `committedSteps`                         | 已提交的步骤                           |

| `status`                          | 含义                         | 怎么处理                                                                            |
| --------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| `accepted` / `queued` / `running` | 进行中                       | `jobs.wait` 继续等                                                                  |
| `cancel_requested`                | 已请求取消，尚未结束         | 继续等                                                                              |
| `succeeded`                       | 成功                         | 读 `result`                                                                         |
| `failed`                          | 失败                         | 看 `errorCode`                                                                      |
| `cancelled`                       | 已取消                       | 已提交的写入**不回滚**                                                              |
| `unknown`                         | **结果未知**（例如节点失联） | **不等于失败**。用原 `operationId` 核对，**不要自动重新提交**——尤其是调用模型的任务 |

### 其他作业 API

| API                                                                                  | 说明                                                                                                                              |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `jobs.wait({ jobId, timeoutSeconds?, pollMilliseconds? })`                           | 等到终态；`timeoutSeconds` 0–300（默认 25），`pollMilliseconds` 100–5000（默认 500）；超时仍未结束抛 `CALL_TIMEOUT`（带 `jobId`） |
| `jobs.get({ jobId })` / `jobs.result({ jobId })`                                     | 读一次当前状态                                                                                                                    |
| `jobs.submit({ kind: 'capability', capability, input, operationId?, waitSeconds? })` | 与 `capabilities.invoke` 等价的另一种写法                                                                                         |
| `jobs.cancel({ jobId })`                                                             | 请求取消，返回 `{ cancelRequested: true }`。**取消不是回滚**                                                                      |

同一个 `operationId` 再次提交、输入相同 → 返回原作业；输入不同 → 冲突「同一操作编号的输入不同」。
每人同时在排队 / 执行的后台作业最多 16 个（超出 429「本人后台调用队列已满」）。

### `callFunction`（便捷写法）

```js
const job = await zl.cloud.callFunction({
  name: 'studio.review', // provider id，或 managed_function 的函数名
  data: { draft_id: 'd-001' }, // 成为 event
  agentos: { operationId: op() }, // 可选
});
```

`name` 先按 **provider `id`** 匹配；匹配不到时再按 `managed_function` 的**函数名**匹配（必须唯一）。
匹配到的 provider 必须恰好对应**一个** headless 能力，否则报「本应用入口不存在或不唯一」。

和 `invoke` 的区别：`callFunction` 固定在服务端等最多 25 秒，并**把非成功结果变成异常**：

| 结果                   | 行为                                                   |
| ---------------------- | ------------------------------------------------------ |
| `succeeded`            | 返回 `JobResult`                                       |
| 25 秒内未结束          | 抛 `CALL_TIMEOUT`（带 `jobId`，可再用 `jobs.wait` 等） |
| `unknown`              | 抛 `COMMIT_UNKNOWN`                                    |
| `failed` / `cancelled` | 抛作业的 `errorCode`（没有时为 `EXECUTION_FAILED`）    |

### 从控制台试运行

见 云函数与后台能力 · 试运行（文档站 /console/functions#试运行）：选中能力，先授权后台运行，再点「试运行」。

### 从命令行试调

```bash
zleap-app invoke <app_id> --capability com.example.studio.review-draft --environment dev \
  --input-file input.json --wait-seconds 25
zleap-app invocation <app_id> <调用编号>   # 查最新状态与结果
```

`--environment` 默认 `prod`，`--wait-seconds` 为 0–30（默认 25）。能力没在该环境启用时返回 `CAPABILITY_NOT_ACTIVE`：
开发工具不会代你允许后台运行，需要在应用窗口「权限」里勾选。函数日志用 `zleap-app runtime-logs <app_id> <调用编号> --environment dev` 查。

## 系统 Agent 与平台内置动作

应用可以用 `builtin` provider 绑定平台内置动作，**应用不持有任何模型或数据库凭据**。用法是：
自己声明一个 headless 能力 → 指向 `builtin` provider → provider 的 `action` 写平台动作名。
能力 ID 由你起，不要把平台动作名当成能力 ID。

> **Schema 必须与动作目录完全一致**（注意）
>
> `builtin` 能力的 `input_schema` / `output_schema` 必须与平台动作目录里该动作的定义**完全一致**；
> `provider.permissions.capabilities` 要包含该动作要求的能力，`runtime.capabilities.requires` 也要声明。
> 用 MCP 时先 `app_capability_get(id)` 拿到 descriptor 和可直接粘贴的 Manifest 片段。

### `os.agent.complete`：调用系统 Agent

```json
// runtime.backend.providers[]
{
  "id": "studio.proposal",
  "type": "builtin",
  "action": "os.agent.complete",
  "permissions": { "capabilities": ["os.agent.complete"], "data": [] }
}
```

```json
// runtime.capabilities.requires[]（必须同时声明 runtime.backend）
{ "id": "os.agent.complete", "reason": "生成改写提案", "scope": "current_user", "optional": false }
```

```json
// runtime.capabilities.provides[]
{
  "id": "com.example.studio.propose-rewrite",
  "contract_version": "1.0.0",
  "title": "系统 Agent 生成改写提案",
  "execution": "headless",
  "provider": "studio.proposal",
  "effect": "read",
  "discoverable": true,
  "input_schema": {
    "type": "object",
    "properties": {
      "mode": { "const": "proposal_only" },
      "input": { "type": "string", "minLength": 1, "maxLength": 16000 },
      "system": { "type": "string", "maxLength": 4000 }
    },
    "required": ["mode", "input"],
    "additionalProperties": false
  },
  "output_schema": {
    "type": "object",
    "properties": { "output": { "type": "string", "maxLength": 8000 } },
    "required": ["output"],
    "additionalProperties": false
  }
}
```

```js
const job = await zl.cloud.os.capabilities.invoke({
  id: 'com.example.studio.propose-rewrite',
  input: { mode: 'proposal_only', input: '请改写这段文字……', system: '你是编辑。' },
  waitSeconds: 25,
});
```

- 模型使用**当前账号**的默认 Agent 与模型配置；没配置或供应商失败时作业失败，界面要明确提示；
- `proposal_only`：**只返回文本提案，不会写任何数据**。是否采纳、怎么落库由你的应用决定——所以 `effect` 是 `read`；
- 该动作**不自动重试**。遇到 `unknown` 用原 `operationId` 核对，重复提交可能产生两份提案；
- `builtin` 不需要签名发布，但同样要在「后台能力」里授权后才能调用。

### 其他内置动作

| 动作                                                      | 用途                                                                                | 需要的能力                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `clouddb.document.get` / `clouddb.document.update`        | 读 / 改本应用一条文档（按 provider `permissions.data` 收窄）                        | `cloud.database.read` / `cloud.database.write`         |
| `os.work.query` / `os.work.summarize`                     | 读取本人工作数据（待办、参与的项目任务/计划、文档元数据）；`summarize` 还会调用模型 | `os.work.read`（`summarize` 另需 `os.agent.complete`） |
| `os.todos.query` / `get` / `create` / `update` / `delete` | 管理本人的系统个人待办                                                              | `os.todos.read`；写还需 `os.todos.write`               |

`os.work.*` 的输入是 `start` / `end`（`YYYY-MM-DD`）和 `timezone`（IANA 名称），最多 100 项来源、不读文档全文；
`os.todos.*` 的写操作不自动重试，结果不明时先查询核对，重复 `create` 会重复创建。
这些动作的完整契约以 MCP `app_capability_get` 返回的目录为准，本页未逐项验证。

## 重试策略

| `retry.mode`   | 说明                              | 适用             |
| -------------- | --------------------------------- | ---------------- |
| `none`（默认） | 不自动重试                        | 带副作用的写操作 |
| `idempotent`   | 最多重试 `max_attempts` 次（1–3） | 真正幂等的操作   |

## 资源限制

| 项                           | 范围 / 默认       |
| ---------------------------- | ----------------- |
| 每应用函数数                 | ≤ 32              |
| 每应用 provider 数           | ≤ 64              |
| `timeout_seconds`            | 1–300，默认 30    |
| `memory_mb`                  | 64–4096，默认 512 |
| 调用输入                     | ≤ 64 KiB          |
| 返回值                       | ≤ 256 KiB         |
| 同时进行中的后台作业（每人） | ≤ 16              |

更多见 [平台边界](limits.md)。

## 函数里拿不到什么

> **安全边界**（危险）
>
> 云函数**不会**收到：数据库连接串 / SQL 凭据、对象存储密钥、用户登录 token、大模型 API Key，也没有外网。
> 数据访问只能经过受限网关，网关按调用身份和 provider 声明**逐请求**限定范围——即使函数有 bug，也越不过权限边界。

## 完整示例

见示例应用 `zleap-web/examples/app-cloud/copilot-studio/`：`cloudfunctions/reviewContent` 读取草稿、计算摘要、带乐观锁写回；
`nightlyReview` 由定时触发器驱动；另有 `logic_unit` 与 `builtin`（`os.agent.complete`）两种 provider 的对照。

带云函数的可运行前端示例见 `zleap-app-kit/examples/moments`，声明与代码摘录见上文「最小可运行示例」。

## 常见问题

### 前端调用直接抛 `BACKGROUND_CAPABILITY_UNAVAILABLE`

当前会话没有协商出 `app-execution/1`：这个安装在当前数据域里**没有任何已启用的后台能力**。
到应用窗口「权限」里勾选后台能力并保存，再重新加载应用。这不是函数写错了。
旧版 SDK 在同样情况下抛的是 `UNSUPPORTED_OPERATION`，看到旧错误码时处理方式相同。

### `FUNCTION_RELEASE_REQUIRED`

`managed_function` 必须绑定**就绪**的发布。

- 正常不会出现：带后台能力的版本上传时由平台自动签名，安装 / 切换版本 / 保存权限时自动绑定，缺签随用随签。如果出现，在应用窗口「权限」里允许后台运行（重新保存一次），或在控制台「版本管理」切换一次版本，平台会自动补签并绑定；仍然出现，说明部署的发布签名不可用（联系平台管理员检查签名密钥 / 信任配置），或重新上传。

处理后重新打开应用窗口「权限」确认该能力下没有「还没有可用的签名发布」的提示，再重新加载应用。

### `RUNTIME_GATEWAY_UNAVAILABLE` / 其他 `RUNTIME_GATEWAY_*`

这次调用没有拿到数据网关（例如部署未接入，或 provider 没有数据声明）。作业会以 `failed` 结束。
函数应**明确失败**，不要用固定的回退数据冒充成功。

### `FUNCTION_DEADLINE_EXCEEDED`

超过 `deadlineAt`。长任务请拆成多步，或调大 `timeout_seconds`（≤300）。

### 云函数里读写被拒

对照上文「按 provider 声明逐请求核对」：最常见的是 provider 的 `permissions.data` 没写 `fields`，
或读写的字段 / 操作不在声明里。

### `SCHEMA_INVALID`

检查：字段是否都在集合 Schema 的 `properties` 里；`date_ms` 字段是否带了 `value_types`；是否误用了 camelCase；
过滤器是否有多余的键。

### 作业状态是 `unknown`

不知道结果，**不等于失败**。用原 `operationId` 核对后再决定，不要换编号重新提交。

## 相关

- [触发器](triggers.md) — 让后台能力自动运行
- [权限与授权](permissions.md) — 安装授权、Cloud 数据授权与后台能力授权
- [Manifest v2 配置](manifest.md) — 函数与 provider 的声明
- 云函数与后台能力（控制台）（文档站 /console/functions）
- 版本管理（文档站 /console/release）
- 日志（文档站 /console/logs）
- [状态与错误码](status-codes.md)
