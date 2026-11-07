// SPDX-License-Identifier: MPL-2.0
import { describe, it, expect } from 'vitest';
import { MultiProviderScheduler } from '../../packages/scheduler/src/index';
import type { TranslationProvider } from '../../packages/provider-api/src/index';
import type { TranslationSegment } from '../../packages/shared/src/index';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function provider(
  id: string,
  run: TranslationProvider['translate'],
): TranslationProvider {
  return { id, name: id, translate: run };
}
function segments(count: number): TranslationSegment[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `s${index + 1}`,
    text: `Segment ${index + 1}`,
  }));
}
const options = {
  strategy: 'round-robin' as const,
  globalConcurrency: 4,
  retries: 0,
  timeoutMs: 500,
};

describe('multi-provider scheduling', () => {
  it('distributes round-robin work and restores source order regardless of completion order', async () => {
    const calls: string[] = [];
    const scheduler = new MultiProviderScheduler();
    scheduler.register(
      provider('a', async (batch) => {
        calls.push(...batch.map((item) => `a:${item.id}`));
        await delay(35);
        return batch.map((item) => ({ id: item.id, text: `A ${item.id}` }));
      }),
      { id: 'a', concurrency: 2 },
    );
    scheduler.register(
      provider('b', async (batch) => {
        calls.push(...batch.map((item) => `b:${item.id}`));
        await delay(5);
        return batch.map((item) => ({ id: item.id, text: `B ${item.id}` }));
      }),
      { id: 'b', concurrency: 2 },
    );
    const summary = await scheduler.schedule(
      segments(4),
      { targetLanguage: 'zh' },
      options,
    );
    expect(summary.failures).toEqual([]);
    expect(summary.results.map((result) => result.id)).toEqual([
      's1',
      's2',
      's3',
      's4',
    ]);
    expect(summary.tasks.map((task) => task.providerId)).toEqual([
      'a',
      'b',
      'a',
      'b',
    ]);
    expect(calls.sort()).toEqual(['a:s1', 'a:s3', 'b:s2', 'b:s4']);
  });
  it('supports weighted, manual and language-aware distribution', async () => {
    const make = (id: string) => {
      const scheduler = new MultiProviderScheduler();
      scheduler.register(
        provider(id, async (batch) =>
          batch.map((item) => ({ id: item.id, text: id })),
        ),
        { id },
      );
      return scheduler;
    };
    const weighted = new MultiProviderScheduler();
    for (const id of ['a', 'b'])
      weighted.register(
        provider(id, async (batch) =>
          batch.map((item) => ({ id: item.id, text: id })),
        ),
        { id, weight: id === 'a' ? 3 : 1 },
      );
    const weightedSummary = await weighted.schedule(
      segments(8),
      { targetLanguage: 'zh' },
      { ...options, strategy: 'weighted' },
    );
    expect(
      weightedSummary.results.filter((result) => result.provider === 'a'),
    ).toHaveLength(6);
    expect(
      weightedSummary.results.filter((result) => result.provider === 'b'),
    ).toHaveLength(2);

    const manual = new MultiProviderScheduler();
    manual.register(
      provider('a', async (batch) =>
        batch.map((item) => ({ id: item.id, text: 'a' })),
      ),
      { id: 'a' },
    );
    manual.register(
      provider('b', async (batch) =>
        batch.map((item) => ({ id: item.id, text: 'b' })),
      ),
      { id: 'b' },
    );
    const manualSummary = await manual.schedule(
      segments(3),
      { targetLanguage: 'zh' },
      {
        ...options,
        strategy: 'manual',
        manualAssignments: { s1: 'b', s2: 'a', s3: 'b' },
      },
    );
    expect(manualSummary.tasks.map((task) => task.providerId)).toEqual([
      'b',
      'a',
      'b',
    ]);

    const language = new MultiProviderScheduler();
    language.register(
      provider('en', async (batch) =>
        batch.map((item) => ({ id: item.id, text: 'en' })),
      ),
      { id: 'en', languages: ['en->zh'] },
    );
    language.register(
      provider('ja', async (batch) =>
        batch.map((item) => ({ id: item.id, text: 'ja' })),
      ),
      { id: 'ja', languages: ['ja->zh'] },
    );
    const languageSummary = await language.schedule(
      segments(3),
      { sourceLanguage: 'en', targetLanguage: 'zh' },
      { ...options, strategy: 'language-aware' },
    );
    expect(
      languageSummary.tasks.every((task) => task.providerId === 'en'),
    ).toBe(true);
    expect(make('unused')).toBeTruthy();
  });
  it('enforces provider and global concurrency bounds', async () => {
    const scheduler = new MultiProviderScheduler();
    let globalActive = 0;
    let globalMax = 0;
    let providerActive = 0;
    let providerMax = 0;
    scheduler.register(
      provider('a', async (batch) => {
        globalActive++;
        providerActive++;
        globalMax = Math.max(globalMax, globalActive);
        providerMax = Math.max(providerMax, providerActive);
        await delay(30);
        globalActive--;
        providerActive--;
        return batch.map((item) => ({ id: item.id, text: 'a' }));
      }),
      { id: 'a', concurrency: 1 },
    );
    scheduler.register(
      provider('b', async (batch) => {
        globalActive++;
        globalMax = Math.max(globalMax, globalActive);
        await delay(30);
        globalActive--;
        return batch.map((item) => ({ id: item.id, text: 'b' }));
      }),
      { id: 'b', concurrency: 2 },
    );
    await scheduler.schedule(
      segments(6),
      { targetLanguage: 'zh' },
      {
        ...options,
        strategy: 'primary-fallback',
        globalConcurrency: 2,
        primary: 'a',
        fallback: 'b',
      },
    );
    expect(globalMax).toBeLessThanOrEqual(2);
    expect(providerMax).toBe(1);
  });
  it('enforces provider rate windows', async () => {
    const timestamps: number[] = [];
    const scheduler = new MultiProviderScheduler();
    scheduler.register(
      provider('a', async (batch) => {
        timestamps.push(Date.now());
        return batch.map((item) => ({ id: item.id, text: 'a' }));
      }),
      {
        id: 'a',
        concurrency: 4,
        rateLimit: { requests: 2, windowMs: 90 },
      },
    );
    await scheduler.schedule(
      segments(5),
      { targetLanguage: 'zh' },
      {
        ...options,
        strategy: 'primary-fallback',
        primary: 'a',
      },
    );
    expect(timestamps).toHaveLength(5);
    for (let start = 0; start < timestamps.length; start++)
      expect(
        timestamps.filter(
          (time) =>
            time >= timestamps[start]! && time < timestamps[start]! + 90,
        ).length,
      ).toBeLessThanOrEqual(2);
  });
  it('isolates provider failures and preserves successful partial results', async () => {
    const scheduler = new MultiProviderScheduler();
    scheduler.register(
      provider('a', async (batch) => {
        if (batch[0]?.id === 's2') throw new Error('Invalid provider result');
        return batch.map((item) => ({ id: item.id, text: `A ${item.id}` }));
      }),
      { id: 'a', concurrency: 2 },
    );
    scheduler.register(
      provider('b', async (batch) =>
        batch.map((item) => ({ id: item.id, text: `B ${item.id}` })),
      ),
      { id: 'b', concurrency: 2 },
    );
    const summary = await scheduler.schedule(
      segments(4),
      { targetLanguage: 'zh' },
      { ...options, strategy: 'primary-fallback', primary: 'a' },
    );
    expect(summary.results).toHaveLength(3);
    expect(summary.failures).toEqual([
      { segmentId: 's2', providerId: 'a', error: 'Invalid provider result' },
    ]);
    expect(summary.results.map((result) => result.id)).toEqual([
      's1',
      's3',
      's4',
    ]);
  });
  it('retries retryable errors and falls back only after failures', async () => {
    let attempts = 0;
    let fallbackCalls = 0;
    const scheduler = new MultiProviderScheduler();
    scheduler.register(
      provider('primary', async (batch) => {
        attempts++;
        if (attempts < 2) throw new Error('Provider HTTP 503');
        return batch.map((item) => ({ id: item.id, text: 'primary' }));
      }),
      { id: 'primary' },
    );
    scheduler.register(
      provider('fallback', async (batch) => {
        fallbackCalls++;
        return batch.map((item) => ({ id: item.id, text: 'fallback' }));
      }),
      { id: 'fallback' },
    );
    const retried = await scheduler.schedule(
      [segments(1)[0]!],
      { targetLanguage: 'zh' },
      {
        ...options,
        strategy: 'primary-fallback',
        primary: 'primary',
        fallback: 'fallback',
        retries: 1,
      },
    );
    expect(attempts).toBe(2);
    expect(fallbackCalls).toBe(0);
    expect(retried.results[0]?.text).toBe('primary');

    attempts = 0;
    const failing = new MultiProviderScheduler();
    failing.register(
      provider('primary', async () => {
        attempts++;
        throw new Error('Provider HTTP 503');
      }),
      { id: 'primary' },
    );
    failing.register(
      provider('fallback', async (batch) => {
        fallbackCalls++;
        return batch.map((item) => ({ id: item.id, text: 'fallback' }));
      }),
      { id: 'fallback' },
    );
    const fellBack = await failing.schedule(
      [segments(1)[0]!],
      { targetLanguage: 'zh' },
      {
        ...options,
        strategy: 'primary-fallback',
        primary: 'primary',
        fallback: 'fallback',
        retries: 1,
      },
    );
    expect(fellBack.results[0]).toMatchObject({
      text: 'fallback',
      provider: 'fallback',
    });
  });
  it('cancels bounded work and returns cancellation state', async () => {
    const scheduler = new MultiProviderScheduler();
    scheduler.register(
      provider('slow', async (batch, _context, translateOptions) => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 200);
          translateOptions?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Cancelled', 'AbortError'));
          });
        });
        return batch.map((item) => ({ id: item.id, text: 'slow' }));
      }),
      { id: 'slow', concurrency: 2 },
    );
    const controller = new AbortController();
    const pending = scheduler.schedule(
      segments(4),
      { targetLanguage: 'zh' },
      { ...options, strategy: 'primary-fallback', primary: 'slow' },
      {},
      controller.signal,
    );
    setTimeout(() => controller.abort(), 20);
    const summary = await pending;
    expect(summary.cancelled).toBe(true);
    expect(summary.results).toHaveLength(0);
    expect(summary.tasks.every((task) => task.state === 'cancelled')).toBe(
      true,
    );
  });
});
