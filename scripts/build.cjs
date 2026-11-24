const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const pkg = JSON.parse(read('package.json'));
const version = pkg.version;
const displayName = '로어북 스튜디오 & 번역기 v' + version.replace(/\.0$/, '');
const updateURL = pkg.risuUpdateUrl;
if (new URL(updateURL).protocol !== 'https:') throw new Error('Update URL must use HTTPS.');
const header = ['//@name risu_lorebook_studio', '//@api 3.0', '//@version ' + version, '//@display-name ' + displayName, '//@update-url ' + updateURL, ''].join('\n');
const asset = 'globalThis.LoreAssets = ' + JSON.stringify({ html: read('src/view.html'), css: read('src/style.css'), displayName }) + ';\n';
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const plugin = header + read('src/core.js') + '\n' + asset + read('src/app.js');
fs.writeFileSync(path.join(root, 'dist/lorebook-studio.js'), plugin);
fs.writeFileSync(path.join(root, 'dist/lorebook-studio-v' + version + '.js'), plugin);
// JSON is a portable plugin record, not a file accepted by RisuAI's JS/TS importer.
const record = {
  name: 'risu_lorebook_studio',
  displayName,
  script: plugin,
  arguments: {}, realArg: {}, version: '3.0', customLink: [], argMeta: {},
  versionOfPlugin: version, updateURL
};
fs.writeFileSync(path.join(root, 'dist/lorebook-studio.json'), JSON.stringify(record, null, 2) + '\n');
const inline = source => source.replace(/<\/script/gi, '<\\/script');
fs.writeFileSync(path.join(root, 'preview/standalone.html'), '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>오프라인 미리보기 · 로어북 스튜디오 &amp; 번역기</title></head><body><script>' + inline(read('preview/mock.js')) + '</script><script>' + inline(plugin) + '</script></body></html>');
console.log('Built dist/lorebook-studio.js');
console.log('Built dist/lorebook-studio-v' + version + '.js');
console.log('Built dist/lorebook-studio.json (reference record; install the .js file)');
