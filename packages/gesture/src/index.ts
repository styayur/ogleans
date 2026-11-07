// SPDX-License-Identifier: MPL-2.0
import type { RenderMode, TranslationMode } from '../../shared/src/index';

export const GESTURE_API_VERSION = 1 as const;
export type GestureDirection = 'up' | 'down' | 'left' | 'right';
export type GestureSequence = GestureDirection[];
export type GestureTrigger =
  'alt-primary' | 'primary' | 'alt-secondary' | 'secondary';

export interface GestureMapping {
  id: string;
  action: string;
  sequence: GestureSequence;
  enabled?: boolean;
}
export interface KeyboardMapping {
  id: string;
  action: string;
  combo: string;
  enabled?: boolean;
}
export interface GestureConfig {
  trigger: GestureTrigger;
  thresholdPx: number;
  maxSequence: number;
  showHandle: boolean;
  mappings: GestureMapping[];
  keyboard: KeyboardMapping[];
}
export interface GestureActionDescriptor {
  id: string;
  title: string;
  description: string;
  group: 'collection' | 'translation' | 'reading';
  availability?: 'always' | 'built-in-only';
}
export interface GestureContext {
  text: string;
  title: string;
  url: string;
  translationMode: TranslationMode;
  renderMode: RenderMode;
}
export interface GestureAction extends GestureActionDescriptor {
  run(context: GestureContext): void | Promise<void>;
}
export interface PointerSample {
  x: number;
  y: number;
  button?: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}
export interface Recognition {
  intentional: boolean;
  sequence: GestureSequence;
  distance: number;
}
export interface GestureConflict {
  severity: 'error' | 'warning';
  code:
    | 'duplicate-gesture'
    | 'gesture-prefix'
    | 'duplicate-keyboard'
    | 'reserved-keyboard'
    | 'invalid-combo';
  message: string;
  mappingIds: string[];
}
export interface EventLike {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}
export interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => Element | null;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  trigger: 'alt-primary',
  thresholdPx: 24,
  maxSequence: 3,
  showHandle: true,
  mappings: [
    { id: 'save', action: 'collection.save', sequence: ['up'] },
    { id: 'collection', action: 'collection.open', sequence: ['down'] },
    { id: 'previous', action: 'collection.previous', sequence: ['left'] },
    { id: 'next', action: 'collection.next', sequence: ['right'] },
    {
      id: 'translate',
      action: 'translation.toggle',
      sequence: ['up', 'right'],
    },
    { id: 'mode', action: 'translation.mode', sequence: ['right', 'up'] },
    {
      id: 'restore',
      action: 'translation.restore',
      sequence: ['down', 'right'],
    },
    { id: 'dictionary', action: 'dictionary.open', sequence: ['down', 'left'] },
    { id: 'hide', action: 'panel.hide', sequence: ['left', 'right'] },
  ],
  keyboard: [
    { id: 'save-key', action: 'collection.save', combo: 'Alt+Shift+S' },
    { id: 'collection-key', action: 'collection.open', combo: 'Alt+Shift+C' },
    {
      id: 'previous-key',
      action: 'collection.previous',
      combo: 'Alt+Shift+ArrowLeft',
    },
    {
      id: 'next-key',
      action: 'collection.next',
      combo: 'Alt+Shift+ArrowRight',
    },
    { id: 'translate-key', action: 'translation.toggle', combo: 'Alt+Shift+T' },
    { id: 'mode-key', action: 'translation.mode', combo: 'Alt+Shift+M' },
    { id: 'restore-key', action: 'translation.restore', combo: 'Alt+Shift+R' },
    { id: 'dictionary-key', action: 'dictionary.open', combo: 'Alt+Shift+D' },
    { id: 'hide-key', action: 'panel.hide', combo: 'Alt+Shift+H' },
  ],
};

export const GESTURE_DIRECTIONS: ReadonlySet<string> = new Set([
  'up',
  'down',
  'left',
  'right',
]);

const RESERVED_KEYBOARD = new Set([
  'CTRL+W',
  'CTRL+T',
  'CTRL+L',
  'CTRL+R',
  'CTRL+N',
  'CTRL+SHIFT+N',
  'ALT+F4',
  'ALT+LEFT',
  'ALT+RIGHT',
  'META+W',
  'META+T',
  'META+L',
  'META+R',
  'META+Q',
]);

export function parseGestureSequence(value: string): GestureSequence {
  const parts = value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length || parts.length > 4)
    throw new Error('Gesture sequence must contain 1–4 directions');
  for (const part of parts)
    if (!GESTURE_DIRECTIONS.has(part))
      throw new Error(`Unknown gesture direction: ${part}`);
  return parts as GestureSequence;
}

export function formatGestureSequence(sequence: GestureSequence): string {
  return sequence.join(',');
}

export function normalizeCombo(combo: string): string {
  const parts = combo
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) throw new Error('Empty keyboard shortcut');
  const modifiers = new Set<string>();
  let key = '';
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (['alt', 'ctrl', 'meta', 'shift'].includes(lower))
      modifiers.add(lower[0]!.toUpperCase() + lower.slice(1));
    else if (!key) key = normalizeKey(part);
    else throw new Error('Keyboard shortcut has multiple keys');
  }
  if (!key) throw new Error('Keyboard shortcut has no key');
  const order = ['Ctrl', 'Alt', 'Shift', 'Meta'];
  return [...order.filter((m) => modifiers.has(m)), key].join('+');
}

function normalizeKey(key: string): string {
  const aliases: Record<string, string> = {
    esc: 'Escape',
    escape: 'Escape',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    up: 'ArrowUp',
    down: 'ArrowDown',
    space: ' ',
    spacebar: ' ',
  };
  const lower = key.toLowerCase();
  return aliases[lower] ?? (key.length === 1 ? key.toUpperCase() : key);
}

export function keyboardMatches(
  binding: KeyboardMapping,
  event: EventLike,
): boolean {
  if (binding.enabled === false) return false;
  let combo: string;
  try {
    combo = normalizeCombo(
      [
        event.ctrlKey ? 'Ctrl' : '',
        event.altKey ? 'Alt' : '',
        event.shiftKey ? 'Shift' : '',
        event.metaKey ? 'Meta' : '',
        event.key,
      ]
        .filter(Boolean)
        .join('+'),
    );
  } catch {
    return false;
  }
  return combo === normalizeCombo(binding.combo);
}

export function isEditableTarget(target: TargetLike | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toLowerCase();
  if (['input', 'textarea', 'select', 'option'].includes(tag ?? ''))
    return true;
  return !!target.closest?.(
    '[contenteditable]:not([contenteditable="false"]),[data-ogleans-ui]',
  );
}

export function matchGesture(
  sequence: GestureSequence,
  mappings: GestureMapping[],
  translationMode?: TranslationMode,
): GestureMapping | undefined {
  void translationMode;
  const formatted = formatGestureSequence(sequence);
  return [...mappings]
    .filter((mapping) => mapping.enabled !== false)
    .sort((a, b) => b.sequence.length - a.sequence.length)
    .find((mapping) => formatGestureSequence(mapping.sequence) === formatted);
}

export function actionAvailable(
  action: GestureActionDescriptor,
  translationMode: TranslationMode,
): boolean {
  return (
    action.availability !== 'built-in-only' || translationMode === 'built-in'
  );
}

export function sequenceFromPoints(
  points: PointerSample[],
  thresholdPx = 24,
  maxSequence = 3,
): Recognition {
  if (points.length < 2)
    return { intentional: false, sequence: [], distance: 0 };
  const start = points[0]!;
  const end = points[points.length - 1]!;
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const sequence: GestureDirection[] = [];
  let anchor = start;
  for (const point of points.slice(1)) {
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    if (Math.hypot(dx, dy) < thresholdPx) continue;
    const direction: GestureDirection =
      Math.abs(dx) >= Math.abs(dy)
        ? dx >= 0
          ? 'right'
          : 'left'
        : dy >= 0
          ? 'down'
          : 'up';
    if (sequence.at(-1) !== direction) sequence.push(direction);
    anchor = point;
    if (sequence.length >= maxSequence) break;
  }
  return {
    intentional: sequence.length > 0 && distance >= thresholdPx,
    sequence,
    distance,
  };
}

function acceptsTrigger(
  point: PointerSample,
  trigger: GestureTrigger,
): boolean {
  const primary = (point.button ?? 0) === 0;
  const secondary = point.button === 2;
  if (trigger === 'primary') return primary;
  if (trigger === 'alt-primary') return primary && !!point.altKey;
  if (trigger === 'secondary') return secondary;
  return secondary && !!point.altKey;
}

export class GestureRecognizer {
  private points: PointerSample[] = [];
  private tracking = false;
  private suppressNextContextMenu = false;
  constructor(
    private readonly config: GestureConfig,
    private readonly onFinish: (recognition: Recognition) => void = () => {},
  ) {}
  begin(point: PointerSample): boolean {
    this.cancel();
    if (!acceptsTrigger(point, this.config.trigger)) return false;
    this.tracking = true;
    this.points = [point];
    return true;
  }
  move(point: PointerSample): void {
    if (!this.tracking) return;
    const last = this.points.at(-1);
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < 2) return;
    this.points.push(point);
  }
  end(point: PointerSample): Recognition {
    if (!this.tracking)
      return { intentional: false, sequence: [], distance: 0 };
    this.points.push(point);
    const recognition = sequenceFromPoints(
      this.points,
      this.config.thresholdPx,
      this.config.maxSequence,
    );
    this.tracking = false;
    this.points = [];
    if (recognition.intentional) {
      this.suppressNextContextMenu =
        this.config.trigger === 'secondary' ||
        this.config.trigger === 'alt-secondary';
      this.onFinish(recognition);
    }
    return recognition;
  }
  isCapturing(): boolean {
    return (
      this.tracking &&
      sequenceFromPoints(
        this.points,
        this.config.thresholdPx,
        this.config.maxSequence,
      ).intentional
    );
  }
  cancel(): void {
    this.tracking = false;
    this.points = [];
  }
  consumeContextMenuSuppression(): boolean {
    if (!this.suppressNextContextMenu) return false;
    this.suppressNextContextMenu = false;
    return true;
  }
}

export function detectGestureConflicts(
  mappings: GestureMapping[],
  keyboard: KeyboardMapping[],
): GestureConflict[] {
  const conflicts: GestureConflict[] = [];
  const seen = new Map<string, string>();
  for (const mapping of mappings) {
    if (mapping.enabled === false) continue;
    const key = formatGestureSequence(mapping.sequence);
    const previous = seen.get(key);
    if (previous)
      conflicts.push({
        severity: 'error',
        code: 'duplicate-gesture',
        message: `Gesture ${key} is assigned to both ${previous} and ${mapping.action}.`,
        mappingIds: [previous, mapping.id],
      });
    else seen.set(key, mapping.id);
  }
  const active = mappings.filter((m) => m.enabled !== false);
  for (const a of active)
    for (const b of active) {
      if (a.id === b.id || a.sequence.length >= b.sequence.length) continue;
      if (
        b.sequence.slice(0, a.sequence.length).join(',') ===
        a.sequence.join(',')
      )
        conflicts.push({
          severity: 'warning',
          code: 'gesture-prefix',
          message: `${formatGestureSequence(a.sequence)} is a prefix of ${formatGestureSequence(b.sequence)}; the longer gesture wins when matched exactly.`,
          mappingIds: [a.id, b.id],
        });
    }
  const keys = new Map<string, string>();
  for (const binding of keyboard) {
    if (binding.enabled === false) continue;
    let combo: string;
    try {
      combo = normalizeCombo(binding.combo);
    } catch {
      conflicts.push({
        severity: 'error',
        code: 'invalid-combo',
        message: `Invalid keyboard shortcut: ${binding.combo}.`,
        mappingIds: [binding.id],
      });
      continue;
    }
    if (RESERVED_KEYBOARD.has(combo.toUpperCase()))
      conflicts.push({
        severity: 'error',
        code: 'reserved-keyboard',
        message: `${combo} is reserved by the browser or operating system.`,
        mappingIds: [binding.id],
      });
    const previous = keys.get(combo);
    if (previous)
      conflicts.push({
        severity: 'error',
        code: 'duplicate-keyboard',
        message: `${combo} is assigned to both ${previous} and ${binding.action}.`,
        mappingIds: [previous, binding.id],
      });
    else keys.set(combo, binding.id);
  }
  return conflicts;
}

export class GestureActionRegistry {
  private actions = new Map<string, GestureAction>();
  register(action: GestureAction): () => void {
    if (this.actions.has(action.id))
      throw new Error('Duplicate gesture action');
    this.actions.set(action.id, action);
    return () => this.actions.delete(action.id);
  }
  list(): GestureActionDescriptor[] {
    return [...this.actions.values()].map(
      ({ id, title, description, group, availability }) => ({
        id,
        title,
        description,
        group,
        availability,
      }),
    );
  }
  get(id: string): GestureAction | undefined {
    return this.actions.get(id);
  }
  async run(id: string, context: GestureContext): Promise<boolean> {
    const action = this.actions.get(id);
    if (!action || !actionAvailable(action, context.translationMode))
      return false;
    await action.run(context);
    return true;
  }
}
