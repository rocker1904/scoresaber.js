/**
 * Compile-time contract: request option types must match the v2 spec.
 *
 * This file is never executed — it exists so `npm run typecheck` fails if an
 * option type drifts from the generated spec. The `@ts-expect-error` lines are
 * the teeth: if a legacy/invalid param ever type-checks again, the unused
 * directive turns into a compile error. (Regression guard for the v1→v2 param
 * names that originally shipped silently, e.g. `ranked`, `minStar`, `category`.)
 */
import {
    ScoreSaberClient,
    ScoreSaberError,
    ScoreSaberAPIError,
    RateLimitedError,
    ScoreSaberTimeoutError,
    ScoreSaberNetworkError,
    type RequestOptions,
} from '../src/index';

const c = new ScoreSaberClient();

// The full error hierarchy is exported and rooted at ScoreSaberError.
const _errs: ScoreSaberError[] = [
    new ScoreSaberAPIError({status: 404, code: 'NOT_FOUND', message: 'x', url: 'u'}),
    new RateLimitedError({bucket: 'long', resetAt: 0}),
    new ScoreSaberTimeoutError('u', 1),
    new ScoreSaberNetworkError('u'),
];
void _errs;

// Per-call request options compile on representative methods (incl. per-call realmId).
const _req: RequestOptions = {signal: new AbortController().signal, headers: {'x-trace': '1'}, realmId: 2};
void c.players.get('1', _req);
void c.leaderboards.listPage({status: ['RANKED']}, _req);
void c.scores.replay(1, _req);

// Realm-scoped handle exposes the resource namespaces.
void c.realm(2).players.list({countries: 'gb'});
void c.realm(2).leaderboards.get(1);

// Valid v2 params must compile.
void c.leaderboards.listPage({
    status: ['RANKED', 'QUALIFIED'],
    minStars: 1,
    maxStars: 10,
    verified: 'true',
    sortBy: 'stars',
    sortDirection: 'asc',
    search: 'x',
});
void c.maps.listPage({status: ['LOVED'], sortBy: 'trending', minStars: 5});
void c.players.listPage({countries: 'gb', sort: 'totalPP', scope: 'country', sortDirection: 'desc'});
void c.players.scoresPage('1', {sort: 'oldest', leaderboardId: 1, from: '2020-01-01'});
void c.leaderboards.scoresPage(1, {scope: 'US,CA', sort: 'timeSet', hideNA: 'true'});
// The by-hash scores endpoint accepts `includePlayerScore`; the by-id one does not.
void c.leaderboards.scoresPageByHash('h', 'Standard', 'ExpertPlus', {includePlayerScore: 'true'});

// client.rateLimit is a read-only view: reading bucket state compiles...
void c.rateLimit.long.remaining;
void c.rateLimit.short.resetAt;
void c.rateLimit.waitForRateLimit;
// ...but the limiter's mutating internals are not exposed on it.
// @ts-expect-error checkin() is internal to the limiter, not part of the public view
void c.rateLimit.checkin;
// @ts-expect-error update() is internal to the limiter, not part of the public view
void c.rateLimit.update;
// ...and bucket state is deeply read-only — consumers cannot corrupt the limiter.
// @ts-expect-error remaining is readonly on the public view
c.rateLimit.long.remaining = 5;

// Legacy v1 / invalid params must NOT compile.
// @ts-expect-error `ranked` is a v1 param; v2 uses `status`
void c.leaderboards.listPage({ranked: true});
// @ts-expect-error v1 used singular `minStar`; v2 uses `minStars`
void c.leaderboards.listPage({minStar: 5});
// @ts-expect-error v1 used `category`; v2 uses `sortBy`/`status`
void c.leaderboards.listPage({category: 1});
// @ts-expect-error maps uses `sortBy`, not `sort`
void c.maps.listPage({sort: 'trending'});
// @ts-expect-error leaderboard scores filter by country via `scope`, not `countries`
void c.leaderboards.scoresPage(1, {countries: 'gb'});
// @ts-expect-error `top`/`recent` are the only... `best` is not a player-scores sort
void c.players.scoresPage('1', {sort: 'best'});
// @ts-expect-error includePlayerScore exists only on the by-hash scores endpoint
void c.leaderboards.scoresPage(1, {includePlayerScore: 'true'});
