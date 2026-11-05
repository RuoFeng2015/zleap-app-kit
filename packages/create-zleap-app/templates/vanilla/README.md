# __APP_NAME__

zleapOS 云开发应用（原生 HTML / JS，不用构建）。数据保存在 App Cloud，按当前账号隔离。

## 第一次跑起来

```bash
npm run login -- --target https://os.example.com   # 浏览器里核对确认码后允许
npm run deploy                                      # 检查 → 上传 → 装到你自己的桌面
```

安装时平台会自动创建开发环境、开通数据库，并按 `app/manifest.json` 建好 `todos` 集合（通常 1 分钟内）。然后从启动台打开应用，右上角显示「● OS 已连接」即可读写。

## 日常开发

改 `app/` 里的文件，然后 `npm run deploy`。没有构建步骤，也没有本地预览服务器（页面只能在 zleapOS 窗口里连上宿主）。

| 命令 | 作用 |
| --- | --- |
| `npm run check` | 平台静态检查 |
| `npm run deploy` | 上传新版本并把本人安装切换过去（内容变化时自动递增补丁号） |
| `npm run status` | 安装、权限、可用版本 |
| `npm run logs` | 最近 24 小时页面错误 + 本人云函数日志 |
| `npm run versions` / `npm run release` | 线上版本；把最近一次 deploy 的版本发布为线上版本（全企业可见） |

## 目录

```
app/manifest.json  应用声明（权限、集合与结构）
app/index.html     页面入口；app/main.js、app/style.css
app/sdk/           Cloud SDK（从 @zleap-ai/app-sdk 复制，已在 .gitignore）
app/LICENSE        必需
scripts/zleap.mjs  login / deploy / status / logs / versions / release
AGENTS.md          给 AI 编程工具的项目规则；.agents/skills、.claude/skills 是官方 skills
```

需要组件化或复杂界面时，用 React 模板：`npm create zleap-app@latest -- --template react-ts`。
