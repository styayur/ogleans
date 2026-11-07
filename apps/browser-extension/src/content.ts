// SPDX-License-Identifier: GPL-3.0-or-later
import { OGLEANS_STYLES } from './ui-styles';
import { HtmlAdapter } from '../../../packages/dom/src/index';
import {
  createTextAnchor,
  resolveTextAnchor,
  textFragmentUrl,
  type CaptureKind,
  type CollectionItem,
  type CreateCollectionInput,
  type TextAnchor,
} from '../../../packages/collection/src/index';
import {
  GestureActionRegistry,
  GestureRecognizer,
  isEditableTarget,
  keyboardMatches,
  matchGesture,
  type GestureContext,
  type GestureMapping,
} from '../../../packages/gesture/src/index';
import {
  TranslationEngine,
  type TranslationTransport,
} from '../../../packages/translation/src/index';
import type { KernelConfig } from '../../../packages/config/src/index';
import type {
  RenderMode,
  TranslationMode,
  TranslationResult,
} from '../../../packages/shared/src/index';

declare global {
  interface Window {
    __ogleansLoaded?: boolean;
  }
}
type PublicConfig = Omit<KernelConfig, 'providers'>;
interface SelectionSnapshot {
  text: string;
  originalText?: string;
  captureKind: CaptureKind;
  sourceUrl: string;
  sourceTitle: string;
  author?: string;
  anchor: TextAnchor;
  translations: CreateCollectionInput['translations'];
  rect: DOMRect;
}
interface UICallbacks {
  onSearch(query: string, tags: string[]): Promise<void>;
  onSave(snapshot: SelectionSnapshot): Promise<void>;
  onTranslate(): Promise<void>;
  onDictionary(snapshot: SelectionSnapshot | null): Promise<void>;
  onUpdate(
    id: string,
    patch: { tags?: string[]; note?: string },
  ): Promise<void>;
  onDelete(id: string): Promise<void>;
  onExport(format: 'json' | 'markdown'): Promise<string>;
  onImport(data: string): Promise<void>;
  onBookmark(id: string): Promise<void>;
  onBookmarkHtml(id: string): Promise<string>;
  onAnchorStatus(item: CollectionItem): 'available' | 'changed' | 'other-page';
}
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function button(label: string, className = 'ghost'): HTMLButtonElement {
  const node = element('button', className, label);
  node.type = 'button';
  return node;
}
function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = element('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.documentElement.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (text === 'BOOKMARK_PERMISSION_REQUIRED')
    return 'Enable browser bookmarks in Ogleans settings first.';
  return text;
}
export class OgleansUI {
  private host = element('div');
  private shadow: ShadowRoot;
  private rail = element('div', 'rail');
  private panel = element('section', 'panel');
  private handle = button('');
  private list = element('div', 'list');
  private detail = element('div', 'detail');
  private tagBar = element('div', 'tags');
  private search = element('input');
  private toastNode = element('div', 'toast');
  private modeChip = element('span', 'chip');
  private translateButton = button('Translate');
  private items: CollectionItem[] = [];
  private current: CollectionItem | null = null;
  private snapshot: SelectionSnapshot | null = null;
  private translationMode: TranslationMode = 'built-in';
  private renderMode: RenderMode = 'bilingual';
  private selectedTags: string[] = [];
  private query = '';
  private toastTimer?: ReturnType<typeof setTimeout>;
  private returnFocus: HTMLElement | null = null;
  private showHandle = true;
  constructor(private callbacks: UICallbacks) {
    this.host.dataset.ogleansUi = '';
    this.host.style.all = 'initial';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = element('style');
    style.textContent = OGLEANS_STYLES;
    const layer = element('div', 'layer');
    this.handle.className = 'handle';
    this.handle.type = 'button';
    this.handle.dataset.ogAction = 'open-collection';
    this.handle.setAttribute('aria-label', 'Open Ogleans collection');
    this.handle.title = 'Ogleans collection';
    this.handle.addEventListener('click', () => this.openPanel(this.handle));
    this.rail.hidden = true;
    this.rail.dataset.og = 'selection-rail';
    this.rail.setAttribute('role', 'toolbar');
    this.rail.setAttribute('aria-label', 'Ogleans selection actions');
    const save = button('Save', 'save');
    save.dataset.ogAction = 'save-selection';
    save.addEventListener('click', () => {
      if (this.snapshot)
        void this.callbacks.onSave(this.snapshot).catch(this.error);
    });
    this.translateButton.dataset.ogAction = 'translate-selection';
    this.translateButton.addEventListener(
      'click',
      () => void this.callbacks.onTranslate().catch(this.error),
    );
    const dictionary = button('Dictionary');
    dictionary.dataset.ogAction = 'dictionary';
    dictionary.addEventListener(
      'click',
      () => void this.callbacks.onDictionary(this.snapshot).catch(this.error),
    );
    const collection = button('Collection');
    collection.dataset.ogAction = 'collection';
    collection.addEventListener('click', () => this.openPanel(collection));
    this.rail.append(save, this.translateButton, dictionary, collection);
    this.panel.dataset.og = 'panel';
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'false');
    this.panel.setAttribute('aria-label', 'Ogleans collection');
    const header = element('header');
    const brand = element('div', 'brand', 'Ogleans');
    const spacer = element('div', 'spacer');
    const close = button('×', 'icon');
    close.setAttribute('aria-label', 'Close Ogleans collection');
    close.addEventListener('click', () => this.closePanel());
    header.append(brand, this.modeChip, spacer, close);
    this.search.type = 'search';
    this.search.placeholder = 'Search passages, notes, tags';
    this.search.dataset.og = 'search';
    this.search.setAttribute('aria-label', 'Search collection');
    this.search.addEventListener('input', () => {
      this.query = this.search.value;
      void this.refresh();
    });
    const searchbar = element('div', 'searchbar');
    searchbar.append(this.search);
    this.list.dataset.og = 'list';
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'Saved passages');
    this.tagBar.setAttribute('aria-label', 'Collection tags');
    this.detail.hidden = true;
    const footer = element('div', 'footer');
    const exportJson = button('Export JSON');
    exportJson.dataset.ogAction = 'export-json';
    exportJson.addEventListener('click', () => void this.export('json'));
    const exportMarkdown = button('Export Markdown');
    exportMarkdown.dataset.ogAction = 'export-markdown';
    exportMarkdown.addEventListener(
      'click',
      () => void this.export('markdown'),
    );
    const importButton = button('Import');
    importButton.dataset.ogAction = 'import';
    const file = element('input');
    file.type = 'file';
    file.accept = 'application/json,.json';
    file.hidden = true;
    file.dataset.og = 'import-file';
    importButton.addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const selected = file.files?.[0];
      if (!selected) return;
      void selected
        .text()
        .then((data) => this.callbacks.onImport(data))
        .then(() => {
          file.value = '';
          this.toast('Collection imported');
          void this.refresh();
        })
        .catch(this.error);
    });
    footer.append(exportJson, exportMarkdown, importButton, file);
    this.panel.append(
      header,
      searchbar,
      this.tagBar,
      this.list,
      this.detail,
      footer,
    );
    this.toastNode.dataset.og = 'toast';
    this.toastNode.setAttribute('role', 'status');
    this.toastNode.setAttribute('aria-live', 'polite');
    layer.append(this.rail, this.handle, this.panel, this.toastNode);
    this.shadow.append(style, layer);
    document.documentElement.append(this.host);
    this.panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closePanel();
      }
    });
  }
  private async refresh(): Promise<void> {
    try {
      await this.callbacks.onSearch(this.query, this.selectedTags);
    } catch (error) {
      this.error(error);
    }
  }
  setItems(items: CollectionItem[]): void {
    this.items = items;
    if (this.current && !items.some((item) => item.id === this.current?.id)) {
      this.current = null;
      this.detail.hidden = true;
      this.list.hidden = false;
    }
    this.renderTags();
    this.renderList();
    if (this.current) this.renderDetail(this.current);
  }
  setConfig(
    translationMode: TranslationMode,
    renderMode: RenderMode,
    showHandle: boolean,
  ): void {
    this.translationMode = translationMode;
    this.renderMode = renderMode;
    this.showHandle = showHandle;
    this.modeChip.textContent =
      translationMode === 'built-in'
        ? 'Built-in'
        : translationMode === 'external'
          ? 'External'
          : 'Off';
    this.translateButton.hidden = translationMode !== 'built-in';
    this.handle.hidden = !showHandle;
  }
  setRenderMode(mode: RenderMode): void {
    this.renderMode = mode;
    this.modeChip.title = `Display: ${mode}`;
  }
  showSelection(snapshot: SelectionSnapshot): void {
    this.snapshot = snapshot;
    const rail = this.rail;
    rail.hidden = false;
    const rect = snapshot.rect;
    const margin = 10;
    rail.style.left = `${Math.max(
      margin,
      Math.min(
        window.innerWidth - rail.offsetWidth - margin,
        rect.left + rect.width / 2 - rail.offsetWidth / 2,
      ),
    )}px`;
    rail.style.top = `${Math.max(margin, rect.top - rail.offsetHeight - 8)}px`;
  }
  hideSelection(): void {
    this.snapshot = null;
    this.rail.hidden = true;
  }
  openPanel(returnFocus?: HTMLElement): void {
    this.returnFocus = returnFocus ?? (this.showHandle ? this.handle : null);
    this.panel.hidden = false;
    this.panel.setAttribute('aria-hidden', 'false');
    void this.refresh();
    setTimeout(() => {
      if (this.current)
        this.detail.querySelector<HTMLElement>('textarea')?.focus();
      else this.search.focus();
    }, 0);
  }
  closePanel(): void {
    this.panel.hidden = true;
    this.panel.setAttribute('aria-hidden', 'true');
    this.current = null;
    this.detail.hidden = true;
    this.list.hidden = false;
    this.returnFocus?.focus();
  }
  togglePanel(): void {
    if (this.panel.hidden) this.openPanel();
    else this.closePanel();
  }
  navigate(delta: number): void {
    if (!this.items.length) {
      this.toast('No saved passages yet');
      return;
    }
    if (this.panel.hidden) this.openPanel();
    const currentIndex = this.current
      ? this.items.findIndex((item) => item.id === this.current?.id)
      : -1;
    const nextIndex = Math.max(
      0,
      Math.min(this.items.length - 1, currentIndex + delta),
    );
    this.selectItem(this.items[nextIndex]!);
  }
  toast(text: string): void {
    this.toastNode.textContent = text;
    this.toastNode.classList.add('visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(
      () => this.toastNode.classList.remove('visible'),
      3200,
    );
  }
  private error = (error: unknown): void => this.toast(message(error));
  private async export(format: 'json' | 'markdown'): Promise<void> {
    try {
      const content = await this.callbacks.onExport(format);
      downloadText(
        format === 'json' ? 'ogleans-collection.json' : 'ogleans-collection.md',
        content,
        format === 'json' ? 'application/json' : 'text/markdown',
      );
      this.toast('Collection exported');
    } catch (error) {
      this.error(error);
    }
  }
  private renderTags(): void {
    const counts = new Map<string, number>();
    for (const item of this.items)
      for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    this.tagBar.replaceChildren();
    if (!counts.size) return;
    for (const [tag, count] of [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)) {
      const chip = element('button', 'tag', `${tag} ${count}`);
      chip.type = 'button';
      chip.setAttribute(
        'aria-pressed',
        String(this.selectedTags.includes(tag)),
      );
      chip.addEventListener('click', () => {
        this.selectedTags = this.selectedTags.includes(tag)
          ? this.selectedTags.filter((value) => value !== tag)
          : [...this.selectedTags, tag];
        void this.refresh();
      });
      this.tagBar.append(chip);
    }
  }
  private renderList(): void {
    this.list.replaceChildren();
    this.list.hidden = false;
    if (!this.items.length) {
      this.list.append(
        element(
          'div',
          'empty',
          this.query || this.selectedTags.length
            ? 'No passages match this search.'
            : 'Select text and save it with a gesture, keyboard shortcut, or the floating controls.',
        ),
      );
      return;
    }
    for (const item of this.items) {
      const itemButton = element('button', 'item');
      itemButton.type = 'button';
      itemButton.dataset.og = 'item';
      itemButton.dataset.id = item.id;
      itemButton.setAttribute('role', 'option');
      const quote = element('span', 'quote', item.text);
      const sourceHost = (() => {
        try {
          return new URL(item.source.url).host;
        } catch {
          return 'Saved passage';
        }
      })();
      const meta = element(
        'span',
        'meta',
        `${sourceHost} · ${new Date(item.createdAt).toLocaleDateString()}`,
      );
      itemButton.append(quote, meta);
      if (item.tags.length) {
        const tagList = element('span', 'item-tags');
        for (const tag of item.tags.slice(0, 4))
          tagList.append(element('span', '', tag));
        itemButton.append(tagList);
      }
      itemButton.addEventListener('click', () => this.selectItem(item));
      this.list.append(itemButton);
    }
  }
  private selectItem(item: CollectionItem): void {
    this.current = item;
    this.list.hidden = true;
    this.detail.hidden = false;
    this.renderDetail(item);
  }
  private renderDetail(item: CollectionItem): void {
    this.detail.replaceChildren();
    const back = button('← Collection', 'ghost back');
    back.addEventListener('click', () => {
      this.current = null;
      this.detail.hidden = true;
      this.list.hidden = false;
      this.search.focus();
    });
    this.detail.append(back);
    this.detail.append(
      element(
        'div',
        'kicker',
        item.captureKind === 'displayed-selection'
          ? 'Displayed selection'
          : item.captureKind === 'displayed-translation'
            ? 'Captured translation'
            : 'Original selection',
      ),
    );
    this.detail.append(element('blockquote', '', item.text));
    if (item.originalText && item.originalText !== item.text) {
      this.detail.append(element('div', 'kicker', 'Original text'));
      this.detail.append(element('div', 'translation', item.originalText));
    }
    for (const translation of item.translations) {
      const label = translation.providerId
        ? `Translation · ${translation.providerId}`
        : 'Translation';
      const block = element('div', 'translation', translation.text);
      block.title = translation.provenance;
      this.detail.append(element('div', 'kicker', label), block);
    }
    const sourceRow = element('div', 'detail-row');
    try {
      const link = element(
        'a',
        'source-link',
        item.source.title || item.source.url,
      );
      link.href = textFragmentUrl(item.source.url, item.anchor);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      sourceRow.append(link);
    } catch {
      sourceRow.textContent = item.source.title || item.source.url;
    }
    this.detail.append(sourceRow);
    if (item.source.author)
      this.detail.append(
        element('div', 'detail-row', `By ${item.source.author}`),
      );
    const status = this.callbacks.onAnchorStatus(item);
    if (status !== 'available')
      this.detail.append(
        element(
          'div',
          'detail-row',
          status === 'other-page'
            ? 'Saved from another page. Text Fragment navigation is included in the source link.'
            : 'The page text changed; this anchor may not restore exactly.',
        ),
      );
    const tagLabel = element('label', 'field-label', 'Tags');
    const tagInput = element('input');
    tagInput.value = item.tags.join(', ');
    tagInput.dataset.og = 'tags';
    tagLabel.append(tagInput);
    const noteLabel = element('label', 'field-label', 'Note');
    const note = element('textarea');
    note.rows = 3;
    note.value = item.note ?? '';
    note.dataset.og = 'note';
    noteLabel.append(note);
    this.detail.append(tagLabel, noteLabel);
    const actionRow = element('div', 'actions');
    const apply = button('Apply changes', 'button');
    apply.addEventListener('click', () => {
      const updatedTags = tagInput.value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
      void this.callbacks
        .onUpdate(item.id, { tags: updatedTags, note: note.value })
        .then(() => {
          this.toast('Passage updated');
          return this.refresh();
        })
        .catch(this.error);
    });
    const bookmark = button('Bookmark', 'button');
    bookmark.addEventListener(
      'click',
      () =>
        void this.callbacks
          .onBookmark(item.id)
          .then(() => this.toast('Bookmark exported'))
          .catch(this.error),
    );
    const bookmarkFile = button('HTML bookmark', 'button');
    bookmarkFile.addEventListener('click', () => {
      void this.callbacks
        .onBookmarkHtml(item.id)
        .then((html) => {
          downloadText('ogleans-bookmarks.html', html, 'text/html');
          this.toast('Bookmark file downloaded');
        })
        .catch(this.error);
    });
    const remove = button('Delete', 'button danger');
    remove.addEventListener(
      'click',
      () =>
        void this.callbacks
          .onDelete(item.id)
          .then(() => {
            this.current = null;
            this.detail.hidden = true;
            this.list.hidden = false;
            this.toast('Passage deleted');
            return this.refresh();
          })
          .catch(this.error),
    );
    actionRow.append(apply, bookmark, bookmarkFile, remove);
    this.detail.append(actionRow);
  }
  dispose(): void {
    clearTimeout(this.toastTimer);
    this.host.remove();
  }
}
if (!window.__ogleansLoaded) {
  window.__ogleansLoaded = true;
  let config: PublicConfig;
  let adapter: HtmlAdapter | undefined;
  let engine: TranslationEngine | undefined;
  let selection: SelectionSnapshot | null = null;
  let pendingGestureSelection: SelectionSnapshot | null = null;
  let renderMode: RenderMode = 'bilingual';
  let status = 'Ready';
  let lastFailure = '';
  let selectionTimer: ReturnType<typeof setTimeout> | undefined;
  let ui: OgleansUI;
  let recognizer: GestureRecognizer;
  const actions = new GestureActionRegistry();
  async function send<T>(message: unknown): Promise<T> {
    const reply = await chrome.runtime.sendMessage(message);
    if (!reply?.ok) throw new Error(reply?.error ?? 'Ogleans request failed');
    return reply.result as T;
  }
  function author(): string | undefined {
    const value = document
      .querySelector<HTMLMetaElement>(
        'meta[name="author"],meta[property="article:author"]',
      )
      ?.content?.trim();
    return value ? value.slice(0, 256) : undefined;
  }
  function selectionSnapshot(): SelectionSnapshot | null {
    const current = window.getSelection();
    if (!current || current.isCollapsed || !current.rangeCount) return null;
    const text = current.toString().trim().slice(0, 10000);
    if (!text) return null;
    const range = current.getRangeAt(0).cloneRange();
    const startElement =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    if (startElement?.closest('[data-ogleans-ui]')) return null;
    const translationNode =
      range.startContainer.parentElement?.closest<HTMLElement>(
        '[data-ogleans-translation],[data-tk-translation]',
      );
    const blockId =
      translationNode?.getAttribute('data-ogleans-block-id') ??
      translationNode?.getAttribute('data-tk-segment-id') ??
      '';
    const originalText =
      translationNode && blockId ? adapter?.sourceForAnchor(blockId) : text;
    const provider = translationNode
      ?.getAttribute('data-ogleans-provider')
      ?.split(',')[0]
      ?.trim();
    const translations =
      translationNode && config.translation.mode === 'built-in'
        ? [
            {
              text,
              provenance: 'built-in' as const,
              ...(provider ? { providerId: provider } : {}),
            },
          ]
        : undefined;
    const captureKind: CaptureKind =
      config.translation.mode === 'external'
        ? 'displayed-selection'
        : translationNode
          ? 'displayed-translation'
          : 'original';
    return {
      text,
      ...(originalText && originalText !== text ? { originalText } : {}),
      captureKind,
      sourceUrl: location.href,
      sourceTitle: document.title,
      author: author(),
      anchor: createTextAnchor(document.body, range, text),
      translations,
      rect: range.getBoundingClientRect(),
    };
  }
  function currentGestureContext(): GestureContext {
    return {
      text:
        selection?.text ??
        window.getSelection()?.toString().slice(0, 2000) ??
        '',
      title: document.title,
      url: location.href,
      translationMode: config.translation.mode,
      renderMode,
    };
  }
  async function saveSelection(snapshot = selectionSnapshot()): Promise<void> {
    if (!snapshot) {
      ui.toast('Select text first');
      return;
    }
    await send({
      kind: 'collection.create',
      input: {
        text: snapshot.text,
        ...(snapshot.originalText
          ? { originalText: snapshot.originalText }
          : {}),
        captureKind: snapshot.captureKind,
        sourceUrl: snapshot.sourceUrl,
        sourceTitle: snapshot.sourceTitle,
        ...(snapshot.author ? { author: snapshot.author } : {}),
        sourceLanguage: config.sourceLanguage,
        targetLanguage: config.targetLanguage,
        anchor: snapshot.anchor,
        ...(snapshot.translations
          ? { translations: snapshot.translations }
          : {}),
      },
    });
    ui.toast('Saved to Ogleans');
    ui.hideSelection();
  }
  function applyAnchorHighlight(item: CollectionItem): void {
    const registry = (
      globalThis as unknown as {
        CSS?: { highlights?: Map<string, unknown> };
      }
    ).CSS?.highlights;
    if (!registry) return;
    if (item.source.url !== location.href) {
      registry.delete('ogleans-current-anchor');
      return;
    }
    const range = resolveTextAnchor(document.body, item.anchor);
    const HighlightConstructor = (
      globalThis as unknown as {
        Highlight?: new (...ranges: Range[]) => unknown;
      }
    ).Highlight;
    if (range && HighlightConstructor)
      registry.set('ogleans-current-anchor', new HighlightConstructor(range));
    else registry.delete('ogleans-current-anchor');
  }
  function anchorStatus(
    item: CollectionItem,
  ): 'available' | 'changed' | 'other-page' {
    if (item.source.url !== location.href) return 'other-page';
    return resolveTextAnchor(document.body, item.anchor)
      ? 'available'
      : 'changed';
  }
  async function refresh(query = '', tags: string[] = []): Promise<void> {
    const items = await send<CollectionItem[]>({
      kind: 'collection.list',
      query: { query, tags, limit: 100 },
    });
    ui.setItems(items);
    if (items[0]) applyAnchorHighlight(items[0]);
  }
  async function translatePage(): Promise<void> {
    if (config.translation.mode !== 'built-in') {
      ui.toast(
        config.translation.mode === 'external'
          ? 'External translation mode: use your other extension, then collect selections here.'
          : 'Built-in translation is disabled. Gestures and collections remain available.',
      );
      return;
    }
    engine?.dispose();
    lastFailure = '';
    adapter = new HtmlAdapter(document, config.rules);
    const transport: TranslationTransport = {
      translate(input) {
        return new Promise<void>((resolve, reject) => {
          const port = chrome.runtime.connect({ name: 'ogleans.translation' });
          let finished = false;
          const signal = input.signal;
          const cancel = () => {
            try {
              port.postMessage({ kind: 'cancel' });
            } catch {
              // Port already closed.
            }
          };
          if (signal.aborted) {
            reject(new DOMException('Translation cancelled', 'AbortError'));
            return;
          }
          signal.addEventListener('abort', cancel, { once: true });
          port.onMessage.addListener(
            (message: {
              kind?: string;
              result?: TranslationResult;
              failure?: { segmentId: string; error: string };
              error?: string;
            }) => {
              if (message.kind === 'result' && message.result)
                input.onResult(message.result);
              if (message.kind === 'failure' && message.failure)
                input.onFailure(message.failure);
              if (message.kind === 'done') {
                finished = true;
                signal.removeEventListener('abort', cancel);
                port.disconnect();
                resolve();
              }
              if (message.kind === 'error') {
                finished = true;
                signal.removeEventListener('abort', cancel);
                port.disconnect();
                reject(new Error(message.error ?? 'Translation failed'));
              }
            },
          );
          port.onDisconnect.addListener(() => {
            if (!finished) {
              finished = true;
              signal.removeEventListener('abort', cancel);
              if (signal.aborted) resolve();
              else reject(new Error('Translation connection closed'));
            }
          });
          port.postMessage({
            kind: 'start',
            segments: input.segments,
            title: document.title,
          });
        });
      },
    };
    engine = new TranslationEngine(
      adapter,
      transport,
      {
        sourceLanguage: config.sourceLanguage,
        targetLanguage: config.targetLanguage,
        title: document.title,
        url: location.href,
        terminology: config.translation.terminology || undefined,
      },
      {
        mode: renderMode,
        placement: config.placement,
        translationMode: config.translation.mode,
        cacheScope: config.translation.strategy,
      },
    );
    engine.events.on('translation.started', ({ count }) => {
      status = `Translating ${count} segments…`;
    });
    engine.events.on('translation.completed', ({ count, failed }) => {
      status = failed
        ? `Translated ${count} · ${failed} failed${lastFailure ? ` · ${lastFailure}` : ''}`
        : `Translated ${count}`;
    });
    engine.events.on('translation.cancelled', () => {
      status = 'Translation stopped';
    });
    engine.events.on('segment.translation.failed', ({ error }) => {
      lastFailure = error;
      status = error;
    });
    await engine.translate();
  }
  function setRenderMode(mode: RenderMode): void {
    renderMode = mode;
    engine?.setMode(mode);
    ui.setRenderMode(mode);
    status = `Display: ${mode}`;
  }
  async function restore(): Promise<void> {
    engine?.restore();
    engine = undefined;
    adapter = undefined;
    status = 'Restored';
  }
  async function runAction(actionId: string): Promise<boolean> {
    return actions.run(actionId, currentGestureContext());
  }
  function registerActions(): void {
    actions.register({
      id: 'collection.save',
      title: 'Save selection',
      description: 'Capture the selected passage locally.',
      group: 'collection',
      run: () => {
        const current = selectionSnapshot();
        const target = pendingGestureSelection ?? current ?? selection;
        pendingGestureSelection = null;
        return saveSelection(target ?? undefined);
      },
    });
    actions.register({
      id: 'collection.open',
      title: 'Open collection',
      description: 'Open the floating collection surface.',
      group: 'collection',
      run: () => ui.openPanel(),
    });
    actions.register({
      id: 'collection.previous',
      title: 'Previous passage',
      description: 'Show the previous saved passage.',
      group: 'collection',
      run: () => ui.navigate(-1),
    });
    actions.register({
      id: 'collection.next',
      title: 'Next passage',
      description: 'Show the next saved passage.',
      group: 'collection',
      run: () => ui.navigate(1),
    });
    actions.register({
      id: 'translation.toggle',
      title: 'Toggle translation',
      description: 'Translate the page or stop the active built-in job.',
      group: 'translation',
      availability: 'built-in-only',
      run: async () => {
        if (engine?.status().running) {
          engine.stop();
          status = 'Translation stopped';
        } else await translatePage();
      },
    });
    actions.register({
      id: 'translation.restore',
      title: 'Restore original',
      description: 'Restore Ogleans-built-in translation output.',
      group: 'translation',
      availability: 'built-in-only',
      run: restore,
    });
    actions.register({
      id: 'translation.mode',
      title: 'Cycle display mode',
      description: 'Cycle original, bilingual and translation-only display.',
      group: 'translation',
      availability: 'built-in-only',
      run: () => {
        setRenderMode(
          renderMode === 'bilingual'
            ? 'translation'
            : renderMode === 'translation'
              ? 'original'
              : 'bilingual',
        );
      },
    });
    actions.register({
      id: 'dictionary.open',
      title: 'Open dictionary',
      description: 'Open the selected passage in the configured dictionary.',
      group: 'reading',
      run: async () => {
        if (!selection?.text) {
          ui.toast('Select text first');
          return;
        }
        await send({ kind: 'dictionary.open', text: selection.text });
      },
    });
    actions.register({
      id: 'panel.hide',
      title: 'Hide panel',
      description: 'Hide the floating collection surface.',
      group: 'reading',
      run: () => ui.closePanel(),
    });
  }
  async function activate(): Promise<void> {
    config = await send<PublicConfig>({ kind: 'config.public' });
    renderMode = config.mode;
    ui = new OgleansUI({
      onSearch: refresh,
      onSave: saveSelection,
      onTranslate: translatePage,
      onDictionary: async (snapshot) => {
        if (!snapshot?.text) {
          ui.toast('Select text first');
          return;
        }
        await send({ kind: 'dictionary.open', text: snapshot.text });
      },
      onUpdate: async (id, patch) => {
        await send({ kind: 'collection.update', id, patch });
      },
      onDelete: async (id) => {
        await send({ kind: 'collection.remove', id });
      },
      onExport: async (format) =>
        send<string>({ kind: 'collection.export', format }),
      onImport: async (data) => {
        await send({ kind: 'collection.import', data });
      },
      onBookmark: async (id) => {
        await send({ kind: 'bookmark.export', ids: [id] });
      },
      onBookmarkHtml: async (id) =>
        send<string>({ kind: 'bookmark.html', ids: [id] }),
      onAnchorStatus: anchorStatus,
    });
    ui.setConfig(
      config.translation.mode,
      renderMode,
      config.gestures.showHandle,
    );
    registerActions();
    recognizer = new GestureRecognizer(config.gestures, (recognition) => {
      const mapping: GestureMapping | undefined = matchGesture(
        recognition.sequence,
        config.gestures.mappings,
        config.translation.mode,
      );
      if (mapping)
        void runAction(mapping.action).catch((error) =>
          ui.toast(message(error)),
        );
    });
    const pointerTarget = (event: Event): HTMLElement | null =>
      event.target instanceof HTMLElement ? event.target : null;
    window.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0 && event.button !== 2) return;
        if (isEditableTarget(pointerTarget(event))) return;
        if (
          recognizer.begin({
            x: event.clientX,
            y: event.clientY,
            button: event.button,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
          })
        ) {
          selection = selectionSnapshot() ?? selection;
          pendingGestureSelection = selection;
          ui.hideSelection();
        }
      },
      true,
    );
    window.addEventListener(
      'pointermove',
      (event) => {
        recognizer.move({
          x: event.clientX,
          y: event.clientY,
          button: event.button,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        });
        if (recognizer.isCapturing()) event.preventDefault();
      },
      true,
    );
    window.addEventListener(
      'pointerup',
      (event) => {
        const recognition = recognizer.end({
          x: event.clientX,
          y: event.clientY,
          button: event.button,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        });
        if (recognition.intentional) {
          event.preventDefault();
          setTimeout(() => {
            pendingGestureSelection = null;
          }, 0);
        }
      },
      true,
    );
    window.addEventListener('pointercancel', () => recognizer.cancel(), true);
    window.addEventListener(
      'contextmenu',
      (event) => {
        if (recognizer.consumeContextMenuSuppression()) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true,
    );
    window.addEventListener(
      'keydown',
      (event) => {
        if (
          event.defaultPrevented ||
          isEditableTarget(
            event.target instanceof HTMLElement ? event.target : null,
          )
        )
          return;
        const binding = config.gestures.keyboard.find((entry) =>
          keyboardMatches(entry, event),
        );
        if (!binding) return;
        event.preventDefault();
        void runAction(binding.action).catch((error) =>
          ui.toast(message(error)),
        );
      },
      true,
    );
    const selectionChanged = () => {
      clearTimeout(selectionTimer);
      selectionTimer = setTimeout(() => {
        selection = selectionSnapshot();
        if (selection) ui.showSelection(selection);
        else ui.hideSelection();
      }, 80);
    };
    document.addEventListener('selectionchange', selectionChanged);
    window.addEventListener('scroll', () => ui.hideSelection(), {
      passive: true,
    });
    window.addEventListener('resize', () => ui.hideSelection(), {
      passive: true,
    });
  }
  const activation = activate();
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (
      sender.id !== chrome.runtime.id ||
      sender.tab ||
      message?.kind !== 'control'
    )
      return;
    void (async () => {
      await activation;
      switch (message.action) {
        case 'activate':
          break;
        case 'translate':
          await translatePage();
          break;
        case 'stop':
          engine?.stop();
          status = 'Translation stopped';
          break;
        case 'restore':
          await restore();
          break;
        case 'bilingual':
          setRenderMode(renderMode === 'bilingual' ? 'original' : 'bilingual');
          break;
        case 'mode':
          if (['original', 'translation', 'bilingual'].includes(message.mode))
            setRenderMode(message.mode as RenderMode);
          break;
        case 'collection.open':
          ui.openPanel();
          break;
        case 'collection.save':
          await saveSelection();
          break;
        case 'selection':
          return {
            text: window.getSelection()?.toString().slice(0, 2000) ?? '',
          };
        default:
          break;
      }
      return {
        status,
        mode: renderMode,
        translationMode: config.translation.mode,
        count: engine?.status().total ?? 0,
      };
    })().then(
      (result) => reply(result),
      (error) =>
        reply({
          status: message(error),
          mode: renderMode ?? 'bilingual',
          translationMode: config?.translation.mode ?? 'disabled',
          count: 0,
        }),
    );
    return true;
  });
  window.addEventListener('pagehide', () => {
    void activation.then(() => {
      engine?.dispose();
      ui?.dispose();
    });
  });
  void activation.catch((error) => {
    console.error('[Ogleans] activation failed', error);
  });
}
