---
name: zleap-cloud-app-release
description: Ship a zleapOS 云开发 (App Cloud) app beyond the developer's own desktop — publishing a development version as the live version (版本管理 → 发布为线上版本 / 回退到此版本, npm run release / zleap-app release), automatic production preparation and its failure reasons, running cloud functions / background capabilities / triggers in the dev environment (自动签名、允许后台运行、invoke), sharing with colleagues, and version switching / rollback. Use when the user asks to 上线, 发布, 上生产, 分享给同事, 回退, 让云函数或定时任务跑起来, 升级或回退版本 for a zleap.app/2 app.
---

# zleapOS 云开发应用：从开发到上线

前置：应用已能用 `npm run deploy`（或 `zleap-app publish` + `install`）装到开发者自己的桌面并读写数据——那部分见 skill `zleap-cloud-app`。
下文的 `npx zleap-app` 指项目里安装的 `@zleap-ai/app-cli`；不在这样的项目里时换成 `npx @zleap-ai/app-cli`。本 skill 处理之后的事：后台能力、发布上线、分享给同事、版本迭代。完整版流程：references/dev-to-production.md。

## 1. 上线：「版本管理」→ 发布为线上版本

manifest 里是 `"appid": "zl…"`（控制台「创建应用」得到的 appid）。上线只有两步，不需要手动签名、激活或上架：

1. **上传开发版本**：`npm run deploy`（会把上传者本人的安装切到这个版本）。
2. **发布**：用户明确要求上线后，在项目里 `npm run release -- --notes "本次更新说明" --yes`（发布最近一次 deploy 的版本；
   `--version-id <id>` 指定版本，`npm run versions` 列出全部版本），或请用户在云开发控制台 →「发布」→「版本管理」→「发布为线上版本」。
   发布即全企业可见（无上架、无审核），应用出现在应用中心；任何成员都能发布。回退 = 发布一个旧版本（`npm run release -- --version-id <旧> --yes`，或控制台「回退到此版本」）。
   底层 CLI：`npx zleap-app releases <app_id>`、`npx zleap-app release <app_id> --version-id <id> [--notes 说明]`；MCP 工具 `app_releases` / `app_release`。

要点：
- 只用宿主能力（无 `data.collections`、无 `cloud.*`、无 `runtime.backend`、无 headless provides）的版本：发布即可用，不需要签名、激活和环境。
- 带云资源的版本：**第一次**发布时平台自动完成**应用级**生产准备（生产环境 → 签发生产发布（归属上传者）→ 生产门禁 → 生产库与集合），
  不依赖任何人的安装：**任一成员可以发布任一成员上传的版本**，不要求上传者正在用它。再次发布 / 回退直接复用当时的就绪发布。
  可能的 40900（看 `detail.reason`）：`PROD_DATABASE_NOT_READY`（生产库还没就绪，稍后重新发布）、`UPLOADER_INACTIVE`（上传者账号已停用，请其他成员重新上传后再发布）；
  生产门禁不通过时 reason 与激活相同（如 `RELEASE_APPROVAL_EXPIRED_OR_MISSING`），重新发布会重新签发。
- 已开着应用的人不被打断；非成员下次打开时自动跟随到线上版本（「正在更新到最新版本…」）；成员从不被自动切换。
  想让开着的窗口及时更新，在应用里用 `zl.app.getUpdateManager()`（见 skill `zleap-cloud-app` 的 references/app-runtime.md）。
- 成员可在「版本管理」用「**切换到此版本**」把**自己的**安装切到任一成员上传的版本（含同事未发布的版本），不影响别人、不改线上版本；开发版本只对成员可见。
- 接口（成员）：`GET /api/v1/app-cloud/apps/{app_id}/versions`、`POST /api/v1/app-cloud/apps/{app_id}/publish` `{version_id, notes?}`。
  **发布影响全企业使用者：只有用户明确说「发布 / 上线 / 回退到 x」时才执行，执行前复述要发布的版本号。**
- 带云函数的版本在开发环境调试**不需要签名 / 激活操作**：上传时平台自动签名，安装 / 切换版本 / 在应用窗口「权限」里允许后台运行时自动绑定
  （版本还没签名时当场补签）。用户在应用窗口「权限」里允许后台运行后，`npx zleap-app invoke <app_id> --capability <id> --environment dev` 调试。
  控制台没有单独的签名 / 激活界面。
- `npx zleap-app prepare` 只是兜底：仅当 `npx zleap-app diagnose` 返回 `next_action: app_prepare` 时用，只准备开发环境、不碰生产，只能准备本人上传的版本。

完整说明：references/console-release.md。

## 2. 云函数 / 后台能力（开发环境）

AI 能做的是命令与代码，界面操作要请用户完成：

1. **上传**：`npm run deploy`（含 `cloudfunctions/` 的包也可以）。带 headless 能力的版本上传时平台自动签名，deploy 把本人安装切到新版本时自动绑定。
2. **允许后台运行**（用户）：应用窗口顶部「权限」→「应用权限」对话框里勾选「后台能力（定时任务 / 云函数）」下的能力 →「保存并重新加载」
   （或控制台「云函数」→「后台能力」里允许）。版本还没签名时这一步会自动补签并绑定。
3. **试调**（AI 可做）：`npx zleap-app invoke <app_id> --capability <能力 ID> --environment dev --input-file in.json`，
   再 `npx zleap-app invocation <app_id> <调用编号>`；函数日志 `npx zleap-app runtime-logs <app_id> <调用编号> --environment dev`（看 `function_logs`）。
   - `CAPABILITY_NOT_ACTIVE` = 用户还没允许后台运行，开发工具不能代为允许。
   - `FUNCTION_RELEASE_REQUIRED`：请用户在「权限」里重新保存一次或在「版本管理」切换一次版本（会自动补签）；仍失败说明部署的签名服务不可用，交给平台管理员。
4. **触发器**（用户）：控制台「云函数」→ 能力 →「触发器」里启用。manifest 的 `background.modes` 要含 `scheduled`/`events`，事件名 `^[a-z][a-z0-9_.]{0,63}$`。
   **线上让使用者自己开**：触发器声明加 `"user_configurable": true` 并发布；每个使用者在应用窗口「权限」里允许后台能力后，在能力下面打开开关（以本人身份运行，时间和参数用声明值）。没开放的触发器在生产环境启用报 `TRIGGER_NOT_USER_CONFIGURABLE`。

坑：
- 控制台「云函数」页允许 / 撤销授权**不会**解除发布绑定。
- `managed_function` 必须绑定就绪发布，否则 `FUNCTION_RELEASE_REQUIRED`；`builtin`、`logic_unit` 在开发环境不需要。
- 切换到新版本后旧会话失效（`RELEASE_UNAVAILABLE`），宿主会自动重开。
- 云函数里 `zl.cloud.os.database.query` / `mutate` **都必须带 `request_id`**（非空、≤128，用 `` `${context.invocationId}:用途` ``），否则网关拒绝、未捕获时整次调用 `USER_EXCEPTION`。
- 云函数里读操作只有 `get`（单条）和 `count`（计数，可带 `filter`）；`operation: 'query'` 会被拒（`GATEWAY_QUERY_OPERATION_UNSUPPORTED`）。
- 触发器 `id` 只能是 `^[a-z][a-z0-9_]{0,63}$`（**不能有 `-`**）：上传不报错，但启用时会被拒。
- 升级到新版本后，已启用的触发器会变成停用（`authorization_changed`），要在新版本上重新启用。
- 函数里 `query` / `mutate` 失败时 `error.code` 是错误码、`error.message` 是平台给的中文说明（含具体上限）；先 `try/catch` 把它放进返回值
  （`output_schema` 里声明对应字段），再排查。日志库刚开通时可能暂时查不到日志（`LOG_UNAVAILABLE`），函数照常执行。

## 3. 生产环境

- 生产是否开放由部署决定（发布信任配置就绪即开放，运维自动配置），控制台没有开关。未开放时带云资源的版本发布会在生产准备阶段失败——如实告诉用户这是平台边界。
- 生产数据域面向全体使用者、与开发数据域完全隔离：开发数据不会带过去。发布前确认同一版本已在开发环境验证过。
- 生产环境里控制台的数据库、文件可直接修改（影响线上用户）；云函数、日志只读。
- 应用窗口「权限」在生产数据域单独授权：使用者要在那里勾选要运行的后台能力。

## 4. 分享给同事

- 给全企业用 = 「发布为线上版本」（见第 1 节）。同事在应用中心「发现」里安装；后台能力仍需同事自己在应用窗口「权限」里允许。
- 让同事**一起开发**（上传、在控制台管理）是另一回事：管理员在控制台「团队」→「成员」里把他加为开发者。所有成员的上传都在「版本管理」里。
- 开发版本只对成员可见，开发数据域也只对成员开放；非成员要等发布为线上版本后才能用。

## 5. 版本迭代

| 场景 | 做法 |
| --- | --- |
| 自己换到新版本 | `npm run deploy`；或 `npx zleap-app update <app_id> --expected-version-id <当前> --version-id <新>`；或控制台「切换到此版本」 |
| 线上回退 | 把旧版本再发布一次：`npm run release -- --version-id <旧> --yes`，或控制台「回退到此版本」（**不回退数据**） |
| 本人安装回退 | `npx zleap-app rollback <app_id> --expected-version-id <当前> --version-id <旧>` |
| 改了 data/storage 声明 | CLI 返回 `DATA_MIGRATION_REQUIRED` 并保持原版本；平台不做迁移。已建集合结构不会变，改结构 = 新集合 + 迁移 |
| 查看版本 | `npm run versions`（`npx zleap-app releases <app_id>`）；本人安装 `npx zleap-app diagnose <app_id>` |

所有写操作结果未知（`COMMIT_UNKNOWN`，退出码 6）时：先 `diagnose` / `status` / `operation --request-id` 核对，**不要盲目重试**。

## 6. 上线前检查清单（逐项向用户确认）

- [ ] 集合结构已定稿（上线后不能改）
- [ ] `npx zleap-app check <dist 或项目> --target <OS>` 在目标部署上通过
- [ ] 控制台概览开通清单完成，「运行体检」通过
- [ ] （有后台）后台能力已允许、函数「可调用」，`invoke --environment dev` 结果正确
- [ ] 同一版本完成真实读写验证（用户手动，或 `zleap-app test` 浏览器验收）
- [ ] 用户明确要求发布，并确认了要发布的版本号

## 参考资料

- references/dev-to-production.md — 端到端流程与常见卡点
- references/console-release.md — 「版本管理」：发布线上版本、回退、切换版本、命令行发布
- references/console-functions.md — 后台能力授权、试运行、触发器
- references/console-workspace.md — 概览开通清单与运行体检
- references/app-center-publish.md / app-center-install.md — 上传、安装授权、更新
- references/console-members.md — 创建应用（appid）、成员与角色
- references/permissions.md、references/status-codes.md
