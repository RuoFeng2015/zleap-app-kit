/**
 * 预览模式（npm run preview）：浏览器直接打开页面、没有 zleapOS 宿主时，用内存数据把界面渲染出来，
 * 方便调样式、截图自查。只在独立打开时启用；在 zleapOS 窗口里永远连真实数据，出错就如实显示。
 *
 * 这里只模拟本应用用到的 SDK 子集（云数据库、文件、云函数、授权登录），由 ./client.ts 在独立打开时换上。
 * 示例数据写在下面的 SAMPLE：新增集合时顺手补一份样例，预览才看得到内容。刷新页面数据恢复原样。
 * 地址加 `?preview=error` 让所有调用失败、`?preview=slow` 让每次调用慢 3 秒，用来检查出错 / 加载中状态。
 */
type Row = Record<string, unknown> & { _id: string; _version: string; _openid: string };
type Where = Record<string, unknown>;
type Query = { field?: string; dir?: 'asc' | 'desc'; skip: number; limit: number; where: Where };

/** 预览里的「我」：发帖、点赞都记在这个标识下。 */
const ME = 'preview-me';
const now = Date.now();
const minutes = (n: number) => new Date(now - n * 60_000);

/** 一张纯色的示例配图（SVG data URL，不依赖网络）。 */
function swatch(color: string, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="54%" font-size="28" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const SAMPLE: Record<string, Record<string, unknown>[]> = {
  me: [{ _id: 'profile', _openid: ME, nickname: '', created_at: minutes(600) }],
  posts: [
    { _id: 'post-1', _openid: 'u-lin', author: 'u-lin', nickname: '林小满', text: '周五下午茶到了，楼下自取 🍰', photo_count: 2, created_at: minutes(12) },
    { _id: 'post-2', _openid: ME, author: ME, nickname: '我', text: '新版报销流程跑通了，大家可以试试。', photo_count: 0, created_at: minutes(95) },
    { _id: 'post-3', _openid: 'u-zhou', author: 'u-zhou', nickname: '周一一', text: '团建投票截止今晚 8 点，还没投的抓紧～', photo_count: 1, created_at: minutes(60 * 26) },
  ],
  photos: [
    { post_id: 'post-1', _openid: 'u-lin', author: 'u-lin', idx: 0, data: swatch('#e8a87c', '蛋糕'), created_at: minutes(12) },
    { post_id: 'post-1', _openid: 'u-lin', author: 'u-lin', idx: 1, data: swatch('#85cdca', '奶茶'), created_at: minutes(12) },
    { post_id: 'post-3', _openid: 'u-zhou', author: 'u-zhou', idx: 0, data: swatch('#41b3a3', '投票'), created_at: minutes(60 * 26) },
  ],
  likes: [
    { _id: `post-1_${ME}`, _openid: ME, post_id: 'post-1', author: ME, post_author: 'u-lin', nickname: '我', created_at: minutes(10) },
    { post_id: 'post-1', _openid: 'u-zhou', author: 'u-zhou', post_author: 'u-lin', nickname: '周一一', created_at: minutes(9) },
    { post_id: 'post-2', _openid: 'u-lin', author: 'u-lin', post_author: ME, nickname: '林小满', created_at: minutes(80) },
  ],
  comments: [
    { post_id: 'post-1', _openid: 'u-zhou', author: 'u-zhou', post_author: 'u-lin', nickname: '周一一', text: '冲！', created_at: minutes(8) },
    { post_id: 'post-2', _openid: 'u-lin', author: 'u-lin', post_author: ME, nickname: '林小满', text: '已经用上了，省事多了', created_at: minutes(70) },
  ],
  digest: [],
};

const mode = (() => {
  try {
    return new URLSearchParams(window.location.search).get('preview') ?? '';
  } catch {
    return '';
  }
})();
const wait = () => new Promise((done) => setTimeout(done, mode === 'slow' ? 3000 : 150));
const fail = (message: string, errCode = 'RUNTIME_UNAVAILABLE') => Object.assign(new Error(`（预览）${message}`), { errCode });
async function step() {
  await wait();
  if (mode === 'error') throw fail('模拟的调用错误');
}

let serial = 0;
const stores = new Map<string, Row[]>();
const listeners = new Map<string, Set<() => void>>();
const files = new Map<string, Blob>();

function store(name: string): Row[] {
  if (!stores.has(name)) {
    stores.set(
      name,
      (SAMPLE[name] ?? []).map((row) => ({ _id: `preview-${++serial}`, _openid: ME, ...row, _version: '1' }) as Row),
    );
  }
  return stores.get(name)!;
}

function changed(name: string) {
  listeners.get(name)?.forEach((handler) => handler());
}

const IN = Symbol('in');
type InOp = { [IN]: unknown[] };
const isIn = (value: unknown): value is InOp => typeof value === 'object' && value !== null && IN in value;
const matches = (row: Row, where: Where) =>
  Object.entries(where).every(([key, value]) => (isIn(value) ? value[IN].includes(row[key]) : row[key] === value));
const sortKey = (value: unknown) => (value instanceof Date ? value.getTime() : (value as number | string));

function builder(name: string, query: Query) {
  const next = (patch: Partial<Query>) => builder(name, { ...query, ...patch });
  return {
    where: (where: Where) => next({ where: { ...query.where, ...where } }),
    orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') => next({ field, dir }),
    skip: (skip: number) => next({ skip }),
    limit: (limit: number) => next({ limit }),
    async get() {
      await step();
      let rows = store(name).filter((row) => matches(row, query.where));
      if (query.field) {
        const field = query.field;
        const sign = query.dir === 'desc' ? -1 : 1;
        rows = [...rows].sort((a, b) => {
          const x = sortKey(a[field]);
          const y = sortKey(b[field]);
          return x > y ? sign : x < y ? -sign : 0;
        });
      }
      return { data: rows.slice(query.skip, query.skip + query.limit).map((row) => ({ ...row })) };
    },
  };
}

function collection(name: string) {
  const write = (data: Record<string, unknown>) => {
    if (name !== 'me' && name !== 'digest' && data.author !== undefined && data.author !== ME) {
      throw fail('只能以自己的身份写入', 'RULE_DENIED');
    }
  };
  return {
    ...builder(name, { skip: 0, limit: 100, where: {} }),
    async add({ data }: { data: Record<string, unknown> }) {
      await step();
      write(data);
      const row: Row = { ...data, _id: `preview-${++serial}`, _openid: ME, _version: '1' };
      store(name).unshift(row);
      changed(name);
      return { _id: row._id };
    },
    doc(id: string) {
      const find = () => store(name).find((row) => row._id === id);
      const owned = (row: Row) => {
        const own = row.author === undefined || row.author === ME || (name === 'comments' && row.post_author === ME);
        if (!own) throw fail('只能修改或删除自己的内容', 'RULE_DENIED');
      };
      return {
        async get() {
          await step();
          const row = find();
          return { data: row ? { ...row } : null };
        },
        async set({ data }: { data: Record<string, unknown> }) {
          await step();
          write(data);
          const rows = store(name).filter((row) => row._id !== id);
          rows.unshift({ ...data, _id: id, _openid: ME, _version: String(Number(find()?._version ?? 0) + 1) });
          stores.set(name, rows);
          changed(name);
        },
        async update({ data }: { data: Record<string, unknown> }) {
          await step();
          const row = find();
          if (!row) throw fail('文档不存在', 'DOCUMENT_NOT_FOUND');
          owned(row);
          Object.assign(row, data, { _version: String(Number(row._version) + 1) });
          changed(name);
        },
        async remove(_options?: unknown) {
          await step();
          const row = find();
          if (row) owned(row);
          stores.set(
            name,
            store(name).filter((item) => item._id !== id),
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

const database = (_options?: unknown) => ({
  collection,
  command: { in: (values: unknown[]): InOp => ({ [IN]: values }) },
  serverDate: () => new Date(),
});

/** 云函数 stats 的预览版：按内存数据统计「我的互动」并写进 digest，与真实云函数行为一致。 */
function runStats(source: string) {
  const result = {
    posts: store('posts').filter((row) => row.author === ME).length,
    likes_received: store('likes').filter((row) => row.post_author === ME && row.author !== ME).length,
    comments_received: store('comments').filter((row) => row.post_author === ME && row.author !== ME).length,
  };
  stores.set('digest', [{ _id: 'latest', _openid: ME, _version: '1', ...result, source, updated_at: new Date() }]);
  return result;
}

export const previewZl = {
  cloud: {
    DYNAMIC_CURRENT_ENV: 'preview',
    init(_options?: unknown) {},
    os: { ready: () => Promise.reject(fail('预览模式不连接 zleapOS', 'CALL_TIMEOUT')) },
    database,
    async uploadFile({ cloudPath, filePath }: { cloudPath: string; filePath: Blob }) {
      await step();
      const fileID = `preview://${cloudPath}`;
      files.set(fileID, filePath);
      return { fileID };
    },
    async downloadFile({ fileID }: { fileID: string }) {
      await step();
      const blob = files.get(fileID);
      if (!blob) throw fail('示例数据没有原图', 'DOCUMENT_NOT_FOUND');
      return { fileContent: blob };
    },
    async callFunction({ name, data }: { name: string; data?: Record<string, unknown> }) {
      await step();
      if (name !== 'stats') throw fail(`预览模式没有云函数 ${name}`, 'FUNCTION_NOT_FOUND');
      return { status: 'succeeded', result: runStats(String(data?.source ?? 'manual')), errorCode: null };
    },
  },
  auth: {
    async authorize(_options?: unknown) {
      await step();
      return { profile: { nickname: '预览用户' } };
    },
  },
  app: {
    getUpdateManager: () => ({ onUpdateReady() {}, onUpdateFailed() {}, applyUpdate: async () => {} }),
  },
};
