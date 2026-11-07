# Ogleans v0.2.0-alpha.1

A Chromium MV3 reading layer with replaceable translation and independent local collections.

- Three independent layers: gestures, translation scheduling and collections.
- Explicit translation modes: `built-in`, `external` and `disabled`.
- Configurable mouse gestures, keyboard alternatives, conflict detection and floating controls.
- Concurrent multi-provider paragraph scheduling with bounded concurrency and rate windows.
- Round-robin, weighted, language-aware, manual and primary/fallback distribution.
- Streaming partial completion with stable source order.
- Independent W3C-compatible collection records, robust anchors, tags, notes, search, JSON/Markdown import/export.
- Optional native browser bookmark export that preserves existing bookmarks, plus permission-free HTML fallback.
- v1 configuration migration and legacy collection-key support.
- English and Chinese README, migration guide, API/schema documentation, performance data and real Chromium E2E evidence.

## Downloads

`ogleans-chromium-v0.2.0-alpha.1.zip`: extract, open `chrome://extensions`, enable Developer mode and load unpacked.

`ogleans-sdk-v0.2.0-alpha.1.zip`: reusable ESM library and TypeScript declarations.

`SHA256SUMS.txt`: verify both ZIPs.

## Known limitations

Chromium is validated. Firefox packaging is not validated and is not claimed as supported. Other translation extensions cannot be universally controlled; Ogleans offers passive external mode and user-mediated display capture. Cross-origin iframes, shadow roots, provider service quality and arbitrary page-change anchor restoration remain external or explicitly limited. No cloud sync, accounts, telemetry, AI chat, TTS/STT, OCR, vocabulary training or full knowledge management are included.

Full architecture, API, collection schema, tests and compatibility: [README](https://github.com/styayur/ogleans/blob/v0.2.0-alpha.1/README.md), [E2E report](https://github.com/styayur/ogleans/blob/v0.2.0-alpha.1/docs/e2e-report.md), [performance](https://github.com/styayur/ogleans/blob/v0.2.0-alpha.1/docs/performance.md) and [migration](https://github.com/styayur/ogleans/blob/v0.2.0-alpha.1/docs/migration-v0.2.md).
