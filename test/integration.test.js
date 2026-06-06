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
/**
 * Opt-in integration tests against the live ScoreSaber API.
 * Run with: SCORESABER_INTEGRATION=1 npm test
 *
 * Use sparingly and pick stable fixtures — these tests cost rate-limit budget
 * against the live API and can flake if the API is down.
 */
const node_assert_1 = require("node:assert");
const node_test_1 = require("node:test");
const index_1 = require("../src/index");
const ENABLED = process.env.SCORESABER_INTEGRATION === '1';
const FIXTURE_PLAYER_ID = '76561198166289091'; // controlled fixture account
(0, node_test_1.describe)('live API smoke', { skip: !ENABLED }, () => {
    const client = new index_1.ScoreSaberClient();
    (0, node_test_1.test)('players.getBasic returns a structurally valid BasicPlayer', () => __awaiter(void 0, void 0, void 0, function* () {
        const p = yield client.players.getBasic(FIXTURE_PLAYER_ID);
        node_assert_1.strict.equal(p.id, FIXTURE_PLAYER_ID);
        node_assert_1.strict.equal(typeof p.name, 'string');
        node_assert_1.strict.equal(typeof p.country, 'string');
        node_assert_1.strict.equal(typeof p.stats.rank, 'number');
        node_assert_1.strict.equal(typeof p.stats.totalPP, 'number');
        node_assert_1.strict.equal(typeof p.stats.countryRank, 'number');
    }));
    (0, node_test_1.test)('players.get returns full profile with badges and follower fields', () => __awaiter(void 0, void 0, void 0, function* () {
        const p = yield client.players.get(FIXTURE_PLAYER_ID);
        node_assert_1.strict.equal(p.id, FIXTURE_PLAYER_ID);
        node_assert_1.strict.ok(Array.isArray(p.badges));
        node_assert_1.strict.equal(typeof p.followers, 'number');
    }));
    (0, node_test_1.test)('players.atRank(1) returns the global #1 player', () => __awaiter(void 0, void 0, void 0, function* () {
        const p = yield client.players.atRank(1);
        node_assert_1.strict.equal(p.stats.rank, 1);
    }));
    (0, node_test_1.test)('rate-limit headers are surfaced on the client after a request', () => __awaiter(void 0, void 0, void 0, function* () {
        yield client.players.getBasic(FIXTURE_PLAYER_ID);
        node_assert_1.strict.ok(client.rateLimit.long.remaining < 400);
        node_assert_1.strict.ok(client.rateLimit.long.resetAt > Date.now());
    }));
    (0, node_test_1.test)('leaderboards.list iterates and stops when consumer caps at 5', () => __awaiter(void 0, void 0, void 0, function* () {
        const first5 = yield (0, index_1.collect)(client.leaderboards.list({ ranked: true }), 5);
        node_assert_1.strict.equal(first5.length, 5);
    }));
    (0, node_test_1.test)('players.scores yields PlayerScore items with score+leaderboard', () => __awaiter(void 0, void 0, void 0, function* () {
        const first3 = yield (0, index_1.collect)(client.players.scores(FIXTURE_PLAYER_ID, { sort: 'top' }), 3);
        node_assert_1.strict.ok(first3.length > 0);
        for (const ps of first3) {
            node_assert_1.strict.equal(typeof ps.score.pp, 'number');
            node_assert_1.strict.equal(typeof ps.leaderboard.id, 'number');
        }
    }));
});
