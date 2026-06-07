/**
 * Offline contract: every request path a resource builds must exist in the v2
 * spec. Mock fetch captures the URL; the path is matched against the spec's
 * path templates. This catches a typo'd or stale endpoint string without
 * touching the network — the deterministic counterpart to the live suite.
 */
import {strict as assert} from 'node:assert';
import {test, describe} from 'node:test';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {ScoreSaberClient} from '../src/index';

interface OpenApiDoc {
    paths: Record<string, unknown>;
}

const spec = JSON.parse(readFileSync(path.join(process.cwd(), 'spec', 'openapi.json'), 'utf8')) as OpenApiDoc;

function templateToRegex(template: string): RegExp {
    const pattern = template
        .split('/')
        .map((segment) => (/^\{.*\}$/.test(segment) ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        .join('/');
    return new RegExp(`^${pattern}$`);
}

function captureClient(): {client: ScoreSaberClient; urls: string[]} {
    const urls: string[] = [];
    const fetchImpl = async (input: string): Promise<Response> => {
        urls.push(input);
        const body = JSON.stringify({data: [], count: 0, metadata: {page: 1, itemsPerPage: 1, totalItems: 0, totalPages: 0}});
        return new Response(body, {status: 200, headers: {'content-type': 'application/json'}});
    };
    return {client: new ScoreSaberClient({fetch: fetchImpl}), urls};
}

// One invocation per path-building method, paired with the *exact* spec template
// it must hit. Generator methods (`list`, `scores`) reuse the same paths as their
// `*Page` counterparts and don't fetch until iterated, so the page variants cover
// them. Matching against the specific template (not just "any known path") catches
// a typo'd segment like `players/kount` that would otherwise match `/players/{id}`.
const calls: Array<[string, string, (c: ScoreSaberClient) => Promise<unknown>]> = [
    ['players.get', '/api/v2/players/{id}', (c) => c.players.get('1')],
    ['players.getBasic', '/api/v2/players/{id}/basic', (c) => c.players.getBasic('1')],
    ['players.listPage', '/api/v2/players', (c) => c.players.listPage()],
    ['players.atRank', '/api/v2/players', (c) => c.players.atRank(1)],
    ['players.scoresPage', '/api/v2/players/{id}/scores', (c) => c.players.scoresPage('1')],
    ['players.count', '/api/v2/players/count', (c) => c.players.count()],
    ['players.aliases', '/api/v2/players/{id}/aliases', (c) => c.players.aliases('1')],
    ['players.history', '/api/v2/players/{id}/history', (c) => c.players.history('1')],
    ['players.globalHistory', '/api/v2/players/{id}/global-history', (c) => c.players.globalHistory('1')],
    ['leaderboards.get', '/api/v2/leaderboards/{id}', (c) => c.leaderboards.get(1)],
    ['leaderboards.listPage', '/api/v2/leaderboards', (c) => c.leaderboards.listPage()],
    ['leaderboards.scoresPage', '/api/v2/leaderboards/{id}/scores', (c) => c.leaderboards.scoresPage(1)],
    ['leaderboards.byHash', '/api/v2/leaderboards/hash/{hash}', (c) => c.leaderboards.byHash('abc')],
    [
        'leaderboards.byHashDifficulty',
        '/api/v2/leaderboards/hash/{hash}/{mode}/{difficulty}',
        (c) => c.leaderboards.byHashDifficulty('abc', 'Standard', '9'),
    ],
    [
        'leaderboards.scoresPageByHash',
        '/api/v2/leaderboards/hash/{hash}/{mode}/{difficulty}/scores',
        (c) => c.leaderboards.scoresPageByHash('abc', 'Standard', '9'),
    ],
    ['scores.get', '/api/v2/scores/{id}', (c) => c.scores.get(1)],
    ['scores.history', '/api/v2/scores/{id}/history', (c) => c.scores.history(1)],
    ['scores.stats', '/api/v2/scores/{id}/stats', (c) => c.scores.stats(1)],
    ['scores.replay', '/api/v2/scores/{id}/replay', (c) => c.scores.replay(1)],
    ['maps.get', '/api/v2/maps/{id}', (c) => c.maps.get(1)],
    ['maps.listPage', '/api/v2/maps', (c) => c.maps.listPage()],
    ['realms.list', '/api/v2/realms', (c) => c.realms.list()],
    ['realms.get', '/api/v2/realms/{id}', (c) => c.realms.get(1)],
    ['rankingQueue.listPage', '/api/v2/ranking/requests', (c) => c.rankingQueue.listPage()],
    ['rankingQueue.get', '/api/v2/ranking/requests/{id}', (c) => c.rankingQueue.get(1)],
    ['health', '/api/v2/health', (c) => c.health()],
];

describe('spec path contract', () => {
    for (const [name, template, invoke] of calls) {
        test(`${name} targets ${template} (defined as a GET in the v2 spec)`, async () => {
            // The template must exist in the spec and expose a GET.
            const methods = spec.paths[template] as Record<string, unknown> | undefined;
            assert.ok(methods, `${template} is not a path in spec/openapi.json (stale mapping?)`);
            assert.ok('get' in methods, `${template} has no GET operation in the spec`);

            const {client, urls} = captureClient();
            // The URL is captured at fetch time; ignore any downstream parsing of
            // the stub body (e.g. atRank rejecting on an empty page).
            await invoke(client).catch(() => undefined);
            assert.equal(urls.length, 1, `${name} made ${urls.length} requests, expected 1`);
            const pathname = new URL(urls[0]).pathname;
            assert.match(pathname, templateToRegex(template), `${name} hit ${pathname}, expected to match ${template}`);
        });
    }
});
