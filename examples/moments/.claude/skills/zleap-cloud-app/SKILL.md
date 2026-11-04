---
name: zleap-cloud-app
description: Build, modify, debug and deploy zleapOS 云开发 (App Cloud) apps — manifest.json with "schema":"zleap.app/2", Cloud SDK (zl.cloud database / files / callFunction), sandboxed iframe UI, and the zleap-app CLI (check / pack / publish / install / diagnose). Use when a project contains a zleap.app/2 manifest or src/zleap-sdk, imports zl from the zleap SDK, or the user mentions zleapOS, 云开发, App Cloud, 应用中心, 云开发控制台, create-zleap-app or zleap-app, or asks to create a new zleapOS app.
---

# zleapOS 云开发应用：开发、调试、部署到自己桌面

zleapOS 云开发应用 = 一个网页（运行在 zleapOS 桌面的沙箱 iframe 里）+ 一份 `manifest.json`。
数据库、文件、后台任务都由平台代管，前端通过 Cloud SDK 调用。上线到生产、给同事用、云函数签名激活，见 skill `zleap-cloud-app-release`。

## 0. 先判断项目形态

| 看到 | 说明 | 构建/打包目录 |
| --- | --- | --- |
| `vite.config.ts` + `src/cloud/` + `scripts/zleap.mjs` | create-zleap-app 的 React 模板（推荐） | `dist/`（构建产物） |
| 根目录 `index.html` + `main.js` + `sdk/` | `zleap-app init hosted-package` 的原生模板 | 项目根目录 |
| 都没有 | 新建项目，见第 1 节 | — |

两种形态的 SDK 是同一套 API，只是来源不同：React 模板从 npm 包 `@zleap-ai/app-sdk` 导入（`/host` 宿主能力、`/workspace` 工作区），
以 `node_modules/@zleap-ai/app-sdk/dist/types/*.d.ts` 为准，并与 `@zleap-ai/app-cli` 保持同版本；原生模板用项目里的 `./sdk/*.js`。
参考资料里写 `./sdk/index.js` / `./sdk/zleap-sdk.js` 的地方，在 React 模板里分别对应 `@zleap-ai/app-sdk` / `@zleap-ai/app-sdk/host`。

## 1. 新建项目（非交互，适合 AI 执行）

```bash
npm create zleap-app@latest <目录> -- --appid <appid> --name "<应用名>" -y
# 已知 OS 地址时加：--target https://os.example.com
```

`appid` 由平台生成，**不能自己编**：请用户先在云开发控制台侧栏顶部的应用切换下拉里点「创建应用」（填名称），复制生成的 `appid`
（`zl` + 16 位小写十六进制，如 `zl3f9a2c7e1b0d4a68`），创建者自动成为管理员。没有 `appid` 时非交互脚手架会报错并提示先创建应用——问用户要，不要猜。
manifest 里写 `"appid": "<appid>"`，**不需要** `app_key` 和 `publisher`。旧项目的 `app_key`（如 `com.example.todo`）只为已有应用保留；`--app-key` 是 `--appid` 的旧别名。
同事要一起开发，请管理员在控制台「团队」→「成员」里把他加为开发者。每个成员的每次上传都是一个开发版本，在控制台「版本管理」里可见；
成员可以用「我也用这个」运行同事上传、未发布的版本（非成员看不到开发版本）。给全企业用 = 在「版本管理」里「发布为线上版本」，见 skill `zleap-cloud-app-release`。

## 2. 硬性约束（违反就会在运行时失败）

1. **一切先在 manifest 声明**：集合 `data.collections` + 结构 `data.schemas`；权限 `runtime.capabilities.requires`。没声明的拿不到。
2. **集合结构上线即固定**：已建集合不随新版本更新 Schema；`additionalProperties` 缺省按 `false`；集合键 `^[a-z][a-z0-9_]{0,63}$`，不能用 `sys_`/`ac_`/`t_` 前缀。要改字段 → 新集合 + 迁移。动手改 schema 前先告诉用户这一点。
3. **沙箱**：opaque origin，CSP `connect-src 'none'`、`worker-src 'none'`、脚本/样式/字体只能来自包内。所以：不能 `fetch`/XHR/WebSocket、不能用 CDN 或在线字体、不能用 `localStorage`/`sessionStorage`/`indexedDB`、不能 `alert/confirm/prompt`、不能开 Worker、不能弹新窗口。状态放内存或云数据库。
4. **环境由宿主决定**：`zl.cloud.init({ env: zl.cloud.DYNAMIC_CURRENT_ENV })`，绝不写死 `'dev'`/`'prod'`。
5. **读取上限**：单次 `limit` ≤ 100，`skip` ≤ 1000，用分页；查询有筛选/排序但没索引时可能 `INDEX_REQUIRED`。
6. **乐观锁**：`update`/`remove` 带 `agentos: { expectedVersion: doc._version }`；冲突 `VERSION_CONFLICT` → 重读再改。
7. **结果未知不重试**：`COMMIT_UNKNOWN`（CLI 退出码 6）→ 先重读或查询原操作，绝不自动重复提交。
8. **明确失败优于假成功**：不要用 mock 数据、假登录、吞错误让界面「看起来能用」。浏览器直接打开（`npm run dev`）时 SDK 连不上宿主是正常的。
9. **凭据**：登录只能由用户在浏览器确认（`npm run login`），不要索要或输入密码，不要读取/打印 `~/.config/zleap-app/session.json`。

## 3. 开发一个功能的标准流程

1. **建模**：在 `manifest.json` 加集合与 strict schema（类型只支持 object/array/string/number/integer/boolean/null，关键字子集见 references/manifest.md）。日期用 `number` 存毫秒，或 `integer` + `"x-agentos-value-type": "date_ms"`。
2. **权限**：需要的能力加进 `requires`（`cloud.database.read/write`、`cloud.storage.read/write`、`os.agent.complete` 等，白名单外的非可选能力会让应用「暂不可用」）。`reason` 会展示给用户，写具体用途。
3. **数据层**：React 模板在 `src/cloud/` 下按集合写一个模块（参照 `src/cloud/todos.ts`），组件只调用这些函数；错误用 `describeError()` 展示。
4. **本地验证**：`npm run typecheck && npm run check`（`check` 通过只代表静态契约，`runtime_test=not_checked`）。
5. **部署到自己桌面**：`npm run deploy`（构建 → 检查 → 上传 private → 安装/切换本人安装；内容变化时自动递增补丁号）。
   - 报未登录/会话过期 → 请用户运行 `npm run login -- --target <OS 地址>` 并在浏览器核对确认码。
   - 报 `DATA_MIGRATION_REQUIRED` → 新版本改了 data/storage 声明，见第 5 节。
6. **请用户验收**：安装时平台会自动创建开发环境、开通数据库并按声明建集合，`npm run deploy` 结束时会打印状态；显示未就绪时，请用户在「云开发控制台」选中应用 →「概览」按提示处理。然后从启动台打开应用（已打开的点「重新加载应用」）。
7. **排查**：`npm run status`（安装、权限、版本）、`npm run logs`（24h 页面结构化错误 + 本人云函数日志，自动选当前所在环境）、控制台「运行体检」。

`npx zleap-app …` 只在装了 `@zleap-ai/app-cli` 的项目里可用；项目外或原生模板（没有 package.json）请用 `npx @zleap-ai/app-cli …`。原生模板没有 npm 脚本时，用 CLI 等价命令：`npx @zleap-ai/app-cli check .`、`publish .`、`install <app_id>`、`diagnose <app_id>`、`update <app_id> --expected-version-id <当前> --version-id <新>`。

### 版本更新提示与授权登录（不需要云资源）

- **提示新版本**：`zl.app.getUpdateManager()` → `onCheckForUpdate` / `onUpdateReady` / `onUpdateFailed` / `applyUpdate()`（切到线上版本并重新加载）。
  非成员下次打开时宿主会自动跟随线上版本，这里只是让开着的窗口也能及时更新。提示 UI 要自己画（沙箱里不能用 `confirm`）。
- **拿用户信息**：先在 manifest `host_api.requires` 声明 `user.profile` / `user.phone` / `user.email`（没声明 `AUTH_SCOPE_UNDECLARED`），
  再在**按钮点击事件里**调用 `zl.auth.authorize({ scopes: ['profile' | 'phone' | 'email'], reason: '用途说明' })`（不在点击里调用 `AUTH_GESTURE_REQUIRED`），
  返回 `{ openid, scopes, profile?, phone?, email? }`——用户可以只勾选一部分、没绑定的不返回，**以 `scopes` 判断拿到了什么**；
  拒绝时 `AUTH_DENIED`（拒绝过的项 24 小时内不再弹框，直接 `AUTH_DENIED`）。`zl.auth.getIdentity()` 静默拿 `openid`（每个应用不同、开发与线上一致）。
  云函数里用 `zl.cloud.auth.getOpenId()` / `getUserInfo()`；不要用 `getContext().userId`（平台内部 ID，已废弃）。
  不要自己做登录页或索要账号；云函数里目前读不到授权信息。
- 都从 `@zleap-ai/app-sdk` 导入（`import { zl, AppError } from '@zleap-ai/app-sdk'`），完整说明见 references/app-runtime.md。

## 4. 只有用户能做的事（明确告诉用户，不要假装已完成）

| 事项 | 在哪里 | 真实文案 |
| --- | --- | --- |
| 浏览器授权登录 | `npm run login` 打开的网页 | 核对确认码后允许 |
| 开发环境未自动创建时 | 云开发控制台 → 概览 | 「创建开发环境」 |
| 创建应用拿 `appid` | 云开发控制台 → 侧栏顶部应用切换下拉 | 「创建应用」 |
| 添加协作开发者 | 云开发控制台 →「团队」→「成员」（管理员） | 「添加成员」，输入登录名、手机号或邮箱 |
| 调整数据/文件/后台权限 | 应用窗口顶部 | 「权限」→「应用权限」对话框 →「保存并重新加载」（KV / 空间 / 通知在底部「管理其他权限」） |
| 看数据、建索引、备份 | 云开发控制台 → 数据库 | 「同步 Manifest 中的集合」、索引页 |
| 签名、激活、上生产、分享 | 见 skill `zleap-cloud-app-release` | — |
| 发布为线上版本 / 回退（appid 应用） | 云开发控制台 →「发布」→「版本管理」 | 「发布为线上版本」/「回退到此版本」 |
| 用户授权头像昵称 / 手机号 / 邮箱 | 应用里调用 `zl.auth.authorize` 后的系统授权框 | 「允许」；撤销在窗口顶部「已授权信息」 |

## 5. 常见问题速查

**先读错误本身。** CLI 出错时打印 `平台错误 <code>: <message> detail=<JSON>`：`message` 是中文说明（数据类错误会带具体上限、已用量），
`detail` 里的 `reason` 是稳定错误码，`next_action` 是平台给的下一步——有 `next_action` 就照它做，不要自己猜。
应用（iframe）里只拿得到 `errCode`，看不到这些说明；要看原文去控制台日志或用 CLI 复现。CLI 退出码：6 = 结果未知，2 = 其他错误。


| 现象 / 错误码 | 原因与处理 |
| --- | --- |
| 连接超时 `CALL_TIMEOUT`、独立预览 | 不在 zleapOS 窗口里运行；部署后从启动台打开 |
| `RESOURCE_NOT_READY` / SDK 没协商到 `document-core/1` | 当前数据域没有环境或数据库未就绪 → 等 1 分钟后重开应用；仍不行请用户在控制台概览检查开发环境与数据库 |
| `SCOPE_FORBIDDEN` | 没授权（服务端原因 `CONSENT_REQUIRED` 等）→ 请用户点窗口顶部「权限」勾选保存；或 `requires` 没声明 |
| `ENV_FORBIDDEN` | 部署已开放生产、应用还没有生产环境，非发布者打不开 → 发布者激活到生产（见 release skill） |
| `COLLECTION_NOT_FOUND`（上生产后） | 生产环境建了但没开通集合 → 控制台生产环境「数据库」开通，或 `npx zleap-app prepare` |
| `PUBLISHER_REQUIRED` | 非发布者访问开发数据域（默认只给发布者） |
| `SCHEMA_INVALID` | 写入字段与集合结构不符（缺必填、类型错、多了字段） |
| `VERSION_CONFLICT` | 别处先改过，重读后再改 |
| `INDEX_REQUIRED` | 给筛选/排序字段建索引（必填的数字/日期，或 maxLength ≤ 191 的字符串；每集合 ≤ 4 个）；已有索引仍超限 → 缩小筛选范围 |
| `APP_RATE_LIMITED` | 本应用并发请求过多（默认同时 8 个）→ 稍后重试，别循环重试 |
| 应用中心显示「暂不可用」 | 非可选 requires 超出白名单、`host_api` 写了白名单外的值、声明了 `agent.interaction` 等 |
| 上传「该版本已经存在，请更换版本号」 | 同版本号不同内容；改 `version`（`npm run deploy` 会自动处理） |
| `DATA_MIGRATION_REQUIRED` | 改了 data/storage 声明，CLI 拒绝切换。开发期可 `npx zleap-app uninstall <app_id>` 后重新 `npm run deploy`（卸载保留数据）；已建集合结构仍不会变 |
| 上传 40400「appid 不存在」（`APP_NOT_FOUND`） | `appid` 没在控制台创建或抄错 → 请用户在云开发控制台「创建应用」后复制 |
| 上传 40300「你不是这个应用的开发者」（`NOT_APP_MEMBER`） | 当前登录账号不是应用成员 → 请应用管理员在控制台「成员」里把他加为开发者 |
| 「manifest 的 appid 与 app_key 不一致」 | 两个字段都写了且不同 → 只保留 `appid` |

完整错误码：references/status-codes.md。

## 6. 参考资料（按需读取，别一次全读）

- references/manifest.md — Manifest v2 全字段、集合 Schema 子集、分区与记录规则、打包规则
- references/sdk-database-files.md — Cloud SDK：初始化与 profile、查询/写入/watch/onChange、文件上传下载、操作编号、COMMIT_UNKNOWN
- references/cloud-functions.md — 云函数、headless 能力、`os.agent.complete`、`capabilities.invoke` / `jobs.wait`
- references/triggers.md — 定时 / 事件触发器
- references/permissions.md — 安装授权、应用窗口「权限」（Cloud 数据授权）、数据域、后台能力授权
- references/console-database.md — 控制台数据库页（索引、备份恢复、筛选）
- references/console-members.md — 控制台「创建应用」拿 appid、成员与角色、上传时的成员校验
- references/app-runtime.md — `zl.app.getUpdateManager()` 版本更新、`zl.auth.authorize()` 授权登录、openid、AppError 错误码
- references/limits.md — 数值上限与平台未开放的能力
- references/status-codes.md — 状态与错误码

可选：支持 MCP 的工具可以接入同一 CLI 的 MCP 服务（工具 `app_spec_get`、`app_check`、`app_publish`、`app_diagnose` 等）：
`npx -y @zleap-ai/app-cli mcp serve --workspace <项目绝对路径> --target <OS 地址>`（需先在终端 `auth login`）。
