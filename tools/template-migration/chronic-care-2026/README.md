# chronic-care-2026 template migration

This directory contains one-time migration evidence used to move the 医路长安 design out of Photoshop.

- `template-dump-20260813.json`: extracted PSD layer/text geometry used by `render-worker/scripts/compile-manifest.js`.
- `master.psd`: optional design-source archive. It is not a runtime dependency and may be uploaded manually when needed.

Runtime code must only use:

```text
render-worker/templates/chronic-care-2026/manifest.json
render-worker/templates/chronic-care-2026/background.png
RENDER_FONT_REGULAR
RENDER_FONT_SEMIBOLD
```

Nothing under `tools/template-migration/` may be read by `render-worker/src/`.
