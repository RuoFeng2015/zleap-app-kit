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
| 标签 / 状态 | `zl-tag`（`--accent`/`--success`/`--warning`/`--danger`）、`zl-status`（`data-state`：connecting / ready / error / preview） |
| 提示 | `zl-alert`（`--info`/`--success`/`--warning`/`--danger`）、`zl-toast` |
| 空 / 加载 | `zl-empty`、`zl-empty-icon`、`zl-empty-title`、`zl-empty-text`、`zl-skeleton`、`zl-spinner` |
| 数据 | `zl-stats`、`zl-stat`、`zl-stat-label`、`zl-stat-value`、`zl-progress`（内部 `<span style="width:40%">`） |
| 动效 | `zl-enter`（新出现的块淡入）；系统开启「减少动态效果」时自动关闭 |

## 版式

下面的示例只示意**结构和类名**。中文都是占位，换成你应用自己的文案；凡是数据（列表、数量、时间、状态）都由代码渲染，
不要把示例里的结构连同内容原样写死在 HTML 里。每块数据都要有加载中 / 出错 / 空 / 有数据四种状态。

vanilla 示例用下面这个小工具建元素：文字一律走 `textContent`，不拼 HTML 字符串（避免把用户输入当成 HTML）。
React 直接用 JSX，`className` 写同样的类。

```js
// 建元素：h('li', { class: 'zl-list-item', onclick: fn }, 子元素或文字…)
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (value === true) el.setAttribute(key, '');
    else if (value !== false && value != null) el.setAttribute(key, value);
  }
  el.append(...children.filter((child) => child != null && child !== false));
  return el;
}
```

### 页面骨架（所有应用）

HTML 里只放固定的骨架，状态和数据由脚本填：

```html
<main class="zl-page">
  <header class="zl-header">
    <div>
      <h1 class="zl-title">应用名</h1>
      <p class="zl-subtitle">一句话说明这个应用做什么</p>
    </div>
    <span id="status" class="zl-status" data-state="connecting">
      正在连接
    </span>
  </header>
  <div id="error" class="zl-alert zl-alert--danger" role="alert" hidden>
    <div><strong id="error-title"></strong><span id="error-text"></span></div>
    <button id="retry" class="zl-btn zl-btn--sm" type="button">重试</button>
  </div>
  <section class="zl-section">…</section>
</main>
```

### 列表（筛选、空状态、行内操作）

骨架：

```html
<section class="zl-section">
  <div class="zl-section-title">
    <div id="filters" class="zl-segmented" role="group" aria-label="筛选">
      <button type="button" data-filter="all">全部</button>
      <button type="button" data-filter="open">未完成</button>
    </div>
    <span id="count" class="zl-num zl-text-sm"></span>
  </div>
  <ul id="loading" class="zl-list" aria-busy="true">
    <li class="zl-list-item">
      <span class="zl-skeleton" style="width: 60%"></span>
    </li>
    <li class="zl-list-item">
      <span class="zl-skeleton" style="width: 40%"></span>
    </li>
  </ul>
  <ul id="list" class="zl-list" hidden></ul>
  <div id="empty" class="zl-empty" hidden>
    <div class="zl-empty-icon" aria-hidden="true">＋</div>
    <p id="empty-title" class="zl-empty-title"></p>
    <p id="empty-text" class="zl-empty-text"></p>
  </div>
</section>
```

渲染（`items` 来自集合查询或 OS 接口；`remove` 是你的删除函数）：

```js
const $ = (id) => document.getElementById(id);

function row(item) {
  const actions = h('div', { class: 'zl-item-actions zl-item-actions--hover' });
  // 沙箱里不能用 confirm()：删除用行内二次确认
  const ask = () => actions.replaceChildren(
    h('button', {
      class: 'zl-btn zl-btn--danger zl-btn--sm', type: 'button',
      onclick: () => remove(item),
    }, '确认删除'),
    h('button', {
      class: 'zl-btn zl-btn--ghost zl-btn--sm', type: 'button',
      onclick: () => render(),
    }, '取消'),
  );
  actions.append(h('button', {
    class: 'zl-btn zl-btn--ghost zl-btn--sm', type: 'button', onclick: ask,
  }, '删除'));
  return h('li', { class: 'zl-list-item' + (item.done ? ' is-done' : '') },
    h('div', { class: 'zl-item-main' },
      h('span', { class: 'zl-item-title' }, item.title),
      h('span', { class: 'zl-item-meta' }, formatTime(item.updated_at)),
    ),
    item.tag && h('span', { class: 'zl-tag zl-tag--accent' }, item.tag),
    actions,
  );
}

function render() {
  const visible = items.filter((it) => filter === 'all' || !it.done);
  $('loading').hidden = true;
  $('count').textContent = items.length ? `${visible.length} 条` : '';
  $('list').replaceChildren(...visible.map(row));
  $('list').hidden = visible.length === 0;
  $('empty').hidden = visible.length > 0;
  // 空状态分两种：真的没有数据 / 筛选后没有
  $('empty-title').textContent = items.length ? '没有符合条件的' : '还没有内容';
  $('empty-text').textContent = items.length
    ? '换个筛选看看。'
    : '告诉用户下一步做什么，比如「在上面新建第一条」。';
  for (const btn of $('filters').querySelectorAll('button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.filter === filter));
  }
}
```

React 写法相同，按状态返回不同的块：

```tsx
if (loading) return <ListSkeleton />;
if (error) return <Alert tone="danger" onRetry={reload}>{error}</Alert>;
if (items.length === 0) return <Empty title="还没有内容" text="下一步做什么" />;
return (
  <ul className="zl-list">
    {items.map((item) => (
      <li key={item._id} className="zl-list-item">
        <div className="zl-item-main">
          <span className="zl-item-title">{item.title}</span>
          <span className="zl-item-meta">{formatTime(item.updated_at)}</span>
        </div>
      </li>
    ))}
  </ul>
);
```

### 表单 / 输入区（卡片包裹）

```html
<form id="form" class="zl-card zl-stack">
  <div class="zl-field">
    <label class="zl-label" for="name">字段名</label>
    <input id="name" class="zl-input" required />
  </div>
  <div class="zl-field">
    <label class="zl-label" for="body">长文本字段</label>
    <textarea id="body" class="zl-textarea" rows="6"></textarea>
    <span class="zl-hint">告诉用户怎么填</span>
  </div>
  <div class="zl-row zl-row--end">
    <button id="submit" class="zl-btn zl-btn--primary" type="submit">
      提交
    </button>
  </div>
</form>
```

提交时按钮加 `aria-busy="true"` 并禁用，结束后恢复；校验失败给对应输入框加 `aria-invalid="true"`，
在 `zl-hint` 里写原因。

### 左列表右详情（记录列表 + 当前项）

```html
<main class="zl-page zl-page--wide">
  <header class="zl-header">…</header>
  <div class="zl-split">
    <aside class="zl-stack zl-stack--sm">
      <button id="new" class="zl-btn zl-btn--primary zl-btn--block"
        type="button">新建</button>
      <div id="records" class="zl-list"></div>
    </aside>
    <section id="detail" class="zl-card zl-stack"></section>
  </div>
</main>
```

```js
function recordButton(record) {
  return h('button', {
    class: 'zl-list-item', type: 'button',
    'aria-current': record._id === selectedId ? 'true' : false,
    onclick: () => select(record._id),
  },
    h('span', { class: 'zl-item-main' },
      h('span', { class: 'zl-item-title zl-ellipsis' }, record.title),
      h('span', { class: 'zl-item-meta' }, formatTime(record.updated_at)),
    ),
  );
}
```

- 窗口窄于 720px 时自动上下排；宽窗口里左栏吸顶、单独滚动；
- 没有记录时左栏放 `zl-empty`，右栏直接显示新建表单，不要两边都空；
- 切换选中项时右栏先显示骨架，再填详情。

### 行内可编辑字段（日期、负责人这类）

```js
function dateField(item) {
  const input = h('input', {
    class: 'zl-input zl-input--inline', type: 'date',
    value: item.due ?? '', 'aria-label': '日期',
  });
  input.addEventListener('change', async () => {
    const before = item.due ?? '';
    try {
      await save(item, { due: input.value || null });
    } catch (error) {
      input.value = before; // 保存失败：值改回去并提示
      toast('没有保存：' + describe(error));
    }
  });
  return input;
}
```

- `zl-input--inline` 平时像文字，悬停 / 聚焦才显出边框，适合放在列表行里；
- 原生 `type="date"`、`type="time"` 在沙箱里可用，弹出的日历也跟随亮 / 暗；原生 `<select>` 也可用，
  选项少（≤ 5）时 `zl-segmented` 更好点。

### 统计 + 占比

数值由数据计算，骨架里留空：

```js
$('stats').replaceChildren(
  ...summary.map(({ label, value, tone }) =>
    h('div', { class: 'zl-stat' },
      h('div', { class: 'zl-stat-label' }, label),
      h('div', { class: 'zl-stat-value' + (tone ? ` zl-text-${tone}` : '') },
        value),
    ),
  ),
);
const bar = (percent) =>
  h('div', { class: 'zl-progress' },
    h('span', { style: `width: ${Math.round(percent)}%` }));
```

### AI 结果（耗时操作）

- 点击后按钮 `aria-busy="true"`，旁边一句 `<span class="zl-muted zl-text-sm">` 说明预计要多久；
- 结果放进 `zl-card`，正文用 `zl-prose`，要点用列表，新出现的块加 `zl-enter`；
- 失败用 `zl-alert--danger` 显示原因和「重试」。

### 卡片网格（多个对象并列）

`<div class="zl-grid">` 里放若干 `<article class="zl-card zl-card--interactive">`，每张卡片：标题 `zl-card-title`、
一行 `zl-item-meta`、底部 `zl-row` 放标签或操作；同样由数据渲染。

## 交付前自查

1. `npm run preview` 打开，亮色、暗色各看一遍（浏览器或系统切换外观）；
2. 有数据、空、加载中、出错四种状态都能看到合理的界面；
3. 窗口缩窄到 400px 左右不出现横向滚动、按钮不挤成两行；
4. 只用 `--zl-*` 变量取色；每屏最多一个 `zl-btn--primary`；
5. 部署后在 zleapOS 里打开再看一眼（真实数据量、真实错误提示）。
