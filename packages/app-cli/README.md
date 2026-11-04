# @zleap-ai/app-cli

zleapOS 云开发命令行工具 `zleap-app` 的 npm 发行版。安装时 npm 只会下载与你的系统匹配的那一个预编译二进制
（`@zleap-ai/app-cli-<os>-<arch>`），不需要 Go 环境。

```bash
npx @zleap-ai/app-cli                 # 查看版本与命令列表
npm i -D @zleap-ai/app-cli            # 作为项目开发依赖（脚手架默认已加）
npx zleap-app check ./dist
```

支持平台：macOS（arm64 / x64）、Linux（x64 / arm64）、Windows（x64 / arm64）。

## 常用命令

| 阶段     | 命令                                                                 |
| -------- | -------------------------------------------------------------------- |
| 登录     | `zleap-app auth login --target https://os.example.com --app-key <appid>`（appid 在云开发控制台「创建应用」获得） |
| 检查打包 | `zleap-app check <目录或zip>`、`zleap-app pack <目录> --output app.zip` |
| 上传安装 | `zleap-app publish <目录或zip>`、`zleap-app install <app_id>`         |
| 资源准备 | `zleap-app prepare <app_id> --version-id <id> --request-id <32位hex>` |
| 诊断     | `zleap-app diagnose <app_id>`、`zleap-app runtime-logs <app_id>`      |
| 版本     | `zleap-app versions / update / rollback / uninstall <app_id>`         |
| 上架     | `zleap-app market-publish <package_id> --app-key <key>`              |
| MCP      | `zleap-app mcp serve --workspace <绝对路径> --target <OS 地址>`       |

完整说明见 zleapOS 云开发文档「从开发到上线」。

## 排障

- **找不到平台包**：安装时不要使用 `--no-optional` / `--omit=optional`；跨平台拷贝 `node_modules` 后需重新安装。
- **自行构建的二进制**：设置环境变量 `ZLEAP_APP_BINARY=/path/to/zleap-app`，入口会直接使用它。
- 退出码与原生 CLI 一致：`2` 为普通失败，`6` 为 `COMMIT_UNKNOWN`（结果未知，先查询原操作，不要直接重试）。
