# 界面：官方样式 zleap.css 与常用版式

`zleap.css` 随 `@zleap-ai/app-sdk` 分发（包内文件，符合沙箱 CSP）。颜色、圆角、字号与 zleapOS 桌面同源，
桌面切换亮 / 暗时应用窗口自动跟随（宿主把主题设到窗口上，页面里 `prefers-color-scheme` 随之变化），不需要写代码。

- vanilla：`<link rel="stylesheet" href="./sdk/zleap.css" />`（`npm install` / `npm run deploy` 自动复制到 `app/sdk/`）
- React：`import '@zleap-ai/app-sdk/zleap.css'`（放在应用自己的 css 之前）
- 原生模板：`./sdk/zleap.css`

组件类都以 `zl-` 开头；自己的样式只用 `--zl-*` 变量取色，覆盖时改变量，不改 zleap.css。

## 变量

| 变量 | 用途 |
| --- | --- |
| `--zl-bg` / `--zl-surface` | 页面底色 / 卡片、列表、输入框底色 |
| `--zl-ink` / `--zl-ink-muted` / `--zl-ink-faint` | 正文 / 次要文字 / 最弱文字 |
| `--zl-line` / `--zl-line-strong` | 分隔线 / 控件边框 |
| `--zl-accent` / `--zl-accent-text` / `--zl-accent-subtle` | 主题色 / 主题色文字 / 主题色浅底 |
| `--zl-success` `--zl-warning` `--zl-danger`（及 `-subtle`） | 成功 / 提醒 / 危险 |
| `--zl-radius-sm/md/lg/xl`、`--zl-font-xs/sm/base/lg/xl`、`--zl-shadow` | 圆角、字号、阴影 |

## 类

| 分类 | 类 |
| --- | --- |
| 版式 | `zl-page`（`--wide` / `--full`）、`zl-split`（左列表右详情）、`zl-header`、`zl-title`、`zl-subtitle`、`zl-section`、`zl-section-title`、`zl-stack`（`--sm`/`--lg`）、`zl-row`（`--between`/`--end`）、`zl-spacer`、`zl-grid`、`zl-divider` |
| 卡片 | `zl-card`（`--flat` / `--interactive`）、`zl-card-title` |
| 文字 | `zl-muted`、`zl-faint`、`zl-text-sm`、`zl-text-xs`、`zl-strong`、`zl-num`（等宽数字）、`zl-text-success`、`zl-text-danger`、`zl-ellipsis`、`zl-prose`（长文本 / AI 结果，保留换行） |
| 按钮 | `zl-btn` + `--primary` / `--danger` / `--ghost`，尺寸 `--sm` / `--lg` / `--block`；处理中加 `aria-busy="true"`（自动转圈） |
| 表单 | `zl-field`、`zl-label`、`zl-hint`、`zl-input`（行内编辑加 `--inline`；原生 `type="date"` 可用）、`zl-textarea`、`zl-select`、`zl-check`、`zl-composer`（一行输入 + 按钮）、`zl-segmented`（按钮带 `aria-pressed`）；出错加 `aria-invalid="true"` |
| 列表 | `zl-list`、`zl-list-item`（完成态 `is-done`；可点选的行用 `<button>`，选中加 `aria-current="true"`）、`zl-item-main`、`zl-item-title`、`zl-item-meta`、`zl-item-actions`（`--hover`：悬停才显示） |
| 标签 / 状态 | `zl-tag`（`--accent`/`--success`/`--warning`/`--danger`）、`zl-status`（`data-state="connecting|ready|error|preview"`） |
| 提示 | `zl-alert`（`--info`/`--success`/`--warning`/`--danger`）、`zl-toast` |
| 空 / 加载 | `zl-empty`、`zl-empty-icon`、`zl-empty-title`、`zl-empty-text`、`zl-skeleton`、`zl-spinner` |
| 数据 | `zl-stats`、`zl-stat`、`zl-stat-label`、`zl-stat-value`、`zl-progress`（内部 `<span style="width:40%">`） |
| 动效 | `zl-enter`（新出现的块淡入）；系统开启「减少动态效果」时自动关闭 |

## 版式

### 页面骨架（所有应用）

```html
<main class="zl-page">
  <header class="zl-header">
    <div>
      <h1 class="zl-title">会议纪要</h1>
      <p class="zl-subtitle">粘贴会议记录，AI 提炼要点与行动项。</p>
    </div>
    <span id="status" class="zl-status" data-state="connecting">正在连接</span>
  </header>
  <!-- 出错提示放在顶部，默认 hidden -->
  <div id="error" class="zl-alert zl-alert--danger" role="alert" hidden>
    <div><strong>出了点问题</strong><span id="error-text"></span></div>
    <button class="zl-btn zl-btn--sm" type="button">重试</button>
  </div>
  <section class="zl-section">…</section>
</main>
```

### 列表（带筛选、空状态、行内操作）

```html
<section class="zl-section">
  <div class="zl-section-title">
    <div class="zl-segmented" role="group" aria-label="筛选">
      <button type="button" aria-pressed="true">全部</button>
      <button type="button" aria-pressed="false">未完成</button>
    </div>
    <span class="zl-num zl-text-sm">3 条</span>
  </div>
  <ul class="zl-list">
    <li class="zl-list-item">
      <div class="zl-item-main">
        <span class="zl-item-title">应用开发入口周会</span>
        <span class="zl-item-meta">今天 11:24 · 2 个行动项</span>
      </div>
      <span class="zl-tag zl-tag--accent">进行中</span>
      <div class="zl-item-actions zl-item-actions--hover">
        <button class="zl-btn zl-btn--ghost zl-btn--sm" type="button">删除</button>
      </div>
    </li>
  </ul>
  <div class="zl-empty" hidden>
    <div class="zl-empty-icon" aria-hidden="true">✎</div>
    <p class="zl-empty-title">还没有纪要</p>
    <p class="zl-empty-text">把会议记录粘贴到上面，点「AI 提炼」。</p>
  </div>
</section>
```

加载中用骨架代替空白：`<ul class="zl-list"><li class="zl-list-item"><span class="zl-skeleton" style="width:60%"></span></li>…</ul>`。

### 表单 / 输入区（卡片包裹）

```html
<form class="zl-card zl-stack">
  <div class="zl-field">
    <label class="zl-label" for="title">标题</label>
    <input id="title" class="zl-input" placeholder="可留空，由 AI 生成" />
  </div>
  <div class="zl-field">
    <label class="zl-label" for="content">会议记录</label>
    <textarea id="content" class="zl-textarea" rows="6"></textarea>
    <span class="zl-hint">支持直接粘贴聊天记录。</span>
  </div>
  <div class="zl-row zl-row--end">
    <button class="zl-btn zl-btn--primary" type="submit">AI 提炼要点</button>
  </div>
</form>
```

### 左列表右详情（历史记录 + 当前项）

```html
<main class="zl-page zl-page--wide">
  <header class="zl-header">…</header>
  <div class="zl-split">
    <aside class="zl-stack--sm zl-stack">
      <button class="zl-btn zl-btn--primary zl-btn--block" type="button">新建纪要</button>
      <div class="zl-list">
        <button class="zl-list-item" type="button" aria-current="true">
          <span class="zl-item-main">
            <span class="zl-item-title zl-ellipsis">产品周会</span>
            <span class="zl-item-meta">11-06 10:30 · 3 个行动项</span>
          </span>
        </button>
        <button class="zl-list-item" type="button">…</button>
      </div>
    </aside>
    <section class="zl-card zl-stack">…选中项的详情或新建表单…</section>
  </div>
</main>
```

- 窗口窄于 720px 时自动变成上下排；左栏在宽窗口里吸顶、单独滚动；
- 列表为空时左栏放 `zl-empty`，右栏直接显示新建表单，不要两边都空。

### 行内可编辑字段（负责人、截止日期）

```html
<li class="zl-list-item">
  <div class="zl-item-main">
    <span class="zl-item-title">整理接口清单</span>
    <div class="zl-row zl-text-sm">
      <span class="zl-tag zl-tag--accent">张三</span>
      <input class="zl-input zl-input--inline" type="date" value="2026-11-07" aria-label="截止日期" />
    </div>
  </div>
  <button class="zl-btn zl-btn--sm" type="button">加入待办</button>
</li>
```

- `zl-input--inline` 平时像文字，悬停 / 聚焦才显出边框；`change` 时保存，失败把值改回并提示；
- 原生日期框 `type="date"`、`type="time"` 在沙箱里可用，弹出的日历也跟随亮 / 暗；原生下拉 `<select>` 也可用，但选项少（≤ 5）时 `zl-segmented` 更好点。

### 统计 + 占比

```html
<div class="zl-stats">
  <div class="zl-stat"><div class="zl-stat-label">本月收入</div><div class="zl-stat-value zl-text-success">8,000.00</div></div>
  <div class="zl-stat"><div class="zl-stat-label">本月支出</div><div class="zl-stat-value">44.50</div></div>
</div>
<div class="zl-stack--sm zl-stack">
  <div class="zl-row zl-row--between zl-text-sm"><span>餐饮</span><span class="zl-num zl-muted">73%</span></div>
  <div class="zl-progress"><span style="width: 73%"></span></div>
</div>
```

### AI 结果（耗时操作）

- 点击后按钮 `aria-busy="true"`，旁边一句 `<span class="zl-muted zl-text-sm">AI 正在整理，约 10–30 秒…</span>`；
- 结果放进 `zl-card`，正文用 `zl-prose`，要点用 `<ul>`，新出现的块加 `zl-enter`；
- 失败用 `zl-alert--danger` 显示原因和「重试」。

### 卡片网格（多个对象并列）

`<div class="zl-grid"><article class="zl-card zl-card--interactive">…</article>…</div>`，每张卡片：标题 `zl-card-title`、一行 `zl-item-meta`、底部 `zl-row` 放标签或操作。

## 交付前自查

1. `npm run preview` 打开，亮色、暗色各看一遍（浏览器或系统切换外观）；
2. 有数据、空、加载中、出错四种状态都能看到合理的界面；
3. 窗口缩窄到 400px 左右不出现横向滚动、按钮不挤成两行；
4. 只用 `--zl-*` 变量取色；每屏最多一个 `zl-btn--primary`；
5. 部署后在 zleapOS 里打开再看一眼（真实数据量、真实错误提示）。
