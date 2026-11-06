import { useCallback, useEffect, useState } from 'react';

import { connect, errorCode, isStandalone, type ConnectionState } from './client';

/** 连接宿主的状态机：preview（浏览器独立打开，示例数据）/ connecting / ready / error。 */
export function useCloudConnection() {
  const [state, setState] = useState<ConnectionState>(() =>
    isStandalone() ? { status: 'preview' } : { status: 'connecting' },
  );

  const retry = useCallback(() => {
    if (isStandalone()) return;
    setState({ status: 'connecting' });
    connect().then(
      (capabilities) => setState({ status: 'ready', capabilities }),
      (error: unknown) => setState({ status: 'error', code: errorCode(error) }),
    );
  }, []);

  useEffect(() => {
    retry();
  }, [retry]);

  return { state, retry };
}
