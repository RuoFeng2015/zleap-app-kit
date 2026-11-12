// 界面统一用官方样式 zleap.css 的 zl- 类（与 zleapOS 桌面同色、自动跟随亮 / 暗），应用特有的样式写在 index.css。
// 每块数据都处理四种状态：加载中（骨架）、出错（说明 + 重试）、空（引导下一步）、有数据。
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';

import manifest from '../manifest.json';
import { describeError, errorCode, hasProfile } from './cloud/client';
import { addTodo, listTodos, onTodosChange, removeTodo, updateTodo, type Todo } from './cloud/todos';
import { useCloudConnection } from './cloud/useCloudConnection';

type Filter = 'all' | 'active' | 'done';

export function App() {
  const { state, retry } = useCloudConnection();
  const ready =
    state.status === 'preview' || (state.status === 'ready' && hasProfile(state.capabilities, 'document-core/1'));

  return (
    <main className="zl-page">
      <header className="zl-header">
        <div>
          <h1 className="zl-title">{manifest.name}</h1>
          <p className="zl-subtitle">记下要做的事，完成后勾掉。</p>
        </div>
        <ConnectionStatus status={state.status} />
      </header>

      {state.status === 'preview' ? (
        <Alert tone="info" title="预览模式 · 示例数据">
          没有连接 zleapOS，改动不会保存。部署（<code>npm run deploy</code>）后从启动台打开才是真实数据。
        </Alert>
      ) : null}
      {state.status === 'error' ? (
        <Alert
          tone="danger"
          title="连接 zleapOS 失败"
          action={
            <button className="zl-btn zl-btn--sm" onClick={retry}>
              重试
            </button>
          }
        >
          {describeError({ errCode: state.code })}
        </Alert>
      ) : null}
      {state.status === 'ready' && !ready ? (
        <Alert tone="warning" title="数据库还没就绪">
          开发环境和数据库通常在部署后一分钟内开通完成。这个窗口只在打开时检查一次，不会自动刷新：
          稍等片刻后点窗口顶部「重新加载应用」。重新加载后仍是这样，再检查窗口顶部「权限」里是否勾选了数据读写。
        </Alert>
      ) : null}
      {state.status === 'connecting' ? <ListSkeleton /> : null}
      {ready ? <TodoBoard /> : null}
    </main>
  );
}

function TodoBoard() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'warning' | 'danger'; text: string } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [title, setTitle] = useState('');
  const toast = useToast();

  const reload = useCallback(async () => {
    try {
      setTodos(await listTodos());
      setLoadError('');
    } catch (error) {
      setLoadError(describeError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return onTodosChange(() => void reload());
  }, [reload]);

  const mutate = async (action: () => Promise<void>, success: string) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await action();
      toast.show(success);
    } catch (error) {
      // 结果未知时不自动重试：先重读，让用户看到真实状态再决定。
      const unknown = errorCode(error) === 'COMMIT_UNKNOWN';
      setMessage({ tone: unknown ? 'warning' : 'danger', text: describeError(error) });
    } finally {
      await reload();
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    void mutate(async () => {
      await addTodo(value);
      setTitle('');
    }, '已添加');
  };

  const visible = useMemo(
    () => todos.filter((todo) => (filter === 'all' ? true : filter === 'done' ? todo.done : !todo.done)),
    [todos, filter],
  );
  const doneCount = todos.filter((todo) => todo.done).length;

  return (
    <>
      <form className="zl-composer" onSubmit={submit}>
        <input
          className="zl-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="下一件想完成的事…"
          maxLength={200}
          aria-label="新待办"
          disabled={busy}
        />
        <button className="zl-btn zl-btn--primary" type="submit" disabled={!title.trim()} aria-busy={busy}>
          添加
        </button>
      </form>

      {message ? <Alert tone={message.tone} title={message.tone === 'warning' ? '请先核对' : '操作失败'}>{message.text}</Alert> : null}

      <section className="zl-section">
        <div className="zl-section-title">
          <div className="zl-segmented" role="group" aria-label="筛选">
            {(['all', 'active', 'done'] as const).map((value) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {{ all: '全部', active: '未完成', done: '已完成' }[value]}
              </button>
            ))}
          </div>
          <span className="zl-num zl-text-sm">
            {doneCount} / {todos.length} 已完成
          </span>
        </div>

        {todos.length > 0 ? (
          <div className="zl-progress" aria-hidden>
            <span style={{ width: `${Math.round((doneCount / todos.length) * 100)}%` }} />
          </div>
        ) : null}

        {loading ? (
          <ListSkeleton />
        ) : loadError ? (
          <Alert
            tone="danger"
            title="读取失败"
            action={
              <button className="zl-btn zl-btn--sm" onClick={() => void reload()}>
                重试
              </button>
            }
          >
            {loadError}
          </Alert>
        ) : visible.length === 0 ? (
          <div className="zl-empty">
            <div className="zl-empty-icon" aria-hidden>
              ✓
            </div>
            <p className="zl-empty-title">{todos.length === 0 ? '还没有待办' : '这里没有内容'}</p>
            <p className="zl-empty-text">
              {todos.length === 0 ? '在上面写下第一件想完成的事。' : '换个筛选条件看看。'}
            </p>
          </div>
        ) : (
          <ul className="zl-list">
            {visible.map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                busy={busy}
                onToggle={() => void mutate(() => updateTodo(todo, { done: !todo.done }), todo.done ? '已恢复' : '已完成')}
                onRename={(next) => void mutate(() => updateTodo(todo, { title: next }), '已保存')}
                onRemove={() => void mutate(() => removeTodo(todo), '已删除')}
              />
            ))}
          </ul>
        )}
      </section>
      {toast.node}
    </>
  );
}

function TodoRow({
  todo,
  busy,
  onToggle,
  onRename,
  onRemove,
}: {
  todo: Todo;
  busy: boolean;
  onToggle: () => void;
  onRename: (title: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(todo.title);

  if (editing) {
    return (
      <li className="zl-list-item">
        <input
          className="zl-input"
          value={draft}
          maxLength={200}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          aria-label="编辑待办"
        />
        <div className="zl-item-actions">
          <button
            className="zl-btn zl-btn--primary zl-btn--sm"
            disabled={busy || !draft.trim()}
            onClick={() => {
              onRename(draft.trim());
              setEditing(false);
            }}
          >
            保存
          </button>
          <button className="zl-btn zl-btn--ghost zl-btn--sm" onClick={() => setEditing(false)}>
            取消
          </button>
        </div>
      </li>
    );
  }
  return (
    <li className={`zl-list-item${todo.done ? ' is-done' : ''}`}>
      <input
        className="zl-check"
        type="checkbox"
        checked={todo.done}
        disabled={busy}
        onChange={onToggle}
        aria-label={`完成：${todo.title}`}
      />
      <div className="zl-item-main">
        <span className="zl-item-title">{todo.title}</span>
        <span className="zl-item-meta">{formatTime(todo.createdAt)}</span>
      </div>
      {/* 沙箱里不能用 confirm()：危险操作用行内二次确认。 */}
      {confirming ? (
        <div className="zl-item-actions">
          <button
            className="zl-btn zl-btn--danger zl-btn--sm"
            disabled={busy}
            onClick={() => {
              setConfirming(false);
              onRemove();
            }}
          >
            确认删除
          </button>
          <button className="zl-btn zl-btn--ghost zl-btn--sm" onClick={() => setConfirming(false)}>
            取消
          </button>
        </div>
      ) : (
        <div className="zl-item-actions zl-item-actions--hover">
          <button
            className="zl-btn zl-btn--ghost zl-btn--sm"
            disabled={busy}
            onClick={() => {
              setDraft(todo.title);
              setEditing(true);
            }}
          >
            编辑
          </button>
          <button className="zl-btn zl-btn--ghost zl-btn--sm" disabled={busy} onClick={() => setConfirming(true)}>
            删除
          </button>
        </div>
      )}
    </li>
  );
}

function ConnectionStatus({ status }: { status: string }) {
  const state = status === 'ready' ? 'ready' : status === 'error' ? 'error' : status === 'preview' ? 'preview' : 'connecting';
  const label = { connecting: '正在连接', ready: '已连接 zleapOS', error: '连接失败', preview: '预览模式' }[state];
  return (
    <span className="zl-status" data-state={state}>
      {label}
    </span>
  );
}

function Alert({
  tone,
  title,
  children,
  action,
}: {
  tone: 'info' | 'warning' | 'danger';
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`zl-alert zl-alert--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <div>
        <strong>{title}</strong>
        {children}
      </div>
      {action}
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="zl-list" aria-busy="true" aria-label="正在读取">
      {[68, 45, 56].map((width) => (
        <li key={width} className="zl-list-item">
          <span className="zl-skeleton" style={{ width: 18, height: 18 }} />
          <span className="zl-skeleton" style={{ width: `${width}%` }} />
        </li>
      ))}
    </ul>
  );
}

/** 操作成功的轻提示：2 秒后自动消失（沙箱里不能用 alert）。 */
function useToast() {
  const [text, setText] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    show(next: string) {
      clearTimeout(timer.current);
      setText(next);
      timer.current = setTimeout(() => setText(''), 2000);
    },
    node: text ? (
      <div className="zl-toast" role="status">
        {text}
      </div>
    ) : null,
  };
}

function formatTime(ms: number) {
  if (!ms) return '';
  const date = new Date(ms);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}
