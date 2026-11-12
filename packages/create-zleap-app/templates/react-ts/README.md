# __APP_NAME__

zleapOS 云开发应用（React + TypeScript + Vite）。数据保存在 App Cloud，按当前账号隔离。

## 第一次跑起来

```bash
npm run preview   # 先在浏览器里用示例数据看界面（不连 zleapOS，改动不保存）
npm run login     # 浏览器里核对确认码后允许；还没有 appid 时同时新建应用（生成项目时没给 --target，就加 -- --target https://你的-os-地址）
npm run deploy    # 构建 → 检查 → 上传 → 装到你自己的桌面
npm run open      # 在浏览器打开 zleapOS 并直接拉起应用，用你自己的身份测试，不用发布
```

安装时平台会自动创建开发环境、开通数据库，并按 `manifest.json` 建好 `todos` 集合（通常 1 分钟内）。
`npm run deploy` 结束时会打印状态；未就绪时到「云开发控制台」→ 本应用 →「概览」按提示处理。
应用右上角显示「已连接 zleapOS」即可读写；也可以从启动台打开。

## 日常开发

| 命令 | 作用 |
| --- | --- |
| `npm run preview` | 预览模式：浏览器里用 `src/cloud/preview.ts` 的示例数据看界面（默认端口 5180，占用时自动换） |
| `npm run typecheck` | 类型检查 |
| `npm run check` | 构建并做平台静态检查 |
| `npm run deploy` | 上传新版本并把本人安装切换过去（内容变化时自动递增补丁号） |
| `npm run open` | 在浏览器直接打开应用，用本人身份测试（不用发布）；已打开的窗口点「重新加载应用」看新版本 |
| `npm run status` | 安装、权限、可用版本 |
| `npm run logs` | 最近 24 小时页面上报的结构化错误 + 本人云函数日志（自动选当前所在环境，可加 `-- --environment dev\|prod`） |
| `npm run versions` | 全部成员上传的开发版本、当前线上版本、发布记录（appid 应用） |
| `npm run release` | 把最近一次 deploy 的版本发布为线上版本，全企业可见（`-- --notes "说明"`；`--version-id <id>` 发布 / 回退到指定版本） |

## 目录

```
manifest.json      应用声明（权限、集合与结构）。构建时复制到 dist/
LICENSE            必需，构建时复制到 dist/
src/cloud/         Cloud SDK（npm 包 @zleap-ai/app-sdk）的封装：连接、错误说明、todos 读写
scripts/zleap.mjs  preview / login / deploy / open / status / logs / versions / release
AGENTS.md          给 AI 编程工具的项目规则
.agents/skills/    AI 编程工具 skills（Codex、Pi、OpenCode、Cursor 等）
.claude/skills/    同上（Claude Code）
```

## 需要知道的边界

- 集合结构建好后不会随新版本改变；`additionalProperties` 不写时按 `false`。
- 应用运行在沙箱里：不能 `fetch`、不能引用外部 CDN、不能用 `localStorage`。
- 给同事用：`npm run release`（或云开发控制台「版本管理」）；一起开发：控制台「成员」里加开发者。
- 用云函数 / 后台能力：见 skill `zleap-cloud-app` 与文档「从开发到上线」。
