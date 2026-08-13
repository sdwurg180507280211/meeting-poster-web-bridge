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
  → Browser 自动下载 / 任务下载
```

当前渲染协议：**Render Protocol v2**。

## 当前项目模型

当前支持三个项目：

- 医路长安
- 同护健康
- 同心护健

三个项目共用同一套会议字段和 Photoshop 图层结构，但分别拥有自己的 Web 底板、Web 文字布局、头像 / 二维码布局和本地 PSD 绑定。

网页文字位置和缩放只用于预览；文字内容同步 PSD。头像和二维码的位置 / 尺寸由当前项目的 `assetPreview` 生成 Render Contract，并同步 Photoshop。

## 目录

- `web/`：浏览器编辑器。
- `supabase/schema.sql`：当前数据库唯一 schema，包含 RLS、任务租约、Render Protocol v2、任务控制和文字布局存储。
- `mac-agent/`：Supabase ↔ 本机文件搬运、任务认领、租约、恢复和结果上传。
- `photoshop-worker/`：Photoshop UXP Worker，负责严格校验本地 PSD 母版并生成 PNG 海报。
- `tests/`：Playwright 浏览器 E2E。
- `tools/ps-remote/`：按需从 Photoshop 提取母版信息的维护工具，不参与生产运行。

## 1. 环境要求

- Photoshop 2026 / PS 26.1+
- Node.js 22+
- Supabase 项目
- 符合当前语义化图层规范的三份 PSD

## 2. Supabase

空项目只执行一份当前 schema：

```text
supabase/schema.sql
```

仓库不保留历史升级 SQL 或兼容层；Git 历史负责保存演进记录。Authentication 启用 **Anonymous Sign-Ins**。

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

### 直接编辑文字

可编辑的动态文字无需进入布局模式，直接在海报上双击即可原位编辑并同步右侧表单。会议时间、日程时间、姓名、医院等继续复用现有字段和校验逻辑。

### 布局工具

页面只保留一个 `L 布局工具`。开启后按点击对象自动切换对应布局模块：

- 文字：单选 / Ctrl(Cmd) 多选、框选、拖动、单项等比缩放、方向键 1px、Shift + 方向键 10px、撤销 / 重做。
- 头像 / 二维码：单选 / Ctrl(Cmd) 多选、拖动、单项等比缩放、方向键 1px、Shift + 方向键 10px、撤销 / 重做。

布局工具只处理位置和尺寸。关闭布局工具后点击头像或二维码进入素材裁剪；开启布局工具时双击素材也不会切换到裁剪操作。

文字布局自动保存到当前项目的云端文字布局记录，但不会覆盖 PSD 中的文字位置。素材布局写入当前项目 `assetPreview`，提交时进入 Render Contract，因此会同步到 Photoshop。

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

裁剪状态只存在于裁剪弹窗；提交协议、Agent 和 Worker 都只接受当前 baked avatar 契约。

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

启动时数据库能力不可用即启动失败，不会退回旧式接单模式。

Agent 当前包含：单实例锁、原子任务认领、租约、过期任务恢复、输入/输出校验和成功后的本地清理。

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

PSD 自检包括 837×1880 画布、必要根级文件夹、当前规范图层名，以及头像和二维码目标智能对象。Worker 不修复旧图层名，也不回退到旧单模板设置；PSD 不符合当前结构时直接报错。

## 7. 系统自检

系统自检检查 Web 版本、Render Protocol v2、当前项目、Supabase capability、Render Contract trigger、任务控制、Storage、Mac Agent、Photoshop Worker 和 PSD 母版状态。出现阻断项时不应提交任务。

## 8. 任务状态与下载

```text
pending → claimed → rendering → uploading → succeeded
```

终态：`failed`、`cancelled`。

- `pending`：可取消。
- `claimed / rendering / uploading`：不暴力中断。
- `succeeded`：可查看并下载已有 PNG，不重新创建任务。
- `failed / cancelled`：不提供重新生成入口。

用户点击“生成正式海报”创建的任务成功后，页面会自动触发一次 PNG 下载；自动下载只绑定本次提交的任务，不会因为查看旧历史任务而重复触发。

## 9. 测试

根目录：

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

GitHub Actions 只保留 `.github/workflows/verify.yml`，分为：

- `agent-tests`：Mac Agent 单元测试。
- `contracts`：所有 JavaScript 语法和当前架构静态契约。
- `browser-e2e`：完整 Chromium Playwright E2E。

静态契约重点防止旧 DB fallback、旧任务重试、PSD 结果输出、旧头像协议和重复工具重新进入主分支；E2E 覆盖多项目、布局、选择、文字编辑、画布交互、系统自检和任务控制。E2E 拦截 Supabase API，不写生产任务或生产 Storage。

## 10. 生产运行

- Mac 登录后自动启动 Agent。
- Photoshop 与 Worker 面板在生产期间保持打开。
- 公网入口启用访问控制。
- 定期清理 Supabase Storage 中过期 input/output。
- 不提交 `SUPABASE_SECRET_KEY` 或本机绝对路径。
