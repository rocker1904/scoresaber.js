# scoresaber.js

Typed Node.js client for the [ScoreSaber v2 API](https://scoresaber.com/api/docs).

- Response types generated from the live OpenAPI spec — re-runnable via `npm run gen:types`
- Tracks the three tiered rate-limit buckets (`long`/`medium`/`short`) and auto-waits when exhausted (opt-out for fail-fast)
- Lazy pagination via `AsyncIterable` — consumers control how much to fetch
- Native `fetch`, zero runtime dependencies
- Structured error type (`ScoreSaberAPIError`) so consumers can catch by code

Requires Node.js 20 or newer.

## Install

```
npm install scoresaber.js
```

## Quick start

```ts
import {ScoreSaberClient, collect} from 'scoresaber.js';

const ss = new ScoreSaberClient();

// Single resource fetches
const me = await ss.players.get('76561198166289091');
console.log(`${me.name} is rank #${me.stats.rank} (${me.stats.totalPP} pp)`);

// Lazy pagination — fetch up to 100 GB players
const gbTop = await collect(ss.players.list({countries: 'gb'}), 100);

// Or iterate freely
for await (const score of ss.players.scores(me.id, {sort: 'recent'})) {
    if (score.score.pp < 100) break;
    console.log(score.leaderboard.songName, score.score.pp);
}
```

## Client options

```ts
new ScoreSaberClient({
    baseUrl?: string,            // default https://scoresaber.com/api/v2
    realmId?: number,            // applied to every request; default = active realm
    waitForRateLimit?: boolean,  // default true; false = throw RateLimitedError
    fetch?: typeof fetch,        // injectable for tests / custom agents
});
```

## Available namespaces

All 24 public-read endpoints from the v2 spec are wrapped. Admin/auth/user-me endpoints are not (they require an auth flow this library does not implement).

| Namespace | Methods |
|---|---|
| `client.players` | `get(id)`, `getBasic(id)`, `list(opts)`, `listPage(opts)`, `atRank(rank, opts)`, `scores(id, opts)`, `scoresPage(id, opts)`, `count()`, `aliases(id)`, `history(id)`, `globalHistory(id)` |
| `client.leaderboards` | `get(id)`, `list(opts)`, `listPage(opts)`, `scores(id, opts)`, `scoresPage(id, opts)`, `byHash(hash)`, `byHashDifficulty(hash, mode, difficulty)`, `scoresByHash(hash, mode, difficulty, opts)`, `scoresPageByHash(hash, mode, difficulty, opts)` |
| `client.scores` | `get(id)`, `history(id)`, `stats(id)`, `replay(id)` (returns `ArrayBuffer`) |
| `client.maps` | `get(id)`, `list(opts)`, `listPage(opts)` |
| `client.realms` | `list()`, `get(id)` |
| `client.rankingQueue` | `list(opts)`, `listPage(opts)`, `get(id)` |
| `client.health()` | Liveness check |

The `list` variants return `AsyncIterable<T>` and paginate as you iterate. The `listPage` variants return the raw `{data, metadata}` envelope for one page.

## Rate limit handling

The client reads `x-ratelimit-{limit,remaining,reset}-{long,medium,short}` from every response and tracks each bucket independently. When `waitForRateLimit: true` (default), `checkin()` sleeps until the most-constrained bucket resets before each request. Set `waitForRateLimit: false` to throw `RateLimitedError` instead.

```ts
import {RateLimitedError} from 'scoresaber.js';

const ss = new ScoreSaberClient({waitForRateLimit: false});
try {
    await ss.players.get(id);
} catch (e) {
    if (e instanceof RateLimitedError) {
        // e.bucket: 'long' | 'medium' | 'short'
        // e.resetAt: unix ms
    }
}
```

You can also read live state: `client.rateLimit.long.remaining`, `client.rateLimit.short.resetAt`, etc.

## Errors

Non-2xx responses throw `ScoreSaberAPIError`:

```ts
import {ScoreSaberAPIError} from 'scoresaber.js';

try {
    await ss.players.get('nonexistent');
} catch (e) {
    if (e instanceof ScoreSaberAPIError && e.code === 'NOT_FOUND') {
        // e.status, e.code, e.message, e.details
    }
}
```

## WebSocket score feed

The live score feed endpoint is unchanged from v1; this library exports the URL but does not wrap the WebSocket itself — use any `ws` client.

```ts
import {SCORESABER_WS_URL} from 'scoresaber.js';
import WebSocket from 'ws';

const feed = new WebSocket(SCORESABER_WS_URL);
feed.on('message', (msg) => { /* ... */ });
```

## Updating types when the API changes

```
npm run gen:types
```

Re-runs `openapi-typescript` against `spec/openapi.json`. To refresh the spec itself, fetch it from `https://scoresaber.com/api/docs` (it's embedded in the Scalar HTML page) and overwrite `spec/openapi.json`.

## Tests

```
npm test                              # unit tests, mock fetch, ~150ms
SCORESABER_INTEGRATION=1 npm test     # also hits the live API
```
