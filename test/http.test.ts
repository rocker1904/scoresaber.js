import {strict as assert} from 'node:assert';
import {test, describe} from 'node:test';
import {ScoreSaberClient, ScoreSaberAPIError, type ScoreSaberClientOptions} from '../src/index';

interface Capture {
    urls: string[];
    inits: (RequestInit | undefined)[];
}

function mockedClient(
    response: () => Response,
    opts: Partial<ScoreSaberClientOptions> = {},
): {client: ScoreSaberClient; capture: Capture} {
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
        const {client, capture} = mockedClient(() => jsonResponse({data: [], metadata: {page: 1, itemsPerPage: 50, totalItems: 0, totalPages: 0}}));
        await client.players.listPage();
        assert.equal(capture.urls[0], 'https://scoresaber.com/api/v2/players');
    });

    test('encodes query params and drops undefined/null/empty', async () => {
        const {client, capture} = mockedClient(() => jsonResponse({data: [], metadata: {page: 1, itemsPerPage: 50, totalItems: 0, totalPages: 0}}));
        await client.players.listPage({page: 2, limit: 10, countries: 'gb,no', search: undefined});
        const url = new URL(capture.urls[0]);
        assert.equal(url.searchParams.get('page'), '2');
        assert.equal(url.searchParams.get('limit'), '10');
        assert.equal(url.searchParams.get('countries'), 'gb,no');
        assert.equal(url.searchParams.has('search'), false);
    });

    test('realmId from constructor is appended to every request', async () => {
        const {client, capture} = mockedClient(
            () => jsonResponse({id: '1', name: 'x'} as unknown as Record<string, unknown>),
            {realmId: 2},
        );
        await client.players.getBasic('1');
        const url = new URL(capture.urls[0]);
        assert.equal(url.searchParams.get('realmId'), '2');
    });

    test('maps 4xx structured errors to ScoreSaberAPIError', async () => {
        const {client} = mockedClient(() => jsonResponse(
            {statusCode: 404, error: 'Not Found', code: 'NOT_FOUND', message: 'player not found', details: {resource: 'player', id: 'x'}},
            {status: 404},
        ));
        await assert.rejects(() => client.players.get('x'), (err: unknown) => {
            assert.ok(err instanceof ScoreSaberAPIError);
            assert.equal(err.status, 404);
            assert.equal(err.code, 'NOT_FOUND');
            assert.equal(err.message, 'player not found');
            assert.deepEqual(err.details, {resource: 'player', id: 'x'});
            return true;
        });
    });

    test('parses rate-limit headers from successful responses', async () => {
        const {client} = mockedClient(() => jsonResponse({id: '1', name: 'x'}, {
            headers: {
                'x-ratelimit-remaining-long': '300',
                'x-ratelimit-reset-long': '45',
            },
        }));
        await client.players.getBasic('1');
        assert.equal(client.rateLimit.long.remaining, 300);
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

    test('leaderboards.scoresPage hits /leaderboards/{id}/scores', async () => {
        const {client, capture} = mockedClient(() => jsonResponse({data: [], metadata: {page: 1, itemsPerPage: 12, totalItems: 0, totalPages: 0}}));
        await client.leaderboards.scoresPage(7654, {scope: 'country', countries: 'gb'});
        const url = new URL(capture.urls[0]);
        assert.equal(url.pathname, '/api/v2/leaderboards/7654/scores');
        assert.equal(url.searchParams.get('scope'), 'country');
        assert.equal(url.searchParams.get('countries'), 'gb');
    });

    test('rankingQueue.listPage hits /ranking/requests', async () => {
        const {client, capture} = mockedClient(() => jsonResponse({data: [], metadata: {page: 1, itemsPerPage: 10, totalItems: 0, totalPages: 0}}));
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
        const bytes = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]);
        const {client} = mockedClient(() => new Response(bytes, {
            status: 200,
            headers: {'content-type': 'application/octet-stream'},
        }));
        const buf = await client.scores.replay(42);
        assert.equal(buf.byteLength, 4);
        assert.deepEqual(new Uint8Array(buf), bytes);
    });
});
