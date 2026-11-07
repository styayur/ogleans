// SPDX-License-Identifier: MPL-2.0
import { describe, it, expect, vi } from 'vitest';
import {
  TranslationKernel,
  TranslationCache,
} from '../../packages/core/src/index';
import { ProviderRouter } from '../../packages/provider-api/src/index';
import { EventBus } from '../../packages/event-api/src/index';
import { segmentsOf } from '../../packages/shared/src/index';
import {
  parseConfig,
  defaultConfig,
  exportConfig,
  endpointUrl,
} from '../../packages/config/src/index';
import { matches, resolveRules } from '../../packages/rules/src/index';
import {
  segmentText,
  detectLanguage,
} from '../../packages/segmenter/src/index';
import { actionUrl, ActionRegistry } from '../../packages/action-api/src/index';
describe('semantic segmentation', () => {
  it('keeps inline prose together and splits long text without broken surrogates', () => {
    expect(segmentText('A sentence with a linked word.')).toEqual([
      'A sentence with a linked word.',
    ]);
    expect(segmentText('https://example.org')).toEqual([]);
    const pieces = segmentText('😀'.repeat(100) + ' alphabet', 32);
    expect(pieces.every((p) => p.length <= 32)).toBe(true);
    expect(pieces.join('')).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
  });
  it('detects scripts conservatively', () => {
    expect(detectLanguage('中文')).toBe('zh');
    expect(detectLanguage('English or français')).toBe('und');
    expect(detectLanguage('こんにちは')).toBe('ja');
  });
});
describe('rules and configuration', () => {
  it('escapes match patterns and applies user precedence', () => {
    expect(matches('https://*.example.org/*', 'https://a.example.org/x')).toBe(
      true,
    );
    expect(matches('https://example.org/*', 'https://exampleXorg/x')).toBe(
      false,
    );
    expect(
      resolveRules('https://example.org', [
        { match: ['*'], exclude: ['.private'] },
      ]).exclude,
    ).toEqual(['.private']);
  });
  it('round trips and redacts secrets', () => {
    const value = structuredClone(defaultConfig);
    value.providers[0].apiKey = 'secret';
    value.providers[0].headers = { Authorization: 'secret' };
    expect(
      parseConfig(JSON.parse(exportConfig(value))).providers[0].apiKey,
    ).toBeUndefined();
    expect(exportConfig(value)).not.toContain('secret');
  });
  it('migrates version 1 configuration and supports translation-free modes', () => {
    const legacy = {
      schemaVersion: 1,
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      mode: 'bilingual',
      placement: 'below',
      primary: 'google',
      providers: [
        {
          id: 'google',
          kind: 'google',
          baseUrl: 'https://translate.googleapis.com',
          timeoutMs: 20000,
        },
      ],
      rules: [],
      actions: [],
    };
    const migrated = parseConfig(legacy);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.translation.mode).toBe('built-in');
    expect(migrated.gestures.mappings.length).toBeGreaterThan(0);
    expect(migrated.collection.dictionaryUrlTemplate).toContain('{text}');
    const external = parseConfig({
      ...defaultConfig,
      primary: '',
      providers: [],
      translation: { ...defaultConfig.translation, mode: 'external' },
    });
    expect(external.translation.mode).toBe('external');
    expect(external.providers).toEqual([]);
  });
  it('detects exact gesture conflicts during validation', () => {
    const conflicted = structuredClone(defaultConfig);
    conflicted.gestures.mappings.push({
      id: 'duplicate',
      action: 'panel.hide',
      sequence: ['up'],
    });
    expect(() => parseConfig(conflicted)).toThrow(/assigned to both/i);
  });
  it('rejects unsafe input', () => {
    expect(() => parseConfig({ ...defaultConfig, schemaVersion: 3 })).toThrow();
    expect(() =>
      parseConfig({ ...defaultConfig, primary: 'missing' }),
    ).toThrow();
    expect(() => endpointUrl('http://example.org')).toThrow();
    expect(() => endpointUrl('https://user:password@example.org')).toThrow();
    expect(() => actionUrl('javascript:{text}', 'hello')).toThrow();
    expect(actionUrl('https://example.org/?q={text}', '&x=1')).toContain(
      '%26x%3D1',
    );
  });
});
describe('bounded cache and event bus', () => {
  it('evicts least recently used entries and expires', () => {
    vi.useFakeTimers();
    const cache = new TranslationCache(2, 100);
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.get('a');
    cache.set('c', 'C');
    expect(cache.get('b')).toBeUndefined();
    vi.advanceTimersByTime(101);
    expect(cache.get('a')).toBeUndefined();
    vi.useRealTimers();
  });
  it('isolates listener mutations and failures and unsubscribes', () => {
    const error = vi.fn();
    const bus = new EventBus(error);
    const values: number[] = [];
    bus.on('translation.started', (v) => {
      v.count = 99;
      throw Error('Extension failed');
    });
    const off = bus.on('translation.started', (v) => values.push(v.count));
    bus.emit('translation.started', { count: 2 });
    off();
    bus.emit('translation.started', { count: 3 });
    expect(values).toEqual([2]);
    expect(error).toHaveBeenCalledTimes(2);
  });
  it('rejects duplicate document IDs and bounds action context', async () => {
    expect(() =>
      segmentsOf({
        id: 'd',
        type: 'document',
        children: [
          { id: 'x', type: 'segment', text: 'a' },
          { id: 'x', type: 'segment', text: 'b' },
        ],
      }),
    ).toThrow();
    const registry = new ActionRegistry();
    const run = vi.fn();
    registry.register({ id: 'x', title: 'X', run });
    await registry.run('x', {
      text: 'a'.repeat(3000),
      title: '',
      url: '',
      targetLanguage: 'zh',
    });
    expect(run.mock.calls[0][0].text.length).toBe(2000);
  });
});
describe('provider router', () => {
  const segments = [{ id: '1', text: 'Hello world' }];
  const context = { targetLanguage: 'zh' };
  it('retries invalid batches, falls back and reports health', async () => {
    const router = new ProviderRouter({
      primary: 'bad',
      fallback: 'good',
      retries: 1,
    });
    const bad = vi.fn(async () => [{ id: 'wrong', text: 'bad' }]);
    router.register({ id: 'bad', name: 'bad', translate: bad });
    router.register({
      id: 'good',
      name: 'good',
      translate: async (s) => s.map((x) => ({ id: x.id, text: '你好' })),
    });
    expect((await router.translateBatch(segments, context))[0].provider).toBe(
      'good',
    );
    expect(bad).toHaveBeenCalledTimes(2);
    expect(router.getHealth('bad').failures).toBe(2);
  });
  it('times out providers that ignore abort', async () => {
    const router = new ProviderRouter({
      primary: 'stuck',
      timeoutMs: 10,
      retries: 0,
    });
    router.register({
      id: 'stuck',
      name: 'stuck',
      translate: () => new Promise(() => {}),
    });
    await expect(router.translateBatch(segments, context)).rejects.toThrow(
      'timeout',
    );
  });
  it('cancels without fallback', async () => {
    const router = new ProviderRouter({
      primary: 'stuck',
      fallback: 'good',
      timeoutMs: 1000,
      retries: 0,
    });
    const fallback = vi.fn();
    router.register({
      id: 'stuck',
      name: 'stuck',
      translate: () => new Promise(() => {}),
    });
    router.register({ id: 'good', name: 'good', translate: fallback });
    const abort = new AbortController();
    const promise = router.translateBatch(segments, context, {
      signal: abort.signal,
    });
    abort.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(fallback).not.toHaveBeenCalled();
  });
  it('batches and limits context', async () => {
    const translate = vi.fn(async (s: { id: string }[]) =>
      s.map((x) => ({ id: x.id, text: 'ok' })),
    );
    const router = new ProviderRouter({ primary: 'x', batchSize: 2 });
    router.register({ id: 'x', name: 'x', translate });
    await router.translateBatch(
      Array.from({ length: 5 }, (_, i) => ({ id: String(i), text: 'hello' })),
      { ...context, title: 'a'.repeat(1000) },
    );
    expect(translate).toHaveBeenCalledTimes(3);
    expect(
      (translate.mock.calls[0] as unknown as [unknown, { title: string }])[1]
        .title.length,
    ).toBe(256);
  });
});
describe('kernel', () => {
  it('translates an external document adapter, exports, caches and restores', async () => {
    const translate = vi.fn(async (s: { id: string }[]) =>
      s.map((x) => ({ id: x.id, text: '你好' })),
    );
    const router = new ProviderRouter({ primary: 'x' });
    router.register({ id: 'x', name: 'x', translate });
    const render = vi.fn(),
      restore = vi.fn();
    const kernel = new TranslationKernel(
      {
        id: 'memory',
        read: () => ({
          id: 'd',
          type: 'document',
          children: [{ id: 's', type: 'segment', text: 'Hello' }],
        }),
        render,
        restore,
      },
      router,
      { targetLanguage: 'zh' },
    );
    await kernel.translate();
    expect(kernel.exportDocument().segments[0].translation).toBe('你好');
    kernel.restore();
    await kernel.translate();
    expect(translate).toHaveBeenCalledTimes(1);
    kernel.dispose();
    expect(restore).toHaveBeenCalled();
  });
});
