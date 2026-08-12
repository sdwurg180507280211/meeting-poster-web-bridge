# 多项目 / 多底板工作流

当前三个正式项目：

| 项目 | project.id | Web 底板 | Photoshop PSD |
|---|---|---|---|
| 医路长安 | `chronic-care-2026` | 已接入正式底板 | 本地绑定 |
| 同护健康 | `tonghu-jiankang` | 已接入正式底板 | 本地绑定 |
| 同心护健 | `tongxin-hujian` | 已接入正式底板 | 本地绑定 |

## 核心规则

三份 PSD 均由 `tools/会议海报模板_PSD生成_UXP_v10_文字层语义命名修复.psjs` 生成，因此共享：

- 837 × 1880 画布。
- 同一套语义图层名称。
- 同一套会议字段、两位讲者、四行日程。
- 同一套头像 / 二维码智能对象结构。
- 同一个 `photoshop-worker/src/constants.js`。
- 同一个 `render-contract.js` 与 `ps-engine.js`。

但“结构一致”不代表不同底板上的视觉坐标完全一致，因此项目级布局拆为两套 profile：

- `textLayoutProfile`：每个项目自己的 Web 文字位置、字号和宽度，只影响网页预览。
- `assetLayoutProfile`：每个项目自己的主席头像、两位讲者头像和二维码位置/尺寸，会进入 Render Contract 并同步 Photoshop。

项目差异包括：项目 ID / 名称、Web 预览底板、本机 PSD、文字布局 profile、素材布局 profile。

## Web 项目切换

项目注册集中在 `web/project-registry.js`。三项目共享 `meeting-series-common-v1` 内容结构，但分别绑定自己的 `textLayoutProfile` 与 `assetLayoutProfile`。

表单草稿、上传头像和二维码素材仍继续共用现有本地草稿，因此切换项目不需要重新填写会议资料；布局坐标则按项目独立保存，不会互相污染。

### 文字布局

使用左侧 `V 选择文字`：

- 单选 / Ctrl/Cmd 多选。
- 批量拖动。
- 方向键 1px，Shift + 方向键 10px。
- 对齐、分布、撤销、重做。
- 只影响 Web 预览，不改变 PSD 文字坐标。

### 头像 / 二维码布局

使用左侧 `A 素材布局`：

- 主席头像、讲者一、讲者二、二维码分别可拖动。
- 单选时可等比例缩放素材框。
- Ctrl/Cmd 多选可整体移动。
- 方向键 1px，Shift + 方向键 10px。
- 对齐、撤销、重做、重置。
- 本机覆盖保存为 `posterAssetLayout:<projectId>:<assetLayoutProfile>`。
- 调整会直接更新 `POSTER_PROJECT.assetPreview`；任务提交时 Render Contract 从该对象读取 `assetLayout`，因此正式 Photoshop 输出使用同一套坐标。

## Photoshop Worker 一次性绑定

新版 Worker 面板中分别选择：

1. 医路长安 PSD
2. 同护健康 PSD
3. 同心护健 PSD
4. Agent Workspace

PSD persistent token 只保存在 Photoshop UXP 本地设置；PSD 路径不会上传 Supabase。

旧版 Worker 已保存的单一 PSD token 会自动迁移为“医路长安”绑定，因此升级后通常只需再选择“同护健康”和“同心护健”两份 PSD。

每份 PSD 都使用同一个 v10 `SPEC` 做结构自检。三个正式项目全部通过自检后，Worker 才进入自动接单状态并向网页报告生成服务在线。

## 任务路由

任务中的：

```text
meeting.__renderContract.project.id
```

决定正式渲染使用哪一份本地 PSD。Worker 不根据文件名猜项目，也不会回退到另一项目 PSD，从而避免错底板生成。

任务中的：

```text
meeting.__renderContract.project.assetLayout
```

由当前项目实时的 `POSTER_PROJECT.assetPreview` 生成，所以头像 / 二维码在 Web 中校准后，正式 PSD 也使用相同的位置和尺寸。

## 后续新增项目

如果新增项目仍由同一 `tools` 脚本生成、只更换底板：

1. 在 `web/project-registry.js` 增加项目。
2. 在 `web/text-layout-profiles.js` 增加独立文字 profile。
3. 在 `web/asset-layout-profiles.js` 增加独立素材 profile。
4. 在 `photoshop-worker/src/projects.js` 增加相同 `project.id` / 名称。
5. 本机 Worker 选择一次对应 PSD 并通过自检。
6. 在 Web 中分别校准文字与头像 / 二维码坐标。
7. CI 会检查 Web 与 Worker 项目注册以及 profile 映射是否一致。

不要因为底板不同复制整套页面或渲染引擎；共享内容结构与 Photoshop 引擎，差异放在项目 profile 中。
