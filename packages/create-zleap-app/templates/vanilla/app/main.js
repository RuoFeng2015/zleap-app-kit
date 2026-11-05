// 应用页面：运行在 zleapOS 的沙箱 iframe 里。Cloud SDK 由 npm run deploy / npm install 从
// node_modules/@zleap-ai/app-sdk 复制到 ./sdk/，不要手改 ./sdk/。
//
// 平台约束（不要绕过）：不能 fetch、不能用 localStorage、不能 alert；环境用 DYNAMIC_CURRENT_ENV；
// 每次读最多 100 条，用 skip 翻页；更新 / 删除带 expectedVersion；COMMIT_UNKNOWN 时先刷新核对，不要自动重试。
import { CloudError, zl } from './sdk/index.js';

const COLLECTION = 'todos'; // 结构在 manifest.json 的 data.schemas.todos
const PAGE_SIZE = 100;

const $ = (id) => document.getElementById(id);

/** 面向用户的中文说明；宿主只给错误码，未知错误码原样展示。 */
function describeError(error) {
  const code = error instanceof CloudError ? error.errCode : error?.errCode ?? (error instanceof Error ? error.message : String(error));
  const hints = {
    SCOPE_FORBIDDEN: '还没有这项权限：点应用窗口顶部「权限」，勾选后保存（应用会自动重新加载）。',
    PUBLISHER_REQUIRED: '开发数据只对应用成员开放；给其他人用请在云开发控制台「版本管理」里发布为线上版本。',
    ENV_FORBIDDEN: '这个应用还没有上线：请应用成员在云开发控制台「版本管理」里把版本发布为线上版本。',
    RESOURCE_NOT_READY: '云数据库正在开通，通常一分钟内就绪，请稍后刷新。',
    COLLECTION_NOT_FOUND: '数据集合还没建好：开发环境稍等一分钟后刷新；线上版本请应用成员重新发布一次。',
    SCHEMA_INVALID: '数据不符合集合结构（字段缺失、类型不对、内容过大或多了未声明字段）。',
    VERSION_CONFLICT: '数据已在别处更新，请刷新后再改。',
    COMMIT_UNKNOWN: '保存结果未知，请刷新核对后再决定是否重试。',
    CALL_TIMEOUT: '连接宿主超时：请从 zleapOS 桌面打开应用。',
    RUNTIME_UNAVAILABLE: '云服务暂时不可用，请稍后重试。',
    RELEASE_UNAVAILABLE: '应用版本已切换，请重新加载应用。',
  };
  return hints[code] ? `${hints[code]}（${code}）` : code;
}

function showError(error) {
  $('error').textContent = error ? describeError(error) : '';
  $('error').hidden = !error;
}

const todos = () => zl.cloud.database().collection(COLLECTION);

async function listTodos(maxPages = 10) {
  const out = [];
  for (let page = 0; page < maxPages; page += 1) {
    const { data } = await todos().orderBy('created_at', 'desc').skip(page * PAGE_SIZE).limit(PAGE_SIZE).get();
    out.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return out;
}

function render(rows) {
  const list = $('list');
  list.replaceChildren();
  for (const row of rows) {
    const item = document.createElement('li');
    item.className = row.done ? 'done' : '';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = Boolean(row.done);
    box.addEventListener('change', () =>
      mutate(() => todos().doc(row._id).update({ data: { done: box.checked }, agentos: { expectedVersion: row._version } })),
    );
    const title = document.createElement('span');
    title.textContent = String(row.title ?? '');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '删除';
    remove.addEventListener('click', () => mutate(() => todos().doc(row._id).remove({ agentos: { expectedVersion: row._version } })));
    item.append(box, title, remove);
    list.append(item);
  }
  $('empty').hidden = rows.length > 0;
}

async function refresh() {
  try {
    render(await listTodos());
    showError(null);
  } catch (error) {
    showError(error);
  }
}

async function mutate(action) {
  try {
    await action();
  } catch (error) {
    showError(error);
  }
  await refresh();
}

async function main() {
  // 浏览器直接打开（不在 zleapOS 窗口里）时没有宿主，握手只会超时。
  if (window.parent === window) {
    $('status').textContent = '请从 zleapOS 启动台打开';
    return;
  }
  zl.cloud.init({ env: zl.cloud.DYNAMIC_CURRENT_ENV });
  try {
    await zl.cloud.os.ready();
    $('status').textContent = '● OS 已连接';
    $('status').classList.add('ready');
  } catch (error) {
    $('status').textContent = '连接失败';
    showError(error);
    return;
  }
  $('add').addEventListener('submit', (event) => {
    event.preventDefault();
    const title = $('title').value.trim();
    if (!title) return;
    $('title').value = '';
    mutate(() => todos().add({ data: { title, done: false, created_at: Date.now() } }));
  });
  await refresh();
}

main();
