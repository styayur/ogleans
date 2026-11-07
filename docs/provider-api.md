# Provider API v1 and scheduling composition

`TranslationProvider` receives ID-bearing segments, a bounded `TranslationContext` and an AbortSignal. It returns exactly one non-empty result per segment with the same IDs. Provider output is validated before rendering.

```ts
interface TranslationProvider {
  readonly id: string;
  readonly name: string;
  translate(
    segments: TranslationSegment[],
    context: TranslationContext,
    options?: TranslationOptions,
  ): Promise<TranslationResult[]>;
}
```

The v1 `ProviderRouter` remains available for compatibility and primary/fallback batch routing. New Ogleans browser translation uses `MultiProviderScheduler` with:

- round-robin, weighted, language-aware, manual and primary/fallback assignment;
- global and provider concurrency;
- provider request windows;
- retry only for retryable failures;
- sequential fallback after terminal failure;
- cancellation and partial success;
- ordered summary results.

See [Provider scheduling](provider-scheduling.md) for the full contract.

## Provider configuration

Built-in provider types:

- `google`: fixed `https://translate.googleapis.com` convenience endpoint;
- `openai`: OpenAI-compatible `/chat/completions`;
- `ollama`: local or compatible `/api/chat`.

Endpoints must use HTTPS except loopback HTTP. Credentials, queries and fragments are rejected in base URLs. Custom headers reject `Host`, `Cookie`, `Origin`, `Referer`, `Content-Length` and newline injection.

Provider policies include `enabled`, `concurrency`, `weight`, language declarations and `{requests, windowMs}` rate limits. Config validation bounds all values.

## Context and terminology

`TranslationContext` carries bounded title, URL, source/target language, document language, previous/next segment context and an optional bounded `terminology` string. OpenAI-compatible and Ollama-compatible prompt examples include terminology as data. It is sent only when built-in translation is explicitly invoked.

## Security

- Provider keys and custom headers live only in the trusted extension worker.
- Content scripts receive public settings without provider secrets.
- Fetch uses `credentials: 'omit'` and `redirect: 'error'`.
- Provider response size is bounded.
- Model output is parsed as data and rendered as text.

## Example

See [adapter example](adapter-api.md) and [Ollama provider example](../examples/providers/src/index.ts). External adapters can implement the same provider contract without using the extension application.
