/**
 * 预览模式（npm run preview）：浏览器直接打开页面、没有 zleapOS 宿主时，用内存数据把界面渲染出来，
 * 方便调样式、截图自查。只在独立打开时启用；在 zleapOS 窗口里永远连真实数据，出错就如实显示。
 *
 * 示例数据写在下面的 SAMPLE / OS_SAMPLE：新增集合或调用新的 OS 接口时，顺手补一份样例，预览才看得到内容。
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

/** OS 接口样例：键是「方法 路径（不含查询串）」，值是接口 data 字段。未列出的接口返回空列表。 */
const OS_SAMPLE: Record<string, unknown> = {
  'GET /todos': { list: [], total: 0 },
};

const wait = () => new Promise((done) => setTimeout(done, 200));
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

/** zl.cloud.os.api.fetch 的预览版：返回 { code: 0, data } 形状的 Response。 */
export async function previewApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  await wait();
  const key = `${(init.method ?? 'GET').toUpperCase()} ${path.split('?')[0]}`;
  const data = key in OS_SAMPLE ? OS_SAMPLE[key] : { list: [], total: 0 };
  return new Response(JSON.stringify({ code: 0, message: 'preview', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
