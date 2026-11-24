/* Offline demo only. This adapter is never included in the installable plugin. */
(() => {
  const clone = value => JSON.parse(JSON.stringify(value));
  const lore = (id, comment, key, content) => ({ id, comment, key, secondkey: '', content, insertorder: 100, mode: 'normal', alwaysActive: false, selective: false });
  const db = { characters: [
    { chaId: 'aria', type: 'character', name: '아리아 · 별을 기록하는 사서', desc: '{{char}}는 오래된 도서관을 지키는 사서다.\n밤마다 사라진 별의 이름을 기록한다.\n\n차분한 목소리와 다정한 시선으로 {{user}}를 맞이한다.', globalLore: [
      lore('forest', '은빛 숲', '은빛 숲, Silverwood', '은빛 숲은 왕국 북쪽의 오래된 숲이다.\n달빛이 나뭇잎에 닿으면 작은 별처럼 빛난다.\n\n{{char}}는 이곳에서 오래된 기억의 조각을 수집한다.\n숲의 중심에는 계절이 바뀌어도 마르지 않는 샘이 있다.'),
      lore('library', '별의 도서관', '도서관, 사서', '도서관의 창문 너머로 별이 흐른다. {{char}}는 매일 밤 한 권의 책을 정리한다.'),
      lore('promise', '오래된 약속', '약속, 맹세', '다시 만나는 날, 잊었던 이름을 불러 주기로 했다.'),
    ], chats: [{ message: [] }] },
    { chaId: 'leon', type: 'character', name: '레온 · 바람의 기사', desc: '{{char}} is a wandering knight who follows the wind.', globalLore: [lore('sword', '바람의 검', '검, sword', '바람의 검은 주인의 마음에 따라 방향을 바꾼다.')], chats: [] }
  ] };
  let delay = 120; let failNext = false; let omitModel = false;
  const store = new Map();
  const calls = []; let writeCount = 0;
  const storage = { getItem: async key => clone(store.get(key) ?? null), setItem: async (key, value) => { store.set(key, clone(value)); } };
  globalThis.__demo = { db, store, calls, get writes() { return writeCount; }, set delay(value) { delay = value; }, set failNext(value) { failNext = value; }, set omitModel(value) { omitModel = value; } };
  globalThis.risuai = {
    getDatabase: async () => clone(db), getCharacter: async () => clone(db.characters[0]),
    getCharacterFromIndex: async index => clone(db.characters[index]),
    setCharacterToIndex: async (index, char) => { db.characters[index] = clone(char); writeCount++; },
    getLocalPluginStorage: async () => storage,
    registerSetting: async () => ({ id: 'setting' }), registerButton: async () => ({ id: 'button' }),
    showContainer: async () => {}, hideContainer: async () => {},
    runLLMModel: async options => {
      calls.push(clone(options));
      await new Promise(resolve => setTimeout(resolve, delay));
      if (failNext) { failNext = false; return { type: 'fail', result: '데모 연결 오류: 요청 실패' }; }
      const model = omitModel ? undefined : (options.mode === 'model' ? '데모 메인 모델' : '데모 보조 모델');
      if (options.messages[0].content === 'Reply only with OK.') return { type: 'success', result: 'OK', model };
      const input = JSON.parse(options.messages[1].content);
      const system = options.messages[0].content;
      let text;
      if (system.includes('into English')) text = '[미리보기용 영어 번역]\nSilverwood is an ancient forest in the north. When moonlight touches its leaves, they shine like tiny stars. {{char}} collects fragments of memories here.';
      else if (system.includes('into Korean')) text = '[미리보기용 한국어 번역]\n은빛으로 빛나는 오래된 숲. {{char}}는 잃어버린 기억을 찾는다.';
      else text = input.source + '\n\n[미리보기용 AI 수정 결과] 요청: ' + input.task;
      return { type: 'success', result: text, model };
    }
  };
})();
