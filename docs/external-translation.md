# External translation mode

Ogleans translation is replaceable. The reading layer and collection store do not depend on the built-in translation engine.

## Modes

### `built-in`

Ogleans segments the page, schedules configured providers, renders plain-text translations and supports restore/display-mode changes.

### `external`

Ogleans disables built-in scheduling and does not mutate page translation output. Gestures, selection capture, collections, search, notes, tags and exports remain active.

When selected text is saved in external mode, Ogleans records it as a **displayed selection**. It does not claim that the original source text was recovered. If the selection is inside an identified Ogleans translation span, provenance can be preserved, but no other extension's output is attributed to Ogleans.

### `disabled`

Ogleans is passive. No built-in provider calls are made. Gestures and collections still work on the page DOM.

## What Ogleans does not do

- It does not read another extension's local storage.
- It does not use another extension's API keys or credentials.
- It does not send or intercept another extension's private runtime messages.
- It does not assume a common translation-extension API exists.
- It does not overwrite or remove another extension's DOM output.

## Cooperating integration boundary

A cooperating tool can supply a validated `ExternalTranslationRecord`:

```ts
interface ExternalTranslationRecord {
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
```

`validateExternalTranslationRecord` bounds text lengths, timestamps, language tags and provenance. This is an explicit adapter/import boundary, not automatic cross-extension control. A future cooperating integration should ask the user before transmitting page text or sharing results.

## Passive workflow with another extension

1. Select `external` or `disabled` in Ogleans.
2. Use another translation extension or the browser's own translation workflow.
3. Select visible text.
4. Use an Ogleans gesture or keyboard alternative to save it.
5. Open the collection panel to search, tag, annotate, navigate or export it.

The saved item clearly distinguishes a displayed selection from an original passage when original text cannot be established.

## Tested compatibility

| Environment                      | Result                      | Notes                                                   |
| -------------------------------- | --------------------------- | ------------------------------------------------------- |
| Chromium 120+                    | Validated by repository E2E | External/disabled modes retain gestures and collections |
| Firefox                          | Not validated               | No support claim                                        |
| Arbitrary third-party extensions | Not automatically testable  | Passive coexistence only; no private API access         |
| Browser-native translation       | Manual workflow documented  | Not claimed as controlled or automated integration      |

Do not interpret passive mode as universal compatibility. It guarantees only that Ogleans does not compete with the external translator and keeps its independent reading features available.
