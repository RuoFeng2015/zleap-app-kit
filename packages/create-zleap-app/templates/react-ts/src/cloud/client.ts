/**
 * Cloud SDK 的唯一接入点。应用其余代码只从这里拿 db / 错误工具，不直接碰 SDK 包。
 *
 * 平台约束（不要绕过）：
 * - 应用运行在 sandbox iframe（opaque origin、connect-src 'none'）：不能 fetch、不能用 localStorage、不能弹 alert。
 * - 环境由宿主决定：永远用 DYNAMIC_CURRENT_ENV，不要写死 'dev' / 'prod'。
 * - 每次读最多 100 条，用 skip 翻页；写入结果未知（COMMIT_UNKNOWN）时先重读核对，不要自动重试。
 */
import { CloudError, zl, type Capabilities } from '@zleap-ai/app-sdk';

export { CloudError };
export type { Capabilities };
export type { Document } from '@zleap-ai/app-sdk';

export type ConnectionState =
  | { status: 'connecting' }
  | { status: 'ready'; capabilities: Capabilities }
  | { status: 'standalone' }
  | { status: 'error'; code: string };

let connection: Promise<Capabilities> | null = null;

/** 浏览器直接打开（npm run dev）时没有宿主窗口，SDK 握手只会超时。 */
export function isStandalone(): boolean {
  try {
    return window.parent === window;
  } catch {
    return false;
  }
}

/** 与宿主握手一次；失败后允许重新尝试。 */
export function connect(): Promise<Capabilities> {
  if (!connection) {
    zl.cloud.init({ env: zl.cloud.DYNAMIC_CURRENT_ENV });
    connection = zl.cloud.os.ready().catch((error: unknown) => {
      connection = null;
      throw error;
    });
  }
  return connection;
}

export function database() {
  return zl.cloud.database();
}

/** 是否协商到了某个能力档（如 document-core/1、storage-object/1、app-execution/1）。 */
export function hasProfile(capabilities: Capabilities, profile: string): boolean {
  return capabilities.profiles.includes(profile);
}

export function errorCode(error: unknown): string {
  if (error instanceof CloudError) return error.errCode;
  if (error && typeof error === 'object' && 'errCode' in error) return String((error as { errCode: unknown }).errCode);
  return error instanceof Error ? error.message : String(error);
}

/**
 * 面向用户的中文说明。未知错误码原样展示，方便对照文档「状态与错误码」。
 *
 * 宿主只把错误码（errCode）交给应用，不传服务端的中文说明，所以文案在这里按码维护。
 */
export function describeError(error: unknown): string {
  const code = errorCode(error);
  const hints: Record<string, string> = {
    SCOPE_FORBIDDEN: '还没有这项权限：点应用窗口顶部「权限」，勾选后保存（应用会自动重新加载）。',
    PUBLISHER_REQUIRED: '开发数据只对应用成员开放；给其他人用请在云开发控制台「版本管理」里发布为线上版本。',
    ENV_FORBIDDEN: '这个应用还没有上线：请应用成员在云开发控制台「版本管理」里把版本发布为线上版本（平台会自动准备生产环境）。',
    RESOURCE_NOT_READY: '云数据库正在开通，通常一分钟内就绪，请稍后刷新。',
    COLLECTION_NOT_FOUND: '数据集合还没建好：开发环境稍等一分钟后刷新；线上版本请应用成员重新发布一次（发布时自动建生产集合）。',
    SCHEMA_INVALID: '数据不符合集合结构（字段缺失、类型不对、内容过大或多了未声明字段）。',
    VERSION_CONFLICT: '数据已在别处更新，请刷新后再改。',
    COMMIT_UNKNOWN: '保存结果未知，请刷新核对后再决定是否重试。',
    INDEX_REQUIRED: '这个查询要扫描的数据太多：给筛选字段建索引，或缩小筛选范围。',
    APP_RATE_LIMITED: '应用此刻请求太多，请稍后再试。',
    RESOURCE_EXHAUSTED: '超出了数量或容量上限，请清理不再需要的数据后再试。',
    NODE_LOST: '后台任务结果暂未确认，请稍后刷新查看，不要重复提交。',
    CALL_TIMEOUT: '连接宿主超时：请从 zleapOS 桌面打开应用。',
    RUNTIME_UNAVAILABLE: '云服务暂时不可用，请稍后重试。',
    RELEASE_UNAVAILABLE: '应用版本已切换，请重新加载应用。',
  };
  return hints[code] ? `${hints[code]}（${code}）` : code;
}
