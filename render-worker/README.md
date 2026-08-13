# Node PNG Render Worker — exploration checkpoint

This branch is an intentionally incompatible exploration of a PNG-only runtime.

## Runtime goal

Browser -> Supabase -> Node Render Worker -> final.png

Photoshop, UXP and the Mac Agent are not runtime dependencies in this branch.

## Current checkpoint

Implemented:
- template loading and validation
- Sharp-based text/image compositing core
- runtime asset geometry input
- circular avatar masking
- QR rendering
- 4-row schedule normalization
- first-row speaker suppression

Still being completed after this checkpoint:
- Supabase job client
- polling worker loop
- chronic-care-2026 manifest
- Web job payload cleanup
- removal of old Mac/Photoshop runtime code

## Required binary template files

The following files are intentionally not committed by the assistant and must be added separately:

```text
render-worker/templates/chronic-care-2026/background.png
render-worker/templates/chronic-care-2026/fonts/regular.otf
render-worker/templates/chronic-care-2026/fonts/semibold.otf
tools/psd-template/sources/chronic-care-2026/master.psd
```

`master.psd` is design-source only. The Node runtime must never read PSD files.
