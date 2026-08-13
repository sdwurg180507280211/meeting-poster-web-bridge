# Deployment

生产前端部署由 Vercel 承担。

当前约定：

- `main` 是唯一 Production Branch。
- feature 分支只运行 GitHub Actions，不要求创建 Vercel Preview Deployment。
- PR 在 `contracts`、`agent-tests`、`browser-e2e` 全绿后合并到 `main`。
- `main` 每次产生新 commit 后触发一次 Vercel Production Deployment。
- 不通过额外空提交反复触发部署；正常开发应尽量合并改动后一次发布。

生产链路保持：Browser → Supabase → Mac Agent → Photoshop UXP Worker → PNG。
