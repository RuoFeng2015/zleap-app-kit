/**
 * todos 集合的读写封装。集合结构在 manifest.json 的 data.schemas.todos 里声明，
 * 服务端按它严格校验；这里的类型必须与之保持一致。
 */
import { database, type Document } from './client';

export const COLLECTION = 'todos';
export const PAGE_SIZE = 100; // 平台单次读取上限

export interface Todo {
  id: string;
  version: string;
  title: string;
  done: boolean;
  createdAt: number;
}

function toTodo(doc: Document): Todo {
  return {
    id: doc._id,
    version: doc._version,
    title: String(doc.title ?? ''),
    done: Boolean(doc.done),
    createdAt: Number(doc.created_at ?? 0),
  };
}

const todos = () => database().collection(COLLECTION);

/** 读取全部本人待办（按创建时间倒序，逐页读取，最多 maxPages 页）。 */
export async function listTodos(maxPages = 10): Promise<Todo[]> {
  const out: Todo[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const { data } = await todos()
      .orderBy('created_at', 'desc')
      .skip(page * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .get();
    out.push(...data.map(toTodo));
    if (data.length < PAGE_SIZE) break;
  }
  return out;
}

export async function addTodo(title: string): Promise<void> {
  await todos().add({ data: { title, done: false, created_at: Date.now() } });
}

/** 带 expectedVersion 的乐观锁更新：别处先改过会得到 VERSION_CONFLICT。 */
export async function updateTodo(todo: Todo, patch: Partial<Pick<Todo, 'title' | 'done'>>): Promise<void> {
  await todos()
    .doc(todo.id)
    .update({ data: patch, agentos: { expectedVersion: todo.version } });
}

export async function removeTodo(todo: Todo): Promise<void> {
  await todos()
    .doc(todo.id)
    .remove({ agentos: { expectedVersion: todo.version } });
}

/** 宿主推送的变更只是「需要重读」的信号；未协商推送时不会触发，调用方仍可手动刷新。 */
export function onTodosChange(handler: () => void): () => void {
  return todos().onChange(() => handler());
}
