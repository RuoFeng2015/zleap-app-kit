// 应用页面：运行在 zleapOS 的沙箱 iframe 里。Cloud SDK 与官方样式 zleap.css 由 npm run deploy / npm install
// 从 node_modules/@zleap-ai/app-sdk 复制到 ./sdk/，不要手改 ./sdk/。
//
// 平台约束（不要绕过）：不能 fetch、不能用 localStorage、不能 alert / confirm；环境用 DYNAMIC_CURRENT_ENV；
// 每次读最多 100 条，用 skip 翻页；更新 / 删除带 expectedVersion；COMMIT_UNKNOWN 时先刷新核对，不要自动重试。
//
// 界面：用 zleap.css 的 zl- 类；每块数据处理四种状态——加载中（骨架）、出错（说明 + 重试）、空（引导下一步）、有数据。
// 浏览器直接打开（npm run preview）是预览模式，数据来自 ./preview.js 的示例；在 zleapOS 里永远是真实数据。
import { CloudError, zl } from './sdk/index.js';
import { isPreview, previewDatabase } from './preview.js';

const COLLECTION = 'todos'; // 结构在 manifest.json 的 data.schemas.todos
const PAGE_SIZE = 100;

const $ = (id) => document.getElementById(id);
const db = () => (isPreview ? previewDatabase : zl.cloud.database());
const todos = () => db().collection(COLLECTION);

let rows = [];
let filter = 'all';
let busy = false;

/** 面向用户的中文说明，不拼英文错误码（错误码在 error.errCode）；宿主只给错误码，没列出的码给通用提示。 */
function describeError(error) {
  const code = error instanceof CloudError ? error.errCode : error?.errCode ?? (error instanceof Error ? error.message : String(error));
  const hints = {
    SCOPE_FORBIDDEN: '还没有这项权限：点应用窗口顶部「权限」，勾选后保存（应用会自动重新加载）。',
    PUBLISHER_REQUIRED: '开发数据只对应用成员开放；给其他人用请在云开发控制台「版本管理」里发布为线上版本。',
    ENV_FORBIDDEN: '这个应用还没有上线：请应用成员在云开发控制台「版本管理」里把版本发布为线上版本。',
    RESOURCE_NOT_READY: '云数据库正在开通，通常部署后一分钟内就绪；这个窗口不会自动刷新，稍等后点窗口顶部「重新加载应用」。',
    UNSUPPORTED_OPERATION: '数据库还没连上：通常是部署后数据库还在开通（一分钟内就绪），稍等后点窗口顶部「重新加载应用」；仍不行就检查窗口顶部「权限」里是否勾选了数据读写。',
    COLLECTION_NOT_FOUND: '数据集合还没建好：开发环境稍等一分钟后点窗口顶部「重新加载应用」；线上版本请应用成员重新发布一次（发布时自动建生产集合）。',
    SCHEMA_INVALID: '数据不符合集合结构（字段缺失、类型不对、内容过大或多了未声明字段）。',
    VERSION_CONFLICT: '数据已在别处更新，请刷新后再改。',
    COMMIT_UNKNOWN: '保存结果未知，请刷新核对后再决定是否重试。',
    CALL_TIMEOUT: '连接宿主超时：请从 zleapOS 桌面打开应用。',
    RUNTIME_UNAVAILABLE: '云服务暂时不可用，请稍后重试。',
    RELEASE_UNAVAILABLE: '应用版本已切换，请重新加载应用。',
  };
  return hints[code] ?? '操作没有完成，请稍后重试。';
}

function showError(error, title = '出了点问题') {
  $('error').hidden = !error;
  if (!error) return;
  $('error-title').textContent = title;
  $('error-text').textContent = describeError(error);
}

function setStatus(state, text) {
  $('status').dataset.state = state;
  $('status').textContent = text;
}

/** 操作成功的轻提示，2 秒后消失（沙箱里不能用 alert）。 */
function toast(text) {
  document.querySelector('.zl-toast')?.remove();
  const node = document.createElement('div');
  node.className = 'zl-toast';
  node.setAttribute('role', 'status');
  node.textContent = text;
  document.body.append(node);
  setTimeout(() => node.remove(), 2000);
}

function formatTime(ms) {
  if (!ms) return '';
  const date = new Date(ms);
  return date.toDateString() === new Date().toDateString()
    ? `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

async function listTodos(maxPages = 10) {
  const out = [];
  for (let page = 0; page < maxPages; page += 1) {
    const { data } = await todos().orderBy('created_at', 'desc').skip(page * PAGE_SIZE).limit(PAGE_SIZE).get();
    out.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return out;
}

function button(text, className, onClick) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = `zl-btn zl-btn--sm ${className}`;
  node.textContent = text;
  node.disabled = busy;
  node.addEventListener('click', onClick);
  return node;
}

function renderRow(row) {
  const item = document.createElement('li');
  item.className = `zl-list-item${row.done ? ' is-done' : ''}`;

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'zl-check';
  box.checked = Boolean(row.done);
  box.disabled = busy;
  box.setAttribute('aria-label', `完成：${row.title}`);
  box.addEventListener('change', () =>
    mutate(
      () => todos().doc(row._id).update({ data: { done: box.checked }, agentos: { expectedVersion: row._version } }),
      box.checked ? '已完成' : '已恢复',
    ),
  );

  const main = document.createElement('div');
  main.className = 'zl-item-main';
  const title = document.createElement('span');
  title.className = 'zl-item-title';
  title.textContent = String(row.title ?? '');
  const meta = document.createElement('span');
  meta.className = 'zl-item-meta';
  meta.textContent = formatTime(row.created_at);
  main.append(title, meta);

  // 沙箱里不能用 confirm()：危险操作用行内二次确认。
  const actions = document.createElement('div');
  actions.className = 'zl-item-actions zl-item-actions--hover';
  const askRemove = button('删除', 'zl-btn--ghost', () => {
    actions.className = 'zl-item-actions';
    actions.replaceChildren(
      button('确认删除', 'zl-btn--danger', () =>
        mutate(() => todos().doc(row._id).remove({ agentos: { expectedVersion: row._version } }), '已删除'),
      ),
      button('取消', 'zl-btn--ghost', () => render()),
    );
  });
  actions.append(askRemove);

  item.append(box, main, actions);
  return item;
}

function render() {
  const visible = rows.filter((row) => (filter === 'all' ? true : filter === 'done' ? row.done : !row.done));
  const done = rows.filter((row) => row.done).length;
  $('summary').textContent = rows.length ? `${done} / ${rows.length} 已完成` : '';
  $('list').replaceChildren(...visible.map(renderRow));
  $('list').hidden = visible.length === 0;
  $('empty').hidden = visible.length > 0;
  $('empty-title').textContent = rows.length === 0 ? '还没有待办' : '这里没有内容';
  $('empty-text').textContent = rows.length === 0 ? '在上面写下第一件想完成的事。' : '换个筛选条件看看。';
  for (const node of $('filters').querySelectorAll('button')) node.setAttribute('aria-pressed', String(node.dataset.filter === filter));
}

async function refresh() {
  try {
    rows = await listTodos();
    showError(null);
  } catch (error) {
    rows = [];
    showError(error, '读取失败');
  }
  $('loading').hidden = true;
  render();
}

async function mutate(action, success) {
  if (busy) return;
  busy = true;
  $('add-button').setAttribute('aria-busy', 'true');
  try {
    await action();
    toast(success);
  } catch (error) {
    showError(error, '操作失败');
  }
  busy = false;
  $('add-button').removeAttribute('aria-busy');
  await refresh();
}

async function connect() {
  if (isPreview) {
    setStatus('preview', '预览模式');
    $('preview').hidden = false;
    return true;
  }
  // init / ready 只给云数据库、云函数、云文件用。应用只调 OS 接口（zl.cloud.os.api.fetch）时删掉这两步，
  // 否则平台没为它准备云环境，ready() 会报 ENV_FORBIDDEN。
  zl.cloud.init({ env: zl.cloud.DYNAMIC_CURRENT_ENV });
  try {
    await zl.cloud.os.ready();
    setStatus('ready', '已连接 zleapOS');
    showError(null);
    return true;
  } catch (error) {
    setStatus('error', '连接失败');
    $('loading').hidden = true;
    showError(error, '连接 zleapOS 失败');
    return false;
  }
}

async function main() {
  $('retry').addEventListener('click', async () => {
    showError(null);
    if (await connect()) await refresh();
  });
  $('filters').addEventListener('click', (event) => {
    const value = event.target.closest('button')?.dataset.filter;
    if (!value) return;
    filter = value;
    render();
  });
  $('add').addEventListener('submit', (event) => {
    event.preventDefault();
    const title = $('title').value.trim();
    if (!title) return;
    $('title').value = '';
    mutate(() => todos().add({ data: { title, done: false, created_at: Date.now() } }), '已添加');
  });
  if (!(await connect())) return;
  todos().onChange?.(() => refresh());
  await refresh();
}

main();
