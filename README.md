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
| `@zleap-ai/app-sdk` 产物 | `zleap-service/internal/appdevcli/templates/todo/sdk`（CLI 内嵌的公开 SDK） | `npm run build:sdk -- --source ../zleap-service`（esbuild 打包、压缩、改写局部标识符；属性名不动；禁止 eval） | `--check`（发布前自动执行） |
| skills `references/` | 云开发文档站 `zleap-web/apps/docs` | `npm run sync:refs -- --docs ../zleap-web/apps/docs` | `--check` |
| 包名 / 版本 / 随附 skills | `kit.config.json`、`skills/` | `npm run sync` | `npm run check` |

`build:cli`、`build:sdk` 和 `sync:refs` 需要 monorepo 里的私有仓库，只在本地执行；公开仓库的 CI 只跑 `npm run check` 与 `npm test`。
**SDK 可读源码不能进入本仓库**（本仓库计划公开），`packages/app-sdk/dist` 已在 `.gitignore` 中。

### 发布

三个包线各自独立发版（`kit.config.json`），**只给真正变了的那条递增版本**：

| 改了什么 | 递增 | 要构建 | 实际发布 |
| --- | --- | --- | --- |
| 只改模板 / skills / 脚手架 | `createVersion` | 无 | `create-zleap-app`（1 个） |
| SDK（`zleap-service/.../templates/todo/sdk`） | `sdkVersion` + `createVersion` | `build:sdk` | SDK + 脚手架（2 个） |
| CLI Go 源码（`zleap-service/cmd/zleap-app`、`internal/appdevcli`） | `cliVersion` + `createVersion` | `build:cli` | 4 个平台子包 + CLI 主包 + 脚手架 |

`createVersion` 跟着递增，是因为脚手架把生成时刻的 CLI / SDK 版本写进新项目的依赖。`npm run release` 会跳过 registry 上已有的版本，
也不要求本地有被跳过的包的产物（只发脚手架时不用编译 CLI、不用构建 SDK）。
CLI 二进制内嵌了一份 SDK（MCP 的 SDK 参考、原生模板），只发 SDK 不发 CLI 时发布脚本会提示这份旧了一版，不影响应用运行，下次 CLI 发版时自然跟上。

平台子包只有 4 个：`darwin` 是 arm64 + x64 的通用二进制（`lipo` 合成，所以 `build:cli` 要在 Mac 上跑）；
`win32-x64` 的 `cpu` 同时声明 `x64`、`arm64`，Windows 11 on ARM 用系统自带的 x64 仿真运行它。
增删平台时同时改 `kit.config.json` 的 `platforms` 与 `packages/app-cli/lib/resolve.js` 的 `PACKAGES`，`npm run check` 会核对两边。

在 monorepo 根目录、已安装 Go 1.26 的 Mac 上：

```bash
cd zleap-app-kit
# 1. 按上表改 kit.config.json 的版本，然后
npm run sync
npm install                # esbuild（构建 SDK 用）
npm run build:sdk -- --source ../zleap-service      # 只在发 SDK 时需要
npm run build:cli -- --source ../zleap-service      # 只在发 CLI 时需要
npm run sync:refs -- --docs ../zleap-web/apps/docs
npm test
# 2. 发布：先 dry-run，再正式（需对 @zleap-ai 有发布权限：npm login，或 NPM_CONFIG_USERCONFIG 指向含 token 的临时 .npmrc）
npm run release:dry
npm run release            # 或 node scripts/publish.mjs --tag next
# 3. 推送本仓库到公开 GitHub（skills 通过 GitHub 仓库地址安装）
```

发布顺序固定为：平台子包 → `@zleap-ai/app-cli` → `@zleap-ai/app-sdk` → `create-zleap-app`。npm 上同一版本号只能发布一次，修问题要递增版本。

## 平台约束（模板与 skills 都已内置）

- 应用跑在 sandbox iframe：CSP `connect-src 'none'`、`worker-src 'none'`、只允许包内脚本/样式/字体，opaque origin（无 localStorage）。
- Vite 使用相对 `base: './'`，关闭 modulepreload polyfill（它依赖 fetch），构建插件把 `manifest.json`、`LICENSE` 放进 `dist/` 并拦截外链资源。
- 云函数源码放在项目根目录 `cloudfunctions/`，构建插件原样复制进 `dist/`；`zleap-app check/pack/publish` 与应用中心上传使用同一套校验，带云函数的包可以直接用 CLI 上传。
- 生成的项目需要 Node.js 20.19+ / 22.12+（Vite 7）；脚手架在旧版本上会提示，`npm run deploy` 会直接拒绝并说明原因。
- 同一版本号不同内容会被拒；`npm run deploy` 在内容变化时自动递增补丁号。
- `COMMIT_UNKNOWN`（退出码 6）不自动重试；`DATA_MIGRATION_REQUIRED` 不自动迁移。
