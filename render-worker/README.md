# Node PNG Render Worker

独立 PNG Renderer：运行时不依赖 Photoshop、UXP、Mac Agent 或 PSD。

```text
Browser → Supabase → Node Render Worker → SVG → Resvg → final.png
```

## 渲染内核

- 背景、圆形头像、二维码、文字统一组成一张 SVG。
- 最终 rasterize 只使用 `@resvg/resvg-js`。
- 正式文字坐标使用迁移自 PSD `textItem.position` 的 baseline `x / y`。
- 字体通过 Resvg `fontFiles` 显式加载，并设置 `loadSystemFonts: false`。
- `fontkit` 只负责字体信息和文本宽度测量。
- Sharp 只用于把 JPEG/WebP 等运行时图片统一解码成 PNG 后再嵌入 SVG。
- Photoshop tracking 原值按 `tracking / 1000 * fontSize` 换算为 SVG `letter-spacing`。
- 超过 `maxWidth` 的文字按 1px 逐级减小，最低到 `minFontSize`。

## 运行时输入

当前继续接收 Render Protocol v2 任务：

```text
payload.meeting
payload.assets
payload.project.id
payload.project.canvas
payload.project.assetLayout
```

正式文字位置**不**来自 Web V 布局。

头像和二维码几何优先来自 `payload.project.assetLayout`；manifest 的 `images` 只是项目默认值。

## 模板目录

```text
render-worker/
├── src/
│   ├── template.js
│   ├── renderer.js
│   ├── supabase.js
│   └── worker.js
├── scripts/
│   ├── compile-manifest.js
│   ├── compile-manifest.test.js
│   └── fixture-render.js
└── templates/
    └── chronic-care-2026/
        ├── manifest.json
        └── background.png
```

字体不放在模板目录，也不提交 Git：

```env
RENDER_FONT_REGULAR=/absolute/path/to/regular.ttf
RENDER_FONT_SEMIBOLD=/absolute/path/to/semibold.ttf
```

## Manifest v1

### 普通文字

每一个正式文字对象直接保存设计坐标：

```json
{
  "chairName": {
    "x": 419,
    "y": 701,
    "fontSize": 21,
    "minFontSize": 12,
    "weight": "semibold",
    "align": "center",
    "tracking": 90,
    "color": "#191919",
    "maxWidth": 121,
    "source": "chair.name",
    "suffix": " 教授"
  }
}
```

`x / y` 是 SVG text anchor / baseline，不是矩形框左上角。

### 日程

日程不再使用“公共列 + 行 Y”推导模型。

每一行、每一格都保留 PSD 实际文字图层自己的：

```text
x / y
fontSize
tracking
align
color
maxWidth
```

结构：

```json
{
  "schedule": {
    "rows": [
      {
        "time": { "x": 145.5, "y": 1324, "fontSize": 20 },
        "content": { "x": 263, "y": 1325, "fontSize": 20 },
        "speaker": { "x": 521.5, "y": 1324, "fontSize": 20 },
        "chair": { "x": 680.5, "y": 1323, "fontSize": 20 },
        "dot": { "x": 236.5, "y": 1320, "fontSize": 15, "text": "●" }
      }
    ]
  }
}
```

PSD 的“默认隐藏”状态不转换成永久规则：

- 第二/三行主席有值就画。
- 第四行讲者有值就画。
- 第四行内容有值就画。
- 圆点随对应行 `content` 是否有值决定。
- 只有第一行讲者由当前业务规则强制为空。

## 一次性模板迁移

迁移数据位于：

```text
tools/template-migration/chronic-care-2026/template-dump-20260813.json
```

生成正式 manifest：

```bash
npm run compile:manifest
```

生命周期：

```text
历史 PSD
→ 一次性 template dump
→ compile-manifest.js
→ manifest.json
→ 从此生产运行时不再读取 PSD/dump
```

`compile-manifest.test.js` 会验证提交的 `manifest.json` 与 migration dump 编译结果完全一致。

## 本地运行

```bash
cd render-worker
cp .env.example .env
npm ci
npm run check
npm test
npm start
```

本地有合法字体文件时，可以单独生成 fixture：

```bash
npm run fixture
```

fixture 使用和真实 Web 一致的数据形态：姓名不自带“教授”、meetingTime 不自带“会议时间：”；这些展示规则由 manifest 的 `suffix / prefix` 决定。

## 当前状态

已完成：

- Resvg 最终渲染
- 显式字体加载
- baseline 定位
- tracking
- maxWidth + 1px 逐级缩字号
- 头像圆形裁切
- QR 图片格式归一化
- 精确 per-cell 日程 manifest
- Supabase Worker
- PNG 上传
- manifest compiler + drift test

待视觉验收：

```text
真实 Photoshop reference.png
vs
Node fixture/output.png
```

视觉验收完成后，manifest 即正式设计真相。
