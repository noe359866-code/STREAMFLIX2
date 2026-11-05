'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const port = Number(process.env.PORT || 3000);
const types = { '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8' };

http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://local.invalid').pathname);
  const relative = pathname === '/' ? 'manifest.json' : pathname.replace(/^\/+/, '');
  const filename = path.resolve(root, relative);
  const allowed = relative === 'manifest.json' || relative === 'README.md' || (relative.startsWith('providers/') && relative.endsWith('.js'));
  if (!allowed || !filename.startsWith(`${root}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    response.end(JSON.stringify({ error: 'No encontrado', manifest: '/manifest.json' }));
    return;
  }
  response.writeHead(200, {
    'Content-Type': types[path.extname(filename)] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') response.end();
  else fs.createReadStream(filename).pipe(response);
}).listen(port, '0.0.0.0', () => {
  console.log(`STREAMFLIX2 disponible en 0.0.0.0:${port}; manifiesto: /manifest.json`);
});
