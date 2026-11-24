# Project instructions for the next Codex session

Read `HANDOFF.md`, then `README.md` before editing. The user wants to continue the existing RisuAI plugin; this is not a ChatGPT/Codex MCP plugin or a hosted website.

## Preserve the accepted product

- Name: **로어북 스튜디오 & 번역기**. Plugin identity `risu_lorebook_studio` and existing `lore-studio:v1:*` storage keys must remain stable.
- Korean interface with minimal text. Do not add explanatory panels, a permanent status bar, or extra controls without a request.
- Description and lore tabs share the existing parallel source/editor layout. The `description-*` DOM IDs and `.description-tab` CSS class are intentionally reused by lore.
- Full translation is view-only. Partial translation immediately replaces the exact selected range in the editable pane. Character data changes only on the explicit apply button.
- Header connection display is a colored dot and model name only; status text belongs in accessible attributes/tooltips, not a second line.
- Misc translation shows exactly two panes and language/partial/full controls under the left pane.
- Respect both dark and light themes, fixed pane sizes, inner scrolling, responsive layout, backups, and conflict checks.

## Work on the source

- Edit `src/core.js`, `src/app.js`, `src/view.html`, and `src/style.css` as appropriate.
- `dist/lorebook-studio.js` and `preview/standalone.html` are generated: run `node scripts/build.cjs` after source changes. Do not edit generated files directly.
- Keep the sandboxed RisuAI API 3.0 architecture; every RisuAI API method is asynchronous.
- Reuse the user's RisuAI main/auxiliary model connections. Do not add API keys, an OpenAI SDK, a backend, or hosting for ordinary plugin work.
- `preview/mock.js` is an offline demo adapter and must never enter the installable plugin.
- Runtime, build, preview and archive generation use Node built-ins only. Playwright is an optional development dependency for browser QA.

## Verification and packaging

```sh
node scripts/build.cjs
node --test tests/core.test.cjs
node scripts/preview.cjs
```

Browser verification: `npm install`, `npx playwright install chromium`, then `npm run test:browser`. If using an installed Edge on Windows, set `PLAYWRIGHT_CHANNEL=msedge` instead of downloading Chromium. Tests start their own temporary HTTP server.

Run checks appropriate to the change. Do not claim that mocked browser tests validate a real RisuAI installation or a real model call. Review screenshots after substantial UI work. `src/style.css` contains successive overrides; later rules define the current layout. Avoid a large CSS rewrite unless requested or necessary, and verify every tab and theme if consolidating it.

Create the transferable archive with `node scripts/package.cjs`. It rebuilds generated outputs and writes a ZIP and checksum into `deliverables/`. Ship source, docs, tests and preview, not `node_modules`, logs, downloaded upstream source, personal paths, or real user data.
