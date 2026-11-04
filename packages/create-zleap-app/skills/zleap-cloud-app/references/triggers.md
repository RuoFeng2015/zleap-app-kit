<!-- 由 zleap-app-kit/scripts/sync-skill-references.mjs 从云开发文档站 reference/triggers.md 生成，请改文档站后重新同步 -->

# 触发器

**触发器**让后台能力**自动运行**，而不需要有人手动点。

## 两种触发器

| 类型                  | 触发条件               | 配置字段            |
| --------------------- | ---------------------- | ------------------- |
| **定时**（scheduled） | 到达 cron 指定的时间点 | `cron` + `timezone` |
| **事件**（event）     | 收到指定名称的事件     | `event`             |

## 声明 vs 启用

这是理解触发器的关键：**两件事，两个地方**。

```
① 声明    在 manifest.json 里写 triggers.scheduled[] / triggers.events[]
          ↓  上传新版本并安装（或更新）到该版本
② 授权    启用触发器指向的后台能力（应用窗口「权限」或控制台「允许后台运行」）
          ↓
③ 启用    在云开发控制台对应能力的「触发器」里打开开关，填运行参数
          ↓
④ 运行    平台按声明自动提交后台调用
```

> **只声明不启用 = 不会跑**（危险）
>
> Manifest 里的 `enabled: false` 只是声明时的初始值。
> **真正决定跑不跑的是控制台里的启用状态。**

## 第一步：在 Manifest 里声明

```json
"background": {
  "on_install": "disabled",
  "modes": ["on_demand", "scheduled"]
},
"triggers": {
  "scheduled": [
    {
      "id": "sla_patrol",
      "cron": "*/30 * * * *",
      "timezone": "Asia/Shanghai",
      "capability": "com.example.my-app.sla-scan",
      "data": { "window": "30m" },
      "description": "每 30 分钟巡检超时工单",
      "enabled": false
    }
  ],
  "events": []
}
```

### 字段说明

| 字段                | 必填 | 说明                                                                                                                                                                       |
| ------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | ✅   | 触发器标识，控制台启用时按它找到这条声明。只能用小写字母、数字、下划线，小写字母开头，≤64（`^[a-z][a-z0-9_]{0,63}$`），**不能含 `-`**：上传时不检查，但启用时会被拒        |
| `cron`              | 定时 | 五段 cron 表达式                                                                                                                                                           |
| `timezone`          | 定时 | IANA 时区名，如 `Asia/Shanghai`                                                                                                                                            |
| `event`             | 事件 | 事件名称                                                                                                                                                                   |
| `capability`        | ✅   | 要调用的能力 ID                                                                                                                                                            |
| `data`              |      | 传给能力的输入，**≤8 KiB**                                                                                                                                                 |
| `description`       |      | 说明文字                                                                                                                                                                   |
| `enabled`           |      | 初始值，实际由控制台管理                                                                                                                                                   |
| `user_configurable` |      | `true` 时线上（生产环境）的**每个使用者**都能自己开关这个任务，见下文[线上定时任务](#线上定时任务-使用者自己开关)；不写或 `false` 时只在开发环境由开发者使用。只能是布尔值 |
| `overlap`           |      | 可省略；写了只能是 `"forbid"`                                                                                                                                              |
| `misfire`           |      | 可省略；写了只能是 `"skip"`                                                                                                                                                |

`scheduled` 和 `events` 各**最多 32 个**。

### `background.modes` 必须包含对应模式

| 触发器类型 | `modes` 必须包含 |
| ---------- | ---------------- |
| 定时       | `"scheduled"`    |
| 事件       | `"events"`       |

否则控制台保存时报 **`TRIGGER_MODE_NOT_DECLARED`**。

## 第二步：在控制台启用

见 云开发控制台 · 触发器（文档站 /console/functions#触发器）。

控制台直接列出 Manifest 为每项能力声明的触发器，**ID、cron、时区、事件名都取自声明，不用手填**。
打开触发器开关，在抽屉里按能力的 `input_schema` 填写**运行参数**（不超过 8 KB 的 JSON 对象），
点「**启用触发器**」即可。

启用时控制台和服务端仍会把提交的触发器和 Manifest **逐项比对**，任何不一致都会被拒绝。
因为配置来自声明，出现下面的错误通常说明 **Manifest 本身需要修改**：

| 不一致项                        | 错误码                       |
| ------------------------------- | ---------------------------- |
| `id` 或 `capability` 对不上     | `TRIGGER_NOT_DECLARED`       |
| `cron` 表达式不同               | `TRIGGER_SCHEDULE_MISMATCH`  |
| `timezone` 不同                 | `TRIGGER_TIMEZONE_MISMATCH`  |
| `event` 名称不同                | `TRIGGER_EVENT_MISMATCH`     |
| `modes` 不含该模式              | `TRIGGER_MODE_NOT_DECLARED`  |
| 策略不是 forbid/skip            | `TRIGGER_POLICY_UNSUPPORTED` |
| cron / 时区无法解析             | `TRIGGER_SCHEDULE_INVALID`   |
| 事件名不合规                    | `TRIGGER_EVENT_INVALID`      |
| 事件不在 `events.subscribes` 里 | `EVENT_NOT_DECLARED`         |
| 运行参数超过 8 KiB              | `EVENT_INPUT_TOO_LARGE`      |

> **`capability` 决定触发器出现在哪**（注意）
>
> Manifest 声明的是**哪个能力**被触发。控制台只在这项能力的「触发器」子标签里显示它——
> `capability` 写错了，触发器就会出现在别的能力下面，或者根本找不到。

### 前置条件

启用触发器需要：

1. 触发器指向的**后台能力已启用**：在应用窗口「权限」的「后台能力（定时任务 / 云函数）」里勾选，
   或在 后台能力面板（文档站 /console/functions#后台能力） 点「允许后台运行」（安装时后台能力一律是停用）；
2. 如果该能力的 provider 是云函数（`managed_function`），当前安装还要绑定**就绪**的签名发布，否则执行时报 `FUNCTION_RELEASE_REQUIRED`。
   appid 应用由平台在上传时自动签名、安装 / 切换版本 / 授权时自动绑定，不需要手动操作；旧 `app_key` 应用要在版本与激活（文档站 /console/legacy-release#激活开发）完成「激活开发」；
3. Manifest 里**确实声明了**这个触发器；
4. `background.modes` 包含对应模式。

## 默认策略

触发器的行为由两个策略决定，**目前只支持一组取值**：

| 策略      | 取值         | 含义                       |
| --------- | ------------ | -------------------------- |
| `overlap` | **`forbid`** | 上一次没跑完，下一次不启动 |
| `misfire` | **`skip`**   | 错过的时间点不补跑         |

> **「禁止重叠」为什么是默认**（提示）
>
> 如果允许重叠，一个慢任务会不断堆积实例，最终把配额吃光。
> 禁止重叠保证了任何时刻最多一个实例在跑。
>
> 代价是：任务执行时间超过触发间隔时，**中间的时间点会被跳过**。
> 如果你的任务可能跑很久，把间隔设大一些。

## 事件触发器的特性

事件触发器有一条特殊保证：

> **事件重复投递复用同一调用，不重跑未知写入。**

意思是：同一个事件被投递两次，平台**不会**执行两次业务逻辑，
而是复用第一次的调用记录。

> **为什么需要这个**（提示）
>
> 事件投递通常至少一次（at-least-once）。没有这层去重，
> 你的业务逻辑就得自己处理重复——很容易漏掉。
> 平台在投递层做了去重。

### 事件名称的规则

必须匹配 `^[a-z][a-z0-9_.]{0,63}$`：

- 小写字母开头
- 只能包含小写字母、数字、下划线、点
- 最长 64 位

正例：`support.ticket.updated`、`my_app.scan.done`
反例：`TicketUpdated`（大写）、`1st.event`（数字开头）、`my-app.scan.done`（含 `-`）

不合规的事件名在启用时报 `TRIGGER_EVENT_INVALID`。

### 订阅关系

事件要生效，Manifest 里必须同时声明**订阅**：

```json
"events": {
  "publishes": [{ "id": "support.ticket.updated" }],
  "subscribes": [{ "id": "support.ticket.updated" }]
}
```

各最多 64 个。事件触发器所监听的事件名**必须在 `subscribes` 里恰好出现一次**（按 `id` 匹配，也接受 `name`；两者都写时必须相同），
否则报 `EVENT_NOT_DECLARED`（两者不同报 `EVENT_DECLARATION_AMBIGUOUS`）。

## 线上定时任务：使用者自己开关

上面的「在控制台启用」是开发者在**开发环境**调试用的。应用上线后，要不要让使用者也能用某个定时 / 事件任务，**由开发者决定**：
在触发器声明里加 `"user_configurable": true`，发布新版本即可。

```json
"triggers": {
  "scheduled": [
    {
      "id": "stats_refresh",
      "cron": "*/5 * * * *",
      "timezone": "Asia/Shanghai",
      "capability": "com.example.moments.stats",
      "data": { "source": "scheduled" },
      "description": "每 5 分钟统计我的互动",
      "user_configurable": true
    }
  ]
}
```

使用者那边：

1. 打开应用窗口顶部「**权限**」，在「后台能力」里勾选这项能力并保存（允许它在后台以自己的身份运行）；
2. 再打开「权限」，这项能力下面会出现开发者写的 `description` 和一个开关，打开就按时运行，并显示「下次运行：…」。

规则：

| 项                                | 说明                                                       |
| --------------------------------- | ---------------------------------------------------------- |
| 谁能开                            | 所有安装了应用的使用者（包括应用成员），各开各的，互不影响 |
| 以谁的身份运行                    | 开启它的使用者本人：用他的后台授权，读写他能访问的数据     |
| 时间、参数                        | 都用声明里的 `cron`、`timezone`、`data`，使用者不能改      |
| 没开放的任务                      | 生产环境里启用会被拒（`TRIGGER_NOT_USER_CONFIGURABLE`）    |
| 新版本取消了开放                  | 使用者已开启的任务在下次到点时自动停用                     |
| 撤销后台授权 / 版本升级后授权变化 | 任务暂停，与开发环境相同                                   |

开发环境的触发器仍在云开发控制台里管理，不需要 `user_configurable`。

## Cron 表达式

### 五个字段的含义

```
┌─────────── 分钟   (0-59)
│ ┌───────── 小时   (0-23)
│ │ ┌─────── 日期   (1-31)
│ │ │ ┌───── 月份   (1-12)
│ │ │ │ ┌─── 星期   (0-6，0 = 周日)
│ │ │ │ │
* * * * *
```

### 常用写法

| 表达式         | 含义            |
| -------------- | --------------- |
| `* * * * *`    | 每分钟          |
| `*/5 * * * *`  | 每 5 分钟       |
| `*/30 * * * *` | 每 30 分钟      |
| `0 * * * *`    | 每小时整点      |
| `0 9 * * *`    | 每天 09:00      |
| `0 9 * * 1-5`  | 工作日 09:00    |
| `0 0 1 * *`    | 每月 1 号 00:00 |
| `30 2 * * *`   | 每天 02:30      |

> **避开整点**（提示）
>
> 如果你的任务会打外部接口，尽量避开 `0 * * * *` 这类整点触发的写法——
> 所有人都在整点跑，容易造成尖峰。`7 * * * *` 之类的错峰写法更友好。

## 时区

必须填 **IANA 时区名称**，例如：

| 时区名             | 含义         |
| ------------------ | ------------ |
| `Asia/Shanghai`    | 中国标准时间 |
| `UTC`              | 协调世界时   |
| `America/New_York` | 美东时间     |

> **不要写 `GMT+8`**（注意）
>
> 时区必须是 IANA 名称，不能写偏移量。`GMT+8` 会导致校验失败。

### 一定要核对「接下来」

启用后，触发器卡片会显示**接下来最多 5 次**的运行时间（如「今天 14:30」「明天 02:00」，
悬停可看完整时间）。**用它验证 cron 和时区**：

```
接下来
  今天 14:30
  今天 15:00
  ...
```

这两个配置出错时**往往不会报错**——只是触发时间和你预期的不一样，
而且要等到真的触发才发现。预览能立刻暴露问题。

## 启用后会发生什么

### 不会补跑历史

> 「只处理**启用之后**的事件」「错过的时间不补跑。」

启用之前的时段不会执行。如果你需要「启用后立刻跑一次」，
在该能力详情里手动点「**试运行**」。

### 数据冻结期间

如果数据库正在执行[备份或恢复](console-database.md#备份与恢复)，数据读写会被短暂冻结。
这时触发的任务可能失败或被推迟。

## 投递记录与重新投递

已启用的触发器卡片里有「**最近投递**」，列出最近 5 次投递的时间和状态。
已产生调用的投递可以点「**查看运行**」跳到对应的运行记录。

如果某次投递彻底失败，记录会标记为 `dead`（显示为「投递失败」），旁边出现「**重新投递**」按钮。

> **重新投递 ≠ 重跑**（提示）
>
> 「重新投递」针对的是原来那次投递，平台复用原调用，**不会重跑结果未知的写入**。
> 这符合平台的一贯原则：不重复执行可能有副作用的操作。

## 完整示例：定时巡检

**Manifest：**

```json
"background": {
  "on_install": "disabled",
  "modes": ["on_demand", "scheduled"]
},
"triggers": {
  "scheduled": [
    {
      "id": "sla_patrol",
      "cron": "*/30 * * * *",
      "timezone": "Asia/Shanghai",
      "capability": "com.example.ticket-console.sla-scan",
      "data": { "window": "30m" },
      "description": "每 30 分钟巡检共享队列的 SLA 超时工单",
      "enabled": false
    }
  ],
  "events": []
}
```

**对应能力声明：**

```json
{
  "id": "com.example.ticket-console.sla-scan",
  "contract_version": "1.0.0",
  "title": "扫描 SLA 超时工单",
  "execution": "headless",
  "provider": "queue.slaPatrol",
  "effect": "write",
  "discoverable": true,
  "input_schema": {
    "type": "object",
    "properties": { "window": { "type": "string", "maxLength": 64 } },
    "additionalProperties": false
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "scanned": { "type": "integer" },
      "breached": { "type": "integer" },
      "escalated": { "type": "integer" }
    },
    "required": ["scanned", "breached", "escalated"],
    "additionalProperties": false
  }
}
```

**控制台操作：**

1. 云函数 → 后台能力，选中「扫描 SLA 超时工单」，点「**允许后台运行**」；
2. 点「**试运行**」，输入 `window` 为 `30m`，确认运行记录里的结果符合预期；
3. 切到「**触发器**」子标签，卡片标题为「**每 30 分钟**」，规则写着
   「Asia/Shanghai，上一次没结束就跳过，错过的时间不补跑。」；
4. 打开开关，运行参数填 `{"window": "30m"}`，点「**启用触发器**」；
5. 核对「接下来」的时间。

触发器 ID、cron、时区都直接取自 Manifest，**不需要在控制台里手填**。

## 常见问题

### 报 `TRIGGER_NOT_USER_CONFIGURABLE`

在生产环境开启了一个没有声明 `"user_configurable": true` 的触发器。开发者在声明里加上并发布新版本。

### 报 `TRIGGER_MODE_NOT_DECLARED`

`background.modes` 里没有 `"scheduled"`（或 `"events"`）。补上后上传新版本、把安装更新到该版本（appid 应用切换时平台自动绑定新版本的就绪发布；旧 `app_key` 应用云函数类能力还要重新「激活开发」）。

### 报 `TRIGGER_NOT_DECLARED`

Manifest 里找不到这个触发器 ID、ID 重复，或它的 `capability` 指向了别的能力。核对 Manifest。

### 报 `TRIGGER_SCHEDULE_MISMATCH`

提交的 cron 和 Manifest 里写的**不完全一致**。控制台的 cron 直接取自声明，正常情况下不会出现；
如果出现，确认当前安装的就是你修改并签名后的那个版本。

### 报 `TRIGGER_TIMEZONE_MISMATCH`

时区和 Manifest 里写的不一致。Manifest 没写 `timezone` 时，控制台按浏览器所在时区提交，
建议在声明里**显式写上时区**。

### 触发器启用了但没跑

按顺序检查：

1. 后台能力是「已允许后台运行」吗？显示「授权给的是之前安装的版本」时触发器会暂停，需要重新授权。
   切换版本后：应用中心「更新」只会让**权限变宽**的能力需要重新确认；CLI `zleap-app update` / `rollback` 会**停用全部**后台能力；
2. 云函数类能力：当前安装绑定了就绪发布吗？运行记录里出现 `FUNCTION_RELEASE_REQUIRED` 时，appid 应用在应用窗口「权限」里重新保存一次或在「版本管理」切换一次版本（平台自动补签并绑定），旧 `app_key` 应用到「版本与激活」完成「激活开发」；
3. 「接下来」的时间是不是还没到？
4. 数据库是否正在冻结（备份/恢复中）？
5. 看卡片的「最近投递」，再到 日志（文档站 /console/logs） 按调用编号查有没有执行记录。

### 任务跑太久导致漏触发

`overlap: forbid` 会跳过重叠的时间点。把 cron 间隔调大，
或把任务拆成多步、缩短单次执行时间。

## 相关

- 云函数与后台能力（文档站 /console/functions） — 在控制台配置触发器
- [云函数开发](cloud-functions.md) — 被触发的函数怎么写
- [Manifest v2 配置](manifest.md) — `triggers` 字段
- [权限与授权](permissions.md) — 后台能力授权
