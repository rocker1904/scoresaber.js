/**
 * Opt-in integration tests against the live ScoreSaber API.
 * Run with: SCORESABER_INTEGRATION=1 npm test
 *
 * Use sparingly and pick stable fixtures — these tests cost rate-limit budget
 * against the live API and can flake if the API is down.
 */
import {strict as assert} from 'node:assert';
import {test, describe} from 'node:test';
import {ScoreSaberClient, ScoreSaberAPIError, collect} from '../src/index';
import {validatorFor} from './helpers/schema';

const ENABLED = process.env.SCORESABER_INTEGRATION === '1';
// Deliberately the library author's own account ("Rocker"): a stable, controlled
// fixture that won't be renamed or deleted out from under the suite. Assertions
// only check structure (types/shape), never flattering values. The README quick
// start uses this same id.
const FIXTURE_PLAYER_ID = '76561198166289091';

describe('live API smoke', {skip: !ENABLED}, () => {
    const client = new ScoreSaberClient();

    test('players.getBasic returns a structurally valid BasicPlayer', async () => {
        const p = await client.players.getBasic(FIXTURE_PLAYER_ID);
        assert.equal(p.id, FIXTURE_PLAYER_ID);
        assert.equal(typeof p.name, 'string');
        assert.equal(typeof p.country, 'string');
        assert.equal(typeof p.stats.rank, 'number');
        assert.equal(typeof p.stats.totalPP, 'number');
        assert.equal(typeof p.stats.countryRank, 'number');
    });

    test('players.get returns full profile with badges and follower fields', async () => {
        const p = await client.players.get(FIXTURE_PLAYER_ID);
        assert.equal(p.id, FIXTURE_PLAYER_ID);
        assert.ok(Array.isArray(p.badges));
        assert.equal(typeof p.followers, 'number');
    });

    test('players.atRank(1) returns the global #1 player', async () => {
        const p = await client.players.atRank(1);
        assert.equal(p.stats.rank, 1);
    });

    test('rate-limit headers are surfaced on the client after a request', async () => {
        await client.players.getBasic(FIXTURE_PLAYER_ID);
        // Contract check: `resetAt` is only ever set by parsing `x-ratelimit-reset-*`,
        // so if those header names or units drift from what rate-limit.ts assumes it
        // stays 0 and this fails loudly. (`remaining` can't serve as the signal — a
        // checkin's own reservation lowers it below the default ceiling even with no
        // headers, so it no longer distinguishes "parsed" from "unparsed".)
        assert.ok(
            client.rateLimit.long.resetAt > Date.now(),
            `long bucket reset not surfaced from headers — the x-ratelimit-* contract may have changed (resetAt=${client.rateLimit.long.resetAt})`,
        );
    });

    test('server honours leaderboard filters (regression guard for dropped query params)', async () => {
        const all = await client.leaderboards.listPage({limit: 1});
        const ranked = await client.leaderboards.listPage({limit: 1, status: ['RANKED']});
        assert.ok(all.metadata && ranked.metadata, 'expected pagination metadata');
        // If `status` were sent under a name the API ignores, both totals would
        // be identical. A real filter shrinks the ranked subset.
        assert.notEqual(all.metadata.totalItems, ranked.metadata.totalItems);
    });

    test('leaderboards.list iterates and stops when consumer caps at 5', async () => {
        const first5 = await collect(client.leaderboards.list({status: ['RANKED']}), 5);
        assert.equal(first5.length, 5);
    });

    test('players.scores yields PlayerScore items with score+leaderboard', async () => {
        const first3 = await collect(client.players.scores(FIXTURE_PLAYER_ID, {sort: 'top'}), 3);
        assert.ok(first3.length > 0);
        for (const ps of first3) {
            assert.equal(typeof ps.score.pp, 'number');
            assert.equal(typeof ps.leaderboard.id, 'number');
        }
    });

    test('players.count returns a positive number', async () => {
        const n = await client.players.count();
        assert.ok(n > 0, 'expected at least one player on the platform');
    });

    test('realms.list returns at least one realm', async () => {
        const realms = await client.realms.list();
        assert.ok(Array.isArray(realms));
        assert.ok(realms.length > 0);
    });

    test('a not-found request surfaces ScoreSaberAPIError carrying the url', async () => {
        await assert.rejects(
            () => client.players.get('0'),
            (err: unknown) => {
                assert.ok(err instanceof ScoreSaberAPIError);
                assert.ok(err.status >= 400);
                assert.match(err.url, /\/players\/0$/);
                return true;
            },
        );
    });

    describe('response shapes match the spec schemas', () => {
        const cases: Array<[string, string, () => Promise<unknown>]> = [
            ['players.getBasic', '/api/v2/players/{id}/basic', () => client.players.getBasic(FIXTURE_PLAYER_ID)],
            ['players.get', '/api/v2/players/{id}', () => client.players.get(FIXTURE_PLAYER_ID)],
            ['players.scoresPage', '/api/v2/players/{id}/scores', () => client.players.scoresPage(FIXTURE_PLAYER_ID, {limit: 3})],
            ['leaderboards.listPage', '/api/v2/leaderboards', () => client.leaderboards.listPage({limit: 3, status: ['RANKED']})],
            ['realms.list', '/api/v2/realms', () => client.realms.list()],
        ];
        for (const [name, specPath, fetchOne] of cases) {
            test(name, async () => {
                const validate = validatorFor(specPath);
                const body = await fetchOne();
                assert.ok(validate(body), `${name} response failed schema validation:\n${JSON.stringify(validate.errors, null, 2)}`);
            });
        }
    });
});
