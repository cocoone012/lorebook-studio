(async function () {
  'use strict';
  const C = globalThis.LoreCore;
  const api = globalThis.risuai || globalThis.Risuai;
  const pluginName = globalThis.LoreAssets.displayName || '로어북 스튜디오 & 번역기';
  if (!api) throw new Error('RisuAI API 3.0에서 실행해 주세요.');
  const style = document.createElement('style');
  style.textContent = globalThis.LoreAssets.css;
  document.head.append(style);
  document.body.innerHTML = globalThis.LoreAssets.html;
  const $ = id => document.getElementById(id);
  const botHome = document.createComment('character picker home'); $('bot').before(botHome);
  const saveHome = document.createComment('commit button home'); $('save').before(saveHome);
  $('lore-search-body').append($('lore-library'));
  $('lore-settings-body').append($('lore-fields'));
  const state = { bots: [], libraryId: '', draft: null, key: '', selection: null,
    model: 'model', theme: 'dark', editPrompt: C.DEFAULT_EDIT_PROMPT, pending: null, translation: null, resultTab: 'result', busy: false, token: 0,
    tab: 'lore', cache: new Map(), loreSelections: new Map(), sourceTranslations: new Map(), labels: {}, modelInfo: {},
    connections: { model: { state: 'unknown' }, submodel: { state: 'unknown' } },
    undo: [], redo: [], timer: null, storage: null, queue: Promise.resolve(), storageFailed: false };
  function status(message, kind = '') { $('status').textContent = message; $('status').className = 'status-message' + (kind ? ' ' + kind : ''); }
  function estimatedTokens(text) {
    const chars = Array.from(text);
    const wide = chars.filter(c => c.codePointAt(0) > 127).length;
    return Math.ceil(wide * 1.5 + (chars.length - wide) / 4);
  }
  function applyTheme(theme) {
    state.theme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = state.theme;
    for (const name of ['dark', 'light']) $('theme-' + name).setAttribute('aria-pressed', String(name === state.theme));
  }
  function currentSource() {
    const bot = state.bots.find(b => b.id === state.libraryId);
    if (!bot) return null;
    if (state.tab === 'lore') {
      const selectedKey = state.loreSelections.get(bot.id);
      let index = bot.entries.findIndex((entry, i) => entry.mode !== 'folder' && C.draftKey(bot, entry, i) === selectedKey);
      if (index < 0) index = bot.entries.findIndex(entry => entry.mode !== 'folder');
      if (index < 0) return null;
      const entry = bot.entries[index];
      return { bot, index, entry, key: C.draftKey(bot, entry, index), content: entry.content || '' };
    }
    return { bot, index: -1, entry: { content: bot.description }, key: C.draftKey(bot, null, -1), content: bot.description };
  }
  const message = error => error instanceof Error ? error.message : String(error);
  function listen(id, type, handler) {
    $(id).addEventListener(type, event => {
      Promise.resolve().then(() => handler(event)).catch(error => status(message(error), 'error'));
    });
  }
  function enqueue(key, value) {
    const snapshot = C.copy(value);
    const op = state.queue.catch(() => {}).then(() => state.storage.setItem(key, snapshot));
    state.queue = op;
    return op;
  }
  async function persist() {
    clearTimeout(state.timer);
    if (!state.draft) return;
    state.draft.updatedAt = Date.now();
    try {
      await enqueue(state.key, state.draft);
      state.storageFailed = false;
      $('storage-state').textContent = '초안 자동 보관됨';
      $('draft-time').textContent = '초안 ' + new Date(state.draft.updatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    } catch (error) {
      state.storageFailed = true;
      $('storage-state').textContent = '초안 보관 실패 · 내보내기 권장';
      throw new Error('초안 보관에 실패했습니다. 내보내기로 내용을 보관해 주세요. ' + message(error));
    }
  }
  function schedulePersist() {
    clearTimeout(state.timer);
    $('storage-state').textContent = '초안 보관 중…';
    state.timer = setTimeout(() => persist().catch(error => status(message(error), 'error')), 400);
  }
  function updateButtons() {
    const loaded = !!state.draft;
    const working = state.busy || state.switching;
    const blocked = !loaded || working;
    for (const id of ['ai-edit', 'full-ko', 'full-en']) $(id).disabled = blocked;
    for (const id of ['part-ko', 'part-en']) $(id).disabled = blocked || !state.selection;
    $('save').disabled = blocked || state.tab === 'misc' || !C.dirty(state.draft);
    $('apply').disabled = blocked || !!state.pending?.viewOnly;
    $('undo').disabled = blocked || !state.undo.length;
    $('redo').disabled = blocked || !state.redo.length;
    $('translation-copy').disabled = !state.translation;
    $('translation-expand').disabled = !state.translation;
    $('refresh').disabled = working;
    $('bot').disabled = working;
    const selectedSource = currentSource();
    $('load-description').disabled = working || !selectedSource;
    $('model-main').disabled = working;
    $('model-sub').disabled = working;
    $('check-connection').disabled = working;
    $('description-ai-load').disabled = working || !selectedSource;
    $('description-full').disabled = blocked;
    $('description-part').disabled = blocked || !state.selection;
    $('description-language').disabled = working;
    $('misc-language').disabled = working;
    $('misc-full').disabled = blocked;
    $('misc-part').disabled = blocked || !state.selection;
    $('description-source-full').disabled = working || !selectedSource?.content.trim();
    $('description-source-language').disabled = working;
    $('lore-select').disabled = working || !selectedSource;
    $('lore-search-button').disabled = working || !state.libraryId;
    $('lore-settings').disabled = blocked || state.draft?.target !== 'lore';
    $('description-undo').disabled = blocked || !state.undo.length;
    $('description-redo').disabled = blocked || !state.redo.length;
    $('description-backups').disabled = blocked;
    for (const tab of ['description', 'lore', 'misc']) $('tab-' + tab).disabled = state.busy || !!state.switching;
    $('cancel').hidden = !state.busy || state.saving || state.loading;
    for (const id of ['title', 'keys', 'secondkeys', 'order', 'content', 'always', 'selective', 'regex']) $(id).disabled = !!(state.saving || state.loading || state.switching || state.importing);
    $('content').readOnly = state.tab !== 'misc' && !loaded;
    if (loaded) {
      $('draft-badge').textContent = state.tab === 'misc' ? '자유 입력' : C.dirty(state.draft) ? '저장 전 변경' : '원본과 동일';
      $('draft-badge').classList.toggle('changed', state.tab !== 'misc' && C.dirty(state.draft));
      $('char-count').textContent = (state.draft.entry.content || '').length.toLocaleString('ko-KR') + '자';
      const text = state.draft.entry.content || '';
      const tokens = estimatedTokens(text);
      $('description-tokens').textContent = '약 ' + tokens.toLocaleString('ko-KR') + ' 토큰';
    } else $('description-tokens').textContent = '약 0 토큰';
  }
  function renderEditor() {
    const draft = state.draft;
    $('empty').hidden = state.tab !== 'misc' || !!draft;
    $('editor-pane').hidden = !draft && state.tab === 'misc';
    if (!draft) {
      if (state.tab !== 'misc') {
        $('content').value = ''; $('content').placeholder = '';
        $('translation-text').value = ''; $('save').hidden = false;
        $('save-label').textContent = state.tab === 'description' ? '디스크립션에 반영' : '로어북에 반영';
        updateButtons();
      }
      return;
    }
    const entry = draft.entry;
    const description = draft.target === 'description';
    const misc = draft.target === 'misc';
    $('source-label').textContent = misc ? '기타 번역 / 자유 입력' : draft.botName + (description ? ' / 디스크립션' : ' / 로어북 #' + (draft.entryIndex + 1));
    $('lore-fields').hidden = description || misc;
    $('description-heading').hidden = !description;
    $('misc-heading').hidden = !misc;
    $('save').hidden = misc;
    $('backups').hidden = misc;
    $('content').placeholder = '';
    $('content').setAttribute('aria-label', misc ? '번역할 텍스트' : '편집 본문');
    $('save-label').textContent = description ? '디스크립션에 반영' : '로어북에 반영';
    $('save').title = description ? '현재 봇의 디스크립션에 반영' : '현재 로어북에 반영';
    $('title').value = entry.comment || '';
    $('keys').value = entry.key || '';
    $('secondkeys').value = entry.secondkey || '';
    $('content').value = entry.content || '';
    $('order').value = entry.insertorder ?? 100;
    $('always').checked = !!entry.alwaysActive;
    $('selective').checked = !!entry.selective;
    $('regex').checked = !!entry.useRegex;
    $('draft-time').textContent = draft.updatedAt ? new Date(draft.updatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';
    state.selection = null;
    renderSelection();
    updateButtons();
  }
  function renderSelection() {
    const n = state.selection ? state.selection.end - state.selection.start : 0;
    $('selection-label').textContent = n ? n.toLocaleString('ko-KR') + '자 선택됨' : '드래그해서 부분 수정·번역';
    $('selected-preview').textContent = n ? state.draft.entry.content.slice(state.selection.start, state.selection.end) : '본문에서 원하는 내용을 드래그하세요.';
    updateButtons();
  }
  function captureSelection() {
    if (!state.draft) return;
    const start = $('content').selectionStart;
    const end = $('content').selectionEnd;
    state.selection = end > start ? { start, end } : null;
    renderSelection();
  }
  function record() {
    if (!state.draft) return;
    state.undo.push(C.copy(state.draft.entry));
    if (state.undo.length > 80) state.undo.shift();
    state.redo = [];
  }
  function setEntry(entry) {
    record();
    state.draft.entry = C.copy(entry);
    renderEditor();
    schedulePersist();
  }
  function history(direction) {
    const source = direction === 'undo' ? state.undo : state.redo;
    const target = direction === 'undo' ? state.redo : state.undo;
    if (!state.draft || state.busy || !source.length) return;
    target.push(C.copy(state.draft.entry));
    state.draft.entry = source.pop();
    renderEditor();
    schedulePersist();
  }
  function renderList() {
    const bot = state.bots.find(b => b.id === state.libraryId);
    const source = currentSource();
    $('load-description').disabled = !source || state.busy || state.switching;
    const select = $('lore-select'); select.replaceChildren();
    (bot?.entries || []).forEach((entry, index) => {
      if (entry.mode === 'folder') return;
      const option = document.createElement('option'); option.value = String(index); option.textContent = entry.comment || entry.key || '이름 없는 항목'; select.append(option);
    });
    if (!select.options.length) { const option = document.createElement('option'); option.value = ''; option.textContent = '로어북 없음'; select.append(option); }
    else if (state.tab === 'lore' && source) select.value = String(source.index);
    const query = $('search').value.toLocaleLowerCase();
    const list = $('entries'); list.replaceChildren();
    const entries = (bot?.entries || []).map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.mode !== 'folder' && (!query || [entry.comment, entry.key, entry.content].some(t => (t || '').toLocaleLowerCase().includes(query))));
    $('entry-count').textContent = String(entries.length);
    if (!entries.length) {
      const p = document.createElement('p'); p.className = 'list-empty';
      p.textContent = query ? '검색 결과가 없습니다.' : '이 봇에 로어북 항목이 없습니다.'; list.append(p);
    }
    for (const { entry, index } of entries) {
      const key = C.draftKey(bot, entry, index);
      const card = document.createElement('article'); card.className = 'entry-card' + (source?.key === key ? ' chosen' : ''); card.setAttribute('role', 'listitem');
      const name = document.createElement('strong'); name.textContent = entry.comment || '이름 없는 항목';
      const keywords = document.createElement('span'); keywords.className = 'card-key'; keywords.textContent = entry.key || '키워드 없음';
      const preview = document.createElement('p'); preview.className = 'card-preview'; preview.textContent = entry.content || '본문 없음';
      const button = document.createElement('button'); button.className = 'entry-open'; button.textContent = '선택 →'; button.disabled = state.busy || state.switching;
      button.addEventListener('click', () => selectLore(index).then(() => $('lore-search-dialog').close()).catch(error => status(message(error), 'error')));
      card.append(name, keywords, preview, button); list.append(card);
    }
  }
  function setTabUI(tab) {
    state.tab = tab;
    const description = tab !== 'misc';
    document.querySelector('.studio').classList.toggle('description-tab', description);
    document.querySelector('.studio').classList.toggle('lore-tab', tab === 'lore');
    document.querySelector('.studio').classList.toggle('misc-tab', tab === 'misc');
    $('misc-toolbar').hidden = tab !== 'misc';
    $('lore-picker').hidden = tab !== 'lore';
    $('lore-settings').hidden = tab !== 'lore';
    $('description-source').hidden = !description;
    $('description-editor-heading').hidden = !description;
    $('description-toolbar').hidden = !description;
    $('translation-text').placeholder = '';
    if (description) { $('description-picker').append($('bot')); $('description-toolbar-actions').append($('save')); }
    else { botHome.after($('bot')); saveHome.after($('save')); }
    renderDescriptionSource();
    for (const name of ['description', 'lore', 'misc']) {
      const active = name === tab;
      $('tab-' + name).classList.toggle('active', active);
      $('tab-' + name).setAttribute('aria-selected', String(active));
      $('tab-' + name).tabIndex = active ? 0 : -1;
    }
    $('work-area').setAttribute('aria-labelledby', 'tab-' + tab);
    $('character-library').hidden = tab === 'misc';
    $('misc-guide').hidden = tab !== 'misc';
    $('lore-library').hidden = tab !== 'lore';
    $('load-description').hidden = !description;
    $('ai-edit-section').hidden = tab === 'misc';
    $('ai-result-section').hidden = tab === 'misc';
  }
  function renderDescriptionSource() {
    const source = currentSource();
    const lore = state.tab === 'lore';
    $('description-original').value = source?.content || '';
    $('description-original').placeholder = source ? '' : lore ? '로어북이 없습니다.' : '캐릭터를 선택하세요.';
    $('description-original').setAttribute('aria-label', lore ? '기존 로어북' : '기존 디스크립션');
    $('description-source-tokens').textContent = '약 ' + estimatedTokens(source?.content || '').toLocaleString('ko-KR') + ' 토큰';
    const translation = source && state.sourceTranslations.get(source.key);
    $('description-source-translation').value = translation && translation.source === source.content ? translation.text : '';
  }
  async function selectLore(index) {
    if (state.busy || state.switching) return;
    const bot = state.bots.find(b => b.id === state.libraryId);
    const entry = bot?.entries[index];
    if (!entry || entry.mode === 'folder') return;
    const previous = state.loreSelections.get(bot.id);
    state.loreSelections.set(bot.id, C.draftKey(bot, entry, index));
    try { await switchTab('lore', true); }
    catch (error) {
      if (previous === undefined) state.loreSelections.delete(bot.id); else state.loreSelections.set(bot.id, previous);
      renderList(); renderDescriptionSource(); throw error;
    }
  }
  function cacheCurrent() {
    if (!state.draft) return;
    state.cache.set(state.key, Object.fromEntries(['draft', 'key', 'selection', 'pending', 'translation', 'resultTab', 'undo', 'redo'].map(k => [k, state[k]])));
    state.cache.get(state.key).instruction = $('instruction').value;
  }
  function displayWorkspace() {
    const selection = state.selection;
    renderEditor(); state.selection = selection; renderSelection(); renderResult(); renderList();
    $('translation-text').value = state.translation?.text || '';
    $('translation-description').textContent = state.translation ? state.translation.label + ' · ' + (state.translation.model === 'model' ? '메인 모델' : '보조 모델') + ' · 요청 당시 원문 기준' : '오른쪽에서 본문 전체 번역을 누르면 이곳에 번역문이 표시됩니다.';
  }
  function restoreCache(key) {
    const cached = state.cache.get(key);
    if (!cached) return false;
    Object.assign(state, Object.fromEntries(Object.entries(cached).filter(([k]) => k !== 'instruction')));
    $('instruction').value = cached.instruction || '';
    displayWorkspace(); return true;
  }
  async function switchTab(tab, force = false) {
    if (state.busy || state.switching || (!force && state.tab === tab)) return;
    state.switching = true; updateButtons();
    try {
    await persist(); cacheCurrent(); setTabUI(tab);
    if (tab === 'misc') {
      const key = 'lore-studio:v1:misc';
      if (!restoreCache(key)) {
        const stored = await state.storage.getItem(key);
        state.draft = stored?.target === 'misc' && typeof stored.entry?.content === 'string' ? stored : { version: 1, target: 'misc', entry: { content: '' }, original: { content: '' }, updatedAt: Date.now() };
        state.key = key; state.selection = null; state.undo = []; state.redo = []; state.pending = null; state.translation = null;
        $('instruction').value = ''; displayWorkspace();
      }
      status('번역할 글을 입력하세요. 전체 번역은 오른쪽에, 부분 번역은 선택한 자리에 표시됩니다.');
    } else {
      const key = currentSource()?.key;
      if (key && restoreCache(key)) { status('탭의 작업 내용을 복원했습니다.'); return; }
      state.draft = null; state.key = ''; state.selection = null; state.pending = null; state.translation = null; state.undo = []; state.redo = []; $('draft-badge').textContent = '항목 선택'; renderEditor(); renderResult(); renderList(); updateButtons();
      status(tab === 'description' ? '불러올 디스크립션을 선택하세요.' : '왼쪽에서 로어북 항목을 가져오세요.');
    }
    } finally { state.switching = false; updateButtons(); }
  }
  async function refresh() {
    if (state.busy) return;
    status('봇별 로어북을 불러오는 중입니다.');
    const db = await api.getDatabase(['characters']);
    state.bots = C.characters(db);
    const select = $('bot'); select.replaceChildren();
    for (const bot of state.bots) { const option = document.createElement('option'); option.value = bot.id; option.textContent = bot.name; select.append(option); }
    if (!state.bots.some(b => b.id === state.libraryId)) {
      let selected;
      try { selected = await api.getCharacter(); } catch (_) { /* A selected bot is optional. */ }
      state.libraryId = state.bots.find(b => b.id === selected?.chaId)?.id || state.bots[0]?.id || '';
    }
    select.value = state.libraryId;
    renderList(); renderDescriptionSource();
    status(state.bots.length ? '로어북을 선택해 작업판으로 가져오세요.' : '등록된 캐릭터가 없습니다. RisuAI에 봇을 추가해 주세요.');
  }
  async function importDescription(useAI) {
    if (state.busy || state.switching || state.tab === 'misc') return;
    const source = currentSource();
    if (!source) return;
    const { bot, index, key } = source;
    const name = index === -1 ? '디스크립션' : '로어북';
    const instruction = $('description-ai-instruction').value.trim();
    if (useAI && !instruction) throw new Error('수정 내용을 입력하세요.');
    const draft = index === -1 ? C.makeDescriptionDraft(bot) : C.makeDraft(bot, index);
    const editRequest = useAI ? C.createRequest(draft.entry, 'edit', instruction, null, state.model, state.editPrompt) : null;
    const mode = state.model;
    const token = ++state.token;
    const previous = state.key === key && state.draft ? C.copy(state.draft.entry) : null;
    state.busy = true; state.loading = !useAI; state.importing = true; updateButtons(); renderList();
    if (useAI) { $('description-ai-dialog').close(); markConnection(mode, 'checking'); }
    const timeout = useAI ? setTimeout(() => {
      if (token !== state.token) return;
      ++state.token; state.busy = false; state.loading = false; state.importing = false; markConnection(mode, 'error', null, '모델 응답 시간 초과'); updateButtons(); renderList(); status('모델 응답 시간이 초과되었습니다.', 'error');
    }, 180000) : null;
    let modelResponded = false; let modelRequested = false;
    try {
      await persist();
      await C.backupOriginal(state.storage, draft, key);
      if (token !== state.token) return;
      if (useAI) {
        status('수정해서 불러오는 중…', 'busy');
        const { snapshot, range, source, ...options } = editRequest;
        modelRequested = true;
        const response = await api.runLLMModel(options);
        if (token !== state.token) return;
        const text = await C.responseText(response);
        if (token !== state.token) return;
        modelResponded = true; markConnection(mode, 'connected', response);
        draft.entry.content = text;
      }
      if (token !== state.token) return;
      cacheCurrent();
      state.draft = draft; state.key = key; state.selection = null; state.pending = null; state.translation = null;
      state.undo = previous ? [previous] : []; state.redo = [];
      $('translation-text').value = ''; $('instruction').value = '';
      displayWorkspace(); await persist();
      status((useAI ? '수정한 ' : '') + name + '을 불러왔습니다.');
    } catch (error) {
      if (token === state.token) { if (modelRequested && !modelResponded) markConnection(mode, 'error', null, message(error)); status(message(error), 'error'); }
    } finally {
      clearTimeout(timeout);
      if (token === state.token) { state.busy = false; state.loading = false; state.importing = false; updateButtons(); renderList(); }
    }
  }
  async function chooseModel(mode) {
    if (state.busy) return;
    state.model = mode;
    const main = mode === 'model';
    for (const [id, active] of [['model-main', main], ['model-sub', !main]]) { $(id).classList.toggle('active', active); $(id).setAttribute('aria-pressed', String(active)); }
    $('model-note').textContent = (main ? '메인' : '보조') + ' 모델로 모든 AI 작업 처리';
    renderConnection();
    await enqueue('lore-studio:v1:model', mode);
    status((main ? '메인' : '보조') + ' 모델을 선택했습니다. 다음 수정·번역 요청부터 사용합니다.');
  }
  function renderConnection() {
    const connection = state.connections[state.model];
    const labels = { unknown: '연결 미확인', checking: '응답 확인 중', connected: '연결 정상', error: '연결 오류' };
    $('connection-dot').className = 'model-dot ' + connection.state;
    $('connection-dot').setAttribute('aria-label', labels[connection.state]);
    $('connection-dot').title = connection.detail || (connection.state === 'connected' ? '최근 모델 요청에 정상 응답했습니다. 새 요청 또는 연결 확인으로 갱신합니다.' : labels[connection.state]);
    $('model-name').textContent = state.labels[state.model] || state.modelInfo[state.model] || '모델명 확인 전';
    $('model-name').title = (state.labels[state.model] ? '직접 지정한 표시 이름' : state.modelInfo[state.model] ? '최근 응답에서 확인한 모델명' : 'RisuAI 응답에 모델명이 없으면 표시 이름을 지정하세요.') + ' · 클릭해서 설정';
  }
  function markConnection(mode, type, response, detail) {
    state.connections[mode] = { state: type, detail: detail || '' };
    if (typeof response?.model === 'string' && response.model.trim() && response.model !== 'custom') {
      state.modelInfo[mode] = response.model.replace(/^pluginmodel:::/, '');
      enqueue('lore-studio:v1:model-info', state.modelInfo).catch(() => {});
    }
    renderConnection();
  }
  async function checkConnection() {
    if (state.busy) return;
    const mode = state.model; const token = ++state.token;
    state.busy = true; updateButtons(); renderList(); markConnection(mode, 'checking');
    status('선택한 모델에 짧은 확인 요청을 보내는 중입니다.', 'busy');
    const timeout = setTimeout(() => {
      if (token !== state.token) return;
      ++state.token; state.busy = false; markConnection(mode, 'error', null, '연결 확인 시간 초과'); updateButtons(); renderList(); status('연결 확인 시간(30초)을 초과했습니다.', 'error');
    }, 30000);
    try {
      const response = await api.runLLMModel({ mode, allowPlugins: true, messages: [{ role: 'user', content: 'Reply only with OK.' }] });
      if (token !== state.token) return;
      await C.responseText(response);
      if (token !== state.token) return;
      markConnection(mode, 'connected', response);
      status('선택한 모델의 응답을 확인했습니다.' + (state.modelInfo[mode] ? '' : ' 이 연결은 모델명을 제공하지 않습니다. 이름을 클릭해 표시 이름을 지정할 수 있습니다.'));
    } catch (error) { if (token === state.token) { markConnection(mode, 'error', null, message(error)); status(message(error), 'error'); } }
    finally { clearTimeout(timeout); if (token === state.token) { state.busy = false; updateButtons(); renderList(); } }
  }
  function renderResult() {
    const pending = state.pending;
    $('pending').hidden = !pending; $('result-empty').hidden = !!pending;
    $('result-model').textContent = pending ? (pending.model === 'model' ? '메인' : '보조') : '';
    if (!pending) return;
    $('result-description').textContent = pending.label;
    const original = state.resultTab === 'original';
    $('result-text').value = original ? pending.source : pending.text;
    $('result-text').readOnly = original || pending.viewOnly;
    $('apply').hidden = !!pending.viewOnly;
    $('result-help').textContent = pending.viewOnly ? '전체 번역은 보기 전용입니다. 작업판 원문은 바뀌지 않습니다.' : '결과를 직접 고친 뒤 적용할 수도 있습니다.';
    $('show-original').classList.toggle('active', original);
    $('show-result').classList.toggle('active', !original);
  }
  async function request(task, part, sourceOnly = false) {
    if (state.busy || state.switching || (!sourceOnly && !state.draft)) return;
    const sourceInfo = sourceOnly ? currentSource() : null;
    if (sourceOnly && !sourceInfo) return;
    if (part && !state.selection) throw new Error('본문에서 원하는 내용을 먼저 드래그해 주세요.');
    const req = C.createRequest(sourceOnly ? { content: sourceInfo.content } : state.draft.entry, task, $('instruction').value, part ? state.selection : null, state.model, state.editPrompt);
    const token = ++state.token;
    const key = state.key;
    const model = state.model;
    const label = (part ? '선택한 부분' : '본문 전체') + ' · ' + (task === 'edit' ? 'AI 수정' : task === 'ko' ? '한국어 번역' : '영어 번역');
    const { snapshot, range, source, ...options } = req;
    let modelResponded = false;
    state.busy = true; updateButtons(); renderList();
    markConnection(model, 'checking');
    status(label + ' 중… ' + (model === 'model' ? '메인' : '보조') + ' 모델의 응답을 기다립니다.', 'busy');
    const timeout = setTimeout(() => {
      if (token !== state.token) return;
      ++state.token; state.busy = false; updateButtons(); renderList();
      markConnection(model, 'error', null, '모델 응답 시간 초과');
      status('모델 응답 대기 시간(3분)을 초과했습니다. 나중에 도착한 결과는 적용하지 않습니다. 모델 상태를 확인해 주세요.', 'error');
    }, 180000);
    try {
      const response = await api.runLLMModel(options);
      if (token !== state.token) return;
      const text = await C.responseText(response);
      if (token !== state.token || (sourceOnly ? sourceInfo.key !== currentSource()?.key : key !== state.key)) return;
      modelResponded = true; markConnection(model, 'connected', response);
      if (sourceOnly) {
        state.sourceTranslations.set(sourceInfo.key, { source, text, model, label });
        renderDescriptionSource();
        status('원본 전체 번역을 표시했습니다.');
      } else if (task !== 'edit' && !part) {
        state.translation = { source, text, model, label };
        $('translation-text').value = text;
        $('translation-description').textContent = label + ' · ' + (model === 'model' ? '메인 모델' : '보조 모델') + ' · 요청 당시 원문 기준';
        status(state.tab === 'misc' ? '전체 번역을 오른쪽에 표시했습니다.' : '작업판 아래에 전체 번역을 표시했습니다. 원문은 그대로 유지됩니다.');
      } else if (task !== 'edit' && part) {
        const content = C.applyResult(state.draft.entry.content || '', { snapshot, range, text });
        setEntry({ ...state.draft.entry, content });
        await persist();
        status(state.tab === 'misc' ? '드래그한 부분을 번역문으로 바꿨습니다. 되돌리기로 취소할 수 있습니다.' : '드래그한 부분을 번역문으로 바꿨습니다. 되돌리기로 취소하거나 반영 버튼으로 저장하세요.');
      } else {
        state.pending = { snapshot, range, source, text, model, label, viewOnly: false };
        state.resultTab = 'result'; renderResult();
        status('수정 결과가 도착했습니다. 원문과 비교한 뒤 작업판에 적용하세요.');
      }
    } catch (error) {
      if (token === state.token) { if (!modelResponded) markConnection(model, 'error', null, message(error)); status(message(error), 'error'); }
    } finally {
      clearTimeout(timeout);
      if (token === state.token) { state.busy = false; updateButtons(); renderList(); }
    }
  }
  async function save() {
    if (!state.draft || state.tab === 'misc' || state.busy || !C.dirty(state.draft)) return;
    await persist();
    state.busy = true; state.saving = true; updateButtons(); renderList();
    status('원본 변경 확인 및 저장 전 백업 중…', 'busy');
    try {
      await C.saveDraft(api, state.storage, state.draft);
      await persist();
      state.undo = []; state.redo = [];
      const bot = state.bots.find(b => b.id === state.draft.botId);
      if (bot) { if (state.draft.target === 'description') bot.description = state.draft.entry.content; else bot.entries[state.draft.entryIndex] = C.copy(state.draft.entry); }
      renderDescriptionSource();
      renderEditor();
      status((state.draft.target === 'description' ? '디스크립션' : '로어북') + '에 반영했습니다. 처음 원본과 반영 전 내용은 원본·백업 보기에서 확인할 수 있습니다.');
    } finally { state.busy = false; state.saving = false; updateButtons(); renderList(); }
  }
  async function showBackups() {
    if (!state.draft) return;
    const originals = await state.storage.getItem('lore-studio:v1:originals:' + encodeURIComponent(state.draft.botId)) || [];
    const saved = await state.storage.getItem('lore-studio:v1:backups:' + encodeURIComponent(state.draft.botId)) || [];
    const backups = [...originals, ...saved].filter(b => (b.target || 'lore') === (state.draft.target || 'lore'));
    const list = $('backup-list'); list.replaceChildren();
    if (!backups.length) { const p = document.createElement('p'); p.textContent = '아직 저장 전 백업이 없습니다.'; list.append(p); }
    backups.forEach(backup => {
      const row = document.createElement('div'); row.className = 'backup-item';
      const info = document.createElement('div'); info.textContent = backup.target === 'description' ? '봇 디스크립션' : backup.entry.comment || '이름 없는 항목';
      const time = document.createElement('span'); time.textContent = (backup.kind === 'original' ? '처음 가져온 원본 · ' : '반영 직전 백업 · ') + new Date(backup.at).toLocaleString('ko-KR'); info.append(time);
      const button = document.createElement('button'); button.textContent = '작업판 복원'; button.disabled = state.busy;
      // Only restore a backup matching this exact entry identity.
      const matches = state.draft.entryId ? backup.entry.id === state.draft.entryId : backup.sourceKey === state.key || C.equal(backup.entry, state.draft.original);
      button.disabled = state.busy || !matches;
      button.addEventListener('click', () => {
        const entry = C.copy(state.draft.entry);
        C.fields.forEach(field => { if (backup.entry[field] === undefined) delete entry[field]; else entry[field] = backup.entry[field]; });
        setEntry(entry); $('backup-dialog').close(); status('백업 내용을 작업판에 복원했습니다. 반영 버튼을 누르면 저장됩니다.');
      }); row.append(info, button); list.append(row);
    }); $('backup-dialog').showModal();
  }

  listen('bot', 'change', async () => { state.libraryId = $('bot').value; renderList(); await switchTab(state.tab, true); });
  listen('lore-select', 'change', () => selectLore(Number($('lore-select').value)));
  listen('lore-search-button', 'click', () => { $('search').value = ''; renderList(); $('lore-search-dialog').showModal(); $('search').focus(); });
  listen('lore-search-close', 'click', () => $('lore-search-dialog').close());
  listen('lore-settings', 'click', () => { if (state.draft?.target === 'lore') $('lore-settings-dialog').showModal(); });
  listen('lore-settings-close', 'click', () => $('lore-settings-dialog').close());
  for (const tab of ['description', 'lore', 'misc']) listen('tab-' + tab, 'click', () => switchTab(tab));
  document.querySelector('.workspace-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || state.busy) return;
    event.preventDefault(); const tabs = ['description', 'lore', 'misc']; const i = tabs.indexOf(state.tab);
    const tab = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[2] : tabs[(i + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
    switchTab(tab).then(() => $('tab-' + tab).focus()).catch(error => status(message(error), 'error'));
  });
  listen('load-description', 'click', () => importDescription(false));
  listen('description-ai-load', 'click', () => { if (!state.busy) { $('description-ai-instruction').setAttribute('aria-label', state.tab === 'lore' ? '로어북 수정 요청' : '디스크립션 수정 요청'); $('description-ai-dialog').showModal(); } });
  listen('description-ai-close', 'click', () => $('description-ai-dialog').close());
  listen('description-ai-submit', 'click', () => importDescription(true));
  listen('description-full', 'click', () => request($('description-language').value, false));
  listen('description-source-full', 'click', () => request($('description-source-language').value, false, true));
  listen('description-part', 'click', () => request($('description-language').value, true));
  listen('misc-part', 'click', () => request($('misc-language').value, true));
  listen('misc-full', 'click', () => request($('misc-language').value, false));
  listen('description-undo', 'click', () => history('undo'));
  listen('description-redo', 'click', () => history('redo'));
  listen('description-backups', 'click', showBackups);
  listen('search', 'input', renderList); listen('refresh', 'click', refresh);
  listen('model-main', 'click', () => chooseModel('model')); listen('model-sub', 'click', () => chooseModel('submodel'));
  listen('check-connection', 'click', checkConnection);
  listen('appearance-settings', 'click', () => $('appearance-dialog').showModal());
  listen('appearance-close', 'click', () => $('appearance-dialog').close());
  listen('edit-system-prompt', 'input', async () => {
    state.editPrompt = $('edit-system-prompt').value;
    await enqueue('lore-studio:v1:edit-system-prompt', state.editPrompt);
  });
  for (const theme of ['dark', 'light']) listen('theme-' + theme, 'click', async () => {
    applyTheme(theme); await enqueue('lore-studio:v1:theme', state.theme);
  });
  listen('model-name', 'click', () => {
    $('main-model-label').value = state.labels.model || ''; $('sub-model-label').value = state.labels.submodel || '';
    $('main-model-detected').textContent = '응답에서 확인한 이름: ' + (state.modelInfo.model || '아직 없음');
    $('sub-model-detected').textContent = '응답에서 확인한 이름: ' + (state.modelInfo.submodel || '아직 없음');
    $('model-dialog').showModal();
  });
  listen('model-dialog-close', 'click', () => $('model-dialog').close());
  listen('model-label-save', 'click', async () => {
    state.labels = { model: $('main-model-label').value.trim(), submodel: $('sub-model-label').value.trim() };
    await enqueue('lore-studio:v1:model-labels', state.labels); renderConnection(); $('model-dialog').close(); status('모델 표시 이름을 저장했습니다.');
  });
  for (const [id, field] of [['title', 'comment'], ['keys', 'key'], ['secondkeys', 'secondkey'], ['content', 'content']]) {
    listen(id, 'input', () => {
      if (!state.draft) return;
      record(); state.draft.entry[field] = $(id).value;
      if (field === 'content') { state.selection = null; renderSelection(); }
      updateButtons(); schedulePersist();
    });
  }
  listen('order', 'change', () => {
    if (!$('order').value.trim() || !Number.isSafeInteger(Number($('order').value))) { $('order').value = state.draft.entry.insertorder ?? 100; throw new Error('삽입 순서는 정수로 입력해 주세요.'); }
    record(); state.draft.entry.insertorder = Number($('order').value); updateButtons(); schedulePersist();
  });
  for (const [id, field] of [['always', 'alwaysActive'], ['selective', 'selective'], ['regex', 'useRegex']]) listen(id, 'change', () => { record(); state.draft.entry[field] = $(id).checked; updateButtons(); schedulePersist(); });
  // Capture before toolbar focus changes. Moving focus never clears a valid selection.
  for (const event of ['select', 'keyup', 'pointerup']) listen('content', event, captureSelection);
  listen('undo', 'click', () => history('undo')); listen('redo', 'click', () => history('redo'));
  document.addEventListener('keydown', event => {
    const textControl = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save().catch(error => status(message(error), 'error')); }
    // Preserve native undo within text controls; buttons offer full entry history.
    if (!textControl && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); history(event.shiftKey ? 'redo' : 'undo'); }
  });
  listen('ai-edit', 'click', () => request('edit', $('edit-scope').value === 'selection'));
  for (const [id, task, part] of [['full-ko', 'ko', false], ['full-en', 'en', false], ['part-ko', 'ko', true], ['part-en', 'en', true]]) listen(id, 'click', () => request(task, part));
  listen('show-original', 'click', () => { state.resultTab = 'original'; renderResult(); });
  listen('show-result', 'click', () => { state.resultTab = 'result'; renderResult(); });
  listen('result-text', 'input', () => { if (state.pending && state.resultTab === 'result') state.pending.text = $('result-text').value; });
  listen('discard', 'click', () => { state.pending = null; renderResult(); status('AI 결과를 버렸습니다.'); });
  listen('apply', 'click', () => {
    if (!state.pending || !state.draft || state.busy || state.pending.viewOnly) return;
    if (!state.pending.text.trim()) throw new Error('적용할 결과가 비어 있습니다.');
    const text = C.applyResult(state.draft.entry.content || '', state.pending);
    setEntry({ ...state.draft.entry, content: text }); state.pending = null; renderResult();
    status('작업판에 적용했습니다. 반영 버튼을 누르면 원본에 저장됩니다.');
  });
  listen('cancel', 'click', () => {
    if (state.saving || state.loading) return;
    ++state.token; state.busy = false; state.importing = false; updateButtons(); renderList();
    if (state.connections[state.model].state === 'checking') markConnection(state.model, 'unknown', null, '결과 받기 취소로 상태를 확인하지 못했습니다.');
    status('결과 받기를 취소했습니다. 이미 전송된 모델 요청과 사용량은 취소되지 않을 수 있습니다.');
  });
  listen('copy-result', 'click', async () => {
    if (!state.pending) return;
    try { await navigator.clipboard.writeText(state.pending.text); status('결과를 복사했습니다.'); }
    catch (_) { state.resultTab = 'result'; renderResult(); $('result-text').focus(); $('result-text').select(); status('브라우저가 자동 복사를 허용하지 않습니다. 선택된 결과를 Ctrl+C로 복사해 주세요.'); }
  });
  listen('expand-result', 'click', () => {
    if (!state.pending) return;
    $('reader-title').textContent = state.pending.label;
    $('reader-original').value = state.pending.source;
    $('reader-result').value = state.pending.text;
    $('reader-dialog').showModal();
  });
  listen('reader-close', 'click', () => $('reader-dialog').close());
  listen('translation-copy', 'click', async () => {
    if (!state.translation) return;
    try { await navigator.clipboard.writeText(state.translation.text); status('전체 번역문을 복사했습니다.'); }
    catch (_) { $('translation-text').focus(); $('translation-text').select(); status('선택된 번역문을 Ctrl+C로 복사해 주세요.'); }
  });
  listen('translation-expand', 'click', () => {
    if (!state.translation) return;
    $('reader-title').textContent = state.translation.label;
    $('reader-original').value = state.translation.source;
    $('reader-result').value = state.translation.text;
    $('reader-dialog').showModal();
  });
  listen('save', 'click', save);
  listen('export', 'click', () => {
    if (!state.draft) return;
    const blob = new Blob([JSON.stringify({ ...state.draft, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = ('로어북-' + (state.draft.entry.comment || '초안')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) + '.json';
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    status('초안 JSON 다운로드를 요청했습니다. 브라우저 다운로드 목록을 확인해 주세요.');
  });
  listen('backups', 'click', showBackups); listen('backup-close', 'click', () => $('backup-dialog').close());
  listen('close', 'click', async () => { await persist(); await api.hideContainer(); });

  async function open() {
    await api.showContainer('fullscreen');
    // Keep the in-memory workspace when reopening. Refresh only the library.
    if (!state.busy) await refresh();
  }
  try {
    state.storage = await api.getLocalPluginStorage();
    const savedPrompt = await state.storage.getItem('lore-studio:v1:edit-system-prompt');
    state.editPrompt = typeof savedPrompt === 'string' ? savedPrompt : C.DEFAULT_EDIT_PROMPT;
    $('edit-system-prompt').value = state.editPrompt;
    applyTheme(await state.storage.getItem('lore-studio:v1:theme'));
    state.labels = await state.storage.getItem('lore-studio:v1:model-labels') || {};
    state.modelInfo = await state.storage.getItem('lore-studio:v1:model-info') || {};
    const mode = await state.storage.getItem('lore-studio:v1:model');
    await chooseModel(mode === 'submodel' ? 'submodel' : 'model');
    await api.registerSetting(pluginName, open, '▤', 'html', 'lore-studio-setting');
    await api.registerButton({ name: pluginName, icon: '▤', iconType: 'html', location: 'hamburger', id: 'lore-studio-menu' }, open);
    await refresh();
    setTabUI('lore'); renderEditor(); updateButtons();
    const initialTab = new URLSearchParams(location.search).get('tab');
    if (initialTab === 'description' || initialTab === 'misc') await switchTab(initialTab);
    document.querySelector('.studio').dataset.ready = 'true';
    status('');
  } catch (error) { status('초기화 실패: ' + message(error), 'error'); console.error('[Lorebook Studio]', error); }
})();
