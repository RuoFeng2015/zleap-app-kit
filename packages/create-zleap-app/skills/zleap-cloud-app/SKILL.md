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
| `vite.config.ts` + `src/cloud/` + `scripts/zleap.mjs` | create-zleap-app 的 React 模板（组件化、复杂界面） | `dist/`（构建产物） |
| `package.json` 里 `"zleap": { "packageDir": "app" }` + `app/main.js` + `scripts/zleap.mjs` | create-zleap-app 的 vanilla 模板（原生 HTML/JS，不用构建，表单 / 列表 / 统计类首选） | `app/` |
| 根目录 `index.html` + `main.js` + `sdk/`，没有 package.json | `zleap-app init hosted-package` 的原生模板 | 项目根目录 |
| 都没有 | 新建项目，见第 1 节 | — |

几种形态的 SDK 是同一套 API，只是来源不同：React 模板从 npm 包 `@zleap-ai/app-sdk` 导入（`/host` 宿主能力、`/workspace` 工作区），
以 `node_modules/@zleap-ai/app-sdk/dist/types/*.d.ts` 为准（SDK 与 `@zleap-ai/app-cli` 各自独立发版，版本号不必相同）；vanilla 模板用 `app/sdk/*.js`（`npm install` / `npm run deploy` 从同一个 npm 包复制，不要手改）；原生模板用项目里的 `./sdk/*.js`。
参考资料里写 `./sdk/index.js` / `./sdk/zleap-sdk.js` 的地方，在 React 模板里分别对应 `@zleap-ai/app-sdk` / `@zleap-ai/app-sdk/host`。

## 开发路线：先查现成能力，再补云函数（所有模板都一样）

React 模板、vanilla 模板、原生模板走同一条路线。目的是不重复造轮子、少踩运行时限制：

1. **先查当前用户能用什么**（项目里已配好 MCP 服务 `zleap-app`，见 `.mcp.json`；没登录时 MCP 工具会报未登录，请用户先 `npm run login`）：
   - 当前会话没有加载 MCP 工具时，用等价的命令行（都在项目目录运行）：`npx zleap-app business search --query 待办`、
     `npx zleap-app business get --operation "GET /api/v1/todos"`、`npx zleap-app business call --operation "POST /api/v1/todos" --input-file in.json --dry-run`
     （`in.json` 按 `business get` 返回的 `input_schema` 写，形如 `{"query": {...}}` / `{"body": {...}}`）；
   - `os_business_search(query)`：按需求搜索当前账号有权限的 OS 接口（待办、文件、日程、项目、AI 生成文字、定时任务……），中文、英文关键词各搜一次。**先看返回的 `page_api.enabled`**：`false` 表示这个部署没开放页面 API，页面里 `api.fetch` 一律失败，改用 SDK 能力、集合或云函数，并告诉用户；
   - `os_business_get(operation)`：读契约和页面写法 `page_call`（`page_unavailable` 非空表示页面不能直接调，结果里给替代方案）。操作键是「方法 + 完整路径」，如 `POST /api/v1/agents/complete`，写错时报错里会给出可能的键；字段的取值和单位看 Schema 里的 `description`（如待办 `status` 只有 todo / done，OS 接口的时间是**秒级**时间戳，而 `Date.now()` 和云数据库是毫秒）；
   - `os_business_call(operation, input)`：用用户自己的账号试调。读接口直接调；**写 / 删接口先传 `dry_run: true`**（只校验参数、预览请求，不写数据），真正调用会改用户的真实数据，要调就先告诉用户、试完删掉；
   - 页面里要 AI 生成内容：用 `POST /agents/complete`（要 JSON 传 `output_schema`，结果在 `data.result`；涉及日期把今天和两周日历写进提示词；Schema 会随 system 发给模型，可选值用 `enum` 限定、代码再核对；模型耗时波动大，界面写「通常 30–90 秒」并显示已等待秒数，`timeout_ms` 是整次上限（服务端最多 110 秒，超时 40049、`data.reason=timeout`），`max_retries` 0–1，失败给「重试」按钮；生成不写数据，超时提示「生成超时」即可，不要说「保存结果未知」）。没有页面参与（定时、触发器）才用后台能力 `os.agent.complete`。写法见文档「Cloud SDK 使用 → 调用 AI 生成内容」；
   - `app_capabilities_search` / `app_capability_get`：平台后台能力；`app_sdk_get` / `zleap://sdk/guide`：SDK 能力与类型；`app_spec_get(section=model)`：Manifest 字段。
2. **OS 已有的数据和功能直接用**：页面里 `zl.cloud.os.api.fetch('/路径')`（不带 `/api/v1`），按使用者权限执行，不要在应用里另存一份。
   `api.fetch` 不依赖云环境：**只调 OS 接口、没有集合 / 云函数 / 云文件的应用，不要调用 `zl.cloud.init` 和 `zl.cloud.os.ready()`**（这类应用平台不准备云环境，`ready()` 会报 `ENV_FORBIDDEN`），连接状态以第一次 `api.fetch` 成功为准。模板里的 `init`/`ready` 是给云数据库用的，删掉集合时一并删掉。集合和 OS 接口混用时两边分开降级：数据库没就绪时 OS 数据照常显示，只在用到集合的区块提示稍后重试。
3. **应用自己产生的数据才建集合**（`db.collection`，在 manifest 声明）。
4. **以上都没有的后端逻辑才写云函数**（references/cloud-functions.md）。云函数不能调 OS 接口，需要 OS 数据时由页面取到后传入。

一个接口不可用时先找替代接口，搜不到再判断 OS 没有；不要猜接口路径，也不要读平台源码。

## 1. 新建项目（非交互，适合 AI 执行）

```bash
npm create zleap-app@latest <目录> -- --appid <appid> --name "<应用名>" -y
# 已知 OS 地址时加：--target https://os.example.com
# 表单 / 列表 / 统计这类不需要组件化的应用，加 --template vanilla：不装 React/Vite，不用构建，部署更快
```

`appid` 由平台生成，**不能自己编**。还没有应用时**不带 `--appid`** 生成项目，然后请用户运行 `npm run login`：浏览器授权页会写明「新建应用「<应用名>」」，
用户核对确认码点允许后，平台创建应用（用户是管理员，一次授权只建一个），CLI 把 `appid`（`zl` + 16 位小写十六进制）写进 manifest。
用户已经有应用时，用 `--appid <appid>` 生成（或填进 manifest），不要再建新的。
manifest 里写 `"appid": "<appid>"`，不要写 `app_key` 和 `publisher`。CLI 登录参数名是 `--app-key`，填的就是 appid；CLI 输出里的 `app_key` 字段也是 appid。
同事要一起开发，请管理员在控制台「团队」→「成员」里把他加为开发者。每个成员的每次上传都是一个开发版本，在控制台「版本管理」里可见；
成员可以在「版本管理」用「切换到此版本」运行同事上传、未发布的版本（只切自己的安装；非成员看不到开发版本）。带云函数的版本上传时平台自动签名、安装 / 切换 / 允许后台运行时自动绑定，appid 应用不需要签名激活操作。给全企业用 = 在「版本管理」里「发布为线上版本」，见 skill `zleap-cloud-app-release`。

## 2. 硬性约束（违反就会在运行时失败）

1. **一切先在 manifest 声明**：集合 `data.collections` + 结构 `data.schemas`；权限 `runtime.capabilities.requires`。没声明的拿不到。
2. **集合结构上线即固定**：已建集合不随新版本更新 Schema；`additionalProperties` 缺省按 `false`；集合键 `^[a-z][a-z0-9_]{0,63}$`，不能用 `sys_`/`ac_`/`t_` 前缀。要改字段 → 新集合 + 迁移。动手改 schema 前先告诉用户这一点。
3. **沙箱**：opaque origin，CSP `connect-src 'none'`、`worker-src 'none'`、脚本/样式/字体只能来自包内。所以：不能 `fetch`/XHR/WebSocket、不能用 CDN 或在线字体、不能用 `localStorage`/`sessionStorage`/`indexedDB`、不能 `alert/confirm/prompt`、不能开 Worker、不能弹新窗口，`navigator.clipboard` 也不可用（复制用 `zl.app.setClipboardData({ data })`，manifest `host_api.requires` 声明 `clipboard.write`，在用户点击时调用）。状态放内存或云数据库。
4. **环境由宿主决定**：用云数据库 / 云函数 / 云文件时 `zl.cloud.init({ env: zl.cloud.DYNAMIC_CURRENT_ENV })`，绝不写死 `'dev'`/`'prod'`；只用 OS 接口的应用不调 `init`/`ready()`（见上文开发顺序第 2 条）。
5. **读取上限**：单次 `limit` ≤ 100，`skip` ≤ 1000，用分页；查询有筛选/排序但没索引时可能 `INDEX_REQUIRED`。
6. **乐观锁**：`update`/`remove` 带 `agentos: { expectedVersion: doc._version }`；冲突 `VERSION_CONFLICT` → 重读再改。
7. **结果未知不重试**：`COMMIT_UNKNOWN`（CLI 退出码 6）→ 先重读或查询原操作，绝不自动重复提交。
8. **明确失败优于假成功**：在 zleapOS 里不要用 mock 数据、假登录、吞错误让界面「看起来能用」。唯一例外是**预览模式**：浏览器直接打开（`npm run preview`）没有宿主时，模板用 `preview` 模块的示例数据渲染界面并显示「预览模式」横幅；不要把示例数据用到宿主里的失败兜底上。
9. **凭据**：登录只能由用户在浏览器确认（`npm run login`），不要索要或输入密码，不要读取/打印 `~/.config/zleap-app/session.json`。

## 界面：用官方样式，做完整的状态（外观与功能同样要验收）

应用跑在 zleapOS 桌面窗口里，要和桌面其他应用看起来是一套。**不要写浏览器默认样式的输入框加按钮就交差。**

1. **用官方样式 `zleap.css`**：模板已引入（vanilla `app/sdk/zleap.css`，React `import '@zleap-ai/app-sdk/zleap.css'`）。颜色、圆角、字号与桌面同源，**自动跟随桌面亮 / 暗**。
   页面骨架 `zl-page` → `zl-header`（`zl-title` + `zl-subtitle` + `zl-status`）→ 若干 `zl-section`；控件用 `zl-btn`（`--primary` 每屏最多一个）、`zl-input` / `zl-textarea`、`zl-segmented`、`zl-list` / `zl-list-item`、`zl-card`、`zl-stats`、`zl-tag`、`zl-alert`、`zl-empty`、`zl-skeleton`、`zl-toast`。
   全部类与常用版式见 references/ui.md。自己的样式写在 `style.css` / `index.css`，颜色只用 `var(--zl-*)`，**不要写死色值**（暗色会坏）。
2. **每块数据四种状态都要有**：加载中（`zl-skeleton`，不要空白）、出错（`zl-alert--danger` + 中文说明 + 重试）、空（`zl-empty`：图标 + 一句话 + 下一步）、有数据。
   操作时按钮 `aria-busy="true"` 防重复提交；成功用 `zl-toast` 轻提示；危险操作行内二次确认（不能用 `confirm`）。AI 生成这类耗时操作要显示进度文字。
3. **信息层次**：主操作放在最显眼处；次要信息用 `zl-muted` / `zl-item-meta`；数字用 `zl-num`；长文本（AI 结果）用 `zl-prose`。不要所有东西同一个字号、同一个颜色堆在一起。
4. **原生 `<select>` 在沙箱窗口里体验差**：选项少（≤ 5）用 `zl-segmented`，多的用一组按钮或列表。
5. **看一眼再交付**：改完界面运行 `npm run preview`（浏览器直接打开，示例数据，亮 / 暗都看），能截图的工具截图自查布局、对齐、空状态；
   新增集合或 OS 接口时在 `preview` 模块补一份示例数据。功能仍以 `npm run deploy` 后在 zleapOS 里打开为准。

## 3. 开发一个功能的标准流程

0. **先查现成能力**：按上面「开发路线」用 MCP 查 OS 接口与 SDK，能直接调的就不建集合、不写云函数。
1. **建模**：在 `manifest.json` 加集合与 strict schema（类型只支持 object/array/string/number/integer/boolean/null，关键字子集见 references/manifest.md）。日期用 `number` 存毫秒，或 `integer` + `"x-agentos-value-type": "date_ms"`。
2. **权限**：需要的能力加进 `requires`（`cloud.database.read/write`、`cloud.storage.read/write`、`os.agent.complete` 等，白名单外的非可选能力会让应用「暂不可用」）。`reason` 会展示给用户，写具体用途。
3. **数据层**：React 模板在 `src/cloud/` 下按集合写一个模块（参照 `src/cloud/todos.ts`），组件只调用这些函数；错误用 `describeError()` 展示。OS 接口用 `osFetch()`（vanilla 用 `zl.cloud.os.api.fetch`），预览模式会自动换成示例数据。
4. **界面与本地验证**：按上面「界面」一节写界面，`npm run preview` 看效果；再 `npm run typecheck && npm run check`（`check` 通过只代表静态契约，`runtime_test=not_checked`）。
5. **部署到自己桌面**：`npm run deploy`（构建 → 检查 → 上传开发版本（appid 应用仅本人和开发人员可见）→ 安装/切换本人安装 → 按平台诊断准备资源；内容变化时自动递增补丁号）。上传之后的步骤由 `zleap-app deploy` 完成，可重复执行，部署记录在 `.zleap/state.json`；不要再手动 publish / install / update 另起一套记录。
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
  云函数里**没有** `zl.cloud.auth`（`getOpenId()` / `getUserInfo()` 都不可用）：需要 openid 时由页面 `getIdentity()` 取到后作为输入传给函数，或用文档自带的 `_openid`；不要用 `getContext().userId`（平台内部 ID，已废弃）。
  不要自己做登录页或索要账号；云函数里读不到授权信息。
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
| `ENV_FORBIDDEN` | 部署已开放生产、应用还没有生产环境，非成员打不开 → 任一成员「发布为线上版本」（平台自动准备生产） |
| `COLLECTION_NOT_FOUND`（上生产后） | 生产环境建了但没开通集合 → 重新「发布为线上版本」（生产库未就绪时发布会报 `PROD_DATABASE_NOT_READY`，稍后重试） |
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

- references/ui.md — 官方样式 zleap.css 全部类、常用版式（列表、表单、详情、统计、AI 结果）、四种状态写法
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
