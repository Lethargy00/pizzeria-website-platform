# tenants/

**Data only.** One folder per pizzeria: `site.config.yaml`, `theme.yaml`, `content/` (YAML + Markdown) and `assets/` (images, WOFF2 fonts).

Never add `package.json`, lockfiles, `node_modules`, `.npmrc`, scripts, import maps or external script/style/font URLs here. `pnpm tenant-guard` fails the build if you do (PROMPT.md §6, ADR 0001).
