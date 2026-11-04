// 统计「我的互动」：我发了几条动态、收到多少赞和评论（不算自己给自己的），写进私有集合 digest。
// 云函数里只能 get / count；本人在数据域里的标识从私有集合 me/profile 的 _openid 读出来。
import { createHash } from 'node:crypto';
import { zl } from '@zleap/app-cloud-server';

const opId = (ctx, purpose) =>
  `op_${Math.floor(Date.now() / 1000)}_${createHash('sha256').update(`${ctx.invocationId}:${purpose}`).digest('hex').slice(0, 32)}`;

export async function main(event) {
  zl.cloud.init({ env: zl.cloud.DYNAMIC_CURRENT_ENV });
  const ctx = zl.cloud.getContext();
  const logger = zl.cloud.getLogger();
  const db = zl.cloud.os.database;
  const rid = (purpose) => `${ctx.invocationId}:${purpose}`.slice(0, 128);
  try {
    const found = await db.query({ collection: 'me', operation: 'get', document_key: 'profile', request_id: rid('me') }).catch((e) => {
      if (e?.code === 'DOCUMENT_NOT_FOUND') return null;
      throw e;
    });
    const me = Array.isArray(found?.list) ? found.list[0] : null;
    if (!me?._openid) return { posts: 0, likes_received: 0, comments_received: 0, error: '还没打开过同事圈，没有资料' };
    const openid = me._openid;
    const count = async (collection, filter, purpose) => {
      const res = await db.query({ collection, operation: 'count', filter, request_id: rid(purpose) });
      return Number(res?.total ?? res?.count ?? 0);
    };
    const others = (field) => ({ op: 'and', filters: [{ op: 'eq', field, value: openid }, { op: 'neq', field: 'author', value: openid }] });
    const posts = await count('posts', { op: 'eq', field: 'author', value: openid }, 'posts');
    const likes = await count('likes', others('post_author'), 'likes');
    const comments = await count('comments', others('post_author'), 'comments');
    const source = event?.source === 'scheduled' ? 'scheduled' : 'manual';
    await db.mutate({
      collection: 'digest', operation: 'set', document_key: 'latest',
      data: { posts, likes_received: likes, comments_received: comments, source, updated_at: Date.now() },
      value_types: { '/updated_at': 'date' },
      operation_id: opId(ctx, 'digest'), request_id: rid('digest'),
    });
    logger.info('stats refreshed', { posts, likes, comments, source });
    return { posts, likes_received: likes, comments_received: comments };
  } catch (error) {
    logger.error('stats failed', { code: error?.code });
    return { posts: 0, likes_received: 0, comments_received: 0, error: `${error?.code ?? 'ERROR'}: ${error?.message ?? error}`.slice(0, 300) };
  }
}
