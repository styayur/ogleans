# Architecture evidence

Source review: working tree for Ogleans `v0.2.0-alpha.1` (2026-11-07).

The marked Mermaid block in [README](../../README.md) is the maintained overview diagram source. GitHub renders it natively. The verifier extracts that block and can render it repeatedly with deterministic Mermaid IDs.

## Source map

- [packages/gesture/src/index.ts](../../packages/gesture/src/index.ts): `class GestureRecognizer`, `detectGestureConflicts`, `keyboardMatches`
- [packages/scheduler/src/index.ts](../../packages/scheduler/src/index.ts): `class MultiProviderScheduler`, `class WindowRateLimiter`, `class Semaphore`
- [packages/translation/src/index.ts](../../packages/translation/src/index.ts): `class TranslationEngine`, `interface TranslationTransport`, `createSchedulerTransport`
- [packages/collection/src/index.ts](../../packages/collection/src/index.ts): `class CollectionStore`, `createTextAnchor`, `resolveTextAnchor`, `annotationFor`
- [packages/dom/src/index.ts](../../packages/dom/src/index.ts): `class HtmlAdapter`, `MutationObserver`, `segmentText`
- [packages/renderer/src/index.ts](../../packages/renderer/src/index.ts): `class DomRenderer`, `data-ogleans-translation`
- [apps/browser-extension/src/background.ts](../../apps/browser-extension/src/background.ts): `TRUSTED_CONTEXTS`, `sender.frameId !== 0`, `chrome.runtime.onConnect`, `exportBookmarks`
- [apps/browser-extension/src/content.ts](../../apps/browser-extension/src/content.ts): `class OgleansUI`, `selectionSnapshot`, `collection.create`, `ogleans.translation`
- [tests/e2e/extension.spec.ts](../../tests/e2e/extension.spec.ts): `for (const mode of ['disabled', 'external'])`, `two providers`, `mouse gesture`
- [tests/e2e/bookmarks.spec.ts](../../tests/e2e/bookmarks.spec.ts): `Existing bookmark`, `HTML bookmark`, `bookmarks`

The anchors detect renames/deletions. They do not prove call semantics. The source review checked the actual call sites, data flow and trust boundaries.

## Boundaries verified

- Gesture and collection packages do not import the translation coordinator.
- Content scripts receive public configuration without providers or credentials.
- Translation scheduling and provider calls occur in the trusted worker.
- The renderer assigns translation output with `textContent`.
- Collection storage is local and exports omit provider secrets.
- Native bookmarks are optional and never deleted by Ogleans.

## Verification

From the repository root:

```sh
python docs/architecture/verify.py --render
```

This checks local README image references, source anchors, the authoritative Mermaid block, deterministic rendering, SVG XML and light/dark output. Pass `--chrome` if a browser executable is needed by Mermaid CLI. Output goes to a temporary directory and is not part of the application runtime.
