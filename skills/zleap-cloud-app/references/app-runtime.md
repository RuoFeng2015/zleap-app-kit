<!-- 由 zleap-app-kit/scripts/sync-skill-references.mjs 从云开发文档站 reference/app-runtime.md 生成，请改文档站后重新同步 -->

# 版本更新与授权登录

应用页面里与「云数据库」无关的两类运行期能力：

- **版本更新**：`zl.app.getUpdateManager()` 检查有没有新的线上版本，提示用户、一键切换（参照微信小程序的 `wx.getUpdateManager`）；
- **授权登录**：`zl.auth.authorize()` 弹出系统授权框，用户同意后拿到头像昵称 / 手机号 / 邮箱；`zl.auth.getIdentity()` 静默拿到本应用内的用户标识 `openid`。

> **适用范围**（提示）
>
>
> - 「线上版本」由应用成员在控制台「版本管理」里「发布为线上版本」产生，见 版本管理（文档站 /console/release#版本管理）。
>   每次上传都是开发版本，还没发布时只有应用成员能用。
> - **不需要开通任何云资源**：没有数据库、云函数的纯前端应用也能用，也不需要在 Manifest 里声明权限。
> - 和 Cloud SDK 一样，只能在 zleapOS 窗口里用；浏览器直接打开页面时以 `OPEN_IN_ZLEAP_OS` 失败。
>

## 引入

```ts
import { zl, AppError } from '@zleap-ai/app-sdk';
```

原生模板（`zleap-app init hosted-package`）用随包的 `./sdk/index.js`，API 相同。

应用 iframe 通过宿主通道调用这些能力：宿主用**当前用户的会话**调用平台接口，再把结果交给应用。
应用**永远拿不到**用户令牌或平台用户 ID。

## 版本更新

### 线上版本与自动跟随

成员在控制台 版本管理（文档站 /console/release#版本管理） 里把某个开发版本「发布为线上版本」后：

| 谁                          | 怎么换到新版本                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 普通使用者（不是应用成员）  | **下次打开应用时自动跟随**：宿主先把安装切到线上版本，显示「**正在更新到最新版本…**」，再加载应用。回退同样会跟随                                                                                                                                      |
| 已经开着应用的**非成员**    | **不会立刻被打断**，继续用当前版本；应用可以用下面的更新管理器提示用户，调用 `applyUpdate()` 立即切换。新版本发布 **24 小时**后，宿主会把还开着旧版本的窗口强制切到线上版本并重新加载（显示「这个版本已超过 24 小时的使用期限，正在更新到最新版本…」） |
| 应用成员（管理员 / 开发者） | **从不自动切换**，在控制台版本管理里用「切换到此版本」自己选（只影响自己，包括同事还没发布的版本）                                                                                                                                                     |

所以不写任何代码，使用者也会在下次打开时用上新版本。更新管理器只是让「正开着的窗口」也能及时换到新版本。

非成员一直开着的旧窗口，**从新线上版本发布起最多再用 24 小时**；到期宿主会强制切换并重新加载。这个截止时间就是
`UpdateCheckResult.deadline`（毫秒时间戳）；应用成员、没有更新时为 `null`。

### 当前用的是哪个数据域

同一个应用的数据分**调试数据域**（`dev`）和**生产数据域**（`prod`）两套，互相隔离；用哪一套由宿主决定，应用代码一律写 `DYNAMIC_CURRENT_ENV`。
要确认当前窗口用的是哪一套：点应用窗口顶部的「**权限**」，对话框顶部一行就是：

- 「当前数据域：调试 —— 应用开发者调试用的数据，与正式使用的数据相互隔离。」
- 「当前数据域：正式 —— 本应用全体使用者的数据，共享集合按规则对其他使用者可见。」

应用成员装的是**还没发布的开发版本**时用调试数据域；装的版本**已发布为线上版本**后改用生产数据域（关掉窗口重新打开后生效），
开发时写的数据留在调试数据域，不会带过去。普通使用者一律用生产数据域。完整规则见 核心概念 · 环境与数据域（文档站 /guide/concepts#环境-environment-与数据域）。

### `zl.app.getUpdateManager()`

返回全局唯一的更新管理器（多次调用返回同一个）：

```ts
interface UpdateManager {
  onCheckForUpdate(callback: (result: UpdateCheckResult) => void): void;
  onUpdateReady(callback: (result: UpdateCheckResult) => void): void;
  onUpdateFailed(callback: (error: AppError) => void): void;
  applyUpdate(): Promise<void>;
}

interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string | null; // 当前安装的版本号
  latestVersion: string | null; // 线上版本号；还没发布过时为 null
  notes: string | null; // 线上版本的发布说明
  deadline: number | null; // 旧版本可用到的时间（毫秒时间戳）= 发布时间 + 24 小时；成员或没有更新时为 null
}
```

| 方法               | 说明                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `onCheckForUpdate` | 第一次获取更新管理器时，宿主检查一次，结果交给这个回调。回调注册得晚也会收到上一次的结果                                                   |
| `onUpdateReady`    | 有新的线上版本可用时回调：检查时就发现有更新；或者应用**正在使用中**有成员发布了新版本（宿主大约每 20 秒检查一次，同一个新版本只通知一次） |
| `onUpdateFailed`   | 连不上宿主（如 `OPEN_IN_ZLEAP_OS`、`HOST_UNAVAILABLE`），或 `applyUpdate()` 切换失败时回调                                                 |
| `applyUpdate()`    | 把当前安装切到线上版本，并**重新加载应用**。没有新版本时什么也不做。失败时既回调 `onUpdateFailed`，也以 `AppError` 拒绝                    |

```ts
const updater = zl.app.getUpdateManager();

updater.onCheckForUpdate(({ hasUpdate, currentVersion, latestVersion }) => {
  console.log('当前', currentVersion, '线上', latestVersion, hasUpdate ? '有更新' : '已是最新');
});

updater.onUpdateReady(({ latestVersion, notes }) => {
  // 应用自己画提示（沙箱里不能用 confirm）
  showBanner({
    text: `新版本 v${latestVersion} 已发布${notes ? `：${notes}` : ''}`,
    action: '立即更新',
    onAction: () => void updater.applyUpdate(), // 切换后应用会重新加载
  });
});

updater.onUpdateFailed((error) => {
  console.warn('更新失败', error.errCode);
});
```

只想检查一次、不注册回调时用 `zl.app.checkUpdate()`，它返回同样的 `UpdateCheckResult`：

```ts
const { hasUpdate, latestVersion } = await zl.app.checkUpdate();
```

> **`hasUpdate` 什么时候为 `true`**（说明）
>
> 当前安装的版本**不是**线上版本，且：
>
> - 你不是应用成员；或
> - 你是成员，但装着的是一个**以前发布过**的版本。成员装着自己（或同事）还没发布的开发版本时不提示更新。
>
> 应用还没有线上版本时，`hasUpdate` 为 `false`、`latestVersion` 为 `null`。

> **使用中的发布通知要先连上通道**（注意）
>
> 宿主对开着的窗口大约每 20 秒检查一次（到了 24 小时宽限就强制更新，与应用代码无关）。但 `onUpdateReady` 通知只在应用已经调用过 `zl.app` / `zl.auth` 的接口（连上了宿主通道）后才会送达。想收到使用中的发布通知，在页面启动时就调用 `getUpdateManager()`。

> **用 `deadline` 提醒用户**（提示）
>
> `onUpdateReady` 给出的 `deadline` 是旧版本还能用到的时间。应用可以据此提示「将在 xx 时自动更新」，让用户先保存手头的内容。

## 授权登录

### 先在 Manifest 里声明

要申请哪些信息，就在 `manifest.json` 的 `host_api.requires` 里声明对应的项，没声明的申请以 `AUTH_SCOPE_UNDECLARED` 失败：

```json
{
  "host_api": {
    "profile": "app-runtime/2",
    "requires": ["user.profile", "user.phone"]
  }
}
```

| 声明           | 可以申请                |
| -------------- | ----------------------- |
| `user.profile` | `profile`（头像和昵称） |
| `user.phone`   | `phone`（手机号）       |
| `user.email`   | `email`（邮箱）         |

声明不等于拿到：安装时用户看到的是「使用时可能申请你的手机号（由你决定是否同意）」，真正给不给由用户在授权框里决定。
只声明真正要用的项。

### `zl.auth.authorize({ scopes, reason })`

申请用户信息。`scopes` 是 `'profile'`（头像和昵称）、`'phone'`（手机号）、`'email'`（邮箱）中的一个或多个；
`reason` 是显示在授权框里的用途说明（可选，最多 60 字）：

```ts
loginButton.addEventListener('click', async () => {
  try {
    const me = await zl.auth.authorize({
      scopes: ['profile', 'phone'],
      reason: '用于预订成功后短信通知你',
    });
    me.openid; // 'o_' + 22 个字符
    me.profile?.nickname;
    me.profile?.avatarUrl; // 可能为 null
    if (me.scopes.includes('phone')) me.phone; // 用户同意了手机号
  } catch (error) {
    if (error instanceof AppError && error.errCode === 'AUTH_DENIED') {
      // 用户点了「拒绝」：按未登录处理，不要反复弹
    } else throw error;
  }
});
```

> **必须在用户点击时调用**（注意）
>
> 需要弹框时，宿主要求这次调用紧跟在用户的点击或按键之后（几秒内），否则以 `AUTH_GESTURE_REQUIRED` 失败——
> 不能在页面加载时自动弹授权框。已经同意过、不需要弹框的申请不受这个限制。

返回值：

```ts
interface AuthResult {
  openid: string;
  scopes: ('profile' | 'phone' | 'email')[]; // 本次实际拿到的范围
  profile?: { nickname: string; avatarUrl: string | null };
  phone?: string | null;
  email?: string | null;
}
```

- **只返回本次申请、且用户同意了的范围**：以前同意过 `email`，这次只申请 `profile`，结果里也不会带 `email`。
- **用户可以只同意一部分**：授权框里每一项都可以取消勾选。取消的项不在 `scopes` 里，结果里也没有对应字段；
  只要同意了一项，`authorize` 就成功返回。**以 `scopes` 为准**判断拿到了什么。
- **没绑定的不返回**：用户账号没绑定手机号 / 邮箱时，授权框里这一项置灰（「未绑定手机号」），结果里没有这一项。

### 系统授权框

申请里有用户还没同意过的范围时，宿主弹出系统授权框：

> **「{应用名}」申请获取你的以下信息**
>
> 同意后，应用会拿到下面这些信息，用来识别你的身份或联系你。

下面逐行列出要确认的项目和**用户自己的值**，每行前面有勾选框（默认全选）；有 `reason` 时显示「用途：…」。
没绑定的手机号 / 邮箱置灰显示「未绑定手机号」/「未绑定邮箱」。底部按钮「**拒绝**」/「**允许**」，全部取消勾选时「允许」不可点。

| 情况                                         | 行为                                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 申请的范围都同意过                           | **不弹框**，直接返回                                                                                 |
| 部分同意过，又申请了新范围                   | 弹框，**只列出新申请的那几项**                                                                       |
| 用户点「拒绝」                               | 以 `AppError`（`errCode` 为 `AUTH_DENIED`）拒绝                                                      |
| 用户取消勾选了一部分再点「允许」             | 成功，`scopes` 里只有勾选的项；取消的项按拒绝记录                                                    |
| 拒绝过的项 24 小时内再申请                   | **不弹框**，直接 `AUTH_DENIED`（防止反复打扰）。用户在「已授权信息」里点「允许再次询问」可以提前解除 |
| 不是在用户点击后调用                         | `AUTH_GESTURE_REQUIRED`                                                                              |
| 申请了 Manifest 没声明的项                   | `AUTH_SCOPE_UNDECLARED`                                                                              |
| 授权框还开着时又调用 `authorize`             | 以 `AUTH_IN_PROGRESS` 拒绝                                                                           |
| `scopes` 为空或含其他值、`reason` 超过 60 字 | 以 `SCHEMA_INVALID` 拒绝                                                                             |

用户考虑的时间不计入超时，`authorize` 会一直等到用户点按钮。

### `zl.auth.getIdentity()`

不弹框，静默返回 `openid`，以及用户**之前已同意**的范围的信息：

```ts
const { openid, scopes, profile } = await zl.auth.getIdentity();
if (!scopes.includes('profile')) {
  // 还没同意过头像昵称：在用户点「登录」时再 authorize
}
```

适合用 `openid` 作为应用里的用户键（例如共享集合里标记「谁创建的」），而不必打扰用户。

### openid

| 性质     | 说明                                                           |
| -------- | -------------------------------------------------------------- |
| 格式     | `o_` + 22 个字符                                               |
| 稳定     | 同一用户在同一应用里不变，**开发版本和线上版本一致**           |
| 隔离     | 同一用户在不同应用里的 `openid` 不同，应用之间无法据此关联用户 |
| 不可反推 | 应用拿不到平台用户 ID 和令牌，也不能从 `openid` 还原它们       |

> **和集合里的 `_openid` 不是同一个值**（说明）
>
> 云数据库文档里的 `_openid` 是数据域里的写入者标识，按环境（开发 / 正式）分开生成，用于集合权限规则；
> 授权登录的 `openid` 按应用生成、开发版本和线上版本一致。在应用里标记「谁创建的」时，二者选一种用到底，不要混着比较。

### 用户管理已授权信息

用户同意过（或 24 小时内拒绝过）之后，应用窗口顶部会出现「**已授权信息**」按钮，打开后显示「你已允许这个应用获取：」和已授权的项目，
以及 24 小时内拒绝过的项目。按钮是「**撤销授权**」（只有拒绝记录时是「**允许再次询问**」）：撤销后授权和拒绝记录都清除，
下一次 `authorize` 会重新弹出授权框；`getIdentity()` 仍返回 `openid`，但不再带之前的信息。
同意记录按「用户 × 应用」保存，切换版本不需要重新同意。

每次同意、拒绝、撤销，平台都会记审计日志（只记范围，不记手机号等具体值）。
应用成员可以在云开发控制台「[用户授权](console-members.md#用户授权)」里看到同意人数和撤销人数，看不到具体用户和值。

见 安装与卸载 · 已授权信息（文档站 /app-center/install#已授权信息）。

### 在云函数里读取（暂不可用）

当前云函数服务端 SDK（`@zleap/app-cloud-server`）只有 `init`、`getContext`、`getLogger`、`os.database`，
**没有 `zl.cloud.auth` 命名空间**：`getOpenId()` / `getUserInfo()` 都不可用，函数也拿不到用户在前端授权框里同意的信息。

需要 `openid` 时用下面的替代方式：

1. **页面取，作为输入传**：页面用 `zl.auth.getIdentity()`（或 `authorize()`）拿到 `openid`，放进能力的 `input`：

   ```js
   const me = await zl.auth.getIdentity();
   await zl.cloud.os.capabilities.invoke({
     id: 'com.example.my-app.record',
     input: { openid: me.openid },
   });
   ```

2. **用文档自带的 `_openid`**：数据库文档都有写入者 `_openid`。示例 `examples/moments` 的 `stats` 就是从私有集合 `me/profile` 里读出 `_openid` 再统计的。

注意：

- 由页面传入的 `openid`、手机号、邮箱都只是**业务参数**，函数无法再向平台核验；不要把前端传来的手机号当成平台认证过的身份。
- 撤销授权后页面 `getIdentity()` 仍返回 `openid`，但不再带之前同意的信息；云函数没有可读取授权信息的接口。
- `getContext().userId` 是平台内部用户 ID，**已废弃**，新应用不要用它作为业务用户键。

## 复制到剪贴板

### `zl.app.setClipboardData({ data })`

沙箱里 `navigator.clipboard` 与 `execCommand('copy')` 都不可用，由宿主窗口代写系统剪贴板。

- Manifest `host_api.requires` 声明 `clipboard.write`（`host_api.profile` 为 `app-runtime/2`）；
- 必须在用户点击 / 按键之后立即调用，否则 `CLIPBOARD_GESTURE_REQUIRED`；
- `data` 是 1–32768 字的文本，可以含换行和制表符，不能含其他控制字符，否则 `SCHEMA_INVALID`；
- 没声明 `clipboard.write` 时 `SCOPE_FORBIDDEN`；成功时 Promise resolve，没有返回值。只能写，不能读剪贴板。

```ts
button.addEventListener('click', () =>
  zl.app.setClipboardData({ data: text }).then(() => toast('已复制')),
);
```

## 错误码

`zl.app` / `zl.auth` 失败时抛出 `AppError`，用 `errCode` 分流（`message` 只用于调试）：

| errCode                      | 含义                                                                             | 处理                                       |
| ---------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------ |
| `AUTH_DENIED`                | 用户在授权框里点了「拒绝」                                                       | 按未授权处理，等用户主动操作时再申请       |
| `AUTH_IN_PROGRESS`           | 授权框已经打开，又发起了一次 `authorize`                                         | 等上一次结果，不要并发调用                 |
| `AUTH_GESTURE_REQUIRED`      | 需要弹授权框，但调用不是紧跟在用户点击 / 按键之后                                | 放到按钮的点击事件里调用                   |
| `CLIPBOARD_GESTURE_REQUIRED` | `setClipboardData` 不是紧跟在用户点击 / 按键之后                                 | 放到按钮的点击事件里调用                   |
| `AUTH_SCOPE_UNDECLARED`      | 申请了 Manifest `host_api.requires` 没声明的 `user.*` 项                         | 补上声明，重新上传                         |
| `SCHEMA_INVALID`             | `scopes` 为空或含 `profile` / `phone` / `email` 以外的值，或 `reason` 超过 60 字 | 改代码                                     |
| `OPEN_IN_ZLEAP_OS`           | 不在 zleapOS 窗口里（例如浏览器直接打开、`npm run dev`）                         | 部署后从启动台打开                         |
| `HOST_UNAVAILABLE`           | 宿主 15 秒内没有响应（宿主版本过旧）                                             | 升级 zleapOS 后重试                        |
| `RUNTIME_UNAVAILABLE`        | 通道已关闭、窗口已不是当前实例，或平台接口暂不可用                               | 稍后重试；仍失败时重新打开应用             |
| `CALL_TIMEOUT`               | 调用超时（一般 30 秒，`applyUpdate` 60 秒）                                      | 可以重试                                   |
| `UPDATE_FAILED`              | `applyUpdate()` 切换失败（宿主报告的失败也可能是 `RUNTIME_UNAVAILABLE`）         | 提示用户重新打开应用，或到应用中心手动更新 |
| `UNSUPPORTED_OPERATION`      | 宿主不支持这个方法                                                               | 升级 zleapOS                               |

## 平台接口（供参考）

应用**不直接调用**这些接口，下表用于理解行为和排查。

| 接口                                                            | 谁调用                                 | 说明                                                                                                                           |
| --------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/apps/installations/{installation_id}/update-check` | 宿主（安装的所有者）                   | 返回 `current_version`、`latest_version`、`has_update`、`member`、`notes`、`published_at` 等，宿主的自动跟随和更新管理器都用它 |
| `GET /api/v1/apps/installations/{id}/auth/identity`             | 宿主，用用户会话；**应用不能直接调用** | `openid` 与已同意范围的信息                                                                                                    |
| `POST /api/v1/apps/installations/{id}/auth/preview`             | 同上                                   | 请求体 `{scopes}`，返回授权框要展示的内容                                                                                      |
| `POST /api/v1/apps/installations/{id}/auth/authorize`           | 同上                                   | 请求体 `{scopes}`，用户点「允许」后调用                                                                                        |
| `POST /api/v1/apps/installations/{id}/auth/deny`                | 同上                                   | 请求体 `{scopes}`，用户拒绝或取消勾选的项；24 小时内同一应用再申请不弹框                                                       |
| `DELETE /api/v1/apps/installations/{id}/auth/consent`           | 同上                                   | 撤销对该应用的授权（「撤销授权」），同时清除拒绝记录                                                                           |
| `GET /api/v1/app-cloud/apps/{app_id}/auth-stats`                | 控制台（应用成员）                     | 同意人数、各项人数、撤销人数                                                                                                   |

发布与版本列表接口见 版本管理 · 接口（文档站 /console/release#接口）。

## 相关

- 版本管理（文档站 /console/release#版本管理） — 发布线上版本、回退
- 安装与卸载（文档站 /app-center/install） — 自动跟随、已授权信息
- [状态与错误码](status-codes.md#版本更新与授权登录)
