# Contributing

Run `pnpm install`, `pnpm exec playwright install chromium`, `pnpm check` and `pnpm format:check` before opening a pull request. Use deterministic tests for provider/scheduler behavior; never commit API keys, private browsing content or paid-service fixtures.

## Architecture admission rule

Ogleans is deliberately not an all-in-one translation or knowledge-management application. A feature enters the browser application only when it supports the gesture reading layer, composable translation scheduling, independent local collections, browser integration or security/performance requirements.

Keep the three layers separate:

- gesture code must not import the translation coordinator;
- collection code must not import provider/scheduler/translation implementations;
- translation code must not own collection persistence;
- browser permissions and secrets remain in trusted extension contexts;
- collection, gesture and external-translation tests must continue when built-in translation is disabled.

Unrelated accounts, cloud sync, AI chat, TTS/STT, OCR, vocabulary learning, media processing and full knowledge management are out of scope.

## Public contracts

Changes to exported APIs need documentation, versioning consideration and compatibility tests. Event payloads must remain serializable. Preserve cancellation and ownership cleanup for observers, timers, listeners, translation ports and requests.

## Licensing

Each source file follows its directory's license boundary. Keep SPDX headers and third-party attribution. Contributions are licensed under the same terms; no copyright assignment is required. A release must pass CI, include SHA-256 checksums, disclose unverified platform/site behavior and link its source commit.

## Release gates

Do not claim a stable release until:

- collections work with translation disabled;
- multiple providers translate concurrently;
- gestures are reliable in a real Chromium extension;
- v1 configuration and stored data migration are tested;
- the real browser E2E suite passes;
- release assets include checksums and known limitations.
