// SPDX-License-Identifier: MPL-2.0
import type { DocumentAdapter } from '../../adapter-api/src/index';
import { DomRenderer, type DomAnchor } from '../../renderer/src/index';
import {
  resolveRules,
  validateSelectors,
  type SiteRule,
} from '../../rules/src/index';
import { detectLanguage, segmentText } from '../../segmenter/src/index';
import type {
  DocumentNode,
  RenderMode,
  TranslationResult,
} from '../../shared/src/index';
const BLOCK =
  'p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,dd,dt,figcaption,div,section,article,main,body';
const HARD_SKIP =
  'script,style,code,pre,textarea,input,select,svg,math,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],[data-ogleans-ui],[data-ogleans-translation],[data-tk-translation]';
export class HtmlAdapter implements DocumentAdapter {
  readonly id = 'html';
  readonly anchors = new Map<string, DomAnchor>();
  private byBlock = new WeakMap<Element, DomAnchor>();
  private counter = 0;
  private renderer = new DomRenderer(this.anchors);
  private observer?: MutationObserver;
  private timer?: ReturnType<typeof setTimeout>;
  private pending = new Set<Element>();
  private changed = false;
  private onChange?: (document: DocumentNode) => void;
  private rule;
  constructor(
    private document: Document,
    userRules: SiteRule[] = [],
  ) {
    this.rule = resolveRules(document.location?.href ?? '', userRules);
    validateSelectors(this.rule, document);
  }
  sourceForAnchor(id: string): string | undefined {
    return this.anchors.get(id)?.source;
  }
  private excluded(element: Element): boolean {
    if (
      this.rule.root.length &&
      !this.rule.root.some((selector) => element.closest(selector))
    )
      return true;
    if (element.closest(HARD_SKIP)) return true;
    if (this.rule.exclude.some((selector) => element.closest(selector)))
      return true;
    if (
      this.rule.include.length &&
      !this.rule.include.some((selector) => element.closest(selector))
    )
      return true;
    for (
      let parent: Element | null = element;
      parent;
      parent = parent.parentElement
    ) {
      const style = this.document.defaultView?.getComputedStyle(parent);
      if (style?.display === 'none' || style?.visibility === 'hidden')
        return true;
    }
    return false;
  }
  private scan(root: Element): void {
    const groups = new Map<Element, Text[]>();
    const eligibility = new WeakMap<Element, boolean>();
    const walker = this.document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current: Node | null;
    while ((current = walker.nextNode())) {
      const text = current as Text;
      const parent = text.parentElement;
      if (!parent) continue;
      let eligible = eligibility.get(parent);
      if (eligible === undefined) {
        eligible = !this.excluded(parent);
        eligibility.set(parent, eligible);
      }
      if (!eligible || !this.renderer.originalText(text).trim()) continue;
      const block = parent.closest(BLOCK) ?? parent;
      const nodes = groups.get(block) ?? [];
      nodes.push(text);
      groups.set(block, nodes);
    }
    for (const [block, nodes] of groups) {
      const source = nodes
        .map((node) => this.renderer.originalText(node))
        .join('');
      const pieces = segmentText(source);
      const previous = this.byBlock.get(block);
      if (
        previous &&
        previous.nodes.length === nodes.length &&
        previous.nodes.every((node, index) => node === nodes[index]) &&
        previous.source === source &&
        !this.renderer.missingTranslation(previous)
      )
        continue;
      if (previous) {
        this.renderer.invalidate(previous);
        this.anchors.delete(previous.id);
      }
      if (!pieces.length) {
        this.byBlock.delete(block);
        continue;
      }
      const id = `tk-${++this.counter}`;
      const anchor = {
        id,
        block,
        nodes,
        segmentIds: pieces.map((_, index) => `${id}-${index}`),
        source,
        pieces,
      };
      this.anchors.set(id, anchor);
      this.renderer.register(anchor);
      this.byBlock.set(block, anchor);
    }
    for (const [id, anchor] of this.anchors)
      if (
        !anchor.block.isConnected ||
        (root.contains(anchor.block) && !groups.has(anchor.block))
      ) {
        this.renderer.invalidate(anchor);
        this.anchors.delete(id);
        this.byBlock.delete(anchor.block);
      }
    this.renderer.prune();
  }
  private model(): DocumentNode {
    return {
      id: 'html-document',
      type: 'document',
      metadata: {
        url: this.document.location?.href,
        title: this.document.title,
      },
      children: [...this.anchors.values()].map((anchor) => ({
        id: anchor.id,
        type: 'block' as const,
        children: anchor.pieces.map((text, index) => ({
          id: anchor.segmentIds[index],
          type: 'segment' as const,
          text,
          metadata: { language: detectLanguage(text) },
        })),
      })),
    };
  }
  read(): DocumentNode {
    this.withoutObservation(() => {
      this.renderer.restore();
      for (const anchor of this.anchors.values())
        this.renderer.invalidate(anchor);
      this.anchors.clear();
      this.byBlock = new WeakMap();
      const roots = this.rule.root.length
        ? this.rule.root.flatMap((selector) => [
            ...this.document.querySelectorAll(selector),
          ])
        : [this.document.body];
      for (const root of roots) if (root) this.scan(root);
    });
    return this.model();
  }
  render(
    results: TranslationResult[],
    mode: RenderMode,
    placement: 'below' | 'inline' = 'below',
  ): void {
    this.withoutObservation(() =>
      this.renderer.render(results, mode, placement),
    );
  }
  restore(): void {
    this.withoutObservation(() => this.renderer.restore());
  }
  private withoutObservation(action: () => void): void {
    if (this.observer)
      for (const record of this.observer.takeRecords()) this.record(record);
    this.observer?.disconnect();
    try {
      action();
    } finally {
      this.connect();
      if (this.changed) this.schedule();
    }
  }
  private connect(): void {
    if (!this.observer) return;
    this.observer.observe(this.document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'hidden',
        'aria-hidden',
        'class',
        'style',
        'contenteditable',
      ],
    });
  }
  private record(record: MutationRecord): void {
    if (record.type === 'characterData')
      this.renderer.applicationChanged(record.target as Text);
    const element =
      record.target.nodeType === Node.ELEMENT_NODE
        ? (record.target as Element)
        : record.target.parentElement;
    if (
      !element ||
      element.closest('[data-ogleans-translation],[data-tk-translation]')
    )
      return;
    this.changed = true;
    const block = element.closest(BLOCK) ?? element;
    if (record.type !== 'childList' || this.byBlock.has(block)) {
      this.pending.add(block);
      return;
    }
    for (const node of record.addedNodes) {
      if (
        node.nodeType === Node.ELEMENT_NODE &&
        !(node as Element).matches(
          '[data-ogleans-translation],[data-tk-translation],[data-ogleans-ui]',
        )
      )
        this.pending.add(node as Element);
      else if (node.nodeType === Node.TEXT_NODE) this.pending.add(block);
    }
  }
  observe(onChange: (document: DocumentNode) => void): () => void {
    this.observer?.disconnect();
    this.onChange = onChange;
    this.observer = new MutationObserver((records) => {
      records.forEach((record) => this.record(record));
      if (this.changed) this.schedule();
    });
    this.connect();
    return () => {
      this.observer?.disconnect();
      this.observer = undefined;
      this.onChange = undefined;
      clearTimeout(this.timer);
      this.pending.clear();
      this.changed = false;
    };
  }
  private schedule(): void {
    if (!this.onChange) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const roots = [...this.pending].filter(
        (root) =>
          root.isConnected &&
          ![...this.pending].some(
            (other) => other !== root && other.contains(root),
          ),
      );
      this.pending.clear();
      this.changed = false;
      this.withoutObservation(() => {
        roots.forEach((root) => this.scan(root));
        for (const [id, anchor] of this.anchors)
          if (!anchor.block.isConnected) {
            this.renderer.invalidate(anchor);
            this.anchors.delete(id);
            this.byBlock.delete(anchor.block);
          }
        this.renderer.prune();
      });
      this.onChange?.(this.model());
    }, 80);
  }
  dispose(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    clearTimeout(this.timer);
    this.pending.clear();
    this.renderer.dispose();
    this.anchors.clear();
    this.byBlock = new WeakMap();
    this.onChange = undefined;
    this.changed = false;
  }
}
