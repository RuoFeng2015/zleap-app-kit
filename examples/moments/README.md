# 同事圈（示例应用）

公司内部的小型朋友圈，用来演示 zleapOS 云开发的完整链路。2026-11-01 在 .6（os-dev）上从脚手架一路走到上线、多人使用、团队迭代和回退。

| 功能 | 用到的平台能力 |
|---|---|
| 发动态（文字 + 最多 3 张图） | 共享集合 `posts` / `photos`，写规则 `doc.author == auth.openid` |
| 原图（仅作者可下载） | 文件存储 `cloud.storage.*`（按人隔离） |
| 点赞 / 取消、评论、删除自己的评论（帖子作者也可删） | 共享集合 `likes` / `comments`，文档键 `帖子_作者` 保证一人一赞 |
| 显示昵称 | 授权登录 `zl.auth.authorize({ scopes: ['profile'] })`，manifest `host_api.requires: ["user.profile"]` |
| 实时刷新 | `collection.onChange`（宿主推送）+ 15 秒轮询兜底 |
| 新版本提示 | `zl.app.getUpdateManager()` |
| 我的互动（v1.1） | 云函数 `stats` + 每 5 分钟定时触发器，私有集合 `digest` |

```bash
npm install
npm run login -- --target https://<你的 zleapOS>
npm run deploy                 # 构建 → 检查 → 上传开发版本 → 装到自己桌面
npm run release -- --notes "…" # 发布为线上版本（全企业可见）
```

manifest 里的 `appid` 换成你在云开发控制台「创建应用」拿到的。
