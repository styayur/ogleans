// SPDX-License-Identifier: MPL-2.0
export const COLLECTION_SCHEMA_VERSION = 1 as const;
export const COLLECTION_EXPORT_TYPE = 'ogleans-collection-export' as const;
export type CaptureKind =
  'original' | 'displayed-selection' | 'displayed-translation';
export interface TextQuoteSelector {
  type: 'TextQuoteSelector';
  exact: string;
  prefix?: string;
  suffix?: string;
}
export interface TextPositionSelector {
  type: 'TextPositionSelector';
  start: number;
  end: number;
}
export interface TextAnchor {
  quote: TextQuoteSelector;
  position: TextPositionSelector;
  textFragment: string;
  quality: 'exact' | 'selection-only';
}
export interface CollectionTranslation {
  text: string;
  providerId?: string;
  providerLabel?: string;
  provenance: 'built-in' | 'external' | 'displayed-page';
  capturedAt: string;
}
export interface CollectionSource {
  url: string;
  title: string;
  author?: string;
  sourceLanguage?: string;
}
export interface BookmarkExport {
  bookmarkId?: string;
  exportedAt: string;
  folder: string;
}
export interface CollectionItem {
  schemaVersion: 1;
  id: string;
  text: string;
  originalText?: string;
  captureKind: CaptureKind;
  translations: CollectionTranslation[];
  source: CollectionSource;
  anchor: TextAnchor;
  tags: string[];
  note?: string;
  createdAt: string;
  updatedAt: string;
  annotation: Record<string, unknown>;
  bookmarkExports: BookmarkExport[];
}
export interface CollectionListQuery {
  query?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}
export interface CreateCollectionInput {
  text: string;
  originalText?: string;
  captureKind?: CaptureKind;
  sourceUrl: string;
  sourceTitle: string;
  author?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  anchor: TextAnchor;
  translations?: Array<
    Omit<CollectionTranslation, 'capturedAt'> & { capturedAt?: string }
  >;
  tags?: string[];
  note?: string;
}
export interface CollectionStorage {
  load(): Promise<unknown>;
  save(items: CollectionItem[]): Promise<void>;
}
export interface CollectionStoreOptions {
  now?: () => number;
  createId?: () => string;
  maxItems?: number;
}
export interface TextChunk {
  node: Text;
  start: number;
  end: number;
}
export interface DOMTextIndex {
  text: string;
  chunks: TextChunk[];
}
const SKIP_TEXT =
  'script,style,noscript,textarea,[data-ogleans-ui],[data-ogleans-translation],[data-tk-translation]';
const MAX_ITEMS = 10000;
const MAX_TEXT = 10000;
const MAX_NOTE = 5000;

function nowIso(now: () => number): string {
  return new Date(now()).toISOString();
}
function clampText(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string') {
    if (required) throw new Error('Text is required');
    return '';
  }
  const text = value.trim();
  if (required && !text) throw new Error('Text is required');
  if (text.length > max) throw new Error('Text is too long');
  return text;
}
function safeUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Collection source must be HTTP(S)');
  return url.href;
}
function tags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 24)
    throw new Error('Invalid tags');
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of value) {
    const tag = clampText(item, 64);
    const key = tag.toLocaleLowerCase();
    if (tag && !seen.has(key)) {
      seen.add(key);
      output.push(tag);
    }
  }
  return output;
}
function translations(
  value: CreateCollectionInput['translations'],
): CollectionTranslation[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8)
    throw new Error('Invalid translations');
  return value.map((translation) => {
    const text = clampText(translation.text, 32000, true);
    if (
      !['built-in', 'external', 'displayed-page'].includes(
        translation.provenance,
      )
    )
      throw new Error('Invalid translation provenance');
    return {
      text,
      provenance: translation.provenance,
      capturedAt: translation.capturedAt ?? '',
      ...(translation.providerId
        ? { providerId: clampText(translation.providerId, 64) }
        : {}),
      ...(translation.providerLabel
        ? { providerLabel: clampText(translation.providerLabel, 128) }
        : {}),
    };
  });
}
function normalizeAnchor(value: TextAnchor): TextAnchor {
  if (!value || typeof value !== 'object') throw new Error('Invalid anchor');
  if (
    value.quote?.type !== 'TextQuoteSelector' ||
    value.position?.type !== 'TextPositionSelector'
  )
    throw new Error('Invalid W3C selector');
  const exact = clampText(value.quote.exact, MAX_TEXT, true);
  const start = Number(value.position.start);
  const end = Number(value.position.end);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start
  )
    throw new Error('Invalid text position');
  const prefix = clampText(value.quote.prefix, 128);
  const suffix = clampText(value.quote.suffix, 128);
  return {
    quote: {
      type: 'TextQuoteSelector',
      exact,
      ...(prefix ? { prefix } : {}),
      ...(suffix ? { suffix } : {}),
    },
    position: { type: 'TextPositionSelector', start, end },
    textFragment: clampText(value.textFragment, 4096),
    quality: value.quality === 'selection-only' ? 'selection-only' : 'exact',
  };
}
function fallbackAnchor(text: string): TextAnchor {
  const exact = text.slice(0, MAX_TEXT);
  return {
    quote: { type: 'TextQuoteSelector', exact },
    position: { type: 'TextPositionSelector', start: 0, end: exact.length },
    textFragment: `#:~:text=${encodeURIComponent(exact)}`,
    quality: 'selection-only',
  };
}
function annotationFor(
  id: string,
  item: Pick<
    CollectionItem,
    | 'text'
    | 'source'
    | 'anchor'
    | 'note'
    | 'translations'
    | 'createdAt'
    | 'updatedAt'
  >,
): Record<string, unknown> {
  const body: Record<string, unknown>[] = [];
  if (item.note)
    body.push({
      type: 'TextualBody',
      value: item.note,
      format: 'text/plain',
      purpose: 'commenting',
    });
  for (const translation of item.translations)
    body.push({
      type: 'TextualBody',
      value: translation.text,
      format: 'text/plain',
      purpose: 'supplementing',
      creator: translation.providerId ?? translation.provenance,
    });
  return {
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    id: `urn:ogleans:annotation:${id}`,
    type: 'Annotation',
    motivation: 'highlighting',
    created: item.createdAt,
    modified: item.updatedAt,
    body,
    target: {
      source: item.source.url,
      selector: [item.anchor.quote, item.anchor.position],
    },
  };
}
function itemFromInput(
  input: CreateCollectionInput,
  id: string,
  createdAt: string,
): CollectionItem {
  const text = clampText(input.text, MAX_TEXT, true);
  const originalText = input.originalText
    ? clampText(input.originalText, MAX_TEXT)
    : undefined;
  const source = {
    url: safeUrl(input.sourceUrl),
    title: clampText(input.sourceTitle, 512) || input.sourceUrl,
    ...(input.author ? { author: clampText(input.author, 256) } : {}),
    ...(input.sourceLanguage
      ? { sourceLanguage: clampText(input.sourceLanguage, 32) }
      : {}),
  };
  const anchor = normalizeAnchor(input.anchor);
  const itemTags = tags(input.tags);
  const note = input.note ? clampText(input.note, MAX_NOTE) : undefined;
  const itemTranslations = translations(input.translations).map(
    (translation) => ({
      ...translation,
      capturedAt: translation.capturedAt || createdAt,
    }),
  );
  const base = {
    schemaVersion: 1 as const,
    id,
    text,
    ...(originalText ? { originalText } : {}),
    captureKind:
      input.captureKind ??
      (originalText ? ('original' as const) : ('displayed-selection' as const)),
    translations: itemTranslations,
    source,
    anchor,
    tags: itemTags,
    ...(note ? { note } : {}),
    createdAt,
    updatedAt: createdAt,
    bookmarkExports: [] as BookmarkExport[],
  };
  return {
    ...base,
    annotation: annotationFor(id, base),
  };
}
function normalizeImported(
  value: unknown,
  fallbackNow: string,
): CollectionItem {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid collection item');
  const item = value as Partial<CollectionItem>;
  const id =
    typeof item.id === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/u.test(item.id)
      ? item.id
      : crypto.randomUUID();
  const createdAt =
    typeof item.createdAt === 'string' &&
    !Number.isNaN(Date.parse(item.createdAt))
      ? new Date(item.createdAt).toISOString()
      : fallbackNow;
  const updatedAt =
    typeof item.updatedAt === 'string' &&
    !Number.isNaN(Date.parse(item.updatedAt))
      ? new Date(item.updatedAt).toISOString()
      : createdAt;
  const text = clampText(item.text, MAX_TEXT, true);
  const source = item.source ?? { url: '', title: '' };
  const anchor = item.anchor
    ? normalizeAnchor(item.anchor)
    : fallbackAnchor(text);
  const base: CollectionItem = {
    schemaVersion: 1,
    id,
    text,
    ...(item.originalText
      ? { originalText: clampText(item.originalText, MAX_TEXT) }
      : {}),
    captureKind:
      item.captureKind === 'original' ||
      item.captureKind === 'displayed-translation' ||
      item.captureKind === 'displayed-selection'
        ? item.captureKind
        : item.originalText
          ? 'original'
          : 'displayed-selection',
    translations: Array.isArray(item.translations)
      ? translations(item.translations).map((translation) => ({
          ...translation,
          capturedAt: translation.capturedAt || createdAt,
        }))
      : [],
    source: {
      url: source.url ? safeUrl(source.url) : '',
      title: clampText(source.title, 512) || text.slice(0, 80),
      ...(source.author ? { author: clampText(source.author, 256) } : {}),
      ...(source.sourceLanguage
        ? { sourceLanguage: clampText(source.sourceLanguage, 32) }
        : {}),
    },
    anchor,
    tags: tags(item.tags),
    ...(item.note ? { note: clampText(item.note, MAX_NOTE) } : {}),
    createdAt,
    updatedAt,
    bookmarkExports: Array.isArray(item.bookmarkExports)
      ? item.bookmarkExports.slice(0, 16).map((bookmark) => ({
          exportedAt: clampText(bookmark.exportedAt, 64),
          folder: clampText(bookmark.folder, 128),
          ...(bookmark.bookmarkId
            ? { bookmarkId: clampText(bookmark.bookmarkId, 128) }
            : {}),
        }))
      : [],
    annotation: {},
  };
  base.annotation = annotationFor(id, base);
  return base;
}
export class CollectionStore {
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly maxItems: number;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly storage: CollectionStorage,
    options: CollectionStoreOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.maxItems = Math.min(MAX_ITEMS, options.maxItems ?? MAX_ITEMS);
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  private async read(): Promise<CollectionItem[]> {
    const raw = await this.storage.load();
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        try {
          return normalizeImported(item, nowIso(this.now));
        } catch {
          return undefined;
        }
      })
      .filter((item): item is CollectionItem => !!item);
  }
  async list(query: CollectionListQuery = {}): Promise<CollectionItem[]> {
    const items = await this.read();
    const terms = (query.query ?? '')
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/u)
      .filter(Boolean);
    const requestedTags = new Set(
      (query.tags ?? []).map((tag) => tag.toLocaleLowerCase()),
    );
    return items
      .filter((item) => {
        if (
          requestedTags.size &&
          !item.tags.some((tag) => requestedTags.has(tag.toLocaleLowerCase()))
        )
          return false;
        if (!terms.length) return true;
        const haystack = [
          item.text,
          item.originalText ?? '',
          item.source.title,
          item.source.url,
          item.note ?? '',
          ...item.tags,
          ...item.translations.map((translation) => translation.text),
        ]
          .join(' ')
          .toLocaleLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(
        Math.max(0, query.offset ?? 0),
        Math.max(0, query.offset ?? 0) +
          Math.max(1, Math.min(200, query.limit ?? 100)),
      );
  }
  async get(id: string): Promise<CollectionItem | undefined> {
    return (await this.read()).find((item) => item.id === id);
  }
  async create(input: CreateCollectionInput): Promise<CollectionItem> {
    return this.serialize(async () => {
      const items = await this.read();
      if (items.length >= this.maxItems)
        throw new Error('Collection limit reached');
      const createdAt = nowIso(this.now);
      const item = itemFromInput(input, this.createId(), createdAt);
      await this.storage.save([item, ...items]);
      return item;
    });
  }
  async update(
    id: string,
    patch: {
      tags?: string[];
      note?: string;
      text?: string;
      originalText?: string;
      translations?: CreateCollectionInput['translations'];
    },
  ): Promise<CollectionItem> {
    return this.serialize(async () => {
      const items = await this.read();
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) throw new Error('Collection item not found');
      const current = items[index]!;
      const updatedAt = nowIso(this.now);
      const next: CollectionItem = {
        ...current,
        ...(patch.tags !== undefined ? { tags: tags(patch.tags) } : {}),
        ...(patch.note !== undefined
          ? { note: patch.note ? clampText(patch.note, MAX_NOTE) : undefined }
          : {}),
        ...(patch.text !== undefined
          ? { text: clampText(patch.text, MAX_TEXT, true) }
          : {}),
        ...(patch.originalText !== undefined
          ? {
              originalText: patch.originalText
                ? clampText(patch.originalText, MAX_TEXT)
                : undefined,
            }
          : {}),
        ...(patch.translations !== undefined
          ? {
              translations: translations(patch.translations).map(
                (translation) => ({
                  ...translation,
                  capturedAt: translation.capturedAt || updatedAt,
                }),
              ),
            }
          : {}),
        updatedAt,
      };
      if (!next.note) delete next.note;
      if (!next.originalText) delete next.originalText;
      next.annotation = annotationFor(id, next);
      items[index] = next;
      await this.storage.save(items);
      return next;
    });
  }
  async remove(id: string): Promise<boolean> {
    return this.serialize(async () => {
      const items = await this.read();
      const next = items.filter((item) => item.id !== id);
      if (next.length === items.length) return false;
      await this.storage.save(next);
      return true;
    });
  }
  async recordBookmark(
    id: string,
    bookmark: BookmarkExport,
  ): Promise<CollectionItem> {
    return this.serialize(async () => {
      const items = await this.read();
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) throw new Error('Collection item not found');
      const next = {
        ...items[index]!,
        bookmarkExports: [
          bookmark,
          ...items[index]!.bookmarkExports.filter(
            (entry) => entry.bookmarkId !== bookmark.bookmarkId,
          ),
        ].slice(0, 16),
        updatedAt: nowIso(this.now),
      };
      items[index] = next;
      await this.storage.save(items);
      return next;
    });
  }
  async importJson(
    value: string | unknown,
    mode: 'merge' | 'replace' = 'merge',
  ): Promise<number> {
    return this.serialize(async () => {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      const payload =
        parsed &&
        typeof parsed === 'object' &&
        'items' in parsed &&
        Array.isArray((parsed as { items?: unknown }).items)
          ? (parsed as { items: unknown[] }).items
          : Array.isArray(parsed)
            ? parsed
            : undefined;
      if (!payload || payload.length > this.maxItems)
        throw new Error('Invalid or oversized collection export');
      const fallbackNow = nowIso(this.now);
      const imported = payload.map((item) =>
        normalizeImported(item, fallbackNow),
      );
      if (mode === 'replace') {
        await this.storage.save(imported);
        return imported.length;
      }
      const existing = await this.read();
      const byId = new Map(existing.map((item) => [item.id, item]));
      for (const item of imported) {
        const current = byId.get(item.id);
        if (!current || item.updatedAt >= current.updatedAt)
          byId.set(item.id, item);
      }
      const merged = [...byId.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, this.maxItems);
      await this.storage.save(merged);
      return imported.length;
    });
  }
  async exportJson(): Promise<string> {
    return JSON.stringify(
      {
        schemaVersion: 1,
        type: COLLECTION_EXPORT_TYPE,
        exportedAt: nowIso(this.now),
        items: await this.read(),
      },
      null,
      2,
    );
  }
  async exportMarkdown(): Promise<string> {
    return collectionMarkdown(await this.read());
  }
}
export function collectionMarkdown(items: CollectionItem[]): string {
  const lines = ['# Ogleans collection export', ''];
  for (const item of items) {
    lines.push(`## ${singleLine(item.text).slice(0, 100)}`, '');
    lines.push(`- Saved: ${item.createdAt}`);
    lines.push(
      `- Source: [${singleLine(item.source.title)}](${item.source.url})`,
    );
    if (item.source.author)
      lines.push(`- Author: ${singleLine(item.source.author)}`);
    if (item.tags.length) lines.push(`- Tags: ${item.tags.join(', ')}`);
    lines.push('', `> ${item.text.replaceAll('\n', '\n> ')}`, '');
    if (item.originalText && item.originalText !== item.text)
      lines.push(`**Original:** ${item.originalText}`, '');
    for (const translation of item.translations)
      lines.push(
        `**Translation${translation.providerId ? ` (${translation.providerId})` : ''}:** ${translation.text}`,
        '',
      );
    if (item.note) lines.push(`**Note:** ${item.note}`, '');
    lines.push('---', '');
  }
  return lines.join('\n');
}
function singleLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
export function bookmarksHtml(
  items: CollectionItem[],
  folder = 'Ogleans',
): string {
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    `    <DT><H3>${escapeHtml(folder)}</H3>`,
    '    <DL><p>',
  ];
  for (const item of items) {
    const title = `${singleLine(item.source.title)} — ${singleLine(item.text).slice(0, 70)}`;
    const url = textFragmentUrl(item.source.url, item.anchor);
    lines.push(
      `        <DT><A HREF="${escapeHtml(url)}" ADD_DATE="${Math.floor(Date.parse(item.createdAt) / 1000)}">${escapeHtml(title)}</A>`,
    );
  }
  lines.push('    </DL><p>', '</DL><p>');
  return lines.join('\n') + '\n';
}
export function buildTextIndex(root: ParentNode): DOMTextIndex {
  const document = root.ownerDocument ?? (root as Document);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const chunks: TextChunk[] = [];
  let text = '';
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const value = node as Text;
    const parent = value.parentElement;
    if (!parent || parent.closest(SKIP_TEXT)) continue;
    const data = value.data;
    if (!data) continue;
    const start = text.length;
    text += data;
    chunks.push({ node: value, start, end: text.length });
  }
  return { text, chunks };
}
function pointAtOffset(
  index: DOMTextIndex,
  offset: number,
): { node: Text; offset: number } | null {
  for (const chunk of index.chunks) {
    if (offset >= chunk.start && offset <= chunk.end)
      return {
        node: chunk.node,
        offset: Math.min(chunk.node.data.length, offset - chunk.start),
      };
  }
  return null;
}
function rangeOffsets(
  index: DOMTextIndex,
  range: Range,
): { start: number; end: number } | null {
  let start: number | undefined;
  let end: number | undefined;
  for (const chunk of index.chunks) {
    if (chunk.node === range.startContainer)
      start = chunk.start + range.startOffset;
    if (chunk.node === range.endContainer) end = chunk.start + range.endOffset;
  }
  return start === undefined || end === undefined ? null : { start, end };
}
function findQuoteOffsets(
  text: string,
  quote: TextQuoteSelector,
): number | undefined {
  if (!quote.exact) return undefined;
  const matches: { start: number; score: number }[] = [];
  let cursor = 0;
  while (cursor <= text.length) {
    const start = text.indexOf(quote.exact, cursor);
    if (start < 0) break;
    const end = start + quote.exact.length;
    let score = 0;
    if (quote.prefix)
      score +=
        text.slice(Math.max(0, start - quote.prefix.length), start) ===
        quote.prefix
          ? 2
          : -1;
    if (quote.suffix)
      score +=
        text.slice(end, end + quote.suffix.length) === quote.suffix ? 1 : -1;
    matches.push({ start, score });
    cursor = start + 1;
  }
  matches.sort((a, b) => b.score - a.score || a.start - b.start);
  return matches[0]?.start;
}
export function createTextAnchor(
  root: ParentNode,
  range: Range,
  exactValue = range.toString(),
): TextAnchor {
  const exact = exactValue.trim().slice(0, MAX_TEXT);
  if (!exact) throw new Error('Selection is empty');
  const index = buildTextIndex(root);
  const direct = rangeOffsets(index, range);
  let start = direct ? direct.start : undefined;
  if (
    start !== undefined &&
    index.text.slice(start, start + exact.length) !== exact
  )
    start = undefined;
  if (start === undefined)
    start = findQuoteOffsets(index.text, {
      type: 'TextQuoteSelector',
      exact,
    });
  if (start === undefined) return fallbackAnchor(exact);
  const prefix = index.text.slice(Math.max(0, start - 48), start);
  const suffix = index.text.slice(
    start + exact.length,
    start + exact.length + 48,
  );
  const anchor: TextAnchor = {
    quote: {
      type: 'TextQuoteSelector',
      exact,
      ...(prefix ? { prefix } : {}),
      ...(suffix ? { suffix } : {}),
    },
    position: {
      type: 'TextPositionSelector',
      start,
      end: start + exact.length,
    },
    textFragment: '',
    quality: 'exact',
  };
  anchor.textFragment =
    textFragmentUrl('https://placeholder.invalid/', anchor).split('#')[1] ?? '';
  return anchor;
}
export function resolveTextAnchor(
  root: ParentNode,
  anchor: TextAnchor,
): Range | null {
  const index = buildTextIndex(root);
  let start = findQuoteOffsets(index.text, anchor.quote);
  if (
    start === undefined &&
    anchor.position.start >= 0 &&
    index.text.slice(
      anchor.position.start,
      anchor.position.start + anchor.quote.exact.length,
    ) === anchor.quote.exact
  )
    start = anchor.position.start;
  if (start === undefined || start < 0) return null;
  const end = start + anchor.quote.exact.length;
  const startPoint = pointAtOffset(index, start);
  const endPoint = pointAtOffset(index, end);
  if (!startPoint || !endPoint) return null;
  const document = root.ownerDocument ?? (root as Document);
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  return range;
}
export function textFragmentUrl(sourceUrl: string, anchor: TextAnchor): string {
  const url = new URL(sourceUrl);
  const exact = anchor.quote.exact.slice(0, 300);
  const prefix = anchor.quote.prefix?.slice(-50) ?? '';
  const suffix = anchor.quote.suffix?.slice(0, 50) ?? '';
  const text = [
    prefix ? `${encodeURIComponent(prefix)}-,` : '',
    encodeURIComponent(exact),
    suffix ? `,-${encodeURIComponent(suffix)}` : '',
  ].join('');
  url.hash = `:~:text=${text}`;
  return url.href;
}
