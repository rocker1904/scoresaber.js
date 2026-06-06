"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const node_test_1 = require("node:test");
const index_1 = require("../src/index");
function mockedClient(response, opts = {}) {
    const capture = { urls: [], inits: [] };
    const fetchImpl = (input, init) => __awaiter(this, void 0, void 0, function* () {
        capture.urls.push(input);
        capture.inits.push(init);
        return response();
    });
    const client = new index_1.ScoreSaberClient(Object.assign({ fetch: fetchImpl }, opts));
    return { client, capture };
}
function jsonResponse(body, init = {}) {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(body), Object.assign(Object.assign({ status: 200 }, init), { headers }));
}
(0, node_test_1.describe)('HTTP layer', () => {
    (0, node_test_1.test)('builds URL with default base + path', () => __awaiter(void 0, void 0, void 0, function* () {
        const { client, capture } = mockedClient(() => jsonResponse({ data: [], metadata: { page: 1, itemsPerPage: 50, totalItems: 0, totalPages: 0 } }));
        yield client.players.listPage();
        node_assert_1.strict.equal(capture.urls[0], 'https://scoresaber.com/api/v2/players');
    }));
    (0, node_test_1.test)('encodes query params and drops undefined/null/empty', () => __awaiter(void 0, void 0, void 0, function* () {
        const { client, capture } = mockedClient(() => jsonResponse({ data: [], metadata: { page: 1, itemsPerPage: 50, totalItems: 0, totalPages: 0 } }));
        yield client.players.listPage({ page: 2, limit: 10, countries: 'gb,no', search: undefined });
        const url = new URL(capture.urls[0]);
        node_assert_1.strict.equal(url.searchParams.get('page'), '2');
        node_assert_1.strict.equal(url.searchParams.get('limit'), '10');
        node_assert_1.strict.equal(url.searchParams.get('countries'), 'gb,no');
        node_assert_1.strict.equal(url.searchParams.has('search'), false);
    }));
    (0, node_test_1.test)('realmId from constructor is appended to every request', () => __awaiter(void 0, void 0, void 0, function* () {
        const { client, capture } = mockedClient(() => jsonResponse({ id: '1', name: 'x' }), { realmId: 2 });
        yield client.players.getBasic('1');
        const url = new URL(capture.urls[0]);
        node_assert_1.strict.equal(url.searchParams.get('realmId'), '2');
    }));
    (0, node_test_1.test)('maps 4xx structured errors to ScoreSaberAPIError', () => __awaiter(void 0, void 0, void 0, function* () {
        const { client } = mockedClient(() => jsonResponse({ statusCode: 404, error: 'Not Found', code: 'NOT_FOUND', message: 'player not found', details: { resource: 'player', id: 'x' } }, { status: 404 }));
        yield node_assert_1.strict.rejects(() => client.players.get('x'), (err) => {
            node_assert_1.strict.ok(err instanceof index_1.ScoreSaberAPIError);
            node_assert_1.strict.equal(err.status, 404);
            node_assert_1.strict.equal(err.code, 'NOT_FOUND');
            node_assert_1.strict.equal(err.message, 'player not found');
            node_assert_1.strict.deepEqual(err.details, { resource: 'player', id: 'x' });
            return true;
        });
    }));
    (0, node_test_1.test)('parses rate-limit headers from successful responses', () => __awaiter(void 0, void 0, void 0, function* () {
        const { client } = mockedClient(() => jsonResponse({ id: '1', name: 'x' }, {
            headers: {
                'x-ratelimit-remaining-long': '300',
                'x-ratelimit-reset-long': '45',
            },
        }));
        yield client.players.getBasic('1');
        node_assert_1.strict.equal(client.rateLimit.long.remaining, 300);
    }));
});
(0, node_test_1.describe)('Resource paths', () => {
    (0, node_test_1.test)('players.get hits /players/{id}', () => __awaiter(void 0, void 0, void 0, function* () {
        const { client, capture } = mockedClient(() => jsonResponse({ id: '123', name: 'x' }));
        yield client.players.get('123');
        node_assert_1.strict.equal(new URL(capture.urls[0]).pathname, '/api/v2/players/123');
    }));
    (0, node_test_1.test)('players.getBasic hits /players/{id}/basic', () => __awaiter(void 0, void 0, void 0, function* () {
        const { client, capture } = mockedClient(() => jsonResponse({ id: '123', name: 'x' }));
        yield client.players.getBasic('123');
        node_assert_1.strict.equal(new URL(capture.urls[0]).pathname, '/api/v2/players/123/basic');
    }));
    (0, node_test_1.test)('leaderboards.scoresPage hits /leaderboards/{id}/scores', () => __awaiter(void 0, void 0, void 0, function* () {
        const { client, capture } = mockedClient(() => jsonResponse({ data: [], metadata: { page: 1, itemsPerPage: 12, totalItems: 0, totalPages: 0 } }));
        yield client.leaderboards.scoresPage(7654, { scope: 'country', countries: 'gb' });
        const url = new URL(capture.urls[0]);
        node_assert_1.strict.equal(url.pathname, '/api/v2/leaderboards/7654/scores');
        node_assert_1.strict.equal(url.searchParams.get('scope'), 'country');
        node_assert_1.strict.equal(url.searchParams.get('countries'), 'gb');
    }));
    (0, node_test_1.test)('rankingQueue.listPage hits /ranking/requests', () => __awaiter(void 0, void 0, void 0, function* () {
        const { client, capture } = mockedClient(() => jsonResponse({ data: [], metadata: { page: 1, itemsPerPage: 10, totalItems: 0, totalPages: 0 } }));
        yield client.rankingQueue.listPage();
        node_assert_1.strict.equal(new URL(capture.urls[0]).pathname, '/api/v2/ranking/requests');
    }));
});
