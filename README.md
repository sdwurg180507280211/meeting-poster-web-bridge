# Meeting Poster PNG Renderer

`exp/node-png-render-reset` 是一条故意与旧 Photoshop 运行时不兼容的探索分支。

目标链路只有：

```text
Web Editor
  → Supabase Auth / Database / Storage
  → Node Render Worker
  → SVG Builder
  → @resvg/resvg-js
  → final.png
  → Supabase Storage
  → Web 查看 / 下载
```

运行时不需要 Photoshop、UXP、Mac Agent 或 PSD。

## 当前范围

当前 Node Renderer 只落地：

- `chronic-care-2026`（医路长安）
- 画布 `837 × 1880`
- 三个头像
- 一个二维码
- 会议时间 / 地点
- 主席与两位讲者
- 四行会议日程
- PNG-only 输出

## 两套布局的边界

### Web V 文字布局

Web 文字位置用于让浏览器预览与各自底板视觉对齐：

```text
V 调整 x / y / scale
→ Supabase poster_project_text_layouts
→ 只影响 Web 预览
```

它不进入最终 PNG 的文字排版。

### 正式 PNG 文字布局

最终 PNG 的文字排版只来自：

```text
render-worker/templates/<project>/manifest.json
```

其中保存正式文本的：

- PSD 迁移得到的 baseline `x / y`
- 字号
- 字重
- 颜色
- tracking
- 对齐方式
- `maxWidth`
- `minFontSize`

### A 素材布局

头像和二维码不同：Web A 工具调整的几何会进入任务中的 `payload.project.assetLayout`，Node Renderer 使用它生成最终 PNG。

## 模板生命周期

Photoshop 只允许出现在一次性迁移阶段：

```text
历史 PSD
  → template dump
  → compile-manifest.js
  → manifest.json
```

生产运行时只需要：

```text
manifest.json
background.png
RENDER_FONT_REGULAR
RENDER_FONT_SEMIBOLD
任务数据与素材
```

迁移证据放在：

```text
tools/template-migration/<project>/
```

`render-worker/src/` 禁止读取该目录或 PSD。

## 目录

```text
.github/workflows/
render-worker/
  src/
  scripts/
  templates/
supabase/
tests/
tools/template-migration/
web/
```

旧运行时目录 `mac-agent/`、`photoshop-worker/` 已从本分支删除。

## Render Worker

```bash
cd render-worker
cp .env.example .env
npm ci
npm run check
npm test
npm start
```

环境变量：

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SECRET_KEY=sb_secret_xxx
SUPABASE_BUCKET=poster-assets
WORKER_ID=node-renderer-1
POLL_MS=2000
LEASE_SECONDS=300
MAX_ATTEMPTS=3
RENDER_FONT_REGULAR=/absolute/path/to/regular.ttf
RENDER_FONT_SEMIBOLD=/absolute/path/to/semibold.ttf
```

字体不进入 Git。PingFang 只用于具备合法本机字体文件的视觉复刻验证；服务器部署应使用有权部署的字体文件。

## Web

```bash
cd web
python3 -m http.server 5173
```

Web 继续负责：

- 项目/底板预览
- 文字值编辑
- V 预览文字校准
- A 头像/二维码正式几何
- 头像 1024×1024 baked PNG 裁剪
- 二维码裁剪
- 创建任务
- 查看 PNG 结果

## Manifest 编译

医路长安的迁移数据：

```text
tools/template-migration/chronic-care-2026/template-dump-20260813.json
```

重新编译：

```bash
cd render-worker
npm run compile:manifest
```

测试会检查提交的 `manifest.json` 必须与 compiler 对迁移 dump 的结果完全一致，避免手工漂移。

## 渲染规则

- 文字使用 PSD `textItem.position` 迁移出的 baseline 坐标直接生成 SVG `<text x y>`。
- 字体由 Resvg `fontFiles` 显式加载，`loadSystemFonts: false`。
- `fontkit` 用于文字宽度测量。
- 超宽文字按 1px 逐级缩小，直到 `maxWidth` 或 `minFontSize`。
- 第一行讲者始终为空，这是当前业务规则。
- 第二/三行主席、第四行讲者等原 PSD“默认隐藏”字段只要任务有值就会渲染；PSD 初始可见性不是生产规则。
- Sharp 只负责运行时图片解码/统一为 PNG，不负责文字排版或最终文字 rasterize。

## 当前验收状态

已经具备：

- Resvg PNG 渲染内核
- 显式字体注册
- PSD baseline → manifest 编译
- 精确到每一行每一格的日程文字坐标
- Supabase Worker
- Web PNG-only 任务流程
- PNG 结果上传/查看
- Node Renderer CI

仍需要做的核心验收：

```text
同一份真实会议数据
→ 原 Photoshop 参考 PNG
→ Node Renderer PNG
→ 视觉对照并微调 manifest / 字体度量规则
```

这条探索分支不会自动合并到 `main`。
