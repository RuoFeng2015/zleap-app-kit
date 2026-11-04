import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';

import manifest from '../manifest.json';
import { describeError, errorCode, hasProfile } from './cloud/client';
import { addTodo, listTodos, onTodosChange, removeTodo, updateTodo, type Todo } from './cloud/todos';
import { useCloudConnection } from './cloud/useCloudConnection';

type Filter = 'all' | 'active' | 'done';

export function App() {
  const { state, retry } = useCloudConnection();

  return (
    <main className="app">
      <header className="app-header">
        <div>
          <p className="eyebrow">zleapOS App Cloud</p>
          <h1>{manifest.name}</h1>
        </div>
        <ConnectionBadge status={state.status} />
      </header>

      {state.status === 'standalone' ? (
        <Notice tone="info" title="当前是浏览器独立预览">
          Cloud SDK 只能在 zleapOS 的应用窗口里连接宿主。运行 <code>npm run deploy</code> 部署后从启动台打开；
          这里只用于调样式，不会展示任何数据。
        </Notice>
      ) : null}
      {state.status === 'error' ? (
        <Notice tone="bad" title="连接 zleapOS 失败" action={<button onClick={retry}>重试</button>}>
          {describeError({ errCode: state.code })}
        </Notice>
      ) : null}
      {state.status === 'ready' && !hasProfile(state.capabilities, 'document-core/1') ? (
        <Notice tone="warn" title="数据库能力未就绪">
          宿主没有协商到 document-core/1：通常是开发环境或数据库尚未开通，或窗口顶部「权限」里没有勾选数据读写。
        </Notice>
      ) : null}
      {state.status === 'ready' && hasProfile(state.capabilities, 'document-core/1') ? <TodoBoard /> : null}
    </main>
  );
}

function TodoBoard() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [title, setTitle] = useState('');

  const reload = useCallback(async () => {
    try {
      setTodos(await listTodos());
    } catch (error) {
      setMessage({ tone: 'bad', text: `读取失败：${describeError(error)}` });
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
      setMessage({ tone: 'ok', text: success });
    } catch (error) {
      // 结果未知时不自动重试：先重读，让用户看到真实状态再决定。
      const unknown = errorCode(error) === 'COMMIT_UNKNOWN';
      setMessage({ tone: unknown ? 'warn' : 'bad', text: describeError(error) });
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
    }, '已保存');
  };

  const visible = useMemo(
    () => todos.filter((todo) => (filter === 'all' ? true : filter === 'done' ? todo.done : !todo.done)),
    [todos, filter],
  );
  const doneCount = todos.filter((todo) => todo.done).length;

  return (
    <section className="board">
      <form className="composer" onSubmit={submit}>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="下一件想完成的事…"
          maxLength={200}
          aria-label="新待办"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !title.trim()}>
          添加
        </button>
      </form>

      <div className="toolbar">
        <div className="filters" role="group" aria-label="筛选">
          {(['all', 'active', 'done'] as const).map((value) => (
            <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {{ all: '全部', active: '未完成', done: '已完成' }[value]}
            </button>
          ))}
        </div>
        <span className="summary">
          {doneCount} 完成 · {todos.length - doneCount} 待办
        </span>
        <button className="ghost" onClick={() => void reload()} disabled={busy}>
          刷新
        </button>
      </div>

      {message ? <p className={`message is-${message.tone}`}>{message.text}</p> : null}

      {loading ? (
        <p className="empty">正在读取…</p>
      ) : visible.length === 0 ? (
        <p className="empty">这里还很安静。写下第一件小事吧。</p>
      ) : (
        <ul className="list">
          {visible.map((todo) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              busy={busy}
              onToggle={() => void mutate(() => updateTodo(todo, { done: !todo.done }), '已更新')}
              onRename={(next) => void mutate(() => updateTodo(todo, { title: next }), '已更新')}
              onRemove={() => void mutate(() => removeTodo(todo), '已删除')}
            />
          ))}
        </ul>
      )}
    </section>
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
  const [draft, setDraft] = useState(todo.title);

  if (editing) {
    return (
      <li className="row">
        <input value={draft} maxLength={200} onChange={(event) => setDraft(event.target.value)} aria-label="编辑待办" />
        <button
          disabled={busy || !draft.trim()}
          onClick={() => {
            onRename(draft.trim());
            setEditing(false);
          }}
        >
          保存
        </button>
        <button className="ghost" onClick={() => setEditing(false)}>
          取消
        </button>
      </li>
    );
  }
  return (
    <li className={`row${todo.done ? ' is-done' : ''}`}>
      <input type="checkbox" checked={todo.done} disabled={busy} onChange={onToggle} aria-label={`完成：${todo.title}`} />
      <span className="title">{todo.title}</span>
      <button
        className="ghost"
        disabled={busy}
        onClick={() => {
          setDraft(todo.title);
          setEditing(true);
        }}
      >
        编辑
      </button>
      <button className="ghost danger" disabled={busy} onClick={onRemove}>
        删除
      </button>
    </li>
  );
}

function ConnectionBadge({ status }: { status: string }) {
  const label = { connecting: '正在连接 OS', ready: '● OS 已连接', standalone: '独立预览', error: '连接需要处理' }[status];
  return <span className={`badge is-${status}`}>{label}</span>;
}

function Notice({
  tone,
  title,
  children,
  action,
}: {
  tone: 'info' | 'warn' | 'bad';
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`notice is-${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
      {action}
    </div>
  );
}
