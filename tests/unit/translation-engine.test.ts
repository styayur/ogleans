// SPDX-License-Identifier: MPL-2.0
import { describe, it, expect, vi } from 'vitest';
import {
  TranslationEngine,
  createSchedulerTransport,
} from '../../packages/translation/src/index';
import { MultiProviderScheduler } from '../../packages/scheduler/src/index';
import type { DocumentAdapter } from '../../packages/adapter-api/src/index';
import type { TranslationResult } from '../../packages/shared/src/index';

function adapter(render = vi.fn()): DocumentAdapter {
  return {
    id: 'memory',
    read: () => ({
      id: 'doc',
      type: 'document',
      children: [
        {
          id: 'block',
          type: 'block',
          children: [
            { id: 's1', type: 'segment', text: 'First paragraph.' },
            { id: 's2', type: 'segment', text: 'Second paragraph.' },
          ],
        },
      ],
    }),
    render,
    restore: vi.fn(),
  };
}
describe('streaming translation coordinator', () => {
  it('renders partial results as they finish while preserving source order', async () => {
    const render = vi.fn();
    const transport = {
      async translate(input: {
        onResult: (result: TranslationResult) => void;
      }) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        input.onResult({
          id: 's2',
          text: 'Second translation.',
          provider: 'b',
        });
        await new Promise((resolve) => setTimeout(resolve, 5));
        input.onResult({ id: 's1', text: 'First translation.', provider: 'a' });
      },
    };
    const engine = new TranslationEngine(adapter(render), transport, {
      targetLanguage: 'zh',
    });
    await engine.translate();
    expect(render.mock.calls.map((call) => call[0][0].id)).toEqual([
      's2',
      's1',
    ]);
    expect(engine.getSegments().map((segment) => segment.id)).toEqual([
      's1',
      's2',
    ]);
    expect(engine.getSegments().map((segment) => segment.translation)).toEqual([
      'First translation.',
      'Second translation.',
    ]);
    engine.dispose();
  });
  it('keeps successful segments when one provider task fails', async () => {
    const scheduler = new MultiProviderScheduler();
    scheduler.register(
      {
        id: 'test',
        name: 'test',
        async translate(batch) {
          if (batch[0]?.id === 's1') throw new Error('Invalid provider result');
          return batch.map((item) => ({
            id: item.id,
            text: `Translated ${item.text}`,
          }));
        },
      },
      { id: 'test' },
    );
    const engine = new TranslationEngine(
      adapter(),
      createSchedulerTransport(scheduler, {
        strategy: 'primary-fallback',
        primary: 'test',
        retries: 0,
        timeoutMs: 500,
      }),
      { targetLanguage: 'zh' },
    );
    const failures: string[] = [];
    engine.events.on('segment.translation.failed', ({ id }) =>
      failures.push(id),
    );
    await engine.translate();
    expect(failures).toEqual(['s1']);
    expect(engine.getSegments()[1]?.translation).toContain('Second paragraph');
    engine.dispose();
  });
  it('uses bounded cache on a new run and never schedules in external or disabled mode', async () => {
    const transport = vi.fn(
      async (input: {
        segments: { id: string; text: string }[];
        onResult: (value: TranslationResult) => void;
      }) => {
        for (const segment of input.segments)
          input.onResult({
            id: segment.id,
            text: `Cached ${segment.text}`,
            provider: 'p',
          });
      },
    );
    const engine = new TranslationEngine(
      adapter(),
      { translate: transport },
      {
        targetLanguage: 'zh',
      },
    );
    await engine.translate();
    expect(transport).toHaveBeenCalledTimes(1);
    engine.restore();
    await engine.translate();
    expect(transport).toHaveBeenCalledTimes(1);
    engine.setTranslationMode('external');
    engine.restore();
    await engine.translate();
    expect(transport).toHaveBeenCalledTimes(1);
    engine.setTranslationMode('disabled');
    engine.restore();
    await engine.translate();
    expect(transport).toHaveBeenCalledTimes(1);
    engine.dispose();
  });
});
