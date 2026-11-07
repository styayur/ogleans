// SPDX-License-Identifier: MPL-2.0
import { describe, it, expect } from 'vitest';
import {
  CollectionStore,
  bookmarksHtml,
  buildTextIndex,
  createTextAnchor,
  resolveTextAnchor,
  textFragmentUrl,
  type CollectionItem,
  type CollectionStorage,
  type CreateCollectionInput,
} from '../../packages/collection/src/index';

class MemoryStorage implements CollectionStorage {
  items: unknown = [];
  async load(): Promise<unknown> {
    return structuredClone(this.items);
  }
  async save(items: CollectionItem[]): Promise<void> {
    this.items = structuredClone(items);
  }
}
function anchorFor(text: string) {
  document.body.innerHTML = `<article><p>Prefix context ${text} suffix context.</p></article>`;
  const node = document.querySelector('p')!.firstChild!;
  const start = node.textContent!.indexOf(text);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + text.length);
  return createTextAnchor(document.body, range, text);
}
function input(
  overrides: Partial<CreateCollectionInput> = {},
): CreateCollectionInput {
  return {
    text: 'saved passage',
    sourceUrl: 'https://example.org/article',
    sourceTitle: 'Example article',
    author: 'Ada',
    anchor: anchorFor('saved passage'),
    ...overrides,
  };
}
describe('independent collection store', () => {
  it('persists W3C-compatible items without any translation engine', async () => {
    const storage = new MemoryStorage();
    const store = new CollectionStore(storage, {
      now: () => Date.parse('2026-11-07T00:00:00Z'),
      createId: () => 'item-1',
    });
    const item = await store.create(
      input({
        tags: ['Research', 'research', 'Reading'],
        note: 'Important context',
        translations: [
          {
            text: '已保存段落',
            providerId: 'test-provider',
            provenance: 'built-in',
          },
        ],
      }),
    );
    expect(item.id).toBe('item-1');
    expect(item.createdAt).toBe('2026-11-07T00:00:00.000Z');
    expect(item.tags).toEqual(['Research', 'Reading']);
    expect(item.annotation).toMatchObject({
      '@context': 'http://www.w3.org/ns/anno.jsonld',
      type: 'Annotation',
      motivation: 'highlighting',
      target: {
        source: 'https://example.org/article',
        selector: [
          { type: 'TextQuoteSelector', exact: 'saved passage' },
          { type: 'TextPositionSelector' },
        ],
      },
    });
    expect(await store.list()).toHaveLength(1);
  });
  it('searches text, notes and tags, then edits and deletes', async () => {
    const storage = new MemoryStorage();
    let id = 0;
    const store = new CollectionStore(storage, {
      createId: () => `id-${++id}`,
    });
    const first = await store.create(
      input({ note: 'First note', tags: ['alpha'] }),
    );
    await store.create(
      input({
        text: 'second passage',
        anchor: anchorFor('second passage'),
        tags: ['beta'],
      }),
    );
    expect(await store.list({ query: 'first' })).toHaveLength(1);
    expect(await store.list({ tags: ['beta'] })).toHaveLength(1);
    const updated = await store.update(first.id, {
      note: 'Changed',
      tags: ['gamma'],
    });
    expect(updated.note).toBe('Changed');
    expect(updated.tags).toEqual(['gamma']);
    expect((updated.annotation as { modified?: string }).modified).toBeTruthy();
    expect(await store.remove(first.id)).toBe(true);
    expect(await store.remove(first.id)).toBe(false);
    expect(await store.list()).toHaveLength(1);
  });
  it('round trips JSON and Markdown exports without secrets', async () => {
    const storage = new MemoryStorage();
    const store = new CollectionStore(storage, { createId: () => 'export-1' });
    await store.create(input({ note: 'local only', tags: ['kept'] }));
    const json = await store.exportJson();
    expect(json).not.toContain('apiKey');
    expect(json).not.toContain('headers');
    const markdown = await store.exportMarkdown();
    expect(markdown).toContain('# Ogleans collection export');
    expect(markdown).toContain('local only');
    const restoredStorage = new MemoryStorage();
    const restored = new CollectionStore(restoredStorage);
    expect(await restored.importJson(json)).toBe(1);
    expect((await restored.list())[0]?.tags).toEqual(['kept']);
  });
  it('keeps displayed selections explicit when no original text is available', async () => {
    const store = new CollectionStore(new MemoryStorage(), {
      createId: () => 'shown',
    });
    const item = await store.create(
      input({
        text: 'machine translated text',
        captureKind: 'displayed-selection',
      }),
    );
    expect(item.captureKind).toBe('displayed-selection');
    expect(item.originalText).toBeUndefined();
  });
});
describe('text anchors and Text Fragments', () => {
  it('generates quote and position selectors and resolves changed nearby content', () => {
    const anchor = anchorFor('exact quoted text');
    expect(anchor.quality).toBe('exact');
    expect(anchor.quote.exact).toBe('exact quoted text');
    expect(anchor.quote.prefix).toContain('Prefix context');
    expect(anchor.position.end - anchor.position.start).toBe(
      anchor.quote.exact.length,
    );
    document.querySelector('p')!.firstChild!.textContent =
      'Changed context exact quoted text suffix context.';
    const range = resolveTextAnchor(document.body, anchor);
    expect(range?.toString()).toBe('exact quoted text');
    expect(textFragmentUrl('https://example.org/a', anchor)).toContain(
      '#:~:text=',
    );
  });
  it('reports an unavailable anchor after the selected text disappears', () => {
    const anchor = anchorFor('vanishing text');
    document.querySelector('p')!.textContent = 'Completely different page.';
    expect(buildTextIndex(document.body).text).not.toContain('vanishing text');
    expect(resolveTextAnchor(document.body, anchor)).toBeNull();
  });
  it('produces escaped Netscape bookmark HTML as a permission-free fallback', async () => {
    const store = new CollectionStore(new MemoryStorage(), {
      createId: () => 'bookmark-1',
    });
    const item = await store.create(
      input({ text: '<script>alert(1)</script>' }),
    );
    const html = bookmarksHtml([item], 'Ogleans <reading>');
    expect(html).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
    expect(html).toContain('Ogleans &lt;reading&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
