// SPDX-License-Identifier: MPL-2.0
import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Worker,
} from '@playwright/test';
import { resolve } from 'node:path';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { defaultConfig } from '../../packages/config/src/index';

let context: BrowserContext;
let worker: Worker;

test.beforeAll(async () => {
  const path = resolve('.local/e2e-bookmarks-extension');
  await cp(resolve('dist/chromium'), path, { recursive: true });
  const manifest = JSON.parse(
    await readFile(resolve(path, 'manifest.json'), 'utf8'),
  );
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
});

test.afterAll(async () => {
  for (const page of context.pages()) await page.close().catch(() => {});
  await context.close();
});

async function control(page: import('@playwright/test').Page, action: string) {
  return worker.evaluate(
    async ({ url, action }) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url === url)!;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        files: ['content.js'],
      });
      return chrome.tabs.sendMessage(tab.id!, { kind: 'control', action });
    },
    { url: page.url(), action },
  );
}

async function selectText(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const block = document.querySelector('article p')!;
    const range = document.createRange();
    range.selectNodeContents(block);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
}

test('native bookmark export preserves existing bookmarks and provides HTML fallback', async () => {
  await worker.evaluate(async (config) => {
    config.translation.mode = 'disabled';
    config.providers = [];
    config.primary = '';
    config.fallback = undefined;
    config.collection.bookmarksEnabled = true;
    await chrome.storage.local.set({ config });
    await chrome.storage.local.remove('ogleans.collections.v1');
    const existing = await chrome.bookmarks.search({
      title: 'Existing bookmark',
    });
    if (!existing.length)
      await chrome.bookmarks.create({
        title: 'Existing bookmark',
        url: 'https://example.org/existing',
      });
  }, structuredClone(defaultConfig));

  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/static');
  await control(page, 'activate');
  await selectText(page);
  await page.keyboard.press('Alt+Shift+S');
  await expect
    .poll(async () =>
      worker.evaluate(async () => {
        const stored = await chrome.storage.local.get('ogleans.collections.v1');
        return (
          (stored['ogleans.collections.v1'] as unknown[] | undefined) ?? []
        ).length;
      }),
    )
    .toBe(1);
  await page.keyboard.press('Alt+Shift+C');
  await page.locator('[data-og="item"]').click();
  await page.getByRole('button', { name: 'Bookmark', exact: true }).click();
  await expect(page.locator('[data-og="toast"]')).toContainText(
    'Bookmark exported',
  );

  const bookmarks = await worker.evaluate(async () => {
    const flat: chrome.bookmarks.BookmarkTreeNode[] = [];
    const walk = (nodes: chrome.bookmarks.BookmarkTreeNode[]) => {
      for (const node of nodes) {
        flat.push(node);
        if (node.children) walk(node.children);
      }
    };
    walk(await chrome.bookmarks.getTree());
    return flat;
  });
  expect(
    bookmarks.some((bookmark) => bookmark.title === 'Existing bookmark'),
  ).toBe(true);
  expect(
    bookmarks.some((bookmark) => bookmark.url?.includes('#:~:text=')),
  ).toBe(true);

  await page.getByRole('button', { name: 'Bookmark', exact: true }).click();
  await page.waitForTimeout(250);
  const nativeCount = await worker.evaluate(async () => {
    const flat: chrome.bookmarks.BookmarkTreeNode[] = [];
    const walk = (nodes: chrome.bookmarks.BookmarkTreeNode[]) => {
      for (const node of nodes) {
        flat.push(node);
        if (node.children) walk(node.children);
      }
    };
    walk(await chrome.bookmarks.getTree());
    return flat.filter((bookmark) => bookmark.url?.includes('#:~:text='))
      .length;
  });
  expect(nativeCount).toBe(1);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'HTML bookmark' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('ogleans-bookmarks.html');
  const path = await file.path();
  const html = await readFile(path!, 'utf8');
  expect(html).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
  expect(html).toContain('Ogleans');
  await page.close();
});
