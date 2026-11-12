# AGENTS.md — __APP_NAME__（zleapOS 云开发应用，原生网页、不用构建）

本项目是运行在 zleapOS 沙箱窗口里的云开发应用：`app/` 目录就是应用包根目录，里面直接是 HTML / JS / CSS，**没有构建步骤**。
做任何云开发相关改动前，先读项目内 skill `zleap-cloud-app`（`.agents/skills/` 或 `.claude/skills/`）。

**开发路线**：先用 MCP 服务 `zleap-app`（`.mcp.json` 已配好）查当前用户可用的 OS 接口和 SDK——`os_business_search` → `os_business_get` → `os_business_call` 试调（写 / 删接口先传 `dry_run: true` 只校验不执行；搜索结果 `page_api.enabled` 为 false 时页面不能调 OS 接口）；OS 已有的数据和功能直接用 `zl.cloud.os.api.fetch`；应用自己产生的数据才建集合；都没有的后端逻辑才写云函数。不要猜接口，不要重复造轮子。

**开发节奏**：一次只做一个功能。用户给了一组需求时先拆成能单独验收的小功能；每条改完先 `npm run preview` 看界面（新集合 / 新接口在 preview 模块补示例数据），再 `npm run check`、`npm run deploy`，用 `npm run open` 打开应用，请用户在 zleapOS 里验收（并回归之前的功能）通过后再做下一条。没有用户明确要求不发布。

**界面**：用官方样式 `zleap.css` 的 `zl-` 类（与 zleapOS 桌面同色、自动跟随亮 / 暗），自己的样式只用 `var(--zl-*)` 取色；每块数据做全加载中 / 出错 / 空 / 有数据四种状态。
写完界面运行 `npm run preview` 在浏览器里看效果（示例数据，亮 / 暗都看）。类清单与常用版式见 skill 的 `references/ui.md`。

## 命令

| 目的 | 命令 |
| --- | --- |
| 预览界面（不连 zleapOS，示例数据来自 preview 模块；默认端口 5180，被占用时自动换下一个空闲端口，地址以终端输出为准） | `npm run preview` |
| 平台静态检查 | `npm run check`（`runtime_test=not_checked`，不代表能用） |
| 登录 OS（浏览器授权，自动续期，最长 30 天；manifest 还没有 appid 时同时新建应用） | `npm run login -- --target <OS 地址>` |
| 检查→上传开发版本→装到本人 | `npm run deploy` |
| 在浏览器打开 zleapOS 并直接拉起本人已装的应用（本人身份自测，不用发布；`-- --no-browser` 只打印链接） | `npm run open` |
| 安装/权限/版本诊断 | `npm run status` |
| 页面错误与云函数日志（24h） | `npm run logs`（`-- --environment dev\|prod`、`--invocation <调用编号>`） |
| 版本列表（含线上版本） | `npm run versions` |
| 发布为线上版本 / 回退（全企业生效） | `npm run release -- --notes "说明" --yes`（`--version-id <id>` 指定版本）——**只在用户明确要求发布时执行**；发布后本人窗口也改用正式数据，开发期数据留在调试域（要继续用调试域测试就再 `npm run deploy` 一个开发版本） |

`login` 需要用户在浏览器确认，**不要替用户输入密码或绕过**；会话过期时请用户重新运行 `npm run login`。
默认等用户点「允许」5 分钟；你代用户运行登录、用户可能晚点才点时，用 `npm run login -- --browser-timeout 10m`（或 `--no-browser` 只打印授权链接）。OS 地址优先用域名，用 IP 时浏览器授权页会报证书主机名不匹配。

## 硬性约束

- **只改 `app/` 里的文件**：`app/manifest.json`（声明）、`app/index.html`、`app/main.js`、`app/style.css`、`app/preview.js`（预览示例数据），可以加更多 `.js` 模块，用相对路径 `import`。不要引入打包器、npm 前端依赖或 CDN。
- **SDK 在 `app/sdk/`**，由 `npm install` / `npm run deploy` 从 `@zleap-ai/app-sdk` 复制，不要手改；`import { zl, CloudError } from './sdk/index.js'`，宿主能力用 `./sdk/host.js`，工作区用 `./sdk/workspace.js`。API 以 `node_modules/@zleap-ai/app-sdk/dist/types/*.d.ts` 为准。
- **一切先声明**：集合与结构写在 `app/manifest.json` 的 `data.collections` + `data.schemas`；权限写在 `runtime.capabilities.requires`。没声明的运行时一律拿不到。
- **集合结构上线后不可改**：已建集合不会随新版本更新 Schema，改字段要新建集合并迁移。`additionalProperties` 缺省按 `false`。
- **沙箱**：opaque origin + CSP `connect-src 'none'`、`worker-src 'none'`、只允许包内脚本/样式/字体。不能 `fetch`、不能用外部 CDN/字体、不能用 `localStorage`、不能 `alert/confirm`、不能开 Worker。
- 环境用 `DYNAMIC_CURRENT_ENV`，不要写死 dev/prod。**单次读取最多 100 条**，用 `skip` 翻页（skip ≤ 1000）。更新/删除带 `expectedVersion`。
- **结果未知不重试**：`COMMIT_UNKNOWN` 时先重读核对；部署脚本退出码 6 同理。
- **明确失败优于假成功**：在 zleapOS 里不要用模拟数据、假登录或吞掉错误来让界面「看起来能用」；示例数据只用于 `npm run preview` 的预览模式。
- **用户信息只走授权登录**：`zl.auth.authorize` 在按钮点击时调用，manifest `host_api.requires` 声明 `user.*`；用户键用 openid。
- 每次上传都要新版本号（`npm run deploy` 会在内容变化时自动递增 `app/manifest.json` 的补丁号）。
