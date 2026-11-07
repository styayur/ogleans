// SPDX-License-Identifier: MPL-2.0
import type {
  RenderMode,
  TranslationMode,
  TranslationStrategy,
} from '../../shared/src/index';
import type { SiteRule } from '../../rules/src/index';
import { actionUrl, type UrlActionConfig } from '../../action-api/src/index';
import {
  DEFAULT_GESTURE_CONFIG,
  detectGestureConflicts,
  normalizeCombo,
  parseGestureSequence,
  type GestureConfig,
  type GestureMapping,
  type GestureTrigger,
  type KeyboardMapping,
} from '../../gesture/src/index';

export const CONFIG_SCHEMA_VERSION = 2 as const;
export const RELEASE_VERSION = '0.2.0-alpha.1' as const;
export interface ProviderConfig {
  id: string;
  kind: 'google' | 'openai' | 'ollama';
  baseUrl: string;
  apiKey?: string;
  model?: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  enabled?: boolean;
  concurrency?: number;
  weight?: number;
  languages?: string[];
  rateLimit?: { requests: number; windowMs: number };
}
export interface TranslationSettings {
  mode: TranslationMode;
  strategy: TranslationStrategy;
  globalConcurrency: number;
  retries: number;
  timeoutMs: number;
  terminology: string;
  fallbackEnabled: boolean;
  manualAssignments: Record<string, string>;
}
export interface CollectionSettings {
  bookmarksEnabled: boolean;
  bookmarkFolder: string;
  dictionaryUrlTemplate: string;
  dictionaryOpenMode: 'tab' | 'window';
}
export interface KernelConfig {
  schemaVersion: 2;
  sourceLanguage: string;
  targetLanguage: string;
  mode: RenderMode;
  placement: 'below' | 'inline';
  primary: string;
  fallback?: string;
  providers: ProviderConfig[];
  translation: TranslationSettings;
  gestures: GestureConfig;
  collection: CollectionSettings;
  rules: SiteRule[];
  actions: UrlActionConfig[];
}
export const defaultConfig: KernelConfig = {
  schemaVersion: 2,
  sourceLanguage: 'auto',
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
      enabled: true,
      concurrency: 1,
      weight: 1,
      languages: ['*'],
    },
  ],
  translation: {
    mode: 'built-in',
    strategy: 'round-robin',
    globalConcurrency: 3,
    retries: 1,
    timeoutMs: 20000,
    terminology: '',
    fallbackEnabled: true,
    manualAssignments: {},
  },
  gestures: structuredClone(DEFAULT_GESTURE_CONFIG),
  collection: {
    bookmarksEnabled: false,
    bookmarkFolder: 'Ogleans',
    dictionaryUrlTemplate: 'https://en.wiktionary.org/wiki/{text}',
    dictionaryOpenMode: 'tab',
  },
  rules: [],
  actions: [],
};
export function endpointUrl(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password || url.hash || url.search)
    throw new Error('Endpoint must not contain credentials, query or fragment');
  if (
    url.protocol !== 'https:' &&
    !(
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
  )
    throw new Error('Use HTTPS, or HTTP on loopback only');
  return url;
}
const language = /^(auto|[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)$/u;
const idPattern = /^[a-z0-9_-]+$/u;
const actionIdPattern = /^[a-z][a-z0-9._-]{0,63}$/u;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected object');
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 2048): string {
  if (typeof value !== 'string' || value.length > max)
    throw new Error('Invalid string');
  return value;
}
function strings(value: unknown, max = 100, itemMax = 2048): string[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error('Invalid array');
  return value.map((v) => string(v, itemMax));
}
function boolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error('Invalid boolean');
  return value;
}
function integer(
  value: unknown,
  min: number,
  max: number,
  label: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error(`Invalid ${label}`);
  return value;
}
function parseGestureMappings(value: unknown): GestureMapping[] {
  if (!Array.isArray(value) || value.length > 32)
    throw new Error('Invalid gesture mappings');
  const mappings = value.map((item) => {
    const mapping = object(item);
    return {
      id: string(mapping.id, 64),
      action: string(mapping.action, 64),
      sequence: parseGestureSequence(
        Array.isArray(mapping.sequence)
          ? mapping.sequence.join(',')
          : string(mapping.sequence, 80),
      ),
      ...(mapping.enabled === undefined
        ? {}
        : { enabled: boolean(mapping.enabled, true) }),
    };
  });
  if (new Set(mappings.map((mapping) => mapping.id)).size !== mappings.length)
    throw new Error('Duplicate gesture mapping ID');
  return mappings;
}
function parseKeyboardMappings(value: unknown): KeyboardMapping[] {
  if (!Array.isArray(value) || value.length > 32)
    throw new Error('Invalid keyboard mappings');
  const mappings = value.map((item) => {
    const mapping = object(item);
    return {
      id: string(mapping.id, 64),
      action: string(mapping.action, 64),
      combo: normalizeCombo(string(mapping.combo, 80)),
      ...(mapping.enabled === undefined
        ? {}
        : { enabled: boolean(mapping.enabled, true) }),
    };
  });
  if (new Set(mappings.map((mapping) => mapping.id)).size !== mappings.length)
    throw new Error('Duplicate keyboard mapping ID');
  return mappings;
}
function parseGestures(value: unknown): GestureConfig {
  if (value === undefined) return structuredClone(DEFAULT_GESTURE_CONFIG);
  const gestures = object(value);
  const trigger = string(gestures.trigger, 32) as GestureTrigger;
  if (
    !['alt-primary', 'primary', 'alt-secondary', 'secondary'].includes(trigger)
  )
    throw new Error('Invalid gesture trigger');
  const config: GestureConfig = {
    trigger,
    thresholdPx: integer(gestures.thresholdPx, 8, 120, 'gesture threshold'),
    maxSequence: integer(gestures.maxSequence, 1, 4, 'gesture length'),
    showHandle: boolean(gestures.showHandle, true),
    mappings: parseGestureMappings(gestures.mappings),
    keyboard: parseKeyboardMappings(gestures.keyboard),
  };
  const conflict = detectGestureConflicts(
    config.mappings,
    config.keyboard,
  ).find((entry) => entry.severity === 'error');
  if (conflict) throw new Error(conflict.message);
  return config;
}
function parseCollectionSettings(value: unknown): CollectionSettings {
  if (value === undefined) return structuredClone(defaultConfig.collection);
  const settings = object(value);
  const dictionaryUrlTemplate = string(settings.dictionaryUrlTemplate, 2048);
  actionUrl(dictionaryUrlTemplate, 'test');
  const dictionaryOpenMode = string(settings.dictionaryOpenMode, 16);
  if (!['tab', 'window'].includes(dictionaryOpenMode))
    throw new Error('Invalid dictionary open mode');
  return {
    bookmarksEnabled: boolean(settings.bookmarksEnabled, false),
    bookmarkFolder: string(settings.bookmarkFolder, 128) || 'Ogleans',
    dictionaryUrlTemplate,
    dictionaryOpenMode: dictionaryOpenMode as 'tab' | 'window',
  };
}
function parseTranslationSettings(value: unknown): TranslationSettings {
  const translation = value === undefined ? {} : object(value);
  const mode = string(translation.mode ?? 'built-in', 16) as TranslationMode;
  if (!['built-in', 'external', 'disabled'].includes(mode))
    throw new Error('Invalid translation mode');
  const strategy = string(
    translation.strategy ?? 'round-robin',
    32,
  ) as TranslationStrategy;
  if (
    ![
      'round-robin',
      'weighted',
      'language-aware',
      'manual',
      'primary-fallback',
    ].includes(strategy)
  )
    throw new Error('Invalid translation strategy');
  const manual =
    translation.manualAssignments === undefined
      ? {}
      : object(translation.manualAssignments);
  const manualAssignments: Record<string, string> = {};
  if (Object.keys(manual).length > 512)
    throw new Error('Too many manual provider assignments');
  for (const [key, value] of Object.entries(manual)) {
    if (!key || key.length > 128)
      throw new Error('Invalid manual assignment key');
    manualAssignments[key] = string(value, 64);
  }
  return {
    mode,
    strategy,
    globalConcurrency: integer(
      translation.globalConcurrency ?? 3,
      1,
      16,
      'global concurrency',
    ),
    retries: integer(translation.retries ?? 1, 0, 3, 'retry count'),
    timeoutMs: integer(translation.timeoutMs ?? 20000, 100, 120000, 'timeout'),
    terminology:
      translation.terminology === undefined
        ? ''
        : string(translation.terminology, 4000),
    fallbackEnabled: boolean(translation.fallbackEnabled, true),
    manualAssignments,
  };
}
function parseProviders(
  values: unknown,
  translationMode: TranslationMode,
): ProviderConfig[] {
  if (!Array.isArray(values) || values.length > 16)
    throw new Error('Configure 0–16 providers');
  if (translationMode === 'built-in' && !values.length)
    throw new Error('Built-in translation requires at least one provider');
  return values.map((value) => {
    const p = object(value);
    const id = string(p.id, 64);
    const kind = p.kind;
    if (
      !idPattern.test(id) ||
      !['google', 'openai', 'ollama'].includes(String(kind))
    )
      throw new Error('Invalid provider');
    const baseUrl = endpointUrl(string(p.baseUrl)).href.replace(/\/$/u, '');
    if (kind === 'google' && baseUrl !== 'https://translate.googleapis.com')
      throw new Error('Google provider endpoint is fixed');
    const timeoutMs = integer(p.timeoutMs, 100, 120000, 'provider timeout');
    const headers: Record<string, string> = {};
    if (p.headers)
      for (const [key, value] of Object.entries(object(p.headers))) {
        if (
          !/^[A-Za-z0-9-]+$/u.test(key) ||
          ['host', 'cookie', 'origin', 'referer', 'content-length'].includes(
            key.toLowerCase(),
          )
        )
          throw new Error('Unsafe header');
        headers[key] = string(value, 4096);
        if (/[\r\n]/u.test(headers[key]))
          throw new Error('Invalid header value');
      }
    const apiKey = p.apiKey === undefined ? undefined : string(p.apiKey, 4096);
    const model = p.model === undefined ? undefined : string(p.model, 256);
    if (kind !== 'google' && !model?.trim())
      throw new Error('Provider model required');
    let rateLimit: ProviderConfig['rateLimit'];
    if (p.rateLimit !== undefined) {
      const limit = object(p.rateLimit);
      rateLimit = {
        requests: integer(limit.requests, 1, 1000, 'rate-limit requests'),
        windowMs: integer(limit.windowMs, 1000, 3600000, 'rate-limit window'),
      };
    }
    return {
      id,
      kind: kind as ProviderConfig['kind'],
      baseUrl,
      timeoutMs,
      enabled: boolean(p.enabled, true),
      concurrency: integer(p.concurrency ?? 1, 1, 8, 'provider concurrency'),
      weight: integer(p.weight ?? 1, 1, 100, 'provider weight'),
      languages:
        p.languages === undefined ? ['*'] : strings(p.languages, 32, 64),
      ...(apiKey ? { apiKey } : {}),
      ...(model ? { model } : {}),
      headers,
      ...(rateLimit ? { rateLimit } : {}),
    };
  });
}
function parseRules(value: unknown): SiteRule[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new Error('Invalid rules');
  return value.map((entry) => {
    const rule = object(entry);
    return {
      match: strings(rule.match),
      ...(rule.include ? { include: strings(rule.include) } : {}),
      ...(rule.exclude ? { exclude: strings(rule.exclude) } : {}),
      ...(rule.root ? { root: strings(rule.root) } : {}),
    };
  });
}
function parseActions(value: unknown): UrlActionConfig[] {
  if (!Array.isArray(value) || value.length > 32)
    throw new Error('Invalid actions');
  const actions = value.map((entry) => {
    const action = object(entry);
    const urlTemplate = string(action.urlTemplate);
    actionUrl(urlTemplate, 'test');
    const openMode = string(action.openMode, 16);
    if (!['tab', 'window'].includes(openMode))
      throw new Error('Invalid open mode');
    return {
      id: string(action.id, 64),
      name: string(action.name, 128),
      urlTemplate,
      openMode: openMode as 'tab' | 'window',
    };
  });
  if (new Set(actions.map((action) => action.id)).size !== actions.length)
    throw new Error('Duplicate action');
  return actions;
}
function parseV2(value: Record<string, unknown>): KernelConfig {
  const sourceLanguage = string(value.sourceLanguage, 32);
  const targetLanguage = string(value.targetLanguage, 32);
  if (
    !language.test(sourceLanguage) ||
    !language.test(targetLanguage) ||
    targetLanguage === 'auto'
  )
    throw new Error('Invalid language');
  if (
    !['original', 'translation', 'bilingual'].includes(String(value.mode)) ||
    !['below', 'inline'].includes(String(value.placement))
  )
    throw new Error('Invalid rendering mode');
  const translation = parseTranslationSettings(value.translation);
  const providers = parseProviders(value.providers, translation.mode);
  if (
    new Set(providers.map((provider) => provider.id)).size !== providers.length
  )
    throw new Error('Duplicate provider');
  const primary =
    value.primary === undefined || value.primary === ''
      ? (providers[0]?.id ?? '')
      : string(value.primary, 64);
  const fallback = value.fallback ? string(value.fallback, 64) : undefined;
  if (
    (primary && !providers.some((provider) => provider.id === primary)) ||
    (fallback && !providers.some((provider) => provider.id === fallback))
  )
    throw new Error('Unknown primary/fallback provider');
  if (translation.mode === 'built-in' && !primary)
    throw new Error('Unknown primary/fallback provider');
  for (const [key, providerId] of Object.entries(translation.manualAssignments))
    if (providerId && !providers.some((provider) => provider.id === providerId))
      throw new Error(`Unknown manual provider for ${key}`);
  const gestures = parseGestures(value.gestures);
  for (const mapping of [...gestures.mappings, ...gestures.keyboard])
    if (!actionIdPattern.test(mapping.action))
      throw new Error(`Invalid gesture action: ${mapping.action}`);
  return {
    schemaVersion: 2,
    sourceLanguage,
    targetLanguage,
    mode: value.mode as RenderMode,
    placement: value.placement as 'below' | 'inline',
    primary,
    ...(fallback ? { fallback } : {}),
    providers,
    translation,
    gestures,
    collection: parseCollectionSettings(value.collection),
    rules: parseRules(value.rules),
    actions: parseActions(value.actions),
  };
}
export function migrateConfig(value: unknown): KernelConfig {
  const legacy = object(value);
  if (legacy.schemaVersion !== 1)
    throw new Error('Not a version 1 configuration');
  for (const key of [
    'sourceLanguage',
    'targetLanguage',
    'mode',
    'placement',
    'providers',
    'rules',
    'actions',
  ])
    if (!(key in legacy)) throw new Error(`Missing legacy field: ${key}`);
  return parseV2({
    ...legacy,
    schemaVersion: 2,
    translation: {
      mode: 'built-in',
      strategy: 'round-robin',
      globalConcurrency: 3,
      retries: 1,
      timeoutMs: 20000,
      terminology: '',
      fallbackEnabled: true,
      manualAssignments: {},
    },
    gestures: structuredClone(DEFAULT_GESTURE_CONFIG),
    collection: structuredClone(defaultConfig.collection),
  });
}
export function parseConfig(value: unknown): KernelConfig {
  const c = object(value);
  if (c.schemaVersion === 1) return migrateConfig(c);
  if (c.schemaVersion !== 2) throw new Error('Unsupported schema version');
  return parseV2(c);
}
export function exportConfig(
  config: KernelConfig,
  includeSecrets = false,
): string {
  const copy = structuredClone(config);
  if (!includeSecrets)
    copy.providers.forEach((provider) => {
      delete provider.apiKey;
      provider.headers = {};
    });
  return JSON.stringify(copy, null, 2);
}
export function publicConfig(
  config: KernelConfig,
): Omit<KernelConfig, 'providers'> {
  const { providers: _, ...rest } = config;
  void _;
  return structuredClone(rest);
}
export type ConfigPart =
  | 'config'
  | 'providers'
  | 'rules'
  | 'actions'
  | 'gestures'
  | 'translation'
  | 'collection';
export function exportConfigPart(
  config: KernelConfig,
  part: ConfigPart,
): string {
  const safe = JSON.parse(exportConfig(config)) as KernelConfig;
  if (part === 'config') return JSON.stringify(safe, null, 2);
  return JSON.stringify(
    {
      schemaVersion: 2,
      [part]: safe[part],
      ...(part === 'providers'
        ? { primary: safe.primary, fallback: safe.fallback }
        : {}),
    },
    null,
    2,
  );
}
export function importConfig(value: unknown, base: KernelConfig): KernelConfig {
  const input = object(value);
  if (input.schemaVersion === 1) return migrateConfig(input);
  if (input.schemaVersion !== 2) throw new Error('Unsupported schema version');
  if ('sourceLanguage' in input) return parseConfig(input);
  const parts = [
    'providers',
    'rules',
    'actions',
    'gestures',
    'translation',
    'collection',
  ].filter((key) => key in input);
  if (parts.length !== 1)
    throw new Error('Import a complete config or a single configuration part');
  const key = parts[0];
  return parseConfig({
    ...base,
    [key]: input[key],
    ...(key === 'providers'
      ? { primary: input.primary, fallback: input.fallback }
      : {}),
  });
}
