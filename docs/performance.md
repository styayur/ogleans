# Performance measurements

Measured on 2026-11-07 from `docs/benchmark.json` using a single local Windows run, Node `v26.7.0` and Chromium `156.0.8078.4`. These are descriptive measurements, not performance guarantees.

## DOM scan, render and restore

| Real DOM nodes | Segments |     Scan |   Render | Restore |
| -------------: | -------: | -------: | -------: | ------: |
|          1,000 |      200 |  22.7 ms |   2.4 ms |  0.4 ms |
|         10,000 |    2,000 |  77.4 ms |  17.6 ms |  0.6 ms |
|         50,000 |   10,000 | 402.7 ms | 104.6 ms |  4.3 ms |

The measurement uses deterministic local content, not a network provider. The 50,000-node case produced 10,000 semantic segments. Dynamic insertion-to-model callback remained within roughly 85–169 ms including the 80 ms mutation debounce.

## Scheduler throughput

Deterministic in-process benchmark:

- 12 paragraph tasks;
- 2 providers;
- provider concurrency 2;
- global concurrency 4;
- 30 ms deterministic work per task.

| Measurement                    |    Result |
| ------------------------------ | --------: |
| Concurrent scheduler run       | 130.68 ms |
| Sequential 12 × 30 ms baseline |    360 ms |
| Observed speedup               |     2.75× |
| Completed                      |        12 |
| Failures                       |         0 |

This demonstrates bounded parallel scheduling and order preservation under deterministic work. It is not a benchmark of Google, OpenAI-compatible or Ollama service latency.

## Distribution size

The raw Chromium build reported by the benchmark was 292,608 bytes including both license files and generated assets. Individual extension scripts were:

- `background.js`: 49,557 bytes;
- `content.js`: 49,042 bytes;
- options page assets: approximately 38 KB including CSS;
- popup assets: approximately 4.6 KB.

ZIP compression reduces the release download. These figures are source/build measurements, not memory or network usage.

## Browser E2E scale

The real Chromium E2E suite uses a 250-paragraph stress fixture with dynamic insertion and editing. Larger 1,000-, 10,000- and 50,000-node scanner cases are exercised by the benchmark. A 1,000-paragraph Chromium fixture caused slow persistent-profile shutdown in the local headless test harness despite zero active jobs and ports, so it is not presented as a stable gate.

## How to reproduce

```sh
pnpm build
pnpm benchmark
pnpm e2e
```

The benchmark writes `docs/benchmark.json`. E2E details are in [e2e-report.md](e2e-report.md).
