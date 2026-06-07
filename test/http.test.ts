import {strict as assert} from 'node:assert';
import {test, describe} from 'node:test';
import {
    ScoreSaberClient,
    ScoreSaberError,
    ScoreSaberAPIError,
    ScoreSaberTimeoutError,
    ScoreSaberNetworkError,
    RateLimitedError,
    type ScoreSaberClientOptions,
} from '../src/index';

interface Capture {
    urls: string[];
    inits: (RequestInit | undefined)[];
}

function mockedClient(response: () => Response, opts: Partial<ScoreSaberClientOptions> = {}): {client: ScoreSaberClient; capture: Capture} {
    const capture: Capture = {urls: [], inits: []};
    const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
        capture.urls.push(input);
        capture.inits.push(init);
        return response();
    };
    const client = new ScoreSaberClient({fetch: fetchImpl, ...opts});
    return {client, capture};
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(body), {status: 200, ...init, headers});
}

describe('HTTP layer', () => {
    test('builds URL with default base + path', async () => {
        const {client, capture} = mockedClient(() =>
            jsonResponse({data: [], metadata: {page: 1, itemsPerPage: 50, totalItems: 0, totalPages: 0}}),
        );
        await client.players.listPage();
        assert.equal(capture.urls[0], 'https://scoresaber.com/api/v2/players');
    });

    test('encodes query params and drops undefined/null/empty', async () => {
        const {client, capture} = mockedClient(() =>
            jsonResponse({data: [], metadata: {page: 1, itemsPerPage: 50, totalItems: 0, totalPages: 0}}),
        );
        await client.players.listPage({page: 2, limit: 10, countries: 'gb,no', search: undefined});
        const url = new URL(capture.urls[0]);
        assert.equal(url.searchParams.get('page'), '2');
        assert.equal(url.searchParams.get('limit'), '10');
        assert.equal(url.searchParams.get('countries'), 'gb,no');
        assert.equal(url.searchParams.has('search'), false);
    });

    test('realmId from constructor is appended to every request', async () => {
        const {client, capture} = mockedClient(() => jsonResponse({id: '1', name: 'x'}), {realmId: 2});
        await client.players.getBasic('1');
        const url = new URL(capture.urls[0]);
        assert.equal(url.searchParams.get('realmId'), '2');
    });

    test('maps 4xx structured errors to ScoreSaberAPIError', async () => {
        const {client} = mockedClient(() =>
            jsonResponse(
                {
                    statusCode: 404,
                    error: 'Not Found',
                    code: 'NOT_FOUND',
                    message: 'player not found',
                    details: {resource: 'player', id: 'x'},
                },
                {status: 404},
            ),
        );
        await assert.rejects(
            () => client.players.get('x'),
            (err: unknown) => {
                assert.ok(err instanceof ScoreSaberAPIError);
                assert.equal(err.status, 404);
                assert.equal(err.code, 'NOT_FOUND');
                assert.equal(err.message, 'player not found');
                assert.deepEqual(err.details, {resource: 'player', id: 'x'});
                assert.match(err.url, /\/api\/v2\/players\/x$/);
                return true;
            },
        );
    });

    test('parses rate-limit headers from successful responses', async () => {
        const {client} = mockedClient(() =>
            jsonResponse(
                {id: '1', name: 'x'},
                {
                    headers: {
                        'x-ratelimit-remaining-long': '300',
                        'x-ratelimit-reset-long': '45',
                    },
                },
            ),
        );
        await client.players.getBasic('1');
        assert.equal(client.rateLimit.long.remaining, 300);
    });

    test('attaches an AbortSignal so requests can time out', async () => {
        const {client, capture} = mockedClient(() => jsonResponse({id: '1', name: 'x'}));
        await client.players.getBasic('1');
        assert.ok(capture.inits[0]?.signal instanceof AbortSignal);
    });

    test('retries on 429 with Retry-After then returns the success body', async () => {
        let calls = 0;
        const {client, capture} = mockedClient(() => {
            calls += 1;
            if (calls === 1) {
                return jsonResponse({code: 'TOO_MANY_REQUESTS', message: 'slow down'}, {status: 429, headers: {'retry-after': '0'}});
            }
            return jsonResponse({id: '1', name: 'x'});
        });
        const p = await client.players.getBasic('1');
        assert.equal(calls, 2);
        assert.equal(capture.urls.length, 2);
        assert.equal(p.id, '1');
    });

    test('stops retrying 429 once maxRetries is exhausted and throws RateLimitedError', async () => {
        let calls = 0;
        const {client} = mockedClient(
            () => {
                calls += 1;
                return jsonResponse({code: 'TOO_MANY_REQUESTS', message: 'slow down'}, {status: 429, headers: {'retry-after': '0'}});
            },
            {maxRetries: 1},
        );
        await assert.rejects(
            () => client.players.getBasic('1'),
            (err: unknown) => {
                assert.ok(err instanceof RateLimitedError);
                assert.equal(err.status, 429);
                assert.equal(err.bucket, undefined); // server 429 doesn't name a bucket
                assert.match(err.url ?? '', /\/players\/1\/basic$/);
                return true;
            },
        );
        assert.equal(calls, 2); // initial + 1 retry
    });

    test('a 429 surfaces as RateLimitedError (not ScoreSaberAPIError) when waitForRateLimit is off', async () => {
        const {client} = mockedClient(
            () => jsonResponse({code: 'TOO_MANY_REQUESTS', message: 'slow down'}, {status: 429, headers: {'retry-after': '1'}}),
            {waitForRateLimit: false},
        );
        await assert.rejects(
            () => client.players.getBasic('1'),
            (err: unknown) => {
                assert.ok(err instanceof RateLimitedError);
                assert.ok(!(err instanceof ScoreSaberAPIError));
                assert.equal(err.status, 429);
                assert.ok(err.resetAt > Date.now(), 'resetAt derived from Retry-After');
                return true;
            },
        );
    });

    test('a 429 with a garbage Retry-After still throws RateLimitedError, not a RangeError', async () => {
        const {client} = mockedClient(
            () => jsonResponse({code: 'TOO_MANY_REQUESTS'}, {status: 429, headers: {'retry-after': 'Infinity'}}),
            {waitForRateLimit: false},
        );
        await assert.rejects(
            () => client.players.getBasic('1'),
            (err: unknown) => {
                assert.ok(err instanceof RateLimitedError, `expected RateLimitedError, got ${String(err)}`);
                assert.equal(err.resetAt, 0); // unparseable -> unknown
                return true;
            },
        );
    });
});

describe('Resource paths', () => {
    test('players.get hits /players/{id}', async () => {
        const {client, capture} = mockedClient(() => jsonResponse({id: '123', name: 'x'}));
        await client.players.get('123');
        assert.equal(new URL(capture.urls[0]).pathname, '/api/v2/players/123');
    });

    test('players.getBasic hits /players/{id}/basic', async () => {
        const {client, capture} = mockedClient(() => jsonResponse({id: '123', name: 'x'}));
        await client.players.getBasic('123');
        assert.equal(new URL(capture.urls[0]).pathname, '/api/v2/players/123/basic');
    });

    test('leaderboards.scoresPage hits /leaderboards/{id}/scores with scope', async () => {
        const {client, capture} = mockedClient(() =>
            jsonResponse({data: [], metadata: {page: 1, itemsPerPage: 12, totalItems: 0, totalPages: 0}}),
        );
        await client.leaderboards.scoresPage(7654, {scope: 'US,CA'});
        const url = new URL(capture.urls[0]);
        assert.equal(url.pathname, '/api/v2/leaderboards/7654/scores');
        assert.equal(url.searchParams.get('scope'), 'US,CA');
    });

    test('leaderboards.listPage comma-joins the status array', async () => {
        const {client, capture} = mockedClient(() =>
            jsonResponse({data: [], metadata: {page: 1, itemsPerPage: 14, totalItems: 0, totalPages: 0}}),
        );
        await client.leaderboards.listPage({status: ['RANKED', 'QUALIFIED'], minStars: 5, sortBy: 'stars'});
        const url = new URL(capture.urls[0]);
        assert.equal(url.pathname, '/api/v2/leaderboards');
        assert.equal(url.searchParams.get('status'), 'RANKED,QUALIFIED');
        assert.equal(url.searchParams.get('minStars'), '5');
        assert.equal(url.searchParams.get('sortBy'), 'stars');
    });

    test('rankingQueue.listPage hits /ranking/requests', async () => {
        const {client, capture} = mockedClient(() =>
            jsonResponse({data: [], metadata: {page: 1, itemsPerPage: 10, totalItems: 0, totalPages: 0}}),
        );
        await client.rankingQueue.listPage();
        assert.equal(new URL(capture.urls[0]).pathname, '/api/v2/ranking/requests');
    });

    test('players.count unwraps the {count} envelope', async () => {
        const {client} = mockedClient(() => jsonResponse({count: 12345}));
        const n = await client.players.count();
        assert.equal(n, 12345);
    });

    test('leaderboards.byHashDifficulty hits the correct nested path', async () => {
        const {client, capture} = mockedClient(() => jsonResponse({id: 1, map: {}}));
        await client.leaderboards.byHashDifficulty('abc123', 'Standard', 'ExpertPlus');
        assert.equal(new URL(capture.urls[0]).pathname, '/api/v2/leaderboards/hash/abc123/Standard/ExpertPlus');
    });

    test('maps.get hits /maps/{id}', async () => {
        const {client, capture} = mockedClient(() => jsonResponse({id: 9, hash: 'abc'}));
        await client.maps.get(9);
        assert.equal(new URL(capture.urls[0]).pathname, '/api/v2/maps/9');
    });

    test('realms.list hits /realms', async () => {
        const {client, capture} = mockedClient(() => jsonResponse([]));
        await client.realms.list();
        assert.equal(new URL(capture.urls[0]).pathname, '/api/v2/realms');
    });

    test('scores.replay returns ArrayBuffer (binary)', async () => {
        const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
        const {client} = mockedClient(
            () =>
                new Response(bytes, {
                    status: 200,
                    headers: {'content-type': 'application/octet-stream'},
                }),
        );
        const buf = await client.scores.replay(42);
        assert.equal(buf.byteLength, 4);
        assert.deepEqual(new Uint8Array(buf), bytes);
    });
});

describe('Request options', () => {
    test('sends a default User-Agent identifying the library', async () => {
        const {client, capture} = mockedClient(() => jsonResponse({id: '1', name: 'x'}));
        await client.players.getBasic('1');
        const headers = new Headers(capture.inits[0]?.headers);
        assert.match(headers.get('user-agent') ?? '', /^scoresaber\.js\//);
    });

    test('per-call headers override the defaults', async () => {
        const {client, capture} = mockedClient(() => jsonResponse({id: '1', name: 'x'}));
        await client.players.getBasic('1', {headers: {'user-agent': 'my-app/9', 'x-trace': 'abc'}});
        const headers = new Headers(capture.inits[0]?.headers);
        assert.equal(headers.get('user-agent'), 'my-app/9');
        assert.equal(headers.get('x-trace'), 'abc');
    });

    test('per-call header override is case-insensitive (User-Agent replaces, not appends)', async () => {
        const {client, capture} = mockedClient(() => jsonResponse({id: '1', name: 'x'}));
        await client.players.getBasic('1', {headers: {'User-Agent': 'my-app/9'}});
        const headers = new Headers(capture.inits[0]?.headers);
        assert.equal(headers.get('user-agent'), 'my-app/9'); // not "scoresaber.js/..., my-app/9"
    });

    test('a per-call AbortSignal is composed and passed to fetch', async () => {
        const {client, capture} = mockedClient(() => jsonResponse({id: '1', name: 'x'}));
        const controller = new AbortController();
        await client.players.getBasic('1', {signal: controller.signal});
        assert.ok(capture.inits[0]?.signal instanceof AbortSignal);
    });

    test('onRequest and onResponse hooks fire with context', async () => {
        const reqs: number[] = [];
        const resps: number[] = [];
        const client = new ScoreSaberClient({
            fetch: async () => jsonResponse({id: '1', name: 'x'}),
            onRequest: (ctx) => reqs.push(ctx.attempt),
            onResponse: (ctx) => resps.push(ctx.status),
        });
        await client.players.getBasic('1');
        assert.deepEqual(reqs, [0]);
        assert.deepEqual(resps, [200]);
    });
});

describe('Realms', () => {
    test('per-call realmId overrides the client default', async () => {
        const {client, capture} = mockedClient(() => jsonResponse({id: '1', name: 'x'}), {realmId: 1});
        await client.players.getBasic('1', {realmId: 2});
        assert.equal(new URL(capture.urls[0]).searchParams.get('realmId'), '2');
    });

    test('client.realm(id) scopes requests to that realm', async () => {
        const {client, capture} = mockedClient(() =>
            jsonResponse({data: [], metadata: {page: 1, itemsPerPage: 1, totalItems: 0, totalPages: 0}}),
        );
        await client.realm(2).players.listPage();
        assert.equal(new URL(capture.urls[0]).searchParams.get('realmId'), '2');
    });

    test('a realm-scoped handle shares the client rate-limiter (coordinated budget)', async () => {
        const {client} = mockedClient(() =>
            jsonResponse({id: '1', name: 'x'}, {headers: {'x-ratelimit-remaining-long': '42', 'x-ratelimit-reset-long': '60'}}),
        );
        await client.realm(2).players.getBasic('1');
        // The scoped handle fed the SAME limiter the base client exposes.
        assert.equal(client.rateLimit.long.remaining, 42);
    });

    test('a per-call realmId overrides the realm scope', async () => {
        const {client, capture} = mockedClient(() => jsonResponse({id: '1', name: 'x'}));
        await client.realm(2).players.getBasic('1', {realmId: 3});
        assert.equal(new URL(capture.urls[0]).searchParams.get('realmId'), '3');
    });
});

describe('Resilience', () => {
    test('times out into ScoreSaberTimeoutError without retrying', async () => {
        let calls = 0;
        const client = new ScoreSaberClient({
            timeoutMs: 20,
            fetch: (_input, init) => {
                calls += 1;
                return new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
                });
            },
        });
        await assert.rejects(
            () => client.players.getBasic('1'),
            (err: unknown) => {
                assert.ok(err instanceof ScoreSaberTimeoutError);
                assert.equal(err.timeoutMs, 20);
                assert.match(err.url, /\/players\/1\/basic$/);
                return true;
            },
        );
        assert.equal(calls, 1); // timeouts are not retried
    });

    test('wraps fetch failures in ScoreSaberNetworkError after exhausting retries', async () => {
        let calls = 0;
        const client = new ScoreSaberClient({
            maxRetries: 0,
            fetch: () => {
                calls += 1;
                return Promise.reject(new TypeError('fetch failed'));
            },
        });
        await assert.rejects(
            () => client.players.getBasic('1'),
            (err: unknown) => {
                assert.ok(err instanceof ScoreSaberNetworkError);
                assert.ok(err.cause instanceof TypeError);
                return true;
            },
        );
        assert.equal(calls, 1);
    });

    test('retries transient network failures then succeeds', async () => {
        let calls = 0;
        const client = new ScoreSaberClient({
            maxRetries: 2,
            fetch: () => {
                calls += 1;
                if (calls === 1) return Promise.reject(new TypeError('connection reset'));
                return Promise.resolve(jsonResponse({id: '1', name: 'x'}));
            },
        });
        const p = await client.players.getBasic('1');
        assert.equal(p.id, '1');
        assert.equal(calls, 2);
    });

    test('caller cancellation during retry backoff is observed promptly (no further attempts)', async () => {
        const controller = new AbortController();
        const reason = new Error('cancelled mid-backoff');
        let calls = 0;
        const client = new ScoreSaberClient({
            maxRetries: 5,
            fetch: (_input, init) => {
                calls += 1;
                if (init?.signal?.aborted) return Promise.reject(init.signal.reason);
                // First attempt returns a retryable 5xx, then the caller aborts
                // while the backoff is pending.
                controller.abort(reason);
                return Promise.resolve(jsonResponse({message: 'boom'}, {status: 503}));
            },
        });
        await assert.rejects(
            () => client.players.getBasic('1', {signal: controller.signal}),
            (err: unknown) => {
                assert.equal(err, reason);
                return true;
            },
        );
        assert.equal(calls, 1); // aborted during backoff — never retried
    });

    test('caller cancellation propagates unwrapped (not a ScoreSaber error)', async () => {
        const controller = new AbortController();
        const reason = new Error('cancelled by caller');
        controller.abort(reason);
        const client = new ScoreSaberClient({
            fetch: (_input, init) =>
                init?.signal?.aborted ? Promise.reject(init.signal.reason) : Promise.resolve(jsonResponse({id: '1', name: 'x'})),
        });
        await assert.rejects(
            () => client.players.getBasic('1', {signal: controller.signal}),
            (err: unknown) => {
                assert.equal(err, reason);
                assert.ok(!(err instanceof ScoreSaberError));
                return true;
            },
        );
    });

    test('retries 5xx then succeeds', async () => {
        let calls = 0;
        const client = new ScoreSaberClient({
            maxRetries: 1,
            fetch: () => {
                calls += 1;
                if (calls === 1) return Promise.resolve(jsonResponse({message: 'boom'}, {status: 503}));
                return Promise.resolve(jsonResponse({id: '1', name: 'x'}));
            },
        });
        const p = await client.players.getBasic('1');
        assert.equal(p.id, '1');
        assert.equal(calls, 2);
    });

    test('surfaces a 5xx as ScoreSaberAPIError once retries are exhausted', async () => {
        const client = new ScoreSaberClient({
            maxRetries: 0,
            fetch: () => Promise.resolve(jsonResponse({code: 'INTERNAL', message: 'boom'}, {status: 500})),
        });
        await assert.rejects(
            () => client.players.getBasic('1'),
            (err: unknown) => {
                assert.ok(err instanceof ScoreSaberAPIError);
                assert.equal(err.status, 500);
                return true;
            },
        );
    });

    test('rejects responses larger than maxResponseBytes (Content-Length pre-check)', async () => {
        const client = new ScoreSaberClient({
            maxResponseBytes: 10,
            fetch: async () => jsonResponse({id: '1', name: 'x'}, {headers: {'content-length': '5000'}}),
        });
        await assert.rejects(
            () => client.players.getBasic('1'),
            (err: unknown) => {
                assert.ok(err instanceof ScoreSaberError);
                assert.match(err.message, /maxResponseBytes/);
                return true;
            },
        );
    });

    test('enforces maxResponseBytes by streaming when Content-Length is absent', async () => {
        const body = 'x'.repeat(5000);
        const client = new ScoreSaberClient({
            maxResponseBytes: 10,
            // A streamed body carries no Content-Length, so the header pre-check
            // can't catch it — the running byte count must.
            fetch: async () => {
                const stream = new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(body));
                        controller.close();
                    },
                });
                return new Response(stream, {status: 200, headers: {'content-type': 'application/json'}});
            },
        });
        await assert.rejects(
            () => client.players.getBasic('1'),
            (err: unknown) => {
                assert.ok(err instanceof ScoreSaberError);
                assert.match(err.message, /maxResponseBytes/);
                return true;
            },
        );
    });

    test('maxResponseBytes streams and parses bodies under the cap', async () => {
        const client = new ScoreSaberClient({
            maxResponseBytes: 1000,
            fetch: async () => jsonResponse({id: '7', name: 'ok'}),
        });
        const p = await client.players.getBasic('7');
        assert.equal(p.id, '7');
    });

    test('getBinary enforces maxResponseBytes (over the cap rejects, under passes)', async () => {
        const over = new ScoreSaberClient({
            maxResponseBytes: 4,
            fetch: async () =>
                new Response(new Uint8Array([1, 2, 3, 4, 5]), {status: 200, headers: {'content-type': 'application/octet-stream'}}),
        });
        await assert.rejects(
            () => over.scores.replay(1),
            (err: unknown) => err instanceof ScoreSaberError && /maxResponseBytes/.test(err.message),
        );

        const under = new ScoreSaberClient({
            maxResponseBytes: 16,
            fetch: async () =>
                new Response(new Uint8Array([1, 2, 3, 4]), {status: 200, headers: {'content-type': 'application/octet-stream'}}),
        });
        const buf = await under.scores.replay(1);
        assert.equal(buf.byteLength, 4);
    });

    test('a malformed success body surfaces as ScoreSaberError, not a raw SyntaxError', async () => {
        const client = new ScoreSaberClient({
            fetch: async () => new Response('not json', {status: 200, headers: {'content-type': 'application/json'}}),
        });
        await assert.rejects(
            () => client.players.getBasic('1'),
            (err: unknown) => {
                assert.ok(err instanceof ScoreSaberError);
                assert.ok(!(err instanceof SyntaxError));
                assert.match(err.message, /Invalid JSON/);
                return true;
            },
        );
    });

    test('a non-2xx with a non-JSON body still maps to ScoreSaberAPIError (code UNKNOWN)', async () => {
        const client = new ScoreSaberClient({
            maxRetries: 0,
            fetch: async () => new Response('<html>502 Bad Gateway</html>', {status: 502, headers: {'content-type': 'text/html'}}),
        });
        await assert.rejects(
            () => client.players.getBasic('1'),
            (err: unknown) => {
                assert.ok(err instanceof ScoreSaberAPIError);
                assert.equal(err.status, 502);
                assert.equal(err.code, 'UNKNOWN');
                return true;
            },
        );
    });
});
