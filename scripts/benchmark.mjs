// SPDX-License-Identifier: MPL-2.0
import { chromium } from '@playwright/test';
import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
const sdk = await readFile('dist/sdk/index.js', 'utf8');
const browser = await chromium.launch({
  channel: 'chromium',
  executablePath: process.env.TK_CHROMIUM_PATH,
});
const browserVersion = browser.version();
const page = await browser.newPage();
const metrics = [];
for (const count of [1000, 10000, 50000]) {
  await page.setContent('<main></main>');
  const metric = await page.evaluate(
    async ({ count, module }) => {
      const { HtmlAdapter, segmentsOf, TranslationKernel, ProviderRouter } =
        await import(module);
      const main = document.querySelector('main');
      for (let i = 0; i < count / 5; i++) {
        const p = document.createElement('p');
        p.append(
          'Translation ',
          Object.assign(document.createElement('span'), {
            textContent: `kernel ${i}`,
          }),
          ' infrastructure.',
        );
        main.append(p);
      }
      const nodes = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ALL,
      );
      let nodeCount = 0;
      while (nodes.nextNode()) nodeCount++;
      const adapter = new HtmlAdapter(document);
      let start = performance.now();
      const model = adapter.read();
      const scanMs = performance.now() - start;
      const segments = segmentsOf(model);
      const results = segments.map((s) => ({
        id: s.id,
        text: '中文译文 ' + s.text,
      }));
      start = performance.now();
      adapter.render(results, 'bilingual');
      const renderMs = performance.now() - start;
      start = performance.now();
      adapter.restore();
      const restoreMs = performance.now() - start;
      let kernelScanMs = 0,
        kernelRenderMs = 0,
        providerMs = 0;
      const router = new ProviderRouter({ primary: 'benchmark', retries: 0 });
      router.register({
        id: 'benchmark',
        name: 'Benchmark',
        async translate(segments) {
          const now = performance.now();
          const result = segments.map((s) => ({
            id: s.id,
            text: '中文译文 ' + s.text,
          }));
          providerMs += performance.now() - now;
          return result;
        },
      });
      const tracked = {
        id: 'tracked-html',
        read() {
          const now = performance.now();
          const model = adapter.read();
          kernelScanMs += performance.now() - now;
          return model;
        },
        render(results, mode, placement) {
          const now = performance.now();
          adapter.render(results, mode, placement);
          kernelRenderMs += performance.now() - now;
        },
        restore: () => adapter.restore(),
      };
      const kernel = new TranslationKernel(tracked, router, {
        targetLanguage: 'zh',
      });
      start = performance.now();
      await kernel.translate();
      const kernelTotalMs = performance.now() - start;
      const translationOverheadMs = Math.max(
        0,
        kernelTotalMs - kernelScanMs - kernelRenderMs - providerMs,
      );
      kernel.dispose();
      start = performance.now();
      let stop = () => {};
      let dynamicSegmentCount = 0;
      await new Promise((resolve) => {
        stop = adapter.observe((model) => {
          dynamicSegmentCount = segmentsOf(model).length;
          resolve();
        });
        main.append(
          Object.assign(document.createElement('p'), {
            textContent: 'Dynamic insertion paragraph.',
          }),
        );
      });
      const dynamicElapsedMs = performance.now() - start;
      stop();
      adapter.dispose();
      return {
        requestedNodes: count,
        domNodes: nodeCount,
        segments: segments.length,
        scanMs,
        renderMs,
        restoreMs,
        dynamicElapsedMs,
        dynamicSegmentCount,
        translationOverheadMs,
        kernelTotalMs,
        kernelScanMs,
        kernelRenderMs,
        providerMs,
        estimatedTextBytes: segments.reduce((n, s) => n + s.text.length * 2, 0),
      };
    },
    {
      count,
      module: `data:text/javascript;base64,${Buffer.from(sdk).toString('base64')}`,
    },
  );
  metrics.push(metric);
}
await browser.close();
const { MultiProviderScheduler } = await import('../dist/sdk/index.js');
const schedulerSegments = Array.from({ length: 12 }, (_, index) => ({
  id: `bench-${index}`,
  text: `Benchmark paragraph ${index}`,
}));
const schedulerStart = performance.now();
const scheduler = new MultiProviderScheduler();
for (const id of ['a', 'b'])
  scheduler.register(
    {
      id,
      name: id,
      async translate(items) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return items.map((item) => ({
          id: item.id,
          text: `${id}:${item.text}`,
        }));
      },
    },
    { id, concurrency: 2, weight: 1 },
  );
const scheduled = await scheduler.schedule(
  schedulerSegments,
  { targetLanguage: 'zh' },
  {
    strategy: 'round-robin',
    globalConcurrency: 4,
    retries: 0,
    timeoutMs: 500,
  },
);
const concurrentSchedulerMs = performance.now() - schedulerStart;
const sequentialBaselineMs = schedulerSegments.length * 30;
const schedulerBenchmark = {
  segments: schedulerSegments.length,
  providers: 2,
  globalConcurrency: 4,
  providerConcurrency: 2,
  concurrentMs: Math.round(concurrentSchedulerMs * 100) / 100,
  sequentialBaselineMs,
  speedup:
    Math.round((sequentialBaselineMs / concurrentSchedulerMs) * 100) / 100,
  completed: scheduled.results.length,
  failures: scheduled.failures.length,
};
const sizes = {};
for (const file of await readdir('dist/chromium', { recursive: true })) {
  const s = await stat(`dist/chromium/${file}`);
  if (s.isFile()) sizes[file] = s.size;
}
const report = {
  environment: {
    node: process.version,
    platform: process.platform,
    date: new Date().toISOString(),
    browser: browserVersion,
    runs: 1,
  },
  notes: [
    'Single local run, no performance guarantee.',
    'Text bytes estimate excludes DOM, JS objects, engine and provider memory.',
    'Dynamic elapsed measures insertion to model callback, including the 80 ms debounce.',
    'Translation overhead subtracts measured scan/render and deterministic provider time from the whole kernel run; no network API is used.',
    'The scheduler throughput measurement uses deterministic in-process providers with 30 ms work per segment; it is not a provider service benchmark.',
  ],
  metrics,
  schedulerBenchmark,
  bundleBytes: sizes,
  totalBundleBytes: Object.values(sizes).reduce((a, b) => a + b, 0),
};
await writeFile('docs/benchmark.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
