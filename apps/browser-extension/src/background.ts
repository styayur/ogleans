// SPDX-License-Identifier: GPL-3.0-or-later
import {
  defaultConfig,
  parseConfig,
  publicConfig,
  type KernelConfig,
} from '../../../packages/config/src/index';
import { actionUrl } from '../../../packages/action-api/src/index';
import {
  bookmarksHtml,
  CollectionStore,
  textFragmentUrl,
  type CollectionListQuery,
  type CollectionStorage,
  type CollectionItem,
} from '../../../packages/collection/src/index';
import { createProvider } from '../../../examples/providers/src/index';
import { MultiProviderScheduler } from '../../../packages/scheduler/src/index';
import type { TranslationSegment } from '../../../packages/shared/src/index';

const CONFIG_KEY = 'config';
const COLLECTIONS_KEY = 'ogleans.collections.v1';
const LEGACY_COLLECTIONS_KEYS = [
  'translationKernel.collections',
  'tk.collections',
];
const ready = chrome.storage.local.setAccessLevel({
  accessLevel: 'TRUSTED_CONTEXTS',
});
class ChromeCollectionStorage implements CollectionStorage {
  async load(): Promise<unknown> {
    await ready;
    const values = await chrome.storage.local.get([
      COLLECTIONS_KEY,
      ...LEGACY_COLLECTIONS_KEYS,
    ]);
    if (values[COLLECTIONS_KEY] !== undefined) return values[COLLECTIONS_KEY];
    for (const key of LEGACY_COLLECTIONS_KEYS)
      if (values[key] !== undefined) return values[key];
    return [];
  }
  async save(items: CollectionItem[]): Promise<void> {
    await ready;
    await chrome.storage.local.set({ [COLLECTIONS_KEY]: items });
  }
}
const collections = new CollectionStore(new ChromeCollectionStorage());
interface ActiveJob {
  tabId: number;
  controller: AbortController;
  port?: chrome.runtime.Port;
}
const jobs = new Map<string, ActiveJob>();
let jobSequence = 0;
const translationPorts = new Map<chrome.runtime.Port, number>();

async function config(): Promise<KernelConfig> {
  await ready;
  const value = await chrome.storage.local.get(CONFIG_KEY);
  if (!value[CONFIG_KEY]) return structuredClone(defaultConfig);
  const migrated = parseConfig(value[CONFIG_KEY]);
  if (
    !value[CONFIG_KEY] ||
    (value[CONFIG_KEY] as Record<string, unknown>).schemaVersion !== 2
  )
    await chrome.storage.local.set({ [CONFIG_KEY]: migrated });
  return migrated;
}
function trustedPage(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    [
      chrome.runtime.getURL('popup.html'),
      chrome.runtime.getURL('options.html'),
    ].includes(sender.url ?? '')
  );
}
function contentSender(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    !!sender.tab?.id &&
    sender.frameId === 0 &&
    /^https?:/u.test(sender.url ?? '')
  );
}
async function command(action: string, mode?: string): Promise<unknown> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/u.test(tab.url ?? ''))
    throw new Error('Open an ordinary HTTP(S) page first');
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js'],
  });
  return chrome.tabs.sendMessage(tab.id, { kind: 'control', action, mode });
}
function closeTranslationPort(port: chrome.runtime.Port): void {
  translationPorts.delete(port);
  try {
    port.disconnect();
  } catch {
    // Port is already closed.
  }
}
function abortTabJobs(tabId: number): void {
  for (const [key, job] of jobs)
    if (job.tabId === tabId) {
      job.controller.abort();
      if (job.port) closeTranslationPort(job.port);
      jobs.delete(key);
    }
  for (const [port, portTabId] of translationPorts)
    if (portTabId === tabId) closeTranslationPort(port);
}
chrome.commands.onCommand.addListener((commandName) => {
  const action =
    commandName === 'collection'
      ? 'collection.open'
      : commandName === 'save'
        ? 'collection.save'
        : commandName;
  void command(action).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => abortTabJobs(tabId));
function validateSegments(value: unknown, max = 5000): TranslationSegment[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error('Invalid translation segment list');
  const segments = value.map((segment) => {
    if (!segment || typeof segment !== 'object')
      throw new Error('Invalid translation segment');
    const item = segment as Record<string, unknown>;
    if (
      typeof item.id !== 'string' ||
      item.id.length > 96 ||
      typeof item.text !== 'string' ||
      !item.text.trim() ||
      item.text.length > 4000
    )
      throw new Error('Invalid translation segment');
    return { id: item.id, text: item.text };
  });
  if (new Set(segments.map((segment) => segment.id)).size !== segments.length)
    throw new Error('Duplicate translation segment');
  return segments;
}
function schedulerFor(c: KernelConfig): MultiProviderScheduler {
  if (c.translation.mode !== 'built-in')
    throw new Error('Built-in translation is disabled');
  const scheduler = new MultiProviderScheduler();
  for (const provider of c.providers.filter((item) => item.enabled !== false))
    scheduler.register(createProvider(provider), {
      id: provider.id,
      enabled: provider.enabled !== false,
      concurrency: provider.concurrency ?? 1,
      weight: provider.weight ?? 1,
      languages: provider.languages ?? ['*'],
      ...(provider.rateLimit ? { rateLimit: provider.rateLimit } : {}),
    });
  return scheduler;
}
function scheduleOptions(c: KernelConfig) {
  return {
    strategy: c.translation.strategy,
    globalConcurrency: c.translation.globalConcurrency,
    retries: c.translation.retries,
    timeoutMs: c.translation.timeoutMs,
    primary: c.primary,
    ...(c.fallback ? { fallback: c.fallback } : {}),
    fallbackEnabled: c.translation.fallbackEnabled,
    manualAssignments: c.translation.manualAssignments,
  };
}
async function bookmarkFolder(
  name: string,
): Promise<chrome.bookmarks.BookmarkTreeNode> {
  const existing = (await chrome.bookmarks.search({ title: name })).find(
    (node) => !node.url,
  );
  if (existing) return existing;
  return chrome.bookmarks.create({ parentId: '2', title: name });
}
async function exportBookmarks(ids: unknown): Promise<unknown> {
  if (!Array.isArray(ids) || !ids.length || ids.length > 100)
    throw new Error('Select 1–100 collection items');
  const permission = await chrome.permissions.contains({
    permissions: ['bookmarks'],
  });
  if (!permission) throw new Error('BOOKMARK_PERMISSION_REQUIRED');
  const c = await config();
  const folder = await bookmarkFolder(c.collection.bookmarkFolder || 'Ogleans');
  let created = 0;
  let existingCount = 0;
  for (const id of ids) {
    if (typeof id !== 'string') continue;
    const item = await collections.get(id);
    if (!item) continue;
    const url = textFragmentUrl(item.source.url, item.anchor);
    const recorded = item.bookmarkExports.find((entry) => entry.bookmarkId);
    if (recorded?.bookmarkId) {
      try {
        await chrome.bookmarks.get(recorded.bookmarkId);
        existingCount++;
        continue;
      } catch {
        // Stale bookmark metadata: create a new one without touching browser data.
      }
    }
    const duplicate = (await chrome.bookmarks.search({ url })).find(
      (node) => node.url === url,
    );
    if (duplicate) {
      existingCount++;
      await collections.recordBookmark(id, {
        bookmarkId: duplicate.id,
        exportedAt: new Date().toISOString(),
        folder: folder.title,
      });
      continue;
    }
    const title = `${item.source.title || 'Ogleans'} — ${item.text.replace(/\s+/gu, ' ').slice(0, 70)}`;
    const createdNode = await chrome.bookmarks.create({
      parentId: folder.id,
      title,
      url,
    });
    created++;
    await collections.recordBookmark(id, {
      bookmarkId: createdNode.id,
      exportedAt: new Date().toISOString(),
      folder: folder.title,
    });
  }
  return { folder: folder.title, created, existing: existingCount };
}
async function bookmarkHtmlFor(ids: unknown): Promise<string> {
  if (!Array.isArray(ids) || ids.length > 500)
    throw new Error('Invalid bookmark selection');
  const c = await config();
  const items: CollectionItem[] = [];
  for (const id of ids)
    if (typeof id === 'string') {
      const item = await collections.get(id);
      if (item) items.push(item);
    }
  return bookmarksHtml(items, c.collection.bookmarkFolder || 'Ogleans');
}
async function openDictionary(text: string): Promise<void> {
  const c = await config();
  const url = actionUrl(
    c.collection.dictionaryUrlTemplate,
    text.slice(0, 2000),
  );
  if (c.collection.dictionaryOpenMode === 'window')
    await chrome.windows.create({ url, type: 'popup' });
  else await chrome.tabs.create({ url });
}
function collectionQuery(value: unknown): CollectionListQuery {
  const query =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  return {
    query: typeof query.query === 'string' ? query.query.slice(0, 256) : '',
    tags: Array.isArray(query.tags)
      ? query.tags
          .filter((tag): tag is string => typeof tag === 'string')
          .slice(0, 12)
      : [],
    limit: typeof query.limit === 'number' ? query.limit : 100,
    offset: typeof query.offset === 'number' ? query.offset : 0,
  };
}
chrome.runtime.onSuspend.addListener(() => {
  for (const port of translationPorts.keys()) closeTranslationPort(port);
});
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ogleans.translation') return;
  const sender = port.sender;
  if (!sender || !contentSender(sender)) {
    port.disconnect();
    return;
  }
  const tabId = sender.tab!.id!;
  translationPorts.set(port, tabId);
  let job: ActiveJob | undefined;
  let started = false;
  port.onDisconnect.addListener(() => {
    translationPorts.delete(port);
    job?.controller.abort();
    for (const [key, active] of jobs)
      if (active.port === port) jobs.delete(key);
  });
  port.onMessage.addListener((message: unknown) => {
    void (async () => {
      const m = message as Record<string, unknown>;
      if (m?.kind === 'cancel') {
        job?.controller.abort();
        return;
      }
      if (m?.kind !== 'start' || started)
        throw new Error('Invalid scheduler message');
      started = true;
      if (
        jobs.size >= 16 ||
        [...jobs.values()].filter((active) => active.tabId === tabId).length >=
          2
      )
        throw new Error('Too many active translation jobs');
      const segments = validateSegments(m.segments);
      const c = await config();
      if (c.translation.mode !== 'built-in')
        throw new Error('Built-in translation is disabled');
      const controller = new AbortController();
      const key = `${tabId}:${++jobSequence}`;
      job = { tabId, controller, port };
      jobs.set(key, job);
      try {
        port.postMessage({ kind: 'started', count: segments.length });
        const scheduler = schedulerFor(c);
        const summary = await scheduler.schedule(
          segments,
          {
            sourceLanguage: c.sourceLanguage,
            targetLanguage: c.targetLanguage,
            title:
              typeof m.title === 'string'
                ? m.title.slice(0, 256)
                : sender.tab?.title,
            url: sender.url,
            terminology: c.translation.terminology || undefined,
          },
          scheduleOptions(c),
          {
            onResult: (result) => port.postMessage({ kind: 'result', result }),
            onFailure: (failure) =>
              port.postMessage({ kind: 'failure', failure }),
            onTask: (task) => port.postMessage({ kind: 'task', task }),
          },
          controller.signal,
        );
        port.postMessage({
          kind: 'done',
          cancelled: summary.cancelled,
          count: summary.results.length,
          failed: summary.failures.length,
        });
      } catch (error) {
        port.postMessage({
          kind: 'error',
          error: error instanceof Error ? error.message : 'Translation failed',
        });
      } finally {
        jobs.delete(key);
        job = undefined;
        closeTranslationPort(port);
      }
    })().catch((error) => {
      try {
        port.postMessage({
          kind: 'error',
          error: error instanceof Error ? error.message : 'Translation failed',
        });
      } catch {
        // Port closed.
      } finally {
        closeTranslationPort(port);
      }
    });
  });
});
chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
  void (async () => {
    if (
      sender.id !== chrome.runtime.id ||
      !message ||
      typeof message !== 'object'
    )
      throw new Error('Untrusted message');
    const m = message as Record<string, unknown>;
    if (trustedPage(sender)) {
      if (m.kind === 'config.get') return config();
      if (m.kind === 'config.set') {
        const value = parseConfig(m.config);
        await ready;
        await chrome.storage.local.set({ [CONFIG_KEY]: value });
        return { ok: true };
      }
      if (m.kind === 'config.reset') {
        await ready;
        await chrome.storage.local.remove(CONFIG_KEY);
        return { ok: true };
      }
      if (
        m.kind === 'control' &&
        [
          'activate',
          'translate',
          'stop',
          'restore',
          'mode',
          'bilingual',
          'status',
          'selection',
          'collection.open',
          'collection.save',
        ].includes(String(m.action))
      )
        return command(
          String(m.action),
          typeof m.mode === 'string' ? m.mode : undefined,
        );
      if (m.kind === 'action.run') {
        const c = await config();
        const action = c.actions.find((item) => item.id === m.id);
        if (!action) throw new Error('Unknown action');
        const selection = (await command('selection')) as { text: string };
        const url = actionUrl(action.urlTemplate, selection.text);
        if (action.openMode === 'window')
          await chrome.windows.create({ url, type: 'popup' });
        else await chrome.tabs.create({ url });
        return { ok: true };
      }
      if (m.kind === 'collection.list')
        return collections.list(collectionQuery(m.query));
      if (m.kind === 'collection.get' && typeof m.id === 'string')
        return collections.get(m.id);
      if (m.kind === 'collection.update' && typeof m.id === 'string')
        return collections.update(m.id, (m.patch ?? {}) as never);
      if (m.kind === 'collection.remove' && typeof m.id === 'string')
        return collections.remove(m.id);
      if (m.kind === 'collection.export') {
        if (m.format === 'markdown') return collections.exportMarkdown();
        return collections.exportJson();
      }
      if (m.kind === 'collection.import' && typeof m.data === 'string') {
        if (m.data.length > 10_000_000) throw new Error('Import is too large');
        return collections.importJson(
          m.data,
          m.mode === 'replace' ? 'replace' : 'merge',
        );
      }
      if (m.kind === 'bookmark.export') return exportBookmarks(m.ids);
      if (m.kind === 'bookmark.html') return bookmarkHtmlFor(m.ids);
    }
    if (!contentSender(sender))
      throw new Error('Content message must come from an HTTP(S) top frame');
    if (m.kind === 'config.public') return publicConfig(await config());
    if (m.kind === 'collection.create') {
      if (JSON.stringify(m.input).length > 2_000_000)
        throw new Error('Collection item is too large');
      return collections.create(m.input as never);
    }
    if (m.kind === 'collection.list')
      return collections.list(collectionQuery(m.query));
    if (m.kind === 'collection.get' && typeof m.id === 'string')
      return collections.get(m.id);
    if (m.kind === 'collection.update' && typeof m.id === 'string')
      return collections.update(m.id, (m.patch ?? {}) as never);
    if (m.kind === 'collection.remove' && typeof m.id === 'string')
      return collections.remove(m.id);
    if (m.kind === 'collection.export') {
      if (m.format === 'markdown') return collections.exportMarkdown();
      return collections.exportJson();
    }
    if (m.kind === 'collection.import' && typeof m.data === 'string') {
      if (m.data.length > 10_000_000) throw new Error('Import is too large');
      return collections.importJson(
        m.data,
        m.mode === 'replace' ? 'replace' : 'merge',
      );
    }
    if (m.kind === 'bookmark.export') return exportBookmarks(m.ids);
    if (m.kind === 'bookmark.html') return bookmarkHtmlFor(m.ids);
    if (m.kind === 'dictionary.open' && typeof m.text === 'string')
      return openDictionary(m.text);
    throw new Error('Unknown message');
  })().then(
    (result) => reply({ ok: true, result }),
    (error) =>
      reply({
        ok: false,
        error: error instanceof Error ? error.message : 'Request failed',
      }),
  );
  return true;
});
