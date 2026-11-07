// SPDX-License-Identifier: MPL-2.0
import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Worker,
  type Page,
} from '@playwright/test';
import { resolve } from 'node:path';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  defaultConfig,
  type KernelConfig,
} from '../../packages/config/src/index';
let context: BrowserContext, worker: Worker, id: string;
test.beforeEach(async () => {
  const path = resolve('.local/e2e-extension');
  await cp(resolve('dist/chromium'), path, { recursive: true });
  const manifest = JSON.parse(
    await readFile(resolve(path, 'manifest.json'), 'utf8'),
  );
  // Test-only grant avoids browser consent dialogs in headless CI. Release manifest is unchanged.
  manifest.host_permissions = ['http://127.0.0.1/*'];
  manifest.permissions = [...new Set([...manifest.permissions, 'bookmarks'])];
  await writeFile(resolve(path, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext('', {
    headless: true,
    channel: 'chromium',
    executablePath: process.env.TK_CHROMIUM_PATH,
    args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
  });
  worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  id = new URL(worker.url()).host;
});
test.afterEach(async () => {
  for (const page of context?.pages() ?? []) await page.close().catch(() => {});
  await context?.close();
});
test('capture real settings with no saved secrets', async () => {
  await worker.evaluate(async () => chrome.storage.local.clear());
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`chrome-extension://${id}/options.html`);
  await expect(
    page.getByRole('heading', { name: 'Ogleans', exact: true }),
  ).toBeVisible();
  await mkdir('docs/assets', { recursive: true });
  await page.screenshot({
    path: 'docs/assets/extension-settings-v0.2.0-alpha.1.png',
  });
  await page.close();
});
async function configure(failure = false, target = 'zh-CN') {
  await worker.evaluate(
    async ({ config, failure, target }) => {
      config.targetLanguage = target;
      config.primary = failure ? 'fail' : 'local';
      config.fallback = failure ? 'local' : undefined;
      config.providers = [
        {
          id: 'local',
          kind: 'ollama',
          baseUrl: 'http://127.0.0.1:4173',
          model: 'test',
          timeoutMs: 2000,
        },
        ...(failure
          ? [
              {
                id: 'fail',
                kind: 'ollama' as const,
                baseUrl: 'http://127.0.0.1:4173/fail',
                model: 'test',
                timeoutMs: 2000,
              },
            ]
          : []),
      ];
      await chrome.storage.local.set({ config });
    },
    { config: structuredClone(defaultConfig), failure, target },
  );
}
async function control(page: Page, action: string, mode?: string) {
  return worker.evaluate(
    async ({ url, action, mode }) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => t.url === url)!;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        files: ['content.js'],
      });
      return chrome.tabs.sendMessage(tab.id!, {
        kind: 'control',
        action,
        mode,
      });
    },
    { url: page.url(), action, mode },
  );
}
async function configureMode(mode: 'external' | 'disabled') {
  await worker.evaluate(
    async ({ config, mode }) => {
      config.translation.mode = mode;
      config.providers = [];
      config.primary = '';
      config.fallback = undefined;
      config.gestures.showHandle = true;
      config.collection.bookmarksEnabled = true;
      await chrome.storage.local.set({ config });
    },
    { config: structuredClone(defaultConfig), mode },
  );
}
async function configureMultiProvider() {
  await worker.evaluate(async (config) => {
    config.translation.mode = 'built-in';
    config.translation.strategy = 'round-robin';
    config.translation.globalConcurrency = 4;
    config.translation.retries = 0;
    config.primary = 'a';
    config.fallback = undefined;
    config.providers = [
      {
        id: 'a',
        kind: 'ollama',
        baseUrl: 'http://127.0.0.1:4173',
        model: 'test',
        timeoutMs: 3000,
        enabled: true,
        concurrency: 2,
        weight: 1,
        languages: ['*'],
        headers: { 'X-Ogleans-Provider': 'a' },
      },
      {
        id: 'b',
        kind: 'ollama',
        baseUrl: 'http://127.0.0.1:4173',
        model: 'test',
        timeoutMs: 3000,
        enabled: true,
        concurrency: 2,
        weight: 1,
        languages: ['*'],
        headers: { 'X-Ogleans-Provider': 'b' },
      },
    ];
    await chrome.storage.local.set({ config });
  }, structuredClone(defaultConfig));
}
async function clearCollections() {
  await worker.evaluate(async () => {
    await chrome.storage.local.remove([
      'ogleans.collections.v1',
      'translationKernel.collections',
      'tk.collections',
    ]);
  });
}
async function collectionItems() {
  return worker.evaluate(async () => {
    const stored = await chrome.storage.local.get('ogleans.collections.v1');
    return (stored['ogleans.collections.v1'] ?? []) as Array<{
      id: string;
      text: string;
      captureKind: string;
      note?: string;
      tags: string[];
    }>;
  });
}
async function selectText(page: Page, paragraph = 0) {
  await page.evaluate((index) => {
    const block = document.querySelectorAll('article p')[index];
    if (!block) throw new Error('Paragraph not found');
    const range = document.createRange();
    range.selectNodeContents(block);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, paragraph);
}
async function upwardGesture(page: Page) {
  await page.mouse.move(35, 420);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(35, 330, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
}
for (const route of [
  'static',
  'wikipedia',
  'github',
  'spa',
  'dynamic',
  'large',
])
  test(`${route}: translate, restore, retranslate and preserve listeners`, async () => {
    await configure();
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:4173/${route}`);
    const original = await page.locator('article').textContent();
    await control(page, 'translate');
    await expect(page.locator('[data-tk-translation]').first()).toContainText(
      '中文译文',
    );
    const expected = route === 'large' ? 252 : 5;
    await expect(page.locator('[data-tk-translation]')).toHaveCount(expected, {
      timeout: 30000,
    });
    await control(page, 'mode', 'translation');
    await control(page, 'mode', 'bilingual');
    await page.locator('a').first().click();
    expect(
      await page.evaluate(
        () => (window as unknown as { clicks: number }).clicks,
      ),
    ).toBe(1);
    await page.locator('#add').click();
    await expect(page.locator('[data-tk-translation]')).toHaveCount(
      expected + 1,
    );
    await page.locator('#edit').click();
    await expect(
      page.locator('p').first().locator('[data-tk-translation]'),
    ).toContainText('SPA updated paragraph');
    await control(page, 'restore');
    await expect(page.locator('[data-tk-translation]')).toHaveCount(0);
    expect(await page.locator('article').textContent()).toContain(
      'SPA updated paragraph',
    );
    expect(original).toContain('Paragraph 0');
    await control(page, 'translate');
    await expect(page.locator('[data-tk-translation]')).toHaveCount(
      expected + 1,
      { timeout: 30000 },
    );
    await control(page, 'restore');
    await page.close();
  });
test('fallback, reverse direction, stop and provider failure', async () => {
  await configure(true, 'en');
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/fallback');
  await control(page, 'translate');
  await expect(page.locator('[data-tk-translation]').first()).toContainText(
    'English translation',
  );
  await control(page, 'stop');
  await control(page, 'restore');
  await worker.evaluate(async () => {
    const stored = await chrome.storage.local.get('config');
    const config = stored.config as KernelConfig;
    config.fallback = undefined;
    await chrome.storage.local.set({ config });
  });
  await control(page, 'translate');
  await expect
    .poll(async () => (await control(page, 'status')).status)
    .toContain('503');
  await page.close();
});
test('settings import/export validation and safe key storage', async () => {
  await configure();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/options.html`);
  await expect(page.locator('#primary')).toHaveValue('local');
  await page.locator('#target').fill('en');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.locator('#status')).toHaveText('Settings saved');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export configuration' }).click();
  expect((await download).suggestedFilename()).toBe('config.json');
  await page.locator('#export-part').selectOption('rules');
  const rulesDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export configuration' }).click();
  expect((await rulesDownload).suggestedFilename()).toBe('rules.json');
  await page.locator('#import').setInputFiles({
    name: 'config.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ ...defaultConfig, targetLanguage: 'ja' }),
    ),
  });
  await expect(page.locator('#target')).toHaveValue('ja');
  await expect(page.locator('#status')).toContainText('Imported for review');
  await page.locator('#import').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schemaVersion":999}'),
  });
  await expect(page.locator('#status')).toContainText('Unsupported');
  await page.screenshot({ path: 'test-results/settings.png', fullPage: true });
  await page.close();
});
test('content cannot read secrets and stop disables dynamic translation', async () => {
  await configure();
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/security');
  await worker.evaluate(async () => {
    const stored = await chrome.storage.local.get('config');
    const config = stored.config as KernelConfig;
    config.providers[0].apiKey = 'test-secret-only';
    await chrome.storage.local.set({ config });
  });
  await control(page, 'translate');
  await expect(page.locator('[data-tk-translation]')).toHaveCount(5);
  const probe = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      url: 'http://127.0.0.1:4173/security',
    });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: async () => {
        const publicReply = await chrome.runtime.sendMessage({
          kind: 'config.public',
        });
        const privateReply = await chrome.runtime.sendMessage({
          kind: 'config.get',
        });
        let denied = false;
        try {
          await chrome.storage.local.get('config');
        } catch {
          denied = true;
        }
        return { publicReply, privateReply, denied };
      },
    });
    return result.result;
  });
  expect(JSON.stringify(probe)).not.toContain('test-secret-only');
  expect(probe?.privateReply.ok).toBe(false);
  expect(probe?.denied).toBe(true);
  await control(page, 'stop');
  await page.locator('#add').click();
  await page.waitForTimeout(150);
  await expect(page.locator('[data-tk-translation]')).toHaveCount(5);
  await control(page, 'restore');
  await page.close();
});
for (const framework of ['react', 'vue'])
  test(`${framework}: preserve framework updates and handlers`, async () => {
    await configure();
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:4173/${framework}`);
    await expect(page.locator('p')).toContainText('version 0');
    await control(page, 'translate');
    await expect(page.locator('[data-tk-translation]')).toContainText(
      'version 0',
    );
    await page.locator('a').click();
    await expect(page.locator('[data-tk-translation]')).toContainText(
      'version 1',
    );
    await control(page, 'restore');
    await expect(page.locator('p')).toHaveText(
      `${framework === 'react' ? 'React' : 'Vue'} paragraph version 1. Update ${framework === 'react' ? 'React' : 'Vue'}`,
    );
    await page.close();
  });

test('release manifest keeps bookmark access optional', async () => {
  const manifest = JSON.parse(
    await readFile(resolve('dist/chromium/manifest.json'), 'utf8'),
  );
  expect(manifest.permissions).not.toContain('bookmarks');
  expect(manifest.optional_permissions).toContain('bookmarks');
  expect(manifest.name).toBe('Ogleans');
  expect(manifest.version_name).toBe('0.2.0-alpha.1');
});

for (const mode of ['disabled', 'external'] as const)
  test(`${mode}: gestures, collection, annotations, search and exports work without translation`, async () => {
    await configureMode(mode);
    await clearCollections();
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4173/static');
    await control(page, 'activate');
    expect(await page.locator('[data-tk-translation]').count()).toBe(0);
    await control(page, 'translate');
    expect(await page.locator('[data-tk-translation]').count()).toBe(0);
    await selectText(page, 0);
    await page.keyboard.press('Alt+Shift+S');
    await expect(page.locator('[data-og="toast"]')).toContainText(
      'Saved to Ogleans',
    );
    const items = await collectionItems();
    expect(items).toHaveLength(1);
    expect(items[0]!.captureKind).toBe(
      mode === 'external' ? 'displayed-selection' : 'original',
    );
    expect(items[0]!.text).toContain('Paragraph 0');
    await page.keyboard.press('Alt+Shift+C');
    await expect(page.locator('[data-og="panel"]')).toBeVisible();
    await expect(page.locator('[data-og="item"]')).toHaveCount(1);
    await page.locator('[data-og="search"]').fill('does-not-exist');
    await expect(page.locator('[data-og="list"]')).toContainText(
      'No passages match',
    );
    await page.locator('[data-og="search"]').fill('');
    await expect(page.locator('[data-og="item"]')).toHaveCount(1);
    await page.locator('[data-og="item"]').click();
    await page.locator('[data-og="tags"]').fill('research, reading');
    await page.locator('[data-og="note"]').fill('Translation-independent note');
    await page.getByRole('button', { name: 'Apply changes' }).click();
    await expect
      .poll(async () => (await collectionItems())[0])
      .toMatchObject({
        note: 'Translation-independent note',
        tags: ['research', 'reading'],
      });
    const markdownDownload = page.waitForEvent('download');
    await page.locator('[data-og-action="export-markdown"]').click();
    const markdown = await markdownDownload;
    expect(markdown.suggestedFilename()).toBe('ogleans-collection.md');
    const markdownPath = await markdown.path();
    expect(await readFile(markdownPath!, 'utf8')).toContain(
      'Translation-independent note',
    );
    const jsonDownload = page.waitForEvent('download');
    await page.locator('[data-og-action="export-json"]').click();
    const json = await jsonDownload;
    expect(json.suggestedFilename()).toBe('ogleans-collection.json');
    const jsonPath = await json.path();
    const backup = JSON.parse(await readFile(jsonPath!, 'utf8'));
    expect(backup.type).toBe('ogleans-collection-export');
    expect(backup.items[0].tags).toEqual(['research', 'reading']);
    await page.screenshot({
      path: `docs/assets/collection-${mode}.png`,
      fullPage: false,
    });
    await page.close();
  });

test('mouse gesture preserves selection while clicks and context menus remain ordinary', async () => {
  await configureMode('disabled');
  await clearCollections();
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/static');
  await control(page, 'activate');
  await page.evaluate(() => {
    (window as unknown as { contextMenuCount: number }).contextMenuCount = 0;
    window.addEventListener('contextmenu', () => {
      (window as unknown as { contextMenuCount: number }).contextMenuCount++;
    });
  });
  await page.mouse.click(35, 420);
  expect(await collectionItems()).toHaveLength(0);
  await page.keyboard.down('Alt');
  await page.mouse.click(35, 420);
  await page.keyboard.up('Alt');
  expect(await collectionItems()).toHaveLength(0);
  await page.mouse.click(35, 420, { button: 'right' });
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { contextMenuCount: number }).contextMenuCount,
    ),
  ).toBe(1);
  expect(await collectionItems()).toHaveLength(0);
  await selectText(page, 1);
  await upwardGesture(page);
  await expect.poll(async () => (await collectionItems()).length).toBe(1);
  expect((await collectionItems())[0]!.text).toContain('Paragraph 1');
  await page.keyboard.press('Alt+Shift+C');
  await expect(page.locator('[data-og="panel"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-og="panel"]')).toBeHidden();
  await page.close();
});

test('two providers translate concurrently and preserve paragraph order', async () => {
  await fetch('http://127.0.0.1:4173/reset-stats');
  await configureMultiProvider();
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/static');
  await control(page, 'translate');
  await expect(page.locator('[data-tk-translation]')).toHaveCount(5, {
    timeout: 30000,
  });
  await expect(
    page.locator('p').first().locator('[data-tk-translation]'),
  ).toContainText('Paragraph 0');
  const providers = await page
    .locator('[data-tk-translation]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-ogleans-provider')),
    );
  expect(providers.some((provider) => provider?.includes('a'))).toBe(true);
  expect(providers.some((provider) => provider?.includes('b'))).toBe(true);
  const stats = (await (await fetch('http://127.0.0.1:4173/stats')).json()) as {
    maxConcurrent: number;
    byProvider: Record<string, number>;
  };
  expect(stats.maxConcurrent).toBeGreaterThanOrEqual(2);
  expect(stats.byProvider.a).toBeGreaterThan(0);
  expect(stats.byProvider.b).toBeGreaterThan(0);
  await page.close();
});

test('gesture mappings are configurable and conflicts are shown before save', async () => {
  await configureMode('disabled');
  await worker.evaluate(async () => {
    const stored = await chrome.storage.local.get('config');
    const config = stored.config as KernelConfig;
    config.collection.bookmarksEnabled = false;
    await chrome.storage.local.set({ config });
  });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.getByRole('button', { name: 'Add gesture' }).click();
  const row = page.locator('.gesture-row').last();
  await row.locator('[data-field="sequence"]').fill('up');
  await expect(page.locator('#gesture-status')).toContainText('Error');
  await row.locator('[data-field="sequence"]').fill('left,up');
  await row.locator('[data-field="action"]').selectOption('panel.hide');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.locator('#status')).toHaveText('Settings saved');
  const saved = await worker.evaluate(async () => {
    const stored = await chrome.storage.local.get('config');
    return stored.config as KernelConfig;
  });
  expect(
    saved.gestures.mappings.some(
      (mapping) =>
        mapping.action === 'panel.hide' &&
        mapping.sequence.join(',') === 'left,up',
    ),
  ).toBe(true);
  await page.close();
});
