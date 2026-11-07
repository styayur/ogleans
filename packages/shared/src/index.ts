// SPDX-License-Identifier: MPL-2.0
export const API_VERSION = 1 as const;
export const READING_API_VERSION = 1 as const;
export type RenderMode = 'original' | 'translation' | 'bilingual';
export type TranslationMode = 'built-in' | 'external' | 'disabled';
export type TranslationStrategy =
  'round-robin' | 'weighted' | 'language-aware' | 'manual' | 'primary-fallback';
export interface DocumentNode {
  id: string;
  type: 'document' | 'block' | 'segment';
  text?: string;
  children?: DocumentNode[];
  metadata?: Record<string, unknown>;
}
export interface TranslationSegment {
  id: string;
  text: string;
  sourceLanguage?: string;
}
export interface TranslationResult {
  id: string;
  text: string;
  provider?: string;
}
export interface TranslationContext {
  targetLanguage: string;
  sourceLanguage?: string;
  title?: string;
  url?: string;
  previousSegment?: string;
  nextSegment?: string;
  documentLanguage?: string;
  terminology?: string;
}
export interface TranslationOptions {
  signal?: AbortSignal;
}
export interface ExportDocument {
  url: string;
  title: string;
  sourceLanguage: string;
  targetLanguage: string;
  segments: { id: string; source: string; translation?: string }[];
}
export interface ProviderPolicy {
  id: string;
  enabled?: boolean;
  concurrency?: number;
  weight?: number;
  rateLimit?: { requests: number; windowMs: number };
  languages?: string[];
  fallback?: boolean;
}
export interface ExternalTranslationRecord {
  schemaVersion: 1;
  id: string;
  sourceText?: string;
  translatedText: string;
  sourceLanguage?: string;
  targetLanguage: string;
  providerLabel?: string;
  capturedAt: string;
  provenance: 'user-selection' | 'cooperating-adapter';
}
export function segmentsOf(node: DocumentNode): TranslationSegment[] {
  const result: TranslationSegment[] = [];
  const walk = (n: DocumentNode) => {
    if (n.type === 'segment' && n.text) result.push({ id: n.id, text: n.text });
    n.children?.forEach(walk);
  };
  walk(node);
  if (new Set(result.map((s) => s.id)).size !== result.length)
    throw new Error('Duplicate segment ID');
  return result;
}
export function boundedContext(
  context: TranslationContext,
): TranslationContext {
  return {
    ...context,
    title: context.title?.slice(0, 256),
    url: context.url?.slice(0, 2048),
    previousSegment: context.previousSegment?.slice(0, 512),
    nextSegment: context.nextSegment?.slice(0, 512),
    terminology: context.terminology?.slice(0, 4000),
  };
}
export function abortError(): DOMException {
  return new DOMException('Translation cancelled', 'AbortError');
}
export function validateExternalTranslationRecord(
  value: unknown,
): ExternalTranslationRecord {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid external result');
  const r = value as Record<string, unknown>;
  if (r.schemaVersion !== 1)
    throw new Error('Unsupported external result schema');
  if (typeof r.id !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(r.id))
    throw new Error('Invalid external result ID');
  if (
    typeof r.translatedText !== 'string' ||
    !r.translatedText.trim() ||
    r.translatedText.length > 32000
  )
    throw new Error('Invalid external translation text');
  if (
    typeof r.targetLanguage !== 'string' ||
    !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(r.targetLanguage)
  )
    throw new Error('Invalid external target language');
  if (r.sourceText !== undefined && typeof r.sourceText !== 'string')
    throw new Error('Invalid external source text');
  if (r.providerLabel !== undefined && typeof r.providerLabel !== 'string')
    throw new Error('Invalid external provider label');
  if (
    r.provenance !== 'user-selection' &&
    r.provenance !== 'cooperating-adapter'
  )
    throw new Error('Invalid external provenance');
  if (
    typeof r.capturedAt !== 'string' ||
    Number.isNaN(Date.parse(r.capturedAt))
  )
    throw new Error('Invalid external capture time');
  return {
    schemaVersion: 1,
    id: r.id,
    translatedText: r.translatedText,
    targetLanguage: r.targetLanguage,
    capturedAt: r.capturedAt,
    provenance: r.provenance,
    ...(typeof r.sourceText === 'string'
      ? { sourceText: r.sourceText.slice(0, 10000) }
      : {}),
    ...(typeof r.sourceLanguage === 'string'
      ? { sourceLanguage: r.sourceLanguage.slice(0, 32) }
      : {}),
    ...(typeof r.providerLabel === 'string'
      ? { providerLabel: r.providerLabel.slice(0, 128) }
      : {}),
  };
}
