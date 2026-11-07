// SPDX-License-Identifier: MPL-2.0
import type { RenderMode, TranslationResult } from '../../shared/src/index';
export interface DomAnchor {
  id: string;
  block: Element;
  nodes: Text[];
  segmentIds: string[];
  source: string;
  pieces: string[];
}
export class DomRenderer {
  private translations = new Map<string, HTMLElement>();
  private values = new Map<string, string>();
  private providers = new Map<string, string>();
  private originals = new Map<Text, string>();
  private segmentAnchors = new Map<string, DomAnchor>();
  private mode?: RenderMode;
  private placement?: 'below' | 'inline';
  constructor(private anchors: Map<string, DomAnchor>) {}
  register(anchor: DomAnchor): void {
    anchor.segmentIds.forEach((id) => this.segmentAnchors.set(id, anchor));
  }
  missingTranslation(anchor: DomAnchor): boolean {
    return (
      this.mode !== undefined &&
      this.mode !== 'original' &&
      anchor.segmentIds.every((id) => this.values.has(id)) &&
      !this.translations.get(anchor.id)?.isConnected
    );
  }
  originalText(node: Text): string {
    return node.data || this.originals.get(node) || '';
  }
  applicationChanged(node: Text): void {
    this.originals.delete(node);
  }
  render(
    results: TranslationResult[],
    mode: RenderMode,
    placement: 'below' | 'inline' = 'below',
  ): void {
    results.forEach((result) => {
      this.values.set(result.id, result.text);
      if (result.provider) this.providers.set(result.id, result.provider);
    });
    const affected =
      mode !== this.mode || placement !== this.placement
        ? this.anchors.values()
        : new Set(
            results.flatMap((result) => {
              const anchor = this.segmentAnchors.get(result.id);
              return anchor ? [anchor] : [];
            }),
          );
    this.mode = mode;
    this.placement = placement;
    for (const anchor of affected) {
      let translated = this.translations.get(anchor.id);
      const complete = anchor.segmentIds.every((id) => this.values.has(id));
      if (mode === 'original' || !complete) {
        translated?.remove();
        this.translations.delete(anchor.id);
        this.restoreNodes(anchor);
        continue;
      }
      if (!translated || !translated.isConnected) {
        translated = anchor.block.ownerDocument.createElement('span');
        translated.setAttribute('data-ogleans-translation', '');
        translated.setAttribute('data-tk-translation', '');
        translated.setAttribute('data-ogleans-segment-id', anchor.id);
        translated.setAttribute('data-tk-segment-id', anchor.id);
        translated.setAttribute('data-ogleans-block-id', anchor.id);
        translated.setAttribute('role', 'text');
        anchor.block.append(translated);
        this.translations.set(anchor.id, translated);
      }
      translated.textContent = anchor.segmentIds
        .map((id) => this.values.get(id))
        .join(' ');
      const providers = [
        ...new Set(
          anchor.segmentIds
            .map((id) => this.providers.get(id))
            .filter((value): value is string => !!value),
        ),
      ];
      if (providers.length)
        translated.setAttribute('data-ogleans-provider', providers.join(','));
      else translated.removeAttribute('data-ogleans-provider');
      translated.style.cssText = `display:${placement === 'below' ? 'block' : 'inline'};white-space:pre-wrap;line-height:inherit;color:inherit;opacity:.9;${placement === 'below' ? 'margin-block-start:.35em' : 'margin-inline-start:.5em'}`;
      if (mode === 'translation')
        for (const node of anchor.nodes) {
          if (node.data) {
            this.originals.set(node, node.data);
            node.data = '';
          }
        }
      else this.restoreNodes(anchor);
    }
  }
  private restoreNodes(anchor: DomAnchor): void {
    for (const node of anchor.nodes)
      if (this.originals.has(node)) {
        if (!node.data) node.data = this.originals.get(node)!;
        this.originals.delete(node);
      }
  }
  invalidate(anchor: DomAnchor): void {
    this.restoreNodes(anchor);
    this.translations.get(anchor.id)?.remove();
    this.translations.delete(anchor.id);
    anchor.segmentIds.forEach((id) => {
      this.values.delete(id);
      this.providers.delete(id);
      this.segmentAnchors.delete(id);
    });
  }
  prune(): void {
    const ids = new Set(
      [...this.anchors.values()].flatMap((anchor) => anchor.segmentIds),
    );
    for (const id of this.values.keys())
      if (!ids.has(id)) this.values.delete(id);
    for (const id of this.providers.keys())
      if (!ids.has(id)) this.providers.delete(id);
    for (const [id, node] of this.translations)
      if (!this.anchors.has(id) || !node.isConnected) {
        node.remove();
        this.translations.delete(id);
      }
    for (const node of this.originals.keys())
      if (!node.isConnected) this.originals.delete(node);
  }
  restore(): void {
    for (const anchor of this.anchors.values()) this.restoreNodes(anchor);
    for (const node of this.translations.values()) node.remove();
    this.translations.clear();
    this.values.clear();
    this.providers.clear();
    this.originals.clear();
    this.mode = undefined;
    this.placement = undefined;
  }
  dispose(): void {
    this.restore();
    this.segmentAnchors.clear();
  }
}
