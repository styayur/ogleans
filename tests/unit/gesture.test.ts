// SPDX-License-Identifier: MPL-2.0
import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_GESTURE_CONFIG,
  GestureRecognizer,
  detectGestureConflicts,
  isEditableTarget,
  keyboardMatches,
  matchGesture,
  normalizeCombo,
  sequenceFromPoints,
} from '../../packages/gesture/src/index';

describe('gesture recognition', () => {
  it('recognizes direction sequences and distinguishes ordinary clicks', () => {
    const upRight = sequenceFromPoints(
      [
        { x: 0, y: 0 },
        { x: 0, y: -30 },
        { x: 30, y: -30 },
      ],
      20,
    );
    expect(upRight).toMatchObject({
      intentional: true,
      sequence: ['up', 'right'],
    });
    expect(
      sequenceFromPoints(
        [
          { x: 10, y: 10 },
          { x: 11, y: 11 },
        ],
        24,
      ),
    ).toEqual({ intentional: false, sequence: [], distance: Math.hypot(1, 1) });
  });
  it('requires the configured modifier and leaves clicks and context menus alone', () => {
    const finished = vi.fn();
    const recognizer = new GestureRecognizer(
      { ...DEFAULT_GESTURE_CONFIG, trigger: 'alt-primary', thresholdPx: 20 },
      finished,
    );
    expect(recognizer.begin({ x: 0, y: 0, button: 0 })).toBe(false);
    expect(recognizer.begin({ x: 0, y: 0, button: 0, altKey: true })).toBe(
      true,
    );
    expect(
      recognizer.end({ x: 0, y: 0, button: 0, altKey: true }).intentional,
    ).toBe(false);
    expect(finished).not.toHaveBeenCalled();
    expect(recognizer.consumeContextMenuSuppression()).toBe(false);

    const right = new GestureRecognizer(
      { ...DEFAULT_GESTURE_CONFIG, trigger: 'secondary', thresholdPx: 20 },
      finished,
    );
    expect(right.begin({ x: 0, y: 0, button: 2 })).toBe(true);
    expect(right.end({ x: 0, y: -30, button: 2 }).intentional).toBe(true);
    expect(finished).toHaveBeenCalledOnce();
    expect(right.consumeContextMenuSuppression()).toBe(true);
    expect(right.consumeContextMenuSuppression()).toBe(false);
  });
  it('matches custom mappings and prefers the longest exact sequence', () => {
    const mappings = [
      { id: 'short', action: 'one', sequence: ['up'] as const },
      { id: 'long', action: 'two', sequence: ['up', 'right'] as const },
    ].map((mapping) => ({ ...mapping, sequence: [...mapping.sequence] }));
    expect(matchGesture(['up'], mappings)?.action).toBe('one');
    expect(matchGesture(['up', 'right'], mappings)?.action).toBe('two');
    expect(matchGesture(['left'], mappings)).toBeUndefined();
  });
});

describe('gesture conflicts and keyboard alternatives', () => {
  it('detects duplicate gestures, reserved shortcuts and duplicate keys', () => {
    const conflicts = detectGestureConflicts(
      [
        { id: 'a', action: 'collection.open', sequence: ['down'] },
        { id: 'b', action: 'collection.save', sequence: ['down'] },
        { id: 'c', action: 'panel.hide', sequence: ['down', 'left'] },
      ],
      [
        { id: 'k1', action: 'collection.open', combo: 'Ctrl+W' },
        { id: 'k2', action: 'collection.save', combo: 'Alt+Shift+S' },
        { id: 'k3', action: 'panel.hide', combo: 'Shift+Alt+s' },
      ],
    );
    expect(conflicts.some((item) => item.code === 'duplicate-gesture')).toBe(
      true,
    );
    expect(conflicts.some((item) => item.code === 'gesture-prefix')).toBe(true);
    expect(conflicts.some((item) => item.code === 'reserved-keyboard')).toBe(
      true,
    );
    expect(conflicts.some((item) => item.code === 'duplicate-keyboard')).toBe(
      true,
    );
  });
  it('normalizes shortcuts and matches keyboard events without editable targets', () => {
    expect(normalizeCombo('shift + alt + s')).toBe('Alt+Shift+S');
    expect(
      keyboardMatches(
        { id: 'k', action: 'collection.save', combo: 'Alt+Shift+S' },
        { key: 's', altKey: true, shiftKey: true },
      ),
    ).toBe(true);
    expect(
      keyboardMatches(
        { id: 'k', action: 'collection.save', combo: 'Alt+Shift+S' },
        { key: 's', altKey: true },
      ),
    ).toBe(false);
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(
      true,
    );
    expect(isEditableTarget({ tagName: 'BODY' })).toBe(false);
  });
});
