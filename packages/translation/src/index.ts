// SPDX-License-Identifier: MPL-2.0
import type { DocumentAdapter } from '../../adapter-api/src/index';
import { EventBus } from '../../event-api/src/index';
import { TranslationCache } from '../../core/src/cache';
import {
  segmentsOf,
  type DocumentNode,
  type ExportDocument,
  type RenderMode,
  type TranslationContext,
  type TranslationMode,
  type TranslationResult,
  type TranslationSegment,
} from '../../shared/src/index';
import {
  MultiProviderScheduler,
  type ScheduleFailure,
  type ScheduleHooks,
  type ScheduleOptions,
  type ScheduledTask,
} from '../../scheduler/src/index';

export interface TranslationTransportInput {
  segments: TranslationSegment[];
  context: TranslationContext;
  signal: AbortSignal;
  onResult: (result: TranslationResult) => void;
  onFailure: (failure: { segmentId: string; error: string }) => void;
  onTask?: (task: ScheduledTask) => void;
}
export interface TranslationTransport {
  translate(input: TranslationTransportInput): Promise<void>;
}
export interface TranslationEngineOptions {
  mode?: RenderMode;
  placement?: 'below' | 'inline';
  translationMode?: TranslationMode;
  cache?: TranslationCache;
  cacheScope?: string;
}
export interface TranslationEngineStatus {
  translationMode: TranslationMode;
  mode: RenderMode;
  total: number;
  translated: number;
  failed: number;
  running: boolean;
}
export class TranslationEngine {
  readonly events = new EventBus();
  private controller?: AbortController;
  private unsubscribe?: () => void;
  private document?: DocumentNode;
  private results = new Map<string, TranslationResult>();
  private failures = new Set<string>();
  private revision = 0;
  private running = false;
  private queue: Promise<void> = Promise.resolve();
  private mode: RenderMode;
  private placement: 'below' | 'inline';
  private translationMode: TranslationMode;
  private cache: TranslationCache;
  private cacheScope: string;
  constructor(
    readonly adapter: DocumentAdapter,
    private transport: TranslationTransport,
    private context: TranslationContext,
    options: TranslationEngineOptions = {},
  ) {
    this.mode = options.mode ?? 'bilingual';
    this.placement = options.placement ?? 'below';
    this.translationMode = options.translationMode ?? 'built-in';
    this.cache = options.cache ?? new TranslationCache();
    this.cacheScope = options.cacheScope ?? 'default';
  }
  getSegments() {
    return this.document
      ? segmentsOf(this.document).map((segment) => ({
          ...segment,
          translation: this.results.get(segment.id)?.text,
          provider: this.results.get(segment.id)?.provider,
          failed: this.failures.has(segment.id),
        }))
      : [];
  }
  status(): TranslationEngineStatus {
    const segments = this.document ? segmentsOf(this.document) : [];
    return {
      translationMode: this.translationMode,
      mode: this.mode,
      total: segments.length,
      translated: segments.filter((segment) => this.results.has(segment.id))
        .length,
      failed: segments.filter((segment) => this.failures.has(segment.id))
        .length,
      running: this.running,
    };
  }
  exportDocument(): ExportDocument {
    return {
      url: this.context.url ?? '',
      title: this.context.title ?? '',
      sourceLanguage: this.context.sourceLanguage ?? 'auto',
      targetLanguage: this.context.targetLanguage,
      segments: this.getSegments().map((segment) => ({
        id: segment.id,
        source: segment.text,
        translation: segment.translation,
      })),
    };
  }
  async translate(): Promise<void> {
    if (this.translationMode !== 'built-in') {
      this.running = false;
      return;
    }
    this.stop();
    const controller = new AbortController();
    this.controller = controller;
    const revision = ++this.revision;
    const document = this.adapter.read();
    this.events.emit('document.detected', document);
    this.unsubscribe = this.adapter.observe?.((next) => {
      this.events.emit('document.changed', next);
      this.queue = this.queue
        .catch(() => {})
        .then(() => this.execute(next, controller, revision))
        .catch(() => {});
    });
    const initial = this.execute(document, controller, revision);
    this.queue = initial.catch(() => {});
    await initial;
  }
  private cacheKey(segment: TranslationSegment): string {
    return JSON.stringify([
      this.cacheScope,
      this.context.sourceLanguage ?? 'auto',
      this.context.targetLanguage,
      this.context.terminology ?? '',
      segment.text,
    ]);
  }
  private remember(
    result: TranslationResult,
    segment: TranslationSegment,
  ): void {
    this.results.set(result.id, result);
    this.failures.delete(result.id);
    this.cache.set(
      this.cacheKey(segment),
      JSON.stringify({ text: result.text, provider: result.provider }),
    );
  }
  private async execute(
    document: DocumentNode,
    controller: AbortController,
    revision: number,
  ): Promise<void> {
    if (controller.signal.aborted || revision !== this.revision) return;
    this.document = document;
    const segments = segmentsOf(document);
    const current = new Set(segments.map((segment) => segment.id));
    for (const id of this.results.keys())
      if (!current.has(id)) this.results.delete(id);
    for (const id of this.failures)
      if (!current.has(id)) this.failures.delete(id);
    const missing = segments.filter((segment) => !this.results.has(segment.id));
    if (!missing.length) return;
    const network: TranslationSegment[] = [];
    let translated = 0;
    for (const segment of missing) {
      this.events.emit('segment.detected', segment);
      this.events.emit('segment.translation.started', segment);
      const cacheKey = this.cacheKey(segment);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        try {
          const value = JSON.parse(cached) as {
            text?: unknown;
            provider?: unknown;
          };
          if (typeof value.text === 'string' && value.text.trim()) {
            const result: TranslationResult = {
              id: segment.id,
              text: value.text,
              ...(typeof value.provider === 'string'
                ? { provider: value.provider }
                : { provider: 'cache' }),
            };
            this.results.set(result.id, result);
            this.failures.delete(result.id);
            translated++;
            this.events.emit('segment.translated', result);
            this.adapter.render([result], this.mode, this.placement);
            continue;
          }
        } catch {
          this.cache.clear();
        }
      }
      network.push(segment);
    }
    if (!network.length) {
      this.events.emit('translation.completed', {
        count: translated,
        failed: 0,
        total: missing.length,
      });
      return;
    }
    this.running = true;
    this.failures.clear();
    this.events.emit('translation.started', { count: network.length });
    let failed = 0;
    try {
      await this.transport.translate({
        segments: network,
        context: this.context,
        signal: controller.signal,
        onTask: () => {},
        onResult: (result) => {
          if (!network.some((segment) => segment.id === result.id)) return;
          if (controller.signal.aborted || revision !== this.revision) return;
          this.remember(
            result,
            network.find((segment) => segment.id === result.id)!,
          );
          translated++;
          this.events.emit('segment.translated', result);
          this.adapter.render([result], this.mode, this.placement);
        },
        onFailure: (failure) => {
          if (controller.signal.aborted || revision !== this.revision) return;
          this.failures.add(failure.segmentId);
          this.events.emit('segment.translation.failed', {
            id: failure.segmentId,
            error: failure.error,
          });
        },
      });
      failed = network.filter(
        (segment) => !this.results.has(segment.id),
      ).length;
    } catch (error) {
      if (controller.signal.aborted) return;

      failed = network.length - translated;
      for (const segment of network)
        if (!this.results.has(segment.id))
          this.events.emit('segment.translation.failed', {
            id: segment.id,
            error:
              error instanceof Error ? error.message : 'Translation failed',
          });
    } finally {
      this.running = false;
      if (controller.signal.aborted)
        this.events.emit('translation.cancelled', { count: translated });
      else
        this.events.emit('translation.completed', {
          count: translated,
          failed,
          total: missing.length,
        });
    }
  }
  setMode(mode: RenderMode): void {
    this.mode = mode;
    this.adapter.render([...this.results.values()], mode, this.placement);
  }
  setTranslationMode(mode: TranslationMode): void {
    if (mode === this.translationMode) return;
    this.translationMode = mode;
    this.stop();
    if (mode !== 'built-in') {
      this.adapter.restore();
      this.results.clear();
      this.failures.clear();
    }
  }
  stop(): void {
    this.controller?.abort();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.running = false;
  }
  restore(): void {
    this.stop();
    this.revision++;
    this.adapter.restore();
    this.results.clear();
    this.failures.clear();
    this.document = undefined;
  }
  dispose(): void {
    this.restore();
    this.cache.clear();
    this.events.clear();
    this.adapter.dispose?.();
  }
}

export function createSchedulerTransport(
  scheduler: MultiProviderScheduler,
  options: ScheduleOptions,
  hooks: ScheduleHooks = {},
): TranslationTransport {
  return {
    async translate(input) {
      const summary = await scheduler.schedule(
        input.segments,
        input.context,
        options,
        {
          ...hooks,
          onTask: (task) => {
            hooks.onTask?.(task);
            input.onTask?.(task);
          },
          onResult: (result, task) => {
            hooks.onResult?.(result, task);
            input.onResult(result);
          },
          onFailure: (failure: ScheduleFailure, task) => {
            hooks.onFailure?.(failure, task);
            input.onFailure(failure);
          },
        },
        input.signal,
      );
      if (summary.cancelled) return;
    },
  };
}
