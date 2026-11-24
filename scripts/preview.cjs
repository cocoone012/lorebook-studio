const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const routes = { '/': ['preview/index.html', 'text/html'], '/mock.js': ['preview/mock.js', 'text/javascript'], '/plugin.js': ['dist/lorebook-studio.js', 'text/javascript'] };
function createPreviewServer() { return http.createServer((req, res) => {
  const route = routes[req.url.split('?')[0]];
  if (!route) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': route[1] + '; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(path.join(root, route[0])));
}); }
module.exports = { createPreviewServer };
if (require.main === module) {
  const port = Number(process.env.PORT || 4173);
  createPreviewServer().listen(port, '127.0.0.1', () => console.log('Offline mock preview: http://127.0.0.1:' + port + ' (not connected to RisuAI)'));
}
