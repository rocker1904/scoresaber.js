---
'scoresaber.js': minor
---

Rate limiting now waits out limits instead of throwing. With `waitForRateLimit: true` (the default), a server `429` is waited out — honouring `Retry-After`, else the tracked bucket reset, else backoff — and retried until it clears, rather than throwing `RateLimitedError` after `maxRetries`. Buckets are tracked as monotonic per-window usage, so concurrent callers sharing a client can no longer overshoot a window via an optimistic header snapshot. Each bucket now also exposes a read-only `limit` (and `used`) on `client.rateLimit`. `maxRetries` continues to govern 5xx/network retries only, and `waitForRateLimit: false` is unchanged (still throws).
