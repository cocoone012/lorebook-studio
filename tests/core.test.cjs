const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');
const entry = (id = 'lore-a') => ({ id, comment: '숲', key: 'forest', secondkey: '', content: '어두운 숲. {{char}}가 걷는다.', insertorder: 100, mode: 'normal', alwaysActive: false, selective: false, extentions: { risu_case_sensitive: true }, folder: 'folder-1' });
function fixture() {
  let db = { characters: { a: { chaId: 'bot-a', name: '아리아', desc: 'Original description', globalLore: [entry()], chats: [{ message: ['preserve'] }] }, b: { chaId: 'bot-b', name: '레온', desc: 'Second bot', globalLore: [entry('lore-b')] } } };
  const map = new Map();
  const storage = { getItem: async key => C.copy(map.get(key) ?? null), setItem: async (key, value) => { map.set(key, C.copy(value)); } };
  let writes = 0;
  const api = { getDatabase: async () => C.copy(db), getCharacterFromIndex: async i => C.copy(Object.values(db.characters)[i] || null), setCharacterToIndex: async (i, char) => { writes++; db.characters[Object.keys(db.characters)[i]] = C.copy(char); } };
  const bot = C.characters(db)[0];
  return { api, storage, map, bot, draft: C.makeDraft(bot, 0), get db() { return db; }, get writes() { return writes; } };
}
test('object and array databases retain indices while excluding groups', () => {
  const db = { characters: [{ type: 'group', chaId: 'g' }, { chaId: 'b', name: 'Bot' }] };
  assert.equal(C.characters(db)[0].index, 1);
  assert.throws(() => C.characters(null), /권한/);
});
test('all tasks use the selected main or sub model and do not force a static model', () => {
  for (const mode of ['model', 'submodel']) for (const task of ['edit', 'en', 'ko']) {
    const req = C.createRequest(entry(), task, '더 자세하게', null, mode);
    assert.equal(req.mode, mode); assert.equal(req.staticModel, undefined); assert.equal(req.allowPlugins, true);
  }
});
test('editing uses the complete default prompt or the exact customized prompt', () => {
  const request = prompt => C.createRequest(entry(), 'edit', '문장을 다듬어 줘', null, 'model', prompt);
  assert.equal(request().messages[0].content, C.DEFAULT_EDIT_PROMPT);
  assert.match(C.DEFAULT_EDIT_PROMPT, /Keep the source language/);
  const custom = '사용자 설정 프롬프트\n{{char}}와 서식을 유지하세요.';
  const changed = request(custom);
  assert.equal(changed.messages[0].content, custom);
  assert.deepEqual(JSON.parse(changed.messages[1].content), { task: '문장을 다듬어 줘', title: '숲', source: entry().content });
  assert.equal(request('').messages[0].content, '');
});

test('custom editing prompts do not change translation instructions', () => {
  for (const task of ['ko', 'en']) {
    const original = C.createRequest(entry(), task, '', null, 'submodel');
    const custom = C.createRequest(entry(), task, '', null, 'submodel', '임의의 수정 프롬프트');
    assert.deepEqual(custom.messages, original.messages);
  }
});

test('selection replacement uses exact offsets even for duplicate text and Korean emoji', () => {
  const text = '별🌙 숲 숲 끝'; const start = text.lastIndexOf('숲');
  const req = C.createRequest({ content: text }, 'en', '', { start, end: start + 1 }, 'model');
  assert.equal(req.source, '숲');
  assert.equal(C.applyResult(text, { ...req, text: 'forest' }), '별🌙 숲 forest 끝');
});
test('stale selection result refuses to overwrite newer content', () => {
  assert.throws(() => C.applyResult('changed', { snapshot: 'original', text: 'result' }), /변경/);
  assert.throws(() => C.createRequest(entry(), 'en', '', { start: -1, end: 10 }, 'model'), /드래그/);
});
test('successful save merges one entry and preserves chat and unknown settings', async () => {
  const f = fixture(); f.draft.entry.content = 'Edited';
  f.db.characters.a.globalLore[0].activationPercent = 42;
  f.db.characters.a.globalLore[0].loreCache = { key: 'old' };
  await C.saveDraft(f.api, f.storage, f.draft);
  const saved = f.db.characters.a.globalLore[0];
  assert.equal(saved.content, 'Edited'); assert.equal(saved.activationPercent, 42);
  assert.deepEqual(saved.extentions, { risu_case_sensitive: true }); assert.equal(saved.folder, 'folder-1');
  assert.equal(saved.loreCache, undefined); assert.deepEqual(f.db.characters.a.chats, [{ message: ['preserve'] }]);
  assert.equal(f.db.characters.b.globalLore[0].content, entry().content); assert.equal(C.dirty(f.draft), false);
});
test('same-field concurrent edit is rejected without a write', async () => {
  const f = fixture(); f.draft.entry.content = 'Plugin edit'; f.db.characters.a.globalLore[0].content = 'External edit';
  await assert.rejects(C.saveDraft(f.api, f.storage, f.draft), /同|같은 필드/); assert.equal(f.writes, 0);
});
test('bot reorder resolves by stable identity and never writes to selected other bot', async () => {
  const f = fixture(); f.draft.entry.content = 'Edited';
  const { a, b } = f.db.characters; f.db.characters = { b, a };
  await C.saveDraft(f.api, f.storage, f.draft);
  assert.equal(f.db.characters.a.globalLore[0].content, 'Edited'); assert.equal(f.db.characters.b.globalLore[0].content, entry().content);
});
test('duplicate entry IDs and ambiguous legacy entries cannot overwrite a different entry', async () => {
  const f = fixture(); f.db.characters.a.globalLore.push(entry()); f.draft.entry.content = 'Edited';
  await assert.rejects(C.saveDraft(f.api, f.storage, f.draft), /중복/);
  const legacy = entry(); delete legacy.id;
  assert.throws(() => C.locateEntry([legacy, C.copy(legacy)], { original: legacy }), /확정/);
});
test('a backup failure aborts the write and denied writes are not reported as success', async () => {
  const f = fixture(); f.draft.entry.content = 'Edited';
  await assert.rejects(C.saveDraft(f.api, { getItem: async () => [], setItem: async () => { throw new Error('Disk full'); } }, f.draft), /Disk full/);
  assert.equal(f.writes, 0);
  f.api.setCharacterToIndex = async () => {};
  await assert.rejects(C.saveDraft(f.api, f.storage, f.draft), /쓰기 권한/);
  assert.equal(C.dirty(f.draft), true);
});
test('first imported original stays immutable across multiple saves and imports', async () => {
  const f = fixture(); const key = C.draftKey(f.bot, f.draft.entry, 0);
  await C.backupOriginal(f.storage, f.draft, key);
  f.draft.entry.content = 'Version two'; await C.saveDraft(f.api, f.storage, f.draft);
  await C.backupOriginal(f.storage, f.draft, key);
  const originals = await f.storage.getItem('lore-studio:v1:originals:bot-a');
  assert.equal(originals.length, 1); assert.equal(originals[0].entry.content, entry().content);
});
test('description supports backup, edit, save while preserving lorebook and chat', async () => {
  const f = fixture(); const draft = C.makeDescriptionDraft(f.bot);
  await C.backupOriginal(f.storage, draft, C.draftKey(f.bot, null, -1));
  draft.entry.content = '새 디스크립션'; await C.saveDraft(f.api, f.storage, draft);
  assert.equal(f.db.characters.a.desc, '새 디스크립션'); assert.deepEqual(f.db.characters.a.globalLore, [entry()]);
  assert.deepEqual(f.db.characters.a.chats, [{ message: ['preserve'] }]);
  const originals = await f.storage.getItem('lore-studio:v1:originals:bot-a');
  assert.equal(originals[0].entry.content, 'Original description');
});
test('description concurrent edits conflict instead of silently overwriting', async () => {
  const f = fixture(); const draft = C.makeDescriptionDraft(f.bot); draft.entry.content = 'Mine'; f.db.characters.a.desc = 'Elsewhere';
  await assert.rejects(C.saveDraft(f.api, f.storage, draft), /같은 필드/);
});
test('save history is capped at twelve while original backups remain separate', async () => {
  const f = fixture(); await C.backupOriginal(f.storage, f.draft, 'original');
  for (let i = 0; i < 15; i++) { f.draft.entry.content = 'Revision ' + i; await C.saveDraft(f.api, f.storage, f.draft); }
  assert.equal((await f.storage.getItem('lore-studio:v1:backups:bot-a')).length, 12);
  assert.equal((await f.storage.getItem('lore-studio:v1:originals:bot-a')).length, 1);
});
test('model failures, empty responses and actual RisuAI result shapes', async () => {
  assert.equal(await C.responseText({ type: 'success', result: 'OK' }), 'OK');
  assert.equal(await C.responseText({ type: 'multiline', result: [['user', 'ignore'], ['char', 'A'], ['char', 'B']] }), 'A\nB');
  await assert.rejects(C.responseText({ type: 'fail', result: 'Rate limit' }), /Rate limit/);
  await assert.rejects(C.responseText({ type: 'success', result: '' }), /본문/);
});
test('streaming snapshot chunks are not duplicated and unavailable streams explain the workaround', async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue({ 0: 'A' }); controller.enqueue({ 0: 'AB' }); controller.close(); } });
  assert.equal(await C.responseText({ type: 'streaming', result: stream }), 'AB');
  await assert.rejects(C.responseText({ type: 'streaming', result: {} }), /스트리밍을 끈/);
});
