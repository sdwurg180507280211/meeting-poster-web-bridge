# Node PNG Render Worker

独立的新一代海报 Renderer（PNG-only）。不再依赖 Photoshop / UXP / Mac Agent。

```text
Browser -> Supabase -> Node Render Worker -> final.png
```

## 渲染内核

- 完整 SVG 构建（背景 / 圆形头像 / 二维码 / 文字）→ `@resvg/resvg-js` 一次渲染出 PNG
- 文字定位使用 PSD `textItem.position` 基线模型：`x` = 锚点（align 决定 text-anchor），`y` = 基线
- 字体经 `fontFiles` 显式加载（`loadSystemFonts: false`），SVG 内用真实 family 名 + 字重匹配，不依赖系统字体、不使用 @font-face
- 自动缩字号：fontkit 精确测量文本宽度，超 `maxWidth` 按比例缩放（`minFontSize` 兜底）
- `tracking` 为 PS 千分 em 原值，渲染时自动换算 `tracking / 1000 * fontSize` px

## 任务契约

- 复用现有 **render protocol v2**（`claim_next_poster_job` / lease / `payload.project.assetLayout`），Web 端零改动
- 项目：`chronic-care-2026`（医路长安）

## 模板结构

```text
render-worker/
├── package.json
├── src/
│   ├── template.js     # manifest 加载 + 校验 + 字体 env registry
│   ├── renderer.js     # SVG 构建 + resvg 渲染
│   ├── supabase.js     # 任务认领 / 状态推进 / Storage 下载上传
│   └── worker.js       # 轮询主循环
├── scripts/
│   ├── compile-manifest.js  # 一次性迁移：PSD dump → manifest
│   └── fixture-render.js    # 本地渲染验证
└── templates/
    └── chronic-care-2026/
        ├── manifest.json    # 设计真相（schemaVersion 1）
        └── background.png   # 底图 + Logo + 固定标题（动态层已烘焙剥离）
```

字体**不随模板入库**：由环境变量提供（`RENDER_FONT_REGULAR` / `RENDER_FONT_SEMIBOLD`），
切换字体（如未来部署 Linux 换思源黑体）无需改动模板目录。

## manifest schema v1

```jsonc
{
  "schemaVersion": 1,
  "projectId": "chronic-care-2026",
  "canvas": { "width": 837, "height": 1880 },
  "background": "background.png",
  "images": {                       // 素材默认几何；运行时 payload.project.assetLayout 优先
    "chair": { "left": 342, "top": 496, "size": 168 }
  },
  "texts": {                        // 静态（text）或动态（source 路径表达式 + prefix/suffix）
    "sectionChair": { "text": "会议主席", "x": 419, "y": 456, "fontSize": 34, "weight": "semibold", "align": "center", "tracking": 40, "color": "#5435D6" },
    "chairName": { "source": "chair.name", "x": 419, "y": 701, "fontSize": 21, "weight": "semibold", "align": "center", "tracking": 90, "color": "#191919", "maxWidth": 121 }
  },
  "schedule": {                     // 4 行固定，rows = 各行基线 y
    "rows": [1324, 1389, 1454, 1519],
    "columns": {
      "time":    { "x": 145.5, "align": "center", "fontSize": 20, "weight": "regular", "color": "#191919" },
      "speaker": { "x": 521.5, "align": "center", "fontSize": 20, "weight": "regular", "color": "#191919", "hiddenRows": [3] },
      "chair":   { "x": 680.5, "align": "center", "fontSize": 20, "weight": "regular", "color": "#191919", "hiddenRows": [1, 2] }
    },
    "dot": { "size": 13, "color": "#5435D6", "x": 236.5, "ys": [1320, 1386, 1450], "hiddenRows": [3] }
  }
}
```

- `hiddenRows`：模板级固定隐藏（PSD 中该行该列无正常图层）；渲染时字段为空 → 不画
- 日程第一行讲者恒隐藏（业务规则，`cleanSchedule` 强制）

## 一次性迁移（最后一次使用 Photoshop）

```text
Photoshop(PSD)
   → tools/ps-remote/extract-template-info.jsx  → template-dump-*.json
   → render-worker/scripts/compile-manifest.js  → manifest.json
```

此后 manifest 即设计真相，运行时不再读 PSD。

## 本地运行

```bash
cp .env.example .env   # 填 SUPABASE_URL / SUPABASE_SECRET_KEY / 字体路径
npm install

# 单元测试
npm test

# 渲染 fixture（验证内核，不依赖 Supabase）
node scripts/fixture-render.js   # 输出 /tmp/rw-test/fixture.png

# 启动轮询 worker
npm start
```

## 状态

- [x] 渲染内核（resvg-js + 基线定位 + 显式字体加载）
- [x] Supabase 客户端 / 轮询 worker / 任务租约
- [x] Web 流程 PNG-only 改造（本分支）
- [x] 移除 Photoshop / Mac Agent 运行时（本分支）
- [ ] Node PNG vs 原 Photoshop PNG 对照 fixture（待验收）
- [ ] 云端字体方案定稿（Linux 部署用可分发字体）
