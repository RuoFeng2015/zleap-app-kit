/**
 * 预览模式（npm run preview）：浏览器直接打开页面、没有 zleapOS 宿主时，用内存数据把界面渲染出来，
 * 方便调样式、截图自查。只在独立打开时启用；在 zleapOS 窗口里永远连真实数据，出错就如实显示。
 *
 * 示例数据写在下面的 SAMPLE / OS_SAMPLE：新增集合或调用新的 OS 接口时，顺手补一份样例，预览才看得到内容。
 * OS_SAMPLE 的值可以是函数，按请求体返回不同结果（AI 生成、写接口都能这样预览）。
 * 地址加 `?preview=error` 让所有调用失败、`?preview=slow` 让每次调用慢 3 秒，用来检查出错 / 加载中状态。
 */
type Row = Record<string, unknown> & { _id: string; _version: string };
type Query = { field?: string; dir?: 'asc' | 'desc'; skip: number; limit: number; where: Record<string, unknown> };

const now = Date.now();
const SAMPLE: Record<string, Record<string, unknown>[]> = {
  todos: [
    { title: '整理本周会议纪要', done: false, created_at: now - 60_000 },
    { title: '给设计稿补暗色截图', done: false, created_at: now - 3_600_000 },
    { title: '确认上线时间', done: true, created_at: now - 86_400_000 },
  ],
};

type OsRequest = { body: Record<string, unknown>; query: URLSearchParams };

/**
 * OS 接口样例：键是「方法 路径（不含查询串）」，值是接口 data 字段，或按请求返回 data 的函数。
 * 未列出的 GET 返回空列表；未列出的 POST / PUT / PATCH 把请求体加上 id 原样返回；DELETE 返回 null。
 */
const OS_SAMPLE: Record<string, unknown | ((req: OsRequest) => unknown)> = {
  'GET /todos': { list: [], total: 0 },
  // AI 生成：传了 output_schema 时 result 是结构化结果，否则只有 text。按你的 Schema 改成像样的示例。
  'POST /agents/complete': ({ body }: OsRequest) =>
    body.output_schema
      ? { text: '', result: { summary: '（预览）这是一段示例结果', items: [] } }
      : { text: `（预览）根据「${String(body.input ?? '').slice(0, 20)}」生成的示例内容`, result: null },
};

const mode = (() => {
  try {
    return new URLSearchParams(window.location.search).get('preview') ?? '';
  } catch {
    return '';
  }
})();
const wait = () => new Promise((done) => setTimeout(done, mode === 'slow' ? 3000 : 200));
let serial = 0;
const stores = new Map<string, Row[]>();
const listeners = new Map<string, Set<() => void>>();

function store(name: string): Row[] {
  if (!stores.has(name)) {
    stores.set(
      name,
      (SAMPLE[name] ?? []).map((row) => ({ ...row, _id: `preview-${++serial}`, _version: '1' })),
    );
  }
  return stores.get(name)!;
}

function changed(name: string) {
  listeners.get(name)?.forEach((handler) => handler());
}

function builder(name: string, query: Query) {
  const next = (patch: Partial<Query>) => builder(name, { ...query, ...patch });
  return {
    where: (where: Record<string, unknown>) => next({ where: { ...query.where, ...where } }),
    orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') => next({ field, dir }),
    skip: (skip: number) => next({ skip }),
    limit: (limit: number) => next({ limit }),
    async get() {
      await wait();
      if (mode === 'error') throw Object.assign(new Error('（预览）模拟的读取错误'), { errCode: 'RUNTIME_UNAVAILABLE' });
      let rows = store(name).filter((row) => Object.entries(query.where).every(([key, value]) => row[key] === value));
      if (query.field) {
        const field = query.field;
        const sign = query.dir === 'desc' ? -1 : 1;
        rows = [...rows].sort((a, b) => (a[field]! > b[field]! ? sign : a[field]! < b[field]! ? -sign : 0));
      }
      return { data: rows.slice(query.skip, query.skip + query.limit).map((row) => ({ ...row })) };
    },
  };
}

function collection(name: string) {
  return {
    ...builder(name, { skip: 0, limit: 100, where: {} }),
    async add({ data }: { data: Record<string, unknown> }) {
      await wait();
      const row: Row = { ...data, _id: `preview-${++serial}`, _version: '1' };
      store(name).unshift(row);
      changed(name);
      return { _id: row._id };
    },
    doc(id: string) {
      const find = () => store(name).find((row) => row._id === id);
      return {
        async get() {
          await wait();
          const row = find();
          return { data: row ? { ...row } : null };
        },
        async update({ data }: { data: Record<string, unknown> }) {
          await wait();
          const row = find();
          if (row) Object.assign(row, data, { _version: String(Number(row._version) + 1) });
          changed(name);
        },
        async remove() {
          await wait();
          stores.set(
            name,
            store(name).filter((row) => row._id !== id),
          );
          changed(name);
        },
      };
    },
    onChange(handler: () => void) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(handler);
      return () => listeners.get(name)!.delete(handler);
    },
  };
}

export const previewDatabase = { collection };

/** zl.cloud.os.api.fetch 的预览版：返回 { code, message, data } 形状的 Response。 */
export async function previewApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  await wait();
  const method = (init.method ?? 'GET').toUpperCase();
  const [pathname, search = ''] = path.split('?');
  const json = (status: number, payload: unknown) =>
    new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
  if (mode === 'error') return json(500, { code: 50000, message: '（预览）模拟的接口错误', data: null });
  let body: Record<string, unknown> = {};
  try {
    body = typeof init.body === 'string' && init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  } catch {
    /* 非 JSON 请求体按空对象处理 */
  }
  const key = `${method} ${pathname}`;
  const sample = OS_SAMPLE[key];
  const data =
    typeof sample === 'function'
      ? (sample as (req: OsRequest) => unknown)({ body, query: new URLSearchParams(search) })
      : key in OS_SAMPLE
        ? sample
        : method === 'GET'
          ? { list: [], total: 0 }
          : method === 'DELETE'
            ? null
            : { id: `preview-${++serial}`, ...body };
  return json(200, { code: 0, message: 'preview', data });
}
