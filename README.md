# Meeting Poster Web Bridge v1

目标：别人通过公网浏览器填写会议资料/上传头像和二维码，最终由你的 Mac 上 **真实 Photoshop 2026 + PSD 母版** 自动生成 PSD 与 PNG，再回传网页。

## 架构

浏览器（静态网页） → Supabase（匿名登录 + Storage + poster_jobs） → Mac Agent → 本机 Workspace → Photoshop Web Worker（复用 v3.0.6 ps-engine） → PSD/PNG → Mac Agent 上传 Supabase → 浏览器下载。

这版刻意 **不使用 Adobe Firefly Services / Photoshop Cloud API**，也不让 UXP 连 localhost。

## 目录

- `web/`：公网网页，可部署 Vercel / Cloudflare Pages。
- `supabase/001_poster_jobs.sql`：任务表、RLS、私有 Storage bucket 与基础策略。
- `supabase/002_poster_service_status.sql`：Mac Agent / Photoshop Worker 在线状态。
- `supabase/003_poster_security_hardening.sql`：现有项目升级所需的权限、校验、限额、租约与原子认领加固。
- `mac-agent/`：Node.js 常驻 Agent，负责云端 ↔ 本机文件搬运。
- `photoshop-worker/`：Photoshop UXP Worker，自动扫描本机任务并复用已验证的 v3.0.6 生成引擎。

## 0. 要求

- Photoshop 2026（你当前环境即可）
- Node.js 22+（当前 Supabase JS SDK 已不再支持 Node.js 20）
- 一个 Supabase 项目
- 你的最终 PSD 母版（v10/v3.0.6 已验证结构）

## 1. Supabase

1. 新建或选择一个 Supabase 项目。
2. SQL Editor 按顺序执行：
   - `supabase/001_poster_jobs.sql`
   - `supabase/002_poster_service_status.sql`
   - `supabase/003_poster_security_hardening.sql`
3. Dashboard → Authentication → Providers / Sign In → **启用 Anonymous Sign-Ins**。
4. Project Settings / API 获取：
   - Project URL
   - Publishable key（或 legacy anon key）
   - service_role key（仅给 Mac Agent，绝不能放网页）

## 2. 配网页

复制：

```bash
cd web
cp config.example.js config.js
```

填写：

```js
window.POSTER_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xxx",
  BUCKET: "poster-assets"
};
```

本地测试不要直接双击 file://，建议：

```bash
cd web
python3 -m http.server 5173
```

浏览器打开 `http://localhost:5173`。

部署 Vercel：进入 `web` 目录执行 `npx vercel`，或直接把 `web` 目录作为静态站点发布。

> 公网部署前必须配置 Vercel Deployment Protection、Cloudflare Access 或等效的服务端访问控制。匿名登录、数据库内每用户限额和文件校验是纵深防御，不能替代公网入口认证；匿名访客仍可清除浏览器状态并创建新身份。

## 3. Mac Agent

```bash
cd mac-agent
cp .env.example .env
```

填写 `.env`：

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=你的_service_role_secret
SUPABASE_BUCKET=poster-assets
WORKSPACE_DIR=/Users/你的用户名/MeetingPosterAgent
POLL_MS=2000
AGENT_ID=my-mac-photoshop
KEEP_LOCAL_JOBS=true
```

然后：

```bash
npm install
npm start
```

或双击 `run-agent.command`。

Agent 会自动创建：

```text
~/MeetingPosterAgent/
  inbox/
  outbox/
  archive/
```

## 4. 安装 Photoshop Worker

按你当前已经跑通的 External 目录方式：

```text
~/Library/Application Support/Adobe/UXP/Plugins/External/meeting-poster-web-worker/
```

可以直接双击/运行 `photoshop-worker/install-external.command`，然后完全退出并重启 Photoshop。

Photoshop → 插件 → `海报 Web Worker`。

第一次：

1. `选择 PSD 母版`：选择你现在 v3.0.6 已验证可生成的母版。
2. `选择 Agent Workspace`：选择 `~/MeetingPosterAgent`。
3. 点击 `启动自动接单`（设置恢复后以后会自动开始）。
4. 演示期间保持 Photoshop 和该 Worker 面板打开。

## 5. 完整流程

浏览器：

1. 填会议时间、地点。
2. 填主席/两讲者姓名、职称、医院。
3. 上传三张头像并调整缩放/左右/上下。
4. 填最多 4 行日程。
5. 上传二维码。
6. 点击“生成正式海报”。

后台会依次显示：

`pending → claimed → rendering → uploading → succeeded`

最终网页显示真实 Photoshop 生成的 PNG，并提供 PNG/PSD 下载链接。

## 6. 为什么效果能跟 v3.0.6 一致

`photoshop-worker/src/ps-engine.js` 与 `constants.js` 直接来自你已验证成功的 v3.0.6；动态文字、三头像 cover/裁剪、二维码、日程显隐、文字自动缩放、PSD+PNG 保存都继续走同一套 Photoshop DOM/batchPlay 逻辑。

浏览器只负责收集数据和裁剪参数，不负责仿制海报。

## 7. 安全边界

- `SUPABASE_SERVICE_ROLE_KEY` **只能放 Mac Agent `.env`**。
- 网页只放 Publishable/anon key；RLS 仅允许匿名用户访问自己的任务与 Storage 路径。
- Bucket 是 private，最终下载链接使用 30 分钟 Signed URL。
- 临时公网演示建议再加一层访问密码/Cloudflare Access，防止陌生人批量消耗你的 Mac Photoshop。

## 8. 当前 v1 限制

- Photoshop 必须运行，Worker 面板保持打开。
- 同一台 Mac 默认串行生成，一次一个任务。
- Mac 离线时任务会停在 `pending`，恢复后继续。
- 还没有管理员后台、队列取消、超时重试、限流/验证码。

## 9. 下一步建议

第一轮先跑通本地浏览器 → Supabase → Mac → Photoshop → 回传。确认后再做：

- Vercel/Cloudflare 公网部署
- 访问密码/验证码
- 任务超时与重试
- 管理员任务列表
- Mac Agent 登录时自动启动（launchd）
- Worker 健康心跳与“Mac 在线/离线”状态
