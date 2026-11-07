# Provider scheduling v1

Ogleans schedules paragraph-level tasks across multiple providers. The scheduler is reusable outside the extension; the MV3 worker composes it with provider configurations and a streaming port.

## Assignment

| Strategy           | Behavior                                                                  |
| ------------------ | ------------------------------------------------------------------------- |
| `round-robin`      | Providers receive segments in configured order                            |
| `weighted`         | Smooth weighted round robin according to provider weight                  |
| `language-aware`   | Filters providers by language declarations before weighted selection      |
| `manual`           | Maps segment ID or segment index to a provider ID                         |
| `primary-fallback` | Assigns all work to primary; fallback is attempted after terminal failure |

Language declarations accept `*`, a source or target language such as `en`, or a pair such as `en->zh`.

Each segment is assigned to one provider at a time. Without a comparison mode, the same segment is not sent concurrently to multiple providers.

## Bounds

- Global concurrency is clamped to `1..16`.
- Provider concurrency is clamped to `1..8`.
- Provider request windows accept `{requests, windowMs}` and use a queued window limiter.
- A provider worker cannot exceed its own concurrency or the global semaphore.
- Retry count is capped at `0..3`.
- Request timeout is bounded to `100..120000 ms`.

## Retry and fallback

A retry is attempted only for errors considered retryable, including timeout, network failure, HTTP 408, 425, 429 and 5xx. Invalid provider payloads and non-retryable failures skip same-provider retries.

Fallback is sequential. The provider chain starts with the assigned provider and can include explicit fallback IDs and providers marked as fallback. `fallbackEnabled: false` disables fallback. A failed provider attempt is never merged with a concurrent duplicate request.

## Streaming and ordering

The scheduler emits task state changes and successful results as they complete. The summary includes:

- `tasks` sorted by original segment index;
- `results` sorted by original segment index;
- `failures` isolated per segment;
- `cancelled`;
- elapsed duration.

The DOM renderer may render completed paragraphs immediately. Source order is maintained by stable segment IDs and original anchors, not by completion order.

## Cancellation and partial success

Aborting the parent signal cancels queued and active work. Active provider calls receive an AbortSignal and are raced against cancellation. Completed results remain in the summary. A failure for one segment does not reject successful segments from other providers.

## Cache

The streaming translation coordinator uses a bounded LRU cache:

- 1,000 entries;
- one-hour TTL;
- cache key includes source language, target language, terminology context and source text;
- cached results retain provider provenance when stored as a result object.

The scheduler itself is network/orchestration focused; cache placement remains a coordinator responsibility.

## Terminology context

A bounded terminology/glossary string may be passed through `TranslationContext.terminology`. Built-in OpenAI-compatible and Ollama-compatible prompt adapters include it as page context. It is not sent to a provider unless built-in translation is explicitly invoked.

## Events

The scheduler exposes `onTask`, `onResult` and `onFailure` hooks. The browser worker forwards these over `ogleans.translation` and the content coordinator updates the renderer incrementally.

## Limits and non-goals

- No unlimited fan-out.
- No cross-provider consensus or comparison mode in v0.2.0-alpha.1.
- No provider-specific adaptive circuit breaker.
- No promise of identical terminology across providers; shared context is best-effort.
- Provider service quality, rate-limit policy and cost remain external responsibilities.
