/**
 * Opt-in integration tests against the live ScoreSaber API.
 * Run with: SCORESABER_INTEGRATION=1 npm test
 *
 * Use sparingly and pick stable fixtures — these tests cost rate-limit budget
 * against the live API and can flake if the API is down.
 */
import {strict as assert} from 'node:assert';
import {test, describe} from 'node:test';
import {ScoreSaberClient, collect} from '../src/index';

const ENABLED = process.env.SCORESABER_INTEGRATION === '1';
const FIXTURE_PLAYER_ID = '76561198166289091'; // controlled fixture account

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
        assert.ok(client.rateLimit.long.remaining < 400);
        assert.ok(client.rateLimit.long.resetAt > Date.now());
    });

    test('leaderboards.list iterates and stops when consumer caps at 5', async () => {
        const first5 = await collect(client.leaderboards.list({ranked: true}), 5);
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
});
