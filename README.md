# Translation Kernel

[简体中文](README.zh-CN.md) · [CI](https://github.com/styayur/translation-kernel/actions) · [v0.1.0](https://github.com/styayur/translation-kernel/releases/tag/v0.1.0) · [中文交付报告](docs/DELIVERY_REPORT.zh-CN.md)

A lightweight translation kernel for the browser.

**Project stage:** Early preview, with a published v0.1.0 Chromium package; Firefox delivery and universal site compatibility are unverified.

![Translation Kernel v0.1.0 extension settings showing language, display and provider configuration in a fresh Chromium profile](docs/assets/extension-settings-v0.1.0.png)

Real Chromium extension settings, captured with a fresh profile and no API keys.
This shows configuration, not a translation-quality claim. [Capture steps](docs/README_SCREENSHOTS.md).

Translation Kernel provides primitives and APIs; external tools provide workflows.

Small core, rich API, loose coupling, composable tools. The core discovers webpage text, builds semantic segments, schedules translation providers and renders reversible bilingual text. No accounts or backend are required.

## What this project is

- A pure TypeScript microkernel with a document model independent of HTML.
- An on-demand Chromium Manifest V3 extension with a compact popup and settings page.
- Versioned Provider, Action, Event and Document Adapter contracts for external integrations.
- Batched translation with bounded context, cancellation, retries, fallback and an in-memory LRU cache.

## What this project is NOT

An AI assistant, language learning application, TTS engine, STT engine, subtitle application, cloud sync service, knowledge manager or web archive. PDF, EPUB, OCR, media, vocabulary, accounts and synchronization belong in external adapters and tools.

## Install v0.1.0

1. Download `translation-kernel-chromium-v0.1.0.zip` from [Releases](https://github.com/styayur/translation-kernel/releases).
2. Extract it. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the folder containing `manifest.json`.
3. Open the extension's settings. Set source/target languages and save to grant access to the configured provider origins.
4. Open an ordinary HTTP(S) article. Click **Translate**. Choose Original, Translation or Bilingual. **Restore** removes translations and stops observation.

The Chrome Web Store is not part of this release. Firefox architecture is reserved through the adapter and WebExtension boundaries; Firefox packaging has not been validated.

Shortcuts: `Alt+T` translate, `Alt+R` restore, `Alt+B` toggle bilingual. Change them at `chrome://extensions/shortcuts`. Grant provider permissions in settings before using shortcuts. Browser pages, extension stores and restricted origins cannot be translated.

## Providers

| Kind              | Base URL example                   | Notes                                                                                                 |
| ----------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Google            | `https://translate.googleapis.com` | Keyless convenience endpoint; unofficial, availability and limits are not guaranteed.                 |
| OpenAI-compatible | `https://your-provider.example/v1` | `/chat/completions`, model, optional key, custom headers and timeout. JSON batch output is validated. |
| Ollama-compatible | `http://127.0.0.1:11434`           | `/api/chat`, model and JSON output. A local service may need its origin/CORS settings adjusted.       |

Providers are separate example modules composed by the application. The core has no vendor-specific networking. v0.1 uses non-streaming batches; the provider interface permits future streaming adapters without changing DOM rendering. Configure primary and fallback IDs in settings. Each failed batch is retried once, then sent to fallback. Google internally makes sequential per-segment requests because its convenience endpoint has no stable batch contract.

Page text and bounded title context are sent to your chosen provider only after you request translation. HTTPS is required except for local loopback HTTP. Keys are local, unencrypted and unavailable to content scripts; exports omit keys and all custom headers. Translation text is always rendered as text, including model-generated markup. No telemetry, remote code or persistent page history.

## Configuration and actions

Import/export uses `config.json` with `schemaVersion: 1`. Imported settings are staged for review; **Save settings** validates them and requests provider permissions. Reset restores defaults. Choose All configuration, Providers, Site rules or URL actions when exporting to produce `config.json`, `providers.json`, `rules.json` or `actions.json`. Import accepts all four formats; a part updates only its corresponding section. Provider exports include primary/fallback IDs but omit keys and headers. Provider secrets must be entered again after import.

Example custom action (paste the array into Actions JSON):

```json
[
  {
    "id": "wiktionary",
    "name": "Wiktionary",
    "urlTemplate": "https://en.wiktionary.org/wiki/{text}",
    "openMode": "tab"
  }
]
```

Select text on the page, open the popup, then run the action. Templates are restricted to HTTP(S) and text is URL-encoded. External AI destinations may change their query behavior; the kernel only opens the URL.

## Develop

Use Node.js 24+ (the CI version) and pnpm 12.4.2. The source manifest declares a minimum of Node.js 22.12; CI validates Node.js 24.

```sh
git clone https://github.com/styayur/translation-kernel.git
cd translation-kernel
pnpm install
pnpm exec playwright install chromium
pnpm check
pnpm benchmark
pnpm package
```

`pnpm check` runs lint, strict type checking, unit/DOM tests, production build and real extension E2E tests. CI also checks formatting and dependency advisories. E2E uses a deterministic local HTTP provider, without API keys or paid services. Install Linux browser dependencies with `pnpm exec playwright install --with-deps chromium`. `TK_CHROMIUM_PATH` optionally selects an existing Chromium executable for diagnostics.

Output: `dist/chromium/` installable extension; `dist/sdk/` ESM SDK; `release/` ZIPs and SHA-256 checksums. Runtime dependencies: none. Benchmark measurements and practical limitations are recorded in [verification](docs/verification.md) and [benchmark data](docs/benchmark.json).

## APIs and repository

```text
apps/browser-extension/  MV3 application and native HTML settings
packages/core/          scheduler orchestration and cache
packages/dom/           HTML adapter, anchors, incremental mutation scan
packages/segmenter/     sentence segmentation and conservative script detection
packages/renderer/      pure-text rendering and restore
packages/provider-api/  provider registry, timeout, retry, fallback
packages/action-api/    action registry and safe URL templates
packages/event-api/     typed, isolated event delivery
packages/adapter-api/   universal document adapter contract
packages/rules/         default, community, user rule resolution
packages/config/        validation and secret-redacted portability
packages/shared/        universal document model and API version
packages/sdk/           public API exports
examples/               providers, actions, memory adapter and bridge projections
tests/                  unit, DOM, actual Chromium extension E2E
docs/                   contracts, architecture and verification evidence
```

See [Architecture](ARCHITECTURE.md), [Provider API](docs/provider-api.md), [Action API](docs/action-api.md), [Event API](docs/event-api.md), [Adapter API](docs/adapter-api.md), [Site rules](docs/site-rules.md) and [Contributing](CONTRIBUTING.md).

## Architecture

<!-- architecture:overview:start -->

```mermaid
flowchart TB
  subgraph page[Content script / page DOM boundary]
    DOM[HtmlAdapter: scan and segment]
    Kernel[TranslationKernel: batches and cache]
    Render[DomRenderer: bilingual text]
    Restore[restore: abort and remove translations]
    DOM --> Kernel
    Kernel -->|validated results| Render
    Kernel -->|user Restore / pagehide| Restore --> DOM
  end
  subgraph worker[Extension service worker]
    Guard[Validate sender and batch]
    Router[ProviderRouter: retry and fallback]
    Config[(chrome.storage.local / trusted contexts)]
    Guard --> Router
    Config --> Router
  end
  Kernel <-->|runtime messages; no provider secrets| Guard
  Router <-->|HTTPS or loopback HTTP| Providers[Google / OpenAI-compatible / Ollama]
```

<!-- architecture:overview:end -->

This is the Chromium extension composition. A standalone SDK consumer supplies its own DocumentAdapter and ProviderRouter; it does not require an extension worker. HtmlAdapter applies site rules, segments eligible text and observes DOM changes. The kernel batches up to 16 segments and caches translations in memory.

The content bridge sends batches and cancellation messages to the worker. The worker validates extension identity, top-frame origin, batch limits and request IDs before invoking providers with retry/fallback. Stored credentials remain in trusted extension contexts, but are not encrypted at rest. DomRenderer assigns textContent rather than executing provider markup. Restore aborts work, disconnects observation and restores original text; it is not a persistent page-history system.

[Source evidence and diagram verification](docs/architecture/README.md).

## License

This repository follows [styayur’s license policy](https://github.com/styayur/styayur/blob/main/LICENSE_POLICY.md), using separate terms for the library and application:

- **Reusable kernel, SDK, example modules, project documentation and test/build support:** [MPL-2.0](LICENSE). File-level copyleft preserves changes to the reusable engine while permitting independently licensed integrations. Documentation describes this software and is distributed with it.
- **Browser application (`apps/browser-extension/`), including its bundled distributed form:** [GPL-3.0-or-later](apps/browser-extension/LICENSE), as required for full applications. The included MPL-covered files remain under MPL in source; they are compatible with this combined GPL distribution under MPL 2.0 Section 3.3.
- **Third-party dependencies:** their original terms apply. They are never relicensed. See [NOTICE](NOTICE) and [THIRD_PARTY.md](THIRD_PARTY.md).

This is not an entirely MPL-licensed application. Separate third-party providers and tools can choose their own terms, subject to the licenses of any files they copy or combine. See [license boundaries](docs/licensing.md).

## Limitations, roadmap and contributing

v0.1 uses non-streaming batches, local unencrypted provider secrets and on-demand Chromium permissions. Restricted browser pages cannot be translated; provider availability, quality and cost remain external concerns. Streaming adapters and Firefox packaging are future integration work, not current delivery.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before a PR; run `pnpm check` and `pnpm format:check`. Use [Issues](https://github.com/styayur/translation-kernel/issues) with a small local fixture and expected restore behavior. Never submit API keys, personal browsing content or paid-service fixtures.
