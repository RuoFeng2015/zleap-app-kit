# __APP_NAME__

zleapOS 云开发应用（原生 HTML / JS，不用构建）。数据保存在 App Cloud，按当前账号隔离。

## 第一次跑起来

```bash
npm run preview   # 先在浏览器里用示例数据看界面（不连 zleapOS，改动不保存）
npm run login     # 浏览器里核对确认码后允许；还没有 appid 时同时新建应用（生成项目时没给 --target，就加 -- --target https://你的-os-地址）
npm run deploy    # 检查 → 上传 → 装到你自己的桌面
npm run open      # 在浏览器打开 zleapOS 并直接拉起应用，用你自己的身份测试，不用发布
```

安装时平台会自动创建开发环境、开通数据库，并按 `app/manifest.json` 建好 `todos` 集合（通常 1 分钟内）。
应用右上角显示「已连接 zleapOS」即可读写；也可以从启动台打开。

## 日常开发

改 `app/` 里的文件：先 `npm run preview` 看界面（示例数据来自 `app/preview.js`），再 `npm run deploy` 和 `npm run open` 在 zleapOS 里验证。没有构建步骤。

| 命令 | 作用 |
| --- | --- |
| `npm run preview` | 预览模式：浏览器里用示例数据看界面（默认端口 5180，占用时自动换） |
| `npm run check` | 平台静态检查 |
| `npm run deploy` | 上传新版本并把本人安装切换过去（内容变化时自动递增补丁号） |
| `npm run open` | 在浏览器直接打开应用，用本人身份测试（不用发布）；已打开的窗口点「重新加载应用」看新版本 |
| `npm run status` | 安装、权限、可用版本 |
| `npm run logs` | 最近 24 小时页面错误 + 本人云函数日志 |
| `npm run versions` / `npm run release` | 线上版本；把最近一次 deploy 的版本发布为线上版本（全企业可见） |

## 目录

```
app/manifest.json  应用声明（权限、集合与结构）
app/index.html     页面入口；app/main.js、app/style.css
app/sdk/           Cloud SDK（从 @zleap-ai/app-sdk 复制，已在 .gitignore）
app/LICENSE        必需
scripts/zleap.mjs  preview / login / deploy / open / status / logs / versions / release
AGENTS.md          给 AI 编程工具的项目规则；.agents/skills、.claude/skills 是官方 skills
```

需要组件化或复杂界面时，用 React 模板：`npm create zleap-app@latest -- --template react-ts`。
