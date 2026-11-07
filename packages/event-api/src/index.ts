// SPDX-License-Identifier: MPL-2.0
import type {
  DocumentNode,
  TranslationSegment,
  TranslationResult,
} from '../../shared/src/index';
import type { SelectionContext } from '../../action-api/src/index';
export interface KernelEvents {
  'document.detected': DocumentNode;
  'document.changed': DocumentNode;
  'segment.detected': TranslationSegment;
  'segment.translation.started': TranslationSegment;
  'segment.translated': TranslationResult;
  'segment.translation.failed': { id: string; error: string };
  'selection.changed': SelectionContext;
  'translation.started': { count: number };
  'translation.completed': { count: number; failed?: number; total?: number };
  'translation.cancelled': { count: number };
}
export class EventBus {
  private listeners = new Map<
    keyof KernelEvents,
    Set<(value: never) => void>
  >();
  constructor(private onListenerError: (error: unknown) => void = () => {}) {}
  on<K extends keyof KernelEvents>(
    event: K,
    handler: (value: KernelEvents[K]) => void,
  ): () => void {
    const handlers = this.listeners.get(event) ?? new Set();
    handlers.add(handler as (value: never) => void);
    this.listeners.set(event, handlers);
    return () => {
      handlers.delete(handler as (value: never) => void);
      if (!handlers.size) this.listeners.delete(event);
    };
  }
  emit<K extends keyof KernelEvents>(event: K, value: KernelEvents[K]): void {
    for (const handler of [...(this.listeners.get(event) ?? [])]) {
      try {
        handler(structuredClone(value) as never);
      } catch (error) {
        this.onListenerError(error);
      }
    }
  }
  clear(): void {
    this.listeners.clear();
  }
}
