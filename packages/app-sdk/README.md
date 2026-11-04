# @zleap-ai/app-sdk

zleapOS 云开发应用的前端 SDK。应用运行在 zleapOS 的 sandbox iframe 里，SDK 通过与宿主窗口的消息通道访问平台能力，不发网络请求。

```bash
npm i @zleap-ai/app-sdk
```

用 `npm create zleap-app@latest` 生成的项目已经装好并封装在 `src/cloud/` 里。

## 入口

| 导入路径 | 内容 |
| --- | --- |
| `@zleap-ai/app-sdk` | Cloud SDK：`zl.cloud.init` / `os.ready` / `database()`（查询、写入、watch）/ `uploadFile` / `downloadFile` / `callFunction`，以及 `CloudError` |
| `@zleap-ai/app-sdk/host` | 宿主能力：`connectHostedApp()`（剪贴板等，需在 manifest 声明权限） |
| `@zleap-ai/app-sdk/workspace` | 工作区：`connectWorkspace()`，在用户选定的文件夹内列出、整理文件（`workspace.files`），读取图片 `readImage()`（另需 `workspace.images.read`） |

```ts
import { zl, CloudError } from '@zleap-ai/app-sdk';

zl.cloud.init({ env: zl.cloud.DYNAMIC_CURRENT_ENV });
const capabilities = await zl.cloud.os.ready();
const db = zl.cloud.database();
const { data } = await db.collection('todos').orderBy('created_at', 'desc').limit(20).get();
```

完整说明见 zleapOS 云开发文档；类型定义在 `dist/types/`。

## 约束

- 只能在 zleapOS 桌面里运行；浏览器直接打开时握手会超时（`CALL_TIMEOUT`）。
- 环境永远用 `DYNAMIC_CURRENT_ENV`，由宿主决定 dev / prod。
- 产物不使用 `eval` / `new Function`，符合应用沙箱的 CSP。
- 出错时抛 `CloudError`：`errCode` 是错误码，`errMsg` 固定为 `App Cloud: <errCode>`。宿主不把服务端的中文说明和「下一步」传给应用，
  给用户看的提示请按 `errCode` 在应用里维护（脚手架模板 `src/cloud/client.ts` 的 `describeError` 可作参考）。完整错误码见文档「状态与错误码」。

## 版本与许可

与 `@zleap-ai/app-cli` 同版本发布。专有许可，仅限在 zleapOS 应用中使用，见 [LICENSE](./LICENSE)。
