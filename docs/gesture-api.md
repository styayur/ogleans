# Gesture API v1

The gesture layer is independent of translation. It recognizes intentional pointer movement, maps it to registered actions, provides keyboard alternatives and reports configuration conflicts.

## Types

```ts
type GestureDirection = 'up' | 'down' | 'left' | 'right';
type GestureTrigger = 'alt-primary' | 'primary' | 'alt-secondary' | 'secondary';

interface GestureMapping {
  id: string;
  action: string;
  sequence: GestureDirection[];
  enabled?: boolean;
}

interface KeyboardMapping {
  id: string;
  action: string;
  combo: string;
  enabled?: boolean;
}
```

`GestureActionRegistry` stores actions with `{id,title,description,group,availability}` and a `run(context)` function. `availability: 'built-in-only'` hides or rejects translation-dependent actions when translation mode is `external` or `disabled`. Collection and reading actions remain available.

## Recognition semantics

`GestureRecognizer` begins only when the configured trigger matches. The default is `alt-primary`: primary button plus the Alt key.

- Movement is sampled by pointer events.
- A direction is appended after the configured distance threshold.
- Repeated directions collapse.
- The sequence is capped at `maxSequence`.
- A total movement below the threshold is an ordinary click and produces no gesture action.
- `isCapturing()` lets the content layer prevent the page default only after the threshold is crossed.
- For secondary-button gestures, `consumeContextMenuSuppression()` returns `true` only after an intentional gesture. Ordinary right clicks are not intercepted.

The content layer preserves a selection snapshot at pointer-down before browser default handling can collapse it. This allows save-selection gestures to operate reliably after a text selection.

## Conflict detection

`detectGestureConflicts(mappings, keyboard)` returns errors and warnings:

- duplicate exact gesture sequences (error);
- one sequence being a prefix of another (warning; the longer exact match wins);
- duplicate keyboard combinations (error);
- reserved browser/OS combinations (error);
- malformed keyboard syntax (error).

Configuration validation rejects errors. Prefix warnings are shown in settings and do not block saving.

## Keyboard alternatives

`keyboardMatches(binding, event)` normalizes modifier order and key names. Editable controls, text areas, selects, contenteditable regions and Ogleans UI are ignored so page typing is not intercepted. Keyboard bindings must not use reserved browser shortcuts.

## Default mappings

See [README default gestures](../README.md#default-gestures). The mappings are stored in configuration, not in the recognizer. Users can add, remove or reassign actions in settings.

## Lifecycle and accessibility

- The content script is injected only after an explicit activation.
- Gesture and selection listeners exist only while that injected reading layer is active.
- `Escape` closes the collection panel.
- Floating controls are real focusable buttons with labels.
- The collection surface is not keyboard-trap modal.
- Reduced-motion preferences are respected.
- Long-press, hover-only and timing-only activation are not required for accessibility.

## Public package

`@ogleans/gesture` exports:

- `GestureRecognizer`
- `GestureActionRegistry`
- `sequenceFromPoints`
- `matchGesture`
- `detectGestureConflicts`
- `keyboardMatches`
- `isEditableTarget`
- `DEFAULT_GESTURE_CONFIG`
