---
name: zleap-cloud-app-release
description: Ship a zleapOS 云开发 (App Cloud) app beyond the developer's own desktop — for platform-appid apps, publishing a development version as the live version (版本管理 → 发布为线上版本 / 回退到此版本); for legacy apps, release candidates and signing (验证并签发), 激活开发, enabling background capabilities / cloud functions / triggers, production environment and 生产门禁, zleap-app prepare, publishing to the enterprise catalog (market-publish), and version update / rollback. Use when the user asks to 上线, 发布, 上生产, 分享给同事, 回退, 让云函数或定时任务跑起来, 升级或回退版本 for a zleap.app/2 app. Also covers npm run release / zleap-app release for appid apps.
---

# zleapOS 云开发应用：从开发到上线

前置：应用已能用 `npm run deploy`（或 `zleap-app publish` + `install`）装到开发者自己的桌面并读写数据——那部分见 skill `zleap-cloud-app`。
下文的 `npx zleap-app` 指项目里安装的 `@zleap-ai/app-cli`；不在这样的项目里时换成 `npx @zleap-ai/app-cli`。本 skill 处理之后的事：签名激活、后台能力、生产环境、分享给同事、版本迭代。完整版流程：references/dev-to-production.md。

## 0. 先看应用类型：appid 应用直接用「版本管理」

manifest 里是 `"appid": "zl…"`（控制台「创建应用」得到的平台 appid）时，上线只有两步，**下文 1–6 节的签名、激活、`prepare`、企业目录都不用做**：

1. **上传开发版本**：`npm run deploy`（会把上传者本人的安装切到这个版本）。
2. **发布**：用户明确要求上线后，在项目里 `npm run release -- --notes "本次更新说明" --yes`（发布最近一次 deploy 的版本；
   `--version-id <id>` 指定版本，`npm run versions` 列出全部版本），或请用户在云开发控制台 →「发布」→「版本管理」→「发布为线上版本」。
   发布即全企业可见（无上架、无审核），应用出现在应用中心；任何成员都能发布。回退 = 发布一个旧版本（`npm run release -- --version-id <旧> --yes`，或控制台「回退到此版本」）。
   底层 CLI：`npx zleap-app releases <app_id>`、`npx zleap-app release <app_id> --version-id <id> [--notes 说明]`；MCP 工具 `app_releases` / `app_release`。

要点：
- 只用宿主能力（无 `data.collections`、无 `cloud.*`、无 `runtime.backend`、无 headless provides）的版本：发布即可用，不需要签名、激活和环境。
- 带云资源的版本：发布时平台以**上传者身份**一并准备生产（环境、生产授权、签名、激活到生产、生产集合），要求**上传者当前正在用这个版本**，
  否则 40900 `UPLOADER_NOT_ON_VERSION`（next_action：「请上传者打开应用并切换到这个版本（npm run deploy 会自动切换），再发布」）。
- 已开着应用的人不被打断；非成员下次打开时自动跟随到线上版本（「正在更新到最新版本…」）；成员从不被自动切换。
  想让开着的窗口及时更新，在应用里用 `zl.app.getUpdateManager()`（见 skill `zleap-cloud-app` 的 references/app-runtime.md）。
- 成员可在「版本管理」用「我也用这个」切到任一成员上传的版本（含同事未发布的版本）；开发版本只对成员可见。
- 接口（成员）：`GET /api/v1/app-cloud/apps/{app_id}/versions`、`POST /api/v1/app-cloud/apps/{app_id}/publish` `{version_id, notes?}`。
  **发布影响全企业使用者：只有用户明确说「发布 / 上线 / 回退到 x」时才执行，执行前复述要发布的版本号。**
- 带云函数的版本在开发环境调试时，用 `npx zleap-app prepare <app_id> --version-id <本人上传的 version_id>`：对 appid 应用它**只准备开发环境**
  （开发库、开发授权并启用声明的后台能力；有 headless 能力时再建候选、签名、激活到开发），**不碰生产**，回执 `"environment": "dev"`；
  之后 `npx zleap-app invoke <app_id> --capability <id> --environment dev` 调试。等价的界面操作是「版本管理」下方的「开发环境：云函数激活」（只列本人上传的版本），步骤同下文第 3 节。
  只能准备本人上传的版本，否则 403「只能准备本人上传的版本」。

旧 `app_key` 命名空间应用（`com.example.xxx`）继续按下文走「版本与激活」（references/console-legacy-release.md）。

完整说明：references/console-release.md。

## 1. 先回答两个问题，再选路线

| 问题 | 怎么判断 | 影响 |
| --- | --- | --- |
| 应用有后台部分吗？ | manifest 有 `runtime.backend`、`functions`，或 `provides` 里有 `execution:"headless"` | 有 → 必须签名并激活 |
| 部署开放生产了吗？ | 控制台「版本与激活」显示「生产环境已开放」，或侧栏环境出现「开发环境 / 生产环境」下拉 | 开放 → 其他使用者一律走**生产数据域**（应用没有生产环境时打不开，`ENV_FORBIDDEN`），发布者在应用有生产环境后也走生产，必须做生产激活；未开放 → 所有人走开发数据域 |

生产是否开放由部署决定（发布信任配置就绪即开放，运维自动配置），控制台没有开关。不知道就问用户，或让用户看控制台。

## 2. 只有前端的应用

- **生产未开放**：开发环境就是唯一数据域，且默认**只有发布者本人**能访问（其他人 `PUBLISHER_REQUIRED`）。能自用，但同事装了也读不到数据——如实告诉用户，这是平台边界。
- **生产已开放**：用一条命令准备好生产（会创建开发+生产环境、开通数据库、签名、**激活到生产**）：

  ```bash
  npx zleap-app prepare <app_id> --version-id <version_id>   # --request-id 不传时自动生成；重试时用回执里的同一个
  ```

  应用没有声明任何云资源（无 `cloud.*`、无后台能力、无集合）时直接返回 `not_required`，装上就能用。

  `prepare` 只接受**本人 private 且已安装的那个版本**。失败返回卡住的 `stage` 和 `completed_stages`，不自动重试；先 `npx zleap-app diagnose <app_id>`，再用**同一个** `--request-id` 继续。部署未开放生产时它会在 `prod_environment` 阶段失败。
  **它会直接激活到生产并启用全部 headless 能力——执行前必须得到用户明确同意。**

## 3. 有后台能力 / 云函数的应用（开发环境）

顺序很重要，按此执行（AI 能做的是命令与代码，界面操作要请用户完成）：

1. **上传**：`npm run deploy`（含 `cloudfunctions/` 的包也可以，校验规则与应用中心上传一致）；也可由用户在应用中心「我的发布」→「上传应用包」上传，再在应用详情「安装」。
2. **签名**（用户）：云开发控制台 →「版本与激活」，在该版本的草稿候选上点「验证并签发」→ 状态变「已就绪」。没有草稿就「新建发布候选」。
3. **允许后台运行**（用户）：应用窗口顶部「权限」→「应用权限」对话框里勾选「后台能力（定时任务 / 云函数）」下的能力 →「保存并重新加载」。已有就绪发布时这一步会自动绑定发布。
4. **核对激活**：控制台概览第 5 步显示「已激活到开发环境」、「云函数」页状态「可调用」即完成；否则点「激活开发」，或用概览的「升级到 vX 并激活」。
5. **试调**（AI 可做）：`npx zleap-app invoke <app_id> --capability <能力 ID> --environment dev --input-file in.json`，
   再 `npx zleap-app invocation <app_id> <调用编号>`；函数日志 `npx zleap-app runtime-logs <app_id> <调用编号> --environment dev`（看 `function_logs`）。
   报 `CAPABILITY_NOT_ACTIVE` = 用户还没允许后台运行，开发工具不能代为允许。
6. **触发器**（用户）：控制台「云函数」→ 能力 →「触发器」里启用。manifest 的 `background.modes` 要含 `scheduled`/`events`，事件名 `^[a-z][a-z0-9_.]{0,63}$`。
   **线上让使用者自己开**：触发器声明加 `"user_configurable": true` 并发布；每个使用者在应用窗口「权限」里允许后台能力后，在能力下面打开开关（以本人身份运行，时间和参数用声明值）。没开放的触发器在生产环境启用报 `TRIGGER_NOT_USER_CONFIGURABLE`。

坑：
- 激活和允许后台运行**没有先后要求**，但两者都做了后台能力才会执行。激活到还没有的环境时平台会自动创建该环境。
- 在控制台「云函数」页点「允许后台运行 / 撤销授权 / 重新授权」会**解除发布绑定**，之后要重新「激活开发」。
- `managed_function` 必须绑定就绪发布，否则 `FUNCTION_RELEASE_REQUIRED`；`builtin`、`logic_unit` 在开发环境不需要。
- 激活新发布后旧会话失效（`RELEASE_UNAVAILABLE`），宿主会自动重开。
- 云函数里 `zl.cloud.os.database.query` / `mutate` **都必须带 `request_id`**（非空、≤128，用 `` `${context.invocationId}:用途` ``），否则网关拒绝、未捕获时整次调用 `USER_EXCEPTION`。
- 云函数里读操作只有 `get`（单条）和 `count`（计数，可带 `filter`）；`operation: 'query'` 会被拒（`GATEWAY_QUERY_OPERATION_UNSUPPORTED`）。
- 触发器 `id` 只能是 `^[a-z][a-z0-9_]{0,63}$`（**不能有 `-`**）：上传不报错，但启用时会被拒。
- 升级到新版本后，已启用的触发器会变成停用（`authorization_changed`），要在新激活上重新启用。
- 函数里 `query` / `mutate` 失败时 `error.code` 是错误码、`error.message` 是平台给的中文说明（含具体上限）；先 `try/catch` 把它放进返回值
  （`output_schema` 里声明对应字段），再排查。日志库刚开通时可能暂时查不到日志（`LOG_UNAVAILABLE`），函数照常执行。

## 4. 上生产（部署已开放生产时，手动路线）

1. 「版本与激活」→ 对已就绪候选「查看生产门禁」，7 项全部通过（发布就绪、签名证明、审批窗口、策略绑定、当前信任根、运行快照、生产 Provider）。
2. 「激活到生产」→ 确认后显示「已激活生产」。生产环境不存在时**激活会自动创建**，但**不建集合**。
3. **马上开通生产集合**：控制台切到「生产环境」→「数据库」开通（按声明建集合）。否则所有人（含发布者）的窗口都切到生产后报 `COLLECTION_NOT_FOUND`。
4. 有后台能力的：应用窗口「权限」此时作用于生产数据域，在那里勾选要运行的后台能力。
5. 审批窗口只有**签名后 7 天**；过期后需为同一应用包新建候选重新签名（已就绪候选不能重签）。

手动路线容易漏第 3 步，能用 `prepare` 就用 `prepare`。生产环境里控制台的数据库、文件可直接修改（影响线上用户）；云函数、日志只读。

生产数据域面向全体使用者、与开发数据域完全隔离：开发数据不会带过去。激活前确认同一版本已在开发环境验证过。

## 5. 分享给同事

- 命令行：`npx zleap-app market-publish <package_id> --app-key <appid>`（是 **package_id**，在 `.zleap/state.json` 或 publish 回执里，不是 app_id）。撤回：`market-unpublish`。无审核步骤。
- 应用中心：「我的发布」→「管理版本」→ 版本行「发布到企业目录」。
- 同事在「发现」里安装；后台能力仍需同事自己在应用窗口「权限」里允许。
- 让同事**一起开发**（上传、在控制台管理）是另一回事：管理员在控制台「团队」→「成员」里把他加为开发者。所有成员的上传都在「版本管理」里，成员之间可以用「我也用这个」互相使用（含未发布的版本）。
- **撤回企业目录会让其他人已安装的该版本无法打开**——执行前告诉用户。
- 应用中心上传的新版本，若该应用已有企业可见版本会自动继承企业可见；`zleap-app publish` 永远是 private。
- 同事用「更新」升级到新版本，**新版本必须先签成「已就绪」**，否则更新被拦下。

## 6. 版本迭代

| 场景 | 做法 |
| --- | --- |
| 自己换到新版本 | `npm run deploy`；或 `npx zleap-app update <app_id> --expected-version-id <当前> --version-id <新>` |
| 回退 | `npx zleap-app rollback <app_id> --expected-version-id <当前> --version-id <旧>`（只切本人安装，**不回退数据**） |
| 改了 data/storage 声明 | CLI 返回 `DATA_MIGRATION_REQUIRED` 并保持原版本；平台不做迁移。已建集合结构不会变，改结构 = 新集合 + 迁移 |
| 查看可用版本 | `npx zleap-app versions <app_id>` / `diagnose <app_id>` |

所有写操作结果未知（`COMMIT_UNKNOWN`，退出码 6）时：先 `diagnose` / `status` / `operation --request-id` 核对，**不要盲目重试**。

## 7. 上线前检查清单（逐项向用户确认）

- [ ] 集合结构已定稿（上线后不能改）
- [ ] `npx zleap-app check <dist 或项目> --target <OS>` 在目标部署上通过
- [ ] 控制台开通清单前 3 步完成，「运行体检」通过
- [ ] （有后台）已签名、已激活开发、后台能力已允许、函数「可调用」
- [ ] 同一版本完成真实读写验证（用户手动，或 `zleap-app test` 浏览器验收）
- [ ] （生产开放）生产环境已建、门禁 7 项通过、已激活生产
- [ ] 已发布到企业目录，同事侧安装后能打开并读写

## 参考资料

- references/dev-to-production.md — 端到端流程（十个阶段、四种路线、常见卡点）
- references/console-release.md — 「版本管理」（appid 应用：发布线上版本、回退、命令行发布）
- references/console-legacy-release.md — 「版本与激活」页（旧应用：候选、签名、激活、生产门禁、使用情况；appid 应用开发环境的云函数激活步骤也在这里）
- references/console-functions.md — 后台能力授权、试运行、触发器
- references/console-workspace.md — 概览开通清单与运行体检
- references/app-center-publish.md / app-center-install.md — 上传、企业目录、安装授权、更新回退
- references/console-members.md — 创建应用（appid）、成员与角色
- references/permissions.md、references/status-codes.md
