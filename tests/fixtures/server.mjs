// SPDX-License-Identifier: MPL-2.0
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const stats = {
  requests: 0,
  active: 0,
  maxConcurrent: 0,
  byProvider: {},
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') {
    res.end();
    return;
  }
  const requestUrl = new URL(req.url, 'http://127.0.0.1');
  if (requestUrl.pathname === '/stats') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(stats));
    return;
  }
  if (requestUrl.pathname === '/reset-stats') {
    stats.requests = 0;
    stats.active = 0;
    stats.maxConcurrent = 0;
    stats.byProvider = {};
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.url.startsWith('/fail')) {
    res.writeHead(503);
    res.end('offline');
    return;
  }
  if (req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const provider = String(
      req.headers['x-ogleans-provider'] ?? req.headers['x-provider'] ?? '',
    );
    stats.requests++;
    stats.active++;
    stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.active);
    stats.byProvider[provider || 'default'] =
      (stats.byProvider[provider || 'default'] ?? 0) + 1;
    try {
      if (provider === 'a') await delay(75);
      if (provider === 'b') await delay(10);
      const json = JSON.parse(body);
      const prompt = json.messages[0].content;
      const segments = JSON.parse(prompt.slice(prompt.indexOf('Input: ') + 7));
      const label = provider ? `[${provider}] ` : '';
      const results = segments.map((s) => ({
        id: s.id,
        text: `${label}${
          prompt.includes('to en.')
            ? `English translation: ${s.text}`
            : `中文译文：${s.text}`
        }`,
      }));
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          message: { content: JSON.stringify(results) },
          choices: [{ message: { content: JSON.stringify(results) } }],
        }),
      );
    } finally {
      stats.active--;
    }
    return;
  }
  const route = req.url.split('?')[0];
  if (route === '/frameworks.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(await readFile('dist/fixtures/frameworks.js'));
    return;
  }
  if (['/react', '/vue'].includes(route)) {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<!doctype html><html lang="en"><head><title>Framework fixture</title></head><body><main id="app"></main><script src="/frameworks.js"></script></body></html>',
    );
    return;
  }
  const count = route === '/large' ? 250 : 3;
  const article = Array.from(
    { length: count },
    (_, i) =>
      `<p>Paragraph ${i}: Translation infrastructure keeps <a href="#">links <span>intact</span></a> and provides dependable tools.</p>`,
  ).join('');
  res.setHeader('Content-Type', 'text/html');
  res.end(
    `<!doctype html><html lang="en"><head><title>${route} fixture</title></head><body><nav>Navigation excluded</nav><main id="mw-content-text"><article class="markdown-body"><h1>Ogleans test article</h1>${article}<table><tr><td>Semantic table cell</td></tr></table><pre>const code = true;</pre><p hidden>Hidden text</p><p contenteditable>Editable text</p></article></main><button id="add">Add paragraph</button><button id="edit">Edit paragraph</button><script>window.clicks=0;document.querySelector('a').addEventListener('click',()=>window.clicks++);document.getElementById('add').onclick=()=>document.querySelector('article').insertAdjacentHTML('beforeend','<p>Dynamically inserted content.</p>');document.getElementById('edit').onclick=()=>document.querySelector('p').firstChild.textContent='SPA updated paragraph. ';</script></body></html>`,
  );
});
server.listen(4173, '127.0.0.1');
