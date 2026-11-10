# zleap-app-kit

zleapOS 云开发应用的一站式工具：

| 包 / 目录 | 用途 | 用户怎么用 |
| --- | --- | --- |
| `create-zleap-app` | 脚手架：生成 React + TypeScript + Vite 云开发应用，自带 Cloud SDK、部署脚本、AGENTS.md 和 skills | `npm create zleap-app@latest my-app` |
| `@zleap-ai/app-cli` | `zleap-app` CLI 的 npm 发行版（按平台自动选用预编译二进制，无需 Go） | 脚手架已作为 devDependency；也可 `npx @zleap-ai/app-cli` |
| `@zleap-ai/app-sdk` | 前端 SDK：Cloud 数据库 / 文件 / 云函数（`zl.cloud`）、宿主能力（`/host`）、工作区（`/workspace`）。压缩混淆发布，类型声明可读，专有许可 | 脚手架已作为依赖；也可 `npm i @zleap-ai/app-sdk` |
| `skills/` | 给 AI 编程工具的 skills：`zleap-cloud-app`（开发/调试/部署）、`zleap-cloud-app-release`（云函数/发布上线/分享/版本） | 脚手架项目自带；已有项目 `npx create-zleap-app@latest skills` |

## 给应用开发者

```bash
# 0. 在 zleapOS 云开发控制台「创建应用」，复制 appid（形如 zl3f9a2c7e1b0d4a68）
#    同事要一起开发：在控制台「成员」里把他加为开发者，大家用同一个 appid

# 1. 创建项目（交互式；加 -y 与参数可全自动）
npm create zleap-app@latest my-app -- --appid zl3f9a2c7e1b0d4a68
#   或：npx create-zleap-app my-app --appid zl3f9a2c7e1b0d4a68 --name "我的应用" --target https://os.example.com -y

# 2. 登录并部署到自己的 zleapOS 桌面
cd my-app
npm run login            # 浏览器核对确认码后允许（访问凭据自动续期，授权最长 30 天）
npm run deploy           # 构建 → 平台检查 → 上传开发版本（appid 应用仅本人和开发人员可见）→ 安装/切换本人安装
```

安装时平台会自动创建开发环境并开通数据库（`npm run deploy` 结束时会打印状态），然后从启动台打开应用。

### 让 AI 编程工具帮你开发

脚手架生成的项目已经包含 `AGENTS.md` 和项目级 skills（`.agents/skills/`、`.claude/skills/`），
在 Codex、Claude Code、Pi、OpenCode、Cursor、Gemini CLI、GitHub Copilot 等工具里直接打开项目即可。

已有项目或想全局安装：

```bash
npx create-zleap-app@latest skills [项目目录]                  # 从 npm 包复制到 .agents/skills 与 .claude/skills（推荐，离线可用）
# 也可以用 skills CLI 从 GitHub 安装 / 全局安装：
npx skills add RuoFeng2015/zleap-app-kit
npx skills add RuoFeng2015/zleap-app-kit -g -a codex -a claude-code -a pi -a opencode -y
```

Claude Code 也可以作为插件市场添加：`/plugin marketplace add RuoFeng2015/zleap-app-kit`。

支持 MCP 的工具还可以接入 CLI 自带的 MCP 服务（先在终端 `npx @zleap-ai/app-cli auth login ...`）：

```json
{ "mcpServers": { "zleap-app": { "command": "npx", "args": ["-y", "@zleap-ai/app-cli", "mcp", "serve", "--workspace", "/绝对路径/my-app", "--target", "https://os.example.com"] } } }
```

## 维护者：仓库结构

```
kit.config.json                 发布坐标（包名、scope、三条版本线、skills 仓库、平台列表）——改名只改这里
packages/app-cli/               @zleap-ai/app-cli：bin/zleap-app.js 入口 + lib/resolve.js 平台解析（PACKAGES 表与 kit.config.json 的 platforms 对应）
packages/app-sdk/               @zleap-ai/app-sdk 包壳（package.json / LICENSE / README）；dist/ 由 build:sdk 在本地生成，不入库
packages/create-zleap-app/      脚手架：index.js、lib/scaffold.js、templates/react-ts、skills/（由 sync 复制）
npm/app-cli-<key>/              平台子包 darwin / linux-x64 / linux-arm64 / win32-x64（build-cli 生成，二进制不入库）
skills/                         skills 源（SKILL.md 手写；references/ 由文档站同步生成）
scripts/                        build-cli / build-sdk / sync / sync-skill-references / publish
test/                           node:test：脚手架、二进制解析、部署流程（用 CLI 替身）、SDK 产物（有 dist 时）
```

### 事实源与同步

| 内容 | 事实源 | 同步命令 | CI 校验 |
| --- | --- | --- | --- |
| `zleap-app` 二进制 | `zleap-service/cmd/zleap-app` | `npm run build:cli -- --source ../zleap-service` | 发布前核对 checksums |
| `@zleap-ai/app-sdk` 产物 | `zleap-service/internal/appdevcli/sdksrc`（可读源码，只在私有仓库） | `npm run build:sdk -- --source ../zleap-service --embed`（esbuild 打包、压缩、改写局部标识符；属性名不动；禁止 eval；`--embed` 同时把混淆产物写进 `zleap-service/internal/appdevcli/sdkdist` 供 CLI 内嵌，需在 zleap-service 提交） | `--check`（发布前自动执行） |
| skills `references/` | 云开发文档站 `zleap-web/apps/docs` | `npm run sync:refs -- --docs ../zleap-web/apps/docs` | `--check` |
| 包名 / 版本 / 随附 skills | `kit.config.json`、`skills/` | `npm run sync` | `npm run check` |

`build:cli`、`build:sdk` 和 `sync:refs` 需要 monorepo 里的私有仓库，只在本地执行；公开仓库的 CI 只跑 `npm run check` 与 `npm test`。
**SDK 可读源码不能进入本仓库**（本仓库计划公开），`packages/app-sdk/dist` 已在 `.gitignore` 中。

### 发布

一条命令：

```bash
cd zleap-app-kit
npm run release:dry        # 只看计划：哪些包和 npm 上不一样、各发什么版本（不改文件）
npm run release            # 正式发布：确认计划 → 自动定版本、构建、测试 → 上传暂存区 → 一次 2FA 批准全部
```

`scripts/release.mjs` 做的事：

1. **检测**：每条版本线和 npm 上的 latest 比内容，只发真正变了的。
   - CLI：比 zleap-app 的源码指纹（`go list` 出的依赖源码、embed 文件、第三方模块版本、Go 版本、编译参数；写在平台包 `zleapApp.source`）、平台包组合、主包文件。
   - SDK：比 SDK 源码指纹（npm 包里的 `dist/build-info.json`）和包壳文件。
   - 脚手架：`npm pack` 后逐文件比（模板、skills 等）；CLI / SDK 要发版时它也跟着发，好把新版本号写进新项目。
   - 文档站有新改动还没同步进 skills 时会问要不要一起发布。
2. **定版本**：本地 `kit.config.json` 已写了更新且没发过的版本就用它，否则在 npm 版本上递增补丁号；不发布的线对齐到 npm 上的版本（脚手架只会引用已发布的版本）。
3. **构建与测试**：按需 `build:sdk` / `build:cli`（`darwin` 通用二进制要用 `lipo`，所以在 Mac 上跑），再 `sync --check` 和 `npm test`。
4. **发布**：先用 npm 12 的 `npm stage publish` 把所有包上传进暂存区（不需要 2FA），再按「平台子包 → CLI 主包 → SDK → 脚手架」依次批准。
   批准时只验证一次：2FA 是验证器 App 就输一次 6 位码；是安全密钥 / 浏览器验证就在浏览器里确认一次，凭据给后面的包复用，npm 不收时才再开一次浏览器。

npm 登录失效时脚本会打开浏览器让你重新 `npm login`。中途失败直接重跑：已上线的跳过，已在暂存区且内容相同的沿用。
其他参数：`--yes`（不问确认）、`--force cli,sdk,create`（没变也强制发）、`--refs`（配合 `--yes` 同步文档站改动）、`--source` / `--docs`（事实源位置）。

平台子包只有 4 个：`darwin` 是 arm64 + x64 的通用二进制；`win32-x64` 的 `cpu` 同时声明 `x64`、`arm64`，Windows 11 on ARM 用系统自带的 x64 仿真运行它。
增删平台时同时改 `kit.config.json` 的 `platforms` 与 `packages/app-cli/lib/resolve.js` 的 `PACKAGES`，`npm run check` 会核对两边。
CLI 二进制内嵌了一份 SDK（MCP 的 SDK 参考、原生模板），它不计入 CLI 指纹：只改 SDK 时不发 CLI，那份参考下次 CLI 发版时跟上。

发布后提交 `kit.config.json` 等改动并推送到公开 GitHub（skills 通过 GitHub 仓库地址安装）。
`npm run publish:direct`（`scripts/publish.mjs`）是旧的逐个直接发布，每个包各自 2FA，只在暂存发布不可用时备用。

## 平台约束（模板与 skills 都已内置）

- 应用跑在 sandbox iframe：CSP `connect-src 'none'`、`worker-src 'none'`、只允许包内脚本/样式/字体，opaque origin（无 localStorage）。
- Vite 使用相对 `base: './'`，关闭 modulepreload polyfill（它依赖 fetch），构建插件把 `manifest.json`、`LICENSE` 放进 `dist/` 并拦截外链资源。
- 云函数源码放在项目根目录 `cloudfunctions/`，构建插件原样复制进 `dist/`；`zleap-app check/pack/publish` 与应用中心上传使用同一套校验，带云函数的包可以直接用 CLI 上传。
- 生成的项目需要 Node.js 20.19+ / 22.12+（Vite 7）；脚手架在旧版本上会提示，`npm run deploy` 会直接拒绝并说明原因。
- 同一版本号不同内容会被拒；`npm run deploy` 在内容变化时自动递增补丁号。
- `COMMIT_UNKNOWN`（退出码 6）不自动重试；`DATA_MIGRATION_REQUIRED` 不自动迁移。
