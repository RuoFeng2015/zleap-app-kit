/**
 * 同事圈的数据层。集合与结构在 manifest.json 里声明：
 * - posts / photos / likes / comments 是「环境共享」集合，所有同事看到同一份；
 * - 写规则 `doc.author == auth.openid`：只能新增、修改、删除自己写的文档（评论另外允许帖子作者删）；
 * - me 是私有集合，每人一条 profile，用来拿到自己在数据域里的标识（文档的 _openid）。
 *
 * auth.openid 是数据域里的用户标识，应用拿不到平台用户 ID；写文档时 author 必须填它，
 * 否则规则拒绝（RULE_DENIED）——所以别人没法冒充你发帖、也删不了你的帖。
 */
import { database, zl, type Document } from './client';

export const PAGE_SIZE = 20;
export const MAX_PHOTOS = 3;

export interface Me {
  openid: string;
  nickname: string;
}

export interface Photo {
  id: string;
  idx: number;
  data: string;
  original: string | null;
}

export interface Comment {
  id: string;
  version: string;
  author: string;
  postAuthor: string;
  nickname: string;
  text: string;
  createdAt: number;
}

export interface Like {
  id: string;
  author: string;
  nickname: string;
}

export interface Post {
  id: string;
  version: string;
  author: string;
  nickname: string;
  text: string;
  photoCount: number;
  createdAt: number;
  likes: Like[];
  comments: Comment[];
}

const db = () => database();
const col = (key: string) => db().collection(key);
const num = (value: unknown) => (typeof value === 'number' ? value : value instanceof Date ? value.getTime() : Number(value ?? 0));
const str = (value: unknown) => (typeof value === 'string' ? value : '');

/** 读（必要时建）本人 profile，拿到数据域标识。 */
export async function loadMe(): Promise<Me> {
  const me = zl.cloud.database({ throwOnNotFound: false }).collection('me').doc('profile');
  let { data } = await me.get();
  if (!data) {
    await me.set({ data: { nickname: '', created_at: db().serverDate() } });
    ({ data } = await me.get());
  }
  if (!data) throw new Error('PROFILE_UNAVAILABLE');
  return { openid: data._openid, nickname: str(data.nickname) };
}

export async function saveNickname(nickname: string): Promise<void> {
  await col('me').doc('profile').update({ data: { nickname } });
}

function toComment(doc: Document): Comment {
  return {
    id: doc._id,
    version: doc._version,
    author: str(doc.author),
    postAuthor: str(doc.post_author),
    nickname: str(doc.nickname),
    text: str(doc.text),
    createdAt: num(doc.created_at),
  };
}

/** 一页动态，附带点赞与评论（各一次查询，按帖子分组）。 */
export async function listPosts(page: number): Promise<{ posts: Post[]; hasMore: boolean }> {
  const { data } = await col('posts').orderBy('created_at', 'desc').skip(page * PAGE_SIZE).limit(PAGE_SIZE).get();
  const ids = data.map((doc) => doc._id);
  const likes = new Map<string, Like[]>();
  const comments = new Map<string, Comment[]>();
  if (ids.length) {
    const _ = db().command;
    const [likeRows, commentRows] = await Promise.all([
      col('likes').where({ post_id: _.in(ids) }).orderBy('created_at', 'asc').limit(100).get(),
      col('comments').where({ post_id: _.in(ids) }).orderBy('created_at', 'asc').limit(100).get(),
    ]);
    for (const doc of likeRows.data) {
      const list = likes.get(str(doc.post_id)) ?? [];
      list.push({ id: doc._id, author: str(doc.author), nickname: str(doc.nickname) });
      likes.set(str(doc.post_id), list);
    }
    for (const doc of commentRows.data) {
      const list = comments.get(str(doc.post_id)) ?? [];
      list.push(toComment(doc));
      comments.set(str(doc.post_id), list);
    }
  }
  const posts = data.map((doc) => ({
    id: doc._id,
    version: doc._version,
    author: str(doc.author),
    nickname: str(doc.nickname),
    text: str(doc.text),
    photoCount: num(doc.photo_count),
    createdAt: num(doc.created_at),
    likes: likes.get(doc._id) ?? [],
    comments: comments.get(doc._id) ?? [],
  }));
  return { posts, hasMore: data.length === PAGE_SIZE };
}

export async function listPhotos(postId: string): Promise<Photo[]> {
  const { data } = await col('photos').where({ post_id: postId }).orderBy('idx', 'asc').limit(MAX_PHOTOS).get();
  return data.map((doc) => ({ id: doc._id, idx: num(doc.idx), data: str(doc.data), original: str(doc.original) || null }));
}

export interface NewPhoto {
  /** 压缩后的预览图 data URL（存在共享集合里，所有人可见） */
  preview: string;
  /** 原图：上传到应用文件存储 */
  original: Blob | null;
}

/** 发动态：先建帖子，再逐张写图片；原图上传失败不影响发帖，只是没有原图。 */
export async function createPost(me: Me, nickname: string, text: string, photos: NewPhoto[]): Promise<{ id: string; originalErrors: string[] }> {
  // created_at 在 schema 里标了 date_ms：必须写日期（Date / serverDate），写毫秒数字会被判 SCHEMA_INVALID
  const createdAt = db().serverDate();
  const res = await col('posts').add({
    data: { author: me.openid, nickname, text, photo_count: photos.length, created_at: createdAt },
  });
  const postId = res._id;
  if (!postId) throw new Error('POST_ID_MISSING');
  const originalErrors: string[] = [];
  for (const [idx, photo] of photos.entries()) {
    let original = '';
    if (photo.original) {
      try {
        const uploaded = await zl.cloud.uploadFile({ cloudPath: `posts/${postId}/${idx}.jpg`, filePath: photo.original });
        original = uploaded ? uploaded.fileID : '';
      } catch (error) {
        originalErrors.push(String((error as { errCode?: string })?.errCode ?? error));
      }
    }
    await col('photos').add({
      data: { post_id: postId, author: me.openid, idx, data: photo.preview, ...(original ? { original } : {}), created_at: createdAt },
    });
  }
  return { id: postId, originalErrors };
}

/** 删帖：帖子和自己的图片。别人的点赞 / 评论按规则删不掉，读时按帖子过滤即可。 */
export async function deletePost(post: Post): Promise<void> {
  const photos = await listPhotos(post.id);
  await col('posts').doc(post.id).remove({ agentos: { expectedVersion: post.version } });
  for (const photo of photos) await col('photos').doc(photo.id).remove();
}

const likeKey = (postId: string, author: string) => `${postId}_${author}`.slice(0, 128);

export async function like(me: Me, nickname: string, post: Post): Promise<void> {
  await col('likes').doc(likeKey(post.id, me.openid)).set({
    data: { post_id: post.id, author: me.openid, post_author: post.author, nickname, created_at: db().serverDate() },
  });
}

export async function unlike(me: Me, post: Post): Promise<void> {
  await col('likes').doc(likeKey(post.id, me.openid)).remove();
}

export async function addComment(me: Me, nickname: string, post: Post, text: string): Promise<void> {
  await col('comments').add({
    data: { post_id: post.id, author: me.openid, post_author: post.author, nickname, text, created_at: db().serverDate() },
  });
}

export async function deleteComment(comment: Comment): Promise<void> {
  await col('comments').doc(comment.id).remove({ agentos: { expectedVersion: comment.version } });
}

export async function downloadOriginal(fileID: string): Promise<Blob> {
  const res = await zl.cloud.downloadFile({ fileID });
  if (!res) throw new Error('DOWNLOAD_FAILED');
  return res.fileContent;
}

/** 任何一个共享集合有变化就回调（宿主推送；没有推送时什么也不发生，界面还有轮询兜底）。 */
export function onFeedChange(handler: () => void): () => void {
  const offs = ['posts', 'likes', 'comments'].map((key) => col(key).onChange(() => handler()));
  return () => offs.forEach((off) => off());
}

export interface Digest {
  posts: number;
  likesReceived: number;
  commentsReceived: number;
  source: string;
  updatedAt: number;
}

/** 「我的互动」：云函数 stats 写在私有集合 digest 里的统计。 */
export async function loadDigest(): Promise<Digest | null> {
  const { data } = await zl.cloud.database({ throwOnNotFound: false }).collection('digest').doc('latest').get();
  if (!data) return null;
  return {
    posts: num(data.posts),
    likesReceived: num(data.likes_received),
    commentsReceived: num(data.comments_received),
    source: str(data.source),
    updatedAt: num(data.updated_at),
  };
}

/** 手动让云函数统计一次（与定时触发器跑的是同一个函数）。 */
export async function refreshDigest(): Promise<Record<string, unknown>> {
  const job = await zl.cloud.callFunction({ name: 'stats', data: { source: 'manual' } });
  if (!job) throw new Error('FUNCTION_UNAVAILABLE');
  if (job.status !== 'succeeded') throw Object.assign(new Error(job.errorCode ?? job.status), { errCode: job.errorCode ?? job.status });
  return (job.result ?? {}) as Record<string, unknown>;
}

/** 验收用探针：试图删除 / 冒充别人写入，应被集合写规则拒绝（RULE_DENIED）。 */
export const probe = {
  async deletePost(id: string): Promise<string> {
    try {
      await col('posts').doc(id).remove();
      return 'DELETED';
    } catch (error) {
      return String((error as { errCode?: string }).errCode ?? error);
    }
  },
  async forgePost(author: string): Promise<string> {
    try {
      await col('posts').add({ data: { author, nickname: '冒充', text: '冒充别人发帖', photo_count: 0, created_at: db().serverDate() } });
      return 'CREATED';
    } catch (error) {
      return String((error as { errCode?: string }).errCode ?? error);
    }
  },
};
