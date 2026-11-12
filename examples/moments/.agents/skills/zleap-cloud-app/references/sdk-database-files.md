<!-- 由 zleap-app-kit/scripts/sync-skill-references.mjs 从云开发文档站 reference/database-api.md 生成，请改文档站后重新同步 -->

# 云数据库 API

面向**应用页面**（iframe 里的前端代码）的 Cloud SDK 参考：初始化、数据库、文件、页面接口、后台调用、操作回执与错误处理。
云函数里用的是另一套服务端 SDK，见 [云函数开发](cloud-functions.md)。

本页以发布的 SDK 为准：npm 包 `@zleap-ai/app-sdk` 的类型声明 `dist/types/*.d.ts`（`index.d.ts`、`values.d.ts`、`files.d.ts`、`execution.d.ts`、`protocol.d.ts`、`transport.d.ts`），
以及 CLI 内嵌、`zleap-app init` 生成的 `sdk/` 目录（同一份实现，源码在 `zleap-service/internal/appdevcli/templates/todo/sdk`）。
安装、入口与逐步上手见 Cloud SDK 使用（文档站 /guide/sdk）。

## 获取 SDK

SDK 是纯 ESM、零依赖的静态文件。原生模板把它放在包内 `sdk/` 随应用包分发；React 项目从 npm 安装后由构建工具打进包——两种方式都**不从 CDN 加载**。
应用 iframe 默认把 `connect-src` 限制为 `'none'`；部署开启页面 API（`APP_PAGE_API_ENABLED`，默认关闭）后，CSP 会放开到 `<host>/api/v1/app-api/`，可以用本页的 `zl.cloud.os.api.fetch` 调 OS 普通业务接口。**外部地址仍然不可访问**。

用 `zleap-app`（文档站 /guide/quickstart） 生成项目时，模板已经带好 `sdk/` 目录：

```sh
zleap-app init hosted-package ./my-todo --app-key zl3f9a2c7e1b0d4a68   # --app-key 填控制台生成的 appid
```

```
my-todo/
├── index.html
├── main.js
├── style.css
└── sdk/
    ├── index.js / index.d.ts          # zl.cloud：数据库、文件、后台调用（本页）
    ├── execution.js / files.js / values.js / protocol.js / transport.js（及 .d.ts）
    ├── workspace.js / workspace.d.ts  # 工作区文件（host_api.requires: workspace.files；读图片另需 workspace.images.read）
    └── zleap-sdk.js / zleap-sdk.d.ts  # 宿主 SDK：connectHostedApp()（kv、files、close；剪贴板用 zl.app.setClipboardData）
```

SDK 版本与 `zleap-app` 可执行文件一起发布。用 `npm create zleap-app` 生成的 React 项目改为依赖 npm 包
`@zleap-ai/app-sdk`：`@zleap-ai/app-sdk` 对应 `sdk/index.js`，`/host` 对应 `sdk/zleap-sdk.js`，`/workspace` 对应 `sdk/workspace.js`，
API 完全相同。SDK 与 `@zleap-ai/app-cli` 各自发版，版本号不必相同：

```bash
npm i @zleap-ai/app-sdk@latest
npm i -D @zleap-ai/app-cli@latest
```

**不要**再从 `zleap-web` 源码自行构建、复制 SDK——旧文档里的做法已过时，
与宿主协议不匹配的 SDK 会在握手时报 `PROTOCOL_MISMATCH`。

> **三种「存储」别混用**（提示）
>
>
> - `zl.cloud.database()` / `zl.cloud.uploadFile()`：**App Cloud** 数据库和文件（本页），权限 `cloud.database.*` / `cloud.storage.*`；
> - `sdk/workspace.js`：用户 OS 工作区里的文件，权限 `workspace.files`；
> - `connectHostedApp()` 里的旧 kv/files：宿主托管存储。新应用优先用 App Cloud。
>

## 初始化与握手

```js
import { zl } from './sdk/index.js';

zl.cloud.init({ env: zl.cloud.DYNAMIC_CURRENT_ENV });
const caps = await zl.cloud.os.ready(); // 握手完成，拿到协商结果
const db = zl.cloud.database();
```

### `zl.cloud.init(options)`

| 参数        | 类型                                                                                               | 说明                           |
| ----------- | -------------------------------------------------------------------------------------------------- | ------------------------------ |
| `env`       | `zl.cloud.DYNAMIC_CURRENT_ENV`（推荐）\| `'dev'` \| `'prod'` \| `{ database, functions, storage }` | 选择数据域                     |
| `traceUser` | 布尔，默认 `false`                                                                                 | 只参与幂等比较，无其他已知作用 |

行为要点：

- **同步返回 `undefined`**，不是 Promise；握手在后台进行，用 `os.ready()` 等结果。
- 只接受 `env` 和 `traceUser` 两个键，多余的键抛 `SCHEMA_INVALID`。
- `env` 不是上面几种值时抛 `ENV_MISMATCH`；对象形式要求三个值完全相同，否则也是 `ENV_MISMATCH`。
- 同样的配置重复调用是**幂等**的；用**不同**配置再次调用抛 `INIT_CONFLICT`——一个页面只能绑定一个数据域。
- `env` 只是**选择器，不是授权**。能不能访问由宿主和服务端决定。

> **为什么用 `DYNAMIC_CURRENT_ENV`**（提示）
>
> 数据域（dev / prod）是「部署 + 当前用户 + 应用有没有生产环境」决定的：开发数据域默认只对开发团队（应用成员）开放；
> 部署开放生产后其他使用者都用 prod，发布者本人在应用有了生产环境后也用 prod。
> 应用自己判断不了，所以传哨兵 `DYNAMIC_CURRENT_ENV`，由宿主在握手时替你解析成具体值。
> 写死 `'dev'` 或 `'prod'` 时，如果那不是当前对你开放的数据域，打开会话会被拒绝。
> 宿主解析不出哨兵时握手失败，**不会**悄悄落到 dev。详见 核心概念 · 环境与数据域（文档站 /guide/concepts#环境-environment-与数据域）。

### `zl.cloud.os.ready()`

返回 Promise，等待与宿主的握手完成，结果就是协商出的 `Capabilities`：

```js
const caps = await zl.cloud.os.ready();
// caps.protocol   → { major: 2, minor: 0 }
// caps.profiles   → 例如 ['document-core/1', 'watch-snapshot/1', 'storage-object/1', 'app-execution/1', ...]
// caps.operators  → 宿主支持的操作符
// caps.limits     → 服务端下发的限制
// caps.serverTime → 服务端时间（秒），SDK 用它校正 createId 的时间戳
```

- 没调 `init` 就 `ready()`：`INIT_REQUIRED`。
- 应用不在宿主 iframe 里运行（例如直接用浏览器打开 `index.html`）：`RUNTIME_UNAVAILABLE`。
- 15 秒内没完成握手：`CALL_TIMEOUT`。
- 协议主版本不是 2，或一个已知 profile 都没有：`PROTOCOL_MISMATCH`。
- 服务端拒绝开会话（未授权、数据库未就绪、不是发布者等）：以对应错误码失败，常见 `CONSENT_REQUIRED`（应用窗口「权限」里一项都没勾）、
  `PUBLISHER_REQUIRED`、`RESOURCE_NOT_READY`。

**建议启动时 await 一次**，尽早发现授权和开通问题，并据此决定哪些功能可用。

### Profile：决定哪些 API 能用

每个 API 都要求握手时协商到对应的 **profile**（能力档位），没有时调用直接抛错：
数据库 / 文件相关的 profile 或操作符缺失抛 `UNSUPPORTED_OPERATION`；后台执行（`app-execution/1`）缺失抛 `BACKGROUND_CAPABILITY_UNAVAILABLE`（旧 SDK 才是 `UNSUPPORTED_OPERATION`）。
服务端只在条件满足时下发 profile（`zleap-service/internal/services/cloudauthority/runtime_session.go`）：

| Profile            | 解锁的 API                                                               | 服务端下发条件                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `document-core/1`  | `get` / `count` / `add` / `set` / `update` / `remove` / `operations.get` | 数据库已就绪、Manifest 的 `data.collections` 非空、已授予 `cloud.database.read` 或 `write`（`data.schemas` 可选，不写就是灵活集合）        |
| `watch-snapshot/1` | `watch()`                                                                | 在上一条基础上，声明并授予了 `cloud.database.read`                                                                                         |
| `storage-object/1` | `uploadFile` / `downloadFile` / `deleteFile` / `os.files.*`              | 部署启用了对象存储、授予了 `cloud.storage.read` 或 `write`；生产数据域还要求当前安装绑定了已就绪的签名发布                                 |
| `app-execution/1`  | `callFunction` / `os.capabilities` / `os.jobs`                           | 当前安装有已启用的后台能力授权（在应用窗口「权限」里勾选了后台能力；发布绑定由平台自动完成）；缺失时抛 `BACKGROUND_CAPABILITY_UNAVAILABLE` |

```js
const { profiles } = await zl.cloud.os.ready();
const canUpload = profiles.includes('storage-object/1');
```

> **profile 没有 ≠ 你的代码写错**（注意）
>
> `UNSUPPORTED_OPERATION` / `BACKGROUND_CAPABILITY_UNAVAILABLE` 常见于「平台 / 部署未开放」或「还没开通、没授权」。
> 后台能力相关的 `BACKGROUND_CAPABILITY_UNAVAILABLE`，先看应用窗口的「权限」里有没有勾选后台能力；
> 数据库 / 文件相关的 `UNSUPPORTED_OPERATION`，先看控制台 总览（文档站 /console/overview） 的开通清单。再怀疑代码。

### `zl.cloud.os.getCapabilities()` / `zl.cloud.os.close()`

- `getCapabilities()`：返回与 `ready()` 相同内容的**副本**。
- `close()`：主动关闭与宿主的通道；之后所有调用失败（`RUNTIME_UNAVAILABLE`）。页面卸载（`pagehide`）时 SDK 会自动关闭。

### `createCloudClient()`

`zl` 本身就是 `createCloudClient()` 的一个实例。需要一个**独立绑定**的客户端（各自 `init`）时可以再建一个；
一般应用用不到。

## 数据库

```js
const db = zl.cloud.database();
const todos = db.collection('todos');
const _ = db.command;
```

### `zl.cloud.database(options?)`

| 参数              | 说明                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------ |
| `throwOnNotFound` | 默认 `true`。设为 `false` 时，`doc(id).get()` 读不到返回 `{ data: null }` 而不是抛错 |

传其他键会抛 `SCOPE_FORBIDDEN`（例如试图传 `env` 切换数据域）。返回对象：`command`、`collection()`、`serverDate()`、`runTransaction`（不支持）。

### `db.collection(key)`

集合键规则：`^[a-z][a-z0-9_]{0,63}$`，且**不能**以 `sys_`、`ac_`、`t_` 开头，不合规**立即**抛 `SCHEMA_INVALID`。

> **引用集合不会创建集合**（注意）
>
> `db.collection('todos')` 只是拿到一个引用。集合由 Manifest 的 `data.collections` 声明，数据库就绪后由平台按声明自动创建，
> 控制台和 SDK 都**不能**临时新建集合。见 [Manifest](manifest.md) 与 [数据库](console-database.md)。

### 文档结构

读到的每个文档都带三个系统字段，由服务端生成：

| 字段       | 类型       | 说明                       |
| ---------- | ---------- | -------------------------- |
| `_id`      | 字符串     | 文档键                     |
| `_openid`  | 字符串     | 创建者在本应用环境里的标识 |
| `_version` | **字符串** | 版本号，每次修改递增       |

> **`_version` 是字符串**（注意）
>
> SDK 会把它统一转成字符串，正好可以原样传给 `expectedVersion`。需要比较大小时先 `Number()`——字符串比较下 `'10' < '9'`。

**日期**：写入时传 `Date` 对象，SDK 会带上类型标记，读出来仍是 `Date`。传 `Date.now()` 存的就是普通数字。

**字段名**：每一段必须匹配 `^[A-Za-z][A-Za-z0-9_]*$`，最多 16 层。也就是说业务字段**不能以下划线开头**，`_id` 之类的系统字段不能出现在写入数据里（`add` 的 `_id` 除外，见下）。

### 新增 — `collection.add()`

```js
const res = await todos.add({
  data: { title: '买牛奶', done: false, created_at: new Date() },
});
// res._id                  → 新文档键
// res.stats                → { created: 1, updated: 0, removed: 0 }
// res._meta.operationId    → 本次写入的操作编号
// res._meta.version        → 新文档的 _version（如有）
```

- 可以在 `data._id` 里**自己指定文档键**；不指定时由服务端生成。文档键 ≤ 128 字节，不能含控制字符、`/`、`\`。
- `agentos.operationId` 可选，不传 SDK 自动生成（见 [操作编号](#操作编号与回执)）。

### 读取单条 — `doc(id).get()`

```js
const { data } = await todos.doc('todo-001').get();
// data._id, data._version, data.title ...
```

读不到时默认抛 `DOCUMENT_NOT_FOUND`；用 `database({ throwOnNotFound: false })` 则返回 `data: null`。

### 查询 — `where` / `orderBy` / `skip` / `limit` / `field` / `get`

链式调用，**每一步都返回新的查询对象**（不修改原对象，可以安全复用）：

```js
const { data } = await todos
  .where({ done: false, priority: _.gte(3) })
  .orderBy('created_at', 'desc')
  .skip(0)
  .limit(100)
  .get();
```

| 方法                      | 规则                                                                           |
| ------------------------- | ------------------------------------------------------------------------------ |
| `where(obj \| condition)` | 多次调用按 **AND** 叠加                                                        |
| `orderBy(field, dir)`     | `dir` 只能是 `'asc'` / `'desc'`；最多 **4** 个，第 5 个抛 `RESOURCE_EXHAUSTED` |
| `limit(n)`                | 1–**100**；**不调用时默认 20**                                                 |
| `skip(n)`                 | 0–**1000**                                                                     |
| `field(projection)`       | `{ title: true }` 或 `{ body: false }`；包含与排除**不能混用**（`_id` 除外）   |
| `get()`                   | 返回 `{ data: Document[] }`                                                    |

越界的 `limit` / `skip` 会在调用时**立即**抛 `RESOURCE_EXHAUSTED`。

> **不要把第一页当成全部数据**（注意）
>
> 不写 `limit` 只返回 **20** 条；每页最多 100 条，`skip` 最多 1000。需要更多时用 `skip` 翻页，
> 或改成按条件分批（例如按 `created_at` 区间）。模板里的 `orderBy(...).limit(100).get()` 也只是第一页。

### `where` 的写法

`where` 只接受**一个参数**：普通对象，或 `db.command` 组合出的条件。

```js
// 相等
todos.where({ ticket_id: 'abc' });

// 字段上用操作符：把操作符作为字段的值
todos.where({ priority: _.gt(3) });

// 同一字段的区间
todos.where({ priority: _.gte(1).and(_.lte(5)) });

// 嵌套字段用点号路径
todos.where({ 'owner.team': 'core' });

// 逻辑组合：参数是对象或条件
todos.where(_.or({ done: true }, { priority: _.gte(5) }));

// 按日期
todos.where({ created_at: _.gte(new Date('2026-10-01')) });
```

> **常见错误写法**（危险）
>
>
> ```js
> // ❌ 三元组写法：第一个参数不是对象，立即抛 SCHEMA_INVALID
> todos.where('ticket_id', '==', 'abc');
>
> // ❌ 没有字段名的条件：不知道比较哪个字段，服务端校验失败（SCHEMA_INVALID）
> todos.where(_.gt(100));
>
> // ❌ 空对象：抛 SCHEMA_INVALID
> todos.where({});
> ```
>

### 操作符 — `db.command`

| 操作符       | 用途                        | 示例                              |
| ------------ | --------------------------- | --------------------------------- |
| `eq` / `neq` | 等于 / 不等于               | `{ status: _.neq('done') }`       |
| `gt` / `gte` | 大于 / 大于等于             | `{ priority: _.gt(3) }`           |
| `lt` / `lte` | 小于 / 小于等于             | `{ priority: _.lte(5) }`          |
| `in` / `nin` | 在 / 不在列表中（1–100 项） | `{ tag: _.in(['a', 'b']) }`       |
| `exists`     | 字段是否存在                | `{ due: _.exists(true) }`         |
| `and` / `or` | 逻辑组合（≥1 个参数）       | `_.and({ a: 1 }, { b: _.gt(2) })` |
| `inc`        | 原子增减（仅 `update`）     | `{ count: _.inc(1) }`             |
| `set`        | 整体替换字段（仅 `update`） | `{ meta: _.set({ a: 1 }) }`       |
| `remove`     | 删除字段（仅 `update`）     | `{ draft: _.remove() }`           |

条件对象还有实例方法 `.and(other)` / `.or(other)`。查询过滤、写入字段操作的数量和深度上限见 [平台边界与限制 · 数据库操作](limits.md#数据库操作)。

### 计数 — `count()`

```js
const { total } = await todos.where({ done: false }).count();
```

### 部分更新 — `doc(id).update()`

```js
await todos.doc(row._id).update({
  data: { done: true, 'meta.updated_by': 'me', views: _.inc(1) },
  agentos: { expectedVersion: row._version }, // 乐观锁，强烈建议
});
```

- **只改传入的字段**；嵌套对象**按叶子合并**（`{ meta: { a: 1 } }` 只改 `meta.a`，不动 `meta` 的其他字段）。
- 要整体替换一个对象字段，用 `_.set({...})`；数组总是整体替换。
- `update` 的 `data` 里可以用点号路径（`'meta.updated_by'`）。
- 同一次更新里不能出现互相包含的路径（如同时写 `meta` 和 `meta.a`），否则 `SCHEMA_INVALID`。

> **`expectedVersion`：可选，但建议总是带上**（提示）
>
> `expectedVersion` 必须是正整数的字符串（就是读到的 `_version`）。带上后，如果读取之后别人改过，
> 更新会被拒绝（`VERSION_CONFLICT`），而不是静默覆盖对方。收到冲突后重新读取，再决定怎么改。
> `set` / `remove` 同样支持。

### 创建或整体覆盖 — `doc(id).set()`

```js
await todos.doc('todo-001').set({
  data: { title: '买牛奶', done: false, created_at: db.serverDate() },
});
```

用 `data` 整体作为文档内容（指定 `_id`）。`set` 里只允许 `serverDate()` 这一种字段操作，`inc` / `set` / `remove` 会抛 `UNSUPPORTED_OPERATION`。

### 删除 — `doc(id).remove()`

```js
await todos.doc(row._id).remove({ agentos: { expectedVersion: row._version } });
```

参数可省略。

### 服务端时间 — `db.serverDate()`

```js
await todos.doc(id).update({ data: { updated_at: db.serverDate() } });
await todos.add({ data: { title: 'x', created_at: db.serverDate({ offset: 60_000 }) } });
```

- 写入时由服务端填当前时间，读出来是 `Date`；
- `offset` 单位毫秒，范围 ±86 400 000（±1 天），超出抛 `SCHEMA_INVALID`；
- 可用于 `add`、`set`、`update`（`inc` / `set` / `remove` 只能用于 `update`）。
  只能作为写入值，不能用在 `where` 里。

### 快照轮询 — `watch()`

`watch` 做**一次有界的增量快照**，把返回的 `cursor` 传给下一次调用，就能持续跟进变化：

```js
let cursor; // 第一次不传，等同 '0'
async function poll() {
  const snap = await todos.where({ done: false }).watch({ cursor, maxDocs: 100 });
  cursor = snap.cursor; // 下一次从这里继续
  if (snap.changed) render(snap.data);
  if (snap.hasMore) return poll(); // 还有没取完的
}
```

| 参数      | 说明                                                                                          |
| --------- | --------------------------------------------------------------------------------------------- |
| `cursor`  | 上一次返回的游标，十进制字符串                                                                |
| `maxDocs` | 1–100，默认 100                                                                               |
| `query`   | 可选，覆盖链上的条件，只能含 `filter` / `order_by` / `projection` / `limit` / `skip`，≤ 8 KiB |

返回 `{ data, cursor, changed, hasMore }`。`changed` 表示游标是否前进。
`watch` 不支持 `skip`：链上调用过 `skip(n)`（n > 0）时会被拒绝（`SCHEMA_INVALID`）。需要协商到 `watch-snapshot/1`。

### 变更推送 — `onChange()`

```js
const off = todos.onChange((change) => {
  // change.event / collection_key / document_key / change_seq / operation_id ...
  void reload(); // 当信号用，再去读
});
off(); // 取消订阅
```

应用 iframe 不能自己建立网络连接，宿主代替应用订阅平台通道，把变更转发进来。

- 回调**只带变更坐标，不带文档内容**——收到后用 `get` / `watch` 重读；
- 只会收到**本集合**的变更（一个订阅覆盖应用所有集合，SDK 按 `collection_key` 过滤）；
- 推送是**协商可选**的：宿主没有推送能力、或还没 `init` 时返回一个空的取消函数，回调永远不会触发。
  所以**保留一个低频的 `watch` / `get` 兜底是安全的**，不要假设一定有实时通知；
- 时延：写入确认后平台立即转发，通常 1 秒内到达；平台繁忙时退回定时转发，可能延迟到几十秒。
  自己写入后要马上看到结果的，直接用写入返回值或重读，不要等 `onChange`。

### 不支持的方法

这些方法目前都**不支持**，调用会明确抛 `UNSUPPORTED_OPERATION`，不会静默成功。类型声明上分两类：

- `query.after()`、`query.update()`、`query.remove()` 声明为 `never`；
- `db.runTransaction()`、`zl.cloud.getTempFileURL()` 为了兼容回调风格，声明为 `(...) => void | Promise<never>`——**调用即失败**，不要因为看到 `void` 就以为可以随便调。

| 方法                                | 说明                                           |
| ----------------------------------- | ---------------------------------------------- |
| `db.runTransaction()`               | 事务未开放                                     |
| `query.after()`                     | 游标分页未开放                                 |
| `query.update()` / `query.remove()` | 批量写未开放，只能逐条 `doc(id).update/remove` |
| `zl.cloud.getTempFileURL()`         | 临时 URL 未开放                                |

## 文件存储

需要协商到 `storage-object/1`：Manifest 声明 `cloud.storage.read` / `cloud.storage.write`，安装后在应用窗口「权限」里勾选文件权限。
控制台侧的管理界面见 文件存储（文档站 /console/storage）。

### `zl.cloud.uploadFile(options)`

```js
const uploaded = await zl.cloud.uploadFile({
  cloudPath: `tickets/${ticketId}/report.pdf`,
  filePath: file, // Blob 或 File，不是本机路径
});
// uploaded.fileID / etag / sha256 / size
```

| 参数                   | 说明                                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| `cloudPath`            | 应用存储里的逻辑路径，规则见 控制台 · 路径规则（文档站 /console/storage#路径规则） |
| `filePath`             | **Blob / File 对象**（名字沿用了小程序习惯，但不是路径字符串）              |
| `agentos.operationId`  | 可选，不传自动生成                                                          |
| `agentos.overwrite`    | 覆盖已有文件时为 `true`，**必须与 `expectedETag` 同时出现**                 |
| `agentos.expectedETag` | 被覆盖文件当前的 `etag`                                                     |

| 限制       | 值                                         |
| ---------- | ------------------------------------------ |
| 单文件大小 | ≤ **4 MiB**，超出抛 `SCHEMA_INVALID`       |
| 分块       | **256 KiB**，最多 16 块，SDK 最多 2 块并行 |

上传流程：先算整文件 SHA-256 → `begin` → 逐块上传（每块带 SHA-256）→ `commit`，服务端再校验整文件摘要。
中途某一步结果不明（`COMMIT_UNKNOWN`）时，SDK 会**自动用原操作编号查回执**并只补传缺失的块。

> **覆盖规则**（注意）
>
>
> - 路径上已有文件时，不带 `overwrite` + `expectedETag` 的上传会被拒绝（`VERSION_CONFLICT`）；
> - `overwrite: true` 而不带 `expectedETag`（或反过来）会被 SDK 拒绝（`SCHEMA_INVALID`）——平台**没有**无条件覆盖；
> - `expectedETag` 与服务端当前版本不一致时拒绝，防止覆盖别人的新内容。
>
> ```js
> const info = await zl.cloud.os.files.stat(fileID);
> await zl.cloud.uploadFile({
>   cloudPath,
>   filePath: newBlob,
>   agentos: { overwrite: true, expectedETag: info.etag },
> });
> ```
>

### `zl.cloud.downloadFile({ fileID })`

```js
const { fileContent } = await zl.cloud.downloadFile({ fileID });
const text = await fileContent.text();
```

先 `stat` 拿到当前 ETag 和摘要，再按 256 KiB 分段读取同一版本，**返回前校验长度和 SHA-256**。
返回的 `fileContent` 是 `Blob`，类型固定为 `application/octet-stream`。

### `zl.cloud.deleteFile({ fileList, agentos })`

```js
const res = await zl.cloud.deleteFile({
  fileList: [uploaded.fileID],
  agentos: { expectedETags: { [uploaded.fileID]: uploaded.etag } },
});
// res.deleted → 成功的 fileID；res.failed → [{ fileID, error }]
```

- `fileList` 1–100 项；**每个** `fileID` 都必须在 `expectedETags` 里有对应 etag。缺失的检查发生在逐个删除的循环里：
  排在它前面的文件**已经删掉**，然后整次调用抛 `SCHEMA_INVALID`——所以调用前自己先核对完整；
- 逐个删除，**部分失败不会抛错**，而是放进 `failed`（`errMsg: 'partial failure'`）——一定要检查 `failed`；
- 删除是**软删除**：字节保留、仍占配额；
- `agentos.operationId` 只用于第一个文件，其余自动生成。

### `zl.cloud.os.files.*`

| 方法                        | 说明                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `stat(fileID)`              | 读取元数据 `{ fileID, etag, sha256, size }`                                                         |
| `getOperation(operationId)` | 查询上传 / 删除操作的回执：`state` 为 `pending` / `succeeded` / `cancelled`，含已收到的块和文件信息 |
| `cancel(operationId)`       | 取消**尚未提交**的上传                                                                              |

```js
try {
  await zl.cloud.uploadFile({ cloudPath, filePath: file, agentos: { operationId } });
} catch (error) {
  if (error.errCode === 'COMMIT_UNKNOWN') {
    const receipt = await zl.cloud.os.files.getOperation(operationId);
    // succeeded → 已上传；pending → 用同一个 operationId 和同一个文件再调一次 uploadFile 续传；cancelled → 已作废
  }
}
```

文件操作的回执用 `os.files.getOperation`，**不要**用 `os.operations.get`（后者只查数据库写入）。

## 页面接口 — `zl.cloud.os.api`

应用页面可以直接调用 zleapOS 的**普通业务接口**（例如待办、文件写入），不必经过自己的数据库。它和 App Cloud 是两条独立通道：**不需要 `zl.cloud.init()`，不需要声明 `cloud.*` 能力，也不依赖 Cloud 会话**；只调用页面接口的应用安装后就能用。

> **需要部署开启，默认关闭**（注意）
>
> 页面接口由部署配置 `APP_PAGE_API_ENABLED` 控制，**默认关闭**。关闭时申请令牌会失败，网关返回 404「当前部署未开放应用接口」。
> 开启后 iframe 的 CSP 只放开到 `<host>/api/v1/app-api/`，**外部地址仍然不可访问**。

### `zl.cloud.os.api.token()`

返回 `Promise<{ token, baseUrl, expiresAt }>`：

```js
const { token, baseUrl, expiresAt } = await zl.cloud.os.api.token();
// expiresAt 是秒级时间戳
```

返回宿主代签的短期应用令牌。一般不需要自己拿——`fetch` 会自动取用并在过期前续签；只有需要自行组装请求时才用。

### `zl.cloud.os.api.fetch(path, init?)`

```js
const res = await zl.cloud.os.api.fetch('/todos?page=1&page_size=20');
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const body = await res.json(); // 与原接口响应相同：{ code, message, data }
// 按接口约定检查 body.code / body.message 后再使用 body.data
```

| 规则       | 说明                                                                       |
| ---------- | -------------------------------------------------------------------------- |
| 路径基准   | 相对 `/api/v1`：`/todos` 就是 `GET /api/v1/todos`                          |
| 路径格式   | 必须以 `/` 开头，且不能以 `//` 开头；否则抛 `SCHEMA_INVALID`               |
| 身份与权限 | 按当前使用者的权限执行；页面拿不到用户登录 token                           |
| 401 重试   | **只有 `GET` / `HEAD`** 在 401 时自动换新令牌重试一次；写操作不自动重试    |
| 响应       | 与原接口一致，必须同时检查 HTTP 状态和响应体里的 `code`                    |
| 可用接口   | 与 `os_business_search` 的目录一致；管理员、组织和平台控制类接口**不开放** |
| 不支持     | 二进制上传、二进制下载和流式响应                                           |
| 外部网络   | 不能请求外部地址                                                           |

文字内容可以用 `POST /files/write` 存成文件。写操作结果不明时，先查询确认，不要直接换请求重试；具体接口可用 `zleap-app business call` 或 MCP 的 `os_business_call` 先调试。

## 操作编号与回执

### `zl.cloud.os.operations.createId()`

生成 `op_<10 位秒级时间戳>_<32 位十六进制>` 格式的操作编号（时间戳已按服务端时间校正）。
所有写入都可以显式传操作编号，但**位置不同**：

- 数据库写入（`add` / `set` / `update` / `remove`）和文件上传 / 删除：传 `agentos.operationId`；
- `capabilities.invoke` / `jobs.submit`：传顶层的 `operationId`；
- `callFunction`：传 `agentos.operationId`。

不传时 SDK 自动生成，并在返回值 `_meta.operationId` 和错误对象 `error.operationId` 里带回来。

服务端规则（`zleap-service/internal/cloudplane/dataplane/scope.go`）：

| 规则         | 说明                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------- |
| 首次使用窗口 | 新编号里的时间戳与服务端时间相差 > **300 秒**时拒绝（`OPERATION_EXPIRED`）——编号要现用现生成 |
| 幂等重放     | 同一编号、**完全相同**的请求再次提交，返回第一次的结果，不会重复写入                         |
| 内容不一致   | 同一编号、不同内容 → `IDEMPOTENCY_CONFLICT`                                                  |
| 回执保留     | **24 小时**，过期后 `OPERATION_EXPIRED`                                                      |

### `zl.cloud.os.operations.get(operationId)`

查询一次**数据库写入**的回执：

```js
const receipt = await zl.cloud.os.operations.get(operationId);
// receipt.state === 'succeeded'
// receipt.result → 与写入返回值同结构的 WriteResult
```

只有已成功的写入才有回执；查不到时服务端返回 `OPERATION_NOT_FOUND`，在应用里归类为 `DOCUMENT_NOT_FOUND`
（见 [状态与错误码](status-codes.md#应用里看到的是哪个码)）。

> **查不到回执 ≠ 操作失败**（危险）
>
> 它只说明这次没查到记录（可能请求根本没到，也可能还没落库）。**不要因此换新编号重写**——那可能写出两条。

## 结果未知（`COMMIT_UNKNOWN`）的处理

写请求 30 秒内没有回音、或通道在写请求途中断开，SDK 抛 `COMMIT_UNKNOWN`：请求**可能已经生效，也可能没有**。

推荐顺序：

1. **保留原操作编号**（`error.operationId`），提示用户「结果待确认」，不要让用户再点一次；
2. 用 `operations.get(operationId)` 查回执，或**重新读取**相关数据确认；
3. 确认没生效、且仍在 300 秒窗口内时，可以用**同一个编号、完全相同的内容**重新提交——服务端会识别为同一次操作，
   已生效则直接返回原结果；
4. 绝不换一个新编号去「重试」。

```js
async function saveTodo(data) {
  const operationId = zl.cloud.os.operations.createId();
  try {
    return await todos.add({ data, agentos: { operationId } });
  } catch (error) {
    if (error.errCode === 'COMMIT_UNKNOWN') {
      try {
        return (await zl.cloud.os.operations.get(operationId)).result; // 已生效
      } catch {
        // 没查到：不等于失败。用同一个编号、同样的 data 再提交一次是安全的（300 秒内）
        return await todos.add({ data, agentos: { operationId } });
      }
    }
    if (error.errCode === 'VERSION_CONFLICT') {
      // 明确失败：重新读取最新版本后再决定
    }
    throw error;
  }
}
```

> **绑定新发布后的会话失效**（提示）
>
> 安装切换到另一个版本并绑定新的发布后，旧会话会收到 `RELEASE_UNAVAILABLE`。宿主会自动重开会话并**重试一次**，
> 多数情况下应用无感。若仍失败，请用户重新打开应用。

## 后台执行与能力调用

需要协商到 `app-execution/1`。完整说明见 云函数与后台能力（文档站 /console/functions）、[触发器](triggers.md)。

### `zl.cloud.os.capabilities.invoke(args)`

```js
const job = await zl.cloud.os.capabilities.invoke({
  id: 'com.example.my-app.analyze',
  input: { text: '要分析的文本' },
  waitSeconds: 10,
});
if (job.status !== 'succeeded') throw new Error(job.errorCode || job.status);
```

| 参数          | 说明                                       |
| ------------- | ------------------------------------------ |
| `id`          | 能力 ID，`^[A-Za-z][A-Za-z0-9_.-]{0,127}$` |
| `input`       | 入参对象，序列化后 ≤ **64 KiB**            |
| `operationId` | 可选，不传自动生成                         |
| `waitSeconds` | 0–25，默认 0（提交后立即返回）             |

只接受这四个键，多余键抛 `UNSUPPORTED_OPERATION`。

返回 `JobResult`：

| 字段             | 说明                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `jobId`          | 作业编号                                                                                                  |
| `invocationId`   | 调用编号（日志（文档站 /console/logs） 按它筛选）                                                                |
| `operationId`    | 操作编号                                                                                                  |
| `status`         | `accepted` / `queued` / `running` / `cancel_requested` / `cancelled` / `succeeded` / `failed` / `unknown` |
| `result`         | 结果，没有时为 `null`                                                                                     |
| `errorCode`      | 错误码，没有时为 `null`                                                                                   |
| `committedSteps` | 已提交的步骤名列表                                                                                        |

> **拿到 job 不代表成功**（危险）
>
> `invoke` 返回时作业可能还在排队或运行。只有 `status === 'succeeded'` 才是成功；`unknown` 表示结果不明，
> 用 `jobs.get` 继续查，不要重新提交。

### `zl.cloud.os.jobs.*`

| 方法                                                                            | 说明                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `submit({ kind: 'capability', capability, input, operationId?, waitSeconds? })` | 与 `capabilities.invoke` 等价                                                  |
| `get({ jobId })` / `result({ jobId })`                                          | 查询作业（两者相同）                                                           |
| `wait({ jobId, timeoutSeconds?, pollMilliseconds? })`                           | 在页面里有界等待终态                                                           |
| `cancel({ jobId })`                                                             | 请求取消，返回 `{ cancelRequested: true }`；**不是回滚**，已提交的步骤不会撤销 |

`wait`：`timeoutSeconds` 0–300（默认 25），`pollMilliseconds` 100–5000（默认 500）。超时仍未结束抛 `CALL_TIMEOUT`，
异常里带着 `jobId` / `invocationId` / `operationId`，可以继续 `jobs.get` / `jobs.wait`。

### `zl.cloud.callFunction(options)`

调用**本应用**声明的 provider，内部同步等待最多 25 秒：

```js
const job = await zl.cloud.callFunction({
  name: 'ticket.classify',
  data: { ticket_id: 'todo-001' },
});
```

| 结果                   | SDK 行为                                                 |
| ---------------------- | -------------------------------------------------------- |
| `succeeded`            | 返回 `JobResult`                                         |
| 25 秒内未结束          | 抛 `CALL_TIMEOUT`（带 `jobId`，可用 `jobs.wait` 继续等） |
| `unknown`              | 抛 `COMMIT_UNKNOWN`（带 `jobId`）                        |
| `failed` / `cancelled` | 抛该作业的 `errorCode`（没有时为 `EXECUTION_FAILED`）    |

> **不支持跨应用调用**（注意）
>
> `callFunction` 只在**本应用内**解析 provider，SDK 不允许指定其他应用的 `app_id`。

## 错误处理

### `CloudError`

所有失败都以 `CloudError` 抛出：

| 字段                     | 说明                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| `errCode`                | 错误码，如 `SCOPE_FORBIDDEN`                                                                        |
| `errMsg`                 | 一般是 `App Cloud: <errCode>`；个别码有更具体的中文长说明（如 `BACKGROUND_CAPABILITY_UNAVAILABLE`） |
| `requestId`              | 请求编号（读 `error.requestId`，不是 `error._meta.requestId`）                                      |
| `operationId`            | 写操作的操作编号（自动生成的也会带上）                                                              |
| `retryable`              | 仅 `CALL_TIMEOUT`、`RUNTIME_UNAVAILABLE`、`COMMIT_UNKNOWN` 为 `true`                                |
| `jobId` / `invocationId` | 后台调用相关错误时存在                                                                              |

> **`_meta.requestId` 只在成功结果里**（提示）
>
> 成功结果可能带 `_meta.requestId`；失败时用 `error.requestId`。不要用 `_meta.requestId` 去读错误。

服务端原因码会被宿主归类后再交给应用，完整列表见 [状态与错误码](status-codes.md)。

### 通道层面的错误

| 情况                                                   | `errCode`                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| 读请求 30 秒未返回                                     | `CALL_TIMEOUT`                                                           |
| 写请求 30 秒未返回 / 写途中通道断开                    | `COMMIT_UNKNOWN`                                                         |
| 同时在途请求超过 8 个                                  | `RESOURCE_EXHAUSTED`                                                     |
| 请求体超过 256 KiB（或协商的更小值）                   | `REQUEST_TOO_LARGE`                                                      |
| 未协商到数据库 / 文件相关的 profile，或操作符不支持    | `UNSUPPORTED_OPERATION`                                                  |
| 未协商到 `app-execution/1`（没有任何已启用的后台能力） | `BACKGROUND_CAPABILITY_UNAVAILABLE`（旧 SDK 为 `UNSUPPORTED_OPERATION`） |
| 响应结构异常                                           | `PROTOCOL_MISMATCH`                                                      |
| 通道已关闭                                             | `RUNTIME_UNAVAILABLE`                                                    |

### 回调风格

传入任意 `success` / `fail` / `complete` 回调时切换到回调模式，此时**不返回 Promise**：

```js
todos.add({
  data: { title: 'x' },
  success: (res) => console.log(res._id),
  fail: (err) => console.error(err.errCode),
  complete: () => setBusy(false),
});
```

- `fail` 收到的一定是 `CloudError`（非 `CloudError` 的异常会被包装成 `RUNTIME_UNAVAILABLE`）；
- `success` 里抛异常**不会**再触发 `fail`。

`watch()`、`onChange()`、`os.*` 系列方法不支持回调模式，只返回 Promise（`onChange` 返回取消函数）。

## 已知限制速查

| 项                                               | 限制                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| 分页                                             | `limit` 1–100（默认 20），`skip` ≤ 1000                                     |
| 排序字段                                         | ≤ 4                                                                         |
| `watch`                                          | `maxDocs` ≤ 100，不支持 `skip`                                              |
| 请求体                                           | ≤ 256 KiB                                                                   |
| 在途请求                                         | ≤ 8                                                                         |
| 单次请求超时                                     | 30 秒；握手 15 秒                                                           |
| 操作编号                                         | 首次使用 300 秒窗口，回执保留 24 小时                                       |
| 单文件                                           | ≤ 4 MiB                                                                     |
| 能力调用入参                                     | ≤ 64 KiB，`waitSeconds` ≤ 25                                                |
| 页面 API（`zl.cloud.os.api`）                    | 仅部署开启 `APP_PAGE_API_ENABLED` 时可用；不支持二进制上传 / 下载与流式响应 |
| 事务 / 批量写 / 游标分页 / 临时 URL / 跨应用调用 | 不支持                                                                      |

完整数值见 [平台边界与限制](limits.md)。

## 相关

- 核心概念（文档站 /guide/concepts） — 操作编号、结果未知、乐观锁
- [权限与授权](permissions.md) — 为什么会返回 `SCOPE_FORBIDDEN`、`CONSENT_REQUIRED`
- [状态与错误码](status-codes.md)
- [云函数开发](cloud-functions.md) — 服务端 SDK
- 文件存储（控制台）（文档站 /console/storage）
- 从开发到上线（文档站 /guide/dev-to-production）
