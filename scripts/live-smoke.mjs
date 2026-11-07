// SPDX-License-Identifier: MPL-2.0
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createProvider } from '../dist/examples/index.js';
const sdk = await readFile('dist/sdk/index.js', 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(sdk).toString('base64')}`;
const browser = await chromium.launch({
  channel: 'chromium',
  executablePath: process.env.TK_CHROMIUM_PATH,
});
const context = await browser.newContext({ bypassCSP: true });
const provider = createProvider({
  id: 'google',
  kind: 'google',
  baseUrl: 'https://translate.googleapis.com',
  timeoutMs: 30000,
});
const report = {
  date: new Date().toISOString(),
  browser: browser.version(),
  method:
    'Live pages in isolated Chromium, built HTML adapter, actual keyless Google sample translations. Test harness bypasses page CSP solely to load SDK. No user browser profile or credentials.',
  pages: [],
};
for (const url of [
  'https://en.wikipedia.org/wiki/Translation',
  'https://github.com/microsoft/TypeScript',
  'https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver',
  'https://react.dev/learn',
]) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const row = { url };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const discovered = await page.evaluate(async (moduleUrl) => {
      const { HtmlAdapter, segmentsOf } = await import(moduleUrl);
      const adapter = new HtmlAdapter(document);
      window.liveAdapter = adapter;
      const nodes = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ALL,
      );
      let domNodes = 0;
      while (nodes.nextNode()) domNodes++;
      const now = performance.now();
      const model = adapter.read();
      const scanMs = performance.now() - now;
      const segments = segmentsOf(model);
      window.liveBefore = new Map(
        [...adapter.anchors].map(([id, a]) => [id, a.block.textContent]),
      );
      return {
        domNodes,
        scanMs,
        segmentCount: segments.length,
        sample: segments.slice(0, 3),
      };
    }, moduleUrl);
    Object.assign(row, {
      domNodes: discovered.domNodes,
      segments: discovered.segmentCount,
      scanMs: discovered.scanMs,
    });
    if (!discovered.sample.length)
      throw new Error('No translatable text found');
    const start = performance.now();
    const results = await provider.translate(discovered.sample, {
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
    });
    row.apiMs = performance.now() - start;
    Object.assign(
      row,
      await page.evaluate((results) => {
        const a = window.liveAdapter;
        const before = new Map(
          [...a.anchors].map(([id, anchor]) => [id, anchor.block.textContent]),
        );
        let start = performance.now();
        a.render(results, 'bilingual');
        const renderMs = performance.now() - start;
        const rendered = document.querySelectorAll(
          '[data-ogleans-translation]',
        ).length;
        start = performance.now();
        a.restore();
        const restoreMs = performance.now() - start;
        const restored = [...a.anchors].every(
          ([id, anchor]) => before.get(id) === anchor.block.textContent,
        );
        a.dispose();
        return { renderMs, restoreMs, rendered, restored };
      }, results),
    );
    const reverse = await provider.translate(
      [{ id: 'reverse', text: results[0].text }],
      { sourceLanguage: 'zh-CN', targetLanguage: 'en' },
    );
    row.reverseDirection = reverse[0].text.length > 0;
    row.sampleTranslation = results[0].text.slice(0, 100);
    row.status =
      row.restored && row.rendered > 0 && row.reverseDirection
        ? 'passed'
        : 'failed';
  } catch (error) {
    row.status = 'failed';
    row.error = error.message;
  }
  row.pageErrors = errors.slice(0, 5);
  report.pages.push(row);
  console.log(row);
  await page.close();
}
await browser.close();
await writeFile(
  'docs/live-verification.json',
  JSON.stringify(report, null, 2) + '\n',
);
if (report.pages.some((p) => p.status === 'failed')) process.exitCode = 1;
