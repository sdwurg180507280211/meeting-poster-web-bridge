# Meeting Poster Web Bridge

目标：浏览器填写会议资料并上传头像/二维码，任务经 Supabase 进入 Mac，最终由 **真实 Photoshop + PSD 母版** 自动生成 PSD/PNG，再回传网页。

## 架构

```text
Browser
  → Supabase Auth / Database / Storage
  → Mac Agent
  → Local Workspace
  → Photoshop UXP Worker
  → PSD / PNG
  → Mac Agent 上传结果
  → Browser 下载
```

当前渲染协议：**Render Protocol v2**。

图片布局由 `web/poster-project.js -> POSTER_PROJECT.assetPreview` 唯一维护，并随任务 `assetLayout` 传入 Photoshop。网页文字位置/字号只用于预览；文字内容同步 PSD。

## 目录

- `web/`：浏览器编辑器。
- `supabase/`：数据库、RLS、任务租约、渲染协议和任务控制 migration。
- `mac-agent/`：常驻 Node.js Agent，负责 Supabase ↔ 本机文件搬运、租约、恢复与结果上传。
- `photoshop-worker/`：Photoshop UXP Worker，负责母版校验和 PSD/PNG 渲染。
- `tests/`：Playwright 浏览器 E2E。

## 0. 环境要求

- Photoshop 2026 / PS 26.1+
- Node.js 22+
- Supabase 项目
- 当前语义化 PSD 母版

## 1. Supabase

对新项目或已有项目都按 migration 顺序执行：

1. `supabase/001_poster_jobs.sql`
2. `supabase/002_poster_service_status.sql`
3. `supabase/003_poster_security_hardening.sql`
4. `supabase/004_baked_avatar_render_contract.sql`
5. `supabase/005_preflight_and_job_controls.sql`

005 增加：

- `cancelled` 任务状态。
- `cancel_poster_job(uuid)`：仅允许用户取消仍处于 `pending` 的自己的任务。
- `retry_poster_job(uuid)`：允许 `failed / succeeded / cancelled` 使用原素材重新排队。
- `poster_preflight(text)`：浏览器系统自检 RPC。

Authentication 中启用 **Anonymous Sign-Ins**。

网页只使用 Publishable Key；Mac Agent 使用 Secret Key / service role。Secret Key 严禁进入 `web/`。

## 2. Web 配置

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

本地运行：

```bash
cd web
python3 -m http.server 5173
```

浏览器打开 `http://localhost:5173`。

### 公网部署安全

公网入口必须再加一层访问控制，例如：

- Vercel Deployment Protection
- Cloudflare Access
- 企业 SSO / 反向代理认证

匿名 Supabase Auth + RLS + 数据库配额属于纵深防御，不能替代入口认证。否则陌生访客仍可能不断创建匿名身份并消耗本机 Photoshop 资源。

## 3. 头像与图片规则

三张人物头像必须：

```text
上传原图
→ 打开头像裁剪弹窗
→ 调整人物位置/大小
→ 点击“应用裁剪”
→ 浏览器生成 1024×1024 baked PNG
→ 上传 Supabase
→ Photoshop 按完整方形画布映射到 PSD 目标框
```

后台只接受：

- `cropMode = baked`
- `outputSize = 1024`
- PNG
- `crop = { zoom: 1, offsetX: 0, offsetY: 0 }`

这样浏览器和 Photoshop 不会重复解释同一套裁剪参数。

## 4. Mac Agent

```bash
cd mac-agent
cp .env.example .env
```

示例：

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SECRET_KEY=你的_sb_secret
SUPABASE_BUCKET=poster-assets
WORKSPACE_DIR=/Users/你的用户名/MeetingPosterAgent
POLL_MS=2000
AGENT_ID=my-mac-photoshop
KEEP_LOCAL_JOBS=false
```

启动：

```bash
npm install
npm start
```

或使用仓库提供的 `.command` 启停脚本。

`npm start` 是正式入口。`src/start.js` 在 `KEEP_LOCAL_JOBS` 未配置时默认设置为 `false`，避免 `inbox/outbox` 长期堆积。只有排查问题时才临时设置 `KEEP_LOCAL_JOBS=true`。

Agent 当前包含：

- 单实例锁。
- 原子任务认领。
- claimed / rendering 租约。
- Worker 心跳判断。
- 过期任务自动恢复与最大重试次数。
- 输入 MIME / 文件签名 / 大小校验。
- 输出文件名与路径校验。
- 成功后本地清理。

## 5. Photoshop Worker

安装到：

```text
~/Library/Application Support/Adobe/UXP/Plugins/External/meeting-poster-web-worker/
```

可运行：

```text
photoshop-worker/install-external.command
```

然后完全退出并重新启动 Photoshop。

首次打开 Worker：

1. 选择 PSD 母版。
2. 选择 Agent Workspace。
3. Worker 自动执行 PSD 母版自检。
4. 自检通过后才允许启动自动接单。

PSD 自检包括：

- 837×1880 画布。
- 必要根级文件夹。
- 必要文字、头像、二维码、固定标题图层。
- 头像和二维码目标必须为智能对象。

母版不合格时 Worker 会写入 `template_error` 心跳，网页“系统自检”会直接显示 **PSD 母版异常**，不会继续接单。

## 6. 网页系统自检

点击顶部 **生成服务状态** 即可打开“系统自检”。

检查内容包括：

- Web 编辑器运行版本。
- Render Protocol v2。
- 项目画布。
- 时间选择组件。
- Supabase `poster_preflight` RPC。
- 数据库 schema / 004 render contract trigger。
- 005 任务控制能力。
- Storage bucket。
- Mac Agent 心跳。
- Photoshop Worker 心跳 / 自动接单状态。
- PSD 母版自检状态。

出现红色阻断项时不建议继续提交任务。

## 7. 任务控制

网页“任务”页现在提供安全任务操作：

- `pending`：可取消。
- `claimed / rendering / uploading`：不提供暴力中断，避免正在下载、Photoshop 写文件或上传时留下半成品。
- `failed / succeeded / cancelled`：可以使用原会议资料和原素材重新生成。

重新生成仍使用原 job 和原 input storage 路径；结果文件会重新覆盖同一任务的 output 路径。

## 8. 状态流转

正常流程：

```text
pending
→ claimed
→ rendering
→ uploading
→ succeeded
```

异常终态：

```text
failed
cancelled
```

租约超时且未超过最大尝试次数的任务可以自动重新进入 `pending`。

## 9. 浏览器 E2E

仓库根目录：

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

Playwright 会真正启动 Chromium 验证：

- 左侧顶部工具栏保持隐藏。
- 右侧编辑栏可左右拖动并保存宽度。
- 左键可平移海报工作区且不会改海报几何。
- 系统自检面板可正常展示。
- 任务页的取消 / 重新生成按钮按状态正确出现。

E2E 会拦截 Supabase API，不写入生产任务或生产 Storage。

GitHub Actions 同时执行：

- Mac Agent 单元测试。
- Web / Agent / Worker JS 语法检查。
- Render contract / UXP bootstrap 结构保护。
- PSD 母版 preflight guard 保护。
- Playwright Chromium E2E。

## 10. 生产运行建议

- Mac 登录后自动启动 Agent（launchd）。
- Photoshop 与 Worker 面板在生产期间保持打开。
- 公网入口使用额外认证。
- 定期清理 Supabase Storage 中过期的 input/output 资源。
- 不要把 `SUPABASE_SECRET_KEY`、service role key 或本机绝对路径提交到仓库。
