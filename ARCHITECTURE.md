# Ogleans architecture

Ogleans is a reading core with three independently usable layers. Translation is an optional capability, not the owner of the page interaction layer or the collection store.

```text
┌──────────────────────────── reading core ────────────────────────────┐
│ Gesture layer              Translation layer          Collection    │
│ recognizer / mappings      scheduler / cache          anchor/store  │
│ floating controls          providers / renderer       search/export  │
└───────────────┬───────────────────┬───────────────────────┬──────────┘
                │                   │                       │
          page DOM / UI       background worker       chrome.storage.local
```

The reusable packages are platform-neutral where possible. The MV3 application composes them and owns browser permissions.

## Independence rules

1. **Gesture layer does not import the translation implementation.** It uses a gesture action registry. Actions may be unavailable in `external` or `disabled` translation mode, but collection, dictionary, navigation and hide actions remain active.
2. **Collection layer does not import translation packages.** It stores selected text, optional translations, source metadata, W3C-compatible selectors, tags, notes and bookmark-export metadata. A translation result is optional data on a collection record, not a storage dependency.
3. **Translation layer does not own collections.** It extracts document segments, schedules provider tasks, caches bounded results and renders text through the Document Adapter. Disabling or replacing it leaves collection data untouched.
4. **Public contracts remain versioned.** Existing v1 kernel, Provider, Adapter, Event and Action APIs remain available. Reading, gesture, scheduler and collection contracts add their own version constants.

## Runtime composition

### Content script

The content script is injected only after an explicit action or keyboard command, using `activeTab` and `scripting`. It creates an isolated shadow-root overlay for reading controls and collection UI. Page content and extension UI are separated:

- `HtmlAdapter` scans eligible page text and excludes `data-ogleans-ui`, generated translation spans, forms, code, math, hidden content and editable regions.
- `GestureRecognizer` observes pointer movement only while the reading layer is active. A click below the movement threshold produces no action. The default trigger is Alt + primary drag, so ordinary clicks and the native context menu are not intercepted.
- `TranslationEngine` reads the document only in `built-in` mode. It streams scheduler completions to `DomRenderer`, which appends text nodes and never injects provider HTML.
- `CollectionStore` anchors a selection with a W3C TextQuoteSelector and TextPositionSelector. The UI captures displayed selections explicitly in passive/external mode rather than claiming that original text is available.

### Service worker

The service worker is the trusted boundary:

- reads full provider configuration;
- keeps API keys and custom headers out of content scripts;
- instantiates providers and the `MultiProviderScheduler`;
- enforces global and per-provider concurrency, rate windows, retry, fallback, timeout and cancellation;
- streams `result`, `failure` and `done` events over a dedicated translation port;
- validates collection messages and owns local collection writes;
- checks optional bookmark permission only when native export is requested.

Provider origins are optional host permissions. Provider requests are HTTPS except loopback HTTP. Redirects are rejected and request credentials are omitted.

## Translation modes

| Mode       | Scheduling | Gestures | Collections | Selection capture                      | External extension coexistence                                       |
| ---------- | ---------- | -------- | ----------- | -------------------------------------- | -------------------------------------------------------------------- |
| `built-in` | Ogleans    | Active   | Active      | Active                                 | Ogleans may insert its own translation spans                         |
| `external` | Disabled   | Active   | Active      | Passive, marked as displayed selection | Ogleans does not mutate translation output or read another extension |
| `disabled` | Disabled   | Active   | Active      | Active on the page DOM                 | Ogleans stays passive                                                |

There is no universal browser API for controlling another extension. Ogleans documents passive compatibility and a user-mediated external capture boundary; it does not read private extension storage or internal messages.

## Scheduling model

Segments have stable IDs for the current adapter session. The scheduler assigns each segment to one provider and keeps the original segment index. Provider selection strategies are:

- `round-robin`;
- `weighted` (smooth weighted round robin);
- `language-aware` (provider language constraints);
- `manual` (per segment ID or index);
- `primary-fallback`.

A paragraph is not sent concurrently to multiple providers. Retry and fallback are sequential after a failure. Provider limits and the global semaphore bound network work. Cancellation aborts active and queued tasks; successful tasks remain available. Results are returned and rendered without changing source order.

The translation cache is bounded to 1,000 entries with a one-hour TTL. Cache keys include source/target, terminology and text. Provider ID is retained in the result.

## Collection persistence

Collections live under the local `ogleans.collections.v1` storage key. The schema preserves:

- stable item ID;
- selected/displayed text and optional original text;
- source URL, title, author and source language;
- available translations with provenance;
- text anchor selectors and Text Fragment navigation;
- tags, note, timestamps and bookmark-export metadata;
- a W3C Web Annotation-compatible annotation object.

No collection operation requires a translation provider to be configured or online. JSON/Markdown export and import are local-only. Browser bookmarks are an optional export destination; Ogleans never uses them as the canonical record.

## Security boundaries

- Full config and secrets are available only to exact extension pages (`popup.html`, `options.html`).
- Content messages must come from the extension ID, a top frame and an HTTP(S) page.
- Translation ports accept bounded segments and never return credentials.
- Storage is restricted to trusted extension contexts.
- Translation text is rendered with `textContent`.
- Collection imports validate fields and limits; exports contain no provider keys or custom headers.
- Bookmark export creates bookmarks and searches for duplicates; it never deletes or overwrites existing browser bookmarks.
- Ogleans has no telemetry, remote code, cloud sync or page-history database.

## Failure behavior

- One failed paragraph does not discard successful paragraphs.
- Provider errors are reported per segment while other providers continue.
- A source page that changes can make a quote or position selector unavailable. The collection remains readable; Ogleans does not claim that every old anchor can be restored.
- Existing bookmarks are preserved even if an item is deleted from Ogleans.
- If a page uses a framework reconciler, generated translation spans may be replaced. The adapter reconciles surviving anchors and scans new content while observation is active.
- Firefox packaging is not validated and is not claimed as supported.

## Package boundaries

```text
packages/gesture/       gesture recognition, conflict detection, action registry
packages/collection/    schema, local store, anchors, search, exports, bookmark HTML
packages/scheduler/     multi-provider assignment, concurrency, rate limits, retries
packages/translation/   streaming document coordinator and scheduler transport
packages/core/          original TranslationKernel and bounded cache
packages/dom/           HTML adapter and mutation handling
packages/renderer/      text-only rendering and restore
packages/provider-api/  provider contract and compatibility router
packages/shared/        versioned document/translation contracts
packages/sdk/           public exports for all reusable layers
apps/browser-extension/ MV3 composition, trusted worker and UI
```

## License boundary

Reusable packages, examples, documentation and test/build support remain MPL-2.0. The full browser application and its distributed bundle remain GPL-3.0-or-later. Third-party dependencies retain their own licenses. See [license boundaries](docs/licensing.md).
