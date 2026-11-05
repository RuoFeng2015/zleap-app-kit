# AGENTS.md — __APP_NAME__（zleapOS 云开发应用）

本项目是运行在 zleapOS 沙箱窗口里的云开发应用：React + Vite 构建到 `dist/`，`dist/` 就是应用包根目录。
做任何云开发相关改动前，先读项目内 skill `zleap-cloud-app`（`.agents/skills/` 或 `.claude/skills/`）。

**开发路线**：先用 MCP 服务 `zleap-app`（`.mcp.json` 已配好）查当前用户可用的 OS 接口和 SDK——`os_business_search` → `os_business_get` → `os_business_call` 试调；OS 已有的数据和功能直接用 `zl.cloud.os.api.fetch`；应用自己产生的数据才建集合；都没有的后端逻辑才写云函数。不要猜接口，不要重复造轮子。

## 命令

| 目的 | 命令 |
| --- | --- |
| 类型检查 | `npm run typecheck` |
| 构建 + 平台静态检查 | `npm run check`（`runtime_test=not_checked`，不代表能用） |
| 登录 OS（浏览器授权，自动续期，最长 30 天；manifest 还没有 appid 时同时新建应用） | `npm run login -- --target <OS 地址>` |
| 构建→检查→上传开发版本→装到本人 | `npm run deploy` |
| 安装/权限/版本诊断 | `npm run status` |
| 页面错误与云函数日志（24h） | `npm run logs`（`-- --environment dev\|prod`、`--invocation <调用编号>`） |
| 版本列表（含线上版本） | `npm run versions` |
| 发布为线上版本 / 回退（全企业生效） | `npm run release -- --notes "说明" --yes`（`--version-id <id>` 指定版本）——**只在用户明确要求发布时执行** |

`login` 需要用户在浏览器确认，**不要替用户输入密码或绕过**；会话过期时请用户重新运行 `npm run login`。

## 硬性约束

- **一切先声明**：集合与结构写在 `manifest.json` 的 `data.collections` + `data.schemas`；权限写在 `runtime.capabilities.requires`。没声明的运行时一律拿不到。
- **集合结构上线后不可改**：已建集合不会随新版本更新 Schema，改字段要新建集合并迁移。`additionalProperties` 缺省按 `false`。
- **沙箱**：opaque origin + CSP `connect-src 'none'`、`worker-src 'none'`、只允许包内脚本/样式/字体。不能 `fetch`、不能用外部 CDN/字体、不能用 `localStorage`、不能 `alert/confirm`、不能开 Worker。
- **只通过 `src/cloud/` 访问 SDK**；环境用 `DYNAMIC_CURRENT_ENV`，不要写死 dev/prod。SDK 是 npm 包 `@zleap-ai/app-sdk`（另有 `/host` 宿主能力、`/workspace` 工作区入口），API 以 `node_modules/@zleap-ai/app-sdk/dist/types/*.d.ts` 为准；升级 SDK 时与 `@zleap-ai/app-cli` 保持同版本。
- **单次读取最多 100 条**，用 `skip` 翻页（skip ≤ 1000）。更新/删除带 `expectedVersion`。
- **结果未知不重试**：`COMMIT_UNKNOWN` 时先重读核对；部署脚本退出码 6 同理。
- **明确失败优于假成功**：不要用模拟数据、假登录或吞掉错误来让界面「看起来能用」。
- **用户信息只走授权登录**：`zl.auth.authorize` 在按钮点击时调用，manifest `host_api.requires` 声明 `user.*`；用户键用 openid，不要找平台用户 ID。
- 每次上传都要新版本号（`npm run deploy` 会在内容变化时自动递增补丁号）。
