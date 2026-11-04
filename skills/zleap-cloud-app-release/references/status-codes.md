<!-- 由 zleap-app-kit/scripts/sync-skill-references.mjs 从云开发文档站 reference/status-codes.md 生成，请改文档站后重新同步 -->

# 状态与错误码

排查问题时先查这一页。**错误码（`errCode` / `reason`）决定你该「重试」还是该「改代码」；
`message` 和 `next_action` 告诉你具体发生了什么、下一步做什么。**

## 先分清：我该重试，还是该改？

| 类别           | 典型错误码                                             | 正确反应                             |
| -------------- | ------------------------------------------------------ | ------------------------------------ |
| **权限类**     | `SCOPE_FORBIDDEN`、`RULE_DENIED`、`ENV_FORBIDDEN`      | 去授权或改规则，不要盲目重试         |
| **数据类**     | `SCHEMA_INVALID`、`VERSION_CONFLICT`、`INDEX_REQUIRED` | 改代码、改数据或建索引               |
| **结果未知**   | `COMMIT_UNKNOWN`、`NODE_LOST`                          | **用原操作编号查询**，不要换编号重试 |
| **未就绪**     | `RESOURCE_NOT_READY`、`FUNCTION_RELEASE_REQUIRED`      | 等开通完成 / 发布就绪并绑定后再试    |
| **繁忙或超限** | `APP_RATE_LIMITED`、`RESOURCE_EXHAUSTED`               | 稍后重试，或按提示清理数据、调整用法 |
| **临时故障**   | `CALL_TIMEOUT`、`RUNTIME_UNAVAILABLE`                  | 可以重试                             |
| **平台未开放** | `UNSUPPORTED_OPERATION`、`FEATURE_UNAVAILABLE`         | 改实现，重试无用                     |

## 错误响应长什么样

平台接口出错时 **HTTP 状态码仍是 200**，真正的结果在响应体的 `code` 里（同时放在响应头 `X-Biz-Code`）：

```json
{
  "code": 42200,
  "message": "查询需要扫描的行数超过单次上限（上限 10000 行）：筛选字段还没有索引",
  "data": {
    "reason": "INDEX_REQUIRED",
    "layer": "data_plane",
    "operation": "documents.query",
    "scan_limit": 10000,
    "suggested_index": "...",
    "next_action": "在管理面给该字段建索引后重试"
  }
}
```

| 字段               | 含义                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code`             | 业务码，按段位归类：401xx 认证、403xx 拒绝、404xx 不存在、409xx 冲突、422xx 参数、429xx 超限、503xx 未就绪/暂不可用、50000 内部错误                            |
| `message`          | **给人看的中文说明**。数据服务、发布等错误会说清具体原因，容量类会带上数字（如「本应用文档总数：已用 9800，上限 10000」）                                      |
| `data.reason`      | **稳定的原因码**，程序据此分流（本页各表格里的码）                                                                                                             |
| `data.next_action` | **下一步做什么**（2026-10 新增），只有能由使用者自己处理的错误才带                                                                                             |
| `data` 其他字段    | 定位信息：`operation`、`operation_id`、`layer`，容量类的 `quota` / `used` / `limit`，查询类的 `scan_limit` / `suggested_index`，限流的 `app_concurrency_limit` |

- `next_action` 与 `reason` **在 `data` 的同一层**。少数 `data` 不是对象的错误，会变成 `{"detail": <原值>, "next_action": …}`。
- 意料之外的内部异常统一返回 `50000`，`data` 为 `null`：发布、开发工具类接口文案是「服务内部错误」，
  应用数据（`/app-cloud`）类接口是「应用数据暂不可用，请稍后重试」。服务端会记录完整日志，持续出现请把时间点交给管理员。
- 应用数据接口超时返回 `50390`「应用数据请求超时，请查询原操作」，`reason` 为 `CALL_TIMEOUT`。

> **哪里能看到 message 和 next_action**（提示）
>
> 控制台会直接显示；`zleap-app` 命令行把整个 `data` 打印在 `detail=` 后面（见 [命令行](#命令行-zleap-app)）。
> **应用（iframe）里的 SDK 只拿到错误码**，见下一节。

## 应用里看到的是哪个码

应用里的 Cloud SDK 抛出 `CloudError`：

| 字段                     | 含义                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `errCode`                | 错误码                                                                                                                                     |
| `errMsg`                 | 一般是 `App Cloud: <errCode>`，**不含服务端的中文说明**；少数由 SDK 本地判定的错误（如 `BACKGROUND_CAPABILITY_UNAVAILABLE`）带一段中文说明 |
| `retryable`              | 只有 `CALL_TIMEOUT`、`RUNTIME_UNAVAILABLE`、`COMMIT_UNKNOWN` 为 `true`                                                                     |
| `requestId`              | 本次请求编号                                                                                                                               |
| `operationId`            | 写操作的操作编号（`op_<秒级时间戳>_<32 位十六进制>`）                                                                                      |
| `jobId` / `invocationId` | 后台调用的作业编号，可用 `jobs.get` / `jobs.wait` 继续查                                                                                   |

宿主只把服务端的 `reason` 交给应用，**不传 `message` 和 `next_action`**。要给用户看的提示文案，
按 `errCode` 在应用里自己写（脚手架模板 `src/cloud/client.ts` 的 `describeError` 就是这样做的）。

宿主按下面的白名单把 `reason` 原样转给应用：

| 分组       | 原样透传的码                                                                                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 认证与权限 | `AUTH_REQUIRED`、`ENV_FORBIDDEN`、`PUBLISHER_REQUIRED`、`SCOPE_FORBIDDEN`、`RULE_DENIED`、`QUERY_NOT_AUTHORIZED`                                                                         |
| 数据       | `COLLECTION_NOT_FOUND`、`DOCUMENT_NOT_FOUND`、`SCHEMA_INVALID`、`UNSUPPORTED_OPERATION`、`VERSION_CONFLICT`、`IDEMPOTENCY_CONFLICT`、`INDEX_REQUIRED`                                    |
| 繁忙与超限 | `RESOURCE_EXHAUSTED`、`APP_RATE_LIMITED`                                                                                                                                                 |
| 结果与通道 | `RUNTIME_UNAVAILABLE`、`CALL_TIMEOUT`、`COMMIT_UNKNOWN`、`NODE_LOST`、`NODE_LOST_EXPIRED`、`OPERATION_EXPIRED`、`STALE_GENERATION`、`PROTOCOL_MISMATCH`                                  |
| 文件       | `STALE_RESOURCE`、`FILE_NOT_FOUND`、`STORAGE_UNAVAILABLE`                                                                                                                                |
| 就绪与发布 | `RESOURCE_NOT_READY`、`FUNCTION_RELEASE_REQUIRED`、`RELEASE_UNAVAILABLE`、`RELEASE_NOT_READY`、`RELEASE_DISABLED`、`RELEASE_ACTIVATION_UNAVAILABLE`、`RELEASE_ACTIVATION_TARGET_MISSING` |

不在白名单里的码按业务码段位归类：

| 服务端业务码 | 应用看到的 `errCode`  |
| ------------ | --------------------- |
| 401xx        | `AUTH_REQUIRED`       |
| 403xx        | `SCOPE_FORBIDDEN`     |
| 404xx        | `DOCUMENT_NOT_FOUND`  |
| 409xx        | `VERSION_CONFLICT`    |
| 422xx        | `SCHEMA_INVALID`      |
| 429xx        | `RESOURCE_EXHAUSTED`  |
| 其他         | `RUNTIME_UNAVAILABLE` |

常见的归类结果：

| 服务端原因                                                             | 应用里的 `errCode`    |
| ---------------------------------------------------------------------- | --------------------- |
| `DOCUMENT_TOO_LARGE`、`QUERY_TOO_COMPLEX` 等 422 类                    | `SCHEMA_INVALID`      |
| `DOCUMENT_EXISTS`、`UPLOAD_INCOMPLETE`、`UPLOAD_INTEGRITY_FAILED`      | `VERSION_CONFLICT`    |
| `CONSENT_REQUIRED`、`CAPABILITY_FORBIDDEN`、`STORAGE_PROD_UNAVAILABLE` | `SCOPE_FORBIDDEN`     |
| `DATA_SERVICE_UNAVAILABLE`、`AUTHORIZATION_UNAVAILABLE`                | `RUNTIME_UNAVAILABLE` |
| 后台调用「同一操作编号的输入不同」「首次受理操作已过期」（无原因码）   | `VERSION_CONFLICT`    |

原始原因码与中文说明可以在控制台的 日志（文档站 /console/logs） 里看到；`zleap-app runtime-logs` 的 `items`
记录的是应用里 SDK 报出的 `errCode`（归类之后的码）。

## 应用内错误码

以下是应用可能直接拿到的 `errCode`（SDK 本地产生的 + 宿主白名单透传的）。

### 通道与调用

| 错误码                              | 含义                                                                              | 可重试 | 处理                                                                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `COMMIT_UNKNOWN`                    | **写操作结果未知**（写请求 30 秒未返回等）                                        | ✅     | **用原 `operationId` 查回执**，确认前不要换编号重新写                                                                                       |
| `CALL_TIMEOUT`                      | 读请求 30 秒未返回 / 握手 15 秒未完成 / 作业等待超时                              | ✅     | 可重试；带 `jobId` 时用 `jobs.wait` 继续等                                                                                                  |
| `RUNTIME_UNAVAILABLE`               | 通道已关闭或服务暂不可用                                                          | ✅     | 稍后重试；页面卸载后通道不可再用                                                                                                            |
| `APP_RATE_LIMITED`                  | 本应用此刻并发请求过多（单应用并发槽被占满）                                      | ❌\*   | 稍后重试；不要立刻循环重试                                                                                                                  |
| `RESOURCE_EXHAUSTED`                | 超出限制（并发 >8、分页/排序/大小上限、配额）                                     | —      | 对照 限制（文档站 ./limits） 调整；配额类需清理数据                                                                                                |
| `REQUEST_TOO_LARGE`                 | 请求体超过协商上限（默认 256 KiB）                                                | ❌     | 拆分请求                                                                                                                                    |
| `IDEMPOTENCY_CONFLICT`              | 同一请求编号被重复使用，或同一操作编号用于不同内容                                | ❌     | 新请求用新编号；重试同一写入时内容必须完全相同                                                                                              |
| `OPERATION_EXPIRED`                 | 操作编号超出首次使用窗口（300 秒）或回执已过期                                    | ❌     | 重新读取最新状态后，用新编号发起                                                                                                            |
| `PROTOCOL_MISMATCH`                 | SDK 与宿主协议不一致，或响应结构异常                                              | ❌     | 使用与当前 OS 匹配的 SDK 版本                                                                                                               |
| `BACKGROUND_CAPABILITY_UNAVAILABLE` | 宿主没有协商到 `app-execution/1`，`callFunction` / `capabilities.invoke` 无法执行 | ❌     | 先让使用者在应用窗口「权限」里勾选后台能力并保存；确认安装已绑定就绪发布、部署开放后台执行。旧 SDK 报的是 `UNSUPPORTED_OPERATION`，升级 SDK |
| `UNSUPPORTED_OPERATION`             | 平台未实现或未协商的操作                                                          | ❌     | 改实现，见 未实现的 SDK 功能（文档站 ./limits#未实现的-sdk-功能）                                                                                  |

\* `retryable` 为 `false`，但稍等后重试通常能成功；持续出现说明有长任务占满了并发。

### 初始化与授权

| 错误码                 | 含义                                                         | 处理                                                                   |
| ---------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `INIT_REQUIRED`        | 调用 `ready()` 前没有 `zl.cloud.init()`                      | 先初始化                                                               |
| `INIT_CONFLICT`        | 同一页面用不同环境再次初始化                                 | 一个页面只绑定一个环境                                                 |
| `ENV_MISMATCH`         | `env` 取值非法                                               | 只能是 `dev` / `prod`（或 `DYNAMIC_CURRENT_ENV`）                      |
| `AUTH_REQUIRED`        | 登录态或运行会话失效                                         | 重新打开应用                                                           |
| `SCOPE_FORBIDDEN`      | 权限范围不允许（含未授权数据访问、生产文件存储未开放）       | 见本页末尾「排查：`SCOPE_FORBIDDEN`」                                  |
| `ENV_FORBIDDEN`        | 应用要用的环境不存在或已停用                                 | 见下方「打开应用时的错误」                                             |
| `PUBLISHER_REQUIRED`   | 开发数据域只对应用成员开放                                   | 请管理员在控制台「成员」里把你加为开发者；给其他人用需要发布为线上版本 |
| `STALE_GENERATION`     | 授权或数据绑定已换代（如重新授权、恢复备份）                 | 重新打开应用，建立新会话                                               |
| `RULE_DENIED`          | 集合记录规则拒绝了本次读/写                                  | 检查 `data.policies` 的 `read`/`write` 表达式与文档内容                |
| `QUERY_NOT_AUTHORIZED` | 查询不在授权范围内（宿主白名单中的码，服务端来源**未验证**） | 检查查询条件与授权                                                     |

### 数据

| 错误码                 | 含义                                       | 处理                                                        |
| ---------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| `SCHEMA_INVALID`       | 参数或文档不符合规则（含大小、嵌套等超限） | 见本页末尾「排查：`SCHEMA_INVALID`」                        |
| `VERSION_CONFLICT`     | 乐观锁冲突，或键已存在等 409 类错误        | 重新读取最新版本再改                                        |
| `DOCUMENT_NOT_FOUND`   | 文档不存在（或 404 类错误）                | 检查文档键；读取时可用 `throwOnNotFound: false`             |
| `COLLECTION_NOT_FOUND` | 集合不存在                                 | 在 Manifest `data.collections` 声明；生产环境要单独开通集合 |
| `INDEX_REQUIRED`       | 查询需要扫描的行数超过单次上限             | 给筛选字段建索引；已有索引仍超限时缩小筛选范围              |
| `RESOURCE_NOT_READY`   | 云数据库正在开通，或数据服务还没加载本应用 | 通常一分钟内自动就绪，稍后刷新重试                          |

### 文件存储

| 错误码                | 含义                      | 处理                               |
| --------------------- | ------------------------- | ---------------------------------- |
| `FILE_NOT_FOUND`      | 文件不存在或已删除        | 检查 `fileID`                      |
| `STALE_RESOURCE`      | 条件覆盖/删除时文件已变化 | 重新 `stat` 拿到最新 etag 后再操作 |
| `STORAGE_UNAVAILABLE` | 存储服务不可用            | 稍后重试                           |

### 发布与后台调用

| 错误码                              | 含义                                               | 处理                                                                                                                                                                                          |
| ----------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FUNCTION_RELEASE_REQUIRED`         | 当前安装还没有绑定就绪的签名发布                   | 在应用窗口「权限」里允许后台运行（重新保存一次），或在控制台「版本管理」切换一次版本，平台自动补签并绑定；仍出现说明部署的发布签名不可用（联系平台管理员检查签名密钥 / 信任配置），或重新上传 |
| `RELEASE_UNAVAILABLE`               | 发布代数已变化（安装绑定了新版本），旧会话作废     | 宿主会自动重开会话并重试一次；仍失败时重新打开应用                                                                                                                                            |
| `RELEASE_NOT_READY`                 | 发布候选尚未就绪                                   | 重新发布，平台会重新签发                                                                                                                                                                      |
| `RELEASE_DISABLED`                  | 发布候选已撤回                                     | 重新上传并发布                                                                                                                                                                                |
| `RELEASE_ACTIVATION_UNAVAILABLE`    | 目标环境不存在且无法自动创建                       | 通常是部署未开放对应环境；请联系平台管理员                                                                                                                                                    |
| `RELEASE_ACTIVATION_TARGET_MISSING` | 激活目标与校验后的 Manifest 不一致（少见）         | 重新上传并安装该版本                                                                                                                                                                          |
| `NODE_LOST`                         | 执行节点失联，**结果未确认**（作业状态 `unknown`） | 不要重复提交；用 `jobId` / `invocationId` 核对                                                                                                                                                |
| `NODE_LOST_EXPIRED`                 | 节点失联且超过对账期限                             | 到控制台运行记录核对是否已产生写入，再决定是否重新提交                                                                                                                                        |
| `EXECUTION_FAILED`                  | `callFunction` 作业失败且没有更具体的错误码        | 到控制台运行记录或日志查看失败原因                                                                                                                                                            |

`callFunction` 失败时，`errCode` 优先使用作业结果里的 `errorCode`；作业状态为 `unknown` 时抛 `COMMIT_UNKNOWN`，
仍在排队/执行时抛 `CALL_TIMEOUT`（都带 `jobId`，可用 `jobs.wait` 继续等）。`capabilities.invoke` 不抛错，
失败原因在返回的 `JobResult.errorCode` 里，可能的值见 [后台调用与云函数](#后台调用与云函数)。

## 版本更新与授权登录

`zl.app`（更新管理器）和 `zl.auth`（授权登录）失败时抛出的是 `AppError`（不是 `CloudError`），只有 `errCode` 和 `message`。
详见 版本更新与授权登录（文档站 ./app-runtime#错误码）。

| errCode                 | 含义                                                     | 处理                                 |
| ----------------------- | -------------------------------------------------------- | ------------------------------------ |
| `AUTH_DENIED`           | 用户在系统授权框里点了「拒绝」，或 24 小时内拒绝过这些项 | 按未授权处理，等用户主动操作时再申请 |
| `AUTH_IN_PROGRESS`      | 授权框已打开，又发起了一次 `authorize`                   | 等上一次结果                         |
| `AUTH_GESTURE_REQUIRED` | 需要弹授权框，但不是在用户点击 / 按键之后调用            | 放到按钮点击事件里调用               |
| `AUTH_SCOPE_UNDECLARED` | 申请了 Manifest `host_api.requires` 没声明的 `user.*`    | 补上声明，重新上传                   |
| `SCHEMA_INVALID`        | `scopes` 为空或含其他值，或 `reason` 超过 60 字          | 改代码                               |
| `OPEN_IN_ZLEAP_OS`      | 不在 zleapOS 窗口里打开                                  | 部署后从启动台打开                   |
| `HOST_UNAVAILABLE`      | 宿主 15 秒内没有响应                                     | 升级 zleapOS 后重试                  |
| `RUNTIME_UNAVAILABLE`   | 通道已关闭或平台接口暂不可用                             | 稍后重试；仍失败时重新打开应用       |
| `CALL_TIMEOUT`          | 调用超时                                                 | 可以重试                             |
| `UPDATE_FAILED`         | `applyUpdate()` 切换失败                                 | 提示用户重新打开应用或到应用中心更新 |
| `UNSUPPORTED_OPERATION` | 宿主不支持这个方法                                       | 升级 zleapOS                         |

## 打开应用时的错误

应用窗口打开时，宿主为它建立运行会话。失败时应用连不上 OS：

| 原因码                            | message                                                    | next_action / 处理                                                               |
| --------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `ENV_FORBIDDEN`（环境不存在）     | 环境不可访问                                               | 「该应用还没有开通生产环境：发布为线上版本时会自动准备生产环境，稍后重试」       |
| `ENV_FORBIDDEN`（环境已停用）     | 环境不可访问                                               | 「该环境的记录已被停用，请回应用页重新加载，或在「数据权限」里重新保存一次授权」 |
| `ENV_FORBIDDEN`（部署未开放生产） | 生产 Cloud 运行能力尚未开放 / 本部署未开放生产环境         | 部署未开放生产时只能用开发环境                                                   |
| `PUBLISHER_REQUIRED`              | 环境不可访问                                               | 非应用成员打开只有开发环境的应用；发布为线上版本后才能给其他人用                 |
| `CONSENT_REQUIRED`                | 请先由宿主用户明确授权数据访问                             | 在应用窗口「权限」里勾选后保存（应用里表现为 `SCOPE_FORBIDDEN`）                 |
| `STORAGE_PROD_UNAVAILABLE`        | 生产文件存储尚未开放                                       | 部署未开放生产文件存储（应用里表现为 `SCOPE_FORBIDDEN`）                         |
| `RESOURCE_NOT_READY`              | 基础服务未就绪                                             | 环境的云资源还没接上，稍后重新打开                                               |
| `RELEASE_UNAVAILABLE`             | 运行发布版本已撤回                                         | 重新打开应用                                                                     |
| （无原因码）                      | 宿主运行会话已失效 / 运行版本已失效 / 运行会话数量已达上限 | 关掉多余窗口后重新打开                                                           |

会话建立后，每次读写还会复核：`AUTH_REQUIRED`「Cloud运行会话已失效」、`RELEASE_UNAVAILABLE`「运行发布版本已变化」、
`ENV_FORBIDDEN` / `PUBLISHER_REQUIRED`「环境授权已失效」、`CAPABILITY_FORBIDDEN`「Cloud数据能力未授权」（应用里为 `SCOPE_FORBIDDEN`）、
`STALE_GENERATION`「运行会话代数失效」。

## 数据服务原因码

数据服务（`document-core/1`）出错时，`message` 是下表的中文说明，`next_action` 是下一步；
没有列出说明的原因码，`message` 统一为「应用数据操作未完成」。业务码只保留 40300 / 40400 / 40900 / 42200 / 42900 / 50390，
其他段位（如限流的 42901）统一记为 50390——**按 `reason` 分流，不要按 `code`**。

| 原因码                          | 业务码        | message（中文说明）                                             | next_action                                      |
| ------------------------------- | ------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| `SCHEMA_INVALID`                | 42200         | 请求内容不符合集合定义                                          | 按集合定义修正字段后重试                         |
| `INVALID_FIELD`                 | 42200         | 字段名不合法                                                    | 改用字母开头的字段名后重试                       |
| `UNSAFE_NUMBER`                 | 42200         | 数值超出可安全存储的精度范围                                    | 改用字符串保存该数值后重试                       |
| `DOCUMENT_TOO_LARGE`            | 42200         | 单条文档超过大小上限                                            | 精简字段内容后重试                               |
| `DOCUMENT_TOO_DEEP`             | 42200         | 文档嵌套层数超过上限                                            | 把深层嵌套拆成多个集合后重试                     |
| `DOCUMENT_TOO_COMPLEX`          | 42200         | 单条文档的字段或元素数量超过上限                                | 精简字段后重试                                   |
| `REQUEST_TOO_LARGE`             | 42200         | 请求体超过单次上限                                              | 拆成更小的批次后重试                             |
| `QUERY_TYPE_REQUIRED`           | 42200         | 查询用到的字段缺少类型声明                                      | 在集合定义里声明该字段类型后重试                 |
| `QUERY_TOO_COMPLEX`             | 42200         | 查询条件过于复杂（嵌套层数或条件数量超限）                      | 简化查询条件后重试                               |
| `INDEX_REQUIRED`                | 42200         | 查询需要扫描的行数超过单次上限（上限 N 行）：筛选字段还没有索引 | 在管理面给该字段建索引后重试                     |
| `INDEX_REQUIRED`（已用上索引）  | 42200         | 这次查询命中的行数超过单次扫描上限（上限 N 行）：已有索引仍不够 | 缩小筛选范围（加上更精确的条件或时间区间）后重试 |
| `UNSUPPORTED_SCHEMA`            | 42200         | 集合定义里有不支持的写法                                        | 按文档修正集合定义                               |
| `UNSUPPORTED_TYPE`              | 42200         | 不支持这个字段类型                                              | 改用受支持的类型                                 |
| `UNSUPPORTED_OPERATION`         | 42200         | 不支持这个操作                                                  | 核对 SDK 文档里的操作名                          |
| `SNAPSHOT_INVALID`              | 42200         | （通用文案）快照 / 游标无效                                     | 检查 `watch` 游标                                |
| `SERVICE_NOT_CONFIGURED`        | 42200         | （通用文案）数据服务未配置                                      | 联系管理员                                       |
| `RULE_DENIED`                   | 40300         | 写入被集合规则拒绝（规则语法错误时为 42200）                    | 检查写入内容是否符合集合规则                     |
| `SCOPE_FORBIDDEN`               | 40300         | 当前用户无权访问这条数据                                        | 检查集合的可见范围配置                           |
| `AUTH_REQUIRED`                 | 40300         | （通用文案）缺少有效调用身份                                    | 重新打开应用                                     |
| `STALE_GENERATION`              | 40300 / 40900 | 数据已被回档，当前页面的数据版本已失效                          | 刷新后重试                                       |
| `DOCUMENT_NOT_FOUND`            | 40400         | 文档不存在或已被删除                                            | 刷新后重试                                       |
| `COLLECTION_NOT_FOUND`          | 40400         | 集合不存在                                                      | 先在管理面创建集合                               |
| `OPERATION_NOT_FOUND`           | 40400         | 查不到这个操作号（**不等于操作失败**）                          | 确认操作号属于当前应用                           |
| `VERSION_CONFLICT`              | 40900         | 这条文档刚被别处改过                                            | 刷新拿到最新版本后重试                           |
| `DOCUMENT_EXISTS`               | 40900         | 该文档 ID 已被占用                                              | 改用更新操作或换一个文档 ID                      |
| `COLLECTION_EXISTS`             | 40900         | 该集合已存在                                                    | 直接使用已有集合                                 |
| `IDEMPOTENCY_CONFLICT`          | 40900         | 同一个操作号被用于了不同的写入内容                              | 换一个新的操作号重试                             |
| `OPERATION_EXPIRED`             | 40900         | 操作记录已过期                                                  | 重新发起写入                                     |
| `INDEX_CONFLICT`                | 40900         | （通用文案）与已有索引冲突，或唯一索引键重复                    | 检查已有索引与数据                               |
| `POLICY_IMMUTABLE`              | 40900         | 集合的可见范围创建后不可更改                                    | 另建一个集合并迁移数据                           |
| `RESOURCE_EXHAUSTED`            | 42900         | 带数字的容量说明，如「本应用文档总数：已用 X，上限 Y」          | 清理不再需要的数据后重试                         |
| `APP_RATE_LIMITED`              | 50390         | 本应用此刻的并发请求已达上限（同时 N 个）                       | 稍后重试；持续出现可在管理面调高单应用并发上限   |
| `RESOURCE_NOT_READY`            | 50390         | 云数据库正在开通或数据面尚未加载本应用，请稍后刷新重试          | 等一分钟左右重试                                 |
| `COMMIT_UNKNOWN`                | 50390         | 提交结果尚未确认                                                | 用原操作号查询结果，不要重复提交                 |
| `CALL_TIMEOUT`                  | 50390         | 数据请求超时                                                    | 查询可能过重，缩小范围后重试                     |
| `AUTHORIZATION_UNAVAILABLE`     | 50390         | 数据权限校验服务暂时不可用                                      | 稍后重试                                         |
| `DATA_SERVICE_UNAVAILABLE`      | 50390         | 数据服务暂时不可用                                              | 稍后重试；持续出现请联系管理员                   |
| `DATA_SERVICE_RESTART_REQUIRED` | 50390         | 数据服务的配置变更需要重启后生效                                | 在管理面重启数据服务后再试                       |

`RESOURCE_EXHAUSTED` 的容量说明按 `data.quota` 区分：本应用 / 本环境 / 当前用户可见范围内的**文档数**或**数据量**，
以及集合数量、数据绑定数量、操作历史条数与占用、单次返回的数据量；字节数会换算成 MB / GB。
`data` 里同时带原始的 `quota`、`used`、`limit` 数字。

数据服务没给出具体数字时，这三类说明退回通用说法：`RESOURCE_EXHAUSTED`「数据操作所需的容量已用尽」（知道是哪类容量但缺数字时为「<类别>已达上限」）、
`INDEX_REQUIRED`「查询需要扫描的行数超过上限：筛选字段还没有索引」、`APP_RATE_LIMITED`「本应用此刻的并发请求过多」。

## 文件存储原因码

文件接口出错时 `message` 为「文件操作未完成」，原因在 `data.reason`（暂不带 `next_action`）：

| 原因码                                                                            | 业务码 | 应用里的 `errCode`   |
| --------------------------------------------------------------------------------- | ------ | -------------------- |
| `INVALID_PATH`、`CHUNK_INVALID`、`INVALID_RANGE`                                  | 42200  | `SCHEMA_INVALID`     |
| `FILE_NOT_FOUND`                                                                  | 40400  | `FILE_NOT_FOUND`     |
| `OPERATION_NOT_FOUND`                                                             | 40400  | `DOCUMENT_NOT_FOUND` |
| `VERSION_CONFLICT`、`UPLOAD_INCOMPLETE`、`UPLOAD_INTEGRITY_FAILED`                | 40900  | `VERSION_CONFLICT`   |
| `IDEMPOTENCY_CONFLICT`、`OPERATION_EXPIRED`、`STALE_GENERATION`、`STALE_RESOURCE` | 40900  | 同名透传             |
| `RESOURCE_EXHAUSTED`                                                              | 42900  | `RESOURCE_EXHAUSTED` |
| `RESOURCE_NOT_READY`、`STORAGE_UNAVAILABLE`                                       | 50390  | 同名透传             |

上传同一路径的文件时，没有 `overwrite` + `expectedETag` 就会得到 `VERSION_CONFLICT`。

## 发布与生产门禁

第一次发布带云资源的版本时，平台自动完成**应用级**生产准备：生产环境 → 签发生产发布（归属上传者）→ 生产门禁 → 生产库与生产集合，
不依赖任何人的安装。生产门禁不通过时统一返回 40900，`data` 里同时带 `reason` 和 `next_action`：

| 原因码                                                                                | next_action                                                    |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `RELEASE_NOT_READY`                                                                   | 这个发布版本还没就绪：重新发布，平台会重新签发                 |
| `RELEASE_PROOF_UNAVAILABLE`                                                           | 这个发布版本缺少可验证的签名证明：重新发布会重新签发           |
| `RELEASE_POLICY_STALE`                                                                | 发布版本记录的是旧策略：重新发布会按当前策略重新签发           |
| `RELEASE_TRUST_UNAVAILABLE`                                                           | 签名与当前信任策略对不上：重新发布，或让管理员检查发布信任配置 |
| `RELEASE_APPROVAL_EXPIRED_OR_MISSING`                                                 | 这个发布版本没有有效的生产审批：重新发布会重新签发             |
| `PRODUCTION_RELEASE_UNAVAILABLE`                                                      | 本部署没有可用的生产签发方：先配好生产签发密钥，或改用开发环境 |
| `RELEASE_DISABLED`、`RELEASE_ARTIFACT_MISMATCH`、`FUNCTION_RUNTIME_SNAPSHOT_REQUIRED` | 无（按原因码处理）；重新上传或重新发布                         |

需要知道的变化：

- 生产门禁由平台自动检查（签名证明、审批窗口、策略版本、信任根、函数运行快照、生产签发方），
  所有步骤自动完成；不通过时按上表给出原因，**重新发布会重新签发**。
- 已经发布过的版本再次发布（包括回退）直接复用当时的就绪发布，不会重新跑一遍生产准备。
- 生产不可用有两种返回：发布接口的 40300（`message` 为 `PRODUCTION_RELEASE_UNAVAILABLE`，`reason` 为
  `DEPLOYMENT_NOT_PRODUCTION` / `PRODUCTION_RELEASE_UNAVAILABLE` / `RELEASE_TRUST_UNAVAILABLE`，不带 `next_action`），
  以及生产门禁的 40900（带上表的 `next_action`）。前者是部署没开放生产，不是你写错了。
- 发布本身的其他失败（生产库未就绪、上传者账号已停用）见 [发布为线上版本](#发布为线上版本)。

## 后台调用与云函数

提交后台调用时的错误：

| 业务码 / 原因                        | message                                 | 处理                                     |
| ------------------------------------ | --------------------------------------- | ---------------------------------------- |
| 50390                                | 应用执行worker尚未启用                  | 部署未开放后台执行，联系管理员           |
| 50390 `FUNCTION_RUNTIME_UNAVAILABLE` | 应用执行需要共享调度服务                | 同上                                     |
| 40300 `FUNCTION_RELEASE_REQUIRED`    | 云函数必须绑定已验证发布                | 见 [发布与后台调用](#发布与后台调用)     |
| 40900（无原因码）                    | 同一操作编号的输入不同                  | 新调用用新的操作编号                     |
| 40900（无原因码）                    | 首次受理操作已过期                      | 用新的操作编号重新提交                   |
| 42900                                | 调用历史容量已满 / 本人后台调用队列已满 | 等在途作业结束后再提交（每人最多 16 个） |

作业结果里的 `errorCode`（`JobResult.errorCode`，宿主原样转给应用）：

| errorCode                                                                                                                            | 含义                                       |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `USER_EXCEPTION`                                                                                                                     | 函数抛出了未捕获的异常                     |
| `NODE_LOST`                                                                                                                          | 执行节点失联，结果未确认（状态 `unknown`） |
| `NODE_LOST_EXPIRED`                                                                                                                  | 失联且超过对账期限                         |
| `WORKER_INTERRUPTED`                                                                                                                 | 执行被中断                                 |
| `OUTPUT_INVALID`、`CAPABILITY_OUTPUT_INVALID`                                                                                        | 返回值不符合 `output_schema`               |
| `FUNCTION_RUNTIME_SNAPSHOT_REQUIRED`                                                                                                 | 发布缺少运行时快照，重新签发               |
| `ACTION_FAILED`、`AUTH_REVOKED`、`NOT_FOUND`、`VERSION_CONFLICT`、`SCHEMA_INVALID`、`RESOURCE_EXHAUSTED`、`DATA_SERVICE_UNAVAILABLE` | 内置动作或数据访问失败的归类               |

**云函数里**调用 `zl.cloud.os.database.query` / `mutate` 失败时抛出的错误：`error.code` 是原因码，
`error.message` 是给人看的中文说明（数据服务错误时与上面「数据服务原因码」表的说明一致，含具体数字），
可以直接放进函数返回值透给用户。函数数据网关自己的拒绝码：

| error.code                                                                                                         | 原因                                                            |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `GATEWAY_REQUEST_ID_INVALID`                                                                                       | 缺少 `request_id` 或超过 128 字符（`query` 和 `mutate` 都必填） |
| `GATEWAY_QUERY_OPERATION_UNSUPPORTED`                                                                              | 读操作只支持 `get` 和 `count`                                   |
| `GATEWAY_MUTATION_UNSUPPORTED`                                                                                     | 写操作只支持 `add` / `set` / `update` / `remove`                |
| `GATEWAY_OPERATION_ID_INVALID`                                                                                     | `operation_id` 不符合 `op_<10 位秒>_<32 位十六进制>`            |
| `GATEWAY_COLLECTION_INVALID`                                                                                       | 集合名非法或使用了保留前缀（`sys_`、`ac_`、`t_`）               |
| `GATEWAY_DOCUMENT_KEY_INVALID`、`GATEWAY_MUTATION_DATA_INVALID`、`GATEWAY_PAYLOAD_INVALID`、`GATEWAY_BODY_INVALID` | 参数类型不对                                                    |
| `GATEWAY_IDENTITY_FORBIDDEN`                                                                                       | 参数里带了身份字段（身份由平台注入）                            |
| `GATEWAY_BODY_TOO_LARGE`、`GATEWAY_RESPONSE_TOO_LARGE`                                                             | 请求或返回超过 256 KiB                                          |
| `FUNCTION_DEADLINE_EXCEEDED`                                                                                       | 已过本次调用的截止时间                                          |
| `GATEWAY_DISPATCH_FAILED`                                                                                          | 数据服务暂时不可用，请稍后重试                                  |
| `RUNTIME_GATEWAY_UNAVAILABLE`                                                                                      | 本次调用没有数据绑定，函数里不能访问数据库                      |

`zleap-app invoke` 调用的能力没在该环境启用时返回 40900 `CAPABILITY_NOT_ACTIVE`「该后台能力未在此环境启用」，
`data.next` 说明需要用户在应用窗口的「权限」里启用后台能力（开发工具不代为启用）。

## 日志

| 原因码                | 业务码 | message / next_action                                                             |
| --------------------- | ------ | --------------------------------------------------------------------------------- |
| `LOG_UNAVAILABLE`     | 50390  | 日志库正在开通，通常几十秒后可用；云函数与数据库此时已可正常调用（`next_action`） |
| `LOG_SCOPE_FORBIDDEN` | 40300  | 只有发布者能查看本应用的全部日志                                                  |
| `SCOPE_FORBIDDEN`     | 40300  | 无权读取该应用日志                                                                |
| `AUTH_CHANGED`        | 40900  | 日志授权已变化，请重新查询                                                        |

日志库没开通好**不再影响云函数执行**，只是暂时查不到日志。

## 控制台

控制台的数据、文件、日志接口沿用上面各表的原因码。另外：

| 原因码 / 文案                                       | 业务码 | 含义                                     |
| --------------------------------------------------- | ------ | ---------------------------------------- |
| 环境不可用或无访问权限                              | 40400  | 环境不存在、已停用，或你不是该应用成员   |
| `COLLECTION_NOT_DECLARED`「集合未在有效制品中声明」 | —      | 集合不在当前版本的 `data.collections` 里 |
| `POLICY_NOT_DECLARED`「集合作用域与清单声明不一致」 | —      | 集合的可见范围与 Manifest 不一致         |
| `DATABASE_NOT_DECLARED`「应用尚未声明开发数据集合」 | —      | Manifest 没有声明集合                    |
| `RESOURCE_NOT_READY`（`item: database_not_ready`）  | 50390  | 数据库还在开通                           |

## 命令行（`zleap-app`）

出错时命令行在标准错误输出一行：

```
平台错误 <code>: <message> detail=<data 的 JSON>
```

`next_action`、`reason` 都在 `detail=` 的 JSON 里。退出码：结果未知（输出含 `COMMIT_UNKNOWN`）为 **6**，其他错误为 **2**；
通过 npm 包 `@zleap-ai/app-cli` 运行但本机缺少对应平台的二进制时为 **127**。MCP 工具出错时返回 `isError: true`，
内容是 `{"status": "failed" | "unknown" | "unconfirmed", "message": "平台错误 …"}`。

`zleap-app prepare` 的特殊结果：

- 通常不需要 `prepare`（上传时自动签名、安装 / 切换版本时自动绑定），只在 `zleap-app diagnose` 提示 `next_action: app_prepare` 时兜底使用。
  它只准备开发环境：只声明数据的应用在开发权限阶段后结束，`status` 为 **`ready`**，响应里 `"environment": "dev"`；
  Manifest 声明了 headless 后台能力时，还会创建发布候选、签名并绑定到开发环境。
- 某个阶段失败时，`data` 里带 `stage`（失败的阶段）、`completed_stages`（已完成的阶段）、`cause.reason`（原因码）、
  `next`（「用app_diagnose核对当前状态；不自动重试准备写操作」），内层错误有 `next_action` 时也一并带上。
  用**同一个** `--request-id` 重试会从失败的阶段继续。
- 其他失败：42200「version_id和32位小写十六进制request_id必填」、40900「请先安装指定版本」、
  40300「只能准备本人上传的版本」（传了别人上传的 `version_id`）、
  42200「应用执行或共享调度未启用，需要平台管理员完成部署」、40900「准备结果未确认，请先诊断」。不传 `--request-id` 时命令行会自动生成。

> **`prepare` 支持哪些版本**（说明）
>
>
> 只接受**本人上传**的版本（可见性 `members`），只准备开发环境
> （开发环境 → 数据库 → 开发数据域权限，声明了 headless 时再加签名并绑定到开发环境），不会碰生产；
> 生产由**首次发布为线上版本**自动准备。因为自动签名与绑定，通常不需要它，只在 `diagnose` 提示 `next_action: app_prepare` 时兜底使用。
>

`zleap-app publish` 等写操作网络结果不明时返回 `COMMIT_UNKNOWN`，**不会自动重传**：
用 `zleap-app operation --request-id <原操作号>` 或 `zleap-app status` 查询原结果。

## 上传与 Manifest 校验

上传、`zleap-app check` 或安装时，Manifest 相关失败通过 `detail.reason` 返回：

| 原因                    | 含义                                                         | 处理                                                           |
| ----------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| `MANIFEST_UNSUPPORTED`  | `schema` 不是 `zleap.app/2`、结构/引用/执行形态无效          | 对照 Manifest（文档站 ./manifest） 逐字段核对                         |
| `SCHEMA_INVALID`        | 集合 Schema 不符合数据面契约（`detail.collection` 指出集合） | 只用集合 Schema 子集                                           |
| `RULE_DENIED`           | 集合记录规则表达式无效                                       | 修正表达式                                                     |
| `RULE_FIELD_UNDECLARED` | 记录规则引用了 Schema 未声明的字段                           | 在 Schema 顶层声明该字段                                       |
| `RUNTIME_UNAVAILABLE`   | 运行环境未开放（`builtin` UI、纯后台带函数等）               | 见 不可安装的配置（文档站 ./limits#已知会导致「应用不可安装」的配置） |
| `FEATURE_UNAVAILABLE`   | 声明了未开放的能力或写法                                     | 同上                                                           |

常见的上传失败文案（没有原因码，直接看提示）：

| 提示                                        | 原因                                              |
| ------------------------------------------- | ------------------------------------------------- |
| 应用包根目录必须包含非空 LICENSE 文件       | 缺少 `LICENSE` 或内容为空                         |
| manifest entry 必须指向存在的包内 HTML 文件 | `entry` 不是包内 `.html`/`.htm`，或文件不存在     |
| 该版本已经存在，请更换版本号                | 同版本号、内容不同                                |
| 云函数制品入口缺失                          | 函数 `entry` 在包里不存在                         |
| 应用包不在开发会话授权范围                  | 包里的 `appid` 与 `zleap-app auth login` 时不一致 |

### 应用与成员

用 `appid` 的应用，上传和成员管理按应用成员判权：

| 业务码 | message                    | `detail.reason`  | 处理（`next_action`）                                  |
| ------ | -------------------------- | ---------------- | ------------------------------------------------------ |
| 40400  | appid 不存在               | `APP_NOT_FOUND`  | 先在云开发控制台「创建应用」                           |
| 40300  | 你不是这个应用的开发者     | `NOT_APP_MEMBER` | 请联系应用管理员在云开发控制台「成员」里把你加为开发者 |
| 40300  | 只有应用管理员可以管理成员 | —                | 请管理员添加、移除成员或修改角色                       |
| 40900  | 应用至少要保留一位管理员   | —                | 先把另一位成员设为管理员，再做这个操作                 |

成员管理见 [成员管理](console-members.md)。

### 发布为线上版本

控制台「版本管理」发布 / 回退（`POST /api/v1/app-cloud/apps/{app_id}/publish`）：

| 业务码 | message                                 | `detail.reason`           | 处理（`next_action`）                                                             |
| ------ | --------------------------------------- | ------------------------- | --------------------------------------------------------------------------------- |
| 40900  | 生产数据库还没就绪，暂时不能发布        | `PROD_DATABASE_NOT_READY` | 通常 1 分钟内就绪，稍后在版本管理里重新发布；持续失败请在控制台「数据库」查看状态 |
| 40900  | 这个版本的上传者账号已停用，无法发布    | `UPLOADER_INACTIVE`       | 请其他成员重新上传这个版本（npm run deploy）后再发布                              |
| 40400  | 版本不存在或已删除 / 该版本没有可用制品 | —                         | 刷新版本列表后重试                                                                |
| 42200  | 发布说明最多 500 字                     | —                         | 缩短发布说明                                                                      |
| 40400  | 应用不存在，或你不是这个应用的成员      | —                         | 请联系应用管理员在云开发控制台「成员」里把你加为开发者                            |

任一成员都可以发布任一版本，不要求上传者正在使用这个版本。带云资源（集合、`cloud.*` 能力、`runtime.backend` 或 headless 能力）的版本**第一次**发布时，
平台自动完成应用级生产准备（生产环境 → 签发生产发布 → 生产门禁 → 生产库与生产集合），`PROD_DATABASE_NOT_READY`、`UPLOADER_INACTIVE` 只在这一步出现；
生产门禁不通过时返回 [发布与生产门禁](#发布与生产门禁) 表中的原因码（如 `RELEASE_APPROVAL_EXPIRED_OR_MISSING`、`RELEASE_POLICY_STALE`、`PRODUCTION_RELEASE_UNAVAILABLE`），重新发布即会重新签发。
已经发布过的版本再次发布（包括回退）直接复用当时的就绪发布。见 [版本管理 · 带云资源的版本](console-release.md#带云资源的版本)。

## 版本更新与回滚

### 版本切换（控制台「切换到此版本」/ CLI `update`、`rollback`）

这些码来自安装版本切换接口（`appversion/read.go`、`official.go`、`apply.go`）：

| 业务码 | message                          | `detail.reason`                | 处理                                                                                           |
| ------ | -------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| 42200  | 应用没有可切换的版本             | `VERSION_LIST_EMPTY`           | 该应用还没有任何有效版本，或你的账号看不到任何版本；先在控制台「版本管理」确认已有上传，再刷新 |
| 42200  | 官方版本切换必须指定当前安装版本 | `EXPECTED_VERSION_REQUIRED`    | 请求里带上当前安装的版本 ID（CLI 用 `--expected-version-id`），不要省略                        |
| 40900  | 安装版本已变化                   | `INSTALLATION_VERSION_STALE`   | 你带来的「当前版本」与安装记录不一致；重新读取安装状态后，用最新的版本 ID 再操作               |
| 40900  | 安装版本已变化                   | `INSTALLATION_VERSION_CHANGED` | 提交期间安装被其他操作改掉了；刷新后重新读取，再决定是否重试                                   |

`INSTALLATION_VERSION_STALE` 在写入前检查就失败；`INSTALLATION_VERSION_CHANGED` 是写入时的并发校验失败（CAS 没命中）。
两者都**不要用旧的版本 ID 盲目重试**，先 `zleap-app diagnose` 或在控制台刷新安装状态。

### 应用中心「更新」的预检

| 原因码                           | 级别 | 界面文案                                                       |
| -------------------------------- | ---- | -------------------------------------------------------------- |
| `RELEASE_NOT_PUBLISHED`          | 阻断 | 该版本尚未签发发布：切过去后云函数等后台能力无法激活。         |
| `COLLECTION_PARTITION_IMMUTABLE` | 阻断 | 集合作用域（私有/共享）不可变更，开通会被数据面拒绝。          |
| `COLLECTION_SCHEMA_NOT_APPLIED`  | 提醒 | 已存在集合的结构不会更新，新版本若依赖新字段可能被旧约束拒绝。 |
| `COLLECTION_NO_LONGER_DECLARED`  | 提醒 | 新版本不再声明该集合；已建集合不会被删除，数据仍在。           |
| `CAPABILITY_CONSENT_REQUIRED`    | 提醒 | 这些能力的权限变宽，需要你重新确认后才能继续调用。             |
| `CONTINUITY_UNKNOWN`             | 提醒 | 旧版本清单不可解析，本次升级将撤销全部后台能力授权。           |
| `DATA_DELTA_UNKNOWN`             | 提醒 | 数据声明无法比对，请人工确认集合变更。                         |

`VERSION_NOT_AVAILABLE` 不在这张预检表里：它是「更新」页读取可切换版本列表时的**前端阻断**（`upgrade-model.ts`），
表示目标版本不在当前账号可见的版本列表里，界面文案为「该版本当前不可切换（可能已下架或不可见）。」

> **预检阻断只是提示**（注意）
>
> 实测预检返回「阻断」（`can_upgrade: false`）时，直接调用升级接口仍会执行。应用中心界面会按预检拦住，
> 用接口或脚本升级时请自己先检查预检结果。

### `zleap-app update` / `rollback`

| 错误                      | 含义                                                                             | 处理                                           |
| ------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- |
| `DATA_MIGRATION_REQUIRED` | 新旧版本的 `data` 或 `storage` 声明不同，未切换版本（409，原因码在提示文字开头） | 工具不做数据迁移；保持声明一致，或自行规划迁移 |
| 当前版本已变化            | `--expected-version-id` 与实际安装不一致                                         | 用 `zleap-app versions` 核对后重试             |

> **`DATA_MIGRATION_REQUIRED` 只来自开发工具**（说明）
>
> 这个码由 CLI/MCP 的版本切换接口返回。应用中心的「更新」走上面的预检流程，Schema 变化只是提醒，分区变化才阻断。

## 发布签名

平台在上传带后台能力的版本时自动签发开发发布，首次发布为线上版本时自动签发生产发布。
签发或验签失败时按原因码归类返回：

| 服务端原因码                                                                      | 含义                                                                     |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `RELEASE_PROOF_TOO_LARGE`                                                         | 证明文件超过 2 MiB 限制                                                  |
| `RELEASE_PROOF_INVALID`                                                           | 证明 JSON 或签名信封无效                                                 |
| `RELEASE_IDENTITY_MISMATCH`、`RELEASE_DIGEST_MISMATCH`、`RELEASE_SOURCE_MISMATCH` | 证明与当前应用、发布、包、来源、摘要或策略不匹配                         |
| `RELEASE_SIGNATURE_INVALID`                                                       | 无法验证发布签名                                                         |
| `RELEASE_ARTIFACT_MISMATCH`、`RELEASE_MANIFEST_MISMATCH`                          | 签名 Manifest 或包制品清单不匹配                                         |
| `RELEASE_POLICY_STALE`                                                            | 策略审核已过期或不是当前策略                                             |
| `RELEASE_POLICY_UNAVAILABLE`                                                      | 尚未配置发布策略，无法验证                                               |
| `RELEASE_TRUST_UNAVAILABLE`                                                       | 发布信任策略尚未配置，或发布者密钥不可用、已撤销或已过期；由管理员检查   |
| `RELEASE_DISABLED`                                                                | 发布候选已撤回                                                           |
| 其他                                                                              | 签名验证请求被拒绝                                                       |

签发时的 `RELEASE_POLICY_UNAVAILABLE`、`RELEASE_TRUST_UNAVAILABLE` 属于**部署未配置**；
发布生产版本时的 `RELEASE_TRUST_UNAVAILABLE` 则表示这个发布的签名与当前信任策略对不上，重新发布即可（见 [发布与生产门禁](#发布与生产门禁)）。

## 触发器与事件

启用触发器时与 Manifest 逐项比对，不一致即拒绝。详见 触发器（文档站 ./triggers）。

| 错误码                            | 含义                                                       | 处理                                  |
| --------------------------------- | ---------------------------------------------------------- | ------------------------------------- |
| `TRIGGER_MODE_NOT_DECLARED`       | `background.modes` 缺少对应模式                            | 补上 `scheduled` / `events`           |
| `TRIGGER_NOT_DECLARED`            | 触发器 `id` 不存在、重复，或 `capability` 不匹配           | 逐字核对 Manifest                     |
| `TRIGGER_POLICY_UNSUPPORTED`      | `overlap` / `misfire` 不是 `forbid` / `skip`               | 改为支持的值或删除                    |
| `TRIGGER_SCHEDULE_MISMATCH`       | cron 与声明不一致                                          | 确认安装的是修改后的版本              |
| `TRIGGER_TIMEZONE_MISMATCH`       | 时区与声明不一致                                           | 声明里显式写 `timezone`               |
| `TRIGGER_SCHEDULE_INVALID`        | cron 或时区无法解析                                        | 五段 cron + IANA 时区名               |
| `TRIGGER_EVENT_INVALID`           | 事件名非法                                                 | 匹配 `^[a-z][a-z0-9_.]{0,63}$`        |
| `TRIGGER_EVENT_MISMATCH`          | 事件名与声明不一致                                         | 逐字核对                              |
| `EVENT_NOT_DECLARED`              | 事件未在 `subscribes` 里恰好声明一次                       | 补上声明                              |
| `EVENT_DECLARATION_AMBIGUOUS`     | 同一事件条目的 `id` 与 `name` 不一致                       | 只写一个，或写成相同                  |
| `EVENT_INPUT_INVALID`             | 运行参数不是 JSON 对象                                     | 改成对象                              |
| `EVENT_INPUT_TOO_LARGE`           | 运行参数超过 8 KiB                                         | 缩小参数                              |
| 「应用数据请求参数无效」（42200） | 触发器 `id` 含 `-` 等字符，不匹配 `^[a-z][a-z0-9_]{0,63}$` | 改 Manifest 里的 `id`（上传时不检查） |

## 宿主能力（`host_api`）的数字码

`clipboard.write`、`workspace.files` 等宿主通道返回数字错误码：

| 码      | 含义                           |
| ------- | ------------------------------ |
| `42200` | 请求格式不合法                 |
| `40300` | 访问被拒绝，或未声明该宿主能力 |
| `40900` | 请求编号重复使用               |
| `40901` | 版本冲突                       |
| `42900` | 并发请求过多                   |
| `50300` | 请求超时                       |

## 已不再出现的错误

2026-10 以来这些错误已经去掉，旧文章或旧截图里还能看到：

| 以前的错误                                                                               | 现在                                                       |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 控制台首次打开时 40400「本人开发数据绑定不存在」                                         | 环境还没有数据时显示空列表 /「未开通」                     |
| 控制台生产环境 40300「生产数据管理尚未开放」（`ENV_FORBIDDEN`）                          | 生产环境的数据、文件可以在控制台管理（页面有影响范围提示） |
| 日志库未开通导致云函数执行失败（`LOG_UNAVAILABLE` / `TELEMETRY_ALLOCATION_UNAVAILABLE`） | 云函数照常执行，只是暂时查不到日志                         |
| 写入时偶发 `DATA_SERVICE_UNAVAILABLE`（数据绑定缺少身份记录）                            | 平台自动补建，不再报错                                     |
| 数据库已存在但数据服务尚未加载时 `RESOURCE_NOT_READY`                                    | 按专属库是否存在判定，已开通的库直接可用                   |

## 状态值

### 资源与环境

| 状态            | 控制台文案 |
| --------------- | ---------- |
| `unprovisioned` | 未分配     |
| `provisioning`  | 开通中     |
| `ready`         | 已就绪     |
| `failed`        | 失败       |
| `unavailable`   | 暂不可用   |

开发环境本身显示「已登记」/「已停用」。数据库开通失败时，「重试会继续原来的开通请求，不会重复创建资源。」
云函数与日志的状态由事实推导：应用有任意一个就绪的发布时为「已就绪」，否则为「未分配」。

### 发布候选

发布候选由平台自动创建和签名，不需要手动操作。

| 状态         | 控制台文案 |
| ------------ | ---------- |
| `draft`      | 草稿       |
| `validating` | 校验中     |
| `ready`      | 已就绪     |
| `disabled`   | 已撤回     |

只有「已就绪」的候选可以用于发布。生产门禁评估结论：`eligible`「等待 Provider 复核」、
`blocked`「已阻断」、`invalid`「不可用」。

### 后台作业

| 状态               | 控制台文案 | 说明                         |
| ------------------ | ---------- | ---------------------------- |
| `accepted`         | 已受理     | 未结束                       |
| `queued`           | 排队中     | 未结束                       |
| `running`          | 执行中     | 未结束                       |
| `cancel_requested` | 取消确认中 | 未结束                       |
| `succeeded`        | 执行成功   |                              |
| `failed`           | 执行失败   | 看 `errorCode`               |
| `cancelled`        | 已取消     |                              |
| `unknown`          | 结果未知   | 不要重复提交，按作业编号查询 |
| `revoked`          | 授权已撤销 |                              |

## 排查：应用显示不可用、装不上

原因几乎都在 `manifest.json`，见
已知会导致「应用不可安装」的配置（文档站 ./limits#已知会导致「应用不可安装」的配置）。
最快的办法：本地运行 `zleap-app check <目录>`，它和服务端使用同一套校验。

## 排查：`SCOPE_FORBIDDEN`

按顺序检查：

1. **应用装好了吗？** 安装时会授予该版本声明的 `requires`；只上传不安装没有任何权限。
2. **Manifest 声明了吗？** `runtime.capabilities.requires` 里有对应能力，集合在 `data.collections` 里。
3. **应用窗口里的授权勾上了吗？** 点应用窗口顶部「权限」，在「应用权限」对话框里勾选数据读/写、文件读/写，保存后应用会重新加载。
   还有声明了却没授权的项时，这个对话框会在打开应用时自动弹出。
4. **环境对吗？** 开发和生产分开授权；部署未开放生产时只能用开发环境，生产文件存储未开放时生产里不能读写文件。
5. **版本是当前安装的版本吗？** 切换版本后旧会话作废，重新打开应用。
6. **云函数里报的？** 检查该 provider 的 `permissions.data[].actions` 和 `fields`。

## 排查：`SCHEMA_INVALID`

**这是数据问题，不是权限问题。** 检查：

1. 字段是否都在集合 Schema 的 `properties` 里（没写 `additionalProperties` 时按 `false` 处理）；
2. `required` 字段是否都提供了，类型、长度、`enum` 是否匹配；
3. `x-agentos-value-type: "date_ms"` 字段，前端是否传了 `Date` 对象；
4. 文档大小、嵌套、字段名是否超限（在应用里这些也表现为 `SCHEMA_INVALID`）；
5. 参数结构是否符合 SDK 要求（SDK 本地检查不通过也报 `SCHEMA_INVALID`）。

控制台和日志里能看到服务端的中文说明（如「单条文档超过大小上限」），比应用里的 `SCHEMA_INVALID` 更具体。

## 相关

- Manifest v2 配置（文档站 ./manifest） — 字段与校验规则
- 平台边界与限制（文档站 ./limits） — 数值上限
- [权限与授权](permissions.md) — 权限问题排查
- 术语表（文档站 ./glossary） — 名词解释
