import { useCallback, useEffect, useState } from 'react';

import { connect, errorCode, isStandalone, type ConnectionState } from './client';

/** 连接宿主的状态机：standalone（浏览器独立预览）/ connecting / ready / error。 */
export function useCloudConnection() {
  const [state, setState] = useState<ConnectionState>(() =>
    isStandalone() ? { status: 'standalone' } : { status: 'connecting' },
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
