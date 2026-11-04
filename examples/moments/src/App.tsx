import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import manifest from '../manifest.json';
import { describeError, errorCode, hasProfile, zl } from './cloud/client';
import {
  MAX_PHOTOS,
  addComment,
  createPost,
  deleteComment,
  deletePost,
  downloadOriginal,
  like,
  listPhotos,
  listPosts,
  loadDigest,
  loadMe,
  probe,
  refreshDigest,
  onFeedChange,
  saveNickname,
  unlike,
  type Comment,
  type Digest,
  type Me,
  type NewPhoto,
  type Photo,
  type Post,
} from './cloud/moments';
import { useCloudConnection } from './cloud/useCloudConnection';
import { preparePhoto } from './image';

declare global {
  interface Window {
    /** 验收脚本读取的运行状态（不影响功能） */
    __MOMENTS__?: { version: string; me?: Me; nickname?: string; events: string[]; probe?: typeof probe };
  }
}
window.__MOMENTS__ = { version: manifest.version, events: [], probe };
const record = (event: string) => window.__MOMENTS__?.events.push(event);

export function App() {
  const { state, retry } = useCloudConnection();
  return (
    <main className="app">
      <header className="app-header">
        <div>
          <h1>{manifest.name}</h1>
          <p className="eyebrow">
            v<span data-testid="version">{manifest.version}</span> · 公司内部的小型朋友圈
          </p>
        </div>
        <UpdateBanner />
      </header>
      {state.status === 'standalone' ? (
        <Notice tone="info" title="当前是浏览器独立预览">
          运行 <code>npm run deploy</code> 后从 zleapOS 启动台打开，才能看到同事们的动态。
        </Notice>
      ) : null}
      {state.status === 'connecting' ? <p className="muted">正在连接 zleapOS…</p> : null}
      {state.status === 'error' ? (
        <Notice tone="bad" title="连接 zleapOS 失败" action={<button onClick={retry}>重试</button>}>
          {describeError({ errCode: state.code })}
        </Notice>
      ) : null}
      {state.status === 'ready' && !hasProfile(state.capabilities, 'document-core/1') ? (
        <Notice tone="warn" title="还不能读写动态">
          点应用窗口顶部「权限」，勾选读取和修改应用数据后保存。
        </Notice>
      ) : null}
      {state.status === 'ready' && hasProfile(state.capabilities, 'document-core/1') ? (
        <Moments storage={hasProfile(state.capabilities, 'storage-object/1')} />
      ) : null}
    </main>
  );
}

/** 有新的线上版本时提示（使用中有人发布了新版本）。 */
function UpdateBanner() {
  const [update, setUpdate] = useState<{ version: string | null; notes: string | null } | null>(null);
  const [failed, setFailed] = useState('');
  useEffect(() => {
    if (window.parent === window) return;
    const manager = zl.app.getUpdateManager();
    manager.onUpdateReady((result) => {
      record('updateReady');
      setUpdate({ version: result.latestVersion, notes: result.notes });
    });
    manager.onUpdateFailed((error) => setFailed(error.errCode));
  }, []);
  if (!update) return failed ? <span className="muted">更新失败：{failed}</span> : null;
  return (
    <div className="update" data-testid="update-banner">
      <span>
        新版本 v{update.version}
        {update.notes ? `：${update.notes}` : ''}
      </span>
      <button className="primary" onClick={() => void zl.app.getUpdateManager().applyUpdate()}>
        立即更新
      </button>
    </div>
  );
}

function Moments({ storage }: { storage: boolean }) {
  const [me, setMe] = useState<Me | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [pages, setPages] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const loading = useRef(false);

  const reload = useCallback(async (pageCount = pages) => {
    if (loading.current) return;
    loading.current = true;
    try {
      const all: Post[] = [];
      let more = false;
      for (let page = 0; page < pageCount; page += 1) {
        const res = await listPosts(page);
        all.push(...res.posts);
        more = res.hasMore;
        if (!res.hasMore) break;
      }
      setPosts(all);
      setHasMore(more);
    } catch (error) {
      setMessage({ tone: 'bad', text: `读取动态失败：${describeError(error)}` });
    } finally {
      loading.current = false;
    }
  }, [pages]);

  useEffect(() => {
    loadMe().then(
      (value) => {
        setMe(value);
        window.__MOMENTS__!.me = value;
      },
      (error: unknown) => setMessage({ tone: 'bad', text: `初始化失败：${describeError(error)}` }),
    );
  }, []);

  useEffect(() => {
    void reload();
    // 宿主推送变更时立刻刷新；没有推送时 15 秒轮询兜底。
    const off = onFeedChange(() => {
      record('pushChange');
      void reload();
    });
    const timer = window.setInterval(() => void reload(), 15_000);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [reload]);

  /** 第一次发帖 / 点赞 / 评论时问一次昵称；拒绝后用「同事」。必须在点击事件里调用。 */
  const nickname = useCallback(async (): Promise<string> => {
    if (me?.nickname) return me.nickname;
    let name = '同事';
    try {
      const result = await zl.auth.authorize({ scopes: ['profile'], reason: '发动态、点赞和评论时显示你的昵称' });
      name = result.profile?.nickname || name;
      record('authorized');
    } catch (error) {
      record(`authorizeError:${errorCode(error)}`);
      setMessage({ tone: 'bad', text: describeError(error) });
    }
    if (me) {
      await saveNickname(name).catch(() => undefined);
      const next = { ...me, nickname: name };
      setMe(next);
      window.__MOMENTS__!.me = next;
    }
    return name;
  }, [me]);

  const run = useCallback(
    async (label: string, action: () => Promise<unknown>, ok?: string) => {
      setMessage(null);
      try {
        await action();
        record(label);
        if (ok) setMessage({ tone: 'ok', text: ok });
      } catch (error) {
        record(`${label}Error:${errorCode(error)}`);
        setMessage({ tone: 'bad', text: describeError(error) });
      }
      await reload();
    },
    [reload],
  );

  if (!me) return message ? <Notice tone="bad" title="出错了">{message.text}</Notice> : <p className="muted">正在准备…</p>;
  return (
    <>
      <div className="me" data-testid="me">
        <Avatar name={me.nickname || '我'} seed={me.openid} />
        <span>{me.nickname ? `我是 ${me.nickname}` : '还没有设置昵称（第一次发动态时会询问）'}</span>
      </div>
      <Composer me={me} storage={storage} nickname={nickname} onPosted={(text) => setMessage({ tone: text ? 'bad' : 'ok', text: text || '已发布' })} reload={reload} />
      <DigestPanel />
      {message ? <p className={`message ${message.tone}`} data-testid="message">{message.text}</p> : null}
      <section className="feed" data-testid="feed">
        {posts.length === 0 ? <p className="muted">还没有动态，发第一条吧。</p> : null}
        {posts.map((post) => (
          <PostCard key={post.id} post={post} me={me} storage={storage} nickname={nickname} run={run} />
        ))}
      </section>
      {hasMore ? (
        <button
          onClick={() => {
            setPages(pages + 1);
            void reload(pages + 1);
          }}
        >
          加载更多
        </button>
      ) : null}
    </>
  );
}

function Composer({
  me,
  storage,
  nickname,
  onPosted,
  reload,
}: {
  me: Me;
  storage: boolean;
  nickname: () => Promise<string>;
  onPosted: (error: string) => void;
  reload: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [withOriginal, setWithOriginal] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() && !files.length) return;
    setBusy(true);
    try {
      const name = await nickname();
      const photos: NewPhoto[] = [];
      for (const file of files) photos.push(await preparePhoto(file, withOriginal && storage));
      const result = await createPost(me, name, text.trim(), photos);
      record('posted');
      setText('');
      setFiles([]);
      onPosted(result.originalErrors.length ? `已发布，但原图没传上去：${result.originalErrors.join('、')}` : '');
    } catch (error) {
      record(`postError:${errorCode(error)}`);
      onPosted(`发布失败：${describeError(error)}`);
    } finally {
      setBusy(false);
      await reload();
    }
  }

  return (
    <form className="card composer" onSubmit={submit} data-testid="composer">
      <textarea value={text} maxLength={1000} placeholder="分享点什么…" onChange={(e) => setText(e.target.value)} />
      <div className="composer-row">
        <label className="file">
          添加图片（最多 {MAX_PHOTOS} 张）
          <input
            type="file"
            accept="image/*"
            multiple
            data-testid="photo-input"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, MAX_PHOTOS))}
          />
        </label>
        {files.length ? <span className="muted">已选 {files.length} 张</span> : null}
        <label className="check">
          <input type="checkbox" checked={withOriginal} disabled={!storage} onChange={(e) => setWithOriginal(e.target.checked)} />
          同时上传原图{storage ? '' : '（未授权文件存储）'}
        </label>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? '发布中…' : '发布'}
        </button>
      </div>
    </form>
  );
}

function PostCard({
  post,
  me,
  storage,
  nickname,
  run,
}: {
  post: Post;
  me: Me;
  storage: boolean;
  nickname: () => Promise<string>;
  run: (label: string, action: () => Promise<unknown>, ok?: string) => Promise<void>;
}) {
  const [comment, setComment] = useState('');
  const liked = post.likes.some((item) => item.author === me.openid);
  const mine = post.author === me.openid;
  return (
    <article className="card post" data-testid="post" data-post-id={post.id} data-mine={mine ? '1' : '0'}>
      <div className="post-head">
        <Avatar name={post.nickname} seed={post.author} />
        <div>
          <b>{post.nickname}</b>
          <div className="muted">{new Date(post.createdAt).toLocaleString('zh-CN')}</div>
        </div>
        <span className="spacer" />
        <button
          className="link danger"
          data-testid="delete-post"
          title={mine ? '删除' : '只能删除自己的动态'}
          onClick={() => void run('deletePost', () => deletePost(post), '已删除')}
          hidden={!mine}
        >
          删除
        </button>
      </div>
      {post.text ? <p className="post-text">{post.text}</p> : null}
      {post.photoCount > 0 ? <Photos postId={post.id} storage={storage} mine={mine} /> : null}
      <div className="post-actions">
        <button
          className={liked ? 'liked' : ''}
          data-testid="like"
          onClick={() =>
            void run(liked ? 'unlike' : 'like', async () => (liked ? unlike(me, post) : like(me, await nickname(), post)))
          }
        >
          {liked ? '♥ 已赞' : '♡ 赞'}
        </button>
        <span className="muted" data-testid="likes">
          {post.likes.length ? `${post.likes.map((item) => item.nickname).join('、')} 觉得很赞` : ''}
        </span>
      </div>
      {post.comments.length ? (
        <ul className="comments" data-testid="comments">
          {post.comments.map((item) => (
            <CommentRow key={item.id} comment={item} me={me} run={run} />
          ))}
        </ul>
      ) : null}
      <form
        className="comment-box"
        onSubmit={(event) => {
          event.preventDefault();
          const text = comment.trim();
          if (!text) return;
          setComment('');
          void run('comment', async () => addComment(me, await nickname(), post, text));
        }}
      >
        <input value={comment} maxLength={500} placeholder="写评论…" data-testid="comment-input" onChange={(e) => setComment(e.target.value)} />
        <button type="submit">评论</button>
      </form>
    </article>
  );
}

function CommentRow({
  comment,
  me,
  run,
}: {
  comment: Comment;
  me: Me;
  run: (label: string, action: () => Promise<unknown>, ok?: string) => Promise<void>;
}) {
  const canDelete = comment.author === me.openid || comment.postAuthor === me.openid;
  return (
    <li data-testid="comment">
      <b>{comment.nickname}</b>：{comment.text}
      {canDelete ? (
        <button className="link danger" data-testid="delete-comment" onClick={() => void run('deleteComment', () => deleteComment(comment))}>
          删除
        </button>
      ) : null}
    </li>
  );
}

function Photos({ postId, storage, mine }: { postId: string; storage: boolean; mine: boolean }) {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [original, setOriginal] = useState<{ url: string } | { error: string } | null>(null);
  useEffect(() => {
    let alive = true;
    listPhotos(postId).then(
      (rows) => alive && setPhotos(rows),
      () => alive && setPhotos([]),
    );
    return () => {
      alive = false;
    };
  }, [postId]);
  useEffect(() => () => {
    if (original && 'url' in original) URL.revokeObjectURL(original.url);
  }, [original]);
  if (!photos) return <div className="photos muted">图片加载中…</div>;
  return (
    <div className="photos" data-testid="photos">
      {photos.map((photo) => (
        <figure key={photo.id}>
          <img src={photo.data} alt={`图片 ${photo.idx + 1}`} />
          {photo.original && storage && !mine ? <span className="muted">原图仅作者可见</span> : null}
          {photo.original && storage && mine ? (
            <button
              className="link"
              data-testid="original"
              onClick={() =>
                downloadOriginal(photo.original!).then(
                  (blob) => setOriginal({ url: URL.createObjectURL(blob) }),
                  (error: unknown) => setOriginal({ error: describeError(error) }),
                )
              }
            >
              查看原图
            </button>
          ) : null}
        </figure>
      ))}
      {original ? (
        'url' in original ? (
          <img className="original" src={original.url} alt="原图" data-testid="original-image" />
        ) : (
          <p className="message bad" data-testid="original-error">原图打不开：{original.error}</p>
        )
      ) : null}
    </div>
  );
}

/** 「我的互动」：云函数统计（手动 + 每 5 分钟定时）。 */
function DigestPanel() {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [state, setState] = useState('');
  const load = useCallback(() => {
    loadDigest().then(setDigest, (error: unknown) => setState(`读取统计失败：${describeError(error)}`));
  }, []);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);
  return (
    <section className="card digest" data-testid="digest">
      <b>我的互动</b>
      {digest ? (
        <span data-testid="digest-values">
          发了 {digest.posts} 条 · 收到 {digest.likesReceived} 个赞 · {digest.commentsReceived} 条评论
          <span className="muted">
            （{digest.source === 'scheduled' ? '定时统计' : '手动统计'}于 {new Date(digest.updatedAt).toLocaleTimeString('zh-CN')}）
          </span>
        </span>
      ) : (
        <span className="muted">还没有统计过</span>
      )}
      <button
        data-testid="digest-refresh"
        onClick={() => {
          setState('统计中…');
          refreshDigest().then(
            (result) => {
              record('digest');
              setState(result.error ? `统计失败：${String(result.error)}` : '');
              load();
            },
            (error: unknown) => {
              record(`digestError:${errorCode(error)}`);
              setState(`统计失败：${describeError(error)}`);
            },
          );
        }}
      >
        立即统计
      </button>
      {state ? <span className="muted" data-testid="digest-state">{state}</span> : null}
    </section>
  );
}

function Avatar({ name, seed }: { name: string; seed: string }) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (
    <span className="avatar" style={{ background: `hsl(${hash % 360} 55% 55%)` }}>
      {(name || '?').slice(0, 1)}
    </span>
  );
}

function Notice({ tone, title, children, action }: { tone: 'info' | 'warn' | 'bad'; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice ${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <b>{title}</b>
      <div>{children}</div>
      {action}
    </div>
  );
}
