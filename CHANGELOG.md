# scoresaber.js

## 1.2.0

### Minor Changes

- 2d29877: Rate limiting now waits out limits instead of throwing. With `waitForRateLimit: true` (the default), a server `429` is waited out — honouring `Retry-After`, else the tracked bucket reset, else backoff — and retried until it clears, rather than throwing `RateLimitedError` after `maxRetries`. Buckets are tracked as monotonic per-window usage, so concurrent callers sharing a client can no longer overshoot a window via an optimistic header snapshot. Each bucket now also exposes a read-only `limit` (and `used`) on `client.rateLimit`. `maxRetries` continues to govern 5xx/network retries only, and `waitForRateLimit: false` is unchanged (still throws).

## 1.1.0

### Minor Changes

- d61827f: Raise the minimum supported Node.js to 22 (Node 20 reached end-of-life). CI now runs on Node 22, 24, and 26.

## 1.0.0

### Major Changes

- 10e11a2: First stable release (1.0.0). The client is now built for the ScoreSaber **v2** API end to end.
    - **Spec-derived types** regenerated from the live OpenAPI spec, with offline path/type contracts and a weekly spec-sync workflow to catch drift.
    - **Resilient HTTP layer**: per-request timeout, retries on HTTP 429/5xx and transient network errors with jittered backoff, optional `maxResponseBytes` cap (enforced even without `Content-Length`), and per-call `signal`/`headers`/hooks.
    - **Typed error hierarchy** under `ScoreSaberError`. `RateLimitedError` now covers both a proactively exhausted bucket and an unretried server `429` (carrying `bucket?`, `resetAt`, `status?`, `url?`).
    - **Best-effort tiered rate-limit tracking** (`long`/`medium`/`short`) with auto-wait or fail-fast (`waitForRateLimit`).
    - **Lazy `AsyncIterable` pagination** plus `*Page` accessors for raw envelopes.
    - **Dual ESM/CJS** build with a locked-down `exports` map; zero runtime dependencies. Requires Node.js 20.3+.
