# Meeting Poster Web Bridge

浏览器填写会议资料、上传头像和二维码，经 Supabase 将任务交给 Mac Agent，再由真实 Photoshop UXP Worker 基于本地 PSD 母版生成 PNG 海报并回传网页。

```text
Browser
  → Supabase Auth / Database / Storage
  → Mac Agent
  → Local Workspace
  → Photoshop UXP Worker
  → PNG
  → Mac Agent 上传结果
  → Browser 下载
```

当前渲染协议：**Render Protocol v2**。

## 当前项目模型

当前支持三个项目：

- 医路长安
- 同护健康
- 同心护健

三个项目共用同一套会议字段和 Photoshop 图层结构，但分别拥有：

- 自己的 Web 底板
- 自己的 Web 文字布局
- 自己的头像 / 二维码布局
- 自己绑定的本地 PSD 文件

网页文字位置和字号只用于预览；文字内容同步 PSD。头像和二维码的位置 / 尺寸由当前项目的 `assetPreview` 生成 Render Contract，并同步 Photoshop。

## 目录

- `web/`：浏览器编辑器。
- `supabase/`：数据库、RLS、任务租约、Render Protocol v2 和任务控制 schema。
- `mac-agent/`：Supabase ↔ 本机文件搬运、任务认领、租约、恢复和结果上传。
- `photoshop-worker/`：Photoshop UXP Worker，负责严格校验 PSD 母版并生成 PNG 海报。
- `tests/`：Playwright 浏览器 E2E。

## 1. 环境要求

- Photoshop 2026 / PS 26.1+
- Node.js 22+
- Supabase 项目
- 符合当前语义化图层规范的三份 PSD

## 2. Supabase

从空项目部署时按仓库现有 schema 文件顺序执行：

1. `supabase/001_poster_jobs.sql`
2. `supabase/002_poster_service_status.sql`
3. `supabase/003_poster_security_hardening.sql`
4. `supabase/004_baked_avatar_render_contract.sql`
5. `supabase/005_preflight_and_job_controls.sql`
6. `supabase/006_restrict_preflight_rpc.sql`

Authentication 启用 **Anonymous Sign-Ins**。

网页只使用 Publishable Key；Mac Agent 只使用 `SUPABASE_SECRET_KEY`。Secret Key 严禁进入 `web/`。

### 公网部署

公网入口需要额外访问控制，例如 Vercel Deployment Protection、Cloudflare Access 或企业 SSO。Anonymous Sign-In + RLS + 配额是数据边界，不替代入口认证。

## 3. Web

```bash
cd web
cp config.example.js config.js
```

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

### 文字布局

`V 选择文字` 只编辑当前项目的 Web 预览：

- 单选 / Ctrl(Cmd) 多选
- 框选
- 批量拖动
- 方向键 1px
- Shift + 方向键 10px
- 对齐 / 分布
- 撤销 / 重做

文字布局不会覆盖 PSD 中的文字位置。

### 素材布局

`A 素材布局` 编辑主席头像、两位讲者头像和二维码：

- 单选 / Ctrl(Cmd) 多选
- 拖动
- 单项等比缩放
- 方向键 1px / Shift 10px
- 对齐
- 撤销 / 重做

素材布局写入当前项目 `assetPreview`，提交时进入 Render Contract，因此会同步到 Photoshop。

## 4. 头像规则

头像只有一条有效路径：

```text
选择原图
→ 裁剪弹窗调整
→ 点击“应用裁剪”
→ 浏览器生成 1024×1024 PNG
→ 上传 Supabase
→ Photoshop 固定映射到项目目标框
```

任务只接受：

- `cropMode = baked`
- `outputSize = 1024`
- PNG
- `crop = { zoom: 1, offsetX: 0, offsetY: 0 }`

裁剪状态只存在于裁剪弹窗；提交协议、Agent 和 Worker 都不支持 raw avatar。

## 5. Mac Agent

```bash
cd mac-agent
cp .env.example .env
npm install
npm start
```

核心配置：

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SECRET_KEY=你的_sb_secret
SUPABASE_BUCKET=poster-assets
WORKSPACE_DIR=/Users/你的用户名/MeetingPosterAgent
POLL_MS=2000
AGENT_ID=my-mac-photoshop
KEEP_LOCAL_JOBS=false
```

Agent 使用当前数据库契约：

- `claim_next_poster_job`
- `recover_stale_poster_jobs`
- 任务 lease 字段
- Render Protocol v2

启动时数据库能力不可用即启动失败，不会退回旧式 `select → update claimed` 接单模式。

Agent 当前包含：

- 单实例锁
- 原子任务认领
- claimed / rendering / uploading 租约
- 过期任务恢复与最大尝试次数
- 输入 MIME / 文件签名 / 大小校验
- 输出路径 / 文件名 / 大小校验
- 成功后本地清理

## 6. Photoshop Worker

安装：

```text
photoshop-worker/install-external.command
```

然后完全退出并重新启动 Photoshop。

首次设置：

1. 分别为医路长安、同护健康、同心护健选择本地 PSD。
2. 选择 Agent Workspace。
3. Worker 严格检查三份 PSD。
4. 三份全部通过后才能自动接单。

PSD 自检包括：

- 837×1880 画布
- 必要根级文件夹
- 当前规范要求的文字、头像、二维码和固定图层名
- 头像和二维码目标必须为智能对象

Worker 不修复旧图层名，也不接受旧单模板设置。PSD 不符合当前结构时直接报错。

## 7. 系统自检

点击顶部生成服务状态打开系统自检，检查：

- Web 运行版本
- Render Protocol v2
- 当前项目画布
- 时间组件
- Supabase capability RPC
- Render Contract trigger
- 任务控制 RPC
- Storage bucket
- Mac Agent 心跳
- Photoshop Worker 状态
- PSD 母版状态

出现阻断项时不应提交任务。

## 8. 任务状态

```text
pending
→ claimed
→ rendering
→ uploading
→ succeeded
```

终态：

```text
failed
cancelled
```

任务控制：

- `pending`：可取消
- `claimed / rendering / uploading`：不暴力中断
- `failed / succeeded / cancelled`：可重新生成

## 9. 测试

根目录：

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

GitHub Actions 验证：

- Mac Agent 单元测试
- Web / Agent / Worker JavaScript 语法
- 当前-only 协议：无旧 DB fallback、无 raw avatar、无 PSD 旧层名修复
- Render Contract v2
- 多项目 PSD 路由
- 项目文字 / 素材布局
- A / V 选择状态
- 画布平移和缩放
- 系统自检与任务控制
- Chromium Playwright E2E

E2E 拦截 Supabase API，不写生产任务或生产 Storage。

## 10. 生产运行

- Mac 登录后自动启动 Agent。
- Photoshop 与 Worker 面板在生产期间保持打开。
- 公网入口启用访问控制。
- 定期清理 Supabase Storage 中过期 input/output。
- 不提交 `SUPABASE_SECRET_KEY` 或本机绝对路径。
