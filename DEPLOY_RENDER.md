# THE VEIL — 免费公开部署指南（Render）

项目已准备为 Node.js Web Service：同一服务提供网站、内置 MP4 文件和 `/chat` WebSocket 公共聊天，不需要数据库、外部模型或 API 密钥。

## 部署步骤

1. 登录/注册 GitHub，并创建一个新的 **Public** repository，例如 `the-veil-archive`。
2. 将本 ZIP 解压后，把里面的所有项目文件和 `assets` 文件夹上传到仓库根目录。确保 `index.html`、`server.js`、`package.json`、`render.yaml` 都在根目录，`assets/` 里有 MP4 文件和海报。
3. 打开 https://dashboard.render.com/ ，注册/登录。
4. 在 Render 选择 **New + → Blueprint**，连接刚创建的 GitHub 仓库。
5. Render 会读取 `render.yaml`。确认服务计划为 **Free**，然后创建/部署。
6. 等部署完成，Render 会分配类似 `https://the-veil-archive.onrender.com` 的公开网址。以 Render 控制台实际生成的网址为准。
7. 用手机打开该 HTTPS 网址，接取任务后点击“播放档案影像 / PLAY”。分享该网址即可让其他人访问。

## 功能和免费方案限制

- HTTPS 页面会自动使用 WSS 连接同站 `/chat`，免登录公共聊天无需额外配置。
- 视频通过同站 `/assets/...mp4` 提供，服务器支持 HTTP Range 分段请求，适合浏览器视频播放。
- 免费 Web Service 在 15 分钟没有 HTTP 请求或收到 WebSocket 消息时会休眠；下次访问可能需要约一分钟唤醒。
- 聊天消息只在内存里广播，不会持久化；服务重启后在线人数和消息状态会清空。
- 这是公共匿名聊天室原型，尚未配置持久化、复杂内容审核或防滥用系统。请勿把它用于敏感或高风险场景。

## 本地运行

```bash
npm start
```

然后访问 http://localhost:4173 。
