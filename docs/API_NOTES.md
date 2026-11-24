# RisuAI API notes

공식 소스 확인일: 2026-11-24. 특정 사용자의 설치 버전은 확인하지 않았다.

## Primary references

- https://github.com/kwaroran/Risuai/blob/main/plugins.md
- https://github.com/kwaroran/Risuai/blob/main/src/ts/plugins/apiV3/risuai.d.ts
- https://github.com/kwaroran/Risuai/blob/main/src/ts/plugins/apiV3/v3.svelte.ts
- https://github.com/kwaroran/Risuai/blob/main/src/ts/storage/database.svelte.ts
- https://github.com/kwaroran/Risuai/blob/main/src/ts/process/request/request.ts

## Used contracts

- Global `risuai` (alias `Risuai`), sandboxed iframe, API 3.0. All methods return promises.
- `getDatabase(['characters'])`: database subset. `characters` can be an array or keyed object. Preserve `Object.values()` index order for index-based API calls.
- `getCharacterFromIndex(index)` / `setCharacterToIndex(index, character)`: read/write by database index. Locate by stable `chaId`, verify identity, then verify the write by reading again. A denied write may resolve without writing.
- Character description is `desc`; per-character lorebook is `globalLore`. Entries include `id`, `comment`, `key`, `secondkey`, `content`, `mode`, `insertorder`, `alwaysActive`, `selective`, `useRegex`, and other fields that must be preserved.
- Entry `mode:'folder'` is not an editable content entry. Entries without IDs require conservative matching.
- `getLocalPluginStorage()` returns async `getItem/setItem` storage. Keys are explicitly prefixed `lore-studio:v1:`. This storage is device-local.
- `registerSetting`, `registerButton`, `showContainer('fullscreen')`, `hideContainer()` expose the UI. Plugin DOM is ordinary iframe DOM; no main-document access is needed.
- `runLLMModel({messages, mode, allowPlugins:true})`: mode `model` maps to the configured main model; `submodel` maps to auxiliary model. Do not force `staticModel`, which would bypass the user's selection.
- Result shapes supported by `core.responseText`: string, `{type:'success', result:string}`, `{type:'fail',result:string}`, `{type:'multiline',result:[role,text][]}`, and a readable `streaming` result. Streaming object chunks use accumulated text in key `0`; do not concatenate snapshots.
- Responses may include optional `model`. A direct supported method to read configured main/auxiliary model names is not available in the inspected API. Do not invent one or read hidden credentials/settings.
- No cancellation signal is documented for this requester; cancellation invalidates the result token. Do not promise refund/cancellation of already submitted requests.

Downloaded upstream source copies and old machine logs were intentionally omitted from the handoff archive. Follow the official links when more context or updated contracts are needed.
