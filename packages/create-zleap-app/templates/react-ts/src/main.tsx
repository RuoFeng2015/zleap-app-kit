import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// 官方样式（与 zleapOS 桌面同色，自动跟随亮 / 暗）在前，应用自己的样式在后。
import '@zleap-ai/app-sdk/zleap.css';

import { App } from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
