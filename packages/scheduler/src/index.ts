// SPDX-License-Identifier: MPL-2.0
import {
  abortError,
  boundedContext,
  type ProviderPolicy,
  type TranslationContext,
  type TranslationResult,
  type TranslationSegment,
  type TranslationStrategy,
} from '../../shared/src/index';
import {
  validateResults,
  type TranslationProvider,
} from '../../provider-api/src/index';

export const SCHEDULER_API_VERSION = 1 as const;
export type TaskState =
  | 'queued'
  | 'running'
  | 'retrying'
  | 'fallback'
  | 'succeeded'
  | 'failed'
  | 'cancelled';
export interface ScheduledTask {
  segmentId: string;
  index: number;
  providerId: string;
  state: TaskState;
  attempt: number;
  result?: TranslationResult;
  error?: string;
}
export interface ScheduleFailure {
  segmentId: string;
  providerId?: string;
  error: string;
}
export interface ScheduleSummary {
  tasks: ScheduledTask[];
  results: TranslationResult[];
  failures: ScheduleFailure[];
  cancelled: boolean;
  durationMs: number;
}
export interface ScheduleOptions {
  strategy: TranslationStrategy;
  globalConcurrency?: number;
  retries?: number;
  timeoutMs?: number;
  primary?: string;
  fallback?: string;
  fallbackProviderIds?: string[];
  fallbackEnabled?: boolean;
  manualAssignments?: Record<string, string>;
}
export interface ScheduleHooks {
  onTask?: (task: ScheduledTask) => void;
  onResult?: (result: TranslationResult, task: ScheduledTask) => void;
  onFailure?: (failure: ScheduleFailure, task: ScheduledTask) => void;
}
interface Registration {
  provider: TranslationProvider;
  policy: ProviderPolicy;
}
interface InternalTask {
  segment: TranslationSegment;
  index: number;
  chain: string[];
  chainIndex: number;
  attempt: number;
  public: ScheduledTask;
}
interface QueueEntry {
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

class Semaphore {
  private active = 0;
  private queue: QueueEntry[] = [];
  constructor(private readonly capacity: number) {}
  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.active < this.capacity) {
      this.active++;
      return Promise.resolve(this.release.bind(this));
    }
    return new Promise((resolve, reject) => {
      const entry: QueueEntry = { resolve, reject, signal };
      if (signal) {
        entry.onAbort = () => {
          this.queue = this.queue.filter((item) => item !== entry);
          reject(abortError());
        };
        signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      this.queue.push(entry);
    });
  }
  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (!next) return;
    if (next.signal && next.onAbort)
      next.signal.removeEventListener('abort', next.onAbort);
    this.active++;
    next.resolve(this.release.bind(this));
  }
}

interface RateEntry {
  resolve: () => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

class WindowRateLimiter {
  private timestamps: number[] = [];
  private queue: RateEntry[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    requests: number,
    private readonly windowMs: number,
  ) {
    this.requests = Math.max(1, Math.floor(requests));
  }
  private readonly requests: number;
  acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const entry: RateEntry = { resolve, reject, signal };
      if (signal) {
        entry.onAbort = () => {
          this.queue = this.queue.filter((item) => item !== entry);
          reject(abortError());
        };
        signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      this.queue.push(entry);
      this.drain();
    });
  }
  private drain(): void {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(
      (time) => time + this.windowMs > now,
    );
    while (this.queue.length && this.timestamps.length < this.requests) {
      const next = this.queue.shift()!;
      if (next.signal && next.onAbort)
        next.signal.removeEventListener('abort', next.onAbort);
      this.timestamps.push(now);
      next.resolve();
    }
    clearTimeout(this.timer);
    if (this.queue.length) {
      const oldest = this.timestamps[0] ?? now;
      this.timer = setTimeout(
        () => this.drain(),
        Math.max(1, oldest + this.windowMs - now),
      );
    }
  }
}

class WeightedPicker {
  private current = new Map<string, number>();
  pick(candidates: Registration[]): Registration {
    const total = candidates.reduce(
      (sum, item) => sum + (item.policy.weight ?? 1),
      0,
    );
    for (const item of candidates)
      this.current.set(
        item.provider.id,
        (this.current.get(item.provider.id) ?? 0) + (item.policy.weight ?? 1),
      );
    const chosen = [...candidates].sort(
      (a, b) =>
        (this.current.get(b.provider.id) ?? 0) -
          (this.current.get(a.provider.id) ?? 0) ||
        a.provider.id.localeCompare(b.provider.id),
    )[0]!;
    this.current.set(
      chosen.provider.id,
      (this.current.get(chosen.provider.id) ?? 0) - total,
    );
    return chosen;
  }
}

function languageMatches(
  policy: ProviderPolicy,
  context: TranslationContext,
): boolean {
  const configured = policy.languages?.filter(Boolean);
  if (!configured?.length) return true;
  const source = (context.sourceLanguage ?? 'auto').toLowerCase();
  const target = context.targetLanguage.toLowerCase();
  return configured.some((entry) => {
    const value = entry.trim().toLowerCase();
    if (value === '*') return true;
    if (value.includes('->')) {
      const [from, to] = value.split('->', 2);
      return (from === source || from === '*') && (to === target || to === '*');
    }
    return value === source || value === target;
  });
}

function providerChain(
  assigned: Registration,
  registrations: Registration[],
  options: ScheduleOptions,
): string[] {
  const chain = [assigned.provider.id];
  if (options.fallbackEnabled === false) return chain;
  const explicit = [
    ...(options.fallbackProviderIds ?? []),
    ...(options.fallback ? [options.fallback] : []),
    ...registrations
      .filter((item) => item.policy.fallback)
      .map((item) => item.provider.id),
  ];
  for (const id of explicit)
    if (
      registrations.some((item) => item.provider.id === id) &&
      !chain.includes(id)
    )
      chain.push(id);
  return chain;
}

function chooseProvider(
  index: number,
  segment: TranslationSegment,
  registrations: Registration[],
  context: TranslationContext,
  options: ScheduleOptions,
  roundRobin: { cursor: number },
  weighted: WeightedPicker,
): Registration {
  if (options.strategy === 'manual') {
    const id =
      options.manualAssignments?.[segment.id] ??
      options.manualAssignments?.[String(index)];
    const manual = registrations.find((item) => item.provider.id === id);
    if (manual) return manual;
  }
  if (options.strategy === 'primary-fallback') {
    return (
      registrations.find((item) => item.provider.id === options.primary) ??
      registrations[0]!
    );
  }
  if (options.strategy === 'language-aware') {
    const eligible = registrations.filter((item) =>
      languageMatches(item.policy, {
        ...context,
        sourceLanguage: segment.sourceLanguage ?? context.sourceLanguage,
      }),
    );
    if (eligible.length) return weighted.pick(eligible);
  }
  if (options.strategy === 'weighted') return weighted.pick(registrations);
  return registrations[roundRobin.cursor++ % registrations.length]!;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError')
    return false;
  const status =
    error && typeof error === 'object' && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  if (status && [408, 425, 429].includes(status)) return true;
  if (status && status >= 500 && status <= 599) return true;
  const message = error instanceof Error ? error.message : String(error);
  if (
    /timeout|network|fetch|failed to fetch|HTTP (?:408|425|429|5\d\d)/iu.test(
      message,
    )
  )
    return true;
  if (/invalid|incomplete|no text|unsupported/iu.test(message)) return false;
  return true;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(signal.reason instanceof Error ? signal.reason : abortError());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

export class MultiProviderScheduler {
  private registrations = new Map<string, Registration>();
  register(
    provider: TranslationProvider,
    policy: ProviderPolicy = { id: provider.id },
  ): () => void {
    if (this.registrations.has(provider.id))
      throw new Error('Provider already registered');
    this.registrations.set(provider.id, {
      provider,
      policy: { ...policy, id: provider.id },
    });
    return () => this.registrations.delete(provider.id);
  }
  listProviders(): ProviderPolicy[] {
    return [...this.registrations.values()].map((item) => ({ ...item.policy }));
  }
  async schedule(
    segments: TranslationSegment[],
    context: TranslationContext,
    options: ScheduleOptions,
    hooks: ScheduleHooks = {},
    signal?: AbortSignal,
  ): Promise<ScheduleSummary> {
    const started = Date.now();
    if (!segments.length)
      return {
        tasks: [],
        results: [],
        failures: [],
        cancelled: false,
        durationMs: 0,
      };
    if (new Set(segments.map((segment) => segment.id)).size !== segments.length)
      throw new Error('Duplicate segment ID');
    const registrations = [...this.registrations.values()].filter(
      (item) => item.policy.enabled !== false,
    );
    if (!registrations.length)
      throw new Error('No enabled provider configured');
    const global = new Semaphore(
      Math.max(1, Math.min(16, options.globalConcurrency ?? 4)),
    );
    const queues = new Map<string, InternalTask[]>();
    const running = new Map<string, number>();
    const limiters = new Map<string, WindowRateLimiter>();
    for (const item of registrations) {
      queues.set(item.provider.id, []);
      running.set(item.provider.id, 0);
      if (item.policy.rateLimit)
        limiters.set(
          item.provider.id,
          new WindowRateLimiter(
            item.policy.rateLimit.requests,
            item.policy.rateLimit.windowMs,
          ),
        );
    }
    const roundRobin = { cursor: 0 };
    const weighted = new WeightedPicker();
    const tasks: InternalTask[] = segments.map((segment, index) => {
      const effectiveContext = boundedContext({
        ...context,
        sourceLanguage: segment.sourceLanguage ?? context.sourceLanguage,
      });
      const assigned = chooseProvider(
        index,
        segment,
        registrations,
        effectiveContext,
        options,
        roundRobin,
        weighted,
      );
      const chain = providerChain(assigned, registrations, options);
      const publicTask: ScheduledTask = {
        segmentId: segment.id,
        index,
        providerId: assigned.provider.id,
        state: 'queued',
        attempt: 0,
      };
      return {
        segment,
        index,
        chain,
        chainIndex: 0,
        attempt: 0,
        public: publicTask,
      };
    });
    let settled = 0;
    let cancelled = false;
    let resolveFinished!: () => void;
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    const finalize = (task: InternalTask, state: TaskState, error?: string) => {
      if (['succeeded', 'failed', 'cancelled'].includes(task.public.state))
        return;
      task.public.state = state;
      if (error) task.public.error = error;
      settled++;
      hooks.onTask?.(structuredClone(task.public));
      if (error && state === 'failed')
        hooks.onFailure?.(
          {
            segmentId: task.segment.id,
            providerId: task.public.providerId,
            error,
          },
          structuredClone(task.public),
        );
      if (task.public.result)
        hooks.onResult?.(
          structuredClone(task.public.result),
          structuredClone(task.public),
        );
      if (settled === tasks.length) resolveFinished();
    };
    const enqueue = (task: InternalTask) => {
      task.public.providerId = task.chain[task.chainIndex]!;
      task.public.state = task.chainIndex > 0 ? 'fallback' : 'queued';
      queues.get(task.public.providerId)?.push(task);
      hooks.onTask?.(structuredClone(task.public));
      pump(task.public.providerId);
      if (signal?.aborted) cancelAll();
    };
    const cancelAll = () => {
      if (cancelled) return;
      cancelled = true;
      for (const task of tasks)
        if (!['succeeded', 'failed', 'cancelled'].includes(task.public.state))
          finalize(task, 'cancelled', 'Translation cancelled');
    };
    const onAbort = () => cancelAll();
    signal?.addEventListener('abort', onAbort, { once: true });
    const runAttempt = async (
      task: InternalTask,
      registration: Registration,
    ) => {
      const releaseGlobal = await global.acquire(signal);
      try {
        await limiters.get(registration.provider.id)?.acquire(signal);
        if (signal?.aborted) throw abortError();
        const controller = new AbortController();
        const cancel = () => controller.abort();
        signal?.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(
          () => controller.abort(new Error('Provider timeout')),
          Math.max(100, options.timeoutMs ?? 20000),
        );
        try {
          task.public.state = task.attempt > 0 ? 'retrying' : 'running';
          task.public.attempt = task.attempt + 1;
          hooks.onTask?.(structuredClone(task.public));
          const results = await abortable(
            registration.provider.translate(
              [task.segment],
              {
                ...boundedContext({
                  ...context,
                  sourceLanguage:
                    task.segment.sourceLanguage ?? context.sourceLanguage,
                }),
                terminology: context.terminology?.slice(0, 4000),
              },
              { signal: controller.signal },
            ),
            controller.signal,
          );
          validateResults([task.segment], results);
          const result = { ...results[0]!, provider: registration.provider.id };
          delete task.public.error;
          task.public.result = result;
          finalize(task, 'succeeded');
        } catch (error) {
          if (signal?.aborted) {
            finalize(task, 'cancelled', 'Translation cancelled');
            return;
          }
          const message =
            error instanceof Error ? error.message : 'Provider failed';
          if (
            task.attempt < Math.max(0, Math.min(3, options.retries ?? 1)) &&
            isRetryable(error)
          ) {
            task.attempt++;
            task.public.state = 'retrying';
            task.public.error = message;
            hooks.onTask?.(structuredClone(task.public));
            queues.get(registration.provider.id)?.push(task);
            pump(registration.provider.id);
            return;
          }
          task.attempt = 0;
          if (
            options.fallbackEnabled !== false &&
            task.chainIndex + 1 < task.chain.length
          ) {
            task.chainIndex++;
            task.public.error = message;
            task.public.state = 'fallback';
            hooks.onTask?.(structuredClone(task.public));
            queues.get(task.chain[task.chainIndex]!)?.push(task);
            pump(task.chain[task.chainIndex]!);
            return;
          }
          finalize(task, 'failed', message);
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
          controller.abort();
        }
      } finally {
        releaseGlobal();
      }
    };
    function pump(providerId: string): void {
      const registration = registrations.find(
        (item) => item.provider.id === providerId,
      );
      if (!registration) return;
      const queue = queues.get(providerId)!;
      const concurrency = Math.max(
        1,
        Math.min(8, registration.policy.concurrency ?? 1),
      );
      while ((running.get(providerId) ?? 0) < concurrency && queue.length) {
        if (signal?.aborted) {
          cancelAll();
          return;
        }
        const task = queue.shift()!;
        running.set(providerId, (running.get(providerId) ?? 0) + 1);
        void runAttempt(task, registration).finally(() => {
          running.set(
            providerId,
            Math.max(0, (running.get(providerId) ?? 1) - 1),
          );
          pump(providerId);
        });
      }
    }
    for (const task of tasks) enqueue(task);
    if (signal?.aborted) cancelAll();
    await finished;
    signal?.removeEventListener('abort', onAbort);
    const ordered = tasks
      .map((task) => structuredClone(task.public))
      .sort((a, b) => a.index - b.index);
    return {
      tasks: ordered,
      results: ordered
        .filter((task) => task.result)
        .map((task) => task.result!),
      failures: ordered
        .filter((task) => task.state === 'failed')
        .map((task) => ({
          segmentId: task.segmentId,
          providerId: task.providerId,
          error: task.error ?? 'Provider failed',
        })),
      cancelled,
      durationMs: Date.now() - started,
    };
  }
}

export async function scheduleTranslations(
  scheduler: MultiProviderScheduler,
  segments: TranslationSegment[],
  context: TranslationContext,
  options: ScheduleOptions,
  hooks?: ScheduleHooks,
  signal?: AbortSignal,
): Promise<ScheduleSummary> {
  return scheduler.schedule(segments, context, options, hooks, signal);
}
