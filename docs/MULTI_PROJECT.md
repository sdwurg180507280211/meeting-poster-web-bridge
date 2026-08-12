# 多项目 / 多底板工作流

当前三个正式项目：

| 项目 | project.id | Web 底板 | Photoshop PSD |
|---|---|---|---|
| 医路长安 | `chronic-care-2026` | 已接入正式底板 | 本地绑定 |
| 同护健康 | `tonghu-jiankang` | 当前使用轻量占位底板 | 本地绑定 |
| 同心护健 | `tongxin-hujian` | 当前使用轻量占位底板 | 本地绑定 |

## 核心规则

三份 PSD 均由 `tools/会议海报模板_PSD生成_UXP_v10_文字层语义命名修复.psjs` 生成，因此共享：

- 837 × 1880 画布。
- 同一套语义图层名称。
- 同一套会议字段、两位讲者、四行日程。
- 同一套头像 / 二维码智能对象结构。
- 同一个 `photoshop-worker/src/constants.js`。
- 同一个 `render-contract.js` 与 `ps-engine.js`。

项目差异只包括：项目 ID / 名称、Web 预览底板、本机 PSD 文件。

## Web 项目切换

项目注册集中在 `web/project-registry.js`。三项目共享 `meeting-series-common-v1` 内容结构和当前图片布局契约。

“同护健康 / 同心护健”现阶段为了避免大底图传输，Web 只显示轻量占位背景；这不会影响正式生成。任务提交时仍携带正确的 `project.id`，Photoshop Worker 根据该 ID 使用对应的本地 PSD。

表单草稿、头像、二维码继续共用现有本地草稿，因此切换项目不需要重新填写会议资料。

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

## 后续新增项目

如果新增项目仍由同一 `tools` 脚本生成、只更换底板：

1. 在 `web/project-registry.js` 增加项目。
2. 在 `photoshop-worker/src/projects.js` 增加相同 `project.id` / 名称。
3. Web 可先使用 `preview.type = 'placeholder'`，无需立即上传大底图。
4. 本机 Worker 选择一次对应 PSD 并通过自检。
5. CI 会检查 Web 与 Worker 项目注册是否一致。

只有当新项目的字段、图层结构或图片布局真正发生变化时，才新增独立 content/template profile；不要因为底板不同复制整套页面或渲染引擎。
