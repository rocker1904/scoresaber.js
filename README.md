# scoresaber.js

Typed Node.js client for the [ScoreSaber v2 API](https://scoresaber.com/api/docs).

- Response types generated from the live OpenAPI spec — re-runnable via `npm run gen:types`
- Best-effort tracking of the three tiered rate-limit buckets (`long`/`medium`/`short`) with auto-wait when exhausted (opt-out for fail-fast)
- Resilient by default: per-request timeout, and retries on HTTP 429/5xx and transient network errors with backoff
- Lazy pagination via `AsyncIterable` — consumers control how much to fetch
- Ships ESM **and** CommonJS; native `fetch`, zero runtime dependencies
- Typed error hierarchy under `ScoreSaberError` so consumers can catch broadly or by code

Requires Node.js 20.3 or newer (for `AbortSignal.any`).

## Install

```
npm install scoresaber.js
```

Works in both module systems:

```ts
import {ScoreSaberClient} from 'scoresaber.js'; // ESM
const {ScoreSaberClient} = require('scoresaber.js'); // CommonJS
```

## Quick start

```ts
import {ScoreSaberClient, collect} from 'scoresaber.js';

const ss = new ScoreSaberClient();

// Single resource fetches
const me = await ss.players.get('76561198166289091');
console.log(`${me.name} is rank #${me.stats.rank} (${me.stats.totalPP} pp)`);

// Lazy pagination — up to 100 players from Great Britain (gb)
const gbTop = await collect(ss.players.list({countries: 'gb'}), 100);

// Filters are typed straight from the spec — e.g. ranked maps, 8★+, by stars
const hardest = await collect(ss.leaderboards.list({status: ['RANKED'], minStars: 8, sortBy: 'stars'}), 20);

// Or iterate freely
for await (const score of ss.players.scores(me.id, {sort: 'recent'})) {
    if (score.score.pp < 100) break;
    console.log(score.leaderboard.map.songName, score.score.pp);
}
```

## Client options

```ts
new ScoreSaberClient({
    baseUrl?: string,            // default https://scoresaber.com/api/v2
    realmId?: number,            // applied to every request; default = active realm
    waitForRateLimit?: boolean,  // default true; false = throw RateLimitedError
    timeoutMs?: number,          // default 30000; per network attempt (not rate-limit waits)
    maxRetries?: number,         // default 2; retries 429/5xx/network errors
    userAgent?: string,          // override the default User-Agent
    maxResponseBytes?: number,   // reject responses larger than this
    onRequest?: (ctx) => void,   // hook: before each request attempt
    onResponse?: (ctx) => void,  // hook: after each response
    fetch?: typeof fetch,        // injectable for tests / custom agents
});
```

### Per-call request options

Every method takes an optional final `{ signal, headers, realmId }` so you can
cancel a request, attach one-off headers, or target a specific realm. Your
`signal` is composed with the client timeout, so whichever fires first wins:

```ts
const controller = new AbortController();
const p = ss.players.get('76561198166289091', {signal: controller.signal});
controller.abort(); // -> rejects with your reason, unwrapped

await ss.players.getBasic(id, {headers: {'x-trace-id': 'abc'}});
```

Header names are matched case-insensitively, so `{headers: {'User-Agent': '…'}}` replaces the default rather than appending.

### Realms

`realmId` defaults to the API's active realm; set a client-wide default with
`new ScoreSaberClient({realmId})`. To target another realm, override per call or
take a scoped handle — **both reuse the one client and its shared rate-limit
budget** (don't spin up a second client per realm: their limiters wouldn't
coordinate and you'd oversubscribe the API):

```ts
// one-off override
await ss.players.list({countries: 'gb'}, {realmId: 2});

// scoped handle for a batch of calls in one realm
const r2 = ss.realm(2);
await r2.players.list({countries: 'gb'});
await r2.leaderboards.get(123);
```

### Page-level iteration

`list`/`scores` iterate individual items. To work page-by-page (with
`metadata`), wrap the `*Page` method with the exported `pages` helper:

```ts
import {pages} from 'scoresaber.js';

for await (const page of pages((page) => ss.players.listPage({page}))) {
    console.log(`page ${page.metadata?.page} of ${page.metadata?.totalPages}`);
}
```

## Available namespaces

The public read endpoints from the v2 spec are wrapped. Admin/auth/user-me endpoints are not (they require an auth flow this library does not implement).

| Namespace             | Methods                                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.players`      | `get(id)`, `getBasic(id)`, `list(opts)`, `listPage(opts)`, `atRank(rank, opts)`, `scores(id, opts)`, `scoresPage(id, opts)`, `count()`, `aliases(id)`, `history(id)`, `globalHistory(id)`                                                         |
| `client.leaderboards` | `get(id)`, `list(opts)`, `listPage(opts)`, `scores(id, opts)`, `scoresPage(id, opts)`, `byHash(hash)`, `byHashDifficulty(hash, mode, difficulty)`, `scoresByHash(hash, mode, difficulty, opts)`, `scoresPageByHash(hash, mode, difficulty, opts)` |
| `client.scores`       | `get(id)`, `history(id)`, `stats(id)`, `replay(id)` (returns `ArrayBuffer`)                                                                                                                                                                       |
| `client.maps`         | `get(id)`, `list(opts)`, `listPage(opts)`                                                                                                                                                                                                         |
| `client.realms`       | `list()`, `get(id)`                                                                                                                                                                                                                               |
| `client.rankingQueue` | `list(opts)`, `listPage(opts)`, `get(id)`                                                                                                                                                                                                         |
| `client.health()`     | Liveness check                                                                                                                                                                                                                                    |

The `list` variants return `AsyncIterable<T>` and paginate as you iterate. The `listPage` variants return the raw `{data, metadata}` envelope for one page.

Boolean-style filter params (e.g. `verified`, `hideNA`, `includePlayerScore`) are passed as the **strings** `'true'`/`'false'`, matching the v2 spec — `{verified: 'true'}`, not `{verified: true}`.

## Rate limit handling

The client reads `x-ratelimit-remaining-{long,medium,short}` and `x-ratelimit-reset-{long,medium,short}` from each response and tracks every bucket independently, reserving capacity before each request so concurrent calls can't oversubscribe a bucket. When `waitForRateLimit: true` (default), it sleeps until the most-constrained bucket resets, and retries (up to `maxRetries`) if the API still returns HTTP 429 — honouring `Retry-After`. Set `waitForRateLimit: false` to throw `RateLimitedError` instead.

`RateLimitedError` is the single type for both cases: a proactive throw (a tracked bucket is exhausted; `bucket` is set) and a server 429 the client won't retry (`status` is `429` and `url` is set; `bucket` is `undefined`). Either way `resetAt` tells you when to try again (`0` if unknown).

> These rate-limit header names are not part of the published OpenAPI spec; the limiter treats them as best-effort. If a header is absent or unrecognised, the corresponding bucket stays unbounded (no gating) rather than guessing. The opt-in integration suite verifies the contract against the live API.

A rate-limit wait isn't bounded by `timeoutMs` (that's per network attempt) — it ends when the window resets or when you abort the call's `signal`, whichever comes first.

> **Waiting is per-client, not per-call.** Because every request on a client shares one limiter, a wait blocks _all_ queued requests on that client until the window resets. For a service that mixes latency-sensitive calls with bulk work, either pass a per-call `signal` (with your own deadline) to the interactive calls, or use `waitForRateLimit: false` and schedule retries yourself — don't let one exhausted bucket stall everything.

```ts
import {RateLimitedError} from 'scoresaber.js';

const ss = new ScoreSaberClient({waitForRateLimit: false});
try {
    await ss.players.get(id);
} catch (e) {
    if (e instanceof RateLimitedError) {
        // e.bucket: 'long' | 'medium' | 'short' | undefined (undefined for a server 429)
        // e.resetAt: unix ms (0 if unknown)
        // e.status: 429 when the server reported it; e.url: the request URL
    }
}
```

You can also read live state: `client.rateLimit.long.remaining`, `client.rateLimit.short.resetAt`, etc.

## Errors

Every error extends `ScoreSaberError`, so you can catch broadly or narrow by type:

| Error                    | Thrown when                                                     | Useful fields                                 |
| ------------------------ | --------------------------------------------------------------- | --------------------------------------------- |
| `ScoreSaberAPIError`     | Non-2xx response                                                | `status`, `code`, `message`, `details`, `url` |
| `RateLimitedError`       | Bucket exhausted (`waitForRateLimit:false`) or an unretried 429 | `bucket`, `resetAt`, `status`, `url`          |
| `ScoreSaberTimeoutError` | Request exceeds `timeoutMs`                                     | `url`, `timeoutMs`, `cause`                   |
| `ScoreSaberNetworkError` | fetch fails (DNS, reset, offline)                               | `url`, `cause`                                |

```ts
import {ScoreSaberAPIError} from 'scoresaber.js';

try {
    await ss.players.get('nonexistent');
} catch (e) {
    if (e instanceof ScoreSaberAPIError && e.code === 'NOT_FOUND') {
        // e.status, e.code, e.message, e.details, e.url
    }
}
```

A caller-supplied `AbortSignal` that fires is **not** wrapped — your own abort
reason propagates unchanged.

## WebSocket score feed

The live score feed endpoint is unchanged from v1; this library exports the URL but does not wrap the WebSocket itself — use any `ws` client.

```ts
import {SCORESABER_WS_URL} from 'scoresaber.js';
import WebSocket from 'ws';

const feed = new WebSocket(SCORESABER_WS_URL);
feed.on('message', (msg) => {
    /* ... */
});
```

## Updating types when the API changes

```
npm run fetch-spec    # refresh spec/openapi.json from the live docs
npm run gen:types     # regenerate src/generated/openapi-types.ts
```

A weekly **Spec sync** workflow does this automatically and opens a PR when the
spec changes. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow
(API report, changesets, releases).

## Tests

```
npm test                              # offline unit + contract suites, mock fetch
SCORESABER_INTEGRATION=1 npm test     # also hits the live API
```
